import { vi } from 'vitest'
vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 })
import { PGlite } from '@electric-sql/pglite'
import { PGLiteSocketServer } from '@electric-sql/pglite-socket'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { criaPool, dbSistemaDePg, dbTenantDePg } from '../src/index'

// O adaptador com o driver `pg` REAL contra um servidor PostgreSQL de verdade (PGlite expondo o protocolo de rede): o que muda do PGlite direto é tudo que importa em produção.
const A = '11111111-1111-1111-1111-111111111111', B = '22222222-2222-2222-2222-222222222222'
let db: PGlite, srv: PGLiteSocketServer, url: string

beforeAll(async () => {
  db = new PGlite()
  await db.exec(`CREATE ROLE app NOLOGIN; CREATE ROLE relay NOLOGIN BYPASSRLS; CREATE TABLE t (id serial PRIMARY KEY, tenant_id uuid NOT NULL, v text);
    ALTER TABLE t ENABLE ROW LEVEL SECURITY; ALTER TABLE t FORCE ROW LEVEL SECURITY;
    CREATE POLICY t_tenant ON t USING (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid) WITH CHECK (tenant_id = nullif(current_setting('app.tenant_id', true), '')::uuid);
    GRANT SELECT, INSERT, UPDATE, DELETE ON t TO app, relay; GRANT USAGE ON SEQUENCE t_id_seq TO app, relay;`)
  srv = new PGLiteSocketServer({ db, port: 0, host: '127.0.0.1', maxConnections: 20 }); await srv.start()
  const m = /:(\d+)/.exec(srv.getServerConn()); url = `postgres://postgres@127.0.0.1:${m![1]}/postgres`
})
afterAll(async () => { await srv.stop(); await db.close() })
const tenant = (p = criaPool({ url, max: 1, papel: 'app' })) => ({ p, db: dbTenantDePg(p) })

describe('criaPool: prazos e papel aplicados NO connect, antes da primeira consulta e sem consultas concorrentes', () => {
  it('a primeira consulta de uma conexão nova já roda com o papel e o statement_timeout; sem aviso de consulta concorrente do pg', async () => {
    const avisos: string[] = []; const ouve = (w: Error) => avisos.push(w.message); process.on('warning', ouve)
    const p = criaPool({ url, max: 3, papel: 'app', statementTimeoutMs: 4321 })
    try {
      const rs = await Promise.all([1, 2, 3].map(() => p.query(`SELECT current_user AS u, current_setting('statement_timeout') AS t`))) // 3 conexões novas ao mesmo tempo, cada uma já com a primeira consulta na fila
      for (const r of rs) expect(r.rows[0]).toEqual({ u: 'app', t: '4321ms' })
      await new Promise((r) => setTimeout(r, 50)); expect(avisos.filter((m) => /already executing a query/.test(m))).toEqual([])
    } finally { process.off('warning', ouve); await p.end() }
  })
  it('se o SET do papel falha (papel inexistente), a conexão FALHA: nunca se usa uma conexão sem o papel', async () => {
    const p = criaPool({ url, max: 1, papel: 'nao_existe' })
    try { await expect(p.query('SELECT 1')).rejects.toThrow(/nao_existe|role/i) } finally { await p.end() }
  })
})

describe('dbTenantDePg: RLS por transação, com o driver real', () => {
  it('cada transação enxerga só o próprio tenant; commit grava; o tenant NÃO sobrevive à transação (a conexão volta limpa ao pool)', async () => {
    const { p, db: d } = tenant()
    await d.transacao(A, (q) => q(`INSERT INTO t (tenant_id, v) VALUES ($1, 'a1')`, [A]))
    await d.transacao(B, (q) => q(`INSERT INTO t (tenant_id, v) VALUES ($1, 'b1')`, [B]))
    expect((await d.transacao(A, (q) => q('SELECT v FROM t'))).rows).toEqual([{ v: 'a1' }]); expect((await d.transacao(B, (q) => q('SELECT v FROM t'))).rows).toEqual([{ v: 'b1' }])
    await p.end()
  })
  it('o valor de `app.tenant_id` volta vazio depois da transação (nada vaza para o próximo uso da conexão)', async () => {
    const { p, db: d } = tenant(); await d.transacao(A, async () => {})
    const c = await p.connect(); const r = (await c.query(`SELECT coalesce(current_setting('app.tenant_id', true), '') AS t`)).rows[0] as { t: string }; c.release()
    expect(r.t).toBe(''); await p.end()
  })
  it('erro na função desfaz TUDO; a conexão continua utilizável', async () => {
    const { p, db: d } = tenant()
    await expect(d.transacao(A, async (q) => { await q(`INSERT INTO t (tenant_id, v) VALUES ($1, 'fantasma')`, [A]); throw new Error('falhou') })).rejects.toThrow('falhou')
    expect((await d.transacao(A, (q) => q(`SELECT count(*)::int AS n FROM t WHERE v = 'fantasma'`))).rows[0]).toEqual({ n: 0 })
    await p.end()
  })
  it('a RLS é do BANCO: INSERT com tenant_id de outro tenant é recusado mesmo pelo adaptador', async () => {
    const { p, db: d } = tenant()
    await expect(d.transacao(B, (q) => q(`INSERT INTO t (tenant_id, v) VALUES ($1, 'forjado')`, [A]))).rejects.toThrow(/row-level security/)
    await p.end()
  })
  it('tenantId que não é uuid NUNCA chega ao banco (nem como tentativa de injeção)', async () => {
    const { p, db: d } = tenant()
    for (const t of ["x'; DROP TABLE t; --", '', 'não-é-uuid', `${A} OR 1=1`, A + '\n']) await expect(d.transacao(t, async () => {}), JSON.stringify(t)).rejects.toThrow('uuid')
    expect((await d.transacao(A, (q) => q('SELECT 1 AS n'))).rows[0]).toEqual({ n: 1 }); await p.end()
  })
  it('um papel com BYPASSRLS usado pelo adaptador de tenant ENXERGA TODOS os tenants: por isso a conexão da aplicação nunca pode tê-lo', async () => {
    const p = criaPool({ url, max: 1, papel: 'relay' }); const d = dbTenantDePg(p)
    expect((await d.transacao(A, (q) => q('SELECT DISTINCT tenant_id::text AS t FROM t ORDER BY 1'))).rows.length).toBe(2) // a RLS não vale para quem tem BYPASSRLS
    await p.end()
  })
})

describe('dbSistemaDePg e a configuração do pool', () => {
  it('o relay (papel que ignora RLS) lê todos os tenants, numa transação sem tenant', async () => {
    const p = criaPool({ url, max: 1, papel: 'relay' })
    expect((await dbSistemaDePg(p).transacao((q) => q('SELECT DISTINCT tenant_id::text AS t FROM t ORDER BY 1'))).rows.map((r) => r.t)).toEqual([A, B]); await p.end()
  })
  it('os prazos e o papel CHEGAM à sessão do banco (a interrupção em si é do Postgres real; o PGlite em WASM não tem o temporizador)', async () => {
    const p = criaPool({ url, max: 1, statementTimeoutMs: 1234, idleTransacaoMs: 4321, papel: 'app' })
    const r = (await dbSistemaDePg(p).transacao((q) => q(`SELECT current_setting('statement_timeout') AS st, current_setting('idle_in_transaction_session_timeout') AS it, current_user AS u`))).rows[0]
    expect(r).toEqual({ st: '1234ms', it: '4321ms', u: 'app' }); await p.end()
  })
  it('configuração inválida é recusada: url que não é postgres, papel malformado (injeção em SET ROLE)', () => {
    expect(() => criaPool({ url: 'http://x' })).toThrow('postgres://'); expect(() => criaPool({ url: 'mysql://x' })).toThrow()
    for (const papel of ['app; DROP TABLE t', 'App', '', 'a-b', 'x'.repeat(64)]) expect(() => criaPool({ url, papel }), papel).toThrow('papel inválido')
  })
})
