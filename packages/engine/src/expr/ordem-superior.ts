import { LIMITES_EXPR } from './tipos'
import { verdadeiro } from './verdade'

// Combinadores: as ÚNICAS funções que recebem função anônima. Cada um é um catamorfismo/homomorfismo sobre a lista
// (monoide livre): a iteração é sempre estrutural, sobre uma lista finita já existente. Sem recursão geral e sem laço
// aberto, a linguagem continua total; o orçamento de passos (avalia.ts) limita o custo.

export type Aplica = (...vals: unknown[]) => unknown
export type OrdemSuperior = {
  /** posição (0-based) do argumento que é a função anônima */
  fnPos: number
  /** quantos parâmetros a função pode declarar (de 1 a este número) */
  paramsMax: number
  /** `args` são os argumentos já avaliados (a posição da função vem `undefined`) */
  impl(args: unknown[], f: Aplica): unknown
}

const tem = Object.prototype.hasOwnProperty

/** Ordem total e determinística das chaves de `ordena`: números < textos < booleanos < o resto (ausente por último); empates mantêm a ordem original. */
const rank = (v: unknown) => (typeof v === 'number' && !Number.isNaN(v) ? 0 : typeof v === 'string' ? 1 : typeof v === 'boolean' ? 2 : 3)
export function comparaChaves(a: unknown, b: unknown): number {
  const ra = rank(a), rb = rank(b)
  if (ra !== rb) return ra - rb
  if (ra === 3) return 0
  return (a as number | string | boolean) < (b as number | string | boolean) ? -1 : (a as number | string | boolean) > (b as number | string | boolean) ? 1 : 0
}

const texto = (v: unknown): string => (typeof v === 'string' ? v : typeof v === 'number' || typeof v === 'boolean' ? String(v) : '')

export const ORDEM_SUPERIOR: Record<string, OrdemSuperior> = {
  mapeia: { fnPos: 1, paramsMax: 2, impl: ([l], f) => (Array.isArray(l) ? l.map((x, i) => f(x, i)) : undefined) },
  filtra: { fnPos: 1, paramsMax: 2, impl: ([l], f) => (Array.isArray(l) ? l.filter((x, i) => verdadeiro(f(x, i))) : undefined) },
  dobra: { fnPos: 2, paramsMax: 3, impl: ([l, z], f) => (Array.isArray(l) ? l.reduce((acc, x, i) => f(acc, x, i), z) : undefined) },
  todos: { fnPos: 1, paramsMax: 2, impl: ([l], f) => (Array.isArray(l) ? l.every((x, i) => verdadeiro(f(x, i))) : undefined) },
  algum: { fnPos: 1, paramsMax: 2, impl: ([l], f) => (Array.isArray(l) ? l.some((x, i) => verdadeiro(f(x, i))) : undefined) },
  acha: { fnPos: 1, paramsMax: 2, impl: ([l], f) => (Array.isArray(l) ? l.find((x, i) => verdadeiro(f(x, i))) : undefined) },
  ordena: {
    fnPos: 1, paramsMax: 1,
    impl: ([l], f) => {
      if (!Array.isArray(l)) return undefined
      const dec = l.map((x, i) => ({ x, k: f(x), i }))
      dec.sort((a, b) => comparaChaves(a.k, b.k) || a.i - b.i)
      return dec.map((d) => d.x)
    },
  },
  agrupa: {
    fnPos: 1, paramsMax: 1,
    impl: ([l], f) => {
      if (!Array.isArray(l)) return undefined
      const m = new Map<string, unknown[]>()
      for (const x of l) { const k = texto(f(x)); const g = m.get(k); if (g) g.push(x); else m.set(k, [x]) }
      return Object.fromEntries(m) // fromEntries define a chave como propriedade própria (inclusive '__proto__')
    },
  },
}

export const ehOrdemSuperior = (nome: string): boolean => tem.call(ORDEM_SUPERIOR, nome)
export const LIMITE_LISTA = LIMITES_EXPR.lista
