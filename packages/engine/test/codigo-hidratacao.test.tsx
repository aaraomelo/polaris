// @vitest-environment jsdom
import { Registry } from '@polaris/schema'
import { act } from 'react'
import { afterAll, describe, expect, it, vi } from 'vitest'
import { COMPONENTES_BASE, compilaPrograma, registraBase, type ErroRuntime, type Programa, type Sandbox } from '../src/index'
import { hidrataAsync } from '../src/render/cliente'
import { renderPaginaStream, textoDoStream } from '../src/render/stream'
import { criaSandboxLocal } from '../src/sandbox/local'
import { criaSandboxWorker } from '../src/sandbox/worker'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const no = (kind: string, id: string, spec: object) => ({ kind, id, versao: '1.0.0', estatuto: 'publicado', spec }) as any
const P = (b: string, extra: object = {}) => ({ bloco: b, ...extra })
const espera = (ms: number) => new Promise((r) => setTimeout(r, ms))

const RELOGIO = 'function render(props, ctx){ var d = new Date(); return { tag: "p", attrs: { class: "rel" }, children: [ctx.agora, "|", String(Date.now()), "|", String(d.getFullYear()), "|", d.toLocaleString(), "|", Math.random().toFixed(8), "|", ctx.idioma, "|", props.nome] } }'

function programa(): Programa {
  const r = new Registry()
  registraBase(r)
  r.registra(no('bloco', 'x.relogio', { interface: 'x/relogio', props: { type: 'object', properties: { nome: { type: 'string' } } }, codigo: { linguagem: 'js', fonte: RELOGIO } }))
  r.registra(no('bloco', 'x.painel', { interface: 'x/painel', codigo: { linguagem: 'html', fonte: '<h1>{{ props.titulo }}</h1>', altura: 120 }, props: { type: 'object', properties: { titulo: { type: 'string' } } } }))
  r.registra(no('bloco', 'x.app', { interface: 'x/app', props: { type: 'object', properties: { titulo: { type: 'string' } } }, codigo: { linguagem: 'js', modo: 'iframe', fonte: 'polaris.altura(321)' } }))
  const res = compilaPrograma(r, r.registra(no('pagina', 'p', { rota: '/', raiz: P('layout/pilha', { slots: { filhos: [
    P('x/relogio', { props: { nome: 'Sol' } }),
    P('x/painel', { props: { titulo: 'Olá' } }),
    P('x/app', { id: 'app' }),
  ] } }) })))
  if (!res.ok) throw new Error(JSON.stringify(res.erros, null, 1))
  return res.programa
}

const abertos: Sandbox[] = []
afterAll(() => abertos.forEach((s) => s.libera()))

async function servidor(pg: Programa) {
  const w = await criaSandboxWorker(); abertos.push(w)
  const s = await renderPaginaStream(pg, COMPONENTES_BASE, { codigo: { sandbox: w }, provedores: {}, idioma: 'pt-BR' })
  const html = await textoDoStream(s.stream)
  document.documentElement.innerHTML = html.replace(/^<!doctype html>/i, '').replace(/^<html[^>]*>/, '').replace(/<\/html>$/, '')
  return html
}

describe('hidratação com código isolado (servidor: worker, cliente: QuickJS local)', () => {
  it('o cliente reproduz a saída do servidor byte a byte: sem divergência de hidratação', async () => {
    const pg = programa()
    await servidor(pg)
    const antes = document.getElementById('polaris')!.innerHTML
    expect(document.querySelector('.rel')!.textContent).toMatch(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z\|\d+\|2\d{3}\|[\d-]+ [\d:]+\|0\.\d{8}\|pt-BR\|Sol$/)

    const local = await criaSandboxLocal(); abertos.push(local)
    const erro = vi.spyOn(console, 'error').mockImplementation(() => {})
    const erros: ErroRuntime[] = []
    let raiz!: Awaited<ReturnType<typeof hidrataAsync>>
    await act(async () => { raiz = await hidrataAsync(COMPONENTES_BASE, { codigo: { sandbox: local }, onErro: (e) => erros.push(e) }); await espera(80) })
    expect(erro).not.toHaveBeenCalled() // o React avisa divergência de hidratação por console.error
    expect(erros).toEqual([])
    expect(document.getElementById('polaris')!.innerHTML).toBe(antes)
    erro.mockRestore(); raiz.unmount()
  })

  it('CONTROLE: com um "agora" diferente no cliente a hidratação DIVERGE (o teste é capaz de detectar o problema)', async () => {
    const pg = programa()
    await servidor(pg)
    const local = await criaSandboxLocal(); abertos.push(local)
    const erro = vi.spyOn(console, 'error').mockImplementation(() => {})
    const recuperaveis: ErroRuntime[] = []
    let raiz!: Awaited<ReturnType<typeof hidrataAsync>>
    // estado adulterado: o cliente executa o código com outro relógio
    const estado = JSON.parse(document.getElementById('__POLARIS__')!.textContent!)
    estado.agora = '2031-01-01T00:00:00.000Z'
    await act(async () => { raiz = await hidrataAsync(COMPONENTES_BASE, { estado, codigo: { sandbox: local }, onErro: (e) => recuperaveis.push(e) }); await espera(80) })
    expect(erro.mock.calls.length + recuperaveis.length).toBeGreaterThan(0)
    erro.mockRestore(); raiz.unmount()
  })

  it('iframes: o srcdoc do cliente é idêntico ao do servidor (CSP e hash determinísticos)', async () => {
    const pg = programa()
    await servidor(pg)
    const doServidor = [...document.querySelectorAll('iframe')].map((f) => f.getAttribute('srcdoc'))
    expect(doServidor).toHaveLength(2)
    const local = await criaSandboxLocal(); abertos.push(local)
    const erro = vi.spyOn(console, 'error').mockImplementation(() => {})
    let raiz!: Awaited<ReturnType<typeof hidrataAsync>>
    await act(async () => { raiz = await hidrataAsync(COMPONENTES_BASE, { codigo: { sandbox: local } }); await espera(60) })
    expect([...document.querySelectorAll('iframe')].map((f) => f.getAttribute('srcdoc'))).toEqual(doServidor)
    expect(erro).not.toHaveBeenCalled()
    erro.mockRestore(); raiz.unmount()
  })

  it('o iframe do código herda sandbox sem same-origin e sem permissões de feature', async () => {
    await servidor(programa())
    for (const f of document.querySelectorAll('iframe')) {
      expect(f.getAttribute('sandbox') ?? '').not.toMatch(/same-origin|top-navigation|popups|modals|downloads/)
      expect(f.getAttribute('referrerpolicy')).toBe('no-referrer')
      expect(f.getAttribute('allow')).toBe('')
    }
  })

  it('altura pedida pelo código (polaris.altura): só aceita mensagem do PRÓPRIO iframe, valida e limita', async () => {
    const pg = programa()
    await servidor(pg)
    const local = await criaSandboxLocal(); abertos.push(local)
    const erro = vi.spyOn(console, 'error').mockImplementation(() => {})
    let raiz!: Awaited<ReturnType<typeof hidrataAsync>>
    await act(async () => { raiz = await hidrataAsync(COMPONENTES_BASE, { codigo: { sandbox: local } }); await espera(60) })
    const app = [...document.querySelectorAll('iframe')].find((f) => f.getAttribute('sandbox')?.includes('allow-scripts'))!
    const altura = () => (app as HTMLIFrameElement).style.height
    expect(altura()).toBe('240px')
    const manda = (data: unknown, source: Window | null) => act(async () => { window.dispatchEvent(new MessageEvent('message', { data, source })); await espera(5) })
    await manda({ polaris: 'altura', n: 500 }, (app as HTMLIFrameElement).contentWindow)
    expect(altura()).toBe('500px')
    await manda({ polaris: 'altura', n: 99999 }, (app as HTMLIFrameElement).contentWindow)
    expect(altura()).toBe('4000px') // limitado
    await manda({ polaris: 'altura', n: -5 }, (app as HTMLIFrameElement).contentWindow)
    expect(altura()).toBe('1px')
    for (const ruim of [{ polaris: 'altura', n: 'abc' }, { polaris: 'altura', n: NaN }, { polaris: 'outro', n: 300 }, 'texto', null, { n: 300 }]) await manda(ruim, (app as HTMLIFrameElement).contentWindow)
    expect(altura()).toBe('1px') // mensagens malformadas não mudam nada
    await manda({ polaris: 'altura', n: 700 }, window) // outra janela (não é o iframe): ignorada
    await manda({ polaris: 'altura', n: 700 }, null)
    expect(altura()).toBe('1px')
    erro.mockRestore(); raiz.unmount()
  })
})
