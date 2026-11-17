import { caminhoValido, com, obter } from '../estado/caminho'
import { LIMITES_EXPR, type Funcao } from './tipos'
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

// atualiza(x, caminho, v => novo): troca o valor no caminho pelo que a função devolve (ausente se o caminho não existe e a função não cria)
export const os_atualiza: OrdemSuperior = { fnPos: 2, paramsMax: 1, impl: ([x, c], f) => (caminhoValido(c) ? com(x, c, f(obter(x, c))) : undefined) }
export const os_mapeia: OrdemSuperior = { fnPos: 1, paramsMax: 2, impl: ([l], f) => (Array.isArray(l) ? l.map((x, i) => f(x, i)) : undefined) }
export const os_filtra: OrdemSuperior = { fnPos: 1, paramsMax: 2, impl: ([l], f) => (Array.isArray(l) ? l.filter((x, i) => verdadeiro(f(x, i))) : undefined) }
export const os_dobra: OrdemSuperior = { fnPos: 2, paramsMax: 3, impl: ([l, z], f) => (Array.isArray(l) ? l.reduce((acc, x, i) => f(acc, x, i), z) : undefined) }
export const os_todos: OrdemSuperior = { fnPos: 1, paramsMax: 2, impl: ([l], f) => (Array.isArray(l) ? l.every((x, i) => verdadeiro(f(x, i))) : undefined) }
export const os_algum: OrdemSuperior = { fnPos: 1, paramsMax: 2, impl: ([l], f) => (Array.isArray(l) ? l.some((x, i) => verdadeiro(f(x, i))) : undefined) }
export const os_acha: OrdemSuperior = { fnPos: 1, paramsMax: 2, impl: ([l], f) => (Array.isArray(l) ? l.find((x, i) => verdadeiro(f(x, i))) : undefined) }
export const os_ordena: OrdemSuperior = {
    fnPos: 1, paramsMax: 1,
    impl: ([l], f) => {
      if (!Array.isArray(l)) return undefined
      const dec = l.map((x, i) => ({ x, k: f(x), i }))
      dec.sort((a, b) => comparaChaves(a.k, b.k) || a.i - b.i)
      return dec.map((d) => d.x)
    },
  }
export const os_agrupa: OrdemSuperior = {
    fnPos: 1, paramsMax: 1,
    impl: ([l], f) => {
      if (!Array.isArray(l)) return undefined
      const m = new Map<string, unknown[]>()
      for (const x of l) { const k = texto(f(x)); const g = m.get(k); if (g) g.push(x); else m.set(k, [x]) }
      return Object.fromEntries(m) // fromEntries define a chave como propriedade própria (inclusive '__proto__')
    },
  }

export const ORDEM_SUPERIOR: Record<string, OrdemSuperior> = {
  'atualiza': os_atualiza,
  'mapeia': os_mapeia,
  'filtra': os_filtra,
  'dobra': os_dobra,
  'todos': os_todos,
  'algum': os_algum,
  'acha': os_acha,
  'ordena': os_ordena,
  'agrupa': os_agrupa,
}

/** A mesma função na tabela da linguagem: a aridade vem da posição da função anônima; `fn` não é usado (o avaliador chama `os.impl`). */
const comoFuncao = (os: OrdemSuperior): Funcao => ({ min: os.fnPos + 1, max: os.fnPos + 1, fn: () => undefined, os })
export const f_atualiza: Funcao = /* @__PURE__ */ comoFuncao(os_atualiza)
export const f_mapeia: Funcao = /* @__PURE__ */ comoFuncao(os_mapeia)
export const f_filtra: Funcao = /* @__PURE__ */ comoFuncao(os_filtra)
export const f_dobra: Funcao = /* @__PURE__ */ comoFuncao(os_dobra)
export const f_todos: Funcao = /* @__PURE__ */ comoFuncao(os_todos)
export const f_algum: Funcao = /* @__PURE__ */ comoFuncao(os_algum)
export const f_acha: Funcao = /* @__PURE__ */ comoFuncao(os_acha)
export const f_ordena: Funcao = /* @__PURE__ */ comoFuncao(os_ordena)
export const f_agrupa: Funcao = /* @__PURE__ */ comoFuncao(os_agrupa)

export const ehOrdemSuperior = (nome: string): boolean => tem.call(ORDEM_SUPERIOR, nome)
export const LIMITE_LISTA = LIMITES_EXPR.lista
