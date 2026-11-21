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

describe('ilha de formulário → página (aoEnviado e aoErro)', () => {
  const res = compilaPrograma(r, r.registra(no('pagina', 'form-eventos', { rota: '/f', estado: { nome: { tipo: 'texto', inicial: '' }, falhas: { tipo: 'inteiro', inicial: 0 } }, raiz: P('layout/pilha', { slots: { filhos: [
    P('form/formulario', { id: 'f', props: { formulario: 'contato' }, eventos: { aoEnviado: [{ acao: 'definir', estado: 'nome', valor: 'evento.valores.nome' }], aoErro: [{ acao: 'definir', estado: 'falhas', valor: 'estado.falhas + 1' }] } }),
    P('texto/paragrafo', { id: 'eco', props: { texto: 'nome={estado.nome};falhas={estado.falhas}' } }),
  ] } }) })))
  if (!res.ok) throw new Error(JSON.stringify(res.erros))
  it('o evento que a ilha dispara (sobe até o contêiner) roda as ações da página, com o detalhe em `evento`', () => {
    const c = document.createElement('div'); document.body.appendChild(c)
    montaVivo({ programa: res.programa, container: c, onErro: () => {} })
    const ponto = c.querySelector('#f')!
    ponto.dispatchEvent(new CustomEvent('polaris-enviado', { bubbles: true, detail: { valores: { nome: 'Ana' } } }))
    expect(c.querySelector('#eco')!.textContent).toBe('nome=Ana;falhas=0')
    ponto.dispatchEvent(new CustomEvent('polaris-erro', { bubbles: true, detail: { erros: [] } }))
    expect(c.querySelector('#eco')!.textContent).toBe('nome=Ana;falhas=1')
  })
})

describe('estado persistente que a página só LÊ (nenhuma ação o escreve)', () => {
  beforeEach(() => { localStorage.clear(); document.body.innerHTML = '' })
  it('o valor guardado aparece mesmo assim (no modo fechado o runtime só aceitaria o que alguma ação escreve)', () => {
    localStorage.setItem('polaris:estado:itens', '[1,1,1]')
    const res = compilaPrograma(r, r.registra(no('pagina', 'so-le', { rota: '/l', estado: { itens: { tipo: 'json', lista: true, inicial: [], persiste: true } }, raiz: P('texto/paragrafo', { id: 'n', props: { texto: 'n={tamanho(estado.itens)}' } }) })))
    if (!res.ok) throw new Error(JSON.stringify(res.erros))
    const c = document.createElement('div'); document.body.appendChild(c)
    montaVivo({ programa: res.programa, container: c, hidrata: true, fechado: true, onErro: () => {} })
    expect(c.querySelector('#n')!.textContent).toBe('n=3')
  })
})
