/** Texto de um valor dentro de um template: ausente e objetos viram vazio (nunca "[object Object]" nem "undefined"). */
export function paraTexto(v: unknown): string {
  if (v === null || v === undefined || typeof v === 'object') return ''
  return String(v)
}
