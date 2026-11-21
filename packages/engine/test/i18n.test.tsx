// @vitest-environment jsdom
import { Registry } from '@polaris/schema'
import { describe, expect, it } from 'vitest'
import { COMPONENTES_BASE, compilaPrograma, montaVivo, registraBase, renderPaginaHtml } from '../src/index'

// i18n: o template carrega só CHAVES (`t("…")`); os textos de cada idioma vivem em catálogos `traducao`, desacoplados da página.
const no = (kind: string, id: string, spec: object) => ({ kind, id, versao: '1.0.0', estatuto: 'publicado', spec }) as any
const P = (b: string, extra: object = {}) => ({ bloco: b, ...extra })
const r = new Registry(); registraBase(r)
r.registra(no('traducao', 'loja', { padrao: 'pt-BR', mensagens: {
  'pt-BR': { 'home.titulo': 'Objetos de beleza serena', 'sacola.itens': '{n, plural, =0 {Sacola vazia} one {# peça} other {# peças}}', 'ola': 'Olá, {nome}!', 'so.pt': 'Só em português' },
  en: { 'home.titulo': 'Objects of quiet beauty', 'sacola.itens': '{n, plural, =0 {Bag is empty} one {# item} other {# items}}', 'ola': 'Hello, {nome}!' },
} }))
let n = 0
const compila = (raiz: object, extra: object = {}) => { const c = compilaPrograma(r, r.registra(no('pagina', `p${++n}`, { rota: '/', raiz, traducoes: ['loja'], estado: { qtd: { tipo: 'inteiro', inicial: 3 } }, ...extra }))); return c }
const ok = (raiz: object, extra: object = {}) => { const c = compila(raiz, extra); if (!c.ok) throw new Error(JSON.stringify(c.erros)); return c.programa }
const pagina = () => ok(P('layout/pilha', { slots: { filhos: [
  P('texto/titulo', { props: { texto: '{t("home.titulo")}' } }),
  P('texto/paragrafo', { props: { texto: '{t("sacola.itens", objeto([["n", estado.qtd]]))}' } }),
  P('texto/paragrafo', { props: { texto: '{t("ola", objeto([["nome", "Ana"]]))}' } }),
  P('texto/paragrafo', { props: { texto: '{t("so.pt")}' } }),
] } }))
const texto = (html: string) => [...html.matchAll(/<(?:h1|p)[^>]*>([^<]*)</g)].map((m) => m[1])

describe('t("chave"): o template só leva chaves e o idioma da requisição escolhe o texto', () => {
  it('pt-BR e en: título, plural com número, parâmetro e fallback para o idioma padrão (chave que o en não traduziu)', () => {
    const p = pagina()
    expect(texto(renderPaginaHtml({ programa: p, componentes: COMPONENTES_BASE, idioma: 'pt-BR' }).html)).toEqual(['Objetos de beleza serena', '3 peças', 'Olá, Ana!', 'Só em português'])
    expect(texto(renderPaginaHtml({ programa: p, componentes: COMPONENTES_BASE, idioma: 'en' }).html)).toEqual(['Objects of quiet beauty', '3 items', 'Hello, Ana!', 'Só em português'])
  })
  it('região desconhecida cai no idioma-base (pt-PT → pt-BR) e idioma sem tradução cai no padrão', () => {
    const p = pagina()
    expect(texto(renderPaginaHtml({ programa: p, componentes: COMPONENTES_BASE, idioma: 'pt-PT' }).html)[0]).toBe('Objetos de beleza serena')
    expect(texto(renderPaginaHtml({ programa: p, componentes: COMPONENTES_BASE, idioma: 'fr' }).html)[0]).toBe('Objetos de beleza serena')
  })
  it('o runtime vivo (cliente) escreve o MESMO texto que o servidor, e o plural acompanha o estado', () => {
    const p = pagina()
    for (const idioma of ['pt-BR', 'en']) {
      const c = document.createElement('div'); document.body.appendChild(c)
      const v = montaVivo({ programa: p, container: c, idioma })
      expect(texto(c.innerHTML)).toEqual(texto(renderPaginaHtml({ programa: p, componentes: COMPONENTES_BASE, idioma }).html))
      v.despacha({ t: 'estado', nome: 'qtd', valor: 1 }); v.flush()
      expect(c.querySelectorAll('p')[0]!.textContent).toBe(idioma === 'en' ? '1 item' : '1 peça')
      v.despacha({ t: 'estado', nome: 'qtd', valor: 0 }); v.flush()
      expect(c.querySelectorAll('p')[0]!.textContent).toBe(idioma === 'en' ? 'Bag is empty' : 'Sacola vazia')
    }
  })
  it('o texto do título da página também é traduzido', () => {
    const p = ok(P('texto/paragrafo', { props: { texto: 'x' } }), { titulo: '{t("home.titulo")}' })
    expect(renderPaginaHtml({ programa: p, componentes: COMPONENTES_BASE, idioma: 'en' }).html).toContain('<title>Objects of quiet beauty</title>')
  })
})

describe('erros de compilação acionáveis', () => {
  const erro = (texto: string, extra: object = {}) => { const c = compila(P('texto/paragrafo', { props: { texto } }), extra); if (c.ok) throw new Error('deveria falhar'); return c.erros.find((e) => e.regra === 'traducao')! }
  it('chave que não existe: aponta a página, o caminho e "quis dizer"', () => {
    const e = erro('{t("Home.Titulo")}'); expect(e.mensagem).toContain("'Home.Titulo'"); expect(e.dica).toContain("quis dizer 'home.titulo'")
    expect(e.caminho).toBe('/spec/raiz/props/texto')
  })
  it('chave calculada não vale (o compilador precisa saber quais mensagens a página usa)', () => { expect(erro('{t("home." + "titulo")}').mensagem).toContain('texto literal') })
  it('sem catálogos na página', () => { expect(erro('{t("home.titulo")}', { traducoes: [] }).mensagem).toContain('não declara catálogos') })
  it('catálogo inexistente', () => { expect(erro('x', { traducoes: ['nao-existe'] }).mensagem).toContain("'nao-existe'") })
  it('ICU inválido em qualquer idioma é pego ao usar a chave', () => {
    r.registra({ ...no('traducao', 'ruim', { padrao: 'pt-BR', mensagens: { 'pt-BR': { a: 'ok' }, en: { a: '{n, plural, one {# x}' } } }) })
    const e = erro('{t("a")}', { traducoes: ['ruim'] }); expect(e.mensagem).toContain("'en'"); expect(e.mensagem).toContain('ICU')
  })
})
