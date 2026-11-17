import { Registry } from '@polaris/schema'
import { describe, expect, it } from 'vitest'
import { compilaPrograma, criaModelo, registraBase, type Mudanca } from '../src/index'
import { aplica, com, inverso } from '../src/estado/caminho'
import { igualProfundo } from '../src/expr/funcoes'

const no = (kind: string, id: string, spec: object) => ({ kind, id, versao: '1.0.0', estatuto: 'publicado', spec }) as any
const programa = () => {
  const r = new Registry(); registraBase(r)
  r.registra(no('servico', 'cat', { entidades: {}, operacoes: {} }))
  r.registra(no('dados', 'd.loja', { fonte: { tipo: 'servico', servico: 'cat', operacao: 'x' } }))
  const res = compilaPrograma(r, r.registra(no('pagina', 'h1', { rota: '/', dados: { loja: 'd.loja' }, estado: { n: { tipo: 'inteiro', inicial: 0 }, doc: { tipo: 'json', inicial: { a: { b: 1 }, l: [] } } }, raiz: { bloco: 'texto/paragrafo', props: { texto: 'x' } } })))
  if (!res.ok) throw new Error(JSON.stringify(res.erros))
  return res.programa
}
const novo = (historico = 50) => criaModelo({ programa: programa(), historico, dados: { loja: { v: 1 } } })
const est = (m: ReturnType<typeof novo>) => m.store().estado

describe('histórico do modelo: patches reversíveis, desfazer e refazer', () => {
  it('cada mudança traz seus patches (preguiçosos, em cache) e aplica(antes, patches) = depois', () => {
    const m = novo()
    m.despacha({ t: 'estado', nome: 'doc', valor: com(est(m).doc, ['a', 'b'], 2) })
    m.despacha({ t: 'estado', nome: 'n', valor: 5 })
    const [h1, h2] = m.historico() as readonly Mudanca[]
    expect(h1!.patches()).toEqual([{ op: 'replace', caminho: ['estado', 'doc', 'a', 'b'], valor: 2, antes: 1 }])
    expect(h2!.patches()).toEqual([{ op: 'replace', caminho: ['estado', 'n'], valor: 5, antes: 0 }])
    expect(h1!.patches()).toBe(h1!.patches()) // em cache
    for (const h of [h1!, h2!]) expect(igualProfundo(aplica(h.antes, h.patches()), h.depois)).toBe(true)
    expect(igualProfundo(aplica(h2!.depois, inverso(h2!.patches())), h2!.antes)).toBe(true)
  })

  it('desfaz e refaz o ESTADO, em ordem; dados do servidor não são desfeitos; mudança nova esvazia o refazer', () => {
    const m = novo()
    const vistas: number[] = []
    m.assina((c) => vistas.push(c.depois.estado.n as number))
    for (const v of [1, 2, 3]) m.despacha({ t: 'estado', nome: 'n', valor: v })
    m.despacha({ t: 'dado', nome: 'loja', valor: { v: 2 } }) // chegou dado novo
    expect(m.podeDesfazer()).toBe(true); expect(m.podeRefazer()).toBe(false)
    expect(m.desfaz()).toBe(true); expect(est(m).n).toBe(2)
    expect(m.store().dados.loja).toEqual({ v: 2 }) // o dado NÃO voltou
    expect(m.desfaz()).toBe(true); expect(est(m).n).toBe(1)
    expect(m.refaz()).toBe(true); expect(est(m).n).toBe(2)
    m.despacha({ t: 'estado', nome: 'n', valor: 9 }) // mudança nova: o refazer some
    expect(m.podeRefazer()).toBe(false); expect(m.refaz()).toBe(false)
    expect(m.desfaz()).toBe(true); expect(est(m).n).toBe(2)
    expect(m.desfaz()).toBe(true); expect(est(m).n).toBe(1); expect(m.desfaz()).toBe(true); expect(est(m).n).toBe(0)
    expect(m.desfaz()).toBe(false); expect(m.podeDesfazer()).toBe(false)
    expect(vistas.length).toBeGreaterThan(6) // os espelhos foram notificados também nos desfazer/refazer
  })

  it('desfazer/refazer NÃO entram no histórico (não se desfaz o desfazer, e o anel não cresce)', () => {
    const m = novo()
    m.despacha({ t: 'estado', nome: 'n', valor: 1 })
    const tam = m.historico().length
    m.desfaz(); m.refaz(); m.desfaz()
    expect(m.historico().length).toBe(tam)
  })

  it('FUZZ: sequências aleatórias de mudanças, desfazer e refazer sempre voltam EXATAMENTE ao estado daquele momento', () => {
    let seed = 8
    const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff)
    const ri = (k: number) => Math.floor(rnd() * k)
    for (let rodada = 0; rodada < 200; rodada++) {
      const m = novo(1000)
      const linha = [est(m)] // snapshots do estado: linha[pos] é o estado atual
      let pos = 0
      for (let passo = 0; passo < 40; passo++) {
        const r = rnd()
        if (r < 0.55) {
          const e = est(m)
          const nova = rnd() < 0.5 ? { t: 'estado' as const, nome: 'n', valor: ri(100) } : { t: 'estado' as const, nome: 'doc', valor: rnd() < 0.5 ? com(e.doc, ['a', 'b'], ri(5)) : com(e.doc, ['l', (e.doc as { l: unknown[] }).l.length], ri(9)) }
          m.despacha(nova)
          if (!igualProfundo(est(m), linha[pos])) { linha.length = pos + 1; linha.push(est(m)); pos++ } // mudança real: o futuro some
        } else if (r < 0.8) { const ok = m.desfaz(); expect(ok, `desfaz r${rodada} p${passo} pos=${pos} n=${linha.length}`).toBe(pos > 0); if (ok) pos-- }
        else { const ok = m.refaz(); expect(ok, `refaz r${rodada} p${passo} pos=${pos} n=${linha.length}`).toBe(pos < linha.length - 1); if (ok) pos++ }
        expect(igualProfundo(est(m), linha[pos]), `rodada ${rodada} passo ${passo}`).toBe(true)
      }
    }
  })

  it('o anel do histórico limita o desfazer ao tamanho configurado', () => {
    const m = novo(3)
    for (let i = 1; i <= 6; i++) m.despacha({ t: 'estado', nome: 'n', valor: i })
    let k = 0; while (m.desfaz()) k++
    expect(k).toBe(3); expect(est(m).n).toBe(3)
  })
  it('sem `historico` configurado não há o que desfazer (e nada vaza memória)', () => {
    const m = criaModelo({ programa: programa() })
    m.despacha({ t: 'estado', nome: 'n', valor: 1 })
    expect(m.historico()).toEqual([]); expect(m.desfaz()).toBe(false); expect(m.podeDesfazer()).toBe(false)
  })
})
