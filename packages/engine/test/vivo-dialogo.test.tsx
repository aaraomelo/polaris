// @vitest-environment jsdom
import { Registry } from '@polaris/schema'
import { describe, expect, it } from 'vitest'
import { compilaPrograma, montaVivo, registraBase } from '../src/index'

const no = (kind: string, id: string, spec: object) => ({ kind, id, versao: '1.0.0', estatuto: 'publicado', spec }) as any
const P = (b: string, extra: object = {}) => ({ bloco: b, ...extra })
const r = new Registry(); registraBase(r)
const fecha = [{ acao: 'definir', estado: 'aberto', valor: '""' }]
const abre = (v: string) => [{ acao: 'definir', estado: 'aberto', valor: `"${v}"` }]
const res = compilaPrograma(r, r.registra(no('pagina', 'dialogo', { rota: '/', estado: { aberto: { tipo: 'texto', inicial: '' }, fixa: { tipo: 'booleano', inicial: false } }, raiz: P('layout/pilha', { slots: { filhos: [
  P('nav/botao', { id: 'abre-g', props: { texto: 'detalhe' }, eventos: { aoClicar: abre('gaveta') } }),
  P('nav/botao', { id: 'abre-m', props: { texto: 'confirmar' }, eventos: { aoClicar: abre('modal') } }),
  P('tabela/tabela', { slots: { filhos: [P('tabela/corpo', { slots: { filhos: [P('tabela/linha', { id: 'linha', props: { clicavel: true }, eventos: { aoClicar: abre('gaveta') }, slots: { filhos: [P('tabela/celula', { props: { texto: 'Conta A' } })] } })] } })] } }),
  P('nav/botao', { id: 'fixa-abre', props: { texto: 'fixa' }, eventos: { aoClicar: [{ acao: 'definir', estado: 'fixa', valor: 'true' }] } }),
  P('layout/gaveta', { id: 'fixa', props: { rotulo: 'Fixa', aberta: '{estado.fixa}' }, eventos: { aoFechar: [{ acao: 'definir', estado: 'fixa', valor: 'false' }] }, slots: { filhos: [P('texto/paragrafo', { props: { texto: 'sempre montada' } })] } }),
  P('layout/gaveta', { id: 'gaveta', se: 'estado.aberto == "gaveta"', props: { rotulo: 'Detalhe' }, eventos: { aoFechar: fecha }, slots: { filhos: [P('texto/paragrafo', { props: { texto: 'conteúdo' } })] } }),
  P('layout/modal', { id: 'modal', se: 'estado.aberto == "modal"', props: { rotulo: 'Confirmar', largura: 24 }, eventos: { aoFechar: fecha }, slots: { filhos: [P('texto/paragrafo', { props: { texto: 'certeza?' } })] } }),
] } }) })))
if (!res.ok) throw new Error(JSON.stringify(res.erros))

describe('gaveta e modal no runtime vivo', () => {
  it('abrem pela página, fecham com Esc e com o clique fora (não com o clique dentro) e a linha clicável abre a gaveta', () => {
    const c = document.createElement('div'); document.body.appendChild(c)
    const v = montaVivo({ programa: res.programa, container: c })
    const click = (el: Element) => el.dispatchEvent(new MouseEvent('click', { bubbles: true })), esc = () => document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }))
    expect(c.querySelector('#gaveta')).toBeNull(); expect(c.querySelector('#linha')!.hasAttribute('data-clicavel')).toBe(true)
    click(c.querySelector('#abre-g')!); expect(c.querySelector('#gaveta')!.getAttribute('role')).toBe('dialog')
    click(c.querySelector('#gaveta p')!); expect(c.querySelector('#gaveta')).not.toBeNull() // dentro: continua aberta
    esc(); expect(c.querySelector('#gaveta')).toBeNull()
    click(c.querySelector('#abre-m')!); const m = c.querySelector('#modal')!; expect(m.getAttribute('aria-modal')).toBe('true'); expect(m.getAttribute('style')).toContain('--modal-largura:24rem')
    click(c.querySelector('#abre-g')!) // clicar fora (no outro botão) fecha o modal e abre a gaveta
    expect(c.querySelector('#modal')).toBeNull(); expect(c.querySelector('#gaveta')).not.toBeNull()
    click(c.querySelector('h1,p,#abre-m')!); expect(c.querySelector('#gaveta')).toBeNull() // fora fecha
    click(c.querySelector('#linha')!); expect(c.querySelector('#gaveta')).not.toBeNull() // a linha inteira abre
    // com `aberta` o painel fica montado e só troca data-estado (o CSS anima); Esc e fora só valem para o que está aberto
    esc(); click(c.querySelector('#fixa-abre')!); expect(c.querySelector('#fixa')!.getAttribute('data-estado')).toBe('aberta'); expect(c.querySelector('#fixa')!.hasAttribute('aria-hidden')).toBe(false)
    esc(); expect(c.querySelector('#fixa')!.getAttribute('data-estado')).toBe('fechada'); expect(c.querySelector('#fixa')!.getAttribute('aria-hidden')).toBe('true'); expect(c.querySelector('#fixa p')).not.toBeNull()
    v.destroi(); esc()
  })
})
