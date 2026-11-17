import type { Barramento, DbSistema, Envelope } from './tipos'

// O relay move o outbox para o barramento: AO MENOS UMA VEZ (se publicar e cair antes de marcar, publica de novo: o consumidor deduplica pelo id).
// Ordem: por tenant, na ordem de ocorrência; se um evento de um tenant falha, os seguintes DESSE tenant esperam (os outros tenants seguem).
// Com várias instâncias do relay, FOR UPDATE SKIP LOCKED evita pegar as mesmas linhas, mas a ordem por tenant só é garantida com UMA instância.

export type OpcoesRelay = {
  db: DbSistema
  servico: string
  barramento: Barramento
  /** eventos por rodada (padrão 100) */
  lote?: number
  /** depois de quantas falhas o evento vira "morto" e sai da fila (padrão 5) */
  maxTentativas?: number
  /** espera antes da próxima tentativa, em ms, dado o nº de falhas (padrão: 1 s × 2^(n-1), no máx. 5 min) */
  espera?: (tentativas: number) => number
}
export type ResultadoRelay = { publicados: number; falhas: number; mortos: number }
export type FiltroReplay = { tipo?: string; tenantId?: string; desde?: string; ate?: string }

const ident = (s: string) => `"${s.replace(/"/g, '""')}"`
const ISO = `to_char("ocorrido_em" AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`
const linhaParaEnvelope = (r: Record<string, unknown>): Envelope => ({ id: r.id as string, tipo: r.tipo as string, versao: r.versao as string, tenantId: r.tenant_id as string, ocorridoEm: r.ocorrido as string, payload: r.payload as Record<string, unknown>, ...(r.chave ? { chave: r.chave as string } : {}) })

export function criaRelay(o: OpcoesRelay) {
  const t = `${ident(o.servico)}.${ident('outbox')}`
  const lote = o.lote ?? 100, max = o.maxTentativas ?? 5
  const espera = o.espera ?? ((n: number) => Math.min(300_000, 1000 * 2 ** (n - 1)))
  const COLS = `"id"::text AS "id", "tenant_id"::text AS "tenant_id", "tipo", "versao", "chave", "payload", ${ISO} AS "ocorrido"`

  return {
    /** Uma rodada: pega o que está pendente e vencido, publica, marca. */
    async executa(): Promise<ResultadoRelay> {
      return o.db.transacao(async (q) => {
        const r = await q(`SELECT ${COLS}, "tentativas" FROM ${t} WHERE "publicado_em" IS NULL AND "morto_em" IS NULL AND "proxima_em" <= now() ORDER BY "ocorrido_em", "id" LIMIT $1 FOR UPDATE SKIP LOCKED`, [lote])
        const res: ResultadoRelay = { publicados: 0, falhas: 0, mortos: 0 }
        const travados = new Set<string>() // tenants com falha nesta rodada: o resto deles espera (ordem)
        for (const row of r.rows) {
          const env = linhaParaEnvelope(row)
          if (travados.has(env.tenantId)) continue
          try { await o.barramento.publica(env) } catch (err) {
            travados.add(env.tenantId)
            const n = Number(row.tentativas) + 1, msg = (err instanceof Error ? err.message : String(err)).slice(0, 500)
            if (n >= max) { await q(`UPDATE ${t} SET "tentativas" = $2, "erro" = $3, "morto_em" = now() WHERE "id" = $1`, [env.id, n, msg]); res.mortos++ }
            else { await q(`UPDATE ${t} SET "tentativas" = $2, "erro" = $3, "proxima_em" = now() + ($4 * interval '1 millisecond') WHERE "id" = $1`, [env.id, n, msg, espera(n)]); res.falhas++ }
            continue
          }
          // marcar FORA do try: se isto falhar depois de publicar, a rodada inteira desfaz e o evento será publicado de novo (ao menos uma vez), sem virar "falha de publicação"
          await q(`UPDATE ${t} SET "publicado_em" = now(), "erro" = NULL WHERE "id" = $1`, [env.id]); res.publicados++
        }
        return res
      })
    },
    /** Reenvia ao barramento eventos JÁ publicados (mesmos ids): os consumidores deduplicam. Não altera o outbox. Devolve quantos reenviou. */
    async republica(f: FiltroReplay = {}): Promise<number> {
      const onde = ['"publicado_em" IS NOT NULL'], ps: unknown[] = []
      if (f.tipo) { ps.push(f.tipo); onde.push(`"tipo" = $${ps.length}`) }
      if (f.tenantId) { ps.push(f.tenantId); onde.push(`"tenant_id" = $${ps.length}`) }
      if (f.desde) { ps.push(f.desde); onde.push(`"ocorrido_em" >= $${ps.length}::timestamptz`) }
      if (f.ate) { ps.push(f.ate); onde.push(`"ocorrido_em" < $${ps.length}::timestamptz`) }
      const rows = (await o.db.transacao((q) => q(`SELECT ${COLS} FROM ${t} WHERE ${onde.join(' AND ')} ORDER BY "ocorrido_em", "id"`, ps))).rows
      for (const row of rows) await o.barramento.publica(linhaParaEnvelope(row))
      return rows.length
    },
    /** Eventos que esgotaram as tentativas (para alguém olhar e decidir). */
    async mortos() {
      return (await o.db.transacao((q) => q(`SELECT ${COLS}, "tentativas", "erro" FROM ${t} WHERE "morto_em" IS NOT NULL ORDER BY "ocorrido_em", "id"`))).rows.map((r) => ({ ...linhaParaEnvelope(r), tentativas: Number(r.tentativas), erro: r.erro as string }))
    },
    /** Põe um evento morto de volta na fila (zera as tentativas). */
    async reenfileira(id: string): Promise<boolean> {
      return (await o.db.transacao((q) => q(`UPDATE ${t} SET "morto_em" = NULL, "tentativas" = 0, "proxima_em" = now(), "erro" = NULL WHERE "id" = $1 AND "morto_em" IS NOT NULL`, [id]))).rowCount > 0
    },
  }
}
