// Contraste WCAG 2.x entre duas cores hex (#rgb ou #rrggbb). Usado para auditar temas (AA: 4,5 para texto; 3 para componentes de UI).

function canais(hex: string): [number, number, number] {
  const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(hex.trim())
  if (!m) throw new Error(`cor hexadecimal inválida: ${JSON.stringify(hex)}`)
  const h = m[1]!.length === 3 ? m[1]!.split('').map((c) => c + c).join('') : m[1]!
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)) as [number, number, number]
}
const linear = (c: number) => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4 }
export const luminancia = (hex: string): number => { const [r, g, b] = canais(hex); return 0.2126 * linear(r) + 0.7152 * linear(g) + 0.0722 * linear(b) }
export function contraste(a: string, b: string): number {
  const [x, y] = [luminancia(a), luminancia(b)]
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)
}
export const ehEscura = (hex: string): boolean => luminancia(hex) < 0.18
