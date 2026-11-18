// @vitest-environment jsdom
import { Registry } from '@polaris/schema'
import { createElement, useState } from 'react'
import { act } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { COMPONENTES_BASE, compilaPrograma, registraBase, renderPaginaHtml, type Componentes, type ErroRuntime } from '../src/index'
import { hidrata, leEstado } from '../src/render/cliente'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const no = (kind: string, id: string, spec: object) => ({ kind, id, versao: '1.0.0', estatuto: 'publicado', spec }) as any
const P = (b: string, extra: object = {}) => ({ bloco: b, ...extra })

function Contador({ inicial }: { inicial: number }) {
  const [n, setN] = useState(inicial)
  return createElement('button', { id: 'btn', onClick: () => setN(n + 1) }, `cliques: ${n}`)
}
const componentes: Componentes = {
  ...COMPONENTES_BASE,
  'x/contador': ({ props }) => createElement(Contador, { inicial: Number(props.inicial ?? 0) }),
  'x/quebra': () => createElement(function Quebra() { throw new Error('falha no cliente') }),
}

const monta = () => {
  const r = new Registry()
  registraBase(r)
  r.registra(no('bloco', 'x.contador', { interface: 'x/contador', props: { type: 'object', properties: { inicial: { type: 'integer' } } } }))
  r.registra(no('bloco', 'x.quebra', { interface: 'x/quebra' }))
  r.registra(no('servico', 'catalogo', { entidades: {}, operacoes: {} }))
  r.registra(no('dados', 'dados.loja', { fonte: { tipo: 'servico', servico: 'catalogo', operacao: 'obter' } }))
  return r
}
const programa = (raiz: object) => {
  const r = monta()
  const res = compilaPrograma(r, r.registra(no('pagina', 'home', { rota: '/', titulo: '{loja.nome}', dados: { loja: 'dados.loja' }, raiz })))
  if (!res.ok) throw new Error(JSON.stringify(res.erros))
  return res.programa
}
const dados = { loja: { nome: 'Padaria Sol' } }
const espera = (ms = 30) => new Promise((r) => setTimeout(r, ms))

function injeta(html: string): Document {
  document.documentElement.innerHTML = html.replace(/^<!doctype html>/i, '').replace(/^<html[^>]*>/, '').replace(/<\/html>$/, '')
  return document
}

describe('hidratação no cliente (jsdom)', () => {
  it('hidrata sem divergência e mantém o DOM do servidor', async () => {
    const pg = programa(P('layout/pilha', { slots: { filhos: [P('texto/titulo', { props: { texto: 'Olá, {loja.nome}!' } }), P('texto/paragrafo', { props: { texto: 'x' } })] } }))
    const s = renderPaginaHtml({ programa: pg, componentes, dados })
    const doc = injeta(s.html)
    const antes = doc.getElementById('polaris')!.innerHTML
    const erro = vi.spyOn(console, 'error').mockImplementation(() => {})
    const recuperaveis: ErroRuntime[] = []
    let raiz!: ReturnType<typeof hidrata>
    await act(async () => { raiz = hidrata(componentes, { onErro: (e) => recuperaveis.push(e) }); await espera() })
    expect(erro).not.toHaveBeenCalled() // React avisa divergência de hidratação via console.error
    expect(recuperaveis).toEqual([])
    expect(doc.getElementById('polaris')!.innerHTML).toBe(antes)
    expect(doc.querySelector('h1')!.textContent).toBe('Olá, Padaria Sol!')
    erro.mockRestore()
    raiz.unmount()
  })

  it('o detector funciona: dado diferente no cliente é reportado como divergência', async () => {
    const pg = programa(P('texto/titulo', { props: { texto: 'Olá, {loja.nome}!' } }))
    injeta(renderPaginaHtml({ programa: pg, componentes, dados }).html)
    const recuperaveis: ErroRuntime[] = []
    const erro = vi.spyOn(console, 'error').mockImplementation(() => {})
    let raiz!: ReturnType<typeof hidrata>
    await act(async () => { raiz = hidrata(componentes, { estado: { programa: pg, dados: { loja: { nome: 'OUTRO' } } }, onErro: (e) => recuperaveis.push(e) }); await espera(60) })
    expect(recuperaveis.length + erro.mock.calls.length).toBeGreaterThan(0)
    erro.mockRestore()
    raiz.unmount()
  })

  it('o estado embutido é lido do documento', () => {
    const pg = programa(P('layout/pilha'))
    const doc = injeta(renderPaginaHtml({ programa: pg, componentes, dados }).html)
    expect(leEstado(doc).dados).toEqual(dados)
    expect(leEstado(doc).programa.pagina.id).toBe('home')
  })

  it('o estado sobrevive ao parser de HTML mesmo com <!--<script> e </script> nos dados', () => {
    const hostil = '<!--<script>x</script></script><script>alert(1)</script>-->\u2028'
    const pg = programa(P('layout/pilha'))
    const doc = injeta(renderPaginaHtml({ programa: pg, componentes, dados: { loja: { nome: hostil } } }).html)
    expect(leEstado(doc).dados).toEqual({ loja: { nome: hostil } })
    expect(doc.querySelectorAll('script')).toHaveLength(1) // só o bloco de estado: nenhum script injetado
  })

  it('componente com estado fica interativo depois da hidratação', async () => {
    const pg = programa(P('layout/pilha', { slots: { filhos: [P('x/contador', { props: { inicial: 5 } })] } }))
    const doc = injeta(renderPaginaHtml({ programa: pg, componentes, dados }).html)
    expect(doc.getElementById('btn')!.textContent).toBe('cliques: 5')
    const erro = vi.spyOn(console, 'error').mockImplementation(() => {})
    let raiz!: ReturnType<typeof hidrata>
    await act(async () => { raiz = hidrata(componentes); await espera() })
    const btn = doc.getElementById('btn')!
    await act(async () => { btn.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    await act(async () => { btn.dispatchEvent(new MouseEvent('click', { bubbles: true })) })
    expect(doc.getElementById('btn')!.textContent).toBe('cliques: 7')
    expect(erro).not.toHaveBeenCalled()
    erro.mockRestore()
    raiz.unmount()
  })

  it('falha de um bloco no cliente é isolada e reportada; o resto da página permanece', async () => {
    const pg = programa(P('layout/pilha', { slots: { filhos: [P('texto/paragrafo', { props: { texto: 'fica' } }), P('x/quebra')] } }))
    // o servidor usa um componente que funciona; o cliente falha ao hidratar/renderizar
    const servidor = { ...componentes, 'x/quebra': () => createElement('i', null, 'ok') }
    const doc = injeta(renderPaginaHtml({ programa: pg, componentes: servidor, dados }).html)
    const erros: ErroRuntime[] = []
    const erro = vi.spyOn(console, 'error').mockImplementation(() => {})
    let raiz!: ReturnType<typeof hidrata>
    await act(async () => { raiz = hidrata(componentes, { onErro: (e) => erros.push(e) }); await espera(60) })
    expect(doc.querySelector('p')!.textContent).toBe('fica')
    expect(erros.some((e) => e.regra === 'render' && /falha no cliente/.test(e.mensagem))).toBe(true)
    erro.mockRestore()
    raiz.unmount()
  })

  it('sem o contêiner ou sem estado, falha com mensagem clara', () => {
    document.body.innerHTML = ''
    expect(() => hidrata(componentes)).toThrow(/#polaris/)
    document.body.innerHTML = '<div id="polaris"></div>'
    expect(() => hidrata(componentes)).toThrow(/__POLARIS__/)
  })
})
