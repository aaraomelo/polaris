export type Consulta = (sql: string, params?: unknown[]) => Promise<{ rows: Record<string, unknown>[]; rowCount: number }>

/**
 * Acesso ao banco. `transacao` abre uma transação, fixa `app.tenant_id` (set_config local) para a RLS, roda `fn` e confirma (ou desfaz se `fn` lançar).
 * O papel de conexão NÃO pode ter BYPASSRLS. Adaptadores: `dbDePglite` (dev/teste); para `pg` são ~15 linhas sobre `Pool.connect()`.
 */
export type Db = { transacao<T>(tenantId: string, fn: (q: Consulta) => Promise<T>): Promise<T> }

/** Quem chama, já AUTENTICADO. O tenant vem SEMPRE daqui (token ou host), nunca do corpo, da query nem de cabeçalho do cliente. */
export type Contexto = { tenantId: string; usuario?: string; permissoes?: string[] }
export type RequisicaoInfo = { headers: Record<string, string | string[] | undefined>; hostname: string; ip: string }

export type EntradaOperacao = {
  /** parâmetros de caminho (já validados), p.ex. { id } */
  params: Record<string, string>
  /** query (GET/DELETE) ou corpo (demais), já validados e sem os params */
  entrada: Record<string, unknown>
  ctx: Contexto
  /** consulta dentro da transação, com a RLS do tenant */
  q: Consulta
  /** publica um evento declarado em `publica`: é gravado no OUTBOX, na mesma transação do dado (commit junto, rollback junto); o relay o leva ao barramento */
  publica(evento: string, payload: Record<string, unknown>): Promise<void>
}
export type OpcoesServico = {
  db: Db
  /** resolve o chamador; `null` = anônimo. Rotas públicas ainda precisam de `tenantId` (resolvido, por exemplo, pelo host) */
  contexto(req: RequisicaoInfo): Promise<Contexto | null> | Contexto | null
  /** o chamador pode exercer `permissao`? Padrão: `autenticada` basta estar autenticado; as demais precisam estar em `ctx.permissoes` */
  autoriza?(ctx: Contexto, permissao: string): boolean
  /** implementação das operações declaradas que não são CRUD; sem implementação a rota responde 501 */
  operacoes?: Record<string, (e: EntradaOperacao) => Promise<unknown>>
  /** os nós `evento` dos eventos que o serviço publica (contrato do payload, versão e chave de idempotência). Obrigatório se alguma operação declara `publica` */
  eventos?: Record<string, import('@polaris/schema').No>
  /** limite do corpo em bytes (padrão 100 KB) */
  limiteCorpoBytes?: number
  /** recebe erros inesperados (500); o cliente nunca vê a mensagem */
  aoErro?(erro: unknown, rota: string): void
}
