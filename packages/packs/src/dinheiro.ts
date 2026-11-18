// Aritmética de dinheiro em bigint com 4 casas (a mesma escala do numeric(19,4)): comparação exata, sem float.
const RE = /^(-?)(\d{1,15})(?:\.(\d{1,4})0*)?$/
export function paraCentavos4(s: string): bigint {
  const m = RE.exec(s.trim()); if (!m) throw new Error(`dinheiro inválido: ${JSON.stringify(s.slice(0, 30))}`)
  const v = BigInt(m[2]!) * 10_000n + BigInt((m[3] ?? '').padEnd(4, '0'))
  return m[1] ? -v : v
}
export const compara = (a: string, b: string): number => { const x = paraCentavos4(a), y = paraCentavos4(b); return x < y ? -1 : x > y ? 1 : 0 }
/** normaliza para o texto canônico da API ("49.9000" → "49.90"; mínimo 2 casas) */
export function normaliza(s: string): string {
  const v = paraCentavos4(s), neg = v < 0n, a = neg ? -v : v, int = a / 10_000n, fr = (a % 10_000n).toString().padStart(4, '0').replace(/0{1,2}$/, '')
  return `${neg ? '-' : ''}${int}.${fr.padEnd(2, '0')}`
}
