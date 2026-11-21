// @vitest-environment jsdom
import { Registry } from '@polaris/schema'
import { describe, expect, it } from 'vitest'
import { compilaPrograma, montaVivo, registraBase } from '../src/index'

const no = (kind: string, id: string, spec: object) => ({ kind, id, versao: '1.0.0', estatuto: 'publicado', spec }) as any
const P = (b: string, extra: object = {}) => ({ bloco: b, ...extra })
const r = new Registry(); registraBase(r)
const opcao = (valor: string, texto: string) => P('entrada/opcao', { props: { valor, texto, selecionada: `{estado.ordem == "${valor}"}` } })
const res = compilaPrograma(r, r.registra(no('pagina', 'selecao', { rota: '/', estado: { ordem: { tipo: 'texto', inicial: 'destaque' } }, raiz: P('layout/pilha', { slots: { filhos: [
  P('entrada/selecao', { id: 'ordem', props: { rotulo: 'Ordenar por', valor: '{estado.ordem}' }, eventos: { aoMudar: [{ acao: 'definir', estado: 'ordem', valor: 'evento' }] }, slots: { filhos: [opcao('destaque', 'Destaques'), opcao('preco', 'Menor preço'), opcao('nome', 'A–Z')] } }),
  P('texto/paragrafo', { id: 'eco', props: { texto: 'ordem={estado.ordem}' } }),
] } }) })))
if (!res.ok) throw new Error(JSON.stringify(res.erros))

describe('entrada/selecao no runtime vivo', () => {
  it('a opção do estado vem escolhida; escolher outra atualiza o estado; o estado muda o seletor', () => {
    const c = document.createElement('div'); document.body.appendChild(c)
    const v = montaVivo({ programa: res.programa, container: c })
    const sel = c.querySelector('#ordem') as HTMLSelectElement
    expect(sel.value).toBe('destaque'); expect(c.querySelector('#eco')!.textContent).toBe('ordem=destaque')
    sel.value = 'preco'; sel.dispatchEvent(new Event('change', { bubbles: true }))
    expect(c.querySelector('#eco')!.textContent).toBe('ordem=preco'); expect(sel.value).toBe('preco')
    v.despacha({ t: 'estado', nome: 'ordem', valor: 'nome' }); v.flush()
    expect(sel.value).toBe('nome'); expect([...sel.options].filter((o) => o.hasAttribute('selected')).map((o) => o.value)).toEqual(['nome'])
  })
})
