import type { Registry } from '@polaris/schema'
import { carregaDado, carregaDados, compilaPrograma, confereValor, type Programa } from '@polaris/engine'
import { criaObservabilidade, instalaObservabilidadeFastify, obsDe, serializaErro, type Observabilidade, type ReqComObs } from '@polaris/observabilidade'
import type { ResultadoAuth } from '@polaris/acesso'
import { esquemasHttp, rotasDe, type Campo, type Rota } from '@polaris/schema'
import Ajv from 'ajv'
import addFormats from 'ajv-formats'
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify'
import { criaChamador, indiceDeRotas, type ContextoChamada, type Servicos } from './chamador'
import { CacheDoGateway, VisaoDeCache } from './cache'
import { FalhaServico } from './cliente'
import { instalaGraphql, type OpcoesGraphql } from './graphql'
import type { InfoTenant, PreviewDeRelease, RegistrosDeTenant, ResolvedorTenant } from './tenants'
import { LimiteTaxa } from './taxa'
import { instalaPaginas, type OpcoesPaginas } from './paginas'

// ---------------------------------------------------------------------------------------------------------------------------------------------
// Gateway/BFF: a borda. Compõe os dados de uma PÁGINA (um pedido, vários serviços, em paralelo, com cache escopado), expõe o REST e o GraphQL GERADOS
// dos schemas dos serviços, e faz o que só a borda faz: autenticar o token, limitar taxa, não deixar nada do cliente escolher destino, cabeçalho ou tenant.
// Os serviços continuam decidindo permissão (o gateway repassa o Authorization): defesa em profundidade, não substituição.
// ---------------------------------------------------------------------------------------------------------------------------------------------

export class ErroGw extends Error {
  constructor(readonly status: number, readonly codigo: string, mensagem: string, readonly detalhes?: unknown, readonly extra?: Record<string, string>) { super(mensagem); this.name = 'ErroGw' }
}
const corpoErro = (e: ErroGw, requisicaoId?: string) => ({ erro: { codigo: e.codigo, mensagem: e.message, ...(e.detalhes !== undefined ? { detalhes: e.detalhes } : {}), ...(requisicaoId ? { requisicaoId } : {}) } })

export type OpcoesGateway = {
  registry: Registry
  /** extensões: rotas próprias montadas no MESMO servidor, com a autenticação do gateway (o tenant vem só do token; token inválido, tenant suspenso ou host de outro tenant = `null`). Use `app.register` para isolar hooks. */
  estende?: (app: FastifyInstance, api: { sessao(req: import('fastify').FastifyRequest): Promise<CtxGw | null> }) => void
  servicos: Servicos
  /** valida o JWT (`criaAutenticadorJwt`); sem ele só se aceita requisição sem Authorization (rotas públicas, tenant pelo host) */
  autenticador?: (cabecalho: string | undefined) => Promise<ResultadoAuth>
  /** tenant de uma requisição anônima, pelo host. `null`/`undefined` = host desconhecido (400). */
  tenantPorHost?: (host: string) => string | null | undefined
  /** o diretório de tenants: status (suspenso não opera), módulos habilitados e amarração host ↔ tenant. Se informado, SUBSTITUI `tenantPorHost`. */
  tenants?: ResolvedorTenant
  /** o registro de cada tenant (core + a release de produção dele). Sem isto, todos usam `registry`. */
  registros?: RegistrosDeTenant
  /** liga o cabeçalho `x-polaris-preview` nas páginas (BFF GET): ver a release ANTES de promover */
  preview?: PreviewDeRelease
  obs?: Observabilidade
  metricasToken?: string
  cache?: CacheDoGateway
  /** padrão: 120 fichas, reposição de 20/s. `false` desliga. */
  limiteTaxa?: { capacidade: number; porSegundo: number } | false
  graphql?: OpcoesGraphql | false
  /** serve as PÁGINAS dos tenants (GET fora de /api, /bff, /studio, /graphql): rotas declarativas + HTML em streaming + hidratação. Sem isto, só a API. */
  paginas?: OpcoesPaginas
  timeoutPadraoMs?: number
  limiteCorpoBytes?: number
}

/** Quem está chamando o gateway (já verificado). */
export type CtxGw = { registro?: Registry; releaseChave?: string; modulos?: readonly string[]; tenantId: string; usuario?: string; papeis?: string[]; authorization?: string; anonimo: boolean; chamada: ContextoChamada }
type Req = FastifyRequest & ReqComObs & { gw?: CtxGw }

const IDIOMA = /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})?$/
const NOME = /^[a-z][A-Za-z0-9]*$/
const PROTO = new Set(['__proto__', 'constructor', 'prototype'])

export type Gateway = FastifyInstance & { cache: CacheDoGateway; limpaProgramas(): void }

export function criaGateway(o: OpcoesGateway): Gateway {
  const obs = o.obs ?? criaObservabilidade({ servico: 'gateway' })
  const { log } = obs
  const app = Fastify({ bodyLimit: o.limiteCorpoBytes ?? 100 * 1024, logger: false }) as unknown as Gateway
  app.removeContentTypeParser('text/plain')
  const chamador = criaChamador(o.servicos, obs)
  const rotas = indiceDeRotas(o.servicos)
  const cache = o.cache ?? new CacheDoGateway({ maxItens: 2000 })
  const taxa = o.limiteTaxa === false ? null : new LimiteTaxa(o.limiteTaxa ?? { capacidade: 120, porSegundo: 20 })
  const mTaxa = obs.metricas.contador('gateway_limite_taxa_total', 'Requisições recusadas por limite de taxa', ['escopo'])
  const mCache = obs.metricas.contador('gateway_cache_total', 'Consultas ao cache de dados da página', ['resultado'])
  const programas = new Map<string, Programa>()
  app.cache = cache; app.limpaProgramas = () => programas.clear()

  const { recusadas } = instalaObservabilidadeFastify(app, obs, {
    ...(o.metricasToken !== undefined ? { metricasToken: o.metricasToken } : {}),
    pronto: async () => {}, erroNaoAutenticado: () => new ErroGw(401, 'nao_autenticado', 'autenticação necessária'),
  })

  // validador ESTRITO em todo o gateway: o padrão do Fastify (`removeAdditional: true`) descartaria campo desconhecido EM SILÊNCIO; aqui ele é recusado, e sem coerção de tipo
  const ajvRaiz = addFormats(new Ajv({ allErrors: true, strict: false, coerceTypes: false, useDefaults: false, removeAdditional: false }))
  app.setValidatorCompiler(({ schema }) => { const v = ajvRaiz.compile(schema as object); return (d) => (v(d) ? { value: d } : { error: Object.assign(new Error('validação'), { validation: v.errors ?? [] }) }) })

  // --- erros: formato único, com o id da requisição; nada interno para fora --------------------------------------------------------------------
  app.setErrorHandler((erro, req, reply) => {
    const rid = obsDe(req)?.reqId
    const validation = (erro as { validation?: Array<{ instancePath: string; message?: string; keyword: string; params?: Record<string, unknown> }> }).validation
    if (validation) return reply.status(400).send(corpoErro(new ErroGw(400, 'requisicao_invalida', 'a requisição não respeita o contrato', validation.map((x) => ({ caminho: x.instancePath || '/', mensagem: x.keyword === 'additionalProperties' ? `campo desconhecido '${String(x.params?.additionalProperty)}'` : x.keyword === 'required' ? `falta o campo '${String(x.params?.missingProperty)}'` : (x.message ?? 'inválido') }))), rid))
    if (erro instanceof ErroGw) { if (erro.status === 401 || erro.status === 403) recusadas.inc({ status: erro.status, codigo: erro.codigo }); for (const [k, v] of Object.entries(erro.extra ?? {})) reply.header(k, v); return reply.status(erro.status).send(corpoErro(erro, rid)) }
    const sc = (erro as { statusCode?: number }).statusCode
    if (sc && sc >= 400 && sc < 500) return reply.status(sc).send(corpoErro(new ErroGw(sc, sc === 413 ? 'corpo_grande_demais' : sc === 415 ? 'tipo_nao_suportado' : 'requisicao_invalida', sc === 413 ? 'o corpo excede o limite' : sc === 415 ? 'use application/json' : 'requisição inválida'), rid))
    log.error('erro inesperado', { erro: serializaErro(erro), requisicaoId: rid, rota: obsDe(req)?.rota })
    return reply.status(500).send(corpoErro(new ErroGw(500, 'erro_interno', 'erro interno'), rid))
  })
  app.setNotFoundHandler((req, reply) => reply.status(404).send(corpoErro(new ErroGw(404, 'rota_inexistente', 'rota inexistente'), obsDe(req)?.reqId)))
  app.addHook('onSend', async (_req, reply) => { reply.header('x-content-type-options', 'nosniff'); if (!reply.getHeader('cache-control')) reply.header('cache-control', 'private, no-store'); reply.header('vary', 'Authorization, Cookie') })
  app.get('/saude', async () => ({ ok: true, servico: 'gateway' }))

  // --- quem chama: o token é verificado AQUI; o tenant nunca vem do cliente -----------------------------------------------------------------------
  async function autentica(req: Req, opcoes: { exigeUsuario?: boolean } = {}): Promise<CtxGw> {
    if (req.gw) { if (opcoes.exigeUsuario && req.gw.anonimo) throw new ErroGw(401, 'nao_autenticado', 'autenticação necessária'); return req.gw }
    const cab = req.headers.authorization
    const base = { requisicaoId: obsDe(req)?.reqId ?? 'sem-id', hostOriginal: req.hostname, ...(IDIOMA.test(String(req.headers['accept-language'] ?? '').split(/[,;]/)[0]!.trim()) ? { idioma: String(req.headers['accept-language']).split(/[,;]/)[0]!.trim() } : {}) }
    let ctx: CtxGw
    const exigeAtivo = (t: InfoTenant): InfoTenant => {
      if (t.status === 'ativo') return t
      if (t.status === 'suspenso') throw new ErroGw(403, 'tenant_suspenso', 'esta conta está suspensa')
      if (t.status === 'cancelado') throw new ErroGw(410, 'tenant_encerrado', 'esta conta foi encerrada')
      throw new ErroGw(503, 'tenant_indisponivel', 'esta conta ainda não está disponível', undefined, { 'retry-after': '30' })
    }
    if (cab !== undefined) { // token presente e inválido é SEMPRE 401: nunca cai em anônimo por engano
      const h = Array.isArray(cab) ? cab[0]! : cab
      const r = o.autenticador ? await o.autenticador(h) : ({ ok: false, motivo: 'sem autenticador' } as const)
      if (!r.ok) throw new ErroGw(401, 'credencial_invalida', 'credencial inválida')
      let modulos: readonly string[] | undefined, registro: Registry | undefined, releaseChave: string | undefined
      if (o.tenants) {
        const t = await o.tenants.porId(r.contexto.tenantId)
        if (!t) throw new ErroGw(403, 'tenant_desconhecido', 'a conta deste token não existe')
        exigeAtivo(t); modulos = t.modulos
        if (o.registros) { registro = await o.registros.producao(t.id, t.release ?? null); releaseChave = `p${t.release ?? 'base'}` }
        // o token de um tenant NÃO vale na vitrine de outro: host de tenant com tenant diferente do token é recusado (host genérico da plataforma não tem dono e passa)
        const doHost = await o.tenants.porHost(req.hostname)
        if (doHost && doHost.id !== t.id) throw new ErroGw(403, 'tenant_divergente', 'este endereço pertence a outra conta')
      }
      ctx = { tenantId: r.contexto.tenantId, usuario: r.contexto.usuario, papeis: r.contexto.papeis, authorization: h, anonimo: false, chamada: { ...base, authorization: h, ...(modulos ? { modulos } : {}) }, ...(modulos ? { modulos } : {}), ...(registro ? { registro, releaseChave: releaseChave! } : {}) }
    } else if (o.tenants) {
      const t = await o.tenants.porHost(req.hostname)
      if (!t) throw new ErroGw(400, 'tenant_nao_resolvido', 'não foi possível resolver o tenant desta requisição')
      exigeAtivo(t)
      const registro = o.registros ? await o.registros.producao(t.id, t.release ?? null) : undefined
      ctx = { tenantId: t.id, anonimo: true, chamada: { ...base, modulos: t.modulos }, modulos: t.modulos, ...(registro ? { registro, releaseChave: `p${t.release ?? 'base'}` } : {}) }
    } else {
      const t = o.tenantPorHost?.(req.hostname)
      if (!t) throw new ErroGw(400, 'tenant_nao_resolvido', 'não foi possível resolver o tenant desta requisição')
      ctx = { tenantId: t, anonimo: true, chamada: base }
    }
    ;(req as Req).ctx = { tenantId: ctx.tenantId, ...(ctx.usuario ? { usuario: ctx.usuario } : {}) }
    if (opcoes.exigeUsuario && ctx.anonimo) throw new ErroGw(401, 'nao_autenticado', 'autenticação necessária')
    req.gw = ctx
    return ctx
  }
  function limita(req: Req, ctx: CtxGw, custo = 1): void {
    if (!taxa) return
    const chave = ctx.anonimo ? `ip|${ctx.tenantId}|${req.ip}` : `u|${ctx.tenantId}|${ctx.usuario}` // por usuário (token), ou por IP+tenant se anônimo
    const r = taxa.tenta(chave, custo)
    if (!r.ok) { mTaxa.inc({ escopo: ctx.anonimo ? 'anonimo' : 'usuario' }); throw new ErroGw(429, 'muitas_requisicoes', 'limite de requisições excedido', undefined, { 'retry-after': String(r.esperaSeg) }) }
  }
  const entra = async (req: FastifyRequest, opc: { exigeUsuario?: boolean; custo?: number } = {}) => { const c = await autentica(req as Req, opc); limita(req as Req, c, opc.custo); return c }

  // --- BFF de página -----------------------------------------------------------------------------------------------------------------------------
  const contextoRegistry = (tenantId: string) => ({ tenantId })
  function programaDe(ctx: CtxGw, id: string): { programa: Programa; params: Record<string, Campo>; obrigatorios: Set<string> } {
    if (!NOME.test(id) && !/^[A-Za-z0-9._-]{1,100}$/.test(id)) throw new ErroGw(404, 'pagina_inexistente', 'página inexistente')
    const reg = ctx.registro ?? o.registry
    const r = reg.resolve('pagina', id, contextoRegistry(ctx.tenantId))
    if (!r) throw new ErroGw(404, 'pagina_inexistente', 'página inexistente') // inexistente OU de outro tenant: indistinguível
    const chave = `${ctx.tenantId}|${ctx.releaseChave ?? 'unico'}|${id}|${r.no.versao}`
    let p = programas.get(chave)
    if (!p) {
      const c = compilaPrograma(reg, r.no, contextoRegistry(ctx.tenantId))
      if (!c.ok) { log.error('página não compila', { pagina: id, erros: c.erros.length, primeiro: c.erros[0]?.mensagem }); throw new ErroGw(500, 'pagina_invalida', 'a página tem erros e não pode ser carregada') }
      p = c.programa; programas.set(chave, p)
      while (programas.size > 500) programas.delete(programas.keys().next().value as string)
    }
    // um parâmetro de página é OBRIGATÓRIO quando aparece como `:nome` na rota da página
    const obrigatorios = new Set([...String((r.no.spec as { rota?: string }).rota ?? '').matchAll(/:([A-Za-z][A-Za-z0-9]*)/g)].map((m) => m[1]!))
    return { programa: p, params: ((r.no.spec as { params?: Record<string, Campo> }).params ?? {}), obrigatorios }
  }
  /** `p.<nome>` = parâmetro de rota (tipado pelo `spec.params` da página); `q.<nome>` = consulta (texto livre, limitado). Qualquer outra chave é recusada. */
  function leQuery(query: Record<string, unknown>, declarados: Record<string, Campo>, obrigatorios: Set<string>) {
    const params: Record<string, unknown> = Object.create(null), consulta: Record<string, unknown> = Object.create(null)
    const chaves = Object.keys(query)
    if (chaves.length > 50) throw new ErroGw(400, 'requisicao_invalida', 'parâmetros demais')
    for (const k of chaves) {
      const m = /^([pq])\.([A-Za-z][A-Za-z0-9]*)$/.exec(k)
      if (!m || PROTO.has(m[2]!)) throw new ErroGw(400, 'parametro_desconhecido', `parâmetro '${k.slice(0, 40)}' não é aceito (use p.<nome> ou q.<nome>)`)
      const bruto = query[k]
      if (m[1] === 'q') { const v = Array.isArray(bruto) ? bruto : [bruto]; if (v.some((x) => typeof x !== 'string' || x.length > 500)) throw new ErroGw(400, 'requisicao_invalida', `consulta '${m[2]}' inválida`); consulta[m[2]!] = Array.isArray(bruto) ? v : v[0]; continue }
      const decl = Object.hasOwn(declarados, m[2]!) ? declarados[m[2]!] : undefined
      if (!decl) throw new ErroGw(400, 'parametro_desconhecido', `a página não declara o parâmetro '${m[2]}'`)
      const r = confereValor(decl, bruto)
      if (!r.ok) throw new ErroGw(400, 'parametro_invalido', `parâmetro '${m[2]}' inválido (esperado ${r.esperado})`)
      params[m[2]!] = r.valor
    }
    for (const n of Object.keys(declarados)) if (obrigatorios.has(n) && !(n in params)) throw new ErroGw(400, 'parametro_invalido', `falta o parâmetro '${n}'`)
    return { params, consulta }
  }
  const publicaDaFonte = (programa: Programa) => (fonteId: string): boolean => {
    const f = programa.pagina.fontes[fonteId]?.fonte
    if (!f) return false
    if (f.tipo === 'estatico') return true
    if (f.tipo !== 'servico') return false
    return rotas.get(`${f.servico}\u0000${f.operacao}`)?.permissao === 'publica'
  }
  const opcoesCarga = (ctx: CtxGw, programa: Programa, req: FastifyRequest, extra: { params?: Record<string, unknown>; consulta?: Record<string, unknown>; estado?: Record<string, unknown> }, falhas?: unknown[]) => {
    const visao = new VisaoDeCache(cache, { tenantId: ctx.tenantId, ...(ctx.usuario ? { usuario: ctx.usuario } : {}), ...(ctx.papeis ? { papeis: ctx.papeis } : {}) }, publicaDaFonte(programa), (hit) => mCache.inc({ resultado: hit ? 'hit' : 'miss' }))
    return {
      provedores: { servico: async (p: { servico: string; operacao: string; args: Record<string, unknown>; signal: AbortSignal }) => (await chamador(p.servico, p.operacao, p.args, ctx.chamada, p.signal)).corpo },
      params: extra.params ?? {}, consulta: extra.consulta ?? {}, estado: extra.estado ?? {},
      tenant: { id: ctx.tenantId }, ...(ctx.chamada.idioma ? { idioma: ctx.chamada.idioma } : {}), cache: visao,
      timeoutPadraoMs: o.timeoutPadraoMs ?? 10_000,
      onErro: (e: { dados: string; fonte: string; erro: unknown }) => { falhas?.push(e.erro); log.warn('falha ao carregar dado da página', { dados: e.dados, fonte: e.fonte, requisicaoId: obsDe(req)?.reqId, erro: serializaErro(e.erro) }) },
    }
  }

  app.get('/bff/paginas/:id', async (req, reply) => {
    let ctx = await entra(req)
    const pv = req.headers['x-polaris-preview']
    if (pv !== undefined) { // ver uma release ANTES de promover: link assinado, de um tenant, de uma release; nunca vale para outro tenant nem para mutação
      if (!o.preview) throw new ErroGw(400, 'preview_indisponivel', 'a pré-visualização não está habilitada')
      const v = typeof pv === 'string' && pv.length <= 2048 ? o.preview.verifica(pv) : null
      if (!v) throw new ErroGw(401, 'preview_invalido', 'o link de pré-visualização é inválido ou expirou')
      if (v.tenantId !== ctx.tenantId) throw new ErroGw(403, 'preview_de_outra_conta', 'este link de pré-visualização é de outra conta')
      const reg = await o.preview.registro(v.tenantId, v.release)
      if (!reg) throw new ErroGw(404, 'release_inexistente', 'a release não existe')
      ctx = { ...ctx, registro: reg, releaseChave: `v${v.release}` }
    }
    const { id } = req.params as { id: string }
    const { programa, params: declarados, obrigatorios } = programaDe(ctx, id)
    const { params, consulta } = leQuery(req.query as Record<string, unknown>, declarados, obrigatorios)
    const r = await carregaDados(programa, opcoesCarga(ctx, programa, req, { params, consulta }))
    void reply
    return { pagina: id, versao: programa.pagina.versao, dados: r.dados, status: r.status, erros: r.erros }
  })

  const ESTADO_MAX = 50 * 1024
  const corpoExecutar = { type: 'object', required: ['pagina', 'dados'], additionalProperties: false, properties: { pagina: { type: 'string', maxLength: 100 }, dados: { type: 'string', pattern: '^[a-z][A-Za-z0-9]*$', maxLength: 64 }, args: { type: 'object' }, estado: { type: 'object' }, params: { type: 'object' }, consulta: { type: 'object' } } }
  app.post('/bff/executar', { schema: { body: corpoExecutar } }, async (req, reply) => {
    const ctx = await entra(req, { exigeUsuario: true }) // ações (mutações) exigem usuário autenticado; o token vem em cabeçalho, nunca em cookie: não há CSRF a mitigar
    const b = req.body as { pagina: string; dados: string; args?: Record<string, unknown>; estado?: Record<string, unknown>; params?: Record<string, unknown>; consulta?: Record<string, unknown> }
    if (JSON.stringify([b.estado ?? {}, b.args ?? {}, b.params ?? {}, b.consulta ?? {}]).length > ESTADO_MAX) throw new ErroGw(413, 'corpo_grande_demais', 'estado e argumentos excedem o limite')
    const { programa, params: declarados, obrigatorios } = programaDe(ctx, b.pagina)
    if (!Object.hasOwn(programa.pagina.dados, b.dados)) throw new ErroGw(404, 'dado_inexistente', 'a página não declara esse dado')
    // `params`/`consulta` do corpo passam pela MESMA conferência de tipos da rota GET
    const p = leQuery(Object.fromEntries([...Object.entries(b.params ?? {}).map(([k, v]) => [`p.${k}`, v]), ...Object.entries(b.consulta ?? {}).map(([k, v]) => [`q.${k}`, v])]), declarados, obrigatorios)
    const falhas: unknown[] = []
    const r = await carregaDado(programa, b.dados, opcoesCarga(ctx, programa, req, { params: p.params, consulta: p.consulta, estado: b.estado ?? {} }, falhas), b.args ?? {})
    if (r.ok) return { valor: r.valor }
    // o carregador devolve texto opaco; a CAUSA (que ele passa ao onErro) diz se foi o serviço que recusou (4xx: o texto é do serviço) ou falha nossa
    const causa = falhas[0]; if (causa instanceof FalhaServico && causa.status !== undefined && causa.status >= 400 && causa.status < 500) throw traduz(causa)
    const status = r.erro.startsWith('argumentos inválidos') ? 400 : r.erro.startsWith('tempo esgotado') ? 504 : 502
    void reply
    throw new ErroGw(status, status === 400 ? 'argumentos_invalidos' : status === 504 ? 'tempo_esgotado' : 'servico_indisponivel', r.erro)
  })

  // --- REST gerado dos schemas dos serviços ------------------------------------------------------------------------------------------------------
  const ajvCorpo = addFormats(new Ajv({ allErrors: true, strict: false, coerceTypes: false, useDefaults: false, removeAdditional: false }))
  const ajvQuery = addFormats(new Ajv({ allErrors: true, strict: false, coerceTypes: true, useDefaults: false, removeAdditional: false }))
  const compila = (parte: string) => ({ schema, httpPart }: { schema: unknown; httpPart?: string }) => { const v = (httpPart === 'querystring' ? ajvQuery : ajvCorpo).compile(schema as object); void parte; return (d: unknown) => (v(d) ? { value: d } : { error: Object.assign(new Error('validação'), { validation: v.errors ?? [] }) }) }
  // o escopo de validação do REST gerado é um plugin: assim o compilador de validação não afeta o BFF e o GraphQL
  app.register(async (rest) => {
    rest.setValidatorCompiler(compila('rest') as never)
    for (const [servicoId, cfg] of Object.entries(o.servicos)) {
      for (const r of rotasDe(cfg.no)) rest.route({
        method: r.metodo.toUpperCase() as 'GET', url: `/api/${servicoId}${r.caminhoFastify}`, schema: esquemasHttp(r) as Record<string, unknown>,
        handler: async (req, reply) => repassa(servicoId, r, req, reply),
      })
    }
  })
  async function repassa(servico: string, r: Rota, req: FastifyRequest, reply: FastifyReply) {
    const publica = r.permissao === 'publica'
    const ctx = await entra(req, publica ? {} : { exigeUsuario: true }) // rota não pública: sem usuário, 401 AQUI, sem incomodar o serviço
    const emQuery = r.metodo === 'get' || r.metodo === 'delete'
    const args = { ...((req.params as Record<string, unknown>) ?? {}), ...((emQuery ? req.query : req.body) as Record<string, unknown> ?? {}) }
    try {
      const resp = await chamador(servico, r.id, args, ctx.chamada)
      reply.status(resp.status)
      if (resp.status === 204) return reply.send()
      return resp.corpo
    } catch (e) { throw traduz(e) }
  }

  // --- GraphQL gerado -----------------------------------------------------------------------------------------------------------------------------
  if (o.graphql !== false) instalaGraphql(app, { servicos: o.servicos, chamador, entra: (req, c) => entra(req, c), obs, traduz, opcoes: o.graphql ?? {}, cobraTaxa: (req, ctx, custo) => limita(req as Req, ctx, custo), cache, publicaDaFonte })
  if (o.paginas) instalaPaginas(app, o.paginas, { entra, programaDe: (c, id) => programaDe(c, id), opcoesCarga: (c, p, r, e, f) => opcoesCarga(c, p, r, e, f), registroDe: (c, f) => c.registro ?? f, registro: o.registry, log })
  o.estende?.(app, { sessao: async (req) => { try { const c = await autentica(req as Req); return c.anonimo ? null : c } catch { return null } } })
  return app
}

/** Falha do serviço → erro do gateway: 4xx do serviço passa (o texto é do serviço, escrito para o cliente); o resto é opaco e vira 502/504. */
export function traduz(e: unknown): ErroGw {
  if (e instanceof ErroGw) return e
  if (e instanceof FalhaServico) {
    if (e.status !== undefined && e.status >= 400 && e.status < 500) return new ErroGw(e.status, e.codigo ?? 'recusado', e.mensagemServico ?? 'requisição recusada pelo serviço')
    if (/tempo esgotado/.test(e.motivo)) return new ErroGw(504, 'tempo_esgotado', 'o serviço demorou demais')
    return new ErroGw(502, 'servico_indisponivel', 'o serviço não conseguiu atender agora')
  }
  return new ErroGw(500, 'erro_interno', 'erro interno')
}
