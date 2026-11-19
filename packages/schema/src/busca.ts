// Busca de texto das entidades (`busca: { campos, modo }`): a normalização é a MESMA no termo (JS) e na coluna (SQL, com `translate`), e a expressão da coluna é UMA SÓ,
// usada na consulta E no índice (`modo: aproximada`): é isso que permite ao Postgres usar o índice. Postgres puro, sem `unaccent`; o modo aproximado usa `pg_trgm`.
const BASE = (c: string) => c.normalize('NFD').replace(/\p{M}+/gu, '')
const pares: Array<[string, string]> = []
for (let cp = 0xc0; cp <= 0x24f; cp++) { const c = String.fromCodePoint(cp), b = BASE(c); if (b !== c && /^[A-Za-z]$/.test(b)) pares.push([c, b.toLowerCase()]) } // Latin-1, Latin Extended-A e B: á é ç ñ ü ø…
export const ACENTOS = pares.map(([c]) => c).join(''), SEM_ACENTO = pares.map(([, b]) => b).join('')
/** o schema Postgres onde o `pg_trgm` é instalado (o do serviço não é de ninguém, e `public` pode estar fechado para o papel de migração) */
export const SCHEMA_EXTENSOES = 'ext'

/** o termo como a coluna fica depois de `lower(translate(…))`: sem acento e em minúsculas */
export const normalizaTermo = (s: string): string => BASE(s).toLowerCase()
export const palavrasDe = (s: string, max = 5): string[] => normalizaTermo(String(s).slice(0, 100)).split(/[^\p{L}\p{N}]+/u).filter(Boolean).slice(0, max)
/** `%palavra%` com os curingas do LIKE escapados */
export const paraLike = (p: string) => `%${p.replace(/[\\%_]/g, (c) => `\\${c}`)}%`
const lit = (s: string) => `'${s.replace(/'/g, "''")}'`
/** a coluna de busca: os campos juntos por espaço, sem acento, em minúsculas (idêntica na consulta e no índice) */
export const exprDeBusca = (campos: string[], coluna: (c: string) => string): string => `lower(translate(${campos.map((c) => `coalesce(${coluna(c)}, '')`).join(` || ' ' || `)}, ${lit(ACENTOS)}, ${lit(SEM_ACENTO)}))`
/** o DDL que o modo aproximado exige: o schema das extensões, o `pg_trgm` e o acesso a ele */
export const ddlExtensaoBusca = (): string[] => [`CREATE SCHEMA IF NOT EXISTS ${SCHEMA_EXTENSOES};`, `CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA ${SCHEMA_EXTENSOES};`, `GRANT USAGE ON SCHEMA ${SCHEMA_EXTENSOES} TO PUBLIC;`]
