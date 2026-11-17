import { criaLogger, type Logger, type NivelMinimo } from './logger'
import { Metricas } from './metricas'
import { Tracer, type Exportador } from './trace'

export type Observabilidade = { log: Logger; metricas: Metricas; tracer: Tracer }
export type OpcoesObservabilidade = {
  servico: string
  versao?: string
  /** onde vai cada linha de log (padrão: stdout) */
  saida?: (linha: string) => void
  /** padrão: a variável de ambiente POLARIS_LOG_NIVEL (debug|info|warn|error|silencio), senão info */
  nivel?: NivelMinimo
  /** para onde vão os spans prontos (padrão: o log, no nível debug); troque por um exportador OTLP/Jaeger */
  exportador?: Exportador
  /** fração de traces raiz amostrados (0–1; padrão 1) */
  amostragem?: number
  /** máximo de séries por métrica (padrão 1000) */
  limiteSeries?: number
}

/** O conjunto padrão: logger (com o trace corrente em cada linha), métricas e tracer, amarrados entre si. */
export function criaObservabilidade(o: OpcoesObservabilidade): Observabilidade {
  let log!: Logger // o exportador padrão escreve no log, que por sua vez lê o span corrente do tracer: criados em sequência
  const exportador: Exportador = o.exportador ?? { exporta: (s) => log.debug('span', { span: s }) }
  const tracer = new Tracer({ servico: o.servico, exportador, ...(o.amostragem !== undefined ? { amostragem: o.amostragem } : {}) })
  const env = process.env.POLARIS_LOG_NIVEL
  const nivel = o.nivel ?? (env === 'debug' || env === 'info' || env === 'warn' || env === 'error' || env === 'silencio' ? env : undefined)
  log = criaLogger({ ...(o.saida ? { saida: o.saida } : {}), ...(nivel ? { nivel } : {}), base: { servico: o.servico, ...(o.versao ? { versao: o.versao } : {}) }, tracer })
  return { log, metricas: new Metricas(o.limiteSeries ?? 1000, { servico: o.servico }), tracer }
}
