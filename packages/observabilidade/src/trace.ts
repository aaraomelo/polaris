import { AsyncLocalStorage } from 'node:async_hooks'
import { randomBytes } from 'node:crypto'
import { chaveSensivel, REDIGIDO, redigeTexto } from './redacao'

// Traces, no padrão W3C Trace Context (`traceparent`). Um span por unidade de trabalho; o contexto atravessa os `await` (AsyncLocalStorage) e atravessa serviços
// (cabeçalho HTTP e a coluna `traceparent` do outbox). Cabeçalho de fora NUNCA é confiado: formato inválido gera um trace novo.

export type ContextoTrace = { traceId: string; spanId: string; amostrado: boolean }
export type SpanFinal = {
  servico: string; traceId: string; spanId: string; paiId?: string; nome: string; tipo: 'servidor' | 'cliente' | 'interno' | 'produtor' | 'consumidor'
  inicioMs: number; duracaoMs: number; atributos: Record<string, string | number | boolean>
  eventos: Array<{ nome: string; emMs: number; atributos?: Record<string, string | number | boolean> }>
  status: { codigo: 'ok' | 'erro'; mensagem?: string }
}
export type Exportador = { exporta(span: SpanFinal): void }

const TRACEPARENT = /^([0-9a-f]{2})-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})(-.*)?$/
const ZEROS32 = '0'.repeat(32), ZEROS16 = '0'.repeat(16)

/** Interpreta um `traceparent` recebido. Devolve null se inválido (maiúsculas, versão ff, ids zerados, tamanho errado…): quem recebe começa um trace novo. */
export function parseTraceparent(h: unknown): ContextoTrace | null {
  if (typeof h !== 'string' || h.length > 512) return null
  const m = TRACEPARENT.exec(h)
  if (!m) return null
  const [, versao, traceId, spanId, flags, resto] = m
  if (versao === 'ff') return null
  if (versao === '00' && (resto !== undefined || h.length !== 55)) return null // a versão 00 tem formato exato; versões futuras podem acrescentar campos
  if (traceId === ZEROS32 || spanId === ZEROS16) return null
  return { traceId: traceId!, spanId: spanId!, amostrado: (parseInt(flags!, 16) & 1) === 1 }
}
export const formataTraceparent = (c: ContextoTrace) => `00-${c.traceId}-${c.spanId}-${c.amostrado ? '01' : '00'}`

const id = (bytes: number) => { for (;;) { const h = randomBytes(bytes).toString('hex'); if (h !== '0'.repeat(bytes * 2)) return h } }

export class Span {
  readonly traceId: string; readonly spanId: string; readonly paiId: string | undefined; readonly amostrado: boolean
  private atributos: Record<string, string | number | boolean> = {}
  private eventos: SpanFinal['eventos'] = []
  private status: SpanFinal['status'] = { codigo: 'ok' }
  private fim_ = false
  private readonly inicio = performance.now(); private readonly inicioMs = Date.now()
  constructor(private readonly t: Tracer, readonly nome: string, readonly tipo: SpanFinal['tipo'], pai: ContextoTrace | null, amostrado: boolean) {
    this.traceId = pai?.traceId ?? id(16); this.spanId = id(8); this.paiId = pai?.spanId; this.amostrado = amostrado
  }
  define(chave: string, valor: unknown): this {
    if (this.fim_ || Object.keys(this.atributos).length >= 64) return this
    this.atributos[String(chave).slice(0, 64)] = chaveSensivel(chave) ? REDIGIDO : typeof valor === 'number' || typeof valor === 'boolean' ? (Number.isFinite(valor as number) || typeof valor === 'boolean' ? (valor as number | boolean) : String(valor)) : redigeTexto(String(valor)).slice(0, 500)
    return this
  }
  evento(nome: string, atributos?: Record<string, unknown>): this {
    if (this.fim_ || this.eventos.length >= 32) return this
    this.eventos.push({ nome: nome.slice(0, 64), emMs: Math.round(performance.now() - this.inicio), ...(atributos ? { atributos: Object.fromEntries(Object.entries(atributos).slice(0, 16).map(([k, v]) => [k, chaveSensivel(k) ? REDIGIDO : redigeTexto(String(v)).slice(0, 200)])) } : {}) })
    return this
  }
  /** marca o span como falho (o fim ainda é preciso) */
  erro(e: unknown): this { this.status = { codigo: 'erro', mensagem: redigeTexto(e instanceof Error ? `${e.name}: ${e.message}` : String(e)).slice(0, 300) }; return this }
  traceparent(): string { return formataTraceparent({ traceId: this.traceId, spanId: this.spanId, amostrado: this.amostrado }) }
  contexto(): ContextoTrace { return { traceId: this.traceId, spanId: this.spanId, amostrado: this.amostrado } }
  fim(): void {
    if (this.fim_) return
    this.fim_ = true
    if (!this.amostrado) return
    this.t.exportador.exporta({ servico: this.t.servico, traceId: this.traceId, spanId: this.spanId, ...(this.paiId ? { paiId: this.paiId } : {}), nome: this.nome, tipo: this.tipo, inicioMs: this.inicioMs, duracaoMs: Math.round((performance.now() - this.inicio) * 1000) / 1000, atributos: this.atributos, eventos: this.eventos, status: this.status })
  }
}

export type OpcoesTracer = { servico: string; exportador: Exportador; /** fração de traces RAIZ amostrados (0–1; padrão 1). Quem recebe um pai segue a decisão do pai. */ amostragem?: number; aleatorio?: () => number }
export type OpcoesSpan = { pai?: ContextoTrace | null; tipo?: SpanFinal['tipo']; atributos?: Record<string, unknown> }

export class Tracer {
  readonly servico: string; readonly exportador: Exportador
  private readonly als = new AsyncLocalStorage<Span>()
  private readonly amostragem: number; private readonly aleatorio: () => number
  constructor(o: OpcoesTracer) { this.servico = o.servico; this.exportador = o.exportador; this.amostragem = Math.min(1, Math.max(0, o.amostragem ?? 1)); this.aleatorio = o.aleatorio ?? Math.random }
  /** o span corrente (o contexto atravessa awaits) */
  atual(): Span | undefined { return this.als.getStore() }
  /** inicia um span; sem `pai`, filho do span corrente; `pai: null` força um trace novo */
  inicia(nome: string, o: OpcoesSpan = {}): Span {
    const pai = o.pai === undefined ? (this.atual()?.contexto() ?? null) : o.pai
    const amostrado = pai ? pai.amostrado : this.aleatorio() < this.amostragem
    const s = new Span(this, nome, o.tipo ?? 'interno', pai, amostrado)
    for (const [k, v] of Object.entries(o.atributos ?? {})) s.define(k, v)
    return s
  }
  /** roda `fn` COM `span` como o corrente. Use a forma com callback nos hooks do Fastify (`com(span, done)`): `enterWith` num hook assíncrono se perde na continuação. */
  com<T>(span: Span, fn: () => T): T { return this.als.run(span, fn) }
  /** roda `fn` num span filho; termina o span (com erro se `fn` falhar) */
  async emSpan<T>(nome: string, o: OpcoesSpan, fn: (s: Span) => Promise<T> | T): Promise<T> {
    const s = this.inicia(nome, o)
    try { return await this.als.run(s, () => fn(s)) } catch (e) { s.erro(e); throw e } finally { s.fim() }
  }
  /** continua um trace vindo de FORA (cabeçalho HTTP, coluna do outbox): inválido → trace novo */
  extrai(traceparent: unknown): ContextoTrace | null { return parseTraceparent(traceparent) }
}

export const exportadorMemoria = (): Exportador & { spans: SpanFinal[]; limpa(): void } => { const spans: SpanFinal[] = []; return { spans, exporta: (s) => { spans.push(s) }, limpa: () => { spans.length = 0 } } }
