// Clientes dos serviços. O gateway NUNCA escolhe o destino por dado da requisição: a base é fixa na configuração e o caminho sai do schema do serviço.
// Defesas: sem redirecionamento (nunca segue 3xx: SSRF e open redirect), tamanho máximo de resposta, prazo, caminho montado só com segmentos codificados.

export type PedidoServico = { metodo: string; caminho: string; query?: Record<string, unknown>; corpo?: unknown; headers: Record<string, string> }
export type RespostaServico = { status: number; corpo: unknown }
export type ClienteServico = { chama(p: PedidoServico, signal?: AbortSignal): Promise<RespostaServico> }

/** Falha ao chamar um serviço. `mensagem` e `codigo` só existem para 4xx (texto que o PRÓPRIO serviço escreveu para o cliente); 5xx e falhas de rede são opacas. */
export class FalhaServico extends Error {
  constructor(readonly motivo: string, readonly status?: number, readonly codigo?: string, readonly mensagemServico?: string, readonly detalhes?: unknown) { super(motivo); this.name = 'FalhaServico' }
}

const CAMINHO_SEGURO = /^\/[A-Za-z0-9._~\-/%:@!$&'()*+,;=]*$/
function validaCaminho(c: string): void {
  if (!CAMINHO_SEGURO.test(c) || c.includes('..') || c.includes('//') || c.includes('\\') || /%2e|%2f|%5c/i.test(c)) throw new FalhaServico(`caminho inseguro: ${JSON.stringify(c).slice(0, 80)}`)
}
export function montaQuery(q: Record<string, unknown> | undefined): string {
  const p = new URLSearchParams()
  for (const [k, v] of Object.entries(q ?? {})) {
    if (v === undefined || v === null) continue
    for (const x of Array.isArray(v) ? v : [v]) {
      if (typeof x === 'object') throw new FalhaServico(`valor de query não suportado em '${k}'`)
      p.append(k, String(x))
    }
  }
  const s = p.toString(); return s ? `?${s}` : ''
}

export type OpcoesClienteHttp = { baseUrl: string; maxBytes?: number; timeoutMs?: number; fetch?: typeof fetch }
export function clienteHttp(o: OpcoesClienteHttp): ClienteServico {
  const u = new URL(o.baseUrl)
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error('baseUrl deve ser http(s)')
  if (u.username || u.password) throw new Error('baseUrl não pode ter credenciais')
  if (u.search || u.hash) throw new Error('baseUrl não pode ter query nem hash')
  const base = o.baseUrl.replace(/\/+$/, '')
  const max = o.maxBytes ?? 1024 * 1024, prazo = o.timeoutMs ?? 10_000, f = o.fetch ?? fetch
  return {
    async chama(p, signal) {
      validaCaminho(p.caminho)
      const ctl = new AbortController(); const aborta = () => ctl.abort()
      signal?.addEventListener('abort', aborta, { once: true }); if (signal?.aborted) ctl.abort()
      const timer = setTimeout(() => ctl.abort(), prazo)
      try {
        const corpo = p.corpo === undefined ? undefined : JSON.stringify(p.corpo)
        const r = await f(`${base}${p.caminho}${montaQuery(p.query)}`, { method: p.metodo, headers: { ...p.headers, ...(corpo !== undefined ? { 'content-type': 'application/json' } : {}), accept: 'application/json' }, ...(corpo !== undefined ? { body: corpo } : {}), redirect: 'manual', signal: ctl.signal })
        if (r.status >= 300 && r.status < 400) throw new FalhaServico(`o serviço respondeu com redirecionamento (${r.status}); não seguimos`, r.status)
        const declarado = Number(r.headers.get('content-length') ?? 0)
        if (declarado > max) throw new FalhaServico(`resposta de ${declarado} bytes excede o limite (${max})`, r.status)
        const reader = r.body?.getReader(); const partes: Uint8Array[] = []; let total = 0
        if (reader) for (;;) { const { done, value } = await reader.read(); if (done) break; total += value.byteLength; if (total > max) { ctl.abort(); throw new FalhaServico(`resposta excede o limite (${max} bytes)`, r.status) } partes.push(value) }
        const texto = Buffer.concat(partes).toString('utf8')
        let corpoResp: unknown
        if (texto) { try { corpoResp = JSON.parse(texto) } catch { throw new FalhaServico('o serviço devolveu algo que não é JSON', r.status) } }
        return { status: r.status, corpo: corpoResp }
      } catch (e) {
        if (e instanceof FalhaServico) throw e
        throw new FalhaServico(ctl.signal.aborted ? 'tempo esgotado ou chamada cancelada' : `falha de rede: ${(e as Error).message}`)
      } finally { clearTimeout(timer); signal?.removeEventListener('abort', aborta) }
    },
  }
}

/** Fala com um app Fastify no mesmo processo (testes e implantações monolíticas): o mesmo contrato, sem rede. */
export function clienteEmProcesso(app: { inject(o: { method: string; url: string; headers?: Record<string, string>; payload?: string }): Promise<{ statusCode: number; body: string }> }): ClienteServico & { chamadas: PedidoServico[] } {
  const chamadas: PedidoServico[] = []
  return {
    chamadas,
    async chama(p) {
      validaCaminho(p.caminho); chamadas.push(p)
      const r = await app.inject({ method: p.metodo, url: `${p.caminho}${montaQuery(p.query)}`, headers: { ...p.headers, ...(p.corpo !== undefined ? { 'content-type': 'application/json' } : {}), accept: 'application/json' }, ...(p.corpo !== undefined ? { payload: JSON.stringify(p.corpo) } : {}) })
      let corpo: unknown; if (r.body) { try { corpo = JSON.parse(r.body) } catch { throw new FalhaServico('o serviço devolveu algo que não é JSON', r.statusCode) } }
      return { status: r.statusCode, corpo }
    },
  }
}
