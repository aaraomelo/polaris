process.env.POLARIS_LOG_NIVEL = 'silencio' // o serviço loga em JSON por padrão; os testes não precisam do ruído
import { PGlite } from '@electric-sql/pglite'
import { Registry, emite, rotasDe, type No } from '@polaris/schema'
import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { criaServico, dbDePglite, regrasDoRegistry, type Contexto } from '../src/index'

// Ponta a ponta: Fastify real + Postgres real (PGlite) com RLS, papel SEM bypass. O que se testa é o COMPORTAMENTO que o schema promete.

const A = '11111111-1111-1111-1111-111111111111', B = '22222222-2222-2222-2222-222222222222'
const LOJA: No = { kind: 'servico', id: 'loja', versao: '1.0.0', estatuto: 'publicado', spec: {
  entidades: {
    cliente: { campos: { nome: { tipo: 'texto', obrigatorio: true }, email: { tipo: 'texto' } }, crud: { caminho: '/clientes' } },
    produto: { campos: { sku: { tipo: 'texto', obrigatorio: true }, nome: { tipo: 'texto', obrigatorio: true }, preco: { tipo: 'dinheiro', obrigatorio: true }, estoque: { tipo: 'inteiro', padrao: 0 }, ativo: { tipo: 'booleano', padrao: true }, tags: { tipo: 'texto', lista: true }, extra: { tipo: 'json' }, lancadoEm: { tipo: 'data' }, peso: { tipo: 'decimal' } }, indices: [['sku']], busca: { campos: ['nome', 'sku'] }, crud: { caminho: '/produtos', permissao: 'catalogo' } },
    pedido: { campos: { clienteId: { tipo: 'uuid', obrigatorio: true, referencia: 'cliente' }, total: { tipo: 'dinheiro', obrigatorio: true }, situacao: { tipo: 'texto', padrao: 'aberto' } }, crud: { caminho: '/pedidos', operacoes: ['listar', 'obter', 'criar'] } },
    vitrine: { campos: { titulo: { tipo: 'texto' } }, crud: { caminho: '/vitrines', operacoes: ['listar'], permissao: 'publica' } },
    aviso: { campos: { texto: { tipo: 'texto' } }, crud: { caminho: '/avisos', operacoes: ['listar'], permissao: 'autenticada' } },
  },
  operacoes: {
    cancelar: { metodo: 'POST', caminho: '/pedidos/:id/cancelar', entrada: { id: { tipo: 'uuid', obrigatorio: true }, motivo: { tipo: 'texto' } }, saida: 'pedido', permissao: 'vendas', publica: ['pedido.cancelado'] },
    semImpl: { metodo: 'GET', caminho: '/nada', saida: 'cliente', lista: true },
    vaza: { metodo: 'GET', caminho: '/vaza', saida: 'cliente' },
    quebra: { metodo: 'POST', caminho: '/quebra', entrada: {}, permissao: 'vendas', publica: ['pedido.cancelado'] },
  },
} } as never
// (um pedido: pega o id e devolve com a situação alterada; "vaza" devolve campos que a API NÃO promete)

const TOKENS: Record<string, Contexto> = { tA: { tenantId: A, usuario: 'ana', papeis: ['catalogo', 'vendas'] }, tB: { tenantId: B, usuario: 'bia', papeis: ['catalogo', 'vendas'] }, tSemPerm: { tenantId: A, usuario: 'cadu', papeis: [] } }
const papel = (id: string, regras: object[]) => ({ kind: 'papel', id, versao: '1.0.0', estatuto: 'publicado', spec: { regras } }) as never
const REGISTRY = new Registry()
REGISTRY.registra(papel('catalogo', [{ acoes: ['manage'], sujeitos: ['loja.produto'] }]))
REGISTRY.registra(papel('vendas', [{ acoes: ['manage'], sujeitos: ['loja.cliente', 'loja.pedido'] }, { acoes: ['quebra'], sujeitos: ['loja.operacoes'] }]))
const HOSTS: Record<string, string> = { 'a.loja.test': A, 'b.loja.test': B }
const PEDIDO_CANCELADO = { kind: 'evento', id: 'pedido.cancelado', versao: '1.0.0', estatuto: 'publicado', spec: { nome: 'pedido.cancelado', produtor: 'loja', payload: { id: { tipo: 'uuid', obrigatorio: true }, motivo: { tipo: 'texto' } }, idempotencia: 'id' } } as never
const erros: unknown[] = []

let pg: PGlite, app: FastifyInstance
const req = (tok: string | null, metodo: string, url: string, corpo?: unknown, extra: Record<string, string> = {}) =>
  app.inject({ method: metodo as 'GET', url, headers: { ...(tok ? { authorization: `Bearer ${tok}` } : {}), ...(corpo !== undefined ? { 'content-type': 'application/json' } : {}), ...extra }, ...(corpo !== undefined ? { payload: JSON.stringify(corpo) } : {}) })
const json = (r: { body: string }) => JSON.parse(r.body)

beforeAll(async () => {
  pg = new PGlite()
  await pg.exec(`CREATE ROLE migrador NOLOGIN BYPASSRLS; CREATE ROLE app NOLOGIN; GRANT CREATE ON DATABASE postgres TO migrador; SET ROLE migrador;`)
  await pg.exec(emite(LOJA, 'sql'))
  await pg.exec(`RESET ROLE; GRANT USAGE ON SCHEMA loja TO app; GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA loja TO app; SET ROLE app;`) // a conexão da aplicação: SEM bypass
  app = criaServico(LOJA, {
    db: dbDePglite(pg),
    acesso: regrasDoRegistry(REGISTRY),
    contexto: (r) => { const a = String(r.headers.authorization ?? ''); if (a.startsWith('Bearer ')) return TOKENS[a.slice(7)] ?? null; const t = HOSTS[r.hostname]; return t ? { tenantId: t } : null },
    eventos: { 'pedido.cancelado': PEDIDO_CANCELADO },
    aoErro: (e) => { erros.push(e) },
    operacoes: {
      cancelar: async ({ params, entrada, q, publica }) => {
        const r = await q(`UPDATE loja.pedido SET situacao = 'cancelado' WHERE id = $1 RETURNING id::text AS "id", cliente_id::text AS "clienteId", total::text AS "total", situacao, criado_em::text AS "criadoEm", atualizado_em::text AS "atualizadoEm"`, [params.id])
        if (!r.rows[0]) { const { ErroApi } = await import('../src/index'); throw new ErroApi(404, 'nao_encontrado', 'pedido não encontrado') }
        await publica('pedido.cancelado', { id: params.id, ...(entrada.motivo ? { motivo: String(entrada.motivo) } : {}) })
        return { ...r.rows[0], criadoEm: '2026-01-01T00:00:00.000Z', atualizadoEm: '2026-01-01T00:00:00.000Z' }
      },
      vaza: async () => ({ id: A, nome: 'x', criadoEm: '2026-01-01T00:00:00.000Z', atualizadoEm: '2026-01-01T00:00:00.000Z', tenant_id: A, senhaHash: 'segredo', tenantId: A }),
      quebra: async ({ q, publica }) => {
        await publica('pedido.cancelado', { id: A }) // publicado, e a operação falha logo depois: o evento NÃO pode sobrar
  await q(`INSERT INTO loja.cliente (tenant_id, nome) VALUES ('${A}', 'fantasma')`); throw new Error('bug interno: SELECT secret FROM x') },
    },
  })
  await app.ready()
})
afterAll(async () => { await app.close(); await pg.close() })

describe('autenticação e autorização (antes de qualquer validação)', () => {
  it('sem credencial → 401 mesmo com corpo inválido (o anônimo não aprende o contrato pelos erros de validação)', async () => {
    const r = await req(null, 'POST', '/produtos', { lixo: true }); expect(r.statusCode).toBe(401); expect(json(r).erro.codigo).toBe('nao_autenticado')
    expect((await req('token-falso', 'GET', '/clientes')).statusCode).toBe(401)
  })
  it('credencial sem papel que permita → 403; com ele → ok; `autenticada` explícito basta estar autenticado', async () => {
    expect((await req('tSemPerm', 'GET', '/produtos')).statusCode).toBe(403)
    expect((await req('tSemPerm', 'GET', '/clientes')).statusCode).toBe(403) // sem papel, o padrão (protegida) NEGA
    expect((await req('tSemPerm', 'GET', '/avisos')).statusCode).toBe(200) // `autenticada` (explícito): basta estar autenticado
    expect((await req('tA', 'GET', '/produtos')).statusCode).toBe(200)
  })
  it('rota pública: sem token, o tenant vem do HOST; host desconhecido → 400 (nunca "todos os tenants")', async () => {
    await req('tA', 'POST', '/clientes', { nome: 'x' })
    expect((await req(null, 'GET', '/vitrines', undefined, { host: 'a.loja.test' })).statusCode).toBe(200)
    const r = await req(null, 'GET', '/vitrines', undefined, { host: 'estranho.test' }); expect(r.statusCode).toBe(400); expect(json(r).erro.codigo).toBe('tenant_nao_resolvido')
  })
  it('o tenant NÃO se escolhe por cabeçalho nem por corpo/query: x-tenant-id é ignorado e campo tenant é rejeitado', async () => {
    const r = await req('tA', 'POST', '/clientes', { nome: 'Ana', tenantId: B }); expect(r.statusCode).toBe(400); expect(json(r).erro.detalhes[0].mensagem).toContain("campo desconhecido 'tenantId'")
    expect((await req('tA', 'POST', '/clientes', { nome: 'Ana', tenant_id: B })).statusCode).toBe(400)
    expect((await req('tA', 'GET', `/clientes?tenantId=${B}`)).statusCode).toBe(400)
    const ok = await req('tA', 'POST', '/clientes', { nome: 'Cabeçalho' }, { 'x-tenant-id': B }); expect(ok.statusCode).toBe(201)
    await pg.exec('RESET ROLE; SET ROLE migrador') // o papel da aplicação só enxerga o próprio tenant; quem confere é o migrador (ignora RLS)
    expect((await pg.query(`SELECT tenant_id::text AS t FROM loja.cliente WHERE nome = 'Cabeçalho'`)).rows[0]).toEqual({ t: A })
    await pg.exec('RESET ROLE; SET ROLE app')
  })
})

describe('CRUD gerado do schema', () => {
  let id = ''
  it('criar: 201, aplica os padrões do schema, devolve só o contrato (sem tenant_id), dinheiro exato', async () => {
    const r = await req('tA', 'POST', '/produtos', { sku: 'P-1', nome: 'Pão', preco: '49.90', tags: ['a', 'b'], extra: { k: [1] }, lancadoEm: '2026-03-01', peso: 1.5 })
    expect(r.statusCode).toBe(201)
    const p = json(r); id = p.id
    expect(p).toMatchObject({ sku: 'P-1', nome: 'Pão', preco: '49.9000', estoque: 0, ativo: true, tags: ['a', 'b'], extra: { k: [1] }, lancadoEm: '2026-03-01', peso: 1.5 })
    expect(Object.keys(p).sort()).toEqual(['ativo', 'atualizadoEm', 'criadoEm', 'estoque', 'extra', 'id', 'lancadoEm', 'nome', 'peso', 'preco', 'sku', 'tags'])
    expect(p.criadoEm).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/)
  })
  it('validação: dinheiro como número é recusado (não vira "49.9"), faltando obrigatório, tipo, formato e campo extra — com mensagens em português', async () => {
    const mal = async (corpo: object, trecho: string) => { const r = await req('tA', 'POST', '/produtos', corpo); expect(r.statusCode, JSON.stringify(corpo)).toBe(400); expect(JSON.stringify(json(r).erro.detalhes)).toContain(trecho) }
    await mal({ sku: 'x', nome: 'n', preco: 49.9 }, 'tipo inválido')
    await mal({ sku: 'x', nome: 'n', preco: '1,5' }, 'formato inválido')
    await mal({ sku: 'x', preco: '1' }, "falta o campo 'nome'")
    await mal({ sku: 'x', nome: 'n', preco: '1', estoque: 1.5 }, 'tipo inválido')
    await mal({ sku: 'x', nome: 'n', preco: '1', estoque: 1e300 }, 'fora do limite')
    await mal({ sku: 'x', nome: 'n', preco: '1', lancadoEm: 'ontem' }, 'formato inválido')
    await mal({ sku: 'x', nome: 'n', preco: '1', segredo: 1 }, "campo desconhecido 'segredo'")
    expect(json(await req('tA', 'POST', '/produtos', {})).erro).toMatchObject({ codigo: 'requisicao_invalida' })
  })
  it('obter, listar (paginação e filtro por campo), atualizar parcial', async () => {
    await req('tA', 'POST', '/produtos', { sku: 'P-2', nome: 'Café', preco: '18.5' })
    await req('tA', 'POST', '/produtos', { sku: 'P-3', nome: 'Café', preco: '20' })
    expect(json(await req('tA', 'GET', `/produtos/${id}`)).nome).toBe('Pão')
    expect(json(await req('tA', 'GET', '/produtos?nome=Café')).map((x: { sku: string }) => x.sku)).toEqual(['P-2', 'P-3'])
    expect(json(await req('tA', 'GET', '/produtos?limite=2&pagina=1')).length).toBe(2)
    expect(json(await req('tA', 'GET', '/produtos?limite=2&pagina=2')).length).toBe(1)
    const u = await req('tA', 'PATCH', `/produtos/${id}`, { preco: '55.00' }); expect(u.statusCode).toBe(200)
    expect(json(u)).toMatchObject({ preco: '55.0000', nome: 'Pão' })
    expect(new Date(json(u).atualizadoEm).getTime()).toBeGreaterThanOrEqual(new Date(json(u).criadoEm).getTime())
  })
  it('busca: por palavras (todas), sem diferenciar maiúsculas NEM acentos, só neste tenant, com paginação e junto de filtros; o termo nunca vira SQL nem curinga', async () => {
    for (const [sku, nome] of [['B-1', 'Café Torrado Especial'], ['B-2', 'CAFEZINHO instantâneo'], ['B-3', 'Pão de Queijo'], ['B-4', 'Açaí 100% natural'], ['B-5', "Doce d'Água"], ['B-6', 'Cafe_Grão']] as const) await req('tA', 'POST', '/produtos', { sku, nome, preco: '10' })
    await req('tB', 'POST', '/produtos', { sku: 'B-9', nome: 'Café da B', preco: '10' })
    const b = async (q: string, tok = 'tA') => json(await req(tok, 'GET', `/produtos?busca=${encodeURIComponent(q)}&limite=50`)).map((x: { sku: string }) => x.sku).filter((k: string) => k.startsWith('B-')).sort()
    expect(await b('cafe')).toEqual(['B-1', 'B-2', 'B-6']); expect(await b('CAFÉ')).toEqual(['B-1', 'B-2', 'B-6']); expect(await b('acai')).toEqual(['B-4']); expect(await b('pao queijo')).toEqual(['B-3']) // todas as palavras, em qualquer ordem
    expect(await b('torrado cafe')).toEqual(['B-1']); expect(await b('b-3')).toEqual(['B-3']); expect(await b('agua')).toEqual(['B-5']); expect(await b('cafe', 'tB')).toEqual(['B-9']) // outro tenant
    expect(await b('100%')).toEqual(['B-4']); expect(await b("' OR 'x'='x")).toEqual([]); expect(await b("' OR 1=1 --")).toEqual(['B-1']) // vira as palavras or, 1, 1 (que casam de verdade com B-1): é texto, nunca SQL; expect(await b('x"; DROP TABLE produto; --')).toEqual([]); expect(await b('natural 100 acai')).toEqual(['B-4'])
    expect((await b('_')).length).toBeGreaterThan(5) // termo sem palavra (só pontuação) não filtra, em vez de virar curinga que casa com tudo "de propósito"
    expect(await b('cafe')).toHaveLength(3); const p1 = json(await req('tA', 'GET', '/produtos?busca=cafe&limite=2&pagina=1')), p2 = json(await req('tA', 'GET', '/produtos?busca=cafe&limite=2&pagina=2')); const p3 = json(await req('tA', 'GET', '/produtos?busca=cafe&limite=2&pagina=3')); expect([p1.length, p2.length, p3.length]).toEqual([2, 2, 1]) // 5 no total (3 destes + os 2 "Café" dos testes anteriores)
    expect(json(await req('tA', 'GET', `/produtos?busca=cafe&sku=B-2`)).map((x: { sku: string }) => x.sku)).toEqual(['B-2']) // junto de filtro por campo
  })
  it('busca: parâmetro acima de 100 caracteres → 400; entidade sem `busca` declarada recusa o parâmetro', async () => {
    expect((await req('tA', 'GET', `/produtos?busca=${'a'.repeat(101)}`)).statusCode).toBe(400); expect((await req('tA', 'GET', `/clientes?busca=x`)).statusCode).toBe(400)
  })
  it('limites: limite > 100, pagina 0, parâmetro desconhecido e atualização vazia → 400', async () => {
    for (const q of ['limite=101', 'limite=0', 'pagina=0', 'pagina=abc', 'naoExiste=1']) expect((await req('tA', 'GET', `/produtos?${q}`)).statusCode, q).toBe(400)
    expect((await req('tA', 'PATCH', `/produtos/${id}`, {})).statusCode).toBe(400)
  })
  it('id malformado → 400; inexistente → 404; remover → 204 e depois 404', async () => {
    expect((await req('tA', 'GET', '/produtos/nao-e-uuid')).statusCode).toBe(400)
    expect((await req('tA', 'GET', `/produtos/${A}`)).statusCode).toBe(404)
    const c = json(await req('tA', 'POST', '/produtos', { sku: 'DEL', nome: 'x', preco: '1' }))
    const d = await req('tA', 'DELETE', `/produtos/${c.id}`); expect(d.statusCode).toBe(204); expect(d.body).toBe('')
    expect((await req('tA', 'DELETE', `/produtos/${c.id}`)).statusCode).toBe(404)
  })
  it('conflito de unicidade e referência inválida viram 409 (não 500)', async () => {
    await pg.exec(`RESET ROLE; SET ROLE migrador; CREATE UNIQUE INDEX IF NOT EXISTS sku_unico ON loja.produto (tenant_id, sku); RESET ROLE; SET ROLE app;`)
    expect((await req('tA', 'POST', '/produtos', { sku: 'P-1', nome: 'dup', preco: '1' })).statusCode).toBe(409)
    const r = await req('tA', 'POST', '/pedidos', { clienteId: A, total: '1' }); expect(r.statusCode).toBe(409); expect(json(r).erro.codigo).toBe('referencia_invalida')
  })
})

describe('isolamento entre tenants (a RLS é a barreira final)', () => {
  it('o que A cria, B não vê: nem na lista, nem por id (404, não 403: não revela que existe), nem altera, nem remove', async () => {
    const p = json(await req('tA', 'POST', '/produtos', { sku: 'SO-A', nome: 'Só do A', preco: '9' }))
    expect(json(await req('tB', 'GET', '/produtos')).map((x: { sku: string }) => x.sku)).not.toContain('SO-A')
    expect((await req('tB', 'GET', `/produtos/${p.id}`)).statusCode).toBe(404)
    expect((await req('tB', 'PATCH', `/produtos/${p.id}`, { nome: 'hack' })).statusCode).toBe(404)
    expect((await req('tB', 'DELETE', `/produtos/${p.id}`)).statusCode).toBe(404)
    expect(json(await req('tA', 'GET', `/produtos/${p.id}`)).nome).toBe('Só do A')
  })
  it('referência cruzada é recusada: B aponta para o cliente de A sabendo o id → 409', async () => {
    const c = json(await req('tA', 'POST', '/clientes', { nome: 'Cliente do A' }))
    expect((await req('tB', 'POST', '/pedidos', { clienteId: c.id, total: '5' })).statusCode).toBe(409)
    expect((await req('tA', 'POST', '/pedidos', { clienteId: c.id, total: '5' })).statusCode).toBe(201)
  })
  it('20 requisições concorrentes de dois tenants: cada uma só enxerga o seu (o tenant da transação não vaza entre elas)', async () => {
    await req('tA', 'POST', '/clientes', { nome: 'marca-A' }); await req('tB', 'POST', '/clientes', { nome: 'marca-B' })
    const rs = await Promise.all(Array.from({ length: 20 }, (_, i) => req(i % 2 ? 'tB' : 'tA', 'GET', '/clientes')))
    rs.forEach((r, i) => { const nomes = json(r).map((c: { nome: string }) => c.nome); expect(nomes).toContain(i % 2 ? 'marca-B' : 'marca-A'); expect(nomes).not.toContain(i % 2 ? 'marca-A' : 'marca-B') })
  })
})

describe('operações declaradas, eventos e erros', () => {
  it('operação implementada: roda na transação do tenant; o evento vai para o OUTBOX na mesma transação (versão, tenant e chave de idempotência)', async () => {
    const c = json(await req('tA', 'POST', '/clientes', { nome: 'Comprador' }))
    const p = json(await req('tA', 'POST', '/pedidos', { clienteId: c.id, total: '10' }))
    const outbox = async () => { await pg.exec('RESET ROLE; SET ROLE migrador'); const r = (await pg.query(`SELECT tipo, versao, tenant_id::text AS t, chave, payload, publicado_em FROM loja.outbox ORDER BY ocorrido_em`)).rows; await pg.exec('RESET ROLE; SET ROLE app'); return r }
    const antes = (await outbox()).length
    const r = await req('tA', 'POST', `/pedidos/${p.id}/cancelar`, { motivo: 'desistiu' })
    expect(r.statusCode).toBe(200); expect(json(r).situacao).toBe('cancelado')
    const depois = await outbox()
    expect(depois.length).toBe(antes + 1)
    expect(depois.at(-1)).toEqual({ tipo: 'pedido.cancelado', versao: '1.0.0', t: A, chave: p.id, payload: { id: p.id, motivo: 'desistiu' }, publicado_em: null })
    expect((await req('tB', 'POST', `/pedidos/${p.id}/cancelar`, {})).statusCode).toBe(404) // outro tenant: a RLS esconde
    expect((await outbox()).length).toBe(antes + 1) // e a falha não publicou nada
  })
  it('sem implementação → 501; sem a permissão → 403', async () => {
    const r = await req('tA', 'GET', '/nada'); expect(r.statusCode).toBe(501); expect(json(r).erro.codigo).toBe('nao_implementado')
    expect((await req('tSemPerm', 'POST', '/quebra', {})).statusCode).toBe(403)
  })
  it('a resposta é FILTRADA pelo esquema de saída: campos que a API não promete (tenant_id, segredo) nunca saem', async () => {
    const r = json(await req('tA', 'GET', '/vaza'))
    expect(Object.keys(r).sort()).toEqual(['atualizadoEm', 'criadoEm', 'id', 'nome'])
    expect(JSON.stringify(r)).not.toMatch(/segredo|senhaHash|tenant/i)
  })
  it('erro inesperado → 500 genérico (a mensagem interna não vaza), é reportado, e a transação DESFEZ o que fez antes de falhar', async () => {
    erros.length = 0
    const r = await req('tA', 'POST', '/quebra', {}); expect(r.statusCode).toBe(500)
    expect(json(r)).toEqual({ erro: { codigo: 'erro_interno', mensagem: 'erro interno', requisicaoId: expect.stringMatching(/^[0-9a-f-]{36}$/) } }); expect(r.headers['x-request-id']).toBe(json(r).erro.requisicaoId); expect(r.body).not.toMatch(/SELECT|secret|bug interno/)
    expect(String((erros[0] as Error).message)).toContain('bug interno')
    await pg.exec('RESET ROLE; SET ROLE migrador')
    expect((await pg.query(`SELECT count(*)::int AS n FROM loja.cliente WHERE nome = 'fantasma'`)).rows[0]).toEqual({ n: 0 }) // rollback
    expect((await pg.query(`SELECT count(*)::int AS n FROM loja.outbox WHERE chave = $1`, [A])).rows[0]).toEqual({ n: 0 }) // …e o evento publicado antes da falha também foi desfeito
    await pg.exec('RESET ROLE; SET ROLE app')
  })
})

describe('contratos de evento', () => {
  it('serviço que declara `publica` sem o nó evento nem sobe (falha rápida, com o nome do evento)', () => {
    expect(() => criaServico(LOJA, { db: dbDePglite(pg), acesso: regrasDoRegistry(REGISTRY), contexto: () => null })).toThrow(/faltam os nós evento de pedido\.cancelado/)
  })
  it('publicar um evento não declarado na operação, ou com payload fora do contrato, é erro de programação: 500 e NADA no outbox', async () => {
    const mk = (impl: (e: any) => Promise<unknown>) => criaServico(LOJA, { db: dbDePglite(pg), acesso: regrasDoRegistry(REGISTRY), contexto: () => TOKENS.tA!, eventos: { 'pedido.cancelado': PEDIDO_CANCELADO }, operacoes: { quebra: impl as never } })
    for (const impl of [
      async ({ publica }: any) => { await publica('pedido.outro', { id: A }) },
      async ({ publica }: any) => { await publica('pedido.cancelado', { id: 'x' }) },
      async ({ publica }: any) => { await publica('pedido.cancelado', { id: A, nada: 1 }) },
    ]) { const a = mk(impl); const r = await a.inject({ method: 'POST', url: '/quebra', headers: { 'content-type': 'application/json' }, payload: '{}' }); expect(r.statusCode).toBe(500); await a.close() }
    await pg.exec('RESET ROLE; SET ROLE migrador')
    expect((await pg.query(`SELECT count(*)::int AS n FROM loja.outbox WHERE chave = $1`, [A])).rows[0]).toEqual({ n: 0 })
    await pg.exec('RESET ROLE; SET ROLE app')
  })
})

describe('bordas HTTP', () => {
  it('corpo grande demais → 413; tipo de conteúdo errado → 415; rota inexistente → 404 no mesmo formato', async () => {
    const grande = await req('tA', 'POST', '/clientes', { nome: 'x'.repeat(200 * 1024) }); expect(grande.statusCode).toBe(413); expect(json(grande).erro.codigo).toBe('corpo_grande_demais')
    const tipo = await app.inject({ method: 'POST', url: '/clientes', headers: { authorization: 'Bearer tA', 'content-type': 'text/plain' }, payload: 'nome=x' }); expect(tipo.statusCode).toBe(415)
    const nf = await req('tA', 'GET', '/nao/existe'); expect(nf.statusCode).toBe(404); expect(json(nf).erro.codigo).toBe('rota_inexistente')
  })
  it('cabeçalhos de segurança e saúde pública', async () => {
    const s = await req(null, 'GET', '/saude'); expect(s.statusCode).toBe(200); expect(json(s)).toEqual({ ok: true, servico: 'loja', versao: '1.0.0' })
    expect(s.headers['x-content-type-options']).toBe('nosniff'); expect(s.headers['cache-control']).toBe('no-store')
  })
  it('o serviço serve EXATAMENTE as rotas que o OpenAPI documenta', () => {
    for (const r of rotasDe(LOJA)) expect(app.hasRoute({ method: r.metodo.toUpperCase() as 'GET', url: r.caminhoFastify }), `${r.metodo} ${r.caminho}`).toBe(true)
    const doc = JSON.parse(emite(LOJA, 'openapi')); expect(Object.values<object>(doc.paths).flatMap((p) => Object.keys(p)).length).toBe(rotasDe(LOJA).length)
  })
})
