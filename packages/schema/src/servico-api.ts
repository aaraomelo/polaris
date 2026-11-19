import { EmissaoErro, type Campo } from './emissao'
import type { No } from './index'

// ---------------------------------------------------------------------------------------------------------------------------------------------
// A API HTTP de um `servico`, derivada UMA vez: a tabela de rotas (`rotasDe`) e os JSON Schemas dos campos servem à emissão OpenAPI e ao runtime
// (Fastify, @polaris/servico), então documentação e comportamento não têm como divergir.
// ---------------------------------------------------------------------------------------------------------------------------------------------

export type CrudOp = 'listar' | 'obter' | 'criar' | 'atualizar' | 'remover'
type Ent = { campos: Record<string, Campo & { descricao?: string }>; busca?: { campos: string[]; modo?: 'exata' | 'aproximada' }; crud?: { caminho: string; operacoes?: CrudOp[]; permissao?: string } }
type Op = { metodo: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'; caminho: string; entrada?: Record<string, Campo>; saida?: string; lista?: boolean; permissao?: string; publica?: string[] }
type Spec = { entidades: Record<string, Ent>; operacoes: Record<string, Op>; consome?: string[] }

export type Rota = {
  /** operationId: o nome da operação, ou `listarProduto`… nas rotas CRUD */
  id: string
  metodo: 'get' | 'post' | 'put' | 'patch' | 'delete'
  /** estilo OpenAPI: /produtos/{id} */
  caminho: string
  /** estilo Fastify: /produtos/:id */
  caminhoFastify: string
  params: string[]
  origem: { tipo: 'operacao' } | { tipo: 'crud'; crud: CrudOp; entidade: string }
  /** campos de query (GET/DELETE) ou de corpo (demais), SEM os parâmetros de caminho */
  entrada: Record<string, Campo>
  /** entidade devolvida; ausente = 204 */
  saida?: string
  lista: boolean
  /** `publica`: sem autenticação. `autenticada`: qualquer autenticado. `protegida` (padrão): autenticado E permitido pelas regras dos papéis para (acao, sujeito) */
  permissao: 'publica' | 'autenticada' | 'protegida'
  /** o que as regras de acesso avaliam: ação (listar, obter, criar, atualizar, remover, ou o id da operação) e sujeito (`servico.entidade`) */
  acao: string
  sujeito: string
  publica: string[]
}

export const PADRAO_DINHEIRO = '^-?[0-9]{1,15}(\\.[0-9]{1,4})?$'
/** só `publica` e `autenticada` abrem a rota; QUALQUER outro valor (ou ausente) é `protegida`: fail-closed, os papéis decidem */
export const modoDeAcesso = (v: string | undefined): 'publica' | 'autenticada' | 'protegida' => (v === 'publica' || v === 'autenticada' ? v : 'protegida')
const cap = (s: string) => s[0]!.toUpperCase() + s.slice(1)

/** JSON Schema de UM campo. `dinheiro` é texto decimal exato (nunca float); `json` é qualquer valor. */
export function esquemaDoCampo(c: Campo & { descricao?: string }): Record<string, unknown> {
  const base: Record<string, unknown> = (() => {
    switch (c.tipo) {
      case 'texto': return { type: 'string' }
      case 'inteiro': return { type: 'integer', minimum: -9007199254740991, maximum: 9007199254740991 } // inteiros seguros: o JSON/JS não representa mais que isso
      case 'decimal': return { type: 'number' }
      case 'booleano': return { type: 'boolean' }
      case 'data': return { type: 'string', format: 'date' }
      case 'dataHora': return { type: 'string', format: 'date-time' }
      case 'dinheiro': return { type: 'string', pattern: PADRAO_DINHEIRO }
      case 'uuid': return { type: 'string', format: 'uuid' }
      case 'json': return {}
      default: throw new EmissaoErro(`tipo de campo desconhecido: ${c.tipo}`)
    }
  })()
  const s = c.lista && c.tipo !== 'json' ? { type: 'array', items: base } : base
  return { ...s, ...(c.descricao ? { description: c.descricao } : {}), ...(c.padrao !== undefined ? { default: c.padrao } : {}) }
}

/** JSON Schema de objeto: `modo` 'saida' inclui id/auditoria; 'entrada' exige os obrigatórios; 'alteracao' não exige nada. Nunca expõe `tenant_id`. */
export function esquemaDeEntidade(ent: Ent, modo: 'saida' | 'entrada' | 'alteracao'): Record<string, unknown> {
  const props: Record<string, unknown> = {}
  const req: string[] = []
  if (modo === 'saida') { props.id = { type: 'string', format: 'uuid' }; req.push('id') }
  for (const [nome, c] of Object.entries(ent.campos)) {
    props[nome] = esquemaDoCampo(c)
    if (modo === 'saida' ? c.obrigatorio : modo === 'entrada' && c.obrigatorio && c.padrao === undefined) req.push(nome)
  }
  if (modo === 'saida') { props.criadoEm = { type: 'string', format: 'date-time' }; props.atualizadoEm = { type: 'string', format: 'date-time' }; req.push('criadoEm', 'atualizadoEm') }
  return { type: 'object', properties: props, ...(req.length ? { required: req } : {}), additionalProperties: false }
}

/** `criar` responde 201; o resto, 200 (ou 204 sem saída) */
export const codigoSucesso = (r: Pick<Rota, 'origem' | 'saida'>): '200' | '201' | '204' => (r.saida === undefined ? '204' : r.origem.tipo === 'crud' && r.origem.crud === 'criar' ? '201' : '200')
const ids = (caminho: string): string[] => [...caminho.matchAll(/:([A-Za-z][A-Za-z0-9]*)/g)].map((m) => m[1]!)
const aOpenApi = (c: string) => c.replace(/:([A-Za-z][A-Za-z0-9]*)/g, '{$1}')

/** Todas as rotas do serviço: as operações declaradas + as geradas pelo `crud` das entidades. Ordem estável (caminho, método). */
export function rotasDe(no: No): Rota[] {
  const spec = no.spec as Spec
  const rotas: Rota[] = []
  const usados = new Set<string>()
  const add = (r: Omit<Rota, 'caminho' | 'params' | 'caminhoFastify' | 'acao' | 'sujeito'> & { caminhoFastify: string }) => {
    if (usados.has(r.id)) throw new EmissaoErro(`servico ${no.id}: operação duplicada '${r.id}' (uma operação declarada colide com a rota CRUD gerada)`)
    usados.add(r.id)
    const acao = r.origem.tipo === 'crud' ? r.origem.crud : r.id
    const sujeito = `${no.id}.${r.origem.tipo === 'crud' ? r.origem.entidade : (r.saida ?? 'operacoes')}`
    rotas.push({ ...r, acao, sujeito, caminho: aOpenApi(r.caminhoFastify), params: ids(r.caminhoFastify) })
  }
  for (const [nome, o] of Object.entries(spec.operacoes)) {
    const params = ids(o.caminho)
    const entrada = Object.fromEntries(Object.entries(o.entrada ?? {}).filter(([k]) => !params.includes(k)))
    for (const p of params) if (!(o.entrada && p in o.entrada)) throw new EmissaoErro(`servico ${no.id}: '${nome}' usa :${p} no caminho mas não declara '${p}' em entrada`)
    if (o.saida !== undefined && !(o.saida in spec.entidades)) throw new EmissaoErro(`servico ${no.id}: '${nome}' devolve a entidade inexistente '${o.saida}'`)
    add({ id: nome, metodo: o.metodo.toLowerCase() as Rota['metodo'], caminhoFastify: o.caminho, origem: { tipo: 'operacao' }, entrada, ...(o.saida !== undefined ? { saida: o.saida } : {}), lista: !!o.lista, permissao: modoDeAcesso(o.permissao), publica: o.publica ?? [] })
  }
  for (const [nome, ent] of Object.entries(spec.entidades)) {
    if (!ent.crud) continue
    const { caminho } = ent.crud
    const permissao = modoDeAcesso(ent.crud.permissao)
    const ops = ent.crud.operacoes ?? ['listar', 'obter', 'criar', 'atualizar', 'remover']
    const idParam = { id: { tipo: 'uuid', obrigatorio: true } } as Record<string, Campo>
    if (ent.busca) {
      if ('busca' in ent.campos) throw new EmissaoErro(`servico ${no.id}: a entidade '${nome}' tem um campo chamado 'busca', que é o nome do parâmetro de busca`)
      for (const c of ent.busca.campos) { const def = ent.campos[c]; if (!def) throw new EmissaoErro(`servico ${no.id}: busca de '${nome}' usa o campo inexistente '${c}'`); if (def.tipo !== 'texto' || def.lista) throw new EmissaoErro(`servico ${no.id}: busca de '${nome}': '${c}' precisa ser um campo de texto (não lista)`) }
    }
    const filtros = { ...Object.fromEntries(Object.entries(ent.campos).filter(([, c]) => !c.lista && c.tipo !== 'json').map(([k, c]) => [k, { ...c, obrigatorio: false, padrao: undefined }])), ...(ent.busca ? { busca: { tipo: 'texto' } } : {}) } as Record<string, Campo> // filtro NÃO herda o padrão: um default de campo aplicado como filtro escondia todo registro com outro valor (depósito padrão, inativos…)
    const comum = { saida: nome, permissao, publica: [] as string[] }
    for (const op of ops) {
      const base = { origem: { tipo: 'crud', crud: op, entidade: nome } as const, ...comum }
      if (op === 'listar') add({ ...base, id: `listar${cap(nome)}`, metodo: 'get', caminhoFastify: caminho, entrada: filtros, lista: true })
      if (op === 'obter') add({ ...base, id: `obter${cap(nome)}`, metodo: 'get', caminhoFastify: `${caminho}/:id`, entrada: {}, lista: false })
      if (op === 'criar') add({ ...base, id: `criar${cap(nome)}`, metodo: 'post', caminhoFastify: caminho, entrada: ent.campos, lista: false })
      if (op === 'atualizar') add({ ...base, id: `atualizar${cap(nome)}`, metodo: 'patch', caminhoFastify: `${caminho}/:id`, entrada: Object.fromEntries(Object.entries(ent.campos).map(([k, c]) => [k, { ...c, obrigatorio: false, padrao: undefined }])) as Record<string, Campo>, lista: false })
      if (op === 'remover') { const { saida: _s, ...sem } = { ...base, id: `remover${cap(nome)}`, metodo: 'delete' as const, caminhoFastify: `${caminho}/:id`, entrada: {}, lista: false }; add(sem) }
    }
    void idParam
  }
  return rotas.sort((a, b) => (a.caminho === b.caminho ? (a.metodo < b.metodo ? -1 : 1) : a.caminho < b.caminho ? -1 : 1))
}

// ---- esquemas HTTP de uma rota (fonte ÚNICA: o serviço e o gateway validam IGUAL) ------------------------------------------------------------------
const DESC_BUSCA = 'busca por palavras (até 5, todas devem aparecer), sem diferenciar maiúsculas nem acentos, nos campos declarados em `busca` da entidade'
const PAGINA_HTTP = { pagina: { type: 'integer', minimum: 1, default: 1 }, limite: { type: 'integer', minimum: 1, maximum: 100, default: 24 } }
/** JSON Schemas de `params`, `querystring` (GET/DELETE) e `body` (demais) de uma rota. Sempre `additionalProperties: false`: campo desconhecido é rejeitado, não ignorado. */
export function esquemasHttp(r: Rota): { params?: Record<string, unknown>; querystring?: Record<string, unknown>; body?: Record<string, unknown> } {
  const emQuery = r.metodo === 'get' || r.metodo === 'delete'
  const crud = r.origem.tipo === 'crud'
  const props = (campos: Record<string, Campo>, todosOpcionais: boolean) => ({
    properties: Object.fromEntries(Object.entries(campos).map(([k, c]) => [k, esquemaDoCampo(c)])),
    required: todosOpcionais ? [] : Object.entries(campos).filter(([, c]) => c.obrigatorio && c.padrao === undefined).map(([k]) => k),
  })
  return {
    ...(r.params.length ? { params: { type: 'object', properties: Object.fromEntries(r.params.map((p) => [p, { type: 'string', format: 'uuid' }])), required: r.params, additionalProperties: false } } : {}),
    ...(emQuery ? { querystring: { type: 'object', ...props(r.entrada, crud), properties: { ...props(r.entrada, false).properties, ...(crud && 'busca' in r.entrada ? { busca: { type: 'string', maxLength: 100, description: DESC_BUSCA } } : {}), ...(r.lista ? PAGINA_HTTP : {}) }, additionalProperties: false } } : {}),
    ...(!emQuery ? { body: { type: 'object', ...props(r.entrada, crud && r.origem.tipo === 'crud' && r.origem.crud === 'atualizar'), additionalProperties: false } } : {}),
  }
}

// ---- OpenAPI ----------------------------------------------------------------------------------------------------------------------------------

const ERRO = { type: 'object', required: ['erro'], properties: { erro: { type: 'object', required: ['codigo', 'mensagem'], properties: { codigo: { type: 'string' }, mensagem: { type: 'string' }, detalhes: {} } } } }
const resp = (descricao: string) => ({ description: descricao, content: { 'application/json': { schema: { $ref: '#/components/schemas/Erro' } } } })

export function emiteOpenApi(no: No): string {
  const spec = no.spec as Spec
  const rotas = rotasDe(no)
  const ref = (e: string, modo = '') => ({ $ref: `#/components/schemas/${cap(e)}${modo}` })
  const schemas: Record<string, unknown> = { Erro: ERRO }
  for (const [nome, ent] of Object.entries(spec.entidades)) {
    schemas[cap(nome)] = esquemaDeEntidade(ent, 'saida')
    schemas[`${cap(nome)}Entrada`] = esquemaDeEntidade(ent, 'entrada')
    schemas[`${cap(nome)}Alteracao`] = esquemaDeEntidade(ent, 'alteracao')
  }
  const paths: Record<string, Record<string, unknown>> = {}
  for (const r of rotas) {
    const emQuery = r.metodo === 'get' || r.metodo === 'delete'
    const parametros = [
      ...r.params.map((p) => ({ name: p, in: 'path', required: true, schema: { type: 'string', format: 'uuid' } })),
      ...(emQuery ? Object.entries(r.entrada).map(([k, c]) => (r.origem.tipo === 'crud' && k === 'busca' ? { name: k, in: 'query', required: false, description: DESC_BUSCA, schema: { type: 'string', maxLength: 100 } } : { name: k, in: 'query', required: !!c.obrigatorio, schema: esquemaDoCampo(c) })) : []),
      ...(r.lista ? [{ name: 'pagina', in: 'query', required: false, schema: { type: 'integer', minimum: 1, default: 1 } }, { name: 'limite', in: 'query', required: false, schema: { type: 'integer', minimum: 1, maximum: 100, default: 24 } }] : []),
    ]
    const entradaCorpo = r.origem.tipo === 'crud' && r.origem.crud === 'criar' ? ref(r.origem.entidade, 'Entrada') : r.origem.tipo === 'crud' && r.origem.crud === 'atualizar' ? ref(r.origem.entidade, 'Alteracao')
      : { type: 'object', properties: Object.fromEntries(Object.entries(r.entrada).map(([k, c]) => [k, esquemaDoCampo(c)])), required: Object.entries(r.entrada).filter(([, c]) => c.obrigatorio && c.padrao === undefined).map(([k]) => k), additionalProperties: false }
    const sucesso = r.saida === undefined ? { '204': { description: 'sem conteúdo' } }
      : { [codigoSucesso(r)]: { description: r.lista ? 'lista paginada' : codigoSucesso(r) === '201' ? 'criado' : 'ok', content: { 'application/json': { schema: r.lista ? { type: 'array', items: ref(r.saida) } : ref(r.saida) } } } }
    const op: Record<string, unknown> = {
      operationId: r.id, tags: [r.origem.tipo === 'crud' ? r.origem.entidade : 'operacoes'],
      ...(parametros.length ? { parameters: parametros } : {}),
      ...(!emQuery && Object.keys(r.entrada).length ? { requestBody: { required: true, content: { 'application/json': { schema: entradaCorpo } } } } : {}),
      responses: { ...sucesso, '400': resp('requisição inválida'), ...(r.permissao === 'publica' ? {} : { '401': resp('não autenticado'), '403': resp('sem permissão') }), ...(r.params.length ? { '404': resp('não encontrado') } : {}), '409': resp('conflito (duplicado ou referência)') },
      security: r.permissao === 'publica' ? [] : [{ bearer: [] }],
      'x-acesso': { modo: r.permissao, ...(r.permissao === 'protegida' ? { acao: r.acao, sujeito: r.sujeito } : {}) }, ...(r.publica.length ? { 'x-publica': r.publica } : {}),
    }
    ;(paths[r.caminho] ??= {})[r.metodo] = op
  }
  const doc = {
    openapi: '3.1.0', info: { title: `Serviço ${no.id}`, version: no.versao, description: 'Gerado do schema (kind servico). Multi-tenant: o tenant vem da autenticação, nunca do corpo.' },
    paths, components: { schemas, securitySchemes: { bearer: { type: 'http', scheme: 'bearer', bearerFormat: 'JWT' } } },
    ...(spec.consome?.length ? { 'x-consome': spec.consome } : {}),
  }
  return JSON.stringify(sortKeys(doc), null, 2) + '\n'
}
function sortKeys(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(sortKeys)
  if (v && typeof v === 'object') return Object.fromEntries(Object.keys(v as object).filter((k) => (v as Record<string, unknown>)[k] !== undefined).sort().map((k) => [k, sortKeys((v as Record<string, unknown>)[k])]))
  return v
}
