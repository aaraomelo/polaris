import Ajv from 'ajv'
import addFormats from 'ajv-formats'
import { parseTraceparent } from '@polaris/observabilidade'
import { esquemaDoCampo, type Campo, type No } from '@polaris/schema'
import type { Consulta } from './tipos'

// Quem PUBLICA: o evento entra no `outbox` na MESMA transação do dado (commit junto, ou rollback junto): não existe "gravou e perdeu o evento".

type Ev = { nome: string; payload: Record<string, Campo>; idempotencia?: string }

export type Publicador = {
  /** grava o evento no outbox (dentro da transação de `q`). Devolve o id, ou `null` se já existia um evento com a mesma chave de idempotência. */
  publicar(q: Consulta, tenantId: string, tipo: string, payload: Record<string, unknown>, traceparent?: string): Promise<string | null>
}

export class EventoInvalido extends Error {
  constructor(mensagem: string) { super(mensagem); this.name = 'EventoInvalido' }
}

export function criaPublicador(servico: string, eventos: Record<string, No>): Publicador {
  const ajv = addFormats(new Ajv({ allErrors: true, strict: false, coerceTypes: false }))
  const validadores = new Map<string, { validate: ReturnType<Ajv['compile']>; versao: string; chave?: string }>()
  for (const [nome, no] of Object.entries(eventos)) {
    const ev = no.spec as Ev
    const props = Object.fromEntries(Object.entries(ev.payload).map(([k, c]) => [k, esquemaDoCampo(c)]))
    const required = Object.entries(ev.payload).filter(([, c]) => c.obrigatorio).map(([k]) => k)
    if (ev.idempotencia && !(ev.idempotencia in ev.payload)) throw new Error(`evento ${nome}: a chave de idempotência '${ev.idempotencia}' não é um campo do payload`)
    validadores.set(nome, { validate: ajv.compile({ type: 'object', properties: props, required, additionalProperties: false }), versao: no.versao, ...(ev.idempotencia ? { chave: ev.idempotencia } : {}) })
  }
  const t = `"${servico.replace(/"/g, '""')}"."outbox"`
  return {
    async publicar(q, tenantId, tipo, payload, traceparent) {
      const v = validadores.get(tipo)
      if (!v) throw new EventoInvalido(`evento '${tipo}' desconhecido para o serviço '${servico}' (registre o nó evento)`)
      if (!v.validate(payload)) throw new EventoInvalido(`payload de '${tipo}' inválido: ${(v.validate.errors ?? []).map((e) => `${e.instancePath || '/'} ${e.message}`).join('; ')}`)
      const chave = v.chave ? String(payload[v.chave]) : null
      const tp = parseTraceparent(traceparent) ? traceparent! : null // só um traceparent VÁLIDO é guardado
      const r = await q(`INSERT INTO ${t} ("tenant_id", "tipo", "versao", "chave", "payload", "traceparent") VALUES ($1, $2, $3, $4, $5, $6) ON CONFLICT DO NOTHING RETURNING "id"::text AS "id"`, [tenantId, tipo, v.versao, chave, JSON.stringify(payload), tp])
      return (r.rows[0]?.id as string | undefined) ?? null
    },
  }
}
