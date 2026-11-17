import type { Assinatura, Consulta, DbTenant, Envelope } from './tipos'

// Quem CONSOME: o efeito acontece UMA vez mesmo com entregas repetidas. O handler roda numa transação do tenant do evento, e a marca no `inbox` entra
// na MESMA transação: se o handler falha, a marca some junto (a próxima entrega tenta de novo); se já havia marca, o handler nem roda.

export type ResultadoConsumo = 'processado' | 'duplicado'
export type OpcoesConsumidor = {
  db: DbTenant
  /** serviço dono do `inbox` */
  servico: string
  /** nome estável deste consumidor (a deduplicação é por consumidor + id do evento) */
  consumidor: string
  tipos: string[]
  versoes?: number[]
  handler(env: Envelope, q: Consulta): Promise<void>
}

export function criaConsumidor(o: OpcoesConsumidor): Assinatura & { processa(env: Envelope): Promise<ResultadoConsumo> } {
  const t = `"${o.servico.replace(/"/g, '""')}"."inbox"`
  async function processa(env: Envelope): Promise<ResultadoConsumo> {
    return o.db.transacao(env.tenantId, async (q) => {
      const r = await q(`INSERT INTO ${t} ("consumidor", "evento_id", "tenant_id") VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`, [o.consumidor, env.id, env.tenantId])
      if (!r.rowCount) return 'duplicado'
      await o.handler(env, q)
      return 'processado'
    })
  }
  return { consumidor: o.consumidor, tipos: o.tipos, ...(o.versoes ? { versoes: o.versoes } : {}), manipula: processa, processa }
}
