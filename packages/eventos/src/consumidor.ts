import type { Observabilidade } from '@polaris/observabilidade'
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
  /** logs, métricas e traces (opcional): o span continua o trace de quem publicou */
  obs?: Observabilidade
}

export function criaConsumidor(o: OpcoesConsumidor): Assinatura & { processa(env: Envelope): Promise<ResultadoConsumo> } {
  const t = `"${o.servico.replace(/"/g, '""')}"."inbox"`
  const obs = o.obs
  const contagem = obs?.metricas.contador('eventos_consumidos_total', 'Eventos consumidos, por consumidor e resultado', ['consumidor', 'resultado'])
  async function processa(env: Envelope): Promise<ResultadoConsumo> {
    const rodar = () => o.db.transacao(env.tenantId, async (q) => {
      const r = await q(`INSERT INTO ${t} ("consumidor", "evento_id", "tenant_id") VALUES ($1, $2, $3) ON CONFLICT DO NOTHING`, [o.consumidor, env.id, env.tenantId])
      if (!r.rowCount) return 'duplicado' as const
      await o.handler(env, q)
      return 'processado' as const
    })
    if (!obs) return rodar()
    try {
      const res = await obs.tracer.emSpan('evento.consome', { pai: obs.tracer.extrai(env.traceparent), tipo: 'consumidor', atributos: { evento: env.tipo, 'evento.id': env.id, consumidor: o.consumidor, tenant: env.tenantId } }, rodar)
      contagem!.inc({ consumidor: o.consumidor, resultado: res })
      return res
    } catch (err) {
      contagem!.inc({ consumidor: o.consumidor, resultado: 'erro' })
      obs.log.error('falha ao consumir evento', { evento: env.tipo, eventoId: env.id, consumidor: o.consumidor, tenantId: env.tenantId, erro: err })
      throw err
    }
  }
  return { consumidor: o.consumidor, tipos: o.tipos, ...(o.versoes ? { versoes: o.versoes } : {}), manipula: processa, processa }
}
