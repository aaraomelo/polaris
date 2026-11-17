// @vitest-environment jsdom
import { Registry } from '@polaris/schema'
import { describe, expect, it } from 'vitest'
import { COMPONENTES_BASE, FUNCOES_PADRAO, compilaEstatico, compilaPrograma, montaVivo, registraBase, renderPaginaHtml, type Programa } from '../src/index'

const no = (kind: string, id: string, spec: object) => ({ kind, id, versao: '1.0.0', estatuto: 'publicado', spec }) as any
const P = (b: string, extra: object = {}) => ({ bloco: b, ...extra })
let n = 0
const compila = (spec: object) => { const r = new Registry(); registraBase(r); return compilaPrograma(r, r.registra(no('pagina', `c${n++}`, { rota: '/', ...spec }))) }
const ok = (spec: object): Programa => { const r = compila(spec); if (!r.ok) throw new Error(JSON.stringify(r.erros, null, 1)); return r.programa }

const estado = { itens: { tipo: 'json', inicial: [] }, n: { tipo: 'inteiro', inicial: 0 }, taxa: { tipo: 'decimal', inicial: 2 } }
const pagina = () => ok({ estado, raiz: P('layout/pilha', { slots: { filhos: [
  P('texto/paragrafo', { id: 'nomes', props: { texto: '{estado.itens | filtra(p => p.ok) | mapeia(p => maiusculas(p.nome)) | junta(" / ")}' } }),
  P('texto/paragrafo', { id: 'total', props: { texto: 'total={dobra(estado.itens, 0, (s, p) => s + p.preco * estado.taxa) | numero(2)}' } }),
  P('texto/paragrafo', { id: 'n', props: { texto: 'n={estado.n}' } }),
  P('texto/paragrafo', { repetir: { cada: 'ordena(estado.itens, p => p.preco)', como: 'p', chave: 'p.id' }, props: { texto: '{p.nome}:{indice}' } }),
] } }) })

const itens = [{ id: 1, nome: 'pão', preco: 5, ok: true }, { id: 2, nome: 'bolo', preco: 3, ok: false }, { id: 3, nome: 'café', preco: 4, ok: true }]

describe('combinadores em páginas: texto, templates com formatadores, repetir', () => {
  it('compilam e renderizam igual no React, no caminho estático e no runtime vivo', () => {
    const pg = pagina()
    const entrada = { estado: { itens, n: 1, taxa: 2 } }
    const react = renderPaginaHtml({ programa: pg, componentes: COMPONENTES_BASE, ...entrada }).corpo
    expect(react).toContain('PÃO / CAFÉ')
    expect(react).toContain('total=24')
    expect(react).toContain('bolo:0')
    // o caminho estático não aceita eventos/botões; esta página não tem: deve ser elegível e idêntico
    const est = compilaEstatico(pg)
    expect(est.ok && est.pagina.render(entrada).corpo).toBe(react)
    // vivo
    const c = document.createElement('div')
    const v = montaVivo({ programa: pg, container: c, ...entrada })
    const norm = (h: string) => { const d = document.createElement('div'); d.innerHTML = h; return d.textContent }
    expect(c.textContent).toBe(norm(react))
    v.despacha({ t: 'estado', nome: 'itens', valor: [...itens, { id: 4, nome: 'chá', preco: 1, ok: true }] })
    const react2 = renderPaginaHtml({ programa: pg, componentes: COMPONENTES_BASE, estado: v.store().estado }).corpo
    expect(c.textContent).toBe(norm(react2))
    expect(c.textContent).toContain('PÃO / CAFÉ / CHÁ')
    expect(c.querySelectorAll('p').length).toBe(7)
  })

  it('o runtime vivo só reavalia o combinador quando muda algo de que ele depende (o parâmetro não conta)', () => {
    const f = FUNCOES_PADRAO.maiusculas!, orig = f.fn
    let chamadas = 0
    f.fn = (...a: unknown[]) => { chamadas++; return orig(...a) }
    try {
      const c = document.createElement('div')
      const v = montaVivo({ programa: pagina(), container: c, estado: { itens, n: 0, taxa: 2 } })
      chamadas = 0
      v.despacha({ t: 'estado', nome: 'n', valor: 5 })
      expect(chamadas).toBe(0) // `estado.n` não aparece nos combinadores
      v.despacha({ t: 'estado', nome: 'taxa', valor: 3 })
      expect(chamadas).toBe(0) // `taxa` só alimenta o total, que não usa maiusculas
      v.despacha({ t: 'estado', nome: 'itens', valor: itens.slice(0, 2) })
      expect(chamadas).toBe(1) // só o primeiro parágrafo reavalia (1 item ok → 1 chamada)
      expect(c.querySelector('#total')!.textContent).toBe('total=24') // (5 + 3) × 3
    } finally { f.fn = orig }
  })

  it('erros de compilação dentro da função anônima apontam o nó e sugerem o parâmetro', () => {
    const r = compila({ estado, raiz: P('texto/paragrafo', { props: { texto: '{mapeia(estado.itens, produto => prodto.nome)}' } }) })
    expect(r.ok).toBe(false)
    if (!r.ok) {
      expect(r.erros[0]).toMatchObject({ caminho: '/spec/raiz/props/texto', regra: 'binding' })
      expect(r.erros[0]!.mensagem).toContain("'prodto' não existe")
      expect(r.erros[0]!.dica).toContain("quis dizer 'produto'")
    }
    const r2 = compila({ estado, raiz: P('texto/paragrafo', { se: 'mapeia(estado.itens, 5)', props: { texto: 'x' } }) })
    expect(!r2.ok && r2.erros[0]!.mensagem).toContain('deve ser uma função anônima')
    // e em AST JSON
    const r3 = compila({ estado, raiz: P('texto/paragrafo', { se: { chama: 'tamanho', args: [{ fn: ['x'], corpo: { var: 'x' } }] }, props: { texto: 'x' } }) })
    expect(!r3.ok && r3.erros[0]!.mensagem).toContain('só pode ser argumento de um combinador')
  })
})
