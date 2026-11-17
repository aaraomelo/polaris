import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { rotasDe } from '@polaris/schema'
import { A, LOJA, criaAmbiente, type Ambiente } from './ambiente'

let e: Ambiente, clienteId: string, produtoId: string
beforeAll(async () => { e = await criaAmbiente(); clienteId = (await e.semear()).clienteId; produtoId = (await e.bruto(`SELECT id::text AS id FROM loja.produto WHERE tenant_id = $1`, [A]))[0]!.id })
afterAll(async () => { await e.fim() })
const n = () => e.clienteLoja.chamadas.length
const ana = () => e.token('ana', A, ['vendedor'])

describe('REST gerado dos schemas', () => {
  it('toda rota do serviço existe no gateway, sob /api/<servico>', () => {
    for (const r of rotasDe(LOJA)) expect(e.gw.hasRoute({ method: r.metodo.toUpperCase() as 'GET', url: `/api/loja${r.caminhoFastify}` }), `${r.metodo} ${r.caminho}`).toBe(true)
  })
  it('rota pública sem token (tenant pelo host); protegida sem usuário → 401 AQUI, sem incomodar o serviço; token inválido → 401', async () => {
    const antes = n()
    expect((await e.req('GET', '/api/loja/vitrines')).statusCode).toBe(200)
    expect(n()).toBe(antes + 1)
    expect((await e.req('GET', '/api/loja/produtos')).statusCode).toBe(401)
    for (const tok of ['lixo.lixo.lixo', 'x']) expect((await e.req('GET', '/api/loja/produtos', { headers: { authorization: `Bearer ${tok}` } })).statusCode).toBe(401)
    expect(n()).toBe(antes + 1) // nenhuma dessas chegou ao serviço
  })
  it('repassa status e corpo: criar é 201, obter 200, remover 204, e a resposta respeita o contrato', async () => {
    const tok = await ana()
    const c = await e.req('POST', '/api/loja/produtos', { tok, corpo: { nome: 'Torta', preco: '30.00' } })
    expect(c.statusCode).toBe(201); const id = e.json(c).id
    expect(e.json(await e.req('GET', `/api/loja/produtos/${id}`, { tok }))).toMatchObject({ nome: 'Torta', preco: '30.0000' })
    const d = await e.req('DELETE', `/api/loja/produtos/${id}`, { tok }); expect(d.statusCode).toBe(204); expect(d.body).toBe('')
  })
  it('VALIDA NA BORDA com o mesmo schema do serviço: inválido é 400 e NÃO chega ao serviço', async () => {
    const tok = await ana(); const antes = n()
    const ruins: Array<[string, string, unknown]> = [
      ['POST', '/api/loja/produtos', { nome: 'x', preco: 30 }], // dinheiro como número
      ['POST', '/api/loja/produtos', { nome: 'x' }], // falta preco
      ['POST', '/api/loja/produtos', { nome: 'x', preco: '1', tenantId: 'outro' }], // campo desconhecido (tenant jamais por aqui)
      ['GET', '/api/loja/produtos/nao-e-uuid', undefined], ['GET', '/api/loja/produtos?limite=101', undefined], ['GET', '/api/loja/produtos?naoExiste=1', undefined],
      ['GET', `/api/loja/produtos/${produtoId}%2F..%2F..%2Fx`, undefined], ['GET', '/api/loja/produtos/..%2f..%2fadmin', undefined],
    ]
    for (const [m, u, corpo] of ruins) { const r = await e.req(m, u, { tok, ...(corpo !== undefined ? { corpo } : {}) }); expect([400, 404], `${m} ${u}`).toContain(r.statusCode) }
    expect(n()).toBe(antes)
  })
  it('o 4xx do serviço passa com o TEXTO do serviço; 5xx e falha de rede viram 502/504 OPACOS (nada interno vaza)', async () => {
    const tok = await ana()
    const nf = await e.req('GET', `/api/loja/produtos/00000000-0000-0000-0000-0000000000aa`, { tok })
    expect(nf.statusCode).toBe(404); expect(e.json(nf).erro).toMatchObject({ codigo: 'nao_encontrado' })
    const r5 = await e.req('POST', '/api/loja/quebra', { tok, corpo: {} }) // o serviço lança com um "segredo interno" na mensagem
    expect(r5.statusCode).toBe(403) // o vendedor nem tem a regra de `quebra`
    const t2 = await e.token('ana', A, ['vendedor'])
    void t2
    e.clienteLoja.estado.falha = () => { throw new e.FalhaServico('conexão recusada em 10.0.0.7:5432 postgres://u:p@h') }
    const r = await e.req('GET', '/api/loja/produtos', { tok }); e.clienteLoja.estado.falha = null
    expect(r.statusCode).toBe(502); expect(r.body).not.toMatch(/10\.0\.0|postgres|conexão/); expect(e.json(r).erro.codigo).toBe('servico_indisponivel'); expect(e.json(r).erro.requisicaoId).toBe(r.headers['x-request-id'])
    e.clienteLoja.estado.falha = () => { throw new e.FalhaServico('tempo esgotado ou chamada cancelada') }
    expect((await e.req('GET', '/api/loja/produtos', { tok })).statusCode).toBe(504); e.clienteLoja.estado.falha = null
  })
  it('corpo grande demais → 413; tipo de conteúdo diferente de JSON → 415', async () => {
    const tok = await ana()
    expect((await e.req('POST', '/api/loja/produtos', { tok, corpo: { nome: 'x'.repeat(200 * 1024), preco: '1' } })).statusCode).toBe(413)
    expect((await e.gw.inject({ method: 'POST', url: '/api/loja/produtos', headers: { host: 'a.loja.test', authorization: `Bearer ${tok}`, 'content-type': 'text/plain' }, payload: 'x' })).statusCode).toBe(415)
  })
})

describe('GraphQL gerado', () => {
  const gql = async (query: string, o: { tok?: string | null; variables?: object; host?: string; corpo?: unknown } = {}) => {
    const r = await e.req('POST', '/graphql', { tok: o.tok === undefined ? await ana() : o.tok, corpo: o.corpo ?? { query, ...(o.variables ? { variables: o.variables } : {}) }, ...(o.host ? { host: o.host } : {}) })
    return { status: r.statusCode, ...e.json(r) } as { status: number; data?: any; errors?: Array<{ message: string; extensions?: Record<string, any> }> }
  }
  it('consulta lista e obtém; a lista traz só o que o papel alcança', async () => {
    const r = await gql('{ loja_listarProduto { id nome preco } loja_obterCliente(id: "' + clienteId + '") { nome } }')
    expect(r.errors).toBeUndefined(); expect(r.data.loja_listarProduto.map((p: any) => p.nome)).toEqual(['Pão']); expect(r.data.loja_obterCliente.nome).toBe('Cliente A')
  })
  it('RELAÇÃO navegável (pedido.cliente), resolvida pelo `obter` do serviço — e com MEMO: 3 pedidos do mesmo cliente = 1 chamada', async () => {
    const tok = await ana()
    for (let i = 0; i < 3; i++) await e.appLoja.inject({ method: 'POST', url: '/pedidos', headers: { authorization: `Bearer ${tok}`, 'content-type': 'application/json' }, payload: JSON.stringify({ criadoPor: 'ana', clienteId, total: `${i + 1}.00` }) })
    const antes = e.clienteLoja.chamadas.filter((c) => /\/clientes\//.test(c.caminho)).length
    const r = await gql('{ loja_listarPedido { total cliente { nome } } }')
    expect(r.errors).toBeUndefined(); expect(r.data.loja_listarPedido.length).toBe(3); expect(r.data.loja_listarPedido.every((p: any) => p.cliente.nome === 'Cliente A')).toBe(true)
    expect(e.clienteLoja.chamadas.filter((c) => /\/clientes\//.test(c.caminho)).length - antes).toBe(1)
  })
  it('mutação cria com `entrada`; DINHEIRO como número é recusado pelo escalar; como texto passa', async () => {
    const ok = await gql('mutation($e: LojaCriarProdutoEntrada!) { loja_criarProduto(entrada: $e) { nome preco } }', { variables: { e: { nome: 'Pudim', preco: '8.00' } } })
    expect(ok.errors).toBeUndefined(); expect(ok.data.loja_criarProduto).toEqual({ nome: 'Pudim', preco: '8.0000' })
    const ruim = await gql('mutation($e: LojaCriarProdutoEntrada!) { loja_criarProduto(entrada: $e) { nome } }', { variables: { e: { nome: 'x', preco: 8 } } })
    expect(ruim.data).toBeFalsy(); expect(JSON.stringify(ruim.errors)).toMatch(/dinheiro deve ser texto/)
  })
  it('mutação exige USUÁRIO (anônimo 401); sem permissão volta o 4xx do serviço com extensions; o 5xx é opaco', async () => {
    const m = 'mutation { loja_criarProduto(entrada: { nome: "x", preco: "1" }) { id } }'
    expect((await gql(m, { tok: null })).status).toBe(401)
    const proib = await gql(m, { tok: await e.token('sem', A, []) })
    expect(proib.errors![0]!.extensions).toMatchObject({ codigo: 'proibido', status: 403 })
    e.clienteLoja.estado.falha = () => { throw new e.FalhaServico('postgres://u:senha@h caiu') }
    const r5 = await gql('{ loja_listarProduto { id } }'); e.clienteLoja.estado.falha = null
    expect(JSON.stringify(r5)).not.toMatch(/postgres|senha/); expect(r5.errors![0]!.extensions).toMatchObject({ codigo: 'servico_indisponivel' })
  })
  it('LIMITES: profundidade, aliases, campos de raiz e complexidade (listas multiplicam) recusam a consulta CARA antes de executar', async () => {
    const antes = n()
    const fundo = await gql('{ loja_listarPedido { cliente { id pedidosFalsos } } }'); void fundo
    const prof = await gql('{ loja_listarPedido { cliente { nome } } }'); expect(prof.status).toBe(200) // profundidade 3: ok
    const muito = await gql(`{ ${Array.from({ length: 25 }, (_, i) => `a${i}: loja_listarProduto { id }`).join(' ')} }`)
    expect(muito.status).toBe(400); expect(muito.errors![0]!.extensions).toMatchObject({ codigo: 'consulta_cara' })
    const raiz = await gql(`{ ${Array.from({ length: 11 }, (_, i) => `loja_listarProduto${i % 2 ? '' : '(limite: 1)'} { id }`).join(' ')} }`) // aliases ausentes: duplicados → inválida
    expect([400]).toContain(raiz.status)
    // 8 listas de até 100 itens, cada uma com uma relação: 8 × (1 + 3×100) = 2408 > 2000
    const cara = await gql(`{ ${Array.from({ length: 8 }, (_, i) => `l${i}: loja_listarPedido(limite: 100) { total cliente { nome } }`).join(' ')} }`)
    expect(cara.status).toBe(400); expect(cara.errors![0]!.message).toMatch(/complexidade 2408/)
    const barata = await gql('{ loja_listarPedido(limite: 5) { total cliente { nome } } }'); expect(barata.status).toBe(200) // o mesmo formato, com limite pequeno
    void antes
  })
  it('INTROSPECÇÃO desligada por padrão; as sugestões ("Did you mean") são mascaradas; consulta malformada → 400', async () => {
    const i = await gql('{ __schema { types { name } } }'); expect(i.status).toBe(400); expect(JSON.stringify(i.errors)).toMatch(/introspec/i)
    const t = await gql('{ loja_listarProdut { id } }'); expect(t.status).toBe(400); expect(JSON.stringify(t.errors)).not.toMatch(/Did you mean|listarProduto/)
    expect((await gql('{ loja_listarProduto { id ')).status).toBe(400)
  })
  it('só POST de JSON, sem lote (array) e sem campos extras; GET não existe', async () => {
    expect((await e.req('GET', '/graphql?query={a}', { tok: await ana() })).statusCode).toBe(404)
    expect((await gql('', { corpo: [{ query: '{ loja_listarProduto { id } }' }, { query: '{ loja_listarProduto { id } }' }] })).status).toBe(400) // lote
    expect((await gql('', { corpo: { query: '{ loja_listarProduto { id } }', extra: 1 } })).status).toBe(400)
    expect((await gql('', { corpo: { query: 'x'.repeat(10_001) } })).status).toBe(400)
  })
  it('o tenant NÃO vem do cliente: variável/cabeçalho de tenant não existem; o dado é o do token', async () => {
    const r = await e.req('POST', '/graphql', { tok: await e.token('beto', '22222222-2222-2222-2222-222222222222', ['vendedor']), host: 'b.loja.test', headers: { 'x-tenant-id': A }, corpo: { query: '{ loja_listarProduto { nome } }' } })
    expect(e.json(r).data.loja_listarProduto.map((p: any) => p.nome)).toEqual(['Só do B'])
  })
})

describe('GraphQL com introspecção ligada (opt-in)', () => {
  it('o schema gerado é navegável quando se pede: tipos por serviço+entidade, escalares próprios, consultas e mutações prefixadas', async () => {
    const e2 = await criaAmbiente({ gateway: { graphql: { introspeccao: true } } })
    try {
      const r = await e2.req('POST', '/graphql', { tok: await e2.token('ana', A, ['vendedor']), corpo: { query: '{ __schema { queryType { fields { name } } mutationType { fields { name } } types { name } } }' } })
      const j = e2.json(r); expect(r.statusCode).toBe(200)
      const q = j.data.__schema.queryType.fields.map((f: any) => f.name), mu = j.data.__schema.mutationType.fields.map((f: any) => f.name), tipos = j.data.__schema.types.map((t: any) => t.name)
      expect(q).toEqual(expect.arrayContaining(['loja_listarProduto', 'loja_obterCliente', 'loja_listarVitrine'])); expect(mu).toEqual(expect.arrayContaining(['loja_criarProduto', 'loja_removerProduto', 'loja_quebra']))
      expect(tipos).toEqual(expect.arrayContaining(['LojaProduto', 'LojaPedido', 'Dinheiro', 'Uuid', 'DataHora', 'LojaCriarProdutoEntrada']))
    } finally { await e2.fim() }
  })
})

describe('GraphQL: limites configuráveis', () => {
  it('profundidade máxima configurada recusa a consulta funda (o schema real é raso; o limite existe para o que vier)', async () => {
    const e2 = await criaAmbiente({ gateway: { graphql: { profundidadeMax: 2 } } })
    try {
      const tok = await e2.token('ana', A, ['vendedor'])
      const q = (query: string) => e2.req('POST', '/graphql', { tok, corpo: { query } })
      expect((await q('{ loja_listarPedido { total } }')).statusCode).toBe(200) // profundidade 2
      const r = await q('{ loja_listarPedido { cliente { nome } } }'); expect(r.statusCode).toBe(400) // 3
      expect(e2.json(r).errors[0].message).toMatch(/profundidade 3 excede o limite \(2\)/)
    } finally { await e2.fim() }
  })
})
