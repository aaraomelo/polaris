import { vi } from 'vitest'
vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 })
import { PGlite } from '@electric-sql/pglite'
import { afterEach, describe, expect, it } from 'vitest'
import { emite, migraSql, type No } from '../src/index'

const svc = (versao: string, entidades: object): No => ({ kind: 'servico', id: 'loja', versao, estatuto: 'publicado', spec: { entidades, operacoes: {} } }) as never
const A = '11111111-1111-1111-1111-111111111111', B = '22222222-2222-2222-2222-222222222222'
const base = { campos: { sku: { tipo: 'texto', obrigatorio: true }, nome: { tipo: 'texto' } } }
const abertos: PGlite[] = []
afterEach(async () => { await Promise.all(abertos.splice(0).map((d) => d.close())) })
async function banco(sql: string): Promise<PGlite> {
  const db = new PGlite(); abertos.push(db)
  await db.exec(`CREATE ROLE migrador NOLOGIN BYPASSRLS; CREATE ROLE app NOLOGIN; GRANT CREATE ON DATABASE postgres TO migrador; SET ROLE migrador; ${sql}; RESET ROLE; GRANT USAGE ON SCHEMA loja TO app; GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA loja TO app;`)
  return db
}
const ins = async (db: PGlite, t: string, sku: string) => { await db.exec(`RESET ROLE; SET ROLE app; SELECT set_config('app.tenant_id', '${t}', false);`); return db.query(`INSERT INTO loja.produto (tenant_id, sku) VALUES ($1, $2)`, [t, sku]) }
const indices = async (db: PGlite) => (await db.query(`SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = 'loja' ORDER BY indexname`)).rows

describe('unicos: chave única POR TENANT', () => {
  it('o mesmo SKU duas vezes no mesmo tenant é recusado; em outro tenant é permitido', async () => {
    const db = await banco(emite(svc('1.0.0', { produto: { ...base, unicos: [['sku']] } }), 'sql'))
    await ins(db, A, 'X1'); await expect(ins(db, A, 'X1')).rejects.toThrow(/duplicate key|unique/i)
    await ins(db, B, 'X1'); await ins(db, A, 'X2')
  })
  it('único composto', async () => {
    const db = await banco(emite(svc('1.0.0', { produto: { campos: { sku: { tipo: 'texto' }, cor: { tipo: 'texto' } }, unicos: [['sku', 'cor']] } }), 'sql'))
    await db.exec(`SET ROLE app; SELECT set_config('app.tenant_id', '${A}', false); INSERT INTO loja.produto (tenant_id, sku, cor) VALUES ('${A}', 'a', 'azul'), ('${A}', 'a', 'rosa')`)
    await expect(db.exec(`INSERT INTO loja.produto (tenant_id, sku, cor) VALUES ('${A}', 'a', 'azul')`)).rejects.toThrow(/duplicate|unique/i)
  })
  it('campo inexistente é erro de emissão', () => { expect(() => emite(svc('1.0.0', { produto: { ...base, unicos: [['nada']] } }), 'sql')).toThrow(/único de 'produto' usa campo inexistente 'nada'/) })
  it('migração v1→v2 que acrescenta único dá o MESMO catálogo de índices que v2 do zero; remover o único gera DROP', async () => {
    const v1 = svc('1.0.0', { produto: base }), v2 = svc('2.0.0', { produto: { ...base, unicos: [['sku']] } })
    const db = await banco(emite(v1, 'sql')); const m = migraSql(v1, v2)
    await db.exec(`SET ROLE migrador; ${m.up}; RESET ROLE`)
    expect(await indices(db)).toEqual(await indices(await banco(emite(v2, 'sql'))))
    expect(m.up).toContain('CREATE UNIQUE INDEX'); await ins(db, A, 'Z'); await expect(ins(db, A, 'Z')).rejects.toThrow()
    expect(migraSql(v2, v1).up).toContain('DROP INDEX IF EXISTS "loja"."produto_sku_uidx"')
  })
})
