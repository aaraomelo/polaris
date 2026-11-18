import { criaPool, dbTenantDePg } from '@polaris/pg'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { criaBanco, temPostgres, type Banco } from '../src/harness'

// Os prazos do SERVIDOR (statement_timeout, idle_in_transaction) e a recuperação do pool: o PGlite não tem esses temporizadores; o Postgres real tem.
const A = '11111111-1111-1111-1111-111111111111'
describe.skipIf(!temPostgres)('prazos e recuperação do pool (Postgres real)', () => {
  let b: Banco
  beforeAll(async () => { b = await criaBanco('timeouts') })
  afterAll(async () => { await b?.fecha() })

  it('statement_timeout: a consulta longa é CANCELADA pelo banco (57014) e o pool segue de pé; dentro do adaptador de tenant também', async () => {
    const p = criaPool({ url: b.urlApp, max: 2, statementTimeoutMs: 200 }); const d = dbTenantDePg(p)
    try {
      const t0 = Date.now(); await expect(p.query('SELECT pg_sleep(5)')).rejects.toMatchObject({ code: '57014' }); expect(Date.now() - t0).toBeLessThan(2000)
      await expect(d.transacao(A, (q) => q('SELECT pg_sleep(5)'))).rejects.toMatchObject({ code: '57014' })
      expect((await d.transacao(A, (q) => q('SELECT 1 AS n'))).rows[0]).toEqual({ n: 1 }); expect((await p.query('SELECT 2 AS n')).rows[0]).toEqual({ n: 2 })
    } finally { await p.end() }
  })
  it('idle_in_transaction: a transação ociosa (a aplicação "esperando um provedor externo") é derrubada pelo banco; a falha vira ERRO da transação, o processo NÃO cai e o pool se recupera', async () => {
    const p = criaPool({ url: b.urlApp, max: 1, idleTransacaoMs: 200 }); const d = dbTenantDePg(p); const naoTratados: unknown[] = []; const ouve = (e: unknown) => { naoTratados.push(e) }; process.on('uncaughtException', ouve)
    try {
      await expect(d.transacao(A, async (q) => { await q('SELECT 1'); await new Promise((r) => setTimeout(r, 800)); await q('SELECT 2') })).rejects.toThrow(/idle-in-transaction|terminating connection|Connection terminated|connection error|not queryable/i)
      await new Promise((r) => setTimeout(r, 100)); expect(naoTratados).toEqual([]) // nenhuma exceção não tratada (em produção seria o processo caindo)
      expect((await d.transacao(A, (q) => q('SELECT 3 AS n'))).rows[0]).toEqual({ n: 3 }) // o pool (de 1 conexão) abriu outra: não ficou travado
    } finally { process.off('uncaughtException', ouve); await p.end() }
  })
  it('conexão morta pelo servidor (pg_terminate_backend) enquanto ociosa não derruba o processo nem o pool', async () => {
    const p = criaPool({ url: b.urlApp, max: 2 }); const erros: unknown[] = []; p.on('error', (e) => erros.push(e))
    try {
      await p.query('SELECT 1'); const pid = (await p.query('SELECT pg_backend_pid() AS pid')).rows[0]!.pid; await b.admin.query('SELECT pg_terminate_backend($1)', [pid]); await new Promise((r) => setTimeout(r, 300))
      for (let i = 0; i < 4; i++) { try { expect((await p.query('SELECT 4 AS n')).rows[0]).toEqual({ n: 4 }); break } catch (e) { if (i === 3) throw e } } // no pior caso a 1ª consulta pega a conexão morta; as seguintes se recuperam
    } finally { await p.end() }
  })
  it('esperaConexaoMs: com todas as conexões ocupadas, quem espera desiste no prazo (não fica pendurado para sempre)', async () => {
    const p = criaPool({ url: b.urlApp, max: 1, esperaConexaoMs: 300, statementTimeoutMs: 5000 })
    try {
      const ocupa = p.query('SELECT pg_sleep(1.5)'); await new Promise((r) => setTimeout(r, 100)); const t0 = Date.now()
      await expect(p.query('SELECT 1')).rejects.toThrow(/timeout/i); expect(Date.now() - t0).toBeLessThan(1200); await ocupa; expect((await p.query('SELECT 5 AS n')).rows[0]).toEqual({ n: 5 })
    } finally { await p.end() }
  })
  it('um erro dentro da transação desfaz TUDO e a conexão volta limpa (sem tenant e sem transação pendurada)', async () => {
    await b.admin.query('CREATE TABLE IF NOT EXISTS public.tt (x int)'); await b.admin.query('GRANT ALL ON public.tt TO polaris_app'); const p = criaPool({ url: b.urlApp, max: 1 }); const d = dbTenantDePg(p)
    try {
      await expect(d.transacao(A, async (q) => { await q('INSERT INTO public.tt VALUES (1)'); await q('SELECT 1/0') })).rejects.toThrow(/division by zero/)
      expect((await b.admin.query('SELECT count(*)::int AS n FROM public.tt')).rows[0]!.n).toBe(0)
      const c = await p.connect(); try { expect((await c.query(`SELECT coalesce(current_setting('app.tenant_id', true), '') AS t, txid_current_if_assigned() AS tx`)).rows[0]).toEqual({ t: '', tx: null }) } finally { c.release() }
    } finally { await p.end() }
  })
})
