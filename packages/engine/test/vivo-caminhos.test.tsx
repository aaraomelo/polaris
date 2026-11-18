// @vitest-environment jsdom
import { Registry } from '@polaris/schema'
import { describe, expect, it } from 'vitest'
import { COMPONENTES_BASE, FUNCOES_PADRAO, compilaPrograma, montaVivo, registraBase, renderPaginaHtml, type Programa, type Vivo } from '../src/index'
import { aplica, com, sem, insere } from '../src/estado/caminho'
import { chavesDeCaminhos, cruza, depsExpr, MARCA } from '../src/vivo/dep'
import { parseExpr } from '../src/expr/index'

const no = (kind: string, id: string, spec: object) => ({ kind, id, versao: '1.0.0', estatuto: 'publicado', spec }) as any
const P = (b: string, extra: object = {}) => ({ bloco: b, ...extra })
let n = 0
function programa(raiz: object, extra: object = {}): Programa {
  const r = new Registry(); registraBase(r)
  r.registra(no('bloco', 'x.cartao', { interface: 'x/cartao', props: { type: 'object', properties: { item: { type: 'object' }, rot: { type: 'string' } } },
    modelo: P('layout/pilha', { slots: { filhos: [P('texto/paragrafo', { props: { texto: 'nome={props.item.nome | maiusculas}' } }), P('texto/paragrafo', { props: { texto: 'rot={props.rot}' } })] } }) }))
  const res = compilaPrograma(r, r.registra(no('pagina', `c${n++}`, { rota: '/', raiz, ...extra })))
  if (!res.ok) throw new Error(JSON.stringify(res.erros, null, 1))
  return res.programa
}
const texto = (c: Element) => [...c.querySelectorAll('p')].map((p) => p.textContent).join('|')
function oraculo(pg: Programa, v: Vivo) { const s = v.store(); const d = document.createElement('div'); d.innerHTML = renderPaginaHtml({ programa: pg, componentes: COMPONENTES_BASE, estado: s.estado, dados: s.dados, status: s.status, erros: s.erros }).corpo; return [...d.querySelectorAll('p')].map((p) => p.textContent).join('|') }

describe('dependências por caminho: chaves e relação "um contém o outro"', () => {
  const deps = (src: string) => { const s = new Set<string>(); depsExpr(parseExpr(src), s); return [...s].sort() }
  it('cadeias estáticas viram uma chave; o que é dinâmico para no prefixo; length depende do contêiner', () => {
    expect(deps('estado.itens[0].nome')).toEqual(['estado.itens.0.nome'])
    expect(deps('loja.a.b.c')).toEqual(['loja.a.b.c'])
    expect(deps('estado.itens[estado.i].nome')).toEqual(['estado.i', 'estado.itens'])
    expect(deps('estado.itens.length')).toEqual(['estado.itens'])
    expect(deps('tamanho(estado.itens)')).toEqual(['estado.itens'])
    expect(deps('o["a-b"].x')).toEqual(['o'])
    expect(deps('o["ab"].x')).toEqual(['o.ab.x'])
    expect(deps('a.b.c.d.e.f.g.h')).toEqual(['a.b.c.d.e.f']) // cadeia longa: prefixo (mais grosso, nunca perde)
    expect(deps('mapeia(l, x => x.n + k.z)')).toEqual(['k.z', 'l'])
  })
  it('cruza: dependência afetada se um caminho CONTÉM o outro, em qualquer direção; irmãos não', () => {
    const m = new Set<string>(); chavesDeCaminhos('estado', [['itens', 3, 'nome']], m)
    expect([...m].sort()).toEqual(['estado', 'estado.itens', 'estado.itens.3', 'estado.itens.3.nome', `estado.itens.3.nome${MARCA}`])
    const c = (...d: string[]) => cruza(new Set(d), m)
    expect(c('estado.itens.3.nome')).toBe(true) // igual
    expect(c('estado.itens')).toBe(true) // lê a lista inteira: a folha está DENTRO
    expect(c('estado')).toBe(true)
    expect(c('estado.itens.3.nome.x')).toBe(true) // lê abaixo da folha (a folha foi trocada inteira)
    expect(c('estado.itens.2.nome')).toBe(false) // irmão
    expect(c('estado.itens.3.preco')).toBe(false)
    expect(c('estado.outro')).toBe(false)
    expect(c('estadoX')).toBe(false)
    // folha na raiz do item: muda tudo que está abaixo
    const m2 = new Set<string>(); chavesDeCaminhos('p', [[]], m2)
    expect(cruza(new Set(['p.nome']), m2)).toBe(true)
    // segmento com ponto no nome: a mudança fica no pai (grosso, seguro)
    const m3 = new Set<string>(); chavesDeCaminhos('o', [['a.b', 'c']], m3)
    expect(cruza(new Set(['o.a', 'o']), m3)).toBe(true)
  })
})

describe('granularidade fina no runtime vivo', () => {
  const f = FUNCOES_PADRAO.maiusculas!, orig = f.fn
  const sonda = () => { let n = 0; f.fn = (...a: unknown[]) => { n++; return orig(...a) }; return { vezes: () => n, zera: () => { n = 0 }, fim: () => { f.fn = orig } } }

  it('trocar OUTRO campo ou OUTRO item não reavalia a expressão que lê estado.itens[1].nome', () => {
    const s = sonda()
    try {
      const pg = programa(P('layout/pilha', { slots: { filhos: [
        P('texto/paragrafo', { props: { texto: '{estado.itens[1].nome | maiusculas}' } }),
        P('texto/paragrafo', { props: { texto: '{estado.cfg.tema.cor}' } }),
        P('texto/paragrafo', { props: { texto: 'n={tamanho(estado.itens)}' } }),
      ] } }), { estado: { itens: { tipo: 'json', inicial: [{ nome: 'a', preco: 1 }, { nome: 'b', preco: 2 }, { nome: 'c', preco: 3 }] }, cfg: { tipo: 'json', inicial: { tema: { cor: 'azul', fonte: 'x' }, outro: 1 } } } })
      const c = document.createElement('div'); const v = montaVivo({ programa: pg, container: c })
      s.zera()
      const st = () => v.store().estado as { itens: unknown[]; cfg: unknown }
      v.despacha({ t: 'estado', nome: 'itens', valor: com(st().itens, [0, 'nome'], 'A') }); expect(s.vezes()).toBe(0) // outro item
      v.despacha({ t: 'estado', nome: 'itens', valor: com(st().itens, [1, 'preco'], 99) }); expect(s.vezes()).toBe(0) // mesmo item, outro campo
      v.despacha({ t: 'estado', nome: 'cfg', valor: com(st().cfg, ['tema', 'fonte'], 'y') }); expect(s.vezes()).toBe(0)
      expect(texto(c)).toBe('B|azul|n=3')
      v.despacha({ t: 'estado', nome: 'itens', valor: com(st().itens, [1, 'nome'], 'bb') }); expect(s.vezes()).toBe(1); expect(texto(c)).toBe('BB|azul|n=3')
      v.despacha({ t: 'estado', nome: 'cfg', valor: com(st().cfg, ['tema', 'cor'], 'verde') }); expect(texto(c)).toBe('BB|verde|n=3'); expect(s.vezes()).toBe(1)
      v.despacha({ t: 'estado', nome: 'itens', valor: insere(st().itens, 3, { nome: 'd' }) as unknown[] }); expect(texto(c)).toBe('BB|verde|n=4') // o tamanho acorda com a lista
      v.despacha({ t: 'estado', nome: 'itens', valor: sem(st().itens, [1]) }); expect(texto(c)).toBe('C|verde|n=3') // remover desloca os índices: a leitura de [1] acorda
    } finally { s.fim() }
  })

  it('no repetir: mudar p.preco não reavalia a expressão de p.nome; e dentro de um composto, props.item.nome idem', () => {
    const s = sonda()
    try {
      const pg = programa(P('layout/pilha', { slots: { filhos: [
        P('texto/paragrafo', { repetir: { cada: 'estado.itens', como: 'p', chave: 'p.id' }, props: { texto: '{p.nome | maiusculas}/{p.preco}' } }),
        P('x/cartao', { repetir: { cada: 'estado.itens', como: 'q', chave: 'q.id' }, props: { item: '{q}', rot: '{q.preco}' } }),
      ] } }), { estado: { itens: { tipo: 'json', inicial: [{ id: 1, nome: 'a', preco: 1 }, { id: 2, nome: 'b', preco: 2 }] } } })
      const c = document.createElement('div'); const v = montaVivo({ programa: pg, container: c })
      const lista = () => (v.store().estado as { itens: unknown[] }).itens
      expect(texto(c)).toBe('A/1|B/2|nome=A|rot=1|nome=B|rot=2')
      s.zera()
      v.despacha({ t: 'estado', nome: 'itens', valor: com(lista(), [0, 'preco'], 10) })
      expect(texto(c)).toBe('A/10|B/2|nome=A|rot=10|nome=B|rot=2')
      // o parágrafo do item 0 reavalia (lê p.preco na mesma template) mas o cartão NÃO reavalia props.item.nome
      expect(s.vezes()).toBe(1) // 1 = a template `{p.nome | maiusculas}/{p.preco}` do item 0; o cartão não chama maiusculas de novo
      s.zera()
      v.despacha({ t: 'estado', nome: 'itens', valor: com(lista(), [1, 'nome'], 'bb') })
      expect(texto(c)).toBe('A/10|BB/2|nome=A|rot=10|nome=BB|rot=2')
      expect(s.vezes()).toBe(2) // parágrafo do item 1 + `props.item.nome` do cartão do item 1
    } finally { s.fim() }
  })
})

describe('FUZZ: estado aninhado com muitos caminhos lidos — o DOM bate com o React depois de cada mudança por caminho', () => {
  it('leituras estáticas, índice calculado, length, combinadores e repetir sobre árvore que muda por com/sem/insere', () => {
    let seed = 31
    const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff)
    const ri = (k: number) => Math.floor(rnd() * k)
    const pg = programa(P('layout/pilha', { slots: { filhos: [
      P('texto/paragrafo', { props: { texto: 'a={estado.a.b.c}' } }),
      P('texto/paragrafo', { props: { texto: 'i0={estado.l[0].n}|i2={estado.l[2].n}' } }),
      P('texto/paragrafo', { props: { texto: 'dyn={estado.l[estado.k].n}' } }),
      P('texto/paragrafo', { props: { texto: 'len={estado.l.length}/{tamanho(estado.l)}/{estado.a.arr.length}' } }),
      P('texto/paragrafo', { props: { texto: 'soma={soma(mapeia(estado.l, x => x.n))}' } }),
      P('texto/paragrafo', { repetir: { cada: 'estado.l', como: 'x', chave: 'x.id' }, props: { texto: '{x.id}:{x.n}:{x.tags[0]}' } }),
      P('x/cartao', { props: { item: '{estado.l[1]}', rot: '{estado.a.b.c}' } }),
    ] } }), { estado: {
      a: { tipo: 'json', inicial: { b: { c: 'x' }, arr: [1] } }, k: { tipo: 'inteiro', inicial: 0 },
      l: { tipo: 'json', inicial: [{ id: 1, n: 1, tags: ['t'] }, { id: 2, n: 2, tags: [] }, { id: 3, n: 3, tags: ['u', 'v'] }] },
    } })
    for (let rodada = 0; rodada < 25; rodada++) {
      const c = document.createElement('div'); document.body.appendChild(c)
      const v = montaVivo({ programa: pg, container: c })
      let prox = 10
      for (let passo = 0; passo < 30; passo++) {
        const e = v.store().estado as Record<string, any>
        const k = ri(9)
        if (k === 0) v.despacha({ t: 'estado', nome: 'a', valor: com(e.a, ['b', 'c'], `c${ri(5)}`) })
        else if (k === 1) v.despacha({ t: 'estado', nome: 'a', valor: com(e.a, ['arr', e.a.arr.length], ri(9)) })
        else if (k === 2) v.despacha({ t: 'estado', nome: 'k', valor: ri(5) })
        else if (k === 3 && e.l.length) v.despacha({ t: 'estado', nome: 'l', valor: com(e.l, [ri(e.l.length), 'n'], ri(50)) })
        else if (k === 4) v.despacha({ t: 'estado', nome: 'l', valor: insere(e.l, ri(e.l.length + 1), { id: prox++, n: ri(9), tags: ri(2) ? ['z'] : [] }) as unknown[] })
        else if (k === 5 && e.l.length) v.despacha({ t: 'estado', nome: 'l', valor: sem(e.l, [ri(e.l.length)]) })
        else if (k === 6 && e.l.length) v.despacha({ t: 'estado', nome: 'l', valor: com(e.l, [ri(e.l.length), 'tags'], ri(2) ? [] : ['q', 'w']) })
        else if (k === 7 && e.l.length > 1) { const a = ri(e.l.length); ri(e.l.length); v.despacha({ t: 'estado', nome: 'l', valor: aplica(e.l, [{ op: 'remove', caminho: [a], antes: e.l[a] }]) && [...e.l].sort(() => rnd() - 0.5) }) }
        else if (k === 8) v.despacha({ t: 'estado', nome: 'a', valor: { b: { c: `n${ri(3)}` }, arr: Array.from({ length: ri(4) }, () => ri(9)) } })
        else continue
        expect(texto(c), `rodada ${rodada} passo ${passo} (ação ${k})`).toBe(oraculo(pg, v))
      }
      v.destroi(); c.remove()
    }
  })
})
