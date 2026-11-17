import { FUNCOES_PADRAO } from '../expr/index'
import type { Programa } from '../render/programa'
import { valorDe } from '../render/valor'
import { parseTemplate } from '../template'
import type { FonteDados, Valor } from '../ir/tipos'
import { resolveArgs } from './args'
import type { CacheDados } from './cache'

// ---------------------------------------------------------------------------
// Carregador de dados: resolve as fontes declaradas em spec.dados do Programa.
// Isomórfico: o servidor usa para o SSR; o cliente usa (com provedores baseados em fetch) para `executar`.
// Nunca lança por falha de fonte: devolve status/erros por variável. A mensagem de erro entregue é opaca
// (não vaza detalhe do provedor para o HTML); o detalhe vai para `onErro` (log do servidor).
// ---------------------------------------------------------------------------

export type PedidoServico = { servico: string; operacao: string; args: Record<string, unknown>; tenant: Record<string, unknown>; signal: AbortSignal }
export type PedidoHttp = { url: string; args: Record<string, unknown>; tenant: Record<string, unknown>; signal: AbortSignal }
export type Provedores = {
  servico?: (p: PedidoServico) => Promise<unknown>
  /** quem implementa decide a allowlist de hosts (SSRF): o runtime nunca faz fetch por conta própria */
  http?: (p: PedidoHttp) => Promise<unknown>
}

export type StatusDado = 'ok' | 'carregando' | 'erro'
export type ResultadoDados = { dados: Record<string, unknown>; status: Record<string, StatusDado>; erros: Record<string, string> }

export type OpcoesCarga = {
  provedores: Provedores
  params?: Record<string, unknown>
  consulta?: Record<string, unknown>
  tenant?: Record<string, unknown>
  estado?: Record<string, unknown>
  cache?: CacheDados
  /** padrão 10000 */
  timeoutPadraoMs?: number
  signal?: AbortSignal
  /** detalhe do erro de provedor, para log (não vai para o cliente) */
  onErro?: (e: { dados: string; fonte: string; erro: unknown }) => void
}

type Falha = { ok: false; erro: string }
export type ResultadoUm = { ok: true; valor: unknown } | Falha

const tenantChave = (t: Record<string, unknown> | undefined) => String(t?.id ?? t?.alias ?? '')
const ordenado = (o: Record<string, unknown>) => Object.fromEntries(Object.keys(o).sort().map((k) => [k, o[k]]))

function chaveCache(fonte: FonteDados, args: Record<string, unknown>, escopo: Record<string, unknown>): string | undefined {
  const ttl = fonte.cache?.ttlSegundos
  if (!ttl || ttl <= 0) return undefined
  let complemento: unknown = ordenado(args)
  if (fonte.cache?.chave) {
    try {
      const t = parseTemplate(fonte.cache.chave)
      const v: Valor = t.t === 'lit' ? { t: 'lit', v: t.v } : t.t === 'expr' ? { t: 'expr', ast: t.ast, fonte: t.fonte } : { t: 'tpl', partes: t.partes.map((p) => (typeof p === 'string' ? p : { ast: p.ast, fonte: p.fonte })) }
      complemento = valorDe(v, { ...escopo, args }, FUNCOES_PADRAO)
    } catch { return undefined } // chave inválida: sem cache (nunca arriscar compartilhar errado)
  }
  // o tenant sempre entra: um tenant nunca lê o cache de outro
  return JSON.stringify([tenantChave(escopo.tenant as Record<string, unknown>), fonte.id, complemento])
}

function comTimeout<T>(f: (signal: AbortSignal) => Promise<T>, ms: number, externo?: AbortSignal): Promise<T> {
  const ctl = new AbortController()
  const aoExterno = () => ctl.abort()
  externo?.addEventListener('abort', aoExterno, { once: true })
  if (externo?.aborted) ctl.abort()
  let timer: ReturnType<typeof setTimeout> | undefined
  const limite = new Promise<never>((_, rej) => { timer = setTimeout(() => { ctl.abort(); rej(new Error(`TEMPO_ESGOTADO:${ms}`)) }, ms) })
  return Promise.race([f(ctl.signal), limite]).finally(() => { clearTimeout(timer); externo?.removeEventListener('abort', aoExterno) })
}

/** Carrega UMA variável de dados da página. `extras` (já avaliados) se somam/substituem os args declarados. */
export async function carregaDado(programa: Programa, nome: string, op: OpcoesCarga, extras: Record<string, unknown> = {}): Promise<ResultadoUm> {
  const decl = programa.pagina.dados[nome]
  if (!decl) return { ok: false, erro: `variável de dados '${nome}' não declarada` }
  const fonte = programa.pagina.fontes[decl.id]
  if (!fonte) return { ok: false, erro: `fonte '${decl.id}' ausente no programa` }
  const escopo = { params: op.params ?? {}, consulta: op.consulta ?? {}, tenant: op.tenant ?? {}, estado: op.estado ?? {} }

  const brutos: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(decl.args)) brutos[k] = valorDe(v, escopo, FUNCOES_PADRAO)
  Object.assign(brutos, extras)
  const r = resolveArgs(fonte.parametros, brutos)
  if (!r.ok) return { ok: false, erro: `argumentos inválidos: ${r.erros.map((e) => e.mensagem).join('; ')}` }

  const executa = async (): Promise<unknown> => {
    const f = fonte.fonte
    if (f.tipo === 'estatico') return structuredClone(f.valor)
    if (f.tipo === 'servico') {
      const prov = op.provedores.servico
      if (!prov) throw new Error('SEM_PROVEDOR:servico')
      return comTimeout((signal) => prov({ servico: f.servico!, operacao: f.operacao!, args: r.args, tenant: escopo.tenant, signal }), fonte.timeoutMs ?? op.timeoutPadraoMs ?? 10000, op.signal)
    }
    const prov = op.provedores.http
    if (!prov) throw new Error('SEM_PROVEDOR:http')
    return comTimeout((signal) => prov({ url: f.url!, args: r.args, tenant: escopo.tenant, signal }), fonte.timeoutMs ?? op.timeoutPadraoMs ?? 10000, op.signal)
  }

  try {
    const chave = op.cache ? chaveCache(fonte, r.args, escopo) : undefined
    if (op.cache && chave) {
      const hit = op.cache.get(chave)
      if (hit) return { ok: true, valor: hit.valor }
      const valor = await op.cache.unico(chave, async () => {
        const v = await executa()
        op.cache!.set(chave, v, fonte.cache!.ttlSegundos!)
        return v
      })
      return { ok: true, valor: structuredClone(valor) }
    }
    return { ok: true, valor: await executa() }
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    op.onErro?.({ dados: nome, fonte: fonte.id, erro: e })
    if (msg.startsWith('TEMPO_ESGOTADO:')) return { ok: false, erro: `tempo esgotado (${msg.split(':')[1]} ms)` }
    if (msg.startsWith('SEM_PROVEDOR:')) return { ok: false, erro: `não há provedor configurado para fontes do tipo '${msg.split(':')[1]}'` }
    return { ok: false, erro: 'falha ao carregar os dados' } // opaco: o detalhe vai só para onErro
  }
}

/** Carrega, em paralelo, todas as variáveis `auto` (ou as de `nomes`). Nunca lança. */
export async function carregaDados(programa: Programa, op: OpcoesCarga, nomes?: string[]): Promise<ResultadoDados> {
  const alvo = nomes ?? Object.keys(programa.pagina.dados).filter((n) => programa.pagina.fontes[programa.pagina.dados[n]!.id]?.carregar !== 'manual')
  const saida: ResultadoDados = { dados: {}, status: {}, erros: {} }
  const resultados = await Promise.all(alvo.map(async (n) => [n, await carregaDado(programa, n, op)] as const))
  for (const [n, r] of resultados) {
    if (r.ok) { saida.dados[n] = r.valor; saida.status[n] = 'ok' } else { saida.status[n] = 'erro'; saida.erros[n] = r.erro }
  }
  return saida
}


/**
 * Carregador para a ação `executar` no cliente: usa o mesmo pipeline do servidor (args tipados, cache, timeout).
 * `base` traz os provedores (no cliente, tipicamente fetch ao gateway) e o contexto fixo (params, consulta, tenant).
 */
export function criaCarregador(programa: Programa, base: OpcoesCarga): (req: { dados: string; args: Record<string, unknown>; estado: Record<string, unknown> }) => Promise<unknown> {
  return async ({ dados, args, estado }) => {
    const r = await carregaDado(programa, dados, { ...base, estado }, args)
    if (!r.ok) throw new Error(r.erro)
    return r.valor
  }
}

export type CargasIniciadas = {
  /** variáveis que bloqueiam o primeiro byte (auto e não-stream): resolvidas por `bloqueantes` */
  bloqueantes: Promise<ResultadoDados>
  /** variáveis em streaming: já em andamento, resolvem quando chegarem; NUNCA rejeitam */
  stream: Record<string, Promise<ResultadoUm>>
}

/**
 * Inicia TODAS as cargas automáticas imediatamente (em paralelo). As bloqueantes são agregadas numa promessa;
 * as em streaming ficam soltas para o renderizador consumir quando o Suspense pedir.
 */
export function iniciaCargas(programa: Programa, op: OpcoesCarga): CargasIniciadas {
  const { dados, fontes } = programa.pagina
  const auto = Object.keys(dados).filter((n) => fontes[dados[n]!.id]?.carregar !== 'manual')
  const stream: Record<string, Promise<ResultadoUm>> = {}
  const bloqueantes: string[] = []
  for (const n of auto) {
    if (dados[n]!.stream) stream[n] = carregaDado(programa, n, op)
    else bloqueantes.push(n)
  }
  return { bloqueantes: carregaDados(programa, op, bloqueantes), stream }
}
