import type { Observabilidade } from '@polaris/observabilidade'
import { rotasDe, type No, type Rota } from '@polaris/schema'
import { FalhaServico, type ClienteServico } from './cliente'

export type ServicoConfig = { no: No; cliente: ClienteServico }
export type Servicos = Record<string, ServicoConfig>

/** O que da requisição de fora acompanha a chamada ao serviço. Lista FECHADA: cookie, host e `x-tenant-id` nunca passam. */
export type ContextoChamada = {
  authorization?: string
  requisicaoId: string
  /** o host que o cliente usou (para rotas públicas: o serviço resolve o tenant por ele). Só segue se o gateway é a única porta de entrada dos serviços. */
  hostOriginal?: string
  idioma?: string
  /** serviços habilitados para o tenant desta requisição. Se informado, é a ÚNICA porta de checagem: serviço fora da lista é 404 para qualquer caminho (REST, BFF, GraphQL) */
  modulos?: readonly string[]
}

const SEM_CORPO = new Set(['get', 'delete'])

/** `servico.operacao` → rota (do schema). Só o que o schema declara é chamável. */
export function indiceDeRotas(servicos: Servicos): Map<string, Rota> {
  const m = new Map<string, Rota>()
  for (const [id, s] of Object.entries(servicos)) for (const r of rotasDe(s.no)) m.set(`${id}\u0000${r.id}`, r)
  return m
}

export type ChamadorCompleto = (servico: string, operacao: string, args: Record<string, unknown>, ctx: ContextoChamada, signal?: AbortSignal) => Promise<{ status: number; corpo: unknown }>
export type Chamador = (servico: string, operacao: string, args: Record<string, unknown>, ctx: ContextoChamada, signal?: AbortSignal) => Promise<unknown>

/**
 * Chama uma operação de um serviço. O destino vem da configuração, o caminho do schema, e `args` é conferido contra a ENTRADA declarada da rota:
 * argumento desconhecido é erro (nada de contrabandear campo pelo gateway). A chamada leva `traceparent` de um span filho.
 */
export function criaChamador(servicos: Servicos, obs?: Observabilidade): ChamadorCompleto {
  const rotas = indiceDeRotas(servicos)
  const contagem = obs?.metricas.contador('gateway_chamadas_servico_total', 'Chamadas do gateway aos serviços', ['servico', 'resultado'])
  const duracao = obs?.metricas.histograma('gateway_chamada_servico_duracao_segundos', 'Duração das chamadas aos serviços', ['servico'])
  return async (servico, operacao, args, ctx, signal) => {
    const rota = rotas.get(`${servico}\u0000${operacao}`)
    if (!rota) throw new FalhaServico(`operação desconhecida: ${servico}.${operacao}`)
    if (ctx.modulos && !ctx.modulos.includes(servico)) throw new FalhaServico(`módulo não habilitado: ${servico}`, 404, 'modulo_nao_habilitado', 'este recurso não está habilitado para a sua conta')
    const cfg = servicos[servico]!
    const params: Record<string, string> = {}
    const resto: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(args)) {
      if (rota.params.includes(k)) { if (typeof v !== 'string') throw new FalhaServico(`parâmetro de caminho '${k}' deve ser texto`); params[k] = v; continue }
      if (!(k in rota.entrada) && !(rota.lista && (k === 'pagina' || k === 'limite'))) throw new FalhaServico(`argumento '${k}' não existe na operação ${servico}.${operacao}`)
      if (v !== undefined) resto[k] = v
    }
    for (const p of rota.params) if (!(p in params)) throw new FalhaServico(`falta o parâmetro de caminho '${p}'`)
    const caminho = rota.caminhoFastify.replace(/:([A-Za-z][A-Za-z0-9]*)/g, (_m, n: string) => encodeURIComponent(params[n]!))
    const t0 = performance.now()
    const executa = async (traceparent?: string) => {
      const headers: Record<string, string> = { 'x-request-id': ctx.requisicaoId }
      if (ctx.authorization) headers.authorization = ctx.authorization
      if (ctx.hostOriginal) headers['x-forwarded-host'] = ctx.hostOriginal
      if (ctx.idioma) headers['accept-language'] = ctx.idioma
      if (traceparent) headers.traceparent = traceparent
      const emQuery = SEM_CORPO.has(rota.metodo)
      return cfg.cliente.chama({ metodo: rota.metodo.toUpperCase(), caminho, ...(emQuery ? { query: resto } : Object.keys(resto).length ? { corpo: resto } : {}), headers }, signal)
    }
    let resultado = 'ok'
    try {
      const r = await (obs ? obs.tracer.emSpan('servico.chama', { tipo: 'cliente', atributos: { servico, operacao } }, (s) => executa(s.traceparent())) : executa())
      if (r.status >= 200 && r.status < 300) return { status: r.status, corpo: r.status === 204 ? null : (r.corpo ?? null) }
      const erro = (r.corpo as { erro?: { codigo?: unknown; mensagem?: unknown; detalhes?: unknown } } | undefined)?.erro
      resultado = r.status >= 500 ? '5xx' : '4xx'
      // só o 4xx carrega o texto do serviço (escrito para o cliente); 5xx fica opaco
      throw new FalhaServico(`o serviço respondeu ${r.status}`, r.status, typeof erro?.codigo === 'string' ? erro.codigo : undefined, r.status < 500 && typeof erro?.mensagem === 'string' ? erro.mensagem : undefined, r.status < 500 ? erro?.detalhes : undefined)
    } catch (e) {
      if (resultado === 'ok') resultado = 'erro'
      throw e
    } finally { contagem?.inc({ servico, resultado }); duracao?.observa((performance.now() - t0) / 1000, { servico }) }
  }
}
