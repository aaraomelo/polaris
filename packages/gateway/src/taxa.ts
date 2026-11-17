// Limite de taxa por balde de fichas (token bucket), em memória, com MEMÓRIA LIMITADA: um atacante que varia a chave não faz o mapa crescer sem fim
// (LRU: as chaves mais antigas saem). Por processo: com várias instâncias do gateway o limite efetivo é multiplicado; use um limitador central se precisar do exato.

export type OpcoesTaxa = { capacidade: number; porSegundo: number; maxChaves?: number; agora?: () => number }
export class LimiteTaxa {
  private readonly baldes = new Map<string, { fichas: number; em: number }>()
  constructor(private readonly o: OpcoesTaxa) {
    if (!(o.capacidade >= 1) || !(o.porSegundo > 0)) throw new Error('capacidade ≥ 1 e porSegundo > 0')
  }
  /** consome `custo` fichas da chave; devolve se passou e, se não, em quantos segundos haverá ficha */
  tenta(chave: string, custo = 1): { ok: true } | { ok: false; esperaSeg: number } {
    const agora = (this.o.agora ?? Date.now)()
    const b = this.baldes.get(chave) ?? { fichas: this.o.capacidade, em: agora }
    b.fichas = Math.min(this.o.capacidade, b.fichas + ((agora - b.em) / 1000) * this.o.porSegundo); b.em = agora
    this.baldes.delete(chave) // LRU: a mais recente vai para o fim
    let r: { ok: true } | { ok: false; esperaSeg: number }
    if (b.fichas >= custo) { b.fichas -= custo; r = { ok: true } } else r = { ok: false, esperaSeg: Math.ceil((custo - b.fichas) / this.o.porSegundo) }
    this.baldes.set(chave, b)
    const max = this.o.maxChaves ?? 10_000
    while (this.baldes.size > max) this.baldes.delete(this.baldes.keys().next().value as string)
    return r
  }
  get tamanho() { return this.baldes.size }
}
