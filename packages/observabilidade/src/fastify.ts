import { randomUUID, timingSafeEqual } from 'node:crypto'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { serializaErro } from './redacao'
import type { Observabilidade } from './obs'
import type { Contador } from './metricas'
import type { Span } from './trace'

// A instrumentação padrão de um servidor Fastify (serviço ou gateway): span por requisição, uma linha de log, métricas HTTP, /pronto e /metrics.
// Vive aqui para que todo processo da plataforma meça e registre IGUAL (mesmos nomes, mesmas garantias de privacidade e cardinalidade).

const ID_REQUISICAO = /^[A-Za-z0-9._-]{1,64}$/
const SILENCIOSAS = new Set(['/saude', '/pronto', '/metrics'])

export type DadosObs = { t0: number; reqId: string; span: Span; rota: string }
export type ReqComObs = FastifyRequest & { obs?: DadosObs; ctx?: { tenantId: string; usuario?: string } }
export const obsDe = (req: FastifyRequest): DadosObs | undefined => (req as ReqComObs).obs

export type OpcoesFastify = {
  /** habilita GET /metrics com `Authorization: Bearer <token>` (mín. 16 caracteres, tempo constante). Sem ele a rota NÃO existe. */
  metricasToken?: string
  /** `/pronto`: lança se o processo não consegue trabalhar (p. ex. banco fora). O erro vai (redigido) para o log; o cliente vê só 503. */
  pronto?: () => Promise<void>
  /** o erro de autenticação do /metrics (para ficar no formato de erro do processo) */
  erroNaoAutenticado?: () => Error
}

/** Instala os hooks e devolve os instrumentos que o dono do processo também usa. */
export function instalaObservabilidadeFastify(app: FastifyInstance, obs: Observabilidade, o: OpcoesFastify = {}): { recusadas: Contador } {
  const { log, metricas, tracer } = obs
  if (o.metricasToken !== undefined && o.metricasToken.length < 16) throw new Error('metricasToken precisa ter ao menos 16 caracteres')
  const mReq = metricas.contador('http_requests_total', 'Requisições HTTP atendidas', ['metodo', 'rota', 'status'])
  const mDur = metricas.histograma('http_request_duration_seconds', 'Duração das requisições HTTP', ['metodo', 'rota'])
  const mVoo = metricas.gauge('http_requests_in_flight', 'Requisições em andamento')
  const recusadas = metricas.contador('http_recusadas_total', 'Requisições recusadas por autenticação ou permissão', ['status', 'codigo'])

  app.get('/pronto', async (_req: FastifyRequest, reply: FastifyReply) => {
    try { await o.pronto?.(); return { ok: true } } catch (e) { log.error('dependência indisponível', { erro: serializaErro(e) }); reply.status(503); return { ok: false } }
  })
  if (o.metricasToken !== undefined) {
    const esperado = Buffer.from(`Bearer ${o.metricasToken}`)
    app.get('/metrics', async (req: FastifyRequest, reply: FastifyReply) => {
      const a = Buffer.from(String(req.headers.authorization ?? ''))
      if (a.length !== esperado.length || !timingSafeEqual(a, esperado)) throw (o.erroNaoAutenticado?.() ?? Object.assign(new Error('autenticação necessária'), { statusCode: 401 }))
      reply.header('content-type', 'text/plain; version=0.0.4; charset=utf-8')
      return metricas.texto()
    })
  }
  // um span por requisição, aberto na forma com CALLBACK: é o que faz o contexto atravessar os hooks e o handler do Fastify
  app.addHook('onRequest', (req, reply, done) => {
    const idCliente = req.headers['x-request-id']
    const reqId = typeof idCliente === 'string' && ID_REQUISICAO.test(idCliente) ? idCliente : randomUUID() // só id bem formado é aceito
    const rota = req.routeOptions?.url ?? 'desconhecida' // o TEMPLATE, nunca a URL real: cardinalidade fixa
    const span = tracer.inicia(`${req.method} ${rota}`, { pai: tracer.extrai(req.headers.traceparent), tipo: 'servidor', atributos: { 'http.metodo': req.method, 'http.rota': rota, 'requisicao.id': reqId } })
    ;(req as ReqComObs).obs = { t0: performance.now(), reqId, span, rota }
    reply.header('x-request-id', reqId)
    mVoo.inc()
    tracer.com(span, () => done())
  })
  app.addHook('onResponse', async (req, reply) => {
    const x = (req as ReqComObs).obs; if (!x) return
    const status = reply.statusCode, seg = (performance.now() - x.t0) / 1000, ctx = (req as ReqComObs).ctx
    mVoo.dec(); mReq.inc({ metodo: req.method, rota: x.rota, status }); mDur.observa(seg, { metodo: req.method, rota: x.rota })
    x.span.define('http.status', status); if (ctx) { x.span.define('tenant', ctx.tenantId); if (ctx.usuario) x.span.define('usuario', ctx.usuario) }
    if (status >= 500) x.span.erro(`HTTP ${status}`)
    x.span.fim()
    // uma linha por requisição, SEM corpo, SEM cabeçalhos e SEM query string: só o que identifica e mede
    const nivel = SILENCIOSAS.has(x.rota) ? 'debug' : status >= 500 ? 'error' : status >= 400 ? 'warn' : 'info'
    log[nivel]('requisicao', { metodo: req.method, rota: x.rota, status, duracaoMs: Math.round(seg * 1000 * 100) / 100, requisicaoId: x.reqId, traceId: x.span.traceId, spanId: x.span.spanId, ...(ctx ? { tenantId: ctx.tenantId, ...(ctx.usuario ? { usuario: ctx.usuario } : {}) } : {}) })
  })
  return { recusadas }
}
