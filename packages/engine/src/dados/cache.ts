// Cache em memória para fontes de dados: TTL, tamanho máximo e deduplicação de chamadas em voo.
// A chave SEMPRE começa pelo tenant (quem monta a chave garante); aqui só se guarda e se expira.

export type Relogio = () => number

export class CacheDados {
  private readonly itens = new Map<string, { valor: unknown; expira: number }>()
  private readonly emVoo = new Map<string, Promise<unknown>>()

  constructor(private readonly opcoes: { maxItens?: number; agora?: Relogio } = {}) {}

  private agora() { return (this.opcoes.agora ?? Date.now)() }

  get(chave: string): { valor: unknown } | undefined {
    const e = this.itens.get(chave)
    if (!e) return undefined
    if (e.expira <= this.agora()) { this.itens.delete(chave); return undefined }
    this.itens.delete(chave); this.itens.set(chave, e) // LRU: o mais recente vai para o fim
    return { valor: structuredClone(e.valor) }
  }

  set(chave: string, valor: unknown, ttlSegundos: number): void {
    this.itens.set(chave, { valor: structuredClone(valor), expira: this.agora() + ttlSegundos * 1000 })
    const max = this.opcoes.maxItens ?? 500
    while (this.itens.size > max) this.itens.delete(this.itens.keys().next().value as string)
  }

  /** Executa `f` uma vez por chave enquanto ela estiver em voo; chamadas concorrentes compartilham a promessa. */
  async unico<T>(chave: string, f: () => Promise<T>): Promise<T> {
    const atual = this.emVoo.get(chave)
    if (atual) return atual as Promise<T>
    const p = f().finally(() => this.emVoo.delete(chave))
    this.emVoo.set(chave, p)
    return p
  }

  /** remove UMA chave (para invalidação por quem conhece o escopo); devolve se existia */
  apaga(chave: string): boolean { return this.itens.delete(chave) }
  limpa(): void { this.itens.clear() }
  get tamanho(): number { return this.itens.size }
}
