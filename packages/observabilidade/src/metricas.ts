// Métricas no formato de exposição do Prometheus (texto). Contador, gauge e histograma, com rótulos validados e PROTEÇÃO DE CARDINALIDADE:
// um rótulo vindo de dado do usuário não pode criar séries sem limite (derrubaria a memória e o Prometheus): passado o limite, as séries novas caem em `_outros`.

const NOME = /^[a-zA-Z_:][a-zA-Z0-9_:]*$/
const NOME_ROTULO = /^[a-zA-Z_][a-zA-Z0-9_]*$/
const escHelp = (s: string) => s.replace(/\\/g, '\\\\').replace(/\n/g, '\\n')
const escValor = (s: string) => s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\r/g, '\\r')
const num = (v: number) => (Number.isNaN(v) ? 'NaN' : v === Infinity ? '+Inf' : v === -Infinity ? '-Inf' : String(v))

type Rotulos = Record<string, string | number | boolean>
type Serie = { rotulos: string[]; valor: number }
type SerieH = { rotulos: string[]; buckets: number[]; soma: number; total: number }

abstract class Base {
  protected readonly nomes: string[]
  constructor(readonly nome: string, readonly ajuda: string, nomesRotulos: string[], protected readonly limite: number, protected readonly descarte: () => void, protected readonly fixos: Array<[string, string]> = []) {
    if (!NOME.test(nome)) throw new Error(`nome de métrica inválido: ${JSON.stringify(nome)}`)
    for (const r of nomesRotulos) if (!NOME_ROTULO.test(r) || r.startsWith('__')) throw new Error(`nome de rótulo inválido: ${JSON.stringify(r)}`)
    this.nomes = nomesRotulos
  }
  protected chave(r: Rotulos | undefined, existentes: Map<string, unknown>): { chave: string; valores: string[] } {
    const valores = this.nomes.map((n) => { const v = r?.[n]; return v === undefined ? '' : String(v).slice(0, 200) })
    let chave = JSON.stringify(valores)
    if (!existentes.has(chave) && existentes.size >= this.limite) { this.descarte(); const o = this.nomes.map(() => '_outros'); return { chave: JSON.stringify(o), valores: o } }
    return { chave, valores }
  }
  protected linha(sufixo: string, valores: string[], v: number, extra?: [string, string]): string {
    const pares = [...this.fixos.map(([n, v]) => `${n}="${escValor(v)}"`), ...this.nomes.map((n, i) => `${n}="${escValor(valores[i]!)}"`), ...(extra ? [`${extra[0]}="${extra[1]}"`] : [])]
    return `${this.nome}${sufixo}${pares.length ? `{${pares.join(',')}}` : ''} ${num(v)}`
  }
  abstract exposicao(): string[]
}

export class Contador extends Base {
  private series = new Map<string, Serie>()
  inc(rotulos?: Rotulos, n = 1): void {
    if (!(n >= 0) || !Number.isFinite(n)) return // contador só sobe
    const { chave, valores } = this.chave(rotulos, this.series)
    const s = this.series.get(chave) ?? { rotulos: valores, valor: 0 }; s.valor += n; this.series.set(chave, s)
  }
  valor(rotulos?: Rotulos): number { return this.series.get(this.chave(rotulos, this.series).chave)?.valor ?? 0 }
  exposicao() { return [`# HELP ${this.nome} ${escHelp(this.ajuda)}`, `# TYPE ${this.nome} counter`, ...[...this.series.values()].map((s) => this.linha('', s.rotulos, s.valor))] }
}
export class Gauge extends Base {
  private series = new Map<string, Serie>()
  set(v: number, rotulos?: Rotulos): void { const { chave, valores } = this.chave(rotulos, this.series); this.series.set(chave, { rotulos: valores, valor: v }) }
  inc(rotulos?: Rotulos, n = 1): void { const { chave, valores } = this.chave(rotulos, this.series); const s = this.series.get(chave) ?? { rotulos: valores, valor: 0 }; s.valor += n; this.series.set(chave, s) }
  dec(rotulos?: Rotulos, n = 1): void { this.inc(rotulos, -n) }
  valor(rotulos?: Rotulos): number { return this.series.get(this.chave(rotulos, this.series).chave)?.valor ?? 0 }
  exposicao() { return [`# HELP ${this.nome} ${escHelp(this.ajuda)}`, `# TYPE ${this.nome} gauge`, ...[...this.series.values()].map((s) => this.linha('', s.rotulos, s.valor))] }
}
export class Histograma extends Base {
  private series = new Map<string, SerieH>()
  constructor(nome: string, ajuda: string, rotulos: string[], limite: number, descarte: () => void, readonly limites: number[], fixos: Array<[string, string]> = []) {
    super(nome, ajuda, rotulos, limite, descarte, fixos)
    if (!limites.length || limites.some((b, i) => !Number.isFinite(b) || (i > 0 && b <= limites[i - 1]!))) throw new Error('os buckets devem ser finitos e estritamente crescentes')
    if (this.nomes.includes('le')) throw new Error("'le' é reservado em histogramas")
  }
  observa(v: number, rotulos?: Rotulos): void {
    if (!Number.isFinite(v)) return
    const { chave, valores } = this.chave(rotulos, this.series)
    const s = this.series.get(chave) ?? { rotulos: valores, buckets: this.limites.map(() => 0), soma: 0, total: 0 }
    this.limites.forEach((b, i) => { if (v <= b) s.buckets[i]!++ })
    s.soma += v; s.total++; this.series.set(chave, s)
  }
  exposicao() {
    const out = [`# HELP ${this.nome} ${escHelp(this.ajuda)}`, `# TYPE ${this.nome} histogram`]
    for (const s of this.series.values()) {
      this.limites.forEach((b, i) => out.push(this.linha('_bucket', s.rotulos, s.buckets[i]!, ['le', num(b)]))) // cumulativo: cada observação conta em todo bucket que a comporta
      out.push(this.linha('_bucket', s.rotulos, s.total, ['le', '+Inf']), this.linha('_sum', s.rotulos, s.soma), this.linha('_count', s.rotulos, s.total))
    }
    return out
  }
}

export const BUCKETS_SEGUNDOS = [0.005, 0.01, 0.025, 0.05, 0.1, 0.25, 0.5, 1, 2.5, 5, 10]

export class Metricas {
  private readonly todas = new Map<string, Base>()
  private readonly descartadas: Contador
  private readonly fixos: Array<[string, string]>
  /** `fixos`: rótulos que vão em TODA série (p. ex. `servico`); nomes validados como os demais */
  constructor(private readonly limiteSeries = 1000, fixos: Record<string, string> = {}) {
    for (const k of Object.keys(fixos)) if (!NOME_ROTULO.test(k) || k.startsWith('__')) throw new Error(`nome de rótulo inválido: ${JSON.stringify(k)}`)
    this.fixos = Object.entries(fixos)
    this.descartadas = this.registra(new Contador('metricas_series_descartadas_total', 'Séries novas descartadas por excederem o limite de cardinalidade (viraram _outros)', [], 10, () => {}, this.fixos))
  }
  private registra<T extends Base>(m: T): T {
    if (this.todas.has(m.nome)) throw new Error(`métrica '${m.nome}' já registrada`)
    this.todas.set(m.nome, m); return m
  }
  contador(nome: string, ajuda: string, rotulos: string[] = []) { return this.registra(new Contador(nome, ajuda, rotulos, this.limiteSeries, () => this.descartadas.inc(), this.fixos)) }
  gauge(nome: string, ajuda: string, rotulos: string[] = []) { return this.registra(new Gauge(nome, ajuda, rotulos, this.limiteSeries, () => this.descartadas.inc(), this.fixos)) }
  histograma(nome: string, ajuda: string, rotulos: string[] = [], buckets: number[] = BUCKETS_SEGUNDOS) { return this.registra(new Histograma(nome, ajuda, rotulos, this.limiteSeries, () => this.descartadas.inc(), buckets, this.fixos)) }
  /** a exposição completa, no formato de texto do Prometheus */
  texto(): string { return `${[...this.todas.values()].flatMap((m) => m.exposicao()).join('\n')}\n` }
}
