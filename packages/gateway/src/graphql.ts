import {
  GraphQLBoolean, GraphQLError, GraphQLID, GraphQLInputObjectType, GraphQLInt, GraphQLList, GraphQLNonNull, GraphQLObjectType, GraphQLScalarType, GraphQLSchema, GraphQLString,
  GraphQLFloat, Kind, NoSchemaIntrospectionCustomRule, execute, parse, specifiedRules, validate,
  type DocumentNode, type FieldNode, type FragmentDefinitionNode, type GraphQLInputType, type GraphQLOutputType, type SelectionSetNode, type ValidationRule, type ValueNode,
} from 'graphql'
import type { Observabilidade } from '@polaris/observabilidade'
import { PADRAO_DINHEIRO, rotasDe, type Campo } from '@polaris/schema'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import type { ChamadorCompleto, Servicos } from './chamador'
import type { CacheDoGateway } from './cache'
import type { CtxGw, ErroGw } from './gateway'

// ---------------------------------------------------------------------------------------------------------------------------------------------
// GraphQL GERADO dos schemas dos serviços: cada entidade vira um tipo, cada rota uma consulta (GET) ou mutação (resto), prefixadas pelo serviço
// (`loja_listarProduto`). Campo `referencia` vira relação navegável (pedido.cliente), resolvida pela operação `obter` do serviço, com memo por requisição.
// Autorização continua nos serviços: cada resolver repassa o Authorization. Limites: profundidade, complexidade (listas multiplicam), aliases, campos de raiz,
// tamanho; introspecção DESLIGADA por padrão; sugestões ("Did you mean") e erros internos mascarados; só POST, sem lote.
// ---------------------------------------------------------------------------------------------------------------------------------------------

export type OpcoesGraphql = {
  /** padrão false (produção): o schema não é enumerável por quem não precisa */
  introspeccao?: boolean
  /** padrão 6 */
  profundidadeMax?: number
  /** padrão 2000 */
  complexidadeMax?: number
  /** padrão 20 */
  aliasesMax?: number
  /** campos na raiz (padrão 10) */
  camposRaizMax?: number
  /** caracteres da consulta (padrão 10 000) */
  tamanhoMax?: number
  /** prazo total da execução, em ms (padrão 15 000) */
  prazoMs?: number
}

type Ctx = { gw: CtxGw; memo: Map<string, Promise<unknown>>; signal: AbortSignal }

const cap = (s: string) => s[0]!.toUpperCase() + s.slice(1)
const limpa = (s: string) => s.replace(/[^A-Za-z0-9_]/g, '_')
const DATA = /^\d{4}-\d{2}-\d{2}$/
const UUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/
const RE_DINHEIRO = new RegExp(PADRAO_DINHEIRO)

function json(v: unknown, prof = 0, n = { c: 0 }): unknown {
  if (++n.c > 5000 || prof > 8) throw new GraphQLError('valor JSON grande ou profundo demais')
  if (v === null || ['string', 'number', 'boolean'].includes(typeof v)) return v
  if (Array.isArray(v)) return v.map((x) => json(x, prof + 1, n))
  if (typeof v === 'object') return Object.fromEntries(Object.entries(v as object).filter(([k]) => k !== '__proto__').map(([k, x]) => [k, json(x, prof + 1, n)]))
  throw new GraphQLError('valor JSON inválido')
}
const literal = (a: ValueNode, vars?: Record<string, unknown>): unknown => {
  switch (a.kind) {
    case Kind.STRING: case Kind.BOOLEAN: return a.value
    case Kind.INT: return Number(a.value)
    case Kind.FLOAT: return Number(a.value)
    case Kind.NULL: return null
    case Kind.LIST: return a.values.map((x) => literal(x, vars))
    case Kind.OBJECT: return Object.fromEntries(a.fields.map((f) => [f.name.value, literal(f.value, vars)]))
    case Kind.VARIABLE: return vars?.[a.name.value]
    default: return undefined
  }
}

const Dinheiro = new GraphQLScalarType({ name: 'Dinheiro', description: 'Reais como TEXTO decimal exato ("49.90"), até 4 casas. Número é recusado.',
  serialize: (v) => { if (typeof v === 'string' && RE_DINHEIRO.test(v)) return v; throw new GraphQLError('dinheiro inválido na resposta') },
  parseValue: (v) => { if (typeof v === 'string' && RE_DINHEIRO.test(v)) return v; throw new GraphQLError('dinheiro deve ser texto decimal, ex.: "49.90"') },
  parseLiteral: (a) => { if (a.kind === Kind.STRING && RE_DINHEIRO.test(a.value)) return a.value; throw new GraphQLError('dinheiro deve ser texto decimal, ex.: "49.90"') } })
const Data = new GraphQLScalarType({ name: 'Data', description: 'AAAA-MM-DD',
  serialize: (v) => String(v), parseValue: (v) => { if (typeof v === 'string' && DATA.test(v) && !Number.isNaN(Date.parse(v))) return v; throw new GraphQLError('data inválida (AAAA-MM-DD)') },
  parseLiteral: (a) => { if (a.kind === Kind.STRING && DATA.test(a.value) && !Number.isNaN(Date.parse(a.value))) return a.value; throw new GraphQLError('data inválida (AAAA-MM-DD)') } })
const DataHora = new GraphQLScalarType({ name: 'DataHora', description: 'Data e hora ISO 8601',
  serialize: (v) => String(v), parseValue: (v) => { if (typeof v === 'string' && v.length <= 40 && /^\d{4}-\d{2}-\d{2}T/.test(v) && !Number.isNaN(Date.parse(v))) return v; throw new GraphQLError('data e hora inválidas (ISO 8601)') },
  parseLiteral: (a) => { if (a.kind === Kind.STRING && a.value.length <= 40 && /^\d{4}-\d{2}-\d{2}T/.test(a.value) && !Number.isNaN(Date.parse(a.value))) return a.value; throw new GraphQLError('data e hora inválidas (ISO 8601)') } })
const Uuid = new GraphQLScalarType({ name: 'Uuid', serialize: (v) => String(v), parseValue: (v) => { if (typeof v === 'string' && UUID.test(v)) return v; throw new GraphQLError('uuid inválido') }, parseLiteral: (a) => { if (a.kind === Kind.STRING && UUID.test(a.value)) return a.value; throw new GraphQLError('uuid inválido') } })
const Json = new GraphQLScalarType({ name: 'Json', description: 'Qualquer valor JSON (limitado em tamanho e profundidade)', serialize: (v) => v, parseValue: (v) => json(v), parseLiteral: (a, vars) => json(literal(a, vars as Record<string, unknown>)) })

const ESCALAR: Record<string, GraphQLInputType & GraphQLOutputType> = { texto: GraphQLString, inteiro: GraphQLInt, decimal: GraphQLFloat, booleano: GraphQLBoolean, data: Data, dataHora: DataHora, dinheiro: Dinheiro, uuid: Uuid, json: Json }
/** o tipo GraphQL de um campo do schema (lista → [T!]) */
function tipoDe(c: Campo): GraphQLInputType & GraphQLOutputType {
  const t = ESCALAR[c.tipo]
  if (!t) throw new Error(`tipo de campo sem equivalente em GraphQL: ${c.tipo}`)
  return (c.lista && c.tipo !== 'json' ? new GraphQLList(new GraphQLNonNull(t)) : t) as never
}

export type Entrada = {
  servicos: Servicos
  chamador: ChamadorCompleto
  entra(req: FastifyRequest, o?: { exigeUsuario?: boolean }): Promise<CtxGw>
  obs: Observabilidade
  traduz(e: unknown): ErroGw
  opcoes: OpcoesGraphql
  cobraTaxa(req: FastifyRequest, ctx: CtxGw, custo: number): void
  cache: CacheDoGateway
  publicaDaFonte: unknown
}

/** O schema GraphQL dos serviços (sem servidor): útil para inspecionar e testar. */
export function geraSchema(servicos: Servicos, chamador: ChamadorCompleto, traduz: (e: unknown) => ErroGw): GraphQLSchema {
  const objetos = new Map<string, GraphQLObjectType>()
  const consultas: Record<string, never> = {}, mutacoes: Record<string, never> = {}
  const erro = (e: unknown): never => { const g = traduz(e); throw new GraphQLError(g.message, { extensions: { codigo: g.codigo, status: g.status } }) }
  const chama = (servico: string, op: string, args: Record<string, unknown>, ctx: Ctx) => chamador(servico, op, Object.fromEntries(Object.entries(args).filter(([, v]) => v !== undefined && v !== null)), ctx.gw.chamada, ctx.signal).then((r) => r, erro)
  const memo = <T,>(ctx: Ctx, chave: string, f: () => Promise<T>): Promise<T> => { let p = ctx.memo.get(chave) as Promise<T> | undefined; if (!p) { p = f(); ctx.memo.set(chave, p) } return p }

  for (const [sid, cfg] of Object.entries(servicos)) {
    const spec = cfg.no.spec as { entidades: Record<string, { campos: Record<string, Campo> }> }
    const nomeTipo = (e: string) => `${cap(limpa(sid))}${cap(limpa(e))}`
    const rs = rotasDe(cfg.no); const porId = new Map(rs.map((r) => [r.id, r]))
    for (const [en, ent] of Object.entries(spec.entidades)) {
      const nome = nomeTipo(en)
      objetos.set(nome, new GraphQLObjectType({ name: nome, fields: () => {
        // TODOS os campos (menos o id) são anuláveis: o papel do chamador pode ocultar campos, e a resposta do serviço os omite
        const f: Record<string, { type: GraphQLOutputType; resolve?: (p: Record<string, unknown>, a: unknown, c: Ctx) => unknown }> = { id: { type: new GraphQLNonNull(GraphQLID) }, criadoEm: { type: DataHora }, atualizadoEm: { type: DataHora } }
        for (const [cn, c] of Object.entries(ent.campos)) {
          f[cn] = { type: tipoDe(c) as GraphQLOutputType }
          if (c.referencia && cn.endsWith('Id') && cn.length > 2 && porId.has(`obter${cap(c.referencia)}`)) { // relação navegável
            const rel = cn.slice(0, -2), alvo = c.referencia
            f[rel] = { type: objetos.get(nomeTipo(alvo)) as GraphQLObjectType, resolve: async (p, _a, ctx) => {
              const id = p[cn]; if (typeof id !== 'string') return null
              try { return (await memo(ctx, `${sid}|obter${cap(alvo)}|${id}`, () => chama(sid, `obter${cap(alvo)}`, { id }, ctx))).corpo } catch { return null } // sem acesso/inexistente: a relação some, não derruba a consulta
            } }
          }
        }
        return f as never
      } }))
    }
    // as relações precisam do tipo alvo já criado: o `fields` é preguiçoso, então a ordem não importa
    for (const r of rs) {
      const saida: GraphQLOutputType = r.saida ? (r.lista ? new GraphQLNonNull(new GraphQLList(new GraphQLNonNull(objetos.get(nomeTipo(r.saida))!))) : objetos.get(nomeTipo(r.saida))!) : GraphQLBoolean
      const args: Record<string, { type: GraphQLInputType }> = {}
      for (const p of r.params) args[p] = { type: new GraphQLNonNull(Uuid) }
      const emQuery = r.metodo === 'get' || r.metodo === 'delete'
      const obrig = (c: Campo) => !!c.obrigatorio && c.padrao === undefined && !(r.origem.tipo === 'crud' && (r.origem.crud === 'atualizar' || r.origem.crud === 'listar'))
      if (r.metodo === 'get') {
        for (const [k, c] of Object.entries(r.entrada)) { const t = tipoDe(c) as GraphQLInputType; args[k] = { type: obrig(c) ? new GraphQLNonNull(t) : t } }
        if (r.lista) { args.pagina = { type: GraphQLInt }; args.limite = { type: GraphQLInt } }
      } else if (Object.keys(r.entrada).length) {
        const entrada = new GraphQLInputObjectType({ name: `${cap(limpa(sid))}${cap(limpa(r.id))}Entrada`, fields: Object.fromEntries(Object.entries(r.entrada).map(([k, c]) => { const t = tipoDe(c) as GraphQLInputType; return [k, { type: obrig(c) ? new GraphQLNonNull(t) : t }] })) })
        args.entrada = { type: Object.values(r.entrada).some(obrig) ? new GraphQLNonNull(entrada) : entrada }
      }
      void emQuery
      const campo = {
        type: saida, args,
        resolve: async (_: unknown, a: Record<string, unknown>, ctx: Ctx) => {
          const { entrada, ...resto } = a
          const r2 = await chama(sid, r.id, { ...resto, ...((entrada as Record<string, unknown> | undefined) ?? {}) }, ctx)
          return r.saida ? r2.corpo : true
        },
      }
      ;((r.metodo === 'get' ? consultas : mutacoes) as Record<string, unknown>)[`${limpa(sid)}_${limpa(r.id)}`] = campo
    }
  }
  const vazio = (nome: string) => new GraphQLObjectType({ name: nome, fields: { _: { type: GraphQLBoolean, resolve: () => true } } })
  return new GraphQLSchema({
    query: Object.keys(consultas).length ? new GraphQLObjectType({ name: 'Query', fields: consultas as never }) : vazio('Query'),
    ...(Object.keys(mutacoes).length ? { mutation: new GraphQLObjectType({ name: 'Mutation', fields: mutacoes as never }) } : {}),
    types: [...objetos.values()],
  })
}

// ---- limites da consulta ---------------------------------------------------------------------------------------------------------------------
function medida(doc: DocumentNode, vars: Record<string, unknown>, mult: number) {
  const frags = new Map<string, FragmentDefinitionNode>(); for (const d of doc.definitions) if (d.kind === Kind.FRAGMENT_DEFINITION) frags.set(d.name.value, d)
  let aliases = 0, camposRaiz = 0
  const lim = (f: FieldNode): number => { const a = f.arguments?.find((x) => x.name.value === 'limite'); const v = a ? literal(a.value, vars) : undefined; return typeof v === 'number' && v >= 1 ? Math.min(v, 100) : mult }
  const anda = (s: SelectionSetNode, prof: number, vistos: Set<string>): { custo: number; prof: number } => {
    let custo = 0, p = prof
    for (const sel of s.selections) {
      if (sel.kind === Kind.FIELD) {
        if (sel.alias) aliases++
        let c = 1, pp = prof + 1
        if (sel.selectionSet) { const r = anda(sel.selectionSet, prof + 1, vistos); c += r.custo * (/^[a-z0-9]+_(listar|buscar|list)/i.test(sel.name.value) || sel.arguments?.some((x) => x.name.value === 'limite') ? lim(sel) : 1); pp = r.prof }
        custo += c; p = Math.max(p, pp)
      } else if (sel.kind === Kind.INLINE_FRAGMENT) { const r = anda(sel.selectionSet, prof, vistos); custo += r.custo; p = Math.max(p, r.prof) }
      else { const f = frags.get(sel.name.value); if (f && !vistos.has(f.name.value)) { const r = anda(f.selectionSet, prof, new Set([...vistos, f.name.value])); custo += r.custo; p = Math.max(p, r.prof) } }
    }
    return { custo, prof: p }
  }
  let custo = 0, prof = 0
  for (const d of doc.definitions) if (d.kind === Kind.OPERATION_DEFINITION) { camposRaiz += d.selectionSet.selections.length; const r = anda(d.selectionSet, 0, new Set()); custo += r.custo; prof = Math.max(prof, r.prof) }
  return { custo, prof, aliases, camposRaiz }
}
const semSugestao = (m: string) => m.replace(/\s*Did you mean .*$/s, '').replace(/\s*Cannot query field "(\w+)" on type "(\w+)"\.?/, (_x, f: string, t: string) => ` Campo "${f}" não existe em "${t}".`).trim()

/** Instala `POST /graphql`. */
export function instalaGraphql(app: FastifyInstance, e: Entrada): void {
  const o = e.opcoes
  const schema = geraSchema(e.servicos, e.chamador, e.traduz)
  const maxProf = o.profundidadeMax ?? 6, maxCusto = o.complexidadeMax ?? 2000, maxAliases = o.aliasesMax ?? 20, maxRaiz = o.camposRaizMax ?? 10, maxTam = o.tamanhoMax ?? 10_000, prazo = o.prazoMs ?? 15_000
  const regras: readonly ValidationRule[] = o.introspeccao ? specifiedRules : [...specifiedRules, NoSchemaIntrospectionCustomRule]
  const mGql = e.obs.metricas.contador('graphql_operacoes_total', 'Operações GraphQL, por tipo e resultado', ['tipo', 'resultado'])
  app.post('/graphql', { schema: { body: { type: 'object', required: ['query'], additionalProperties: false, properties: { query: { type: 'string', maxLength: maxTam }, variables: { type: ['object', 'null'] }, operationName: { type: ['string', 'null'], maxLength: 100 } } } } }, async (req, reply) => {
    const ctx0 = await e.entra(req)
    const b = req.body as { query: string; variables?: Record<string, unknown> | null; operationName?: string | null }
    const resposta = (erros: Array<{ message: string; extensions?: Record<string, unknown> }>, status = 200) => reply.status(status).send({ errors: erros.map((x) => ({ message: semSugestao(x.message), ...(x.extensions ? { extensions: x.extensions } : {}) })) })
    let doc: DocumentNode
    try { doc = parse(b.query, { maxTokens: 4000 }) } catch (err) { mGql.inc({ tipo: 'desconhecido', resultado: 'sintaxe' }); return resposta([{ message: `consulta inválida: ${(err as Error).message}` }], 400) }
    const falhas = validate(schema, doc, regras)
    if (falhas.length) { mGql.inc({ tipo: 'desconhecido', resultado: 'invalida' }); return resposta(falhas.map((f) => ({ message: f.message })), 400) }
    const operacao = doc.definitions.find((d) => d.kind === Kind.OPERATION_DEFINITION && (!b.operationName || d.name?.value === b.operationName))
    const tipo = operacao && operacao.kind === Kind.OPERATION_DEFINITION ? operacao.operation : 'query'
    const m = medida(doc, b.variables ?? {}, 24)
    const excede = m.prof > maxProf ? `profundidade ${m.prof} excede o limite (${maxProf})` : m.custo > maxCusto ? `complexidade ${m.custo} excede o limite (${maxCusto})` : m.aliases > maxAliases ? `aliases (${m.aliases}) excedem o limite (${maxAliases})` : m.camposRaiz > maxRaiz ? `campos na raiz (${m.camposRaiz}) excedem o limite (${maxRaiz})` : ''
    if (excede) { mGql.inc({ tipo, resultado: 'limite' }); return resposta([{ message: `consulta recusada: ${excede}`, extensions: { codigo: 'consulta_cara' } }], 400) }
    if (tipo === 'mutation') await e.entra(req, { exigeUsuario: true }) // mutação exige usuário autenticado
    e.cobraTaxa(req, ctx0, Math.max(1, Math.ceil(m.custo / 100)))
    const ctl = new AbortController()
    const timer = setTimeout(() => ctl.abort(), prazo)
    try {
      const contextValue: Ctx = { gw: ctx0, memo: new Map(), signal: ctl.signal }
      const r = await Promise.race([execute({ schema, document: doc, contextValue, ...(b.variables ? { variableValues: b.variables } : {}), ...(b.operationName ? { operationName: b.operationName } : {}) }), new Promise<never>((_, rej) => ctl.signal.addEventListener('abort', () => rej(new GraphQLError('tempo de execução esgotado', { extensions: { codigo: 'tempo_esgotado' } }))))])
      // só o que NÃO é um GraphQLError nosso (uma exceção inesperada num resolver) é mascarado; erro de coerção/validação e erro de serviço traduzido passam
      const interno = (x: GraphQLError) => !!x.originalError && !(x.originalError instanceof GraphQLError)
      const erros = (r.errors ?? []).map((x) => ({ message: x.extensions?.codigo ? x.message : (interno(x) ? 'erro interno' : x.message), ...(x.extensions?.codigo ? { extensions: { codigo: x.extensions.codigo, status: x.extensions.status } } : {}) }))
      for (const x of r.errors ?? []) if (!x.extensions?.codigo && interno(x)) e.obs.log.error('erro de resolver no GraphQL', { erro: { nome: x.originalError!.name, mensagem: x.originalError!.message } })
      mGql.inc({ tipo, resultado: erros.length ? 'erro' : 'ok' })
      return reply.status(200).send({ data: r.data ?? null, ...(erros.length ? { errors: erros.map((x) => ({ ...x, message: semSugestao(x.message) })) } : {}) })
    } catch (err) { mGql.inc({ tipo, resultado: 'erro' }); return resposta([{ message: (err as Error).message, extensions: { codigo: 'tempo_esgotado' } }], 504) } finally { clearTimeout(timer) }
  })
}
