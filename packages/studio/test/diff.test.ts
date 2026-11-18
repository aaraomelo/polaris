import { describe, expect, it } from 'vitest'
import { diffArvore, diffJson, diffNo, duplica, insere, move, percorre, remove, trocaProps, type Caminho, type DefBloco, type Inst } from '../src'

const defs: DefBloco = (b) => (b === 'caixa' ? { slots: { filhos: {}, lado: {} } } : b === 'folha' ? {} : undefined)
const F = (id?: string, props?: Record<string, unknown>): Inst => ({ bloco: 'folha', ...(id ? { id } : {}), ...(props ? { props } : {}) })
const K = (id: string | undefined, ...filhos: Inst[]): Inst => ({ bloco: 'caixa', ...(id ? { id } : {}), slots: { filhos } })
const c = (...p: Array<[string, number]>): Caminho => p.map(([slot, indice]) => ({ slot, indice }))
const ok = (r: any) => { if (!r.ok) throw new Error(r.erro); return r.raiz as Inst }
const tipos = (a: Inst, b: Inst) => diffArvore(a, b).map((m) => `${m.tipo}:${m.id ?? m.bloco}`).sort()

describe('diff semântico', () => {
  it('diffJson: adicionado, removido, alterado, por caminho; arrays por posição; objetos iguais não geram nada', () => {
    expect(diffJson({ a: 1, b: { c: 2 }, l: [1, 2] }, { a: 1, b: { c: 3, d: 1 }, l: [1, 2, 3] })).toEqual([{ tipo: 'alterado', caminho: ['b', 'c'], antes: 2, depois: 3 }, { tipo: 'adicionado', caminho: ['b', 'd'], depois: 1 }, { tipo: 'adicionado', caminho: ['l', '2'], depois: 3 }])
    expect(diffJson({ a: 1 }, { a: 1 })).toEqual([]); expect(diffJson({ a: 1 }, {})).toEqual([{ tipo: 'removido', caminho: ['a'], antes: 1 }]); expect(diffJson(1, 'x')).toEqual([{ tipo: 'alterado', caminho: [], antes: 1, depois: 'x' }])
    expect(diffJson({ a: null }, { a: undefined }).length).toBe(1)
  })
  it('mover é movimento (não remoção + adição); reordenar entre irmãos é reordenação; renomear campo é alteração', () => {
    const a = K('r', F('x'), K('cab', F('t')), F('y')), mv = ok(move(a, c(['filhos', 0]), c(['filhos', 1]), 'filhos', 1, defs))
    const d = diffArvore(a, mv); expect(d).toHaveLength(1); expect(d[0]).toMatchObject({ tipo: 'movido', id: 'x', de: 'r', para: 'r › cab' })
    const re = ok(move(a, c(['filhos', 2]), [], 'filhos', 0, defs)); expect(tipos(a, re)).toHaveLength(1) // exatamente um irmão sinalizado
    expect(diffArvore(a, re)).toHaveLength(1); expect(diffArvore(a, re)[0]!.tipo).toBe('reordenado')
  })
  it('adicionar/remover subárvore lista só o bloco mais externo, com a contagem de descendentes', () => {
    const a = K('r', F('x')), b = ok(insere(a, [], 'filhos', 1, K('grupo', F('g1'), F('g2'), K('g3', F('g4'))), defs))
    expect(diffArvore(a, b)).toEqual([{ tipo: 'adicionado', rotulo: 'r › grupo', bloco: 'caixa', id: 'grupo', descendentes: 4, para: 'r' }])
    expect(diffArvore(b, a)).toEqual([{ tipo: 'removido', rotulo: 'r › grupo', bloco: 'caixa', id: 'grupo', descendentes: 4, de: 'r' }])
  })
  it('props: mostra QUAL prop mudou, antes e depois; se/eventos também', () => {
    const a = K('r', F('t', { texto: 'Olá', nivel: 1 })), b = ok(trocaProps(a, c(['filhos', 0]), { texto: 'Oi', nivel: 1, cor: 'azul' }))
    expect(diffArvore(a, b)).toEqual([{ tipo: 'alterado', rotulo: 'r › t', bloco: 'folha', id: 't', campos: [{ tipo: 'alterado', caminho: ['props', 'texto'], antes: 'Olá', depois: 'Oi' }, { tipo: 'adicionado', caminho: ['props', 'cor'], depois: 'azul' }] }])
    const c2 = structuredClone(a); c2.slots!.filhos![0]!.se = 'x > 1'; expect(diffArvore(a, c2)[0]!.campos).toEqual([{ tipo: 'adicionado', caminho: ['se'], depois: 'x > 1' }])
  })
  it('blocos sem id casam por posição e tipo dentro do mesmo pai; trocar o tipo é remoção + adição', () => {
    const a = K('r', F(undefined, { t: 1 }), F(undefined, { t: 2 })), b = K('r', F(undefined, { t: 1 }), F(undefined, { t: 3 }))
    expect(diffArvore(a, b)).toEqual([{ tipo: 'alterado', rotulo: 'r › folha', bloco: 'folha', campos: [{ tipo: 'alterado', caminho: ['props', 't'], antes: 2, depois: 3 }] }])
    const x: Inst = K('r', { bloco: 'caixa' }), y: Inst = K('r', F()); expect(diffArvore(x, y).map((m) => m.tipo).sort()).toEqual(['adicionado', 'removido'])
  })
  it('a raiz sempre casa com a raiz (mesmo sem id e com outro tipo); sem mudança não diz nada', () => {
    const a = K(undefined, F('x')); expect(diffArvore(a, structuredClone(a))).toEqual([]); const b: Inst = { ...a, bloco: 'outro' }
    expect(diffArvore(a, b)).toEqual([{ tipo: 'alterado', rotulo: 'outro', bloco: 'outro', campos: [{ tipo: 'alterado', caminho: ['bloco'], antes: 'caixa', depois: 'outro' }] }])
  })
  it('mover E alterar: um registro só, com os campos', () => {
    const a = K('r', F('x', { t: 1 }), K('cab')), b = ok(move(ok(trocaProps(a, c(['filhos', 0]), { t: 2 })), c(['filhos', 0]), c(['filhos', 1]), 'filhos', 0, defs))
    const d = diffArvore(a, b); expect(d).toHaveLength(1); expect(d[0]).toMatchObject({ tipo: 'movido', id: 'x', campos: [{ caminho: ['props', 't'] }] })
  })
  it('diffNo de página: árvore por identidade, o resto campo a campo, `versao` ignorada; resumo contado', () => {
    const base = { kind: 'pagina', id: 'p', versao: '1.0.0', spec: { rota: '/', titulo: 'A', raiz: K('r', F('x'), F('y')) } }
    const novo = { ...structuredClone(base), versao: '1.0.1', spec: { rota: '/x', titulo: 'A', raiz: ok(remove(ok(insere(base.spec.raiz, [], 'filhos', 0, F('z'), defs)), c(['filhos', 2]), defs)) } }
    const d = diffNo(base, novo); expect(d.igual).toBe(false); expect(d.campos).toEqual([{ tipo: 'alterado', caminho: ['spec', 'rota'], antes: '/', depois: '/x' }])
    expect(d.resumo).toEqual({ adicionados: 1, removidos: 1, movidos: 0, reordenados: 0, alterados: 0, campos: 1 })
    expect(diffNo(base, { ...structuredClone(base), versao: '9.9.9' }).igual).toBe(true)
    expect(diffNo({ kind: 'tema', spec: { tokens: { cor: { a: '#fff' } } } }, { kind: 'tema', spec: { tokens: { cor: { a: '#000' } } } }).campos).toEqual([{ tipo: 'alterado', caminho: ['spec', 'tokens', 'cor', 'a'], antes: '#fff', depois: '#000' }])
  })
  it('FUZZ: uma operação da árvore dá EXATAMENTE a classificação esperada; duas ordens do diff são simétricas', () => {
    let s = 777; const rnd = (n: number) => { s = (Math.imul(s, 1103515245) + 12345) >>> 0; return s % n }
    let r: Inst = K('r', F('a'), K('b', F('c')), F('d')), seq = 0, verificados = 0
    for (let it = 0; it < 1500; it++) {
      const todos = [...percorre(r)], esc = () => todos[rnd(todos.length)]!, op = rnd(4); let res: any, esp: string | undefined
      if (op === 0) { const p = esc(); res = insere(r, p.caminho, 'filhos', rnd((p.inst.slots?.filhos?.length ?? 0) + 1), F(`n${seq++}`), defs); esp = 'adicionado' }
      else if (op === 1) { res = remove(r, esc().caminho, defs); esp = 'removido' }
      else if (op === 2) { const a = esc(), b = esc(); res = move(r, a.caminho, b.caminho, 'filhos', rnd((b.inst.slots?.filhos?.length ?? 0) + 1), defs); esp = 'mov' }
      else { const x = esc(); res = trocaProps(r, x.caminho, { v: it }); esp = 'alterado' }
      if (!res.ok) continue
      const novo = res.raiz as Inst, d = diffArvore(r, novo), rev = diffArvore(novo, r)
      if (esp === 'mov') { if (JSON.stringify(novo) === JSON.stringify(r)) expect(d).toEqual([]); else { expect(d.length).toBe(1); expect(['movido', 'reordenado']).toContain(d[0]!.tipo); expect(['movido', 'reordenado']).toContain(rev[0]!.tipo) } }
      else { expect(d.length, `${esp}`).toBe(1); expect(d[0]!.tipo).toBe(esp); expect(rev[0]!.tipo).toBe(esp === 'adicionado' ? 'removido' : esp === 'removido' ? 'adicionado' : 'alterado') }
      verificados++; r = JSON.stringify(novo).length < 4000 ? novo : r
    }
    expect(verificados).toBeGreaterThan(300)
  })
  it('duplicar aparece como UM bloco adicionado com seus descendentes', () => {
    const a = K('r', K('b', F('c'), F('d'))), b = ok(duplica(a, c(['filhos', 0]), defs)); expect(diffArvore(a, b)).toMatchObject([{ tipo: 'adicionado', id: 'b-2', descendentes: 2 }])
  })
})
