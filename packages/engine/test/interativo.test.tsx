// @vitest-environment jsdom
import { Registry } from '@polaris/schema'
import { act } from 'react'
import { describe, expect, it, vi } from 'vitest'
import {
  COMPONENTES_BASE, CacheDados, compilaPrograma, criaCarregador, registraBase, renderPaginaCompleta, type ErroRuntime, type PedidoServico, type Programa,
} from '../src/index'
import { hidrata } from '../src/render/cliente'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const no = (kind: string, id: string, spec: object) => ({ kind, id, versao: '1.0.0', estatuto: 'publicado', spec }) as any
const P = (b: string, extra: object = {}) => ({ bloco: b, ...extra })
const espera = (ms = 10) => new Promise((r) => setTimeout(r, ms))

function programa(): Programa {
  const r = new Registry()
  registraBase(r)
  r.registra(no('servico', 'catalogo', { entidades: {}, operacoes: {} }))
  r.registra(no('dados', 'd.prod', { fonte: { tipo: 'servico', servico: 'catalogo', operacao: 'listar' }, parametros: { q: { tipo: 'texto' } } }))
  const res = compilaPrograma(r, r.registra(no('pagina', 'busca', {
    rota: '/busca', titulo: 'Busca: {estado.termo}',
    estado: { termo: { tipo: 'texto', inicial: '' }, msg: { tipo: 'texto', inicial: '' }, destino: { tipo: 'texto', inicial: '/ok' } },
    dados: { prods: { dados: 'd.prod', args: { q: '{estado.termo}' } } },
    raiz: P('layout/pilha', { slots: { filhos: [
      P('entrada/texto', { id: 'campo', props: { valor: '{estado.termo}' }, eventos: { aoMudar: [{ acao: 'definir', estado: 'termo', valor: 'evento' }] } }),
      P('nav/botao', { id: 'buscar', props: { texto: 'Buscar' }, eventos: { aoClicar: [{ acao: 'executar', dados: 'prods',
        depois: [{ acao: 'definir', estado: 'msg', valor: "'achou ' + resultado.length" }],
        emErro: [{ acao: 'definir', estado: 'msg', valor: "'erro: ' + erro" }] }] } }),
      P('entrada/texto', { id: 'destino', props: { valor: '{estado.destino}' }, eventos: { aoMudar: [{ acao: 'definir', estado: 'destino', valor: 'evento' }] } }),
      P('nav/botao', { id: 'ir', props: { texto: 'Ir' }, eventos: { aoClicar: [{ acao: 'navegar', para: '{estado.destino}' }] } }),
      P('texto/paragrafo', { id: 'status', props: { texto: '{status.prods}' } }),
      P('texto/paragrafo', { id: 'msg', props: { texto: '{estado.msg}' } }),
      P('texto/paragrafo', { id: 'item', repetir: { cada: 'prods', como: 'p' }, props: { texto: '{p.nome}' } }),
    ] } }),
  })))
  if (!res.ok) throw new Error(JSON.stringify(res.erros, null, 1))
  return res.programa
}

type Cenario = { prov: (p: PedidoServico) => Promise<unknown>; onErro?: (e: ErroRuntime) => void; navegar?: (u: string) => void }
async function monta({ prov, onErro, navegar }: Cenario) {
  const pg = programa()
  const s = await renderPaginaCompleta(pg, COMPONENTES_BASE, { provedores: { servico: async (p) => (p.args.q === '' || p.args.q === undefined ? [{ nome: 'inicial' }] : prov(p)) }, tenant: { id: 't1' } })
  document.documentElement.innerHTML = s.html.replace(/^<!doctype html>/i, '').replace(/^<html[^>]*>/, '').replace(/<\/html>$/, '')
  const carregador = criaCarregador(pg, { provedores: { servico: prov }, tenant: { id: 't1' }, onErro: () => {} })
  const erro = vi.spyOn(console, 'error').mockImplementation(() => {})
  let raiz!: ReturnType<typeof hidrata>
  await act(async () => { raiz = hidrata(COMPONENTES_BASE, { carregador, ...(navegar ? { navegar } : {}), ...(onErro ? { onErro } : {}) }); await espera() })
  const q = (id: string) => document.getElementById(id)!
  const textos = () => [...document.querySelectorAll('#polaris p')].map((p) => `${p.id || 'item'}=${p.textContent}`)
  return { s, pg, erro, raiz, q, textos }
}
const digita = async (el: HTMLInputElement, v: string) => {
  const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
  await act(async () => { set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })) })
}
const clica = (el: Element) => act(async () => { el.dispatchEvent(new MouseEvent('click', { bubbles: true })); await espera() })

describe('SSR com dados carregados', () => {
  it('renderPaginaCompleta carrega as fontes e a página já sai com o conteúdo', async () => {
    const s = await renderPaginaCompleta(programa(), COMPONENTES_BASE, { provedores: { servico: async () => [{ nome: 'pão' }, { nome: 'bolo' }] } })
    expect(s.corpo).toContain('<p id="item">pão</p>')
    expect(s.corpo).toContain('<p id="item">bolo</p>')
    expect(s.resultado.status).toEqual({ prods: 'ok' })
    expect(s.estado.status).toEqual({ prods: 'ok' })
  })

  it('fonte com falha: a página sai mesmo assim, com status erro e SEM vazar o detalhe', async () => {
    const onErro = vi.fn()
    const s = await renderPaginaCompleta(programa(), COMPONENTES_BASE, { provedores: { servico: async () => { throw new Error('senha=hunter2 em db-interno') } }, onErro })
    expect(s.corpo).toContain('<p id="status">erro</p>')
    expect(s.html).not.toMatch(/hunter2|db-interno/)
    expect(s.estado.erros).toEqual({ prods: 'falha ao carregar os dados' })
    expect(onErro).toHaveBeenCalled()
  })
})

describe('interação no cliente: estado, dados e efeitos', () => {
  it('digitar atualiza o estado (campo controlado) e o título; buscar executa a fonte e atualiza a lista', async () => {
    const chamadas: PedidoServico[] = []
    const t = await monta({ prov: async (p) => { chamadas.push(p); return [{ nome: 'pão francês' }, { nome: 'pão de queijo' }] } })
    expect(t.textos()).toContain('item=inicial')
    await digita(t.q('campo') as HTMLInputElement, 'pão')
    expect((t.q('campo') as HTMLInputElement).value).toBe('pão')
    expect(document.title).toBe('Busca: pão')
    await clica(t.q('buscar'))
    expect(chamadas).toHaveLength(1)
    expect(chamadas[0]!.args).toEqual({ q: 'pão' }) // o estado vivo, não o inicial
    expect(chamadas[0]!.tenant).toEqual({ id: 't1' })
    expect(t.textos()).toEqual(expect.arrayContaining(['status=ok', 'msg=achou 2', 'item=pão francês', 'item=pão de queijo']))
    expect(t.textos()).not.toContain('item=inicial')
    expect(t.erro).not.toHaveBeenCalled()
    t.raiz.unmount()
  })

  it('status "carregando" aparece enquanto a chamada está em voo', async () => {
    let libera!: (v: unknown) => void
    const t = await monta({ prov: () => new Promise((r) => { libera = r }) })
    await digita(t.q('campo') as HTMLInputElement, 'x')
    await clica(t.q('buscar'))
    expect(t.textos()).toContain('status=carregando')
    await act(async () => { libera([{ nome: 'ok' }]); await espera() })
    expect(t.textos()).toContain('status=ok')
    t.raiz.unmount()
  })

  it('resposta antiga é descartada: vale a última chamada, mesmo que a primeira termine depois', async () => {
    const liberacoes: Record<string, (v: unknown) => void> = {}
    const t = await monta({ prov: (p) => new Promise((r) => { liberacoes[String(p.args.q)] = r }) })
    await digita(t.q('campo') as HTMLInputElement, 'a'); await clica(t.q('buscar'))
    await digita(t.q('campo') as HTMLInputElement, 'ab'); await clica(t.q('buscar'))
    await act(async () => { liberacoes.ab!([{ nome: 'resposta-nova' }]); await espera() })
    await act(async () => { liberacoes.a!([{ nome: 'resposta-velha' }]); await espera() })
    expect(t.textos()).toContain('item=resposta-nova')
    expect(t.textos()).not.toContain('item=resposta-velha')
    expect(t.textos()).toContain('status=ok')
    t.raiz.unmount()
  })

  it('falha executa emErro com `erro` e marca o status; a lista anterior permanece', async () => {
    const t = await monta({ prov: async () => { throw new Error('quebrou') } })
    await digita(t.q('campo') as HTMLInputElement, 'x'); await clica(t.q('buscar'))
    expect(t.textos()).toEqual(expect.arrayContaining(['status=erro', 'msg=erro: falha ao carregar os dados', 'item=inicial']))
    t.raiz.unmount()
  })

  it('navegar usa a URL do estado; URL insegura é bloqueada e reportada', async () => {
    const navegar = vi.fn()
    const erros: ErroRuntime[] = []
    const t = await monta({ prov: async () => [], navegar, onErro: (e) => erros.push(e) })
    await clica(t.q('ir'))
    expect(navegar).toHaveBeenCalledTimes(1)
    expect(navegar).toHaveBeenLastCalledWith('/ok')
    for (const ruim of ['javascript:alert(1)', 'java\nscript:alert(1)', 'data:text/html,<script>x</script>', '']) {
      await digita(t.q('destino') as HTMLInputElement, ruim)
      await clica(t.q('ir'))
    }
    expect(navegar).toHaveBeenCalledTimes(1) // nenhuma das inseguras chegou a navegar
    expect(erros.filter((e) => e.regra === 'navegacao')).toHaveLength(4)
    await digita(t.q('destino') as HTMLInputElement, 'https://exemplo.com/x')
    await clica(t.q('ir'))
    expect(navegar).toHaveBeenLastCalledWith('https://exemplo.com/x')
    t.raiz.unmount()
  })

  it('desmontar com uma chamada pendente não atualiza nada nem gera aviso do React', async () => {
    let libera!: (v: unknown) => void
    const t = await monta({ prov: () => new Promise((r) => { libera = r }) })
    await digita(t.q('campo') as HTMLInputElement, 'x'); await clica(t.q('buscar'))
    await act(async () => { t.raiz.unmount() })
    await act(async () => { libera([{ nome: 'tarde' }]); await espera() })
    expect(t.erro).not.toHaveBeenCalled()
  })

  it('sem carregador configurado, executar falha de forma controlada', async () => {
    const pg = programa()
    const s = await renderPaginaCompleta(pg, COMPONENTES_BASE, { provedores: { servico: async () => [] } })
    document.documentElement.innerHTML = s.html.replace(/^<!doctype html>/i, '').replace(/^<html[^>]*>/, '').replace(/<\/html>$/, '')
    const erros: ErroRuntime[] = []
    const erro = vi.spyOn(console, 'error').mockImplementation(() => {})
    let raiz!: ReturnType<typeof hidrata>
    await act(async () => { raiz = hidrata(COMPONENTES_BASE, { onErro: (e) => erros.push(e) }); await espera() })
    await clica(document.getElementById('buscar')!)
    expect(erros.some((e) => e.regra === 'dados')).toBe(true)
    expect([...document.querySelectorAll('#polaris p')].map((p) => p.textContent)).toContain('erro: chamada indisponível')
    erro.mockRestore(); raiz.unmount()
  })

  it('hidratação com status/estado vindos do servidor não diverge', async () => {
    const t = await monta({ prov: async () => [] })
    expect(t.erro).not.toHaveBeenCalled()
    expect(t.textos()).toContain('status=ok')
    t.raiz.unmount()
  })
})

describe('cache + tenant no carregador do cliente', () => {
  it('criaCarregador reaproveita o cache e respeita o timeout da fonte', async () => {
    const r = new Registry()
    registraBase(r)
    r.registra(no('servico', 'catalogo', { entidades: {}, operacoes: {} }))
    r.registra(no('dados', 'd.c', { fonte: { tipo: 'servico', servico: 'catalogo', operacao: 'x' }, cache: { ttlSegundos: 30 }, timeoutMs: 20 }))
    const res = compilaPrograma(r, r.registra(no('pagina', 'pc', { rota: '/', dados: { c: { dados: 'd.c' } }, raiz: P('layout/pilha') })))
    if (!res.ok) throw new Error('x')
    const prov = vi.fn(async () => 'v')
    const c = criaCarregador(res.programa, { provedores: { servico: prov }, cache: new CacheDados(), tenant: { id: 't' } })
    await c({ dados: 'c', args: {}, estado: {} }); await c({ dados: 'c', args: {}, estado: {} })
    expect(prov).toHaveBeenCalledTimes(1)
    const lento = criaCarregador(res.programa, { provedores: { servico: () => new Promise(() => {}) }, tenant: { id: 't' } })
    await expect(lento({ dados: 'c', args: {}, estado: {} })).rejects.toThrow(/tempo esgotado \(20 ms\)/)
  })
})
