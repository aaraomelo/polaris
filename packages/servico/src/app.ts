import Ajv from 'ajv'
import addFormats from 'ajv-formats'
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify'
import { codigoSucesso, esquemaDeEntidade, esquemasHttp, rotasDe, snake, type Campo, type No, type Rota } from '@polaris/schema'
import { aSql, avalia, camposPermitidos, permite, resolve, type Regra, type Resolvido, type Tipos } from '@polaris/acesso'
import { criaPublicador } from '@polaris/eventos'
import { criaObservabilidade, instalaObservabilidadeFastify, serializaErro, type ReqComObs } from '@polaris/observabilidade'
import { condicaoDeBusca } from './busca'
import { ErroApi, corpoErro, erroDoBanco } from './erros'
import { colunas, ident, linhaParaApi, nomesDeCampos, tabela, tiposDe, type Ent } from './sql'
import type { Contexto, OpcoesServico } from './tipos'

// ---------------------------------------------------------------------------------------------------------------------------------------------
// Serviço HTTP (Fastify) montado a partir do schema (kind `servico`). As rotas e os esquemas vêm de `rotasDe`/`esquemaDoCampo` (os mesmos do OpenAPI).
// Garantias:
//  - o tenant vem SÓ da autenticação; o corpo/query nunca o carregam (campo desconhecido é REJEITADO, não ignorado);
//  - a autenticação vem ANTES da validação (um anônimo não aprende o formato da API pelos erros);
//  - o corpo é validado sem coerção de tipos ("49.9" vs 49.9 em dinheiro importa); a query é coagida (tudo chega como texto);
//  - todo acesso ao banco roda numa transação com `app.tenant_id` fixado: a RLS é a última barreira; um id de outro tenant é "não encontrado";
//  - SQL só com identificadores do schema e valores por parâmetro; a resposta é filtrada pelo esquema de saída (nada vaza por SELECT largo);
//  - erro inesperado → 500 genérico (o cliente nunca vê mensagem interna).
// ---------------------------------------------------------------------------------------------------------------------------------------------

type Spec = { entidades: Record<string, Ent & { campos: Record<string, Campo> }> }
/** a decisão de acesso desta requisição (só nas rotas `protegida`) */
type Acesso = { regras: Regra[]; v: { usuario?: string; tenant: string }; resolvido: Resolvido }
type Requisicao = FastifyRequest & ReqComObs & { ctx?: Contexto; acesso?: Acesso }


export function criaServico(no: No, o: OpcoesServico): FastifyInstance {
  const spec = no.spec as Spec
  const rotas = rotasDe(no)
  // observabilidade INJETADA: logs estruturados, métricas e traces sem o autor do serviço escrever nada
  const obs = o.obs ?? criaObservabilidade({ servico: no.id, versao: no.versao })
  const { log, metricas, tracer } = obs
  const mDb = metricas.contador('db_transacoes_total', 'Transações no banco, por resultado', ['resultado'])
  const mDbDur = metricas.histograma('db_transacao_duracao_segundos', 'Duração das transações no banco', ['resultado'])
  const mEv = metricas.contador('eventos_publicados_total', 'Eventos gravados no outbox', ['evento'])
  const app = Fastify({ bodyLimit: o.limiteCorpoBytes ?? 100 * 1024, logger: false })
  app.removeContentTypeParser('text/plain') // só JSON: qualquer outro tipo de conteúdo é 415

  // validadores: corpo e params SEM coerção; query COM coerção (e valores padrão de paginação)
  const novoAjv = (coerce: boolean) => addFormats(new Ajv({ allErrors: true, strict: false, coerceTypes: coerce, useDefaults: coerce, removeAdditional: false }))
  const ajvCorpo = novoAjv(false), ajvQuery = novoAjv(true)
  app.setValidatorCompiler(({ schema, httpPart }) => {
    const v = (httpPart === 'querystring' ? ajvQuery : ajvCorpo).compile(schema as object)
    return (dados) => (v(dados) ? { value: dados } : { error: Object.assign(new Error('validação'), { validation: v.errors ?? [], validationContext: httpPart }) })
  })

  app.setErrorHandler((erro, req, reply) => {
    const rid = (req as Requisicao).obs?.reqId
    const validation = (erro as { validation?: Array<{ instancePath: string; message?: string; keyword: string; params?: Record<string, unknown> }> }).validation
    if (validation) {
      const detalhes = validation.map((x) => ({ caminho: x.instancePath || '/', mensagem: mensagemValidacao(x) }))
      return reply.status(400).send(corpoErro(new ErroApi(400, 'requisicao_invalida', 'a requisição não respeita o contrato', detalhes), rid))
    }
    if (erro instanceof ErroApi) { if (erro.status === 401 || erro.status === 403) mNeg.inc({ status: erro.status, codigo: erro.codigo }); return reply.status(erro.status).send(corpoErro(erro, rid)) }
    const status = (erro as { statusCode?: number }).statusCode
    if (status && status >= 400 && status < 500) { // erros do próprio Fastify (corpo grande demais, tipo de conteúdo…)
      return reply.status(status).send(corpoErro(new ErroApi(status, status === 413 ? 'corpo_grande_demais' : status === 415 ? 'tipo_nao_suportado' : 'requisicao_invalida', status === 413 ? 'o corpo excede o limite' : status === 415 ? 'use application/json' : 'requisição inválida'), rid))
    }
    const db = erroDoBanco(erro)
    if (db) return reply.status(db.status).send(corpoErro(db, rid))
    o.aoErro?.(erro, `${req.method} ${req.url}`)
    log.error('erro inesperado', { erro: serializaErro(erro), requisicaoId: rid, rota: (req as Requisicao).obs?.rota, ...(((req as Requisicao).obs?.span) ? { traceId: (req as Requisicao).obs!.span.traceId } : {}) })
    return reply.status(500).send(corpoErro(new ErroApi(500, 'erro_interno', 'erro interno'), rid))
  })
  app.setNotFoundHandler((req, reply) => reply.status(404).send(corpoErro(new ErroApi(404, 'rota_inexistente', 'rota inexistente'), (req as Requisicao).obs?.reqId)))
  app.addHook('onSend', async (_req, reply) => { reply.header('x-content-type-options', 'nosniff'); reply.header('cache-control', 'no-store') })
  app.get('/saude', async () => ({ ok: true, servico: no.id, versao: no.versao }))
  // /pronto (fala com o banco), /metrics (fechado sem token), span por requisição, log e métricas HTTP: o mesmo que o gateway usa
  const { recusadas: mNeg } = instalaObservabilidadeFastify(app, obs, { ...(o.metricasToken !== undefined ? { metricasToken: o.metricasToken } : {}), pronto: async () => { await o.db.transacao('00000000-0000-0000-0000-000000000000', (q) => q('SELECT 1')) }, erroNaoAutenticado: () => new ErroApi(401, 'nao_autenticado', 'autenticação necessária') })

  // eventos: todo evento declarado em `publica` precisa de contrato (nó `evento`), senão o serviço nem sobe
  const declarados = [...new Set(rotas.flatMap((r) => r.publica))]
  const faltam = declarados.filter((e) => !o.eventos?.[e])
  if (faltam.length) throw new Error(`serviço '${no.id}': faltam os nós evento de ${faltam.join(', ')} (opção 'eventos')`)
  const publicador = declarados.length ? criaPublicador(no.id, o.eventos!) : null

  // acesso: toda rota `protegida` (o padrão) precisa das regras dos papéis; sem elas o serviço nem sobe (nunca "abre" por esquecimento)
  if (!o.acesso && rotas.some((r) => r.permissao === 'protegida')) throw new Error(`serviço '${no.id}': há rotas protegidas e falta a opção 'acesso' (regras dos papéis); marque a rota como 'publica' ou 'autenticada' se for o caso`)
  const entidadeDe = (sujeito: string): (Ent & { campos: Record<string, Campo> }) | undefined => spec.entidades[sujeito.slice(no.id.length + 1)]
  const tiposDoSujeito = (sujeito: string): Tipos => { const e = entidadeDe(sujeito); return (e ? tiposDe(e) : {}) as Tipos }
  /** falha FECHADA: uma regra malformada (ou que cita campo que não existe) nega, e é reportada; nunca é ignorada nem vira "tudo" */
  const seguro = <T,>(fn: () => T, padrao: T, onde: string): T => { try { return fn() } catch (e) { o.aoErro?.(e, `acesso ${onde}`); return padrao } }
  const decide = (regras: Regra[], v: Acesso['v'], acao: string, sujeito: string): Resolvido => seguro(() => resolve(regras, acao, sujeito, v, tiposDoSujeito(sujeito)), { tipo: 'nada' } as Resolvido, `${acao} ${sujeito}`)
  const camposDe = (a: Acesso, acao: string, sujeito: string): string[] | null => {
    const e = entidadeDe(sujeito); if (!e) return null
    if (decide(a.regras, a.v, acao, sujeito).tipo === 'nada') return [] // sem a ação: nenhum campo
    return seguro(() => camposPermitidos(a.regras, acao, sujeito, a.v, tiposDoSujeito(sujeito), nomesDeCampos(e)), [] as string[], `campos ${acao} ${sujeito}`)
  }
  const podeCom = (a: Acesso) => (acao: string, sujeito: string, linha?: Record<string, unknown>, campo?: string): boolean =>
    seguro(() => permite(a.regras, acao, sujeito, a.v, tiposDoSujeito(sujeito), (c, l) => avalia(c, l, tiposDoSujeito(sujeito)), linha, campo), false, `pode ${acao} ${sujeito}`)

  for (const r of rotas) {
    // a resposta pode OMITIR campos (restrição por papel): só o id é obrigatório no serializador; o OpenAPI continua descrevendo o contrato completo
    const saida = r.saida ? { ...esquemaDeEntidade(spec.entidades[r.saida]!, 'saida'), required: ['id'] } : undefined
    const schema: Record<string, unknown> = {
      ...esquemasHttp(r), // a MESMA validação que o gateway aplica (fonte única no schema)
      response: { [codigoSucesso(r)]: saida ? (r.lista ? { type: 'array', items: saida } : saida) : { type: 'null' } },
    }
    app.route({
      method: r.metodo.toUpperCase() as 'GET', url: r.caminhoFastify, schema,
      // autenticar e autorizar ANTES de validar
      onRequest: async (req) => {
        const ctx = await o.contexto({ headers: req.headers, hostname: req.hostname, ip: req.ip })
        if (r.permissao === 'publica') {
          if (!ctx?.tenantId) throw new ErroApi(400, 'tenant_nao_resolvido', 'não foi possível resolver o tenant desta requisição')
        } else {
          if (!ctx) throw new ErroApi(401, 'nao_autenticado', 'autenticação necessária')
          if (!ctx.tenantId) throw new ErroApi(401, 'nao_autenticado', 'credencial sem tenant')
          // contexto anônimo (tenant resolvido pelo host, sem usuário) só serve a rotas públicas: `autenticada`/`protegida` exigem um USUÁRIO
          if (!ctx.usuario) throw new ErroApi(401, 'nao_autenticado', 'autenticação necessária')
          if (r.permissao === 'protegida') {
            // papel desconhecido ou regra ilegível: NEGA e reporta (erro do provedor de identidade ou de configuração; nunca vira acesso)
            let regras: Regra[]
            try { regras = await o.acesso!.regras(ctx) } catch (e) { o.aoErro?.(e, 'acesso: papéis do chamador'); throw new ErroApi(403, 'proibido', 'sem permissão para esta operação') }
            const v = { ...(ctx.usuario !== undefined ? { usuario: ctx.usuario } : {}), tenant: ctx.tenantId }
            const resolvido = decide(regras, v, r.acao, r.sujeito)
            if (resolvido.tipo === 'nada') throw new ErroApi(403, 'proibido', 'sem permissão para esta operação')
            ;(req as Requisicao).acesso = { regras, v, resolvido }
          }
        }
        ;(req as Requisicao).ctx = ctx!
      },
      handler: async (req, reply) => executa(r, req as Requisicao, reply),
    })
  }

  async function executa(r: Rota, req: Requisicao, reply: { status(n: number): unknown }) {
    const ctx = req.ctx!
    const params = (req.params ?? {}) as Record<string, string>
    const entrada = ((r.metodo === 'get' || r.metodo === 'delete' ? req.query : req.body) ?? {}) as Record<string, unknown>
    const t0db = performance.now(); let resDb = 'confirmada'
    const resultado = await tracer.emSpan('db.transacao', { tipo: 'cliente', atributos: { 'db.sistema': 'postgresql', 'db.operacao': r.id } }, () => o.db.transacao(ctx.tenantId, async (q) => {
      if (r.origem.tipo === 'crud') return crud(r.origem.crud, r.origem.entidade, { params, entrada, ctx, q, acesso: req.acesso, rota: r })
      const impl = o.operacoes?.[r.id]
      if (!impl) throw new ErroApi(501, 'nao_implementado', `a operação '${r.id}' ainda não tem implementação`)
      return impl({ params, entrada, ctx, q, pode: req.acesso ? podeCom(req.acesso) : () => r.permissao === 'autenticada', publica: async (e, p) => { if (!r.publica.includes(e)) throw new Error(`a operação '${r.id}' não declara o evento '${e}' em 'publica'`); await tracer.emSpan('evento.publica', { tipo: 'produtor', atributos: { evento: e } }, (sp) => publicador!.publicar(q, ctx.tenantId, e, p, sp.traceparent())); mEv.inc({ evento: e }) } })
    })).catch((err) => { resDb = 'desfeita'; throw err }).finally(() => { mDb.inc({ resultado: resDb }); mDbDur.observa((performance.now() - t0db) / 1000, { resultado: resDb }) })
    if (r.saida === undefined) { ;(reply.status(204) as { send(): void }).send(); return }
    if (codigoSucesso(r) === '201') reply.status(201)
    return resultado
  }

  async function crud(op: string, entidade: string, e: { params: Record<string, string>; entrada: Record<string, unknown>; ctx: Contexto; q: import('./tipos').Consulta; acesso: Acesso | undefined; rota: Rota }) {
    const ent = spec.entidades[entidade]!
    const t = tabela(no.id, entidade)
    const sujeito = `${no.id}.${entidade}`
    const tipos = tiposDoSujeito(sujeito)
    const naoAchou = () => new ErroApi(404, 'nao_encontrado', 'registro não encontrado') // outro tenant OU fora do alcance do papel: indistinguível
    const valor = (campo: string, v: unknown) => (ent.campos[campo]!.tipo === 'json' ? JSON.stringify(v) : v)
    const coluna = (campo: string) => ident(snake(campo))
    const cond = e.acesso?.resolvido.tipo === 'onde' ? e.acesso.resolvido.cond : null
    const proibido = () => new ErroApi(403, 'proibido', 'a operação levaria o registro para fora do que o seu papel permite')
    // o que o papel pode LER desta entidade (resposta) e ESCREVER nesta ação
    const leitura = e.acesso ? camposDe(e.acesso, op === 'listar' ? 'listar' : 'obter', sujeito) : null
    const escrita = e.acesso ? camposDe(e.acesso, op, sujeito) : null
    const projeta = (row: Record<string, unknown>) => { const api = linhaParaApi(ent, row); return leitura === null ? api : Object.fromEntries(Object.entries(api).filter(([k]) => k === 'id' || leitura.includes(k))) }
    if ((op === 'criar' || op === 'atualizar') && escrita !== null) {
      const fora = Object.keys(e.entrada).filter((c) => !escrita.includes(c))
      if (fora.length) throw new ErroApi(403, 'campo_proibido', `sem permissão para ${op === 'criar' ? 'informar' : 'alterar'}: ${fora.join(', ')}`)
    }
    const noEscopo = (row: Record<string, unknown>) => cond === null || avalia(cond, linhaParaApi(ent, row), tipos as Tipos)
    switch (op) {
      case 'listar': {
        const { pagina = 1, limite = 24, busca, ...filtros } = e.entrada as { pagina?: number; limite?: number; busca?: string } & Record<string, unknown>
        const onde: string[] = [], ps: unknown[] = []
        if (typeof busca === 'string' && ent.busca) { const c = condicaoDeBusca(ent.busca.campos, busca, coluna, ps); if (c) onde.push(`(${c})`) } // busca por texto (sem acento nem maiúsculas); termo sem palavra nenhuma não filtra
        for (const [k, v] of Object.entries(filtros)) { ps.push(v); onde.push(`${coluna(k)} = $${ps.length}`) }
        if (cond) onde.push(`(${aSql(cond, coluna, ps, tipos as Tipos)})`) // o alcance do papel entra no WHERE: o que está fora nem é lido
        ps.push(limite, (pagina - 1) * limite)
        const r = await e.q(`SELECT ${colunas(ent, leitura)} FROM ${t}${onde.length ? ` WHERE ${onde.join(' AND ')}` : ''} ORDER BY criado_em, id LIMIT $${ps.length - 1} OFFSET $${ps.length}`, ps)
        return r.rows.map(projeta)
      }
      case 'obter': {
        const ps: unknown[] = [e.params.id]
        const r = await e.q(`SELECT ${colunas(ent, leitura)} FROM ${t} WHERE id = $1${cond ? ` AND (${aSql(cond, coluna, ps, tipos as Tipos)})` : ''}`, ps)
        if (!r.rows[0]) throw naoAchou(); return projeta(r.rows[0])
      }
      case 'criar': {
        const campos = Object.keys(e.entrada)
        const r = await e.q(`INSERT INTO ${t} ("tenant_id"${campos.map((c) => `, ${coluna(c)}`).join('')}) VALUES ($1${campos.map((_, i) => `, $${i + 2}`).join('')}) RETURNING ${colunas(ent)}`, [e.ctx.tenantId, ...campos.map((c) => valor(c, e.entrada[c]))])
        if (!noEscopo(r.rows[0]!)) throw proibido() // o registro criado cairia fora do alcance do papel: a transação desfaz
        return projeta(r.rows[0]!)
      }
      case 'atualizar': {
        const campos = Object.keys(e.entrada)
        if (!campos.length) throw new ErroApi(400, 'requisicao_invalida', 'informe ao menos um campo para atualizar')
        const ps: unknown[] = [e.params.id, ...campos.map((c) => valor(c, e.entrada[c]))]
        const r = await e.q(`UPDATE ${t} SET ${campos.map((c, i) => `${coluna(c)} = $${i + 2}`).join(', ')}, "atualizado_em" = now() WHERE id = $1${cond ? ` AND (${aSql(cond, coluna, ps, tipos as Tipos)})` : ''} RETURNING ${colunas(ent)}`, ps)
        if (!r.rows[0]) throw naoAchou()
        if (!noEscopo(r.rows[0])) throw proibido() // não se "empurra" um registro para fora do próprio alcance
        return projeta(r.rows[0])
      }
      case 'remover': {
        const ps: unknown[] = [e.params.id]
        const r = await e.q(`DELETE FROM ${t} WHERE id = $1${cond ? ` AND (${aSql(cond, coluna, ps, tipos as Tipos)})` : ''} RETURNING id`, ps)
        if (!r.rowCount) throw naoAchou(); return undefined
      }
      default: throw new Error(`operação CRUD desconhecida: ${op}`)
    }
  }
  return app
}

function mensagemValidacao(x: { instancePath: string; message?: string; keyword: string; params?: Record<string, unknown> }): string {
  switch (x.keyword) {
    case 'required': return `falta o campo '${String(x.params?.missingProperty)}'`
    case 'additionalProperties': return `campo desconhecido '${String(x.params?.additionalProperty)}'`
    case 'type': return `tipo inválido (esperado ${String(x.params?.type)})`
    case 'pattern': return 'formato inválido'
    case 'format': return `formato inválido (${String(x.params?.format)})`
    case 'maximum': case 'minimum': return `fora do limite (${x.message ?? ''})`
    default: return x.message ?? 'inválido'
  }
}
