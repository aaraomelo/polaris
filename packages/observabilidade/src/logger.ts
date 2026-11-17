import { redige } from './redacao'
import type { Tracer } from './trace'

export type Nivel = 'debug' | 'info' | 'warn' | 'error'
/** `silencio` não emite nada (testes, ferramentas de linha de comando) */
export type NivelMinimo = Nivel | 'silencio'
const ORDEM: Record<NivelMinimo, number> = { debug: 10, info: 20, warn: 30, error: 40, silencio: 1000 }
const RESERVADAS = new Set(['ts', 'nivel', 'msg'])

export type Logger = {
  debug(msg: string, campos?: Record<string, unknown>): void
  info(msg: string, campos?: Record<string, unknown>): void
  warn(msg: string, campos?: Record<string, unknown>): void
  error(msg: string, campos?: Record<string, unknown>): void
  /** logger com campos fixos a mais (p. ex. o tenant) */
  filho(campos: Record<string, unknown>): Logger
}
export type OpcoesLogger = {
  /** padrão: info */
  nivel?: NivelMinimo
  /** recebe UMA linha JSON (sem quebra); padrão: stdout */
  saida?: (linha: string) => void
  base?: Record<string, unknown>
  /** acrescenta traceId/spanId do span corrente a cada linha */
  tracer?: Tracer
  relogio?: () => Date
}

/**
 * Log estruturado: uma linha JSON por evento. Tudo passa por `redige` (chaves e valores sensíveis mascarados, sem ciclos, tamanho limitado). Como a saída
 * é `JSON.stringify`, quebra de linha ou aspas em qualquer valor viram escape: não dá para FORJAR uma linha de log por dentro de outra.
 */
export function criaLogger(o: OpcoesLogger = {}): Logger {
  const minimo = ORDEM[o.nivel ?? 'info']
  const saida = o.saida ?? ((l: string) => { process.stdout.write(`${l}\n`) })
  const relogio = o.relogio ?? (() => new Date())
  const novo = (fixos: Record<string, unknown>): Logger => {
    const emite = (nivel: Nivel) => (msg: string, campos?: Record<string, unknown>) => {
      if (ORDEM[nivel] < minimo) return
      const span = o.tracer?.atual()
      const extras: Record<string, unknown> = {}
      for (const [k, v] of Object.entries({ ...fixos, ...(campos ?? {}) })) extras[RESERVADAS.has(k) ? `campo_${k}` : k] = v
      const linha = { ts: relogio().toISOString(), nivel, msg: String(redige(String(msg))), ...(span ? { traceId: span.traceId, spanId: span.spanId } : {}), ...(redige(extras) as Record<string, unknown>) }
      let texto: string
      try { texto = JSON.stringify(linha) } catch { texto = JSON.stringify({ ts: linha.ts, nivel, msg: 'falha ao serializar o log' }) }
      try { saida(texto) } catch { /* o log nunca derruba quem o chamou */ }
    }
    return { debug: emite('debug'), info: emite('info'), warn: emite('warn'), error: emite('error'), filho: (c) => novo({ ...fixos, ...c }) }
  }
  return novo(o.base ?? {})
}
