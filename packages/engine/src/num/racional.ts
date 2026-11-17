// ---------------------------------------------------------------------------
// RACIONAL EXATO (BigInt). Modelo do banco do Tiffany: um número é uma CLASSE (n, d) com d > 0 e mdc(|n|, d) = 1;
// o inteiro é o caso d = 1; decimal é um racional cujo denominador divide uma potência de 10.
//   - nunca passa por double; nada arredonda sozinho: só `arredondaEscalado`/`decimal`, quando o programa PEDE (e com o modo dito);
//   - as operações não dividem para decidir nada: ⊕ cruzado, ⊗ por componentes, comparação por produto cruzado;
//   - o TETO é explícito (LIMITE_DIGITOS): o que passar dele é ausente, nunca um valor errado calado.
// ---------------------------------------------------------------------------

export type Q = { readonly n: bigint; readonly d: bigint }

export const LIMITE_DIGITOS = 1000
const TETO = 10n ** BigInt(LIMITE_DIGITOS)
export const MAX_CASAS = 100

export type ModoArredondamento = 'longe' | 'par' | 'zero' | 'baixo' | 'cima'
export const MODOS: readonly ModoArredondamento[] = ['longe', 'par', 'zero', 'baixo', 'cima']

const abs = (x: bigint) => (x < 0n ? -x : x)

export function mdc(a: bigint, b: bigint): bigint {
  a = abs(a); b = abs(b)
  while (b) { const t = a % b; a = b; b = t }
  return a
}

/** Representante da classe; ausente se d = 0 ou se passar do teto. */
export function classe(n: bigint, d: bigint): Q | undefined {
  if (d === 0n) return undefined
  if (d < 0n) { n = -n; d = -d }
  const g = mdc(n, d)
  if (g > 1n) { n /= g; d /= g }
  return abs(n) >= TETO || d >= TETO ? undefined : { n, d }
}

const RE_INT = /^[+-]?\d+$/
const RE_DEC = /^([+-]?)(\d*)\.?(\d*)(?:[eE]([+-]?\d+))?$/
const RE_FRAC = /^([+-]?\d+)\/(\d+)$/

/** Lê inteiro, decimal ("12.34", "1e3"), fração ("3/4") ou número JS finito (pelo texto mais curto: 0.1 → 1/10). Qualquer outra coisa: ausente. */
export function parse(x: unknown): Q | undefined {
  if (typeof x === 'number') return Number.isFinite(x) ? parse(String(x)) : undefined
  if (typeof x !== 'string' || x.length === 0 || x.length > LIMITE_DIGITOS + 60) return undefined
  if (RE_INT.test(x)) return classe(BigInt(x), 1n)
  const f = RE_FRAC.exec(x)
  if (f) return classe(BigInt(f[1]!), BigInt(f[2]!))
  const m = RE_DEC.exec(x)
  if (!m || (m[2] === '' && m[3] === '')) return undefined
  const exp = m[4] === undefined ? 0 : Number(m[4])
  if (!Number.isSafeInteger(exp) || Math.abs(exp) > 2 * LIMITE_DIGITOS) return undefined
  const frac = m[3]!
  const n = BigInt(`${m[1] === '-' ? '-' : ''}${m[2]}${frac}` || '0')
  const escala = frac.length - exp
  if (escala > 2 * LIMITE_DIGITOS) return undefined
  if (escala >= 0) return classe(n, 10n ** BigInt(escala))
  if (n === 0n) return classe(0n, 1n)
  return abs(n).toString().length - escala > LIMITE_DIGITOS + 5 ? undefined : classe(n * 10n ** BigInt(-escala), 1n)
}

/** Texto canônico: "n" (inteiro) ou "n/d" (d > 1), sempre reduzido. Duas classes iguais têm o mesmo texto. */
export const formata = (q: Q): string => (q.d === 1n ? String(q.n) : `${q.n}/${q.d}`)

// ---- aritmética ------------------------------------------------------------

export const soma = (a: Q, b: Q): Q | undefined => classe(a.n * b.d + b.n * a.d, a.d * b.d) // ⊕ cruzado
export const mul = (a: Q, b: Q): Q | undefined => classe(a.n * b.n, a.d * b.d) // ⊗ por componentes
export const neg = (a: Q): Q => ({ n: -a.n, d: a.d })
export const absQ = (a: Q): Q => ({ n: abs(a.n), d: a.d })
export const sub = (a: Q, b: Q): Q | undefined => soma(a, neg(b))
/** Divisão: por zero é ausente (o preço de ℚ). */
export const div = (a: Q, b: Q): Q | undefined => (b.n === 0n ? undefined : classe(a.n * b.d, a.d * b.n))
/** Comparação SEM dividir: a/b < c/d ⟺ a·d < c·b (denominadores positivos). */
export function cmp(a: Q, b: Q): -1 | 0 | 1 {
  const e = a.n * b.d, f = b.n * a.d
  return e < f ? -1 : e > f ? 1 : 0
}
export const ehInteiro = (a: Q) => a.d === 1n

/** x^k com k inteiro (negativo inverte). Corta ANTES de calcular se o resultado passaria do teto. */
export function pot(a: Q, k: number): Q | undefined {
  if (!Number.isInteger(k) || Math.abs(k) > LIMITE_DIGITOS) return undefined
  if (k === 0) return { n: 1n, d: 1n }
  // estimativa barata dos dígitos do resultado (k·log10 da base) para recusar ANTES de calcular uma potência enorme
  const log10 = (x: bigint) => { const t = abs(x).toString(); const cab = t.slice(0, 15); return t.length - cab.length + Math.log10(Number(cab)) }
  const base = Math.max(a.n === 0n ? 0 : log10(a.n), log10(a.d))
  if (base * Math.abs(k) > LIMITE_DIGITOS + 2) return undefined
  const e = BigInt(Math.abs(k))
  const r = classe(a.n ** e, a.d ** e)
  return r && (k < 0 ? div({ n: 1n, d: 1n }, r) : r)
}

/** Maior inteiro ≤ x. */
export function piso(a: Q): bigint {
  const q = a.n / a.d
  return a.n < 0n && a.n % a.d !== 0n ? q - 1n : q
}

/** Resto matemático: a − b·⌊a/b⌋ (tem o sinal de b); b = 0 é ausente. */
export function resto(a: Q, b: Q): Q | undefined {
  const c = div(a, b)
  if (!c) return undefined
  const p = mul(b, { n: piso(c), d: 1n })
  return p && sub(a, p)
}

export const mmc = (a: bigint, b: bigint): bigint => (a === 0n || b === 0n ? 0n : abs(a * b) / mdc(a, b))

// ---- arredondamento (SÓ quando pedido) ---------------------------------------

/** Inteiro m com m/10^casas ≈ x, pelo modo dito. */
export function arredondaEscalado(a: Q, casas: number, modo: ModoArredondamento): bigint | undefined {
  if (!Number.isInteger(casas) || casas < 0 || casas > MAX_CASAS) return undefined
  const num = a.n * 10n ** BigInt(casas)
  const s = num < 0n ? -1n : 1n
  const m = abs(num)
  const qd = m / a.d, r = m % a.d
  const dobro = 2n * r
  switch (modo) {
    case 'zero': return qd * s
    case 'longe': return (qd + (dobro >= a.d ? 1n : 0n)) * s
    case 'par': return (qd + (dobro > a.d || (dobro === a.d && qd % 2n === 1n) ? 1n : 0n)) * s
    case 'baixo': return s > 0n ? qd : r > 0n ? -(qd + 1n) : -qd
    case 'cima': return s > 0n ? (r > 0n ? qd + 1n : qd) : -qd
  }
}

/** m/10^casas como texto decimal exato ("-0.05", "12.30"). */
export function decimal(m: bigint, casas: number): string {
  const neg = m < 0n
  const dig = abs(m).toString().padStart(casas + 1, '0')
  const i = dig.length - casas
  return `${neg ? '-' : ''}${dig.slice(0, i)}${casas > 0 ? `.${dig.slice(i)}` : ''}`
}

/** Como `decimal`, em pt-BR (milhar com ponto, vírgula decimal), sem passar por Intl nem por double. */
export function decimalPtBR(m: bigint, casas: number): string {
  const neg = m < 0n
  const dig = abs(m).toString().padStart(casas + 1, '0')
  const i = dig.length - casas
  const inteira = dig.slice(0, i).replace(/\B(?=(\d{3})+$)/g, '.')
  return `${neg ? '-' : ''}${inteira}${casas > 0 ? `,${dig.slice(i)}` : ''}`
}

/** Aproximação em double, para quando a exatidão não importa (gráficos). Correta (arredondada) quando n e d cabem em 53 bits. */
export function paraNumero(a: Q): number | undefined {
  const lim = 2n ** 53n
  const r = abs(a.n) < lim && a.d < lim ? Number(a.n) / Number(a.d) : Number(decimal(arredondaEscalado(a, 30, 'par')!, 30))
  return Number.isFinite(r) ? r : undefined
}
