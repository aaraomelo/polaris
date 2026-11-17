import { Registry } from '@polaris/schema'
import { describe, expect, it } from 'vitest'
import { COMPONENTES_BASE, compilaPrograma, registraBase, renderPaginaHtml, type IRElemento } from '../src/index'

const no = (kind: string, id: string, spec: object) => ({ kind, id, versao: '1.0.0', estatuto: 'publicado', spec }) as any
const P = (b: string, extra: object = {}) => ({ bloco: b, ...extra })
const marca = (slotsDecl: object = { conteudo: {} }) => (nome: string) => ({
  interface: nome, slots: slotsDecl, props: { type: 'object', properties: { titulo: { type: 'string' } } },
  modelo: P('layout/pilha', { props: { gap: 1 }, slots: { filhos: [P('texto/paragrafo', { props: { texto: `[${nome}:{props.titulo}]` } }), P('core/slot', { props: { nome: 'conteudo' } })] } }),
})

const monta = (extra?: (r: Registry) => void) => {
  const r = new Registry()
  registraBase(r)
  r.registra(no('servico', 'catalogo', { entidades: {}, operacoes: {} }))
  r.registra(no('dados', 'd.loja', { fonte: { tipo: 'servico', servico: 'catalogo', operacao: 'loja' } }))
  r.registra(no('dados', 'd.s', { fonte: { tipo: 'servico', servico: 'catalogo', operacao: 'lento' } }))
  r.registra(no('bloco', 'layout.raiz', marca()('layout/raiz')))
  r.registra(no('bloco', 'layout.loja', { ...marca()('layout/loja'), layout: 'layout/raiz' }))
  extra?.(r)
  return r
}
let n = 0
const compila = (spec: object, r = monta()) => compilaPrograma(r, r.registra(no('pagina', `p${n++}`, { rota: '/', raiz: P('texto/paragrafo', { props: { texto: 'conteúdo' } }), ...spec })))
const ok = (res: ReturnType<typeof compila>) => { if (!res.ok) throw new Error(JSON.stringify(res.erros, null, 1)); return res.programa }
const falha = (res: ReturnType<typeof compila>) => { if (res.ok) throw new Error('esperava erros'); return res.erros }
const html = (pg: ReturnType<typeof ok>, extra: object = {}) => renderPaginaHtml({ programa: pg, componentes: COMPONENTES_BASE, ...extra }).corpo

describe('layouts', () => {
  it('a página é envolvida pelo layout; o conteúdo entra no slot `conteudo`', () => {
    const pg = ok(compila({ layout: 'layout/raiz', layoutProps: { titulo: 'Loja' } }))
    const raiz = pg.pagina.raiz as IRElemento
    expect(raiz).toMatchObject({ tipo: 'elemento', caminho: '/spec/layout', bloco: { interface: 'layout/raiz', impl: 'composto' } })
    expect((raiz.slots.conteudo![0] as IRElemento).caminho).toBe('/spec/raiz') // o caminho de origem do conteúdo não muda
    expect(Object.keys(pg.blocos)).toEqual(['layout/raiz'])
    expect(html(pg)).toBe('<div style="display:flex;flex-direction:column;gap:1px"><p>[layout/raiz:Loja]</p><p>conteúdo</p></div>')
  })

  it('layouts aninhados: o layout-pai envolve o layout filho, de fora para dentro', () => {
    const pg = ok(compila({ layout: 'layout/loja', layoutProps: { titulo: 'L' } }))
    expect(Object.keys(pg.blocos).sort()).toEqual(['layout/loja', 'layout/raiz'])
    const corpo = html(pg)
    expect(corpo.indexOf('[layout/raiz:]')).toBeLessThan(corpo.indexOf('[layout/loja:L]'))
    expect(corpo.indexOf('[layout/loja:L]')).toBeLessThan(corpo.indexOf('conteúdo'))
    const raiz = pg.pagina.raiz as IRElemento
    expect(raiz.bloco.interface).toBe('layout/raiz')
    expect(((raiz.slots.conteudo![0]) as IRElemento).bloco.interface).toBe('layout/loja')
  })

  it('só o layout direto da página recebe layoutProps (o pai não)', () => {
    expect(html(ok(compila({ layout: 'layout/loja', layoutProps: { titulo: 'X' } })))).toContain('[layout/raiz:]')
  })

  it('layoutProps e título veem o escopo da página (dados, estado, idioma)', () => {
    const pg = ok(compila({ dados: { loja: 'd.loja' }, estado: { t: { tipo: 'texto', inicial: 'est' } }, layout: 'layout/raiz', layoutProps: { titulo: '{loja.nome}/{estado.t}/{idioma}' } }))
    expect(html(pg, { dados: { loja: { nome: 'Sol' } }, idioma: 'en' })).toContain('[layout/raiz:Sol/est/en]')
  })

  it('o conteúdo da página é avaliado no escopo da página mesmo dentro do layout', () => {
    const pg = ok(compila({ dados: { loja: 'd.loja' }, layout: 'layout/raiz', raiz: P('texto/paragrafo', { props: { texto: 'do conteúdo: {loja.nome}' } }) }))
    expect(html(pg, { dados: { loja: { nome: 'Sol' } } })).toContain('<p>do conteúdo: Sol</p>')
  })

  it('o layout não é obrigatório', () => {
    expect((ok(compila({})).pagina.raiz as IRElemento).caminho).toBe('/spec/raiz')
  })
})

describe('layouts: erros de compilação', () => {
  it('layout inexistente', () => {
    expect(falha(compila({ layout: 'layout/nada' })).some((e) => e.regra === 'ref')).toBe(true)
  })

  it('layout sem o slot conteudo: diz quais slots existem', () => {
    const r = monta((r) => r.registra(no('bloco', 'x.sem-conteudo', { interface: 'x/sem-conteudo', slots: { corpo: {} } })))
    const e = falha(compila({ layout: 'x/sem-conteudo' }, r))
    expect(e.find((x) => x.regra === 'layout')).toMatchObject({ caminho: '/spec/layout', dica: 'slots declarados: corpo' })
  })

  it('ciclo de layouts e aninhamento profundo demais', () => {
    const rc = monta((r) => {
      r.registra(no('bloco', 'x.a', { interface: 'x/a', layout: 'x/b', slots: { conteudo: {} } }))
      r.registra(no('bloco', 'x.b', { interface: 'x/b', layout: 'x/a', slots: { conteudo: {} } }))
    })
    expect(falha(compila({ layout: 'x/a' }, rc)).find((x) => x.regra === 'layout')!.mensagem).toBe('layouts em ciclo: x/a → x/b → x/a')
    const rp = monta((r) => {
      for (let i = 0; i < 7; i++) r.registra(no('bloco', `x.n${i}`, { interface: `x/n${i}`, ...(i < 6 ? { layout: `x/n${i + 1}` } : {}), slots: { conteudo: {} } }))
    })
    expect(falha(compila({ layout: 'x/n0' }, rp)).some((x) => x.mensagem.includes('aninhados demais'))).toBe(true)
  })

  it('layoutProps sem layout; variável inexistente; dado em streaming', () => {
    expect(falha(compila({ layoutProps: { titulo: 'x' } })).find((e) => e.regra === 'layout')!.caminho).toBe('/spec/layoutProps')
    expect(falha(compila({ layout: 'layout/raiz', layoutProps: { titulo: '{nada}' } })).some((e) => e.regra === 'binding' && e.caminho === '/spec/layoutProps/titulo')).toBe(true)
    const e = falha(compila({ dados: { s: { dados: 'd.s', stream: true } }, layout: 'layout/raiz', layoutProps: { titulo: '{s.x}' } }))
    expect(e.find((x) => x.regra === 'layout')!.mensagem).toContain('streaming')
  })

  it('o modelo do layout é validado como qualquer bloco (core/slot de slot inexistente)', () => {
    const r = monta((r) => r.registra(no('bloco', 'x.ruim', { interface: 'x/ruim', slots: { conteudo: {} }, modelo: P('layout/pilha', { slots: { filhos: [P('core/slot', { props: { nome: 'conteudoo' } })] } }) })))
    expect(falha(compila({ layout: 'x/ruim' }, r)).some((e) => e.regra === 'slot-nativo' && e.dica === "quis dizer 'conteudo'?")).toBe(true)
  })
})

describe('idioma no escopo', () => {
  it('{idioma} está disponível em props, título e args; vira o atributo lang do documento', () => {
    const pg = ok(compila({ titulo: 'T {idioma}', raiz: P('texto/paragrafo', { props: { texto: 'lang={idioma}' } }) }))
    const s = renderPaginaHtml({ programa: pg, componentes: COMPONENTES_BASE, idioma: 'en' })
    expect(s.corpo).toBe('<p>lang=en</p>')
    expect(s.titulo).toBe('T en')
    expect(s.html).toContain('<html lang="en">')
    expect(s.estado.idioma).toBe('en')
  })

  it('idioma é nome reservado (não pode ser variável de dados nem de estado)', () => {
    expect(falha(compila({ dados: { idioma: 'd.loja' } })).some((e) => e.regra === 'dados' && e.caminho === '/spec/dados/idioma')).toBe(true)
    expect(falha(compila({ estado: { idioma: { tipo: 'texto' } } })).some((e) => e.caminho === '/spec/estado/idioma')).toBe(true)
  })
})
