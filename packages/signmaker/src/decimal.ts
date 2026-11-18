// Aritmética decimal EXATA sobre texto (BigInt, escala 1e6): nenhum valor de dinheiro passa por Number. Entrada: "12", "12.5", "-0.05" (também number inteiro/seguro).
const ESC = 6, UM = 10n ** BigInt(ESC)
const RE = /^([+-]?)(\d{1,15})(?:\.(\d{1,6}))?$/

export function lê(v: unknown): bigint | null {
  const t = typeof v === 'number' ? (Number.isFinite(v) ? String(v) : '') : typeof v === 'string' ? v.trim() : ''
  const m = RE.exec(t); if (!m) return null
  const x = BigInt(m[2]!) * UM + BigInt((m[3] ?? '').padEnd(ESC, '0'))
  return m[1] === '-' ? -x : x
}
/** divisão inteira arredondando para baixo (floor), correta para negativos */
const divFloor = (a: bigint, b: bigint) => { const q = a / b; return (a % b !== 0n) && ((a < 0n) !== (b < 0n)) ? q - 1n : q }
/** arredonda meio para cima em módulo, para `casas` decimais */
function arredonda(x: bigint, casas: number): bigint {
  const f = 10n ** BigInt(ESC - casas), neg = x < 0n, a = neg ? -x : x, r = ((a + f / 2n) / f) * f
  return neg ? -r : r
}
export function texto(x: bigint, casas = 2): string {
  const r = arredonda(x, casas), neg = r < 0n, a = neg ? -r : r, int = a / UM, frac = (a % UM).toString().padStart(ESC, '0').slice(0, casas)
  return `${neg ? '-' : ''}${int}${casas ? `.${frac}` : ''}`
}

export const FUNCOES = ['identidade', 'diferenca', 'diferencaPercentual', 'percentual', 'desconto', 'parcela', 'arredonda'] as const
export type Funcao = (typeof FUNCOES)[number]
const ARGS: Record<Funcao, number> = { identidade: 1, diferenca: 2, diferencaPercentual: 2, percentual: 2, desconto: 2, parcela: 2, arredonda: 1 }
export const aridade = (f: Funcao) => ARGS[f]

/** as funções dos modelos do legado (nodeFunctions), agora em decimal exato; devolvem TEXTO, ou null se um argumento não é número */
export function calcula(f: Funcao, args: unknown[]): string | null {
  const v = args.map(lê); if (v.some((x) => x === null)) return null
  const [a, b] = v as bigint[]
  switch (f) {
    case 'identidade': return typeof args[0] === 'string' ? args[0].trim() : texto(a!, 6).replace(/\.?0+$/, '')
    case 'diferenca': return texto(a! - b!, 2) // diferença exata (o legado arredondava para baixo em centavos inteiros: aqui os dados já são centavos decimais)
    case 'diferencaPercentual': return a === 0n ? '0%' : `${divFloor((a! - b!) * 100n, a!)}%` // piso do percentual, como o legado
    case 'percentual': return a === 0n ? '0.00' : texto(divFloor((a! - b!) * 100n * UM, a!), 2)
    case 'desconto': return texto(arredonda(a! * (100n * UM - b!) / (100n * UM), 2), 2) // preço × (1 − desconto/100)
    case 'parcela': return b === 0n ? texto(a!, 2) : texto(divFloor(a! * 100n, b!) * UM / 100n, 2) // piso em centavos; sem parcelas, o próprio preço
    case 'arredonda': return texto(a!, 0)
  }
}
