import { CacheDados } from '@polaris/engine'

// Cache de dados do BFF com ESCOPO. O cache do engine guarda por [tenant, fonte, args]; no gateway isso não basta: um dado `protegida` varia com o USUÁRIO
// (papéis, escopo de linha), então servir a resposta da Ana ao Bia seria vazar dado. Regra:
//   dado de operação `publica`   → escopo do TENANT (todos os usuários do tenant compartilham);
//   qualquer outro (e `estatico` não importa) → escopo do USUÁRIO + papéis: nunca compartilha entre usuários.
// O tenant está SEMPRE na chave. Erro nunca é guardado (o engine só guarda sucesso). Tamanho limitado (LRU) e deduplicação de chamadas em voo.

export type EscopoCache = { tenantId: string; usuario?: string; papeis?: string[] }

/** O cache compartilhado do processo, com índice por tenant para invalidar. */
export class CacheDoGateway extends CacheDados {
  private readonly porTenant = new Map<string, Set<string>>()
  hits = 0; misses = 0
  override set(chave: string, valor: unknown, ttl: number): void {
    super.set(chave, valor, ttl)
    const t = tenantDaChave(chave); if (t === undefined) return
    const s = this.porTenant.get(t) ?? new Set<string>(); s.add(chave); this.porTenant.set(t, s)
  }
  /** apaga tudo o que é DESTE tenant (escopo tenant e escopo usuário); devolve quantas entradas */
  invalidaTenant(tenantId: string): number {
    const s = this.porTenant.get(tenantId); if (!s) return 0
    let n = 0; for (const c of s) if (this.apaga(c)) n++
    this.porTenant.delete(tenantId); return n
  }
}
const tenantDaChave = (chave: string): string | undefined => { try { const a = JSON.parse(chave) as unknown[]; const e = String(a[0]); return e.split('|')[1] } catch { return undefined } }

/** A visão de UMA requisição sobre o cache do processo: reescreve a chave com o escopo certo para cada fonte. */
export class VisaoDeCache extends CacheDados {
  constructor(private readonly base: CacheDoGateway, private readonly escopo: EscopoCache, private readonly publica: (fonteId: string) => boolean, private readonly aoConsultar?: (hit: boolean) => void) { super({ maxItens: 1 }) }
  private remapeia(chave: string): string {
    const [, fonteId, complemento] = JSON.parse(chave) as [unknown, string, unknown]
    const t = this.escopo.tenantId
    // formato do escopo: `t|<tenant>` ou `u|<tenant>|<usuario>|<papéis>`: o tenant fica sempre na 2ª posição (é o que `invalidaTenant` indexa)
    const e = this.publica(fonteId) || !this.escopo.usuario ? `t|${t}` : `u|${t}|${this.escopo.usuario}|${[...(this.escopo.papeis ?? [])].sort().join(',')}`
    return JSON.stringify([e, fonteId, complemento])
  }
  override get(chave: string) { const r = this.base.get(this.remapeia(chave)); if (r) this.base.hits++; else this.base.misses++; this.aoConsultar?.(!!r); return r }
  override set(chave: string, valor: unknown, ttl: number) { this.base.set(this.remapeia(chave), valor, ttl) }
  override unico<T>(chave: string, f: () => Promise<T>): Promise<T> { return this.base.unico(this.remapeia(chave), f) }
}
