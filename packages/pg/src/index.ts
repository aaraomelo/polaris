import pg from 'pg'

// Adaptador de produção para o Postgres (`pg`). Implementa os contratos `Db` do serviço e `DbTenant`/`DbSistema` dos eventos (são os mesmos, estruturalmente).
//  - o tenant vai por `set_config('app.tenant_id', …, true)` DENTRO da transação (local a ela): uma conexão devolvida ao pool nunca carrega o tenant anterior;
//  - o papel da aplicação NÃO pode ter BYPASSRLS (esta biblioteca não faz `SET ROLE` por conta própria no caminho do tenant, exceto se pedido em `papel`);
//  - prazos no servidor (statement_timeout, idle_in_transaction) para que uma consulta ou transação esquecida não prenda o pool;
//  - falha ao desfazer descarta a conexão (ela não volta ao pool num estado desconhecido).

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const IDENT = /^[a-z_][a-z0-9_]{0,62}$/

export type Consulta = (sql: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[]; rowCount: number }>
export type DbTenant = { transacao<T>(tenantId: string, fn: (q: Consulta) => Promise<T>): Promise<T> }
export type DbSistema = { transacao<T>(fn: (q: Consulta) => Promise<T>): Promise<T> }

export type OpcoesPool = {
  /** postgres://usuario:senha@host:5432/banco (a senha vem do ambiente; nunca é registrada) */
  url: string
  /** conexões (padrão 10) */
  max?: number
  /** `statement_timeout` em ms (padrão 15 000) */
  statementTimeoutMs?: number
  /** `idle_in_transaction_session_timeout` em ms (padrão 15 000) */
  idleTransacaoMs?: number
  /** espera por conexão livre, em ms (padrão 5 000) */
  esperaConexaoMs?: number
  /** `SET ROLE` ao conectar (para ambientes onde o usuário de login é um papel-mestre). Padrão: nenhum */
  papel?: string
  ssl?: pg.PoolConfig['ssl']
}

export function criaPool(o: OpcoesPool): pg.Pool {
  const u = new URL(o.url)
  if (u.protocol !== 'postgres:' && u.protocol !== 'postgresql:') throw new Error('url deve ser postgres://…')
  if (o.papel !== undefined && !IDENT.test(o.papel)) throw new Error('papel inválido (use minúsculas, números e _)')
  const pool = new pg.Pool({
    connectionString: o.url, max: o.max ?? 10, connectionTimeoutMillis: o.esperaConexaoMs ?? 5000,
    ...(o.ssl !== undefined ? { ssl: o.ssl } : {}),
  })
  // prazos e papel por SET ao conectar (e não por opções de startup: pgbouncer em modo transação as ignora). As consultas de uma conexão são enfileiradas
  // em ordem, então isto roda ANTES de qualquer consulta de quem recebe a conexão do pool.
  const st = Math.trunc(o.statementTimeoutMs ?? 15_000), it = Math.trunc(o.idleTransacaoMs ?? 15_000)
  pool.on('connect', (c) => { void c.query(`SET statement_timeout = ${st}; SET idle_in_transaction_session_timeout = ${it}${o.papel ? `; SET ROLE ${o.papel}` : ''}`) })
  // erro numa conexão ociosa (rede caiu) não pode derrubar o processo
  pool.on('error', () => {})
  return pool
}

async function rodaTransacao<T>(pool: pg.Pool, inicio: (c: pg.PoolClient) => Promise<void>, fn: (q: Consulta) => Promise<T>): Promise<T> {
  const c = await pool.connect()
  let descarta = false
  // Se o SERVIDOR derruba esta conexão enquanto ela está emprestada e ociosa (idle_in_transaction_session_timeout, falha de rede, failover), o `pg` emite `error` no cliente:
  // sem ouvinte isso é uma exceção não tratada e o PROCESSO CAI. Aqui o erro vira uma falha da transação (a próxima consulta rejeita) e a conexão é descartada.
  const aoErro = () => { descarta = true }
  c.on('error', aoErro)
  try {
    await c.query('BEGIN')
    await inicio(c)
    const q: Consulta = async (sql, params) => { const r = await c.query(sql, params as unknown[] | undefined); return { rows: r.rows as Record<string, unknown>[], rowCount: r.rowCount ?? 0 } }
    const r = await fn(q)
    await c.query('COMMIT')
    return r
  } catch (e) {
    try { await c.query('ROLLBACK') } catch { descarta = true } // não deu para desfazer: a conexão está num estado desconhecido
    throw e
  } finally { c.removeListener('error', aoErro); c.release(descarta) }
}

export function dbTenantDePg(pool: pg.Pool): DbTenant {
  return {
    transacao: (tenantId, fn) => {
      if (!UUID.test(tenantId)) return Promise.reject(new Error('tenantId deve ser um uuid')) // nunca chega ao banco algo que não seja um uuid
      return rodaTransacao(pool, async (c) => { await c.query(`SELECT set_config('app.tenant_id', $1, true)`, [tenantId.toLowerCase()]) }, fn)
    },
  }
}

/** Para o relay do outbox: SEM tenant. Use um pool cujo papel ignora RLS (BYPASSRLS) e que NUNCA é o da aplicação. */
export function dbSistemaDePg(pool: pg.Pool): DbSistema {
  return { transacao: (fn) => rodaTransacao(pool, async () => {}, fn) }
}
