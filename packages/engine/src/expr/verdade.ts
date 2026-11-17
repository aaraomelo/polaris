/** Veracidade: falsos são null, ausente, false, 0, NaN, "" e lista vazia; o resto é verdadeiro (inclusive objeto vazio). */
export const verdadeiro = (v: unknown): boolean => {
  if (v === null || v === undefined || v === false || v === 0 || v === '') return false
  if (typeof v === 'number' && Number.isNaN(v)) return false
  if (Array.isArray(v) && v.length === 0) return false
  return true
}
