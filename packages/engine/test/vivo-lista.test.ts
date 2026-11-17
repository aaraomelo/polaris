// @vitest-environment jsdom
import { describe, expect, it } from 'vitest'
import { ChaveDuplicada, aplicaLista, lis, planoLista } from '../src/vivo/lista'

let s = 5
const rnd = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff)
const ri = (n: number) => Math.floor(rnd() * n)
const embaralha = <T,>(a: T[]) => { const r = [...a]; for (let i = r.length - 1; i > 0; i--) { const j = ri(i + 1); [r[i], r[j]] = [r[j]!, r[i]!] } return r }

/** referência O(n²): tamanho da LIS por programação dinâmica */
const lisRef = (a: number[]) => { const v = a.filter((x) => x >= 0); const d = v.map(() => 1); let m = 0; for (let i = 0; i < v.length; i++) { for (let j = 0; j < i; j++) if (v[j]! < v[i]!) d[i] = Math.max(d[i]!, d[j]! + 1); m = Math.max(m, d[i]!) } return m }

function monta(chaves: string[]) {
  const pai = document.createElement('ul')
  const nos = new Map<string, HTMLElement>()
  for (const c of chaves) { const li = document.createElement('li'); li.dataset.k = c; pai.appendChild(li); nos.set(c, li) }
  return { pai, nos }
}
const ordem = (pai: HTMLElement) => [...pai.children].map((e) => (e as HTMLElement).dataset.k!)

describe('lis', () => {
  it('casos conhecidos', () => {
    expect(lis([])).toEqual([])
    expect(lis([3])).toEqual([0])
    expect(lis([0, 1, 2, 3])).toEqual([0, 1, 2, 3])
    expect(lis([3, 2, 1, 0]).length).toBe(1)
    expect(lis([-1, -1])).toEqual([])
    expect(lis([2, -1, 0, 1]).map((i) => [2, -1, 0, 1][i])).toEqual([0, 1])
  })
  it('FUZZ: tamanho igual ao da programação dinâmica e subsequência realmente crescente', () => {
    for (let t = 0; t < 2000; t++) {
      const n = ri(30)
      const base = embaralha(Array.from({ length: n }, (_, i) => i)).map((x) => (rnd() < 0.2 ? -1 : x))
      const r = lis(base)
      expect(r.length).toBe(lisRef(base))
      for (let k = 1; k < r.length; k++) { expect(r[k]).toBeGreaterThan(r[k - 1]!); expect(base[r[k]!]!).toBeGreaterThan(base[r[k - 1]!]!) }
    }
  })
})

describe('planoLista + aplicaLista', () => {
  it('nada mudou: nenhuma operação', () => {
    const p = planoLista(['a', 'b', 'c'], ['a', 'b', 'c'])
    expect(p).toEqual({ remover: [], passos: [], ficam: 0 })
  })
  it('só o fim mudou (anexar/remover no fim) não move ninguém', () => {
    expect(planoLista(['a', 'b'], ['a', 'b', 'c', 'd']).passos.map((x) => x.op)).toEqual(['cria', 'cria'])
    expect(planoLista(['a', 'b', 'c'], ['a']).remover).toEqual(['b', 'c'])
  })
  it('inverter move n-1; trocar dois vizinhos move 1', () => {
    expect(planoLista(['a', 'b', 'c', 'd'], ['d', 'c', 'b', 'a']).passos.filter((p) => p.op === 'move')).toHaveLength(3)
    expect(planoLista(['a', 'b', 'c', 'd'], ['a', 'c', 'b', 'd']).passos.filter((p) => p.op === 'move')).toHaveLength(1)
  })
  it('prefixo e sufixo comuns são aparados: só o miolo entra no cálculo', () => {
    const p = planoLista(['a', 'b', 'c'], ['a', 'x', 'c'])
    expect(p.ficam).toBe(0)
    expect(p.remover).toEqual(['b'])
    expect(p.passos).toEqual([{ op: 'cria', chave: 'x', antes: 'c' }])
  })
  it('chave duplicada é recusada com a chave no erro', () => {
    expect(() => planoLista(['a'], ['x', 'x'])).toThrow(ChaveDuplicada)
    expect(() => planoLista(['a', 'a'], ['a'])).toThrow(/duplicada/)
  })

  it('FUZZ: o DOM final tem a ordem certa, nós existentes mantêm identidade e o nº de movimentos é o mínimo', () => {
    for (let t = 0; t < 3000; t++) {
      const universo = Array.from({ length: 1 + ri(25) }, (_, i) => `k${i}`)
      const antigas = embaralha(universo).slice(0, ri(universo.length + 1))
      const novas = embaralha(universo).slice(0, ri(universo.length + 1))
      const { pai, nos } = monta(antigas)
      const identidade = new Map(nos)
      const plano = planoLista(antigas, novas)
      let criados = 0, insercoes = 0
      const orig = pai.insertBefore.bind(pai)
      pai.insertBefore = ((n: Node, r: Node | null) => { insercoes++; return orig(n, r) }) as typeof pai.insertBefore
      aplicaLista(pai, nos, plano, (c) => { criados++; const li = document.createElement('li'); li.dataset.k = c; return li })
      expect(ordem(pai), `${antigas} → ${novas}`).toEqual(novas)
      for (const c of novas) if (identidade.has(c)) expect(nos.get(c)).toBe(identidade.get(c))
      expect([...nos.keys()].sort()).toEqual([...novas].sort())
      // mínimo: criados = chaves novas; movimentos = comuns − LIS global
      const comuns = novas.filter((c) => antigas.includes(c))
      const idxAntigo = comuns.map((c) => antigas.indexOf(c))
      const movimentos = plano.passos.filter((p) => p.op === 'move').length
      expect(criados).toBe(novas.length - comuns.length)
      expect(movimentos).toBe(comuns.length - lisRef(idxAntigo))
      expect(insercoes).toBe(criados + movimentos)
    }
  })

  it('desempenho: 10 000 itens embaralhados em tempo O(n log n)', () => {
    const a = Array.from({ length: 10000 }, (_, i) => `k${i}`)
    const b = embaralha(a)
    const t0 = performance.now(); const p = planoLista(a, b); const ms = performance.now() - t0
    expect(p.passos.length).toBeGreaterThan(0)
    expect(ms).toBeLessThan(100)
  })
})
