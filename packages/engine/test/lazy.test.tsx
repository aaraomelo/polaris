import { Registry } from '@polaris/schema'
import { createElement } from 'react'
import { describe, expect, it, vi } from 'vitest'
import {
  COMPONENTES_BASE, blocosUsados, chunksParaPreload, compilaPrograma, ehLazy, lazyBloco, preCarregaBlocos, registraBase, renderPaginaHtml,
  type Componentes, type ErroRuntime, type PropsComponente,
} from '../src/index'

const no = (kind: string, id: string, spec: object) => ({ kind, id, versao: '1.0.0', estatuto: 'publicado', spec }) as any
const P = (b: string, extra: object = {}) => ({ bloco: b, ...extra })

const monta = (raiz: object) => {
  const r = new Registry()
  registraBase(r)
  r.registra(no('bloco', 'x.grafico', { interface: 'x/grafico', props: { type: 'object', properties: { titulo: { type: 'string' } } } }))
  r.registra(no('bloco', 'x.mapa', { interface: 'x/mapa' }))
  r.registra(no('bloco', 'x.cartao', { interface: 'x/cartao', modelo: P('x/grafico', { props: { titulo: '{props.t}' } }) }))
  r.registra(no('bloco', 'x.estende-grafico', { interface: 'x/estende-grafico', extends: 'x/grafico' }))
  const res = compilaPrograma(r, r.registra(no('pagina', 'p', { rota: '/', raiz })))
  if (!res.ok) throw new Error(JSON.stringify(res.erros, null, 1))
  return res.programa
}
const grafico = ({ props }: PropsComponente) => createElement('figure', null, `gráfico:${String(props.titulo ?? '')}`)
const mapa = () => createElement('div', null, 'mapa')

describe('code splitting por bloco', () => {
  it('lazyBloco cria uma entrada reconhecível; função comum não é lazy', () => {
    expect(ehLazy(lazyBloco(async () => grafico))).toBe(true)
    expect(ehLazy(grafico)).toBe(false)
    expect(lazyBloco(async () => grafico, { chunk: '/c/g.js' }).chunk).toBe('/c/g.js')
  })

  it('só os blocos USADOS pela página são carregados', async () => {
    const pg = monta(P('layout/pilha', { slots: { filhos: [P('x/grafico', { props: { titulo: 'a' } })] } }))
    const carregaGrafico = vi.fn(async () => ({ default: grafico }))
    const carregaMapa = vi.fn(async () => ({ default: mapa }))
    const comps: Componentes = { ...COMPONENTES_BASE, 'x/grafico': lazyBloco(carregaGrafico), 'x/mapa': lazyBloco(carregaMapa) }
    const r = await preCarregaBlocos(pg, comps)
    expect(r.carregados).toEqual(['x/grafico'])
    expect(carregaGrafico).toHaveBeenCalledTimes(1)
    expect(carregaMapa).not.toHaveBeenCalled() // o mapa está registrado mas nenhuma página o usa
  })

  it('depois da pré-carga o bloco renderiza de forma síncrona e idêntica a um bloco comum', async () => {
    const pg = monta(P('layout/pilha', { slots: { filhos: [P('x/grafico', { props: { titulo: 'vendas' } })] } }))
    const lazyComps: Componentes = { ...COMPONENTES_BASE, 'x/grafico': lazyBloco(async () => ({ default: grafico })) }
    const comuns: Componentes = { ...COMPONENTES_BASE, 'x/grafico': grafico }
    await preCarregaBlocos(pg, lazyComps)
    const a = renderPaginaHtml({ programa: pg, componentes: lazyComps }).corpo
    const b = renderPaginaHtml({ programa: pg, componentes: comuns }).corpo
    expect(a).toBe(b)
    expect(a).toContain('gráfico:vendas')
  })

  it('aceita módulo com export default ou a própria função; pré-carregar duas vezes só importa uma', async () => {
    const pg = monta(P('x/grafico', { props: { titulo: 't' } }))
    const direto = vi.fn(async () => grafico)
    const comps: Componentes = { ...COMPONENTES_BASE, 'x/grafico': lazyBloco(direto) }
    await preCarregaBlocos(pg, comps); await preCarregaBlocos(pg, comps)
    expect(direto).toHaveBeenCalledTimes(1)
    expect(renderPaginaHtml({ programa: pg, componentes: comps }).corpo).toContain('gráfico:t')
  })

  it('enxerga blocos usados só DENTRO do modelo de um bloco composto', async () => {
    const pg = monta(P('x/cartao', { props: { t: 'dentro' } })) // a página só usa o cartão; o gráfico está no modelo dele
    const comps: Componentes = { ...COMPONENTES_BASE, 'x/grafico': lazyBloco(async () => ({ default: grafico })) }
    expect(blocosUsados(pg, comps).map((b) => b.interface)).toEqual(['x/grafico'])
    const r = await preCarregaBlocos(pg, comps)
    expect(r.carregados).toEqual(['x/grafico'])
    expect(renderPaginaHtml({ programa: pg, componentes: comps }).corpo).toContain('gráfico:dentro')
  })

  it('resolve a cadeia de extends: o bloco que herda usa o componente do pai, sem duplicar o carregamento', async () => {
    const pg = monta(P('layout/pilha', { slots: { filhos: [P('x/estende-grafico', { props: { titulo: 'herdado' } }), P('x/grafico', { props: { titulo: 'direto' } })] } }))
    const carrega = vi.fn(async () => ({ default: grafico }))
    const comps: Componentes = { ...COMPONENTES_BASE, 'x/grafico': lazyBloco(carrega) }
    expect(blocosUsados(pg, comps).map((b) => b.interface).filter((i) => i.startsWith('x/'))).toEqual(['x/grafico']) // uma entrada para os dois usos
    await preCarregaBlocos(pg, comps)
    expect(carrega).toHaveBeenCalledTimes(1)
    const corpo = renderPaginaHtml({ programa: pg, componentes: comps }).corpo
    expect(corpo).toContain('gráfico:herdado')
    expect(corpo).toContain('gráfico:direto')
  })

  it('falha ao carregar o módulo: reportada, o bloco é omitido e o resto da página sai', async () => {
    const pg = monta(P('layout/pilha', { slots: { filhos: [P('x/grafico'), P('texto/paragrafo', { props: { texto: 'resto' } })] } }))
    const comps: Componentes = { ...COMPONENTES_BASE, 'x/grafico': lazyBloco(async () => { throw new Error('chunk 404') }) }
    const r = await preCarregaBlocos(pg, comps)
    expect(r.falhas).toEqual([{ interface: 'x/grafico', erro: 'chunk 404' }])
    const erros: ErroRuntime[] = []
    const s = renderPaginaHtml({ programa: pg, componentes: comps, onErro: (e) => erros.push(e) })
    expect(s.corpo).toContain('<p>resto</p>')
    expect(erros).toEqual([expect.objectContaining({ regra: 'componente-ausente', mensagem: expect.stringContaining("'x/grafico'") })])
  })

  it('chunksParaPreload: só os lazy usados que informaram chunk', () => {
    const pg = monta(P('x/grafico'))
    const comps: Componentes = {
      ...COMPONENTES_BASE,
      'x/grafico': lazyBloco(async () => grafico, { chunk: '/assets/grafico.abc.js' }),
      'x/mapa': lazyBloco(async () => mapa, { chunk: '/assets/mapa.js' }),
      'layout/pilha': lazyBloco(async () => COMPONENTES_BASE['layout/pilha'] as never),
    }
    expect(chunksParaPreload(pg, comps)).toEqual(['/assets/grafico.abc.js'])
  })

  it('sem pré-carga, o bloco ainda aparece via React.lazy (ao ser carregado)', async () => {
    const { renderToPipeableStream } = await import('react-dom/server')
    const { PassThrough } = await import('node:stream')
    const { Pagina } = await import('../src/index')
    const pg = monta(P('x/grafico', { props: { titulo: 'tardio' } }))
    const comps: Componentes = { ...COMPONENTES_BASE, 'x/grafico': lazyBloco(async () => ({ default: grafico })) }
    const out = new PassThrough(); let txt = ''
    out.on('data', (c) => { txt += c })
    await new Promise<void>((res) => { const r = renderToPipeableStream(createElement(Pagina as never, { programa: pg, componentes: comps } as never), { onAllReady() { r.pipe(out); res() } }) })
    await new Promise((r) => out.on('end', r))
    expect(txt).toContain('gráfico:tardio')
  })
})
