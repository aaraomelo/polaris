import { contextoPorJwt, criaServico, regrasDoRegistry } from '@polaris/servico'
import { criaPool, dbTenantDePg, dbSistemaDePg } from '@polaris/pg'
import { emite, type Registry } from '@polaris/schema'
import type { FastifyInstance } from 'fastify'
import { autenticadorDe } from './auth'
import type { ConfigServico } from './config'

const sqlIdent = (s: string) => `"${s.replace(/"/g, '""')}"`

/** Migra (opcional, com o papel migrador) e devolve o serviço pronto para `listen`. A aplicação usa só DATABASE_URL (sem BYPASSRLS). */
export async function montaServico(c: ConfigServico, reg: Registry): Promise<{ app: FastifyInstance; fecha(): Promise<void> }> {
  const no = reg.resolve('servico', c.servico)?.no
  if (!no) throw new Error(`serviço '${c.servico}' não existe nos nós carregados`)
  if (c.migrar) {
    const mig = criaPool({ url: c.migrar.url, max: 1, statementTimeoutMs: 120_000 })
    try {
      await dbSistemaDePg(mig).transacao(async (q) => {
        await q(emite(no, 'sql'))
        await q(`GRANT USAGE ON SCHEMA ${sqlIdent(c.servico)} TO ${sqlIdent(c.migrar!.papelApp)}`)
        await q(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA ${sqlIdent(c.servico)} TO ${sqlIdent(c.migrar!.papelApp)}`)
      })
    } finally { await mig.end() }
  }
  const pool = criaPool({ url: c.bancoUrl, ...(c.bancoPapel ? { papel: c.bancoPapel } : {}) })
  const autentica = autenticadorDe(c.jwt)
  const app = criaServico(no, {
    db: dbTenantDePg(pool), contexto: contextoPorJwt(autentica), acesso: regrasDoRegistry(reg),
    ...(c.metricasToken ? { metricasToken: c.metricasToken } : {}),
  })
  return { app, fecha: async () => { await app.close(); await pool.end() } }
}
