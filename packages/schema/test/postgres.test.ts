import { vi } from 'vitest'
vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 }) // sobe um Postgres (WASM): com várias suítes em paralelo, 5 s é pouco
import { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { emite, type No } from '../src/index'

// A emissão SQL contra um Postgres DE VERDADE (PGlite: Postgres 18 em WASM, no processo). O que importa não é o texto do SQL e sim o que o banco faz:
// isolamento por tenant em SELECT/INSERT/UPDATE/DELETE, falha FECHADA sem tenant, dono da tabela também sujeito à política, dinheiro exato.

const servico = (id: string, entidades: object, extra: object = {}): No => ({ kind: 'servico', id, versao: '1.0.0', estatuto: 'publicado', spec: { entidades, operacoes: {}, ...extra } }) as never
const CATALOGO = servico('catalogo', {
  produto: { campos: { sku: { tipo: 'texto', obrigatorio: true }, nome: { tipo: 'texto', obrigatorio: true }, preco: { tipo: 'dinheiro', obrigatorio: true }, ativo: { tipo: 'booleano', padrao: true }, tags: { tipo: 'texto', lista: true }, extra: { tipo: 'json' } }, indices: [['sku']] },
})
const A = '11111111-1111-1111-1111-111111111111', B = '22222222-2222-2222-2222-222222222222'

let db: PGlite
const como = async (tenant: string | null, sql: string, params: unknown[] = []) => {
  await db.exec(`RESET ROLE; SET ROLE app; ${tenant === null ? "SELECT set_config('app.tenant_id', '', false)" : `SELECT set_config('app.tenant_id', '${tenant}', false)`};`)
  return db.query(sql, params)
}
const insere = (tenant: string | null, sku: string, tenantNaLinha: string = tenant ?? A) =>
  como(tenant, `INSERT INTO catalogo.produto (tenant_id, sku, nome, preco) VALUES ($1, $2, $3, '10.50') RETURNING id`, [tenantNaLinha, sku, `Produto ${sku}`])

beforeAll(async () => {
  db = new PGlite()
  await db.exec(`CREATE ROLE dono NOLOGIN; CREATE ROLE app NOLOGIN; GRANT dono TO app; GRANT CREATE ON DATABASE postgres TO dono;`)
  await db.exec(`SET ROLE dono;`) // as tabelas pertencem a um papel comum (não superusuário): FORCE RLS tem de valer até para o dono
  await db.exec(emite(CATALOGO, 'sql'))
  await db.exec(`RESET ROLE; GRANT USAGE ON SCHEMA catalogo TO app; GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA catalogo TO app;`)
})
afterAll(async () => { await db.close() })

describe('RLS por tenant, no Postgres', () => {
  it('cada tenant vê só as próprias linhas', async () => {
    await insere(A, 'a1'); await insere(A, 'a2'); await insere(B, 'b1')
    expect((await como(A, 'SELECT sku FROM catalogo.produto ORDER BY sku')).rows.map((r: any) => r.sku)).toEqual(['a1', 'a2'])
    expect((await como(B, 'SELECT sku FROM catalogo.produto')).rows.map((r: any) => r.sku)).toEqual(['b1'])
  })
  it('UPDATE e DELETE de linha alheia afetam 0 linhas', async () => {
    const u = await como(B, `UPDATE catalogo.produto SET nome = 'hack' WHERE sku = 'a1'`); expect(u.affectedRows).toBe(0)
    const d = await como(B, `DELETE FROM catalogo.produto WHERE sku = 'a1'`); expect(d.affectedRows).toBe(0)
    expect((await como(A, `SELECT nome FROM catalogo.produto WHERE sku = 'a1'`)).rows[0]).toEqual({ nome: 'Produto a1' })
  })
  it('INSERT com tenant_id de OUTRO tenant é recusado (WITH CHECK); UPDATE que move a linha para outro tenant também', async () => {
    await expect(insere(B, 'forjada', A)).rejects.toThrow(/row-level security/)
    await expect(como(A, `UPDATE catalogo.produto SET tenant_id = $1 WHERE sku = 'a1'`, [B])).rejects.toThrow(/row-level security/)
  })
  it('sem tenant definido (ou vazio) a consulta volta VAZIA e a escrita é recusada: falha fechada, sem erro de configuração', async () => {
    expect((await como(null, 'SELECT * FROM catalogo.produto')).rows).toEqual([])
    await expect(insere(null, 'x')).rejects.toThrow(/row-level security/)
    await db.exec(`RESET ROLE; SET ROLE app; RESET app.tenant_id;`)
    expect((await db.query('SELECT * FROM catalogo.produto')).rows).toEqual([]) // parâmetro nunca definido na sessão
  })
  it('tenant_id malformado não vaza nem derruba: nenhuma linha', async () => {
    await db.exec(`RESET ROLE; SET ROLE app; SELECT set_config('app.tenant_id', 'nao-e-uuid', false);`).catch(() => {})
    await expect(db.query('SELECT * FROM catalogo.produto')).rejects.toThrow() // recusa (cast) em vez de devolver linhas
  })
  it('o DONO da tabela também está sujeito à política (FORCE ROW LEVEL SECURITY)', async () => {
    await db.exec(`RESET ROLE; SET ROLE dono; SELECT set_config('app.tenant_id', '${B}', false);`)
    expect((await db.query('SELECT sku FROM catalogo.produto')).rows.map((r: any) => r.sku)).toEqual(['b1'])
  })
})

describe('tipos no Postgres', () => {
  it('dinheiro é numeric(19,4): 0,1 + 0,2 = 0,3 exato, e 15 casas inteiras cabem', async () => {
    await como(A, `INSERT INTO catalogo.produto (tenant_id, sku, nome, preco) VALUES ($1, 'm1', 'm', '0.1'), ($1, 'm2', 'm', '0.2'), ($1, 'm3', 'm', '123456789012345.1234')`, [A])
    const r = await como(A, `SELECT (SELECT sum(preco)::text FROM catalogo.produto WHERE sku IN ('m1','m2')) AS soma, (SELECT preco::text FROM catalogo.produto WHERE sku = 'm3') AS grande`)
    expect(r.rows[0]).toEqual({ soma: '0.3000', grande: '123456789012345.1234' })
  })
  it('padrão, lista e json funcionam; coluna reservada e índice por tenant existem', async () => {
    await como(A, `INSERT INTO catalogo.produto (tenant_id, sku, nome, preco, tags, extra) VALUES ($1, 't1', 'n', '1', ARRAY['a','b'], '{"k":[1,2]}')`, [A])
    const r = await como(A, `SELECT ativo, tags, extra FROM catalogo.produto WHERE sku = 't1'`)
    expect(r.rows[0]).toEqual({ ativo: true, tags: ['a', 'b'], extra: { k: [1, 2] } })
    const idx = (await db.query(`SELECT indexdef FROM pg_indexes WHERE schemaname = 'catalogo' AND tablename = 'produto'`)).rows.map((x: any) => x.indexdef as string)
    expect(idx.some((d) => /\(tenant_id, sku\)/.test(d))).toBe(true)
  })
})

describe('referências entre entidades NÃO cruzam tenants (FK composta)', () => {
  const PEDIDOS = servico('pedidos', {
    cliente: { campos: { nome: { tipo: 'texto', obrigatorio: true } } },
    pedido: { campos: { clienteId: { tipo: 'uuid', obrigatorio: true, referencia: 'cliente' }, indicadoPorId: { tipo: 'uuid', referencia: 'cliente' } } },
  })
  let db2: PGlite
  const q = async (t: string, sql: string, p: unknown[] = []) => { await db2.exec(`RESET ROLE; SET ROLE app; SELECT set_config('app.tenant_id', '${t}', false);`); return db2.query(sql, p) }
  beforeAll(async () => {
    db2 = new PGlite()
    await db2.exec(`CREATE ROLE dono NOLOGIN; CREATE ROLE app NOLOGIN; GRANT dono TO app; GRANT CREATE ON DATABASE postgres TO dono; SET ROLE dono;`)
    await db2.exec(emite(PEDIDOS, 'sql'))
    await db2.exec(emite(PEDIDOS, 'sql')) // idempotente: reaplicar não falha
    await db2.exec(`RESET ROLE; GRANT USAGE ON SCHEMA pedidos TO app; GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA pedidos TO app;`)
  })
  afterAll(async () => { await db2.close() })
  it('o tenant referencia o PRÓPRIO cliente; o opcional nulo é aceito', async () => {
    const c = await q(A, `INSERT INTO pedidos.cliente (tenant_id, nome) VALUES ($1, 'Ana') RETURNING id`, [A])
    const id = (c.rows[0] as any).id
    await q(A, `INSERT INTO pedidos.pedido (tenant_id, cliente_id) VALUES ($1, $2)`, [A, id])
    expect((await q(A, 'SELECT count(*)::int AS n FROM pedidos.pedido')).rows[0]).toEqual({ n: 1 })
  })
  it('apontar para o cliente de OUTRO tenant é recusado, mesmo sabendo o id (a checagem do Postgres ignora a RLS: só a FK composta segura)', async () => {
    const c = await q(A, `INSERT INTO pedidos.cliente (tenant_id, nome) VALUES ($1, 'Bia') RETURNING id`, [A])
    const idDeA = (c.rows[0] as any).id
    await expect(q(B, `INSERT INTO pedidos.pedido (tenant_id, cliente_id) VALUES ($1, $2)`, [B, idDeA])).rejects.toThrow(/foreign key|violates/i)
    await expect(q(B, `INSERT INTO pedidos.pedido (tenant_id, cliente_id, indicado_por_id) VALUES ($1, $2, $3)`, [B, (await q(B, `INSERT INTO pedidos.cliente (tenant_id, nome) VALUES ($1, 'Caio') RETURNING id`, [B])).rows[0]!['id' as never], idDeA])).rejects.toThrow(/foreign key|violates/i)
  })
  it('remover o cliente referenciado é recusado (restringe)', async () => {
    await expect(q(A, `DELETE FROM pedidos.cliente WHERE nome = 'Ana'`)).rejects.toThrow(/foreign key|violates/i)
  })
  it('a emissão recusa referência inexistente, em lista ou em campo que não é uuid', () => {
    const bad = (campo: object) => servico('x', { a: { campos: { r: campo } } })
    expect(() => emite(bad({ tipo: 'uuid', referencia: 'naoExiste' }), 'sql')).toThrow(/inexistente/)
    expect(() => emite(bad({ tipo: 'uuid', lista: true, referencia: 'a' }), 'sql')).toThrow(/lista/)
    expect(() => emite(bad({ tipo: 'texto', referencia: 'a' }), 'sql')).toThrow(/use uuid/)
  })
})
