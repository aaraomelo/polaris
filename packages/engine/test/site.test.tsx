// @vitest-environment jsdom
import { Registry } from '@polaris/schema'
import { describe, expect, it } from 'vitest'
import { COMPONENTES_BASE, compilaHtmlVivo, compilaPrograma, montaVivo, registraBase, renderPaginaHtml, type Programa } from '../src/index'
import { BLOCOS_SITE, registraSite } from '../src/site/index'
import { geraCatalogo } from '../src/catalogo/index'
import { cssDoTema, registraTemas, TEMA_PADRAO } from '../src/tema/index'

const no = (kind: string, id: string, spec: object) => ({ kind, id, versao: '1.0.0', estatuto: 'publicado', spec }) as any
const novoReg = () => { const r = new Registry(); registraBase(r); registraTemas(r); registraSite(r); return r }
let n = 0
function pagina(raiz: object, r = novoReg()): Programa {
  const c = compilaPrograma(r, r.registra(no('pagina', `s${n++}`, { rota: '/', raiz })))
  if (!c.ok) throw new Error(JSON.stringify(c.erros, null, 1))
  return c.programa
}
function canon(nd: Node): string {
  if (nd.nodeType === 3) return nd.textContent!
  if (nd.nodeType !== 1) return ''
  const el = nd as HTMLElement, attrs = [...el.attributes].map((a) => `${a.name}=${JSON.stringify(a.value)}`).sort()
  return `<${el.tagName.toLowerCase()} ${attrs.join(' ')}>${[...el.childNodes].map(canon).join('')}</>`
}
const doHtml = (html: string) => { const d = document.createElement('div'); d.innerHTML = html; return [...d.childNodes].map(canon).join('') }
const ssr = (pg: Programa) => { const d = document.createElement('div'); d.innerHTML = renderPaginaHtml({ programa: pg, componentes: COMPONENTES_BASE }).corpo; return d }
const cab = (props: object, acoes?: object[]) => ({ bloco: 'site/cabecalho', props, ...(acoes ? { slots: { acoes } } : {}) })
const LINKS = [{ texto: 'Início', href: '/', atual: true }, { texto: 'Produtos', href: '/produtos' }, { texto: 'Contato', href: '/contato' }]

describe('blocos nativos do cabeçalho', () => {
  it('layout/cabecalho é <header> (com data-fixo só quando fixo); nav/menu é <nav> com nome acessível; nav/link atual leva aria-current', () => {
    const d = ssr(pagina({ bloco: 'layout/pilha', slots: { filhos: [
      { bloco: 'layout/cabecalho', props: { fixo: true }, slots: { filhos: [{ bloco: 'nav/menu', props: { rotulo: 'Seções' }, slots: { filhos: [{ bloco: 'nav/link', props: { href: '/a', texto: 'A', atual: true } }, { bloco: 'nav/link', props: { href: '/b', texto: 'B', atual: false } }] } }] } },
      { bloco: 'layout/cabecalho' }, { bloco: 'nav/menu' },
    ] } }))
    const hs = d.querySelectorAll('header'); expect(hs).toHaveLength(2); expect(hs[0]!.hasAttribute('data-fixo')).toBe(true); expect(hs[1]!.hasAttribute('data-fixo')).toBe(false)
    const navs = d.querySelectorAll('nav'); expect(navs[0]!.getAttribute('aria-label')).toBe('Seções'); expect(navs[1]!.getAttribute('aria-label')).toBe('Principal')
    const as = d.querySelectorAll('nav a'); expect(as[0]!.getAttribute('aria-current')).toBe('page'); expect(as[1]!.hasAttribute('aria-current')).toBe(false)
  })
})

describe('site/cabecalho', () => {
  it('é um nó válido; a marca liga ao início, o menu tem um link por item e só o `atual` leva aria-current', () => {
    expect(BLOCOS_SITE.map((b) => b.id)).toEqual(['site.cabecalho', 'site.rodape']); expect(novoReg().ids('bloco')).toEqual(expect.arrayContaining(['site/cabecalho', 'site/rodape']))
    const d = ssr(pagina(cab({ titulo: 'Loja Demo', links: LINKS })))
    const h = d.querySelector('header')!; expect(h).toBeTruthy(); const marca = h.querySelector(':scope > a')!; expect(marca.getAttribute('href')).toBe('/'); expect(marca.textContent).toBe('Loja Demo')
    const links = [...h.querySelectorAll('nav a')]; expect(links.map((a) => a.textContent)).toEqual(['Início', 'Produtos', 'Contato']); expect(links.map((a) => a.getAttribute('href'))).toEqual(['/', '/produtos', '/contato'])
    expect(links.map((a) => a.getAttribute('aria-current'))).toEqual(['page', null, null]); expect(h.querySelector('nav')!.getAttribute('aria-label')).toBe('Principal')
  })
  it('logo, marca para outra rota, nome do menu, fixo e a ação no slot (à direita do menu)', () => {
    const d = ssr(pagina(cab({ titulo: 'X', logo: 'https://exemplo.com/l.png', href: '/inicio', rotuloMenu: 'Seções', fixo: true, links: LINKS.slice(0, 1) }, [{ bloco: 'nav/link', props: { href: '/entrar', texto: 'Entrar' } }])))
    const h = d.querySelector('header')!; expect(h.hasAttribute('data-fixo')).toBe(true); expect(h.querySelector('img')!.getAttribute('src')).toBe('https://exemplo.com/l.png'); expect(h.querySelector('img')!.getAttribute('alt')).toBe('')
    expect(h.querySelector(':scope > a')!.getAttribute('href')).toBe('/inicio'); expect(h.querySelector('nav')!.getAttribute('aria-label')).toBe('Seções')
    const filhos = [...h.children].map((c) => c.tagName.toLowerCase()); expect(filhos).toEqual(['a', 'nav', 'a']); expect(h.lastElementChild!.textContent).toBe('Entrar')
  })
  it('sem links não há <nav> vazio; sem logo não há imagem; link inseguro é recusado (sem href), nada vira marcação', () => {
    const d = ssr(pagina(cab({ titulo: 'Só marca' }))); expect(d.querySelector('nav')).toBeNull(); expect(d.querySelector('img')).toBeNull()
    const m = ssr(pagina(cab({ titulo: '<img src=x onerror=alert(1)>', links: [{ texto: 'Ruim', href: 'javascript:alert(1)' }] })))
    expect(m.querySelector('img')).toBeNull(); expect(m.querySelector('nav a')!.hasAttribute('href')).toBe(false); expect(m.querySelector('header')!.textContent).toContain('<img src=x')
  })
  it('paridade React × runtime vivo: o DOM do servidor e o do cliente são iguais', () => {
    const pg = pagina(cab({ titulo: 'Loja', logo: 'https://exemplo.com/l.png', fixo: true, links: LINKS }, [{ bloco: 'nav/link', props: { href: '/entrar', texto: 'Entrar' } }]))
    const oraculo = [...ssr(pg).childNodes].map(canon).join(''), h = compilaHtmlVivo(pg); if (!h.ok) throw new Error(JSON.stringify(h.motivos))
    expect(doHtml(h.pagina.render({}).corpo)).toBe(oraculo) // o HTML do servidor do runtime vivo
    const c = document.createElement('div'); montaVivo({ programa: pg, container: c }); expect([...c.childNodes].map(canon).join('')).toBe(oraculo) // e o DOM montado no cliente
  })
  it('catálogo e tema: o bloco aparece documentado com exemplos que renderizam, e o CSS do tema estiliza header e nav só com variáveis', () => {
    const r = geraCatalogo(novoReg()); expect(r.erros).toEqual([]); expect(r.markdown).toContain('site/cabecalho'); expect(r.markdown).toContain('layout/cabecalho')
    const css = cssDoTema(TEMA_PADRAO); expect(css).toMatch(/#polaris header\{[^}]*var\(--cor-superficie\)/); expect(css).toMatch(/#polaris nav a\[aria-current=page\]/); expect(css).toMatch(/header\[data-fixo\]\{position:sticky/)
  })
})

const rod = (props: object, extra?: object[]) => ({ bloco: 'site/rodape', props, ...(extra ? { slots: { extra } } : {}) })
const COLUNAS = [{ titulo: 'Loja', links: [{ texto: 'Produtos', href: '/produtos' }, { texto: 'Contato', href: '/contato' }] }, { titulo: 'Ajuda', links: [{ texto: 'Sobre', href: '/sobre' }] }]

describe('layout/rodape e site/rodape', () => {
  it('layout/rodape é <footer> (landmark), com os filhos dentro', () => {
    const d = ssr(pagina({ bloco: 'layout/pilha', slots: { filhos: [{ bloco: 'layout/rodape', id: 'r', slots: { filhos: [{ bloco: 'texto/pequeno', props: { texto: 'fim' } }] } }] } }))
    const f = d.querySelector('footer')!; expect(f.id).toBe('r'); expect(f.textContent).toBe('fim')
  })
  it('colunas: um grupo por coluna (título + <nav> com o título como nome), links na ordem, contato, divisor e aviso legal', () => {
    const d = ssr(pagina(rod({ colunas: COLUNAS, contato: 'contato@exemplo.com', copyright: '© 2026 Minha loja' })))
    const f = d.querySelector('footer')!; const navs = [...f.querySelectorAll('nav')]
    expect(navs.map((n) => n.getAttribute('aria-label'))).toEqual(['Loja', 'Ajuda']); expect(navs.map((n) => [...n.querySelectorAll('a')].map((a) => a.textContent).join('|'))).toEqual(['Produtos|Contato', 'Sobre'])
    expect([...navs[0]!.querySelectorAll('a')].map((a) => a.getAttribute('href'))).toEqual(['/produtos', '/contato'])
    expect(f.querySelector('strong')!.textContent).toBe('Loja'); expect(f.textContent).toContain('contato@exemplo.com'); expect(f.querySelector('hr')).toBeTruthy(); expect(f.querySelector('small')!.textContent).toBe('© 2026 Minha loja')
    expect(f.querySelector('div[style*="grid-template-columns:repeat(2"]')).toBeTruthy() // uma coluna de grade por grupo
  })
  it('só o que foi dado aparece: sem colunas não há grade nem <nav>, sem aviso não há divisor; o slot extra entra', () => {
    const d = ssr(pagina(rod({ copyright: '© x' }, [{ bloco: 'nav/link', props: { href: '/termos', texto: 'Termos' } }])))
    const f = d.querySelector('footer')!; expect(f.querySelector('nav')).toBeNull(); expect(f.querySelector('div[style*=grid]')).toBeNull(); expect(f.querySelector('a')!.textContent).toBe('Termos')
    const v = ssr(pagina(rod({}))); expect(v.querySelector('footer')!.querySelector('hr')).toBeNull(); expect(v.querySelector('footer')!.textContent).toBe('')
  })
  it('texto escapado e link inseguro sem href; coluna sem links não gera <nav> vazio', () => {
    const d = ssr(pagina(rod({ colunas: [{ titulo: '<b>x</b>', links: [{ texto: 'Ruim', href: 'javascript:alert(1)' }] }, { titulo: 'Vazia' }], copyright: '<img src=x onerror=alert(1)>' })))
    expect(d.querySelector('b')).toBeNull(); expect(d.querySelector('img')).toBeNull(); expect(d.querySelector('nav a')!.hasAttribute('href')).toBe(false); expect(d.querySelectorAll('nav')).toHaveLength(1)
  })
  it('paridade React × runtime vivo × estático', () => {
    const pg = pagina(rod({ colunas: COLUNAS, contato: 'a@b.c', copyright: '© 2026' }, [{ bloco: 'nav/link', props: { href: '/termos', texto: 'Termos' } }]))
    const oraculo = [...ssr(pg).childNodes].map(canon).join(''), h = compilaHtmlVivo(pg); if (!h.ok) throw new Error(JSON.stringify(h.motivos))
    expect(doHtml(h.pagina.render({}).corpo)).toBe(oraculo); const c = document.createElement('div'); montaVivo({ programa: pg, container: c }); expect([...c.childNodes].map(canon).join('')).toBe(oraculo)
  })
  it('o tema estiliza footer só com variáveis', () => { const css = cssDoTema(TEMA_PADRAO); expect(css).toMatch(/#polaris footer\{[^}]*var\(--cor-superficie\)/); expect(css).toMatch(/#polaris footer a:hover/) })
})
