import pg from 'pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { criaPool, dbTenantDePg, dbSistemaDePg } from '@polaris/pg'
import type { No } from '@polaris/schema'
import { criaBanco, temPostgres, type Banco } from '../src/harness'

// RLS no Postgres de VERDADE, com LOGIN de papéis reais (nada de SET ROLE): o que a produção faz.
const A = '11111111-1111-1111-1111-111111111111', B = '22222222-2222-2222-2222-222222222222'
const LOJA: No = { kind: 'servico', id: 'loja', versao: '1.0.0', estatuto: 'publicado', spec: { entidades: {
  cliente: { campos: { nome: { tipo: 'texto', obrigatorio: true } }, unicos: [['nome']] },
  pedido: { campos: { clienteId: { tipo: 'uuid', obrigatorio: true, referencia: 'cliente' }, total: { tipo: 'dinheiro', obrigatorio: true } } },
}, operacoes: {} } } as never

describe.skipIf(!temPostgres)('RLS com login de verdade', () => {
  let b: Banco
  beforeAll(async () => { b = await criaBanco('rls'); await b.migra(LOJA) })
  afterAll(async () => { await b?.fecha() })
  const cli = (t: string, nome: string) => b.db.transacao(t, async (q) => (await q(`INSERT INTO loja.cliente (tenant_id, nome) VALUES ($1, $2) RETURNING id::text AS id`, [t, nome])).rows[0]!.id as string)

  it('os papéis são os da produção: o app NÃO tem BYPASSRLS nem superusuário; o migrador e o relay têm BYPASSRLS', async () => {
    const r = (await b.admin.query(`SELECT rolname, rolbypassrls, rolsuper FROM pg_roles WHERE rolname LIKE 'polaris_%' ORDER BY 1`)).rows
    expect(r).toEqual([{ rolname: 'polaris_app', rolbypassrls: false, rolsuper: false }, { rolname: 'polaris_migrador', rolbypassrls: true, rolsuper: false }, { rolname: 'polaris_relay', rolbypassrls: true, rolsuper: false }])
  })
  it('cada tenant vê só o seu; sem tenant configurado a consulta vê NADA (falha fechada); o tenant não vaza para a conexão seguinte do pool', async () => {
    await cli(A, 'Ana'); await cli(B, 'Beto')
    expect((await b.db.transacao(A, (q) => q('SELECT nome FROM loja.cliente'))).rows).toEqual([{ nome: 'Ana' }]); expect((await b.db.transacao(B, (q) => q('SELECT nome FROM loja.cliente'))).rows).toEqual([{ nome: 'Beto' }])
    const c = await b.appPool.connect(); try { expect((await c.query('SELECT nome FROM loja.cliente')).rows).toEqual([]) } finally { c.release() } // fora do adaptador: sem set_config, sem linhas
    const um = criaPool({ url: b.urlApp, max: 1 }); const d = dbTenantDePg(um); try { await d.transacao(A, async () => {}); const c1 = await um.connect(); try { expect((await c1.query(`SELECT coalesce(current_setting('app.tenant_id', true), '') AS t`)).rows[0]).toEqual({ t: '' }); expect((await c1.query('SELECT count(*)::int AS n FROM loja.cliente')).rows[0]).toEqual({ n: 0 }) } finally { c1.release() } } finally { await um.end() }
  })
  it('a política é FORÇADA e vale para INSERT/UPDATE/DELETE: não se grava, altera nem apaga linha de outro tenant', async () => {
    const idB = await cli(B, 'Bia')
    await expect(b.db.transacao(A, (q) => q(`INSERT INTO loja.cliente (tenant_id, nome) VALUES ($1, 'forjado')`, [B]))).rejects.toThrow(/row-level security/)
    expect((await b.db.transacao(A, (q) => q(`UPDATE loja.cliente SET nome = 'x' WHERE id = $1`, [idB]))).rowCount).toBe(0); expect((await b.db.transacao(A, (q) => q(`DELETE FROM loja.cliente WHERE id = $1`, [idB]))).rowCount).toBe(0)
    await expect(b.db.transacao(B, (q) => q(`UPDATE loja.cliente SET tenant_id = $1 WHERE id = $2`, [A, idB]))).rejects.toThrow(/row-level security/) // nem "empurrar" a linha para outro tenant
    expect((await b.db.transacao(B, (q) => q(`SELECT nome FROM loja.cliente WHERE id = $1`, [idB]))).rows).toEqual([{ nome: 'Bia' }])
  })
  it('FK COMPOSTA: um pedido do tenant A não referencia cliente do tenant B (a checagem de FK ignora RLS; a composta não)', async () => {
    const idB = await cli(B, 'Cli do B'); await expect(b.db.transacao(A, (q) => q(`INSERT INTO loja.pedido (tenant_id, cliente_id, total) VALUES ($1, $2, 10)`, [A, idB]))).rejects.toThrow(/foreign key|violates/)
    const idA = await cli(A, 'Cli do A'); expect((await b.db.transacao(A, (q) => q(`INSERT INTO loja.pedido (tenant_id, cliente_id, total) VALUES ($1, $2, 10) RETURNING id`, [A, idA]))).rowCount).toBe(1)
  })
  it('a unicidade é POR tenant: o mesmo nome em dois tenants pode; duas vezes no mesmo, não', async () => {
    await cli(A, 'Repetido'); await cli(B, 'Repetido'); await expect(cli(A, 'Repetido')).rejects.toThrow(/duplicate key|unique/i)
  })
  it('o papel do relay/migrador (BYPASSRLS) lê todos os tenants numa transação sem tenant; o do app, mesmo conectado igual, não', async () => {
    const rel = criaPool({ url: b.urlRelay, max: 1 }); try { const n = (await dbSistemaDePg(rel).transacao((q) => q(`SELECT count(DISTINCT tenant_id)::int AS n FROM loja.cliente`))).rows[0]!.n; expect(n).toBe(2) } finally { await rel.end() }
    expect((await b.db.transacao(A, (q) => q(`SELECT count(DISTINCT tenant_id)::int AS n FROM loja.cliente`))).rows[0]!.n).toBe(1)
  })
  it('o app não altera o esquema (sem CREATE/ALTER/DROP) nem lê o que não lhe foi concedido', async () => {
    const c = await b.appPool.connect(); try {
      await expect(c.query('DROP TABLE loja.cliente')).rejects.toThrow(/must be owner|permission denied/); await expect(c.query('CREATE TABLE loja.invasora (x int)')).rejects.toThrow(/permission denied/); await expect(c.query('ALTER TABLE loja.cliente DISABLE ROW LEVEL SECURITY')).rejects.toThrow(/must be owner/)
      await expect(c.query('SET ROLE polaris_migrador')).rejects.toThrow(/permission denied/) // não escala para o papel que ignora a RLS
    } finally { c.release() }
  })
  it('um tenantId que não é uuid nunca chega ao banco (nem como injeção)', async () => { for (const t of ["x'; DROP TABLE loja.cliente; --", '', 'abc']) await expect(b.db.transacao(t, async () => {})).rejects.toThrow('uuid'); expect((await b.admin.query('SELECT count(*)::int AS n FROM loja.cliente')).rows[0]!.n).toBeGreaterThan(0) })
})
void pg
