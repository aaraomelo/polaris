// Desfazer/refazer por INSTANTÂNEOS imutáveis (as operações da árvore compartilham estrutura, então guardar N versões custa pouco).
// Edições seguidas do mesmo `grupo` (digitar num campo) em até `agrupaMs` viram UM passo. `sujo` diz se há algo a salvar.
export type OpcoesHistorico = { limite?: number; agrupaMs?: number; agora?: () => number }
type Passo<T> = { estado: T; rotulo: string; grupo?: string; em: number }

export class Historico<T> {
  private passado: Array<Passo<T>> = []; private futuro: Array<Passo<T>> = []
  private atualP: Passo<T>; private salvo: T
  private readonly limite: number; private readonly agrupaMs: number; private readonly agora: () => number
  constructor(inicial: T, o: OpcoesHistorico = {}) {
    this.limite = Math.max(1, o.limite ?? 200); this.agrupaMs = o.agrupaMs ?? 800; this.agora = o.agora ?? (() => Date.now())
    this.atualP = { estado: inicial, rotulo: 'início', em: this.agora() }; this.salvo = inicial
  }
  get atual(): T { return this.atualP.estado }
  get podeDesfazer(): boolean { return this.passado.length > 0 }
  get podeRefazer(): boolean { return this.futuro.length > 0 }
  get sujo(): boolean { return !Object.is(this.atualP.estado, this.salvo) }
  get rotuloDesfazer(): string | undefined { return this.passado.length ? this.atualP.rotulo : undefined }
  get rotuloRefazer(): string | undefined { return this.futuro[this.futuro.length - 1]?.rotulo }
  get tamanho(): number { return this.passado.length + 1 + this.futuro.length }
  /** registra um novo estado; igual ao atual (mesma referência) é ignorado. Apaga o futuro. */
  aplica(novo: T, rotulo: string, grupo?: string): void {
    if (Object.is(novo, this.atualP.estado)) return
    const t = this.agora(), agrupa = grupo !== undefined && this.atualP.grupo === grupo && t - this.atualP.em <= this.agrupaMs && this.passado.length > 0
    this.futuro = []
    if (agrupa) { this.atualP = { estado: novo, rotulo, grupo: grupo!, em: t }; return } // substitui o passo corrente, mantendo o ponto de volta anterior
    this.passado.push(this.atualP); if (this.passado.length > this.limite) this.passado.shift()
    this.atualP = { estado: novo, rotulo, ...(grupo !== undefined ? { grupo } : {}), em: t }
  }
  desfaz(): T { const p = this.passado.pop(); if (p) { this.futuro.push(this.atualP); this.atualP = { ...p, em: 0 } } return this.atual }
  refaz(): T { const f = this.futuro.pop(); if (f) { this.passado.push(this.atualP); this.atualP = { ...f, em: 0 } } return this.atual }
  /** marca o estado atual como o salvo (o servidor aceitou) */
  marcaSalvo(): void { this.salvo = this.atualP.estado }
  /** troca tudo (abriu outro nó, ou recarregou do servidor): zera o histórico */
  reinicia(estado: T): void { this.passado = []; this.futuro = []; this.atualP = { estado, rotulo: 'início', em: this.agora() }; this.salvo = estado }
}
