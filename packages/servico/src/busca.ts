import { SCHEMA_EXTENSOES, exprDeBusca, paraLike, palavrasDe } from '@polaris/schema'

// Busca de texto das entidades que declaram `busca: { campos, modo }` (as regras de normalização e a expressão da coluna são do pacote schema, a mesma do índice).
// modo `exata`: cada palavra (até 5) precisa ser um TRECHO do texto. modo `aproximada`: a palavra também pode ser PARECIDA (erro de digitação: `pg_trgm`, `word_similarity`), e o resultado sai por RELEVÂNCIA.
// o limiar da aproximação é o padrão do pg_trgm para `<%` (`pg_trgm.word_similarity_threshold` = 0,6): abaixo disso é ruído

/** condição SQL (AND das palavras) e, no modo aproximado, a expressão de relevância; acrescenta os parâmetros. null se o termo não tem palavra alguma. */
export function condicaoDeBusca(busca: { campos: string[]; modo?: 'exata' | 'aproximada' }, termo: string, coluna: (c: string) => string, ps: unknown[]): { onde: string; relevancia?: string } | null {
  const palavras = palavrasDe(termo); if (!palavras.length) return null
  const col = exprDeBusca(busca.campos, coluna), aprox = busca.modo === 'aproximada', e = SCHEMA_EXTENSOES
  const partes: string[] = [], pontos: string[] = []
  for (const p of palavras) {
    ps.push(paraLike(p)); const like = `$${ps.length}`
    if (!aprox) { partes.push(`(${col} LIKE ${like} ESCAPE '\\')`); continue }
    ps.push(p); const palavra = `$${ps.length}::text`
    partes.push(`(${col} LIKE ${like} ESCAPE '\\' OR ${palavra} OPERATOR(${e}.<%) ${col})`) // `<%` usa o índice trigrama (e o LIKE também)
    const primeiro = busca.campos.length > 1 ? ` + CASE WHEN ${exprDeBusca(busca.campos.slice(0, 1), coluna)} LIKE ${like} ESCAPE '\\' THEN 0.5 ELSE 0 END` : '' // achar no PRIMEIRO campo (o título) vale mais
    pontos.push(`(${e}.word_similarity(${palavra}, ${col}) + CASE WHEN ${col} LIKE ${like} ESCAPE '\\' THEN 1 ELSE 0 END + 0.5 * ${e}.similarity(${palavra}, ${col})${primeiro})`) // parecido < contém < contém e parecido; o texto mais curto e focado (`similarity`) desempata
  }
  return { onde: partes.join(' AND '), ...(aprox ? { relevancia: pontos.join(' + ') } : {}) }
}
