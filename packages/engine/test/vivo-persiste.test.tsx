// @vitest-environment jsdom
import { Registry } from '@polaris/schema'
import { beforeEach, describe, expect, it } from 'vitest'
import { compilaPrograma, montaVivo, registraBase } from '../src/index'

const no = (kind: string, id: string, spec: object) => ({ kind, id, versao: '1.0.0', estatuto: 'publicado', spec }) as any
const P = (b: string, extra: object = {}) => ({ bloco: b, ...extra })
const r = new Registry(); registraBase(r)
const compila = (persiste: boolean) => {
  const res = compilaPrograma(r, r.registra(no('pagina', `p${persiste ? 1 : 0}`, { rota: '/', estado: { itens: { tipo: 'json', lista: true, inicial: [], ...(persiste ? { persiste: true } : {}) } }, raiz: P('layout/pilha', { slots: { filhos: [
    P('texto/paragrafo', { id: 'n', props: { texto: 'n={tamanho(estado.itens)}' } }),
    P('nav/botao', { id: 'add', props: { texto: '+' }, eventos: { aoClicar: [{ acao: 'definir', estado: 'itens', valor: 'concat(estado.itens, [1])' }] } }),
  ] } }) })))
  if (!res.ok) throw new Error(JSON.stringify(res.erros))
  return res.programa
}
const PROGRAMAS = { sim: compila(true), nao: compila(false) }
const programa = (persiste: boolean) => (persiste ? PROGRAMAS.sim : PROGRAMAS.nao)
const abre = (persiste: boolean) => { const c = document.createElement('div'); document.body.appendChild(c); const v = montaVivo({ programa: programa(persiste), container: c, hidrata: true, onErro: () => {} }); return { c, v } }
const clica = (c: HTMLElement) => (c.querySelector('#add') as HTMLElement).click()
const chave = 'polaris:estado:itens'

describe('estado que persiste no navegador', () => {
  beforeEach(() => { localStorage.clear(); document.body.innerHTML = '' })

  it('grava a cada mudança e devolve o valor numa página nova (mesmo nome = mesma chave)', () => {
    const a = abre(true)
    clica(a.c); clica(a.c)
    expect(localStorage.getItem(chave)).toBe('[1,1]')
    a.v.destroi()
    const b = abre(true)
    expect(b.c.querySelector('#n')!.textContent).toBe('n=2')
    clica(b.c)
    expect(localStorage.getItem(chave)).toBe('[1,1,1]')
  })

  it('valor guardado de tipo errado ou corrompido é ignorado: vale o inicial', () => {
    localStorage.setItem(chave, '{"nao":"lista"}')
    expect(abre(true).c.querySelector('#n')!.textContent).toBe('n=0')
    localStorage.setItem(chave, '{quebrado')
    expect(abre(true).c.querySelector('#n')!.textContent).toBe('n=0')
  })

  it('sem `persiste` nada é lido nem gravado', () => {
    localStorage.setItem(chave, '[1,1,1]')
    const a = abre(false)
    expect(a.c.querySelector('#n')!.textContent).toBe('n=0')
    clica(a.c)
    expect(localStorage.getItem(chave)).toBe('[1,1,1]')
  })
})
