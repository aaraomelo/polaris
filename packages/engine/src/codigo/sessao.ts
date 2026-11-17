import { sha256Hex } from './sha256'
import type { PedidoCodigo, ResultadoCodigo, Sandbox } from './sandbox'

export type ConfigCodigo = {
  sandbox: Sandbox
  /** soma máxima de tempo de execução (cache misses) por passagem de render; padrão 2000 ms */
  orcamentoMs?: number
  /** máximo de execuções (cache misses) por passagem; padrão 100 */
  maxExecucoes?: number
  /** origens https liberadas pela plataforma para permissoes rede:/imagens: (comparação exata) */
  origensPermitidas?: readonly string[]
  /** "agora" fixo da requisição (ISO). Vai no estado para o cliente reproduzir a mesma saída. */
  agora?: string
}

/**
 * Executa blocos de código com orçamento e cache. O cache evita reexecutar o mesmo (código, props, contexto)
 * — um `repetir` com itens iguais, ou um re-render do cliente — e também guarda FALHAS (um bloco que estourou o prazo
 * não é tentado de novo a cada render). O orçamento é por passagem de render e protege o servidor de uma página com
 * milhares de blocos de código.
 */
export class SessaoCodigo {
  private readonly cache = new Map<string, ResultadoCodigo>()
  private gastoMs = 0
  private execucoes = 0
  constructor(readonly cfg: ConfigCodigo, private readonly maxCache = 200) {}

  novaPassagem(): void { this.gastoMs = 0; this.execucoes = 0 }

  executa(pedido: PedidoCodigo): ResultadoCodigo {
    const chave = sha256Hex(JSON.stringify([pedido.fonte, pedido.props ?? null, pedido.contexto, pedido.ms, pedido.memoriaBytes, pedido.saidaMaxBytes]))
    const hit = this.cache.get(chave)
    if (hit) return hit
    const orcamento = this.cfg.orcamentoMs ?? 2000
    if (this.gastoMs >= orcamento) return { ok: false, tipo: 'orcamento', erro: `orçamento de ${orcamento} ms de código por render esgotado`, ms: 0 }
    if (this.execucoes >= (this.cfg.maxExecucoes ?? 100)) return { ok: false, tipo: 'orcamento', erro: `mais de ${this.cfg.maxExecucoes ?? 100} execuções de código em um render`, ms: 0 }
    this.execucoes++
    const r = this.cfg.sandbox.executa(pedido)
    this.gastoMs += r.ms
    if (this.cache.size >= this.maxCache) this.cache.delete(this.cache.keys().next().value as string)
    if (r.ok || r.tipo !== 'orcamento') this.cache.set(chave, r)
    return r
  }
}
