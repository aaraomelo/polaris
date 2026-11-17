// Contrato entre o runtime e quem executa código de tenant. Duas implementações:
//   @polaris/engine/sandbox       QuickJS (WASM) no mesmo processo: isolamento de realm e memória; prazo cooperativo
//   @polaris/engine/sandbox-node  QuickJS num worker_thread: o mesmo + PREEMPÇÃO (o worker é morto no prazo)

export type PedidoCodigo = {
  fonte: string
  props: unknown
  contexto: { agora: string; idioma?: string; tenant?: unknown }
  /** prazo cooperativo em ms (padrão 150) */
  ms?: number
  /** limite de memória do interpretador em bytes (padrão 8 MB) */
  memoriaBytes?: number
  /** tamanho máximo da saída em bytes (padrão 256 KB) */
  saidaMaxBytes?: number
}

export type TipoFalha = 'sintaxe' | 'execucao' | 'tempo' | 'memoria' | 'saida' | 'entrada' | 'indisponivel' | 'orcamento'

export type ResultadoCodigo =
  | { ok: true; saida: string; logs: string[]; ms: number }
  | { ok: false; tipo: TipoFalha; erro: string; ms: number }

export interface Sandbox {
  /** true se o tempo é garantido por preempção (o executor é morto no prazo); false = só cooperativo */
  readonly duro: boolean
  /** Síncrono: o SSR é síncrono. Nunca lança. */
  executa(pedido: PedidoCodigo): ResultadoCodigo
  libera(): void
}

export const PADROES_CODIGO = { ms: 150, memoriaBytes: 8 * 1024 * 1024, saidaMaxBytes: 256 * 1024, entradaMaxBytes: 64 * 1024 }
