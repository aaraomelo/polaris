// @vitest-environment jsdom
import { Registry } from '@polaris/schema'
import { describe, expect, it } from 'vitest'
import { compilaPrograma, montaVivo, registraBase } from '../src/index'

const no = (kind: string, id: string, spec: object) => ({ kind, id, versao: '1.0.0', estatuto: 'publicado', spec }) as any
const P = (b: string, extra: object = {}) => ({ bloco: b, ...extra })
const r = new Registry(); registraBase(r)
const res = compilaPrograma(r, r.registra(no('pagina', 'entrada', { rota: '/', estado: { q: { tipo: 'texto', inicial: '' }, bloq: { tipo: 'booleano', inicial: false } }, raiz: P('layout/pilha', { slots: { filhos: [
  P('entrada/texto', { id: 'campo', props: { valor: '{estado.q}', desabilitado: '{estado.bloq}', placeholder: 'busca' }, eventos: { aoMudar: [{ acao: 'definir', estado: 'q', valor: 'evento' }] } }),
  P('texto/paragrafo', { id: 'eco', props: { texto: 'q={estado.q}' } }),
  P('nav/botao', { id: 'trava', props: { texto: 't' }, eventos: { aoClicar: [{ acao: 'definir', estado: 'bloq', valor: '!estado.bloq' }] } }),
  P('nav/botao', { id: 'limpa', props: { texto: 'l' }, eventos: { aoClicar: [{ acao: 'definir', estado: 'q', valor: '""' }] } }),
] } }) })))
if (!res.ok) throw new Error(JSON.stringify(res.erros))

function monta() {
  const c = document.createElement('div'); document.body.appendChild(c)
  montaVivo({ programa: res.programa, container: c })
  const campo = c.querySelector('#campo') as HTMLInputElement
  let escritas = 0
  const desc = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!
  Object.defineProperty(campo, 'value', { get() { return desc.get!.call(this) }, set(v) { escritas++; desc.set!.call(this, v) }, configurable: true })
  return { c, campo, escritas: () => escritas }
}
const digita = (el: HTMLInputElement, v: string, extra: object = {}) => { el.value = v; el.dispatchEvent(new InputEvent('input', { bubbles: true, ...extra })) }

describe('campo de texto: IME, foco, seleção, desabilitado', () => {
  it('composição (IME): cada input atualiza o estado, mas o runtime NUNCA reescreve o valor que o usuário acabou de digitar (não quebra a composição nem o cursor)', () => {
    const { c, campo, escritas } = monta()
    campo.focus()
    campo.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }))
    const base = escritas() // as escritas feitas por nós no teste (digita) são contadas à parte
    for (const v of ['n', 'ni', 'に', 'にほ', 'にほん']) { digita(campo, v, { isComposing: true }); campo.setSelectionRange(v.length, v.length) }
    campo.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true, data: 'にほん' }))
    expect(c.querySelector('#eco')!.textContent).toBe('q=にほん')
    expect(campo.value).toBe('にほん')
    expect(escritas() - base).toBe(5) // só as 5 do próprio teste: o runtime não escreveu nenhuma
    expect(document.activeElement).toBe(campo)
    expect(campo.selectionStart).toBe(3)
  })
  it('o estado muda por outro caminho → o campo reflete; e escrever o MESMO valor não mexe no campo (cursor preservado)', () => {
    const { c, campo, escritas } = monta()
    digita(campo, 'abc'); campo.setSelectionRange(1, 1)
    const e0 = escritas()
    ;(c.querySelector('#trava') as HTMLElement).click(); (c.querySelector('#trava') as HTMLElement).click() // muda outra coisa
    expect(escritas()).toBe(e0); expect(campo.selectionStart).toBe(1)
    ;(c.querySelector('#limpa') as HTMLElement).click()
    expect(campo.value).toBe('')
    expect(c.querySelector('#eco')!.textContent).toBe('q=')
  })
  it('desabilitado vem do estado e aparece/some como atributo; o placeholder fica', () => {
    const { c, campo } = monta()
    expect(campo.disabled).toBe(false)
    ;(c.querySelector('#trava') as HTMLElement).click(); expect(campo.disabled).toBe(true)
    ;(c.querySelector('#trava') as HTMLElement).click(); expect(campo.disabled).toBe(false)
    expect(campo.getAttribute('placeholder')).toBe('busca'); expect(campo.getAttribute('type')).toBe('text')
  })
  it('colar texto longo e emoji (UTF-16 par substituto) chegam inteiros ao estado', () => {
    const { c, campo } = monta()
    const s = 'a😀b'.repeat(500)
    digita(campo, s)
    expect(c.querySelector('#eco')!.textContent).toBe(`q=${s}`)
  })
})
