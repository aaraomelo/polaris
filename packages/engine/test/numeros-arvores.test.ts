import { describe, expect, it } from 'vitest'
import { FUNCOES_PADRAO, avalia, parseExpr } from '../src/expr/index'

// ORÁCULO DIFERENCIAL das árvores (conecthus/visao/pesquisa/provas/prova_multiplicacao.md): as operações ⊕ e ⊠ sobre árvores
// binárias, com i = nº de nós internos, formam um homomorfismo para (ℕ, +, ·). Aqui as provas — que a própria `visao` marca
// como provisórias — são conferidas MECANICAMENTE, e a aritmética exata da linguagem é conferida contra elas.

type T = null | readonly [T, T]
const FOLHA: T = null
const c: T = [FOLHA, FOLHA] // cherry = top_2
const g = (l: T): T => [l, FOLHA]

/** T ⊕ U: troca a ÚLTIMA folha de T por U (monoide livre; unidade = folha) */
const oplus = (t: T, u: T): T => (t === null ? u : [t[0], oplus(t[1], u)])
/** • ⊠ U = •;  (L,R) ⊠ U = ((L ⊠ U) ⊕ U) ⊕ (R ⊠ U) */
const otimes = (t: T, u: T): T => (t === null ? FOLHA : oplus(oplus(otimes(t[0], u), u), otimes(t[1], u)))
const internos = (t: T): number => (t === null ? 0 : 1 + internos(t[0]) + internos(t[1]))
const chave = (t: T): string => (t === null ? '•' : `(${chave(t[0])},${chave(t[1])})`)
const igual = (a: T, b: T) => chave(a) === chave(b)

/** todas as árvores com exatamente n folhas */
const memo = new Map<number, T[]>()
function arvores(n: number): T[] {
  if (n === 1) return [FOLHA]
  const m = memo.get(n); if (m) return m
  const r: T[] = []
  for (let k = 1; k < n; k++) for (const l of arvores(k)) for (const rr of arvores(n - k)) r.push([l, rr])
  memo.set(n, r); return r
}
const ate = (n: number) => Array.from({ length: n }, (_, k) => arvores(k + 1)).flat()
const TODAS = ate(5) // 1 + 1 + 2 + 5 + 14 = 23 árvores
const comb = (k: number): T => (k === 0 ? FOLHA : oplus(c, comb(k - 1))) // top_{k+1} = c^{⊕k}: k nós internos
const ev = (src: string, esc: Record<string, unknown> = {}) => avalia(parseExpr(src), esc, FUNCOES_PADRAO)

describe('as árvores de ≤ 5 folhas e o oráculo i: (𝒯, ⊕, ⊠) → (ℕ, +, ·)', () => {
  it('são 23 árvores (Catalan: 1, 1, 2, 5, 14)', () => { expect(TODAS.length).toBe(23); expect(arvores(5).length).toBe(14) })

  it('i é homomorfismo: i(T⊕U) = i(T)+i(U), i(T⊠U) = i(T)·i(U) — e a aritmética exata da linguagem concorda', () => {
    for (const t of TODAS) for (const u of TODAS) {
      expect(internos(oplus(t, u))).toBe(internos(t) + internos(u))
      expect(internos(otimes(t, u))).toBe(internos(t) * internos(u))
      expect(ev('qsoma(a, b)', { a: internos(t), b: internos(u) })).toBe(String(internos(oplus(t, u))))
      expect(ev('qmul(a, b)', { a: internos(t), b: internos(u) })).toBe(String(internos(otimes(t, u))))
    }
  })
  it('⊕: associativa, com unidade (a folha); ⊠: associativa, distributiva à direita, c é unidade à esquerda', () => {
    const pequenas = ate(4)
    for (const t of pequenas) {
      expect(igual(oplus(FOLHA, t), t)).toBe(true); expect(igual(oplus(t, FOLHA), t)).toBe(true)
      expect(igual(otimes(c, t), t)).toBe(true)
      for (const u of pequenas) for (const v of pequenas) {
        expect(igual(oplus(oplus(t, u), v), oplus(t, oplus(u, v)))).toBe(true)
        expect(igual(otimes(otimes(t, u), v), otimes(t, otimes(u, v)))).toBe(true)
        expect(igual(otimes(oplus(t, u), v), oplus(otimes(t, v), otimes(u, v)))).toBe(true) // distributividade à direita
      }
    }
  })
  it('os naturais: top_{a+1} ⊠ top_{b+1} = top_{ab+1}; a soma é ⊕ (Peano: x + s(b) = s(x + b))', () => {
    for (let a = 0; a <= 4; a++) for (let b = 0; b <= 4; b++) {
      expect(igual(otimes(comb(a), comb(b)), comb(a * b))).toBe(true)
      expect(igual(oplus(comb(a), comb(b)), comb(a + b))).toBe(true)
      expect(ev('qmul(a, b)', { a, b })).toBe(String(internos(otimes(comb(a), comb(b)))))
    }
    expect(igual(oplus(comb(3), c), comb(4))).toBe(true) // s(T) = T ⊕ c
  })
  it('o que FALHA, como a `visao` afirma: ⊠ não é comutativo em geral, não distribui à esquerda, c não é unidade à direita', () => {
    // c não é unidade à direita: T ⊠ c = T só para combs direitos
    const unidadeDireita = TODAS.filter((t) => igual(otimes(t, c), t))
    expect(unidadeDireita.length).toBe(5)
    // distributividade à esquerda: T ⊠ (U ⊕ V) = (T ⊠ U) ⊕ (T ⊠ V) falha; com T = c ⊕ c há falhas
    const T2 = oplus(c, c)
    let falhas = 0
    for (const u of TODAS) for (const v of TODAS) if (!igual(otimes(T2, oplus(u, v)), oplus(otimes(T2, u), otimes(T2, v)))) falhas++
    expect(falhas).toBe(448) // o número que a prova_multiplicacao.md §3 registra (448 de 529)
    // o contraexemplo mínimo dado lá: U = c, V = g(c)
    const U = c, V = g(c)
    expect(igual(otimes(T2, oplus(U, V)), oplus(otimes(T2, U), otimes(T2, V)))).toBe(false)
    // não comutativo
    const naoComutam = TODAS.flatMap((t) => TODAS.map((u) => [t, u] as const)).filter(([t, u]) => !igual(otimes(t, u), otimes(u, t)))
    expect(naoComutam.length).toBeGreaterThan(0)
    // mas os naturais (potências de c) comutam: o quociente i é um semianel comutativo
    for (let a = 0; a <= 4; a++) for (let b = 0; b <= 4; b++) expect(igual(otimes(comb(a), comb(b)), otimes(comb(b), comb(a)))).toBe(true)
  })
  it('s(T) = T ⊕ c e g(T) = (T, •) dão o mesmo ⊠U — a perda de informação que a `visao` descreve', () => {
    for (const t of ate(4)) for (const u of ate(4)) expect(igual(otimes(oplus(t, c), u), otimes(g(t), u))).toBe(true)
  })
})
