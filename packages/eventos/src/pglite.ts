import type { PGlite } from '@electric-sql/pglite'
import type { Consulta, DbSistema, DbTenant } from './tipos'

const consulta = (tx: { query: PGlite['query'] }): Consulta => async (sql, params) => { const r = await tx.query(sql, params as unknown[]); return { rows: r.rows as Record<string, unknown>[], rowCount: r.affectedRows ?? r.rows.length } }

/** PGlite para dev/teste. `dbTenantDePglite` fixa app.tenant_id; `dbSistemaDePglite` não (use uma conexão com papel que ignora RLS). */
export const dbTenantDePglite = (db: PGlite): DbTenant => ({
  transacao: (tenantId, fn) => db.transaction(async (tx) => { await tx.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantId]); return fn(consulta(tx)) }),
})
export const dbSistemaDePglite = (db: PGlite): DbSistema => ({ transacao: (fn) => db.transaction(async (tx) => fn(consulta(tx))) })
