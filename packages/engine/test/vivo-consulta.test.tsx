// @vitest-environment jsdom
import { Registry } from '@polaris/schema'
import { beforeEach, describe, expect, it } from 'vitest'
import { compilaPrograma, montaVivo, registraBase } from '../src/index'

// `estado.<nome>.daConsulta`: o estado nasce da URL, o link `soConsulta` muda só o estado e a URL (sem recarregar) e o voltar acompanha.
const no = (kind: string, id: string, spec: object) => ({ kind, id, versao: '1.0.0', estatuto: 'publicado', spec }) as any
const P = (b: string, extra: object = {}) => ({ bloco: b, ...extra })
const r = new Registry(); registraBase(r)
const res = compilaPrograma(r, r.registra(no('pagina', 'cat', { rota: '/loja', estado: { cat: { tipo: 'texto', inicial: '', daConsulta: 'c' }, ord: { tipo: 'texto', inicial: 'a', daConsulta: 'o' } }, raiz: P('layout/pilha', { slots: { filhos: [
  P('nav/link', { id: 'luz', props: { href: '/loja?c=luz', texto: 'Luz', soConsulta: true, atual: '{estado.cat == "luz"}' } }),
  P('nav/link', { id: 'todas', props: { href: '/loja', texto: 'Todas', soConsulta: true } }),
  P('nav/link', { id: 'fora', props: { href: '/outra', texto: 'Fora', soConsulta: true } }),
  P('texto/paragrafo', { id: 'eco', props: { texto: 'cat={estado.cat}' } }),
  P('nav/botao', { id: 'btn', props: { texto: 'x' }, eventos: { aoClicar: [{ acao: 'definir', estado: 'ord', valor: '"b"' }] } }),
] } }) })))
if (!res.ok) throw new Error(JSON.stringify(res.erros))
// `fechado` é como o navegador monta a página: só o que alguma ação escreve (ou a URL) pode mudar
const abre = (consulta: Record<string, unknown> = {}) => { const c = document.createElement('div'); document.body.appendChild(c); const v = montaVivo({ programa: res.programa, container: c, consulta, fechado: true }); return { c, v } }
const clica = (c: HTMLElement, id: string) => { const e = new MouseEvent('click', { bubbles: true, cancelable: true, button: 0 }); c.querySelector(`#${id}`)!.dispatchEvent(e); return e }

describe('estado ligado à consulta da URL', () => {
  beforeEach(() => { document.body.innerHTML = ''; window.history.replaceState(null, '', '/loja') })
  it('nasce do valor da URL (e do `inicial` quando falta)', () => {
    expect(abre({ c: 'luz' }).c.querySelector('#eco')!.textContent).toBe('cat=luz'); expect(abre().c.querySelector('#eco')!.textContent).toBe('cat=')
  })
  it('clicar num link `soConsulta` muda só o estado e a URL: o clique é cancelado (sem navegar) e o DOM da página não é refeito', () => {
    const { c } = abre(); const eco = c.querySelector('#eco')!, titulo = c.querySelector('#todas')!
    const e = clica(c, 'luz')
    expect(e.defaultPrevented).toBe(true); expect(window.location.search).toBe('?c=luz'); expect(eco.textContent).toBe('cat=luz'); expect(c.querySelector('#eco')).toBe(eco) // o MESMO nó
    expect(c.querySelector('#luz')!.getAttribute('aria-current')).toBe('page'); expect(c.querySelector('#todas')).toBe(titulo)
    clica(c, 'todas'); expect(window.location.search).toBe(''); expect(eco.textContent).toBe('cat=')
  })
  it('link para OUTRA página não é interceptado (navegação normal)', () => { const { c } = abre(); expect(clica(c, 'fora').defaultPrevented).toBe(false); expect(window.location.pathname).toBe('/loja') })
  it('o botão voltar acompanha a URL', () => {
    const { c } = abre(); clica(c, 'luz'); expect(c.querySelector('#eco')!.textContent).toBe('cat=luz')
    window.history.replaceState({ plc: 1 }, '', '/loja'); window.dispatchEvent(new PopStateEvent('popstate'))
    expect(c.querySelector('#eco')!.textContent).toBe('cat=')
  })
  it('uma mudança de estado por ação escreve na URL (sem nova entrada no histórico)', () => {
    const { c } = abre(); const antes = window.history.length
    ;(c.querySelector('#btn') as HTMLElement).click()
    expect(window.location.search).toBe('?o=b'); expect(window.history.length).toBe(antes)
  })
})
