import { describe, expect, it } from 'vitest'
import { atualiza, caminhoDeId, contaNos, duplica, idsDuplicados, insere, LIMITES, move, noEm, percorre, remove, renomeiaId, trocaProps, type Caminho, type DefBloco, type Inst } from '../src'

const DEFS: Record<string, { slots?: Record<string, any> }> = {
  caixa: { slots: { filhos: {}, lado: { max: 1 } } }, folha: {}, so: { slots: { itens: { aceita: ['folha'] } } }, minimo: { slots: { filhos: { min: 1 } } },
}
const defs: DefBloco = (b) => DEFS[b]
const c = (...p: Array<[string, number]>): Caminho => p.map(([slot, indice]) => ({ slot, indice }))
const F = (id: string): Inst => ({ bloco: 'folha', id })
const K = (id: string, ...filhos: Inst[]): Inst => ({ bloco: 'caixa', id, slots: { filhos } })
const ids = (r: Inst) => [...percorre(r)].map((x) => x.inst.id)
const ok = (r: any) => { if (!r.ok) throw new Error(r.erro); return r.raiz as Inst }

describe('árvore de instâncias', () => {
  const raiz = K('r', F('a'), K('b', F('c'), F('d')), F('e'))
  it('insere: posição, slot novo, e a entrada não é mutada', () => {
    const antes = JSON.stringify(raiz)
    expect(ids(ok(insere(raiz, [], 'filhos', 1, F('x'), defs)))).toEqual(['r', 'a', 'x', 'b', 'c', 'd', 'e'])
    expect(ids(ok(insere(raiz, [], 'lado', 0, F('l'), defs)))).toContain('l'); expect(JSON.stringify(raiz)).toBe(antes)
    const r = insere(raiz, c(['filhos', 1]), 'filhos', 2, F('y'), defs); expect(r.ok && r.caminho).toEqual(c(['filhos', 1], ['filhos', 2]))
  })
  it('insere recusa: slot inexistente, bloco desconhecido, aceita, max, posição, id repetido, destino inexistente', () => {
    const e = (r: any) => (r.ok ? '' : r.erro)
    expect(e(insere(raiz, [], 'nada', 0, F('x'), defs))).toMatch(/não tem o slot "nada"/); expect(e(insere(raiz, [], '__proto__', 0, F('x'), defs))).toMatch(/não tem o slot/)
    expect(e(insere(raiz, [], 'filhos', 0, { bloco: 'fantasma', id: 'x' }, defs))).toMatch(/desconhecido/); expect(e(insere({ bloco: 'so', id: 's' }, [], 'itens', 0, K('k'), defs))).toMatch(/só aceita: folha/)
    const lado = ok(insere(raiz, [], 'lado', 0, F('l'), defs)); expect(e(insere(lado, [], 'lado', 1, F('m'), defs))).toMatch(/no máximo 1/)
    expect(e(insere(raiz, [], 'filhos', 9, F('x'), defs))).toMatch(/posição inválida/); expect(e(insere(raiz, [], 'filhos', -1, F('x'), defs))).toMatch(/posição inválida/); expect(e(insere(raiz, [], 'filhos', 1.5, F('x'), defs))).toMatch(/posição inválida/)
    expect(e(insere(raiz, [], 'filhos', 0, F('c'), defs))).toMatch(/"c" já existe/); expect(e(insere(raiz, [], 'filhos', 0, K('n', F('z'), F('z')), defs))).toMatch(/"z" já existe/)
    expect(e(insere(raiz, c(['filhos', 7]), 'filhos', 0, F('x'), defs))).toMatch(/destino inexistente/); expect(e(insere(F('f'), [], 'filhos', 0, F('x'), defs))).toMatch(/não tem o slot/)
  })
  it('remove: some o bloco e a subárvore; slot vazio é podado; raiz, mínimo e inexistente são recusados', () => {
    expect(ids(ok(remove(raiz, c(['filhos', 1]), defs)))).toEqual(['r', 'a', 'e']); expect(ok(remove(K('r', F('a')), c(['filhos', 0]), defs)).slots).toBeUndefined()
    const e = (r: any) => (r.ok ? '' : r.erro)
    expect(e(remove(raiz, [], defs))).toMatch(/raiz/); expect(e(remove(raiz, c(['filhos', 9]), defs))).toMatch(/inexistente/)
    expect(e(remove({ bloco: 'minimo', id: 'm', slots: { filhos: [F('a')] } }, c(['filhos', 0]), defs))).toMatch(/pelo menos 1/)
  })
  it('move: reordena no mesmo pai (índice vale ANTES de tirar), muda de pai, e recusa para dentro de si', () => {
    const lista = K('r', F('a'), F('b'), F('c'), F('d'))
    expect(ids(ok(move(lista, c(['filhos', 0]), [], 'filhos', 3, defs)))).toEqual(['r', 'b', 'c', 'a', 'd']) // a entra antes do d
    expect(ids(ok(move(lista, c(['filhos', 3]), [], 'filhos', 0, defs)))).toEqual(['r', 'd', 'a', 'b', 'c'])
    expect(ids(ok(move(lista, c(['filhos', 1]), [], 'filhos', 1, defs)))).toEqual(['r', 'a', 'b', 'c', 'd']); expect(ids(ok(move(lista, c(['filhos', 1]), [], 'filhos', 2, defs)))).toEqual(['r', 'a', 'b', 'c', 'd'])
    expect(ids(ok(move(lista, c(['filhos', 1]), [], 'filhos', 4, defs)))).toEqual(['r', 'a', 'c', 'd', 'b'])
    expect(ids(ok(move(raiz, c(['filhos', 0]), c(['filhos', 1]), 'filhos', 1, defs)))).toEqual(['r', 'b', 'c', 'a', 'd', 'e']) // a vai para dentro de b (que subiu de posição)
    expect(ids(ok(move(raiz, c(['filhos', 1], ['filhos', 0]), [], 'filhos', 0, defs)))).toEqual(['r', 'c', 'a', 'b', 'd', 'e'])
    const e = (r: any) => (r.ok ? '' : r.erro)
    expect(e(move(raiz, c(['filhos', 1]), c(['filhos', 1]), 'filhos', 0, defs))).toMatch(/dentro dele mesmo/); expect(e(move(raiz, c(['filhos', 1]), c(['filhos', 1], ['filhos', 0]), 'filhos', 0, defs))).toMatch(/dentro dele mesmo/)
    expect(e(move(raiz, [], [], 'filhos', 0, defs))).toMatch(/raiz/); expect(e(move(raiz, c(['filhos', 9]), [], 'filhos', 0, defs))).toMatch(/inexistente/); expect(e(move(raiz, c(['filhos', 0]), [], 'nada', 0, defs))).toMatch(/slot/)
  })
  it('move respeita aceita, max e min do slot de origem/destino', () => {
    const e = (r: any) => (r.ok ? '' : r.erro)
    const r: Inst = { bloco: 'caixa', id: 'r', slots: { filhos: [K('k'), F('f'), { bloco: 'so', id: 's' }] } }
    expect(e(move(r, c(['filhos', 0]), c(['filhos', 2]), 'itens', 0, defs))).toMatch(/só aceita: folha/); expect(ok(move(r, c(['filhos', 1]), c(['filhos', 2]), 'itens', 0, defs)).slots!.filhos).toHaveLength(2)
    const l: Inst = { bloco: 'caixa', id: 'r', slots: { filhos: [F('a')], lado: [F('l')] } }; expect(e(move(l, c(['filhos', 0]), [], 'lado', 0, defs))).toMatch(/no máximo 1/)
    const m: Inst = { bloco: 'caixa', id: 'r', slots: { filhos: [{ bloco: 'minimo', id: 'm', slots: { filhos: [F('a')] } }, K('k')] } }
    expect(e(move(m, c(['filhos', 0], ['filhos', 0]), c(['filhos', 1]), 'filhos', 0, defs))).toMatch(/pelo menos 1/)
  })
  it('duplica: ids novos únicos, subárvore inteira, logo depois', () => {
    const r = ok(duplica(raiz, c(['filhos', 1]), defs)); expect(ids(r)).toEqual(['r', 'a', 'b', 'c', 'd', 'b-2', 'c-2', 'd-2', 'e']); expect(idsDuplicados(r)).toEqual([])
    const r2 = ok(duplica(r, c(['filhos', 1]), defs)); expect(ids(r2)).toContain('b-3'); expect(idsDuplicados(r2)).toEqual([])
    expect(duplica(raiz, [], defs)).toMatchObject({ ok: false })
    const x = { ...F('q'), props: { t: 1 } }; const d = ok(duplica(K('r', x), c(['filhos', 0]), defs)); d.slots!.filhos![1]!.props!.t = 9; expect(x.props.t).toBe(1) // cópia profunda
  })
  it('props, id e atualiza', () => {
    expect(noEm(ok(trocaProps(raiz, c(['filhos', 0]), { t: 1 })), c(['filhos', 0]))!.props).toEqual({ t: 1 }); expect('props' in noEm(ok(trocaProps(ok(trocaProps(raiz, c(['filhos', 0]), { t: 1 })), c(['filhos', 0]), {})), c(['filhos', 0]))!).toBe(false)
    expect(noEm(ok(renomeiaId(raiz, c(['filhos', 0]), 'novo')), c(['filhos', 0]))!.id).toBe('novo'); expect(renomeiaId(raiz, c(['filhos', 0]), 'b')).toMatchObject({ ok: false }); expect(renomeiaId(raiz, c(['filhos', 0]), '1x')).toMatchObject({ ok: false })
    expect('id' in noEm(ok(renomeiaId(raiz, c(['filhos', 0]), undefined)), c(['filhos', 0]))!).toBe(false); expect(renomeiaId(raiz, c(['filhos', 0]), 'a')).toMatchObject({ ok: true })
    expect(atualiza(raiz, c(['filhos', 9]), (i) => i)).toMatchObject({ ok: false }); expect(caminhoDeId(raiz, 'd')).toEqual(c(['filhos', 1], ['filhos', 1])); expect(caminhoDeId(raiz, 'zz')).toBeUndefined()
  })
  it('limites: profundidade e quantidade de blocos', () => {
    let fundo: Inst = F('f0'); for (let i = 1; i < LIMITES.profundidade; i++) fundo = K(`k${i}`, fundo)
    expect(insere(fundo, [], 'lado', 0, F('novo'), defs)).toMatchObject({ ok: true })
    let p: Caminho = []; for (let i = 1; i < LIMITES.profundidade; i++) p = [...p, { slot: 'filhos', indice: 0 }]
    expect(insere(fundo, p.slice(0, -1), 'filhos', 0, K('mais', F('x')), defs)).toMatchObject({ ok: false, erro: expect.stringMatching(/níveis/) })
    const larga = K('big', ...Array.from({ length: LIMITES.nos - 1 }, (_, i) => F(`f${i}`))); expect(contaNos(larga)).toBe(LIMITES.nos)
    expect(insere(larga, [], 'filhos', 0, F('mais'), defs)).toMatchObject({ ok: false, erro: expect.stringMatching(/blocos/) })
  })
  it('FUZZ: 3000 operações aleatórias mantêm os invariantes e batem com um oráculo ingênuo', () => {
    let s = 12345; const rnd = (n: number) => { s = (Math.imul(s, 1103515245) + 12345) >>> 0; return s % n }
    let r: Inst = K('r', F('a'), K('b', F('c')), F('d')), seq = 0, aceitas = 0
    const ingenuo = (x: Inst): string[] => [...percorre(x)].map((y) => y.inst.id!)
    for (let it = 0; it < 3000; it++) {
      const todos = [...percorre(r)], escolhe = () => todos[rnd(todos.length)]!, antes = JSON.stringify(r), idsAntes = ingenuo(r)
      const op = rnd(5); let res: any
      if (op === 0) { const p = escolhe(); res = insere(r, p.caminho, 'filhos', rnd((p.inst.slots?.filhos?.length ?? 0) + 2), F(`n${seq++}`), defs) }
      else if (op === 1) res = remove(r, escolhe().caminho, defs)
      else if (op === 2) { const a = escolhe(), b = escolhe(); res = move(r, a.caminho, b.caminho, 'filhos', rnd((b.inst.slots?.filhos?.length ?? 0) + 2), defs) }
      else if (op === 3) res = duplica(r, escolhe().caminho, defs)
      else res = trocaProps(r, escolhe().caminho, { v: it })
      expect(JSON.stringify(r)).toBe(antes) // nunca muta
      if (!res.ok) continue
      aceitas++; const novos = ingenuo(res.raiz)
      expect(idsDuplicados(res.raiz)).toEqual([]); expect(contaNos(res.raiz)).toBeLessThanOrEqual(LIMITES.nos)
      if (op === 2) expect([...novos].sort()).toEqual([...idsAntes].sort())            // mover não perde nem cria
      if (op === 1) expect(novos.length).toBeLessThan(idsAntes.length)
      if (op === 0 || op === 3) expect(novos.length).toBeGreaterThan(idsAntes.length)
      if (op === 4) expect(novos).toEqual(idsAntes)
      if (op !== 1 && op !== 4) expect(noEm(res.raiz, res.caminho)).toBeDefined()
      if (contaNos(res.raiz) < 300) r = res.raiz
    }
    expect(aceitas).toBeGreaterThan(1000)
  })
})
