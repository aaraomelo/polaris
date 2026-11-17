export type Consulta = (sql: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[]; rowCount: number }>
/** Banco com tenant fixado (RLS): usado por quem PUBLICA dentro de uma operação e por quem CONSOME. */
export type DbTenant = { transacao<T>(tenantId: string, fn: (q: Consulta) => Promise<T>): Promise<T> }
/** Banco SEM tenant, com um papel que ignora RLS (BYPASSRLS): só o relay do outbox o usa, porque lê todos os tenants. */
export type DbSistema = { transacao<T>(fn: (q: Consulta) => Promise<T>): Promise<T> }

/** O evento em trânsito. `id` é estável (é o id do registro no outbox): o consumidor deduplica por ele. */
export type Envelope = {
  id: string
  tipo: string
  /** semver do contrato do evento (nó `evento`); o MAJOR decide quem entende */
  versao: string
  tenantId: string
  ocorridoEm: string
  payload: Record<string, unknown>
  chave?: string
}

export type Assinatura = {
  consumidor: string
  tipos: string[]
  /** majors que o consumidor entende; ausente = todos */
  versoes?: number[]
  manipula(env: Envelope): Promise<unknown>
}
/** O barramento (broker): entrega AO MENOS UMA VEZ. Trocar por NATS/Kafka/SQS é implementar estas duas funções. */
export type Barramento = {
  /** aceita o evento; lança se não conseguiu (o relay tenta de novo) */
  publica(env: Envelope): Promise<void>
  assina(a: Assinatura): () => void
}
