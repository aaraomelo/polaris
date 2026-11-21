// @vitest-environment jsdom
import { Registry } from '@polaris/schema'
import { describe, expect, it } from 'vitest'
import { compilaPrograma, montaVivo, registraBase } from '../src/index'

const no = (kind: string, id: string, spec: object) => ({ kind, id, versao: '1.0.0', estatuto: 'publicado', spec }) as any
const P = (b: string, extra: object = {}) => ({ bloco: b, ...extra })
const r = new Registry(); registraBase(r)
const abre = (n: number) => [{ acao: 'definir', estado: 'sel', valor: String(n) }, { acao: 'definir', estado: 'aberto', valor: 'true' }]
const res = compilaPrograma(r, r.registra(no('pagina', 'rep', { rota: '/', estado: { sel: { tipo: 'inteiro', inicial: 1 }, aberto: { tipo: 'booleano', inicial: false } }, raiz: P('layout/pilha', { slots: { filhos: [
  ...[1, 2, 3].map((n) => P('nav/botao', { id: `b${n}`, props: { texto: `conta ${n}` }, eventos: { aoClicar: abre(n) } })),
  P('layout/gaveta', { id: 'g', props: { rotulo: 'Detalhe', aberta: '{estado.aberto}' }, eventos: { aoFechar: [{ acao: 'definir', estado: 'aberto', valor: 'false' }] }, repetir: { cada: 'filtra([1, 2, 3], x => x == estado.sel)', como: 's', chave: '"detalhe"' }, slots: { filhos: [P('texto/paragrafo', { props: { texto: 'conta {s}' } })] } }),
] } }) })))
if (!res.ok) throw new Error(JSON.stringify(res.erros))

describe('gaveta com aberta dentro de repetir', () => {
  it('Esc fecha em TODA abertura, mesmo depois de a seleção mudar', () => {
    const c = document.createElement('div'); document.body.appendChild(c); montaVivo({ programa: res.programa, container: c })
    const click = (el: Element) => el.dispatchEvent(new MouseEvent('click', { bubbles: true })), esc = () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    for (const n of [1, 2, 3, 2, 1, 3]) { click(c.querySelector(`#b${n}`)!); expect(c.querySelector('#g')!.getAttribute('data-estado')).toBe('aberta'); esc(); expect(c.querySelector('#g')!.getAttribute('data-estado')).toBe('fechada') }
  })
})
