// @vitest-environment jsdom
import { Registry } from '@polaris/schema'
import { describe, expect, it } from 'vitest'
import { compilaPrograma, montaVivo, registraBase } from '../src/index'

const no = (kind: string, id: string, spec: object) => ({ kind, id, versao: '1.0.0', estatuto: 'publicado', spec }) as any
const P = (b: string, extra: object = {}) => ({ bloco: b, ...extra })
const r = new Registry(); registraBase(r)
const bolha = (n: number) => P('grafico/circulo', { props: { cx: n * 20, cy: 10, r: 6, rotulo: `Conta ${n}`, selecionado: '{estado.sel == ' + n + '}' }, eventos: { aoClicar: [{ acao: 'definir', estado: 'sel', valor: String(n) }] } })
const res = compilaPrograma(r, r.registra(no('pagina', 'svg', { rota: '/', estado: { sel: { tipo: 'inteiro', inicial: 0 } }, raiz: P('layout/pilha', { slots: { filhos: [
  P('grafico/svg', { id: 'g', props: { largura: 100, altura: 20, rotulo: 'Contas' }, slots: { filhos: [bolha(1), bolha(2), bolha(3), P('grafico/rotulo', { props: { x: 1, y: 2, texto: 'eixo' } })] } }),
  P('texto/paragrafo', { id: 'eco', props: { texto: 'sel={estado.sel}' } }),
] } }) })))
if (!res.ok) throw new Error(JSON.stringify(res.erros))

describe('gráficos SVG no runtime vivo', () => {
  it('as formas nascem no namespace SVG; clique, Enter/espaço e setas funcionam nas formas com rótulo', () => {
    const c = document.createElement('div'); document.body.appendChild(c)
    montaVivo({ programa: res.programa, container: c })
    const svg = c.querySelector('#g')!, bolhas = [...svg.querySelectorAll('circle')]
    expect(svg.namespaceURI).toBe('http://www.w3.org/2000/svg'); expect(bolhas).toHaveLength(3); expect(bolhas.every((b) => b.namespaceURI === 'http://www.w3.org/2000/svg')).toBe(true)
    expect(svg.querySelector('text')!.namespaceURI).toBe('http://www.w3.org/2000/svg'); expect(svg.getAttribute('viewBox')).toBe('0 0 100 20'); expect(bolhas[0]!.getAttribute('role')).toBe('button'); expect(bolhas[0]!.getAttribute('tabindex')).toBe('0')
    bolhas[0]!.dispatchEvent(new MouseEvent('click', { bubbles: true })); expect(c.querySelector('#eco')!.textContent).toBe('sel=1'); expect(bolhas[0]!.getAttribute('aria-pressed')).toBe('true')
    bolhas[1]!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); expect(c.querySelector('#eco')!.textContent).toBe('sel=2')
    bolhas[2]!.dispatchEvent(new KeyboardEvent('keydown', { key: ' ', bubbles: true })); expect(c.querySelector('#eco')!.textContent).toBe('sel=3')
    bolhas[0]!.focus(); bolhas[0]!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })); expect(document.activeElement).toBe(bolhas[1])
    bolhas[1]!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true })); expect(document.activeElement).toBe(bolhas[0])
  })
})
