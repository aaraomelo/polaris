import { describe, expect, it } from 'vitest'
import { aplica, caminhosMudados, com, difere, insere, inverso, mescla, move, obter, sem, type Caminho, type Patch, type V } from '../src/estado/caminho'
import { igualProfundo } from '../src/expr/funcoes'

let seed = 5
const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff)
const ri = (n: number) => Math.floor(rnd() * n)
const pick = <T,>(xs: readonly T[]): T => xs[ri(xs.length)]!
const CHAVES = ['a', 'b', 'c', 'itens', 'nome', 'k-1', 'ç', '0']

function arvore(prof: number): V {
  if (prof <= 0 || rnd() < 0.3) return pick([null, true, false, 0, 1, -2.5, 'x', '', 'texto'])
  if (rnd() < 0.45) return Array.from({ length: ri(4) }, () => arvore(prof - 1))
  return Object.fromEntries(Array.from({ length: ri(4) }, () => [pick(CHAVES), arvore(prof - 1)]))
}
/** todos os caminhos existentes (inclusive a raiz) */
function caminhos(x: V, c: (string | number)[] = []): (string | number)[][] {
  const r = [c]
  if (Array.isArray(x)) x.forEach((v, i) => r.push(...caminhos(v, [...c, i])))
  else if (x && typeof x === 'object') for (const [k, v] of Object.entries(x)) r.push(...caminhos(v, [...c, k]))
  return r
}
const congela = (x: V): V => { if (x && typeof x === 'object') { Object.freeze(x); Object.values(x).forEach(congela) } return x }
const json = (x: V) => JSON.stringify(x)

describe('obter / com / sem: imutáveis, com compartilhamento estrutural', () => {
  it('com troca só o caminho; o resto é a MESMA referência; a entrada não é tocada (congelada)', () => {
    const x = congela({ a: { b: [1, { c: 2 }, 3], d: { e: 1 } }, f: [9] }) as Record<string, any>
    const y = com(x, ['a', 'b', 1, 'c'], 99) as Record<string, any>
    expect(y.a.b[1].c).toBe(99); expect(x.a.b[1].c).toBe(2)
    expect(y.f).toBe(x.f); expect(y.a.d).toBe(x.a.d); expect(y.a.b[0]).toBe(1); expect(y).not.toBe(x); expect(y.a).not.toBe(x.a)
    expect(Object.isFrozen(y)).toBe(false)
  })
  it('nada muda → a MESMA referência (com, sem, insere/move no lugar, mescla)', () => {
    const x = congela({ a: { b: [1, 2] }, c: 3 }) as Record<string, any>
    expect(com(x, ['c'], 3)).toBe(x); expect(com(x, ['a', 'b', 0], 1)).toBe(x); expect(com(x, [], x)).toBe(x)
    expect(sem(x, ['z'])).toBe(x); expect(sem(x, ['a', 'q', 'r'])).toBe(x); expect(sem(x, ['a', 'b', 9])).toBe(x)
    expect(move(x.a.b, 1, 1)).toBe(x.a.b); expect(mescla(x, { c: 3 })).toBe(x); expect(mescla(x, {})).toBe(x)
  })
  it('cria o que falta: texto → objeto, índice 0 → lista; anexar em length; além disso é ausente', () => {
    expect(com(undefined, ['a', 'b'], 1)).toEqual({ a: { b: 1 } })
    expect(com(null, [0], 'x')).toEqual(['x'])
    expect(com({}, ['l', 0, 'n'], 1)).toEqual({ l: [{ n: 1 }] })
    expect(com([1, 2], [2], 3)).toEqual([1, 2, 3])
    expect(com([1, 2], [3], 3)).toBeUndefined()
    expect(com({ a: 1 }, ['a', 'b'], 1)).toBeUndefined() // 1 não é objeto
    expect(com([1], ['k'], 1)).toBeUndefined(); expect(com({ a: 1 }, [0], 1)).toBeUndefined()
    expect(com({}, ['a'], undefined)).toBeUndefined()
    expect(com({}, [-1], 1)).toBeUndefined(); expect(com([], [0.5], 1)).toBeUndefined()
  })
  it('chaves proibidas e caminhos fundos demais são recusados (nunca poluem o protótipo)', () => {
    for (const k of ['__proto__', 'constructor', 'prototype']) { expect(com({}, [k, 'x'], 1)).toBeUndefined(); expect(com({}, ['a', k], 1)).toBeUndefined(); expect(sem({ a: 1 }, [k])).toBeUndefined() }
    expect(({} as Record<string, unknown>).x).toBeUndefined()
    expect(com({}, Array.from({ length: 65 }, () => 'a'), 1)).toBeUndefined()
    expect(com({}, Array.from({ length: 64 }, () => 'a'), 1)).toBeDefined()
    expect(obter({ constructor: 1 }, ['constructor'])).toBeUndefined()
  })
  it('sem: remove chave ou posição; ausente é no-op; caminho vazio é ausente', () => {
    expect(sem({ a: 1, b: 2 }, ['a'])).toEqual({ b: 2 })
    expect(sem({ l: [1, 2, 3] }, ['l', 1])).toEqual({ l: [1, 3] })
    expect(sem({ a: { b: 1, c: 2 } }, ['a', 'b'])).toEqual({ a: { c: 2 } })
    expect(sem({ a: 1 }, [])).toBeUndefined()
  })
  it('insere e move (listas)', () => {
    expect(insere([1, 2], 1, 9)).toEqual([1, 9, 2]); expect(insere([1, 2], 2, 9)).toEqual([1, 2, 9]); expect(insere([1, 2], 3, 9)).toBeUndefined(); expect(insere('x', 0, 1)).toBeUndefined()
    expect(move([1, 2, 3, 4], 0, 2)).toEqual([2, 3, 1, 4]); expect(move([1, 2, 3, 4], 3, 0)).toEqual([4, 1, 2, 3]); expect(move([1], 0, 1)).toBeUndefined()
  })
  it('FUZZ: obter(com(x,p,v),p) = v; o que não é o caminho não muda; sem remove; tudo sem mutar a entrada', () => {
    for (let i = 0; i < 3000; i++) {
      const x = congela(arvore(4))
      const todos = caminhos(x)
      const p = pick(todos)
      const v = arvore(2)
      if (v === undefined) continue
      const y = com(x, p, v)
      expect(y, json(p)).toBeDefined()
      expect(igualProfundo(obter(y, p), v)).toBe(true)
      // caminhos que não são o escolhido nem seus pais/filhos mantêm o valor (e a referência)
      for (const q of todos) {
        const relacionado = q.length >= p.length ? p.every((s, k) => q[k] === s) : q.every((s, k) => p[k] === s)
        if (!relacionado) expect(obter(y, q)).toBe(obter(x, q))
      }
      if (p.length > 0) {
        const z = sem(x, p)
        expect(z).toBeDefined()
        if (typeof p[p.length - 1] === 'string') expect(obter(z, p)).toBeUndefined()
      }
    }
  })
})

describe('difere / aplica / inverso: patches reversíveis', () => {
  it('forma dos patches (add, remove, replace com o valor antigo; remoções de lista do fim para o começo)', () => {
    expect(difere({ a: 1, b: 2 }, { a: 1, b: 3, c: 4 })).toEqual([{ op: 'replace', caminho: ['b'], valor: 3, antes: 2 }, { op: 'add', caminho: ['c'], valor: 4 }])
    expect(difere({ l: [1, 2, 3, 4] }, { l: [1, 9] })).toEqual([
      { op: 'replace', caminho: ['l', 1], valor: 9, antes: 2 }, { op: 'remove', caminho: ['l', 3], antes: 4 }, { op: 'remove', caminho: ['l', 2], antes: 3 },
    ])
    expect(difere([1], [1, 2, 3])).toEqual([{ op: 'add', caminho: [1], valor: 2 }, { op: 'add', caminho: [2], valor: 3 }])
    expect(difere(1, 2)).toEqual([{ op: 'replace', caminho: [], valor: 2, antes: 1 }])
    expect(difere({ a: [] }, { a: {} })).toEqual([{ op: 'replace', caminho: ['a'], valor: {}, antes: [] }]) // tipos diferentes
  })
  it('FUZZ: aplica(a, difere(a,b)) = b e aplica(b, inverso(...)) = a — em árvores independentes e em árvores com estrutura compartilhada', () => {
    for (let i = 0; i < 4000; i++) {
      const a = congela(arvore(4))
      let b: V
      if (rnd() < 0.3) b = arvore(4)
      else { // b derivado de a por operações, compartilhando a maior parte
        b = a
        for (let k = 0; k < 1 + ri(3); k++) {
          const p = pick(caminhos(b))
          const r = rnd()
          const novo = r < 0.5 ? com(b, p, arvore(2)) : r < 0.8 ? sem(b, p) : p.length && typeof p[p.length - 1] === 'number' ? insere(obter(b, p.slice(0, -1)), p[p.length - 1], arvore(1)) && com(b, p.slice(0, -1), insere(obter(b, p.slice(0, -1)), p[p.length - 1], arvore(1))) : b
          if (novo !== undefined) b = novo
        }
      }
      const patches = difere(a, b)!
      expect(patches).toBeDefined()
      expect(igualProfundo(aplica(a, patches), b), `${json(a)} → ${json(b)} por ${json(patches)}`).toBe(true)
      expect(igualProfundo(aplica(b, inverso(patches)), a), `volta de ${json(patches)}`).toBe(true)
    }
  })
  it('difere(a, a) é vazio e custa O(1) com a mesma referência; subárvores compartilhadas são puladas', () => {
    const grande = { itens: Array.from({ length: 200_000 }, (_, i) => ({ id: i, nome: `n${i}` })), outra: { x: 1 } }
    expect(difere(grande, grande)).toEqual([])
    const novo = com(grande, ['itens', 123_456, 'nome'], 'mudou') as typeof grande
    const t0 = performance.now()
    const p = difere(grande, novo)!
    const dt = performance.now() - t0
    expect(p).toEqual([{ op: 'replace', caminho: ['itens', 123_456, 'nome'], valor: 'mudou', antes: 'n123456' }])
    expect(novo.itens[0]).toBe(grande.itens[0]) // 199 999 itens com a mesma referência
    expect(dt).toBeLessThan(250) // varre o índice da lista (200 mil comparações de referência), não 200 mil objetos
  })
  it('aplica é atômico (um patch inválido dá ausente) e recusa caminhos proibidos', () => {
    expect(aplica({ a: 1 }, [{ op: 'replace', caminho: ['a'], valor: 2, antes: 1 }, { op: 'add', caminho: ['a', 'b'], valor: 1 }])).toBeUndefined() // o 1º é válido, o 2º põe campo dentro de um número: nada é aplicado
    expect(aplica({ a: 1 }, [{ op: 'replace', caminho: ['a'], valor: 2, antes: 1 }])).toEqual({ a: 2 })
    expect(aplica({ a: 1 }, [{ op: 'add', caminho: ['l', 5], valor: 1 }])).toBeUndefined()
    expect(aplica({ a: 1 }, [{ op: 'add', caminho: ['__proto__', 'x'], valor: 1 }])).toBeUndefined()
    expect(aplica(1, [{ op: 'remove', caminho: [], antes: 1 }])).toBeUndefined()
  })
  it('add em índice de lista INSERE na posição (empurra os seguintes), como no JSON Patch — não sobrescreve', () => {
    expect(aplica({ l: [1, 2] }, [{ op: 'add', caminho: ['l', 1], valor: 9 }])).toEqual({ l: [1, 9, 2] })
    expect(aplica({ l: [1, 2] }, [{ op: 'add', caminho: ['l', 2], valor: 9 }])).toEqual({ l: [1, 2, 9] })
    expect(aplica({ l: [1, 2] }, [{ op: 'add', caminho: ['l', 3], valor: 9 }])).toBeUndefined()
    expect(aplica({ l: [1, 2, 3] }, [{ op: 'remove', caminho: ['l', 0], antes: 1 }])).toEqual({ l: [2, 3] })
    // e o inverso de uma remoção no meio é um add no meio
    expect(aplica({ l: [1, 3] }, inverso([{ op: 'remove', caminho: ['l', 1], antes: 2 }]))).toEqual({ l: [1, 2, 3] })
  })
  it('limite: patch gigante (mais que o limite) é ausente em vez de travar', () => {
    expect(difere(Array.from({ length: 50 }, (_, i) => i), Array.from({ length: 50 }, (_, i) => -i - 1), 10)).toBeUndefined()
  })
})

describe('caminhosMudados: o que o runtime usa para saber o que reavaliar', () => {
  const relacionados = (p: (string | number)[], q: (string | number)[]) => (q.length >= p.length ? p.every((s, k) => String(q[k]) === String(s)) : q.every((s, k) => String(p[k]) === String(s)))
  it('exemplos: só a folha que mudou; lista com tamanho diferente aponta os índices novos', () => {
    const x = { a: { b: 1, c: [1, 2] }, d: 5 }
    expect(caminhosMudados(x, com(x, ['a', 'b'], 2))).toEqual([['a', 'b']])
    expect(caminhosMudados(x, x)).toEqual([])
    expect(caminhosMudados(x, com(x, ['a', 'c', 2], 3))).toEqual([['a', 'c', 2]])
    expect(caminhosMudados(x, sem(x, ['d']))).toEqual([['d']])
    expect(caminhosMudados({ n: 1 }, { n: 1, m: 2 })).toEqual([['m']])
  })
  it('FUZZ de SEGURANÇA: todo caminho cujo valor difere está coberto por uma folha reportada (nunca perde mudança)', () => {
    for (let i = 0; i < 3000; i++) {
      const a = arvore(4), b = rnd() < 0.5 ? arvore(4) : (com(a, pick(caminhos(a)), arvore(2)) ?? a)
      const folhas = caminhosMudados(a, b, 1 + ri(8), 1 + ri(5))
      for (const p of new Set([...caminhos(a), ...caminhos(b)].map(json))) {
        const c = JSON.parse(p) as (string | number)[]
        if (!igualProfundo(obter(a, c), obter(b, c))) expect(folhas.some((f) => relacionados(c, f)), `${json(a)} → ${json(b)}: ${p} sem cobertura em ${json(folhas)}`).toBe(true)
      }
    }
  })
  it('muita mudança sob um nó vira o nó inteiro (granularidade grossa, nunca explosão)', () => {
    const a = { l: Array.from({ length: 500 }, (_, i) => ({ v: i })) }
    const b = { l: Array.from({ length: 500 }, (_, i) => ({ v: i + 1 })) }
    expect(caminhosMudados(a, b, 64)).toEqual([['l']])
  })
})
