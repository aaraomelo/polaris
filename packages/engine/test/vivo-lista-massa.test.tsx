// @vitest-environment jsdom
import { Registry } from '@polaris/schema'
import { describe, expect, it } from 'vitest'
import { COMPONENTES_BASE, compilaPrograma, montaVivo, registraBase, renderPaginaHtml } from '../src/index'

const no = (kind: string, id: string, spec: object) => ({ kind, id, versao: '1.0.0', estatuto: 'publicado', spec }) as any
const P = (b: string, extra: object = {}) => ({ bloco: b, ...extra })
const r = new Registry(); registraBase(r)
r.registra(no('bloco', 'x.c', { interface: 'x/c', props: { type: 'object', properties: { t: { type: 'string' } } }, modelo: P('layout/pilha', { slots: { filhos: [P('texto/titulo', { props: { texto: '{props.t}' } }), P('texto/paragrafo', { props: { texto: 'i={props.t}' } })] } }) }))
const pg = compilaPrograma(r, r.registra(no('pagina', 'massa', { rota: '/', estado: { l: { tipo: 'json', inicial: ['a', 'b'] } }, raiz: P('layout/pilha', { slots: { filhos: [
  P('nav/botao', { id: 'vazio', props: { texto: 'v' }, eventos: { aoClicar: [{ acao: 'definir', estado: 'l', valor: '[]' }] } }),
  P('nav/botao', { id: 'cheio', props: { texto: 'c' }, eventos: { aoClicar: [{ acao: 'definir', estado: 'l', valor: '["x","y","z"]' }] } }),
  P('layout/pilha', { id: 'lista', slots: { filhos: [P('x/c', { repetir: { cada: 'estado.l', como: 'p' }, props: { t: '{p}' } })] } }),
] } }) })))
if (!pg.ok) throw new Error('x')
const oraculo = (l: string[]) => { const d = document.createElement('div'); d.innerHTML = renderPaginaHtml({ programa: pg.programa, componentes: COMPONENTES_BASE, estado: { l } }).corpo; return d.querySelector('#lista')!.textContent }

describe('lista: esvaziar e encher em massa', () => {
  it('esvazia, enche, esvazia e enche de novo, sempre igual ao oráculo; as atualizações seguintes ainda funcionam', () => {
    const c = document.createElement('div'); document.body.appendChild(c)
    montaVivo({ programa: pg.programa, container: c })
    const lista = () => c.querySelector('#lista')!.textContent
    expect(lista()).toBe(oraculo(['a', 'b']))
    ;(c.querySelector('#vazio') as HTMLElement).click(); expect(lista()).toBe('')
    ;(c.querySelector('#cheio') as HTMLElement).click(); expect(lista()).toBe(oraculo(['x', 'y', 'z']))
    ;(c.querySelector('#vazio') as HTMLElement).click(); expect(lista()).toBe('')
    ;(c.querySelector('#cheio') as HTMLElement).click(); expect(lista()).toBe(oraculo(['x', 'y', 'z']))
    expect(c.querySelectorAll('h1').length).toBe(3)
  })
})
