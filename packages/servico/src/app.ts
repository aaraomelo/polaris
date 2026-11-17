import Ajv from 'ajv'
import addFormats from 'ajv-formats'
import Fastify, { type FastifyInstance, type FastifyRequest } from 'fastify'
import { codigoSucesso, esquemaDeEntidade, esquemaDoCampo, rotasDe, snake, type Campo, type No, type Rota } from '@polaris/schema'
import { ErroApi, corpoErro, erroDoBanco } from './erros'
import { colunas, ident, linhaParaApi, tabela, type Ent } from './sql'
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
type Requisicao = FastifyRequest & { ctx?: Contexto }

const SEGUNDOS_ID = { type: 'object', additionalProperties: false } as const
const PAGINA = { pagina: { type: 'integer', minimum: 1, default: 1 }, limite: { type: 'integer', minimum: 1, maximum: 100, default: 24 } }

export function criaServico(no: No, o: OpcoesServico): FastifyInstance {
  const spec = no.spec as Spec
  const rotas = rotasDe(no)
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
    const validation = (erro as { validation?: Array<{ instancePath: string; message?: string; keyword: string; params?: Record<string, unknown> }> }).validation
    if (validation) {
      const detalhes = validation.map((x) => ({ caminho: x.instancePath || '/', mensagem: mensagemValidacao(x) }))
      return reply.status(400).send(corpoErro(new ErroApi(400, 'requisicao_invalida', 'a requisição não respeita o contrato', detalhes)))
    }
    if (erro instanceof ErroApi) return reply.status(erro.status).send(corpoErro(erro))
    const status = (erro as { statusCode?: number }).statusCode
    if (status && status >= 400 && status < 500) { // erros do próprio Fastify (corpo grande demais, tipo de conteúdo…)
      return reply.status(status).send(corpoErro(new ErroApi(status, status === 413 ? 'corpo_grande_demais' : status === 415 ? 'tipo_nao_suportado' : 'requisicao_invalida', status === 413 ? 'o corpo excede o limite' : status === 415 ? 'use application/json' : 'requisição inválida')))
    }
    const db = erroDoBanco(erro)
    if (db) return reply.status(db.status).send(corpoErro(db))
    o.aoErro?.(erro, `${req.method} ${req.url}`)
    return reply.status(500).send(corpoErro(new ErroApi(500, 'erro_interno', 'erro interno')))
  })
  app.setNotFoundHandler((_req, reply) => reply.status(404).send(corpoErro(new ErroApi(404, 'rota_inexistente', 'rota inexistente'))))
  app.addHook('onSend', async (_req, reply) => { reply.header('x-content-type-options', 'nosniff'); reply.header('cache-control', 'no-store') })
  app.get('/saude', async () => ({ ok: true, servico: no.id, versao: no.versao }))

  const autoriza = o.autoriza ?? ((ctx, p) => p === 'autenticada' || (ctx.permissoes ?? []).includes(p))

  for (const r of rotas) {
    const emQuery = r.metodo === 'get' || r.metodo === 'delete'
    const props = (campos: Record<string, Campo>, todosOpcionais = false) => ({ properties: Object.fromEntries(Object.entries(campos).map(([k, c]) => [k, esquemaDoCampo(c)])), required: todosOpcionais ? [] : Object.entries(campos).filter(([, c]) => c.obrigatorio && c.padrao === undefined).map(([k]) => k) })
    const saida = r.saida ? esquemaDeEntidade(spec.entidades[r.saida]!, 'saida') : undefined
    const schema: Record<string, unknown> = {
      ...(r.params.length ? { params: { type: 'object', properties: Object.fromEntries(r.params.map((p) => [p, { type: 'string', format: 'uuid' }])), required: r.params, additionalProperties: false } } : {}),
      ...(emQuery ? { querystring: { type: 'object', ...props(r.entrada, r.origem.tipo === 'crud'), properties: { ...props(r.entrada).properties, ...(r.lista ? PAGINA : {}) }, additionalProperties: false } } : {}),
      ...(!emQuery ? { body: { type: 'object', ...props(r.entrada, r.origem.tipo === 'crud' && r.origem.crud === 'atualizar'), additionalProperties: false } } : {}),
      response: { [codigoSucesso(r)]: saida ? (r.lista ? { type: 'array', items: saida } : saida) : { type: 'null' } },
    }
    void SEGUNDOS_ID
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
          if (!autoriza(ctx, r.permissao)) throw new ErroApi(403, 'proibido', 'sem permissão para esta operação')
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
    const eventos: Array<[string, unknown]> = []
    const resultado = await o.db.transacao(ctx.tenantId, async (q) => {
      if (r.origem.tipo === 'crud') return crud(r.origem.crud, r.origem.entidade, { params, entrada, ctx, q })
      const impl = o.operacoes?.[r.id]
      if (!impl) throw new ErroApi(501, 'nao_implementado', `a operação '${r.id}' ainda não tem implementação`)
      return impl({ params, entrada, ctx, q, publica: (e, p) => { if (!r.publica.includes(e)) throw new Error(`a operação '${r.id}' não declara o evento '${e}' em 'publica'`); eventos.push([e, p]) } })
    })
    for (const [e, p] of eventos) { try { await o.aoPublicar?.(e, p, ctx) } catch (err) { o.aoErro?.(err, `evento ${e}`) } } // só depois do commit
    if (r.saida === undefined) { ;(reply.status(204) as { send(): void }).send(); return }
    if (codigoSucesso(r) === '201') reply.status(201)
    return resultado
  }

  async function crud(op: string, entidade: string, e: { params: Record<string, string>; entrada: Record<string, unknown>; ctx: Contexto; q: import('./tipos').Consulta }) {
    const ent = spec.entidades[entidade]!
    const t = tabela(no.id, entidade)
    const naoAchou = () => new ErroApi(404, 'nao_encontrado', 'registro não encontrado') // outro tenant também cai aqui: a RLS esconde a linha
    const valor = (campo: string, v: unknown) => (ent.campos[campo]!.tipo === 'json' ? JSON.stringify(v) : v)
    const aApi = (row: Record<string, unknown>) => linhaParaApi(ent, row)
    switch (op) {
      case 'listar': {
        const { pagina = 1, limite = 24, ...filtros } = e.entrada as { pagina?: number; limite?: number } & Record<string, unknown>
        const onde: string[] = [], ps: unknown[] = []
        for (const [k, v] of Object.entries(filtros)) { ps.push(v); onde.push(`${ident(snake(k))} = $${ps.length}`) }
        ps.push(limite, (pagina - 1) * limite)
        const r = await e.q(`SELECT ${colunas(ent)} FROM ${t}${onde.length ? ` WHERE ${onde.join(' AND ')}` : ''} ORDER BY criado_em, id LIMIT $${ps.length - 1} OFFSET $${ps.length}`, ps)
        return r.rows.map(aApi)
      }
      case 'obter': {
        const r = await e.q(`SELECT ${colunas(ent)} FROM ${t} WHERE id = $1`, [e.params.id])
        if (!r.rows[0]) throw naoAchou(); return aApi(r.rows[0])
      }
      case 'criar': {
        const campos = Object.keys(e.entrada)
        const r = await e.q(`INSERT INTO ${t} ("tenant_id"${campos.map((c) => `, ${ident(snake(c))}`).join('')}) VALUES ($1${campos.map((_, i) => `, $${i + 2}`).join('')}) RETURNING ${colunas(ent)}`, [e.ctx.tenantId, ...campos.map((c) => valor(c, e.entrada[c]))])
        return aApi(r.rows[0]!)
      }
      case 'atualizar': {
        const campos = Object.keys(e.entrada)
        if (!campos.length) throw new ErroApi(400, 'requisicao_invalida', 'informe ao menos um campo para atualizar')
        const r = await e.q(`UPDATE ${t} SET ${campos.map((c, i) => `${ident(snake(c))} = $${i + 2}`).join(', ')}, "atualizado_em" = now() WHERE id = $1 RETURNING ${colunas(ent)}`, [e.params.id, ...campos.map((c) => valor(c, e.entrada[c]))])
        if (!r.rows[0]) throw naoAchou(); return aApi(r.rows[0])
      }
      case 'remover': {
        const r = await e.q(`DELETE FROM ${t} WHERE id = $1 RETURNING id`, [e.params.id])
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
