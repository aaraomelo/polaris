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

const QTD = /^(\d{1,12})(?:\.(\d{1,4})0*)?$/
/** preço × quantidade, exato em 4 casas (arredonda meio para cima); quantidade com até 4 casas */
export function multiplica(preco: string, quantidade: string): string {
  const q = QTD.exec(quantidade.trim()); if (!q) throw new Error(`quantidade inválida: ${JSON.stringify(quantidade.slice(0, 30))}`)
  const qq = BigInt(q[1]!) * 10_000n + BigInt((q[2] ?? '').padEnd(4, '0')), p = paraCentavos4(preco)
  const neg = p < 0n, bruto = (neg ? -p : p) * qq, r = (bruto + 5_000n) / 10_000n
  return normaliza(formata4(neg ? -r : r))
}
export function soma(valores: string[]): string { return normaliza(formata4(valores.reduce((a, v) => a + paraCentavos4(v), 0n))) }
function formata4(v: bigint): string { const n = v < 0n, a = n ? -v : v; return `${n ? '-' : ''}${a / 10_000n}.${(a % 10_000n).toString().padStart(4, '0')}` }
