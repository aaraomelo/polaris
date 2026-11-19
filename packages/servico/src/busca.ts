// Busca de texto das entidades que declaram `busca: { campos }`: por palavra (até 5, todas precisam aparecer), sem diferenciar maiúsculas NEM acentos, em Postgres puro (sem extensão `unaccent`).
// A normalização é a MESMA no termo (aqui, em JS) e na coluna (em SQL, com `translate`): por isso a tabela de acentos é gerada uma vez e usada nos dois lados.

const BASE = (c: string) => c.normalize('NFD').replace(/\p{M}+/gu, '')
const pares: Array<[string, string]> = []
for (let cp = 0xc0; cp <= 0x24f; cp++) { const c = String.fromCodePoint(cp), b = BASE(c); if (b !== c && /^[A-Za-z]$/.test(b)) pares.push([c, b.toLowerCase()]) } // Latin-1, Latin Extended-A e B: á é ç ñ ü ø…
export const ACENTOS = pares.map(([c]) => c).join(''), SEM_ACENTO = pares.map(([, b]) => b).join('')

/** o termo como a coluna fica depois de `lower(translate(…))`: sem acento e em minúsculas */
export const normalizaTermo = (s: string): string => BASE(s).toLowerCase()
export const palavrasDe = (s: string, max = 5): string[] => normalizaTermo(String(s).slice(0, 100)).split(/[^\p{L}\p{N}]+/u).filter(Boolean).slice(0, max)
/** `%palavra%` com os curingas do LIKE escapados */
const paraLike = (p: string) => `%${p.replace(/[\\%_]/g, (c) => `\\${c}`)}%`

/** condição SQL (AND de palavras; cada uma em OR entre os campos) e acrescenta os parâmetros; null se o termo não tem palavra alguma */
export function condicaoDeBusca(campos: string[], termo: string, coluna: (c: string) => string, ps: unknown[]): string | null {
  const palavras = palavrasDe(termo); if (!palavras.length) return null
  const lit = (s: string) => `'${s.replace(/'/g, "''")}'`
  const norm = (c: string) => `lower(translate(coalesce(${coluna(c)}, ''), ${lit(ACENTOS)}, ${lit(SEM_ACENTO)}))`
  return palavras.map((p) => { ps.push(paraLike(p)); return `(${campos.map((c) => `${norm(c)} LIKE $${ps.length} ESCAPE '\\'`).join(' OR ')})` }).join(' AND ')
}
