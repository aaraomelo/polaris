import type { PGlite } from '@electric-sql/pglite'
import type { Consulta, Db } from './tipos'

/** Adaptador para PGlite (Postgres em WASM, no processo): desenvolvimento e testes. A conexão deve usar um papel SEM BYPASSRLS. */
export function dbDePglite(db: PGlite): Db {
  return {
    async transacao(tenantId, fn) {
      return db.transaction(async (tx) => {
        await tx.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantId]) // local à transação
        const q: Consulta = async (sql, params) => { const r = await tx.query(sql, params as unknown[]); return { rows: r.rows as Record<string, unknown>[], rowCount: r.affectedRows ?? r.rows.length } }
        return fn(q)
      })
    },
  }
}
