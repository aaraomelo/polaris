export type Consulta = (sql: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[]; rowCount: number }>

/**
 * Acesso ao banco. `transacao` abre uma transação, fixa `app.tenant_id` (set_config local) para a RLS, roda `fn` e confirma (ou desfaz se `fn` lançar).
 * O papel de conexão NÃO pode ter BYPASSRLS. Adaptadores: `dbDePglite` (dev/teste); para `pg` são ~15 linhas sobre `Pool.connect()`.
 */
export type Db = { transacao<T>(tenantId: string, fn: (q: Consulta) => Promise<T>): Promise<T> }

import type { Regra } from '@polaris/acesso'

/** Quem chama, já AUTENTICADO. O tenant vem SEMPRE daqui (token ou host), nunca do corpo, da query nem de cabeçalho do cliente. `papeis` são nomes de nós `papel`. */
export type Contexto = { tenantId: string; usuario?: string; papeis?: string[] }
export type RequisicaoInfo = { headers: Record<string, string | string[] | undefined>; hostname: string; ip: string }

export type EntradaOperacao = {
  /** parâmetros de caminho (já validados), p.ex. { id } */
  params: Record<string, string>
  /** query (GET/DELETE) ou corpo (demais), já validados e sem os params */
  entrada: Record<string, unknown>
  ctx: Contexto
  /** consulta dentro da transação, com a RLS do tenant */
  q: Consulta
  /** o chamador pode (ação, sujeito) — sobre esta linha e este campo, se informados? Use para decidir DENTRO da operação (nunca confie só na rota). */
  pode(acao: string, sujeito: string, linha?: Record<string, unknown>, campo?: string): boolean
  /** publica um evento declarado em `publica`: é gravado no OUTBOX, na mesma transação do dado (commit junto, rollback junto); o relay o leva ao barramento */
  publica(evento: string, payload: Record<string, unknown>): Promise<void>
}
export type OpcoesServico = {
  db: Db
  /** resolve o chamador; `null` = anônimo. Rotas públicas ainda precisam de `tenantId` (resolvido, por exemplo, pelo host) */
  contexto(req: RequisicaoInfo): Promise<Contexto | null> | Contexto | null
  /** as REGRAS de acesso do chamador (de seus papéis). Obrigatório se alguma rota for `protegida` (o padrão); veja `regrasDoRegistry` */
  acesso?: { regras(ctx: Contexto): Promise<Regra[]> | Regra[] }
  /** implementação das operações declaradas que não são CRUD; sem implementação a rota responde 501 */
  operacoes?: Record<string, (e: EntradaOperacao) => Promise<unknown>>
  /** os nós `evento` dos eventos que o serviço publica (contrato do payload, versão e chave de idempotência). Obrigatório se alguma operação declara `publica` */
  eventos?: Record<string, import('@polaris/schema').No>
  /** limite do corpo em bytes (padrão 100 KB) */
  limiteCorpoBytes?: number
  /** recebe erros inesperados (500); o cliente nunca vê a mensagem */
  aoErro?(erro: unknown, rota: string): void
  /** logs, métricas e traces. Padrão: criado AUTOMÁTICO (JSON em stdout, métricas em memória, traces amostrados 100%); passe o seu para exportar os spans (OTLP, Jaeger) */
  obs?: import('@polaris/observabilidade').Observabilidade
  /** habilita `GET /metrics` (Prometheus) exigindo `Authorization: Bearer <este token>` (mín. 16 caracteres). SEM ele, a rota não existe: métricas nunca ficam abertas por esquecimento */
  metricasToken?: string
}
