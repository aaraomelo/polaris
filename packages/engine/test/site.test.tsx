// @vitest-environment jsdom
import { Registry } from '@polaris/schema'
import { describe, expect, it } from 'vitest'
import { COMPONENTES_BASE, compilaHtmlVivo, compilaPrograma, montaVivo, registraBase, renderPaginaHtml, type Programa } from '../src/index'
import { BLOCOS_SITE, registraSite } from '../src/site/index'
import { geraCatalogo } from '../src/catalogo/index'
import { cssDoTema, registraTemas, TEMA_PADRAO } from '../src/tema/index'
import { nomeDeIcone, tamanhoDeIcone } from '../src/render/url'

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
    expect(BLOCOS_SITE.map((b) => b.id)).toEqual(['site.cabecalho', 'site.rodape', 'site.hero', 'site.busca', 'site.menu-lateral']); expect(novoReg().ids('bloco')).toEqual(expect.arrayContaining(['site/cabecalho', 'site/rodape', 'site/hero', 'site/busca', 'site/menu-lateral']))
    const d = ssr(pagina(cab({ titulo: 'Loja Demo', links: LINKS })))
    const h = d.querySelector('header')!; expect(h).toBeTruthy(); const marca = h.querySelector(':scope > a')!; expect(marca.getAttribute('href')).toBe('/'); expect(marca.textContent).toBe('Loja Demo')
    const links = [...h.querySelectorAll('nav a')]; expect(links.map((a) => a.textContent)).toEqual(['Início', 'Produtos', 'Contato']); expect(links.map((a) => a.getAttribute('href'))).toEqual(['/', '/produtos', '/contato'])
    expect(links.map((a) => a.getAttribute('aria-current'))).toEqual(['page', null, null]); expect(h.querySelector('nav')!.getAttribute('aria-label')).toBe('Principal')
  })
  it('logo, marca para outra rota, nome do menu, fixo e a ação no slot (à direita do menu)', () => {
    const d = ssr(pagina(cab({ titulo: 'X', logo: 'https://exemplo.com/l.png', href: '/inicio', rotuloMenu: 'Seções', fixo: true, links: LINKS.slice(0, 1) }, [{ bloco: 'nav/link', props: { href: '/entrar', texto: 'Entrar' } }])))
    const h = d.querySelector('header')!; expect(h.hasAttribute('data-fixo')).toBe(true); expect(h.querySelector('img')!.getAttribute('src')).toBe('https://exemplo.com/l.png'); expect(h.querySelector('img')!.getAttribute('alt')).toBe('')
    expect(h.querySelector(':scope > a')!.getAttribute('href')).toBe('/inicio'); expect(h.querySelector('nav')!.getAttribute('aria-label')).toBe('Seções')
    const filhos = [...h.children].map((c) => c.tagName.toLowerCase()); expect(filhos).toEqual(['a', 'input', 'label', 'nav', 'a']); expect(h.lastElementChild!.textContent).toBe('Entrar')
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

const hero = (props: object, extra?: object[]) => ({ bloco: 'site/hero', props, ...(extra ? { slots: { extra } } : {}) })

describe('layout/destaque e site/hero', () => {
  it('hero completo: <section> com o <h1>, o subtítulo e os dois botões (primário e secundário) com os links certos', () => {
    const d = ssr(pagina(hero({ titulo: 'Tudo para a casa', subtitulo: 'Ofertas toda semana', cta: { texto: 'Ver ofertas', href: '/produtos' }, cta2: { texto: 'Falar conosco', href: '/contato' } })))
    const s = d.querySelector('section')!; expect(s.getAttribute('data-alinha')).toBe('centro'); expect(s.getAttribute('data-fundo')).toBe('primaria'); expect(s.getAttribute('style')).toBe('min-height:320px')
    expect(s.querySelector('h1')!.textContent).toBe('Tudo para a casa'); expect(s.querySelector('p')!.textContent).toBe('Ofertas toda semana')
    const as = [...s.querySelectorAll('a')]; expect(as.map((a) => [a.textContent, a.getAttribute('href'), a.getAttribute('data-botao')])).toEqual([['Ver ofertas', '/produtos', 'primario'], ['Falar conosco', '/contato', 'secundario']])
  })
  it('só o que foi dado: sem subtítulo nem botões não há <p> nem linha de botões; um botão só; o slot extra entra', () => {
    const a = ssr(pagina(hero({ titulo: 'Só título' }))); expect(a.querySelector('p')).toBeNull(); expect(a.querySelector('a')).toBeNull()
    const b = ssr(pagina(hero({ titulo: 'x', cta2: { texto: 'Só secundário', href: '/s' } }, [{ bloco: 'texto/pequeno', props: { texto: 'extra' } }]))); expect([...b.querySelectorAll('a')].map((l) => l.getAttribute('data-botao'))).toEqual(['secundario']); expect(b.querySelector('small')!.textContent).toBe('extra')
  })
  it('imagem: fundo com véu escuro, URL escapada (nada fecha o url() nem a declaração); inseguro some; altura e véu limitados; alinha e fundo desconhecidos caem no padrão', () => {
    const d = ssr(pagina(hero({ titulo: 'x', imagem: '/img/a b"c)d;e.jpg', altura: 480, escurece: 0.6, alinha: 'esquerda', fundo: 'suave' }))), st = d.querySelector('section')!.getAttribute('style')!
    expect(st).toBe('min-height:480px;background-image:linear-gradient(rgba(0,0,0,0.6),rgba(0,0,0,0.6)),url("/img/a%20b%22c%29d;e.jpg")'); expect(d.querySelector('section')!.getAttribute('data-alinha')).toBe('esquerda'); expect(d.querySelector('section')!.hasAttribute('data-imagem')).toBe(true)
    const v = ssr(pagina(hero({ titulo: 'x', imagem: 'javascript:alert(1)', altura: 800, escurece: 0.8, alinha: 'zz', fundo: 'zz' }))).querySelector('section')!; expect(v.getAttribute('style')).toBe('min-height:800px'); expect(v.hasAttribute('data-imagem')).toBe(false); expect([v.getAttribute('data-alinha'), v.getAttribute('data-fundo')]).toEqual(['centro', 'primaria'])
    expect(() => pagina(hero({ titulo: 'x', altura: 5000 }))).toThrow(/must be <= 800/); expect(() => pagina(hero({ titulo: 'x', escurece: 9 }))).toThrow(/must be <= 0.8/) // fora do limite nem compila
  })
  it('texto escapado e link inseguro do botão sem href', () => {
    const d = ssr(pagina(hero({ titulo: '<img src=x onerror=alert(1)>', cta: { texto: 'Ruim', href: 'javascript:alert(1)' } }))); expect(d.querySelector('img')).toBeNull(); expect(d.querySelector('h1')!.textContent).toContain('<img'); expect(d.querySelector('a')!.hasAttribute('href')).toBe(false)
  })
  it('paridade React × runtime vivo × estático (com imagem, véu e botões)', () => {
    const pg = pagina(hero({ titulo: 'Olá', subtitulo: 's', imagem: '/img/a.jpg', altura: 360, escurece: 0.5, alinha: 'esquerda', cta: { texto: 'Ir', href: '/x' }, cta2: { texto: 'Outro', href: '/y' } }, [{ bloco: 'texto/pequeno', props: { texto: 'extra' } }]))
    const oraculo = [...ssr(pg).childNodes].map(canon).join(''), h = compilaHtmlVivo(pg); if (!h.ok) throw new Error(JSON.stringify(h.motivos))
    expect(doHtml(h.pagina.render({}).corpo)).toBe(oraculo); const c = document.createElement('div'); montaVivo({ programa: pg, container: c }); expect([...c.childNodes].map(canon).join('')).toBe(oraculo)
  })
  it('o tema estiliza section[data-alinha] e a[data-botao] só com variáveis (botão primário invertido sobre o fundo primário)', () => {
    const css = cssDoTema(TEMA_PADRAO); expect(css).toMatch(/section\[data-fundo=primaria\]\{background-color:var\(--cor-primaria\)/); expect(css).toMatch(/section\[data-fundo=primaria\] a\[data-botao=primario\]\{background:var\(--cor-texto-sobre-primaria\)/); expect(css.indexOf('section[data-imagem] a[data-botao=primario]')).toBeGreaterThan(css.indexOf('section[data-fundo=primaria] a[data-botao=primario]')) // a regra da imagem vem DEPOIS (mesma especificidade: a última vale)
  })
})

const busca = (props: object) => ({ bloco: 'site/busca', props })

describe('busca (form/busca, entrada/busca, nav/enviar, site/busca)', () => {
  it('é um <form> GET com role=search, campo type=search com nome acessível e botão submit', () => {
    const d = ssr(pagina(busca({}))), f = d.querySelector('form')!, i = f.querySelector('input')!, b = f.querySelector('button')!
    expect([f.getAttribute('role'), f.getAttribute('method'), f.getAttribute('action')]).toEqual(['search', 'get', '/busca']); expect([i.type, i.name, i.getAttribute('aria-label'), i.getAttribute('placeholder'), i.getAttribute('maxlength'), i.getAttribute('autocomplete')]).toEqual(['search', 'q', 'Buscar', 'Buscar', '200', 'off']); expect([b.type, b.textContent]).toEqual(['submit', 'Buscar'])
  })
  it('props: destino, parâmetro, termo inicial, rótulo, placeholder e texto do botão', () => {
    const f = ssr(pagina(busca({ acao: '/produtos', nome: 'termo', valor: 'café "quente"', placeholder: 'Buscar produtos', rotulo: 'Procurar na loja', botao: 'Ir' }))).querySelector('form')!, i = f.querySelector('input')!
    expect([f.getAttribute('action'), i.name, i.getAttribute('value'), i.getAttribute('placeholder'), i.getAttribute('aria-label'), f.querySelector('button')!.textContent]).toEqual(['/produtos', 'termo', 'café "quente"', 'Buscar produtos', 'Procurar na loja', 'Ir'])
  })
  it('segurança: destino que não é caminho do próprio site vale /busca; nome de parâmetro inválido vale q; o termo é escapado e cortado em 200', () => {
    for (const ruim of ['https://evil.com/x', '//evil.com', 'javascript:alert(1)', '\\evil', '/a b', '/x\ny', 'busca']) expect(ssr(pagina(busca({ acao: ruim }))).querySelector('form')!.getAttribute('action'), ruim).toBe('/busca')
    expect(ssr(pagina(busca({ nome: '1 inválido' }))).querySelector('input')!.name).toBe('q'); expect(ssr(pagina(busca({ nome: 'a"><script>' }))).querySelector('input')!.name).toBe('q')
    const d = ssr(pagina(busca({ valor: '"><img src=x onerror=alert(1)>' }))); expect(d.querySelector('img')).toBeNull(); expect(d.querySelector('input')!.getAttribute('value')).toBe('"><img src=x onerror=alert(1)>')
    expect(() => pagina(busca({ valor: 'x'.repeat(201) }))).toThrow(/200/)
  })
  it('sem JavaScript: não é interativo (nenhum evento), então a página pode ser servida estática', () => { const html = renderPaginaHtml({ programa: pagina(busca({})), componentes: COMPONENTES_BASE }).corpo; expect(html).toContain('<form'); expect(html).not.toMatch(/onclick|data-evt/i) })
  it('paridade React × runtime vivo', () => {
    const pg = pagina(busca({ acao: '/p', nome: 'termo', valor: 'x', botao: 'Ir' })), oraculo = [...ssr(pg).childNodes].map(canon).join(''), h = compilaHtmlVivo(pg); if (!h.ok) throw new Error(JSON.stringify(h.motivos))
    expect(doHtml(h.pagina.render({}).corpo)).toBe(oraculo); const c = document.createElement('div'); montaVivo({ programa: pg, container: c }); expect([...c.childNodes].map(canon).join('')).toBe(oraculo)
  })
  it('o tema estiliza form[role=search] e input[type=search] só com variáveis', () => { const css = cssDoTema(TEMA_PADRAO); expect(css).toMatch(/form\[role=search\]\{display:flex/); expect(css).toMatch(/input\[type=search\]\{[^}]*var\(--cor-superficie\)/) })
})

describe('menu recolhível do cabeçalho (nav/alternador)', () => {
  it('o cabeçalho leva um alternador (checkbox role=switch com nome) e o rótulo "Menu" ligado a ele, entre a marca e o menu', () => {
    const h = ssr(pagina(cab({ titulo: 'Loja', links: LINKS }))).querySelector('header')!, ks = [...h.children].map((c) => c.tagName.toLowerCase())
    expect(ks).toEqual(['a', 'input', 'label', 'nav']); const i = h.querySelector('input')!, l = h.querySelector('label')!
    expect([i.type, i.getAttribute('role'), i.getAttribute('aria-label'), i.hasAttribute('data-alternador'), i.id]).toEqual(['checkbox', 'switch', 'Abrir o menu', true, 'cabecalho-alternador']); expect([l.getAttribute('for'), l.textContent]).toEqual(['cabecalho-alternador', 'Menu'])
    expect(i.nextElementSibling).toBe(l) // o CSS usa `input:focus-visible + label` e `input:checked ~ …`
  })
  it('`menuRecolhivel: false` não põe alternador nem rótulo; `rotuloAlternador` muda o nome acessível', () => {
    const sem = ssr(pagina(cab({ titulo: 'x', links: LINKS, menuRecolhivel: false }))).querySelector('header')!; expect(sem.querySelector('input')).toBeNull(); expect(sem.querySelector('label')).toBeNull()
    expect(ssr(pagina(cab({ titulo: 'x', rotuloAlternador: 'Mostrar a navegação' }))).querySelector('input')!.getAttribute('aria-label')).toBe('Mostrar a navegação')
  })
  it('o tema esconde o menu e as ações no celular enquanto o alternador não está marcado, e mostra o botão só lá', () => {
    const css = cssDoTema(TEMA_PADRAO); expect(css).toMatch(/header>label\[for\]\{display:none/); expect(css).toMatch(/@media \(max-width:40rem\)\{[^@]*header>label\[for\]\{display:inline-block\}/)
    expect(css).toContain('header>input[data-alternador]:not(:checked)~*:not(label){display:none}'); expect(css).toContain('header>input[data-alternador]:checked~nav{display:flex}'); expect(css).toMatch(/input\[data-alternador\]:focus-visible\+label/)
  })
})

describe('srcset automático (midia/imagem)', () => {
  const H = '/_polaris/img/abababababababababababababababababababababababababababababababab', img = (props: Record<string, unknown>) => ssr(pagina({ bloco: 'midia/imagem', props })).querySelector('img')!
  it('imagem hospedada png/jpg/webp ganha as quatro versões webp e sizes; o src segue o original', () => {
    const i = img({ src: `${H}.png`, alt: 'a', largura: 600 })
    expect(i.getAttribute('src')).toBe(`${H}.png`); expect(i.getAttribute('srcset')).toBe([160, 480, 960, 1920].map((w) => `${H}.webp?w=${w} ${w}w`).join(', ')); expect(i.getAttribute('sizes')).toBe('(max-width: 600px) 100vw, 600px')
    expect(img({ src: `${H}.jpg`, alt: 'a', tamanhos: '(min-width: 800px) 50vw, 100vw' }).getAttribute('sizes')).toBe('(min-width: 800px) 50vw, 100vw'); expect(img({ src: `${H}.webp`, alt: 'a', largura: 300 }).getAttribute('sizes')).toBe('(max-width: 300px) 100vw, 300px')
  })
  it('não gera srcset para gif, outras URLs, outro caminho nem hash malformado; `tamanhos` com caracteres fora da lista é ignorado', () => {
    expect(img({ src: `${H}.png`, alt: 'a' }).hasAttribute('srcset')).toBe(false) // sem largura nem tamanhos: sem srcset (o tamanho natural não muda)
    for (const src of [`${H}.gif`, 'https://x.test/a.png', '/a.png', '/_polaris/img/zz.png', `${H}.png?x=1`, `/_polaris/img/${'ab'.repeat(32)}.svg`]) expect(img({ src, alt: 'a', largura: 100 }).hasAttribute('srcset'), src).toBe(false)
    expect(img({ src: `${H}.png`, alt: 'a', tamanhos: '"><script>' }).hasAttribute('srcset')).toBe(false) // sem largura e com tamanhos inválidos: sem srcset
  })
})

describe('submenu do cabeçalho (grupos)', () => {
  const G = [{ titulo: 'Ajuda', links: [{ texto: 'Sobre', href: '/sobre', atual: true }, { texto: 'Contato', href: '/contato' }] }]
  it('cada grupo é um <details> com <summary> e os links, depois dos links do menu', () => {
    const nav = ssr(pagina(cab({ titulo: 'x', links: LINKS, grupos: G }))).querySelector('header nav')!, d = nav.querySelector('details[data-submenu]')!
    expect([...nav.children].map((c) => c.tagName.toLowerCase()).slice(-1)).toEqual(['details']); expect(d.querySelector('summary')!.textContent).toBe('Ajuda'); expect([...d.querySelectorAll('a')].map((a) => a.getAttribute('href'))).toEqual(['/sobre', '/contato']); expect(d.querySelector('a[aria-current=page]')!.textContent).toBe('Sobre')
    expect(d.firstElementChild!.tagName).toBe('SUMMARY'); expect(d.hasAttribute('open')).toBe(false) // fechado de início
  })
  it('só grupos (sem links) já mostra o menu; sem nenhum dos dois não há <nav>; texto do grupo é escapado', () => {
    const so = ssr(pagina(cab({ titulo: 'x', grupos: [{ titulo: '<i>x</i>', links: [] }] }))).querySelector('header')!; expect(so.querySelector('nav details summary')!.textContent).toBe('<i>x</i>'); expect(so.querySelector('nav i')).toBeNull()
    expect(ssr(pagina(cab({ titulo: 'x' }))).querySelector('header nav')).toBeNull()
  })
  it('o tema posiciona o painel com ::details-content (computador) e deixa em linha no celular', () => {
    const css = cssDoTema(TEMA_PADRAO); expect(css).toContain('nav>details[data-submenu][open]::details-content{position:absolute'); expect(css).toContain('details[data-submenu]:not([open])::details-content{display:none}'); // fechado: nada do painel (borda, padding) aparece expect(css).toMatch(/@media \(max-width:40rem\)\{[^@]*details-content\{position:static/)
  })
})

describe('sugestões da barra de busca (datalist)', () => {
  const busca = (props: Record<string, unknown>) => ssr(pagina({ bloco: 'site/busca', props })).querySelector('form')!
  it('com `sugestoes`: o campo aponta (list) para um <datalist> com uma <option> por termo, escapada', () => {
    const f = busca({ sugestoes: ['Café', 'Chá <b>', 'Pão'] }), i = f.querySelector('input[type=search]')!, dl = f.querySelector('datalist')!
    expect([i.getAttribute('list'), dl.id]).toEqual(['busca-sugestoes', 'busca-sugestoes']); expect([...dl.querySelectorAll('option')].map((o) => o.getAttribute('value'))).toEqual(['Café', 'Chá <b>', 'Pão']); expect(dl.querySelector('b')).toBeNull()
  })
  it('sem `sugestoes` (ou vazio): nem list nem datalist; `lista` inválida no bloco nativo é ignorada', () => {
    for (const p of [{}, { sugestoes: [] }]) { const f = busca(p); expect(f.querySelector('input')!.hasAttribute('list')).toBe(false); expect(f.querySelector('datalist')).toBeNull() }
    expect(ssr(pagina({ bloco: 'entrada/busca', props: { lista: '1 "><x' } })).querySelector('input')!.hasAttribute('list')).toBe(false)
  })
})

describe('sugestões ao vivo (form/sugestoes-ao-vivo)', () => {
  const busca = (props: Record<string, unknown>) => ssr(pagina({ bloco: 'site/busca', props })).querySelector('form')!
  it('com `sugestoesUrl`: uma lista oculta (listbox) logo depois do campo, com os dados que o cliente lê; limite entre 1 e 10; destino padrão é a ação', () => {
    const u = busca({ sugestoesUrl: '/api/loja/destaques', sugestoesDescricao: 'descricao', sugestoesImagem: 'imagem', sugestoesLimite: 5, acao: '/achar' }).querySelector('ul')!
    expect([u.hasAttribute('hidden'), u.getAttribute('role'), u.getAttribute('aria-label')]).toEqual([true, 'listbox', 'Sugestões']); expect(Object.fromEntries([...u.attributes].filter((a) => a.name.startsWith('data-')).map((a) => [a.name, a.value]))).toEqual({ 'data-sugestoes-url': '/api/loja/destaques', 'data-titulo': 'titulo', 'data-descricao': 'descricao', 'data-imagem': 'imagem', 'data-limite': '5', 'data-destino': '/achar', 'data-nome': 'q' })
    expect(u.previousElementSibling!.tagName).toBe('INPUT')
  })
  it('sem url, ou com url de fora do site: nada de lista; nome de campo malformado cai no padrão', () => {
    expect(busca({}).querySelector('ul')).toBeNull()
    for (const url of ['https://x.test/a', '//x.test/a', 'javascript:alert(1)', '/a b']) expect(ssr(pagina({ bloco: 'form/sugestoes-ao-vivo', props: { url } })).querySelector('ul'), url).toBeNull()
    const u = ssr(pagina({ bloco: 'form/sugestoes-ao-vivo', props: { url: '/x', titulo: 'a b', imagem: '"><x', limite: 10 } })).querySelector('ul')!; expect([u.getAttribute('data-titulo'), u.hasAttribute('data-imagem') ? 'tem' : 'nao', u.getAttribute('data-limite')]).toEqual(['titulo', 'tem', '10']) // nome de campo malformado cai no padrão (`titulo`, `imagem`); nada do valor vai ao atributo
  })
  it('o tema estiliza a lista (fundo, borda, miniatura) só com variáveis do tema', () => { const css = cssDoTema(TEMA_PADRAO); expect(css).toContain('ul[data-sugestoes-url]'); expect(css).toContain('[data-s-titulo]'); expect(css).toContain('ul[data-sugestoes-url] img{width:2.5rem') })
})

describe('menu lateral e painel (aplicação)', () => {
  const GRUPOS = [{ titulo: 'Conta', links: [{ texto: 'Perfil', href: '/perfil', atual: true }, { texto: 'Segurança', href: '/seguranca' }] }, { titulo: 'Loja', links: [{ texto: 'Pedidos', href: '/pedidos' }] }]
  const lateral = (props: Record<string, unknown>, slots?: Record<string, unknown>) => ssr(pagina({ bloco: 'site/menu-lateral', props, ...(slots ? { slots } : {}) } as never)).querySelector('aside')!
  it('é um <aside> com nome acessível, o botão "Seções" (alternador + rótulo) e um grupo por título, com aria-current na página aberta', () => {
    const a = lateral({ grupos: GRUPOS }); expect([a.getAttribute('aria-label'), a.hasAttribute('data-lateral')]).toEqual(['Navegação lateral', true])
    expect([a.firstElementChild!.tagName, a.firstElementChild!.getAttribute('role'), a.firstElementChild!.id, a.children[1]!.getAttribute('for'), a.children[1]!.textContent]).toEqual(['INPUT', 'switch', 'lateral-alternador', 'lateral-alternador', 'Seções'])
    const nav = a.querySelector('nav')!; expect(nav.getAttribute('aria-label')).toBe('Seções'); expect([...nav.querySelectorAll('small')].map((x) => x.textContent)).toEqual(['Conta', 'Loja']); expect([...nav.querySelectorAll('a')].map((x) => x.textContent)).toEqual(['Perfil', 'Segurança', 'Pedidos'])
    expect([...nav.querySelectorAll('a[aria-current]')].map((x) => x.textContent)).toEqual(['Perfil'])
  })
  it('os slots `topo` (antes do menu) e `filhos` (depois) recebem o que a página mandar; sem grupos não há <nav>', () => {
    const a = lateral({ grupos: GRUPOS }, { topo: [{ bloco: 'texto/titulo', props: { texto: 'Marca', nivel: 2 } }], filhos: [{ bloco: 'texto/paragrafo', props: { texto: 'Rodapé da lateral' } }] }); const k = [...a.children].map((c) => c.tagName.toLowerCase())
    expect(k).toEqual(['input', 'label', 'h2', 'nav', 'p']); expect(lateral({}).querySelector('nav')).toBeNull()
  })
  it('o painel ligado: layout/painel > header + aside + main; o tema faz a grade e recolhe a lateral no celular', () => {
    const d = ssr(pagina({ bloco: 'layout/painel', slots: { filhos: [{ bloco: 'site/cabecalho', props: { titulo: 'App' } }, { bloco: 'site/menu-lateral', props: { grupos: GRUPOS } }, { bloco: 'layout/principal', slots: { filhos: [{ bloco: 'texto/titulo', props: { texto: 'Olá', nivel: 1 } }] } }] } } as never)).querySelector('[data-painel]')!
    expect([...d.children].map((c) => c.tagName.toLowerCase())).toEqual(['header', 'aside', 'main'])
    const css = cssDoTema(TEMA_PADRAO); expect(css).toContain('[data-painel]{display:grid'); expect(css).toMatch(/@media \(max-width:40rem\)\{[^@]*\[data-lateral\]>input\[data-alternador\]:not\(:checked\)~\*:not\(label\)\{display:none\}/); expect(css).toContain('[data-lateral] nav button[aria-current]')
  })
  it('nav/botao com `atual` leva aria-current', () => { expect(ssr(pagina({ bloco: 'nav/botao', props: { texto: 'x', atual: true } })).querySelector('button')!.getAttribute('aria-current')).toBe('true'); expect(ssr(pagina({ bloco: 'nav/botao', props: { texto: 'x' } })).querySelector('button')!.hasAttribute('aria-current')).toBe(false) })
})

describe('título da marca como heading (tituloNivel)', () => {
  it('com `tituloNivel` a marca é um h1 (dentro do link); sem ele, texto em destaque', () => {
    const a = ssr(pagina(cab({ titulo: 'App', tituloNivel: 1 }))).querySelector('header > a')!; expect([a.querySelector('h1')!.textContent, a.querySelector('strong')]).toEqual(['App', null])
    const b = ssr(pagina(cab({ titulo: 'App' }))).querySelector('header > a')!; expect([b.querySelector('h1'), b.querySelector('strong')!.textContent]).toEqual([null, 'App'])
  })
})

describe('ícones (midia/icone e `icone` de botões e links)', () => {
  const um = (bloco: string, props: Record<string, unknown>) => ssr(pagina({ bloco, props } as never))
  it('midia/icone: um <span data-icone> decorativo por padrão; com `rotulo` vira imagem com nome; tamanho limitado e acento opcional', () => {
    const d = um('midia/icone', { nome: 'salvar' }).querySelector('span[data-icone]')!; expect([d.getAttribute('data-icone'), d.getAttribute('aria-hidden'), d.hasAttribute('role'), d.hasAttribute('data-acento'), d.hasAttribute('style')]).toEqual(['salvar', 'true', false, false, false])
    const r = um('midia/icone', { nome: 'layout-pilha', rotulo: 'Pilha', tamanho: 24, acento: true }).querySelector('span[data-icone]')!; expect([r.getAttribute('role'), r.getAttribute('aria-label'), r.hasAttribute('aria-hidden'), r.hasAttribute('data-acento'), r.getAttribute('style')]).toEqual(['img', 'Pilha', false, true, '--icone-tamanho:24px'])
    expect([tamanhoDeIcone(5000), tamanhoDeIcone(2), tamanhoDeIcone(20.4), tamanhoDeIcone('x'), tamanhoDeIcone(NaN)]).toEqual(['96px', '8px', '20px', undefined, undefined]) // o limite vale também para valor que vem de um dado
  })
  it('o runtime só aceita o FORMATO do nome (minúsculas e hífens): nada que escape do seletor chega ao atributo; a lista fechada vale na compilação e no CSS; botão e link levam data-icone só com nome bem formado', () => {
    for (const n of ['"] , body{x:y}', '__proto__', 'Salvar', 'salvar<', '', 'a b', 'x'.repeat(40), 'a-b-c-d']) expect(nomeDeIcone(n), n).toBeUndefined(); expect(nomeDeIcone('salvar')).toBe('salvar'); expect(nomeDeIcone('layout-pilha')).toBe('layout-pilha'); expect(nomeDeIcone(7)).toBeUndefined()
    expect(() => um('midia/icone', { nome: 'nao-existe' })).toThrow(/não é permitido/); expect(() => um('nav/botao', { texto: 'x', icone: 'salvar<' })).toThrow(/não é permitido/)
    expect(um('nav/botao', { texto: 'x', icone: 'salvar' }).querySelector('button')!.getAttribute('data-icone')).toBe('salvar'); expect(um('nav/botao', { texto: 'x' }).querySelector('button')!.hasAttribute('data-icone')).toBe(false)
    expect(um('nav/link', { href: '/x', texto: 'x', icone: 'entrar' }).querySelector('a')!.getAttribute('data-icone')).toBe('entrar')
  })
  it('o tema traz uma regra por ícone (duas imagens, só máscara: sem cor literal) e a estrutura dos três usos', () => {
    const css = cssDoTema(TEMA_PADRAO); expect((css.match(/\[data-icone=[a-z-]+\]\{--ic-base:/g) ?? []).length).toBe(60); expect(css).toContain('span[data-icone]::after'); expect(css).toContain(':is(button,a)[data-icone]::before')
    for (const n of ['salvar', 'layout-pilha', 'cartaz', 'tema-escuro']) expect(css, n).toContain(`[data-icone=${n}]{--ic-base:url("data:image/svg+xml,`)
  })
})

describe('lista de nomes dos ícones', () => {
  it('nomes.ts (o que o navegador carrega) coincide com dados.ts (as imagens que só o CSS usa)', async () => {
    const { ICONES, FAMILIAS_ICONES } = await import('../src/icones/dados'), { NOMES_ICONES } = await import('../src/icones/nomes')
    expect([...NOMES_ICONES].sort()).toEqual(Object.keys(ICONES).sort()); expect(FAMILIAS_ICONES.flatMap((f) => f[1]).sort()).toEqual([...NOMES_ICONES].sort()); expect(NOMES_ICONES.length).toBe(60)
    for (const [n, i] of Object.entries(ICONES)) { expect(i.base.length + i.acento.length, n).toBeGreaterThan(10); expect(i.base + i.acento, n).not.toMatch(/<script|on[a-z]+=|href=|javascript:/i) }
  })
})
