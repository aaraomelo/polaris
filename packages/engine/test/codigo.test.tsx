import { createHash } from 'node:crypto'
import { Registry } from '@polaris/schema'
import { JSDOM } from 'jsdom'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import {
  LIMITES_UI, atributoSandbox, compilaCodigo, construirCsp, documentoHtml, documentoJs, escapaHtml, foraDaAllowlist, hostPublicoValido, normalizaOrigem,
  parseHtmlTemplate, parsePermissoes, registraBase, renderHtmlTemplate, renderUI, sanitizaUI, sha256Base64, sha256Hex,
} from '../src/index'

describe('sha256 (CSP por hash precisa ser exato)', () => {
  it.each([
    ['', 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855'],
    ['abc', 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'],
    ['abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq', '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1'],
    ['a'.repeat(1_000_000), 'cdc76e5c9914fb9281a1c7e284d73e67f1809a48a497200e046d39ccc7112cd0'],
  ])('vetor oficial (%#)', (entrada, hex) => expect(sha256Hex(entrada)).toBe(hex))

  it('confere com o node:crypto em 2000 strings aleatórias (inclusive unicode e tamanhos de fronteira de bloco)', () => {
    let s = 7
    const rnd = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff)
    const alfabeto = ['a', 'Z', '0', 'ç', '日', '😀', ' ', '\n', '<', '"', ' ']
    for (let i = 0; i < 2000; i++) {
      const t = Array.from({ length: Math.floor(rnd() * 200) }, () => alfabeto[Math.floor(rnd() * alfabeto.length)]).join('')
      expect(sha256Hex(t), JSON.stringify(t)).toBe(createHash('sha256').update(t, 'utf8').digest('hex'))
    }
    for (const n of [54, 55, 56, 57, 63, 64, 65, 119, 120, 127, 128]) expect(sha256Hex('x'.repeat(n))).toBe(createHash('sha256').update('x'.repeat(n)).digest('hex'))
  })

  it('base64 no formato da CSP', () => {
    expect(sha256Base64('abc')).toBe(createHash('sha256').update('abc').digest('base64'))
  })
})

describe('origens e permissões', () => {
  it.each([
    ['https://api.exemplo.com', 'https://api.exemplo.com'], ['https://API.Exemplo.COM:8443', 'https://api.exemplo.com:8443'], ['https://a-b.c.org', 'https://a-b.c.org'], ['https://xn--caf-dma.com', 'https://xn--caf-dma.com'],
  ])('aceita %s', (e, n) => expect(normalizaOrigem(e)).toEqual({ ok: true, origem: n }))

  it.each([
    'http://api.exemplo.com', 'https://*.exemplo.com', 'https://exemplo.com/api', 'https://user@exemplo.com', 'https://exemplo.com?x=1', 'https://exemplo.com#a', 'ftp://exemplo.com',
    'https://localhost', 'https://localhost:3000', 'https://intranet', 'https://servidor.local', 'https://api.internal', 'https://x.lan', 'https://x.corp', 'https://x.home',
    'https://127.0.0.1', 'https://10.0.0.5', 'https://192.168.0.1:8080', 'https://169.254.169.254', 'https://[::1]', 'https://0x7f000001', 'https://2130706433',
    'https://exemplo.com:0', 'https://exemplo.com:65536', 'https://-a.com', 'https://a-.com', 'https://a..com', 'https://' + 'a'.repeat(64) + '.com', 'exemplo.com', '',
  ])('recusa %j', (e) => expect(normalizaOrigem(e).ok).toBe(false))

  it('hostPublicoValido explica o motivo', () => {
    expect(hostPublicoValido('localhost')).toContain('ponto')
    expect(hostPublicoValido('10.0.0.1')).toContain('IP')
    expect(hostPublicoValido('x.internal')).toContain('interna')
  })

  it('parsePermissoes: combina, normaliza, deduplica e acusa tudo de uma vez', () => {
    expect(parsePermissoes(['formularios', 'rede:https://A.com', 'rede:https://a.com', 'imagens:https://i.com'])).toEqual({ ok: true, permissoes: { formularios: true, rede: ['https://a.com'], imagens: ['https://i.com'] } })
    expect(parsePermissoes([])).toEqual({ ok: true, permissoes: { formularios: false, rede: [], imagens: [] } })
    const r = parsePermissoes(['rede:http://x.com', 'same-origin', 'imagens:https://127.0.0.1'])
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.erros).toHaveLength(3)
  })

  it('allowlist da plataforma: comparação exata, sem curinga', () => {
    const p = { formularios: false, rede: ['https://api.a.com'], imagens: ['https://img.a.com'] }
    expect(foraDaAllowlist(p, ['https://api.a.com', 'https://img.a.com'])).toEqual([])
    expect(foraDaAllowlist(p, ['https://api.a.com'])).toEqual(['https://img.a.com'])
    expect(foraDaAllowlist(p, [])).toEqual(['https://api.a.com', 'https://img.a.com'])
    expect(foraDaAllowlist(p, ['https://*.a.com', 'https://a.com'])).toHaveLength(2) // subdomínio não é liberado por "pai"
    expect(foraDaAllowlist(p, undefined)).toHaveLength(2) // sem allowlist: nada liberado (negado por padrão)
  })
})

describe('CSP e atributo sandbox', () => {
  const nada = { formularios: false, rede: [], imagens: [] }
  const tudo = { formularios: true, rede: ['https://api.a.com', 'https://b.com:8443'], imagens: ['https://img.a.com'] }

  it('modo html sem permissões: nada executa, nada sai', () => {
    expect(construirCsp('html', nada)).toBe("default-src 'none'; script-src 'none'; style-src 'unsafe-inline'; img-src data:; font-src data:; connect-src 'none'; form-action 'none'; base-uri 'none'; frame-src 'none'; object-src 'none'; worker-src 'none'; manifest-src 'none'; media-src 'none'")
    expect(atributoSandbox('html', nada)).toBe('')
  })

  it('modo js: só o script com o hash; rede e imagens só nas origens declaradas', () => {
    const csp = construirCsp('js', tudo, 'HASH==')
    expect(csp).toContain("script-src 'sha256-HASH=='")
    expect(csp).toContain('connect-src https://api.a.com https://b.com:8443')
    expect(csp).toContain('img-src data: https://img.a.com')
    expect(csp).toContain('form-action https://api.a.com https://b.com:8443')
    expect(atributoSandbox('js', tudo)).toBe('allow-scripts allow-forms')
  })

  it('formularios sem rede não envia a lugar nenhum', () => {
    expect(construirCsp('js', { formularios: true, rede: [], imagens: [] }, 'H')).toContain("form-action 'none'")
  })

  it('INVARIANTES (todas as combinações): sem unsafe-eval, sem curinga, sem http:, default-src none, sandbox nunca com same-origin/top-navigation/popups', () => {
    const proibidos = ['allow-same-origin', 'allow-top-navigation', 'allow-popups', 'allow-modals', 'allow-downloads', 'allow-pointer-lock', 'allow-presentation', 'allow-orientation-lock']
    for (const ling of ['js', 'html'] as const) for (const form of [false, true]) for (const rede of [[], ['https://a.com']]) for (const img of [[], ['https://i.com']]) {
      const p = { formularios: form, rede, imagens: img }
      const csp = construirCsp(ling, p, 'H')
      expect(csp).not.toContain('unsafe-eval')
      expect(csp).not.toContain('*')
      expect(csp).not.toMatch(/http:/)
      expect(csp.startsWith("default-src 'none'")).toBe(true)
      expect(csp).toContain("frame-src 'none'")
      expect(csp).toContain("base-uri 'none'")
      expect(csp).toContain("object-src 'none'")
      if (ling === 'html') expect(csp).toContain("script-src 'none'")
      const sb = atributoSandbox(ling, p)
      for (const f of proibidos) expect(sb).not.toContain(f)
      if (ling === 'html') expect(sb).not.toContain('allow-scripts')
    }
  })
})

describe('documento do iframe', () => {
  const nada = { formularios: false, rede: [], imagens: [] }
  const doc = (html: string) => new JSDOM(html).window.document // sem runScripts: nada executa

  it('js: o hash da CSP é o SHA-256 exato do conteúdo do <script> (se divergir, o navegador bloqueia)', () => {
    const d = documentoJs('document.getElementById("app").textContent = props.nome', { nome: 'Sol' }, nada)
    const dom = doc(d.srcDoc)
    const scripts = [...dom.querySelectorAll('script')]
    expect(scripts).toHaveLength(1)
    expect(d.csp).toContain(`'sha256-${sha256Base64(scripts[0]!.textContent!)}'`)
    expect(d.sandbox).toBe('allow-scripts')
    expect(dom.querySelector('meta[http-equiv="Content-Security-Policy"]')!.getAttribute('content')).toBe(d.csp)
  })

  it('a CSP é a PRIMEIRA coisa do <head> (vale antes de qualquer conteúdo)', () => {
    const dom = doc(documentoJs('1', {}, nada).srcDoc)
    expect(dom.head.firstElementChild!.tagName).toBe('META')
    expect(dom.head.children[1]!.getAttribute('http-equiv')).toBe('Content-Security-Policy')
  })

  it('props hostis não fecham o <script> nem escapam da string: continua um único script, e o hash bate', () => {
    const props = { a: '</script><script>alert(1)</script>', b: '<!--<script>', c: '  "\'\\', d: '</SCRIPT>' }
    const d = documentoJs('var x = props.a', props, nada)
    const dom = doc(d.srcDoc)
    expect(dom.querySelectorAll('script')).toHaveLength(1)
    expect(d.srcDoc.match(/<\/script>/gi)).toHaveLength(1)
    expect(d.csp).toContain(`'sha256-${sha256Base64(dom.querySelector('script')!.textContent!)}'`)
    // o JSON embutido volta idêntico quando o script é avaliado (a string literal é válida)
    const texto = dom.querySelector('script')!.textContent!
    const m = /JSON\.parse\(("(?:[^"\\]|\\.)*")\)/.exec(texto)!
    expect(JSON.parse(JSON.parse(m[1]!))).toEqual(props)
  })

  it('o código do autor com "</script>" não termina o script antes da hora', () => {
    const d = documentoJs('var s = "</script><img src=x onerror=alert(1)>"; var r = /<\\/script>/', {}, nada)
    const dom = doc(d.srcDoc)
    expect(dom.querySelectorAll('script')).toHaveLength(1)
    expect(dom.querySelector('img')).toBeNull()
  })

  it('html: o corpo entra no documento, sem script permitido e sem allow-scripts', () => {
    const d = documentoHtml('<h1>Oi</h1>', nada)
    expect(d.sandbox).toBe('')
    expect(d.csp).toContain("script-src 'none'")
    expect(doc(d.srcDoc).querySelector('h1')!.textContent).toBe('Oi')
  })

  it('a CSP no atributo content não pode ser fechada por aspas (nenhum " na política)', () => {
    for (const d of [documentoHtml('', { formularios: true, rede: ['https://a.com'], imagens: ['https://i.com'] }), documentoJs('1', {}, { formularios: true, rede: ['https://a.com'], imagens: ['https://i.com'] })]) {
      expect(d.csp).not.toContain('"')
    }
  })
})

describe('template de HTML ({{ }})', () => {
  const escopo = { props: { nome: '<b onclick=alert(1)>"x"</b>', n: 3, itens: ['a', 'b'] }, tenant: { nome: 'Sol' } }

  it('avalia expressões e SEMPRE escapa', () => {
    const t = parseHtmlTemplate('<p class="a">{{ props.nome }} / {{ tenant.nome | maiusculas }} / {{ props.n + 1 }}</p>', ['props', 'tenant'])
    expect(t.erros).toEqual([])
    expect(renderHtmlTemplate(t.partes, escopo)).toBe('<p class="a">&lt;b onclick=alert(1)&gt;&quot;x&quot;&lt;/b&gt; / SOL / 4</p>')
  })

  it('CSS e JS do autor com { } simples não são confundidos com binding', () => {
    const t = parseHtmlTemplate('<style>a { color: red } p::after { content: "}" }</style>{{ props.n }}', ['props'])
    expect(t.erros).toEqual([])
    expect(renderHtmlTemplate(t.partes, escopo)).toBe('<style>a { color: red } p::after { content: "}" }</style>3')
  })

  it('variável inexistente, expressão inválida e {{ sem fechar são erros com dica', () => {
    expect(parseHtmlTemplate('{{ propz.x }}', ['props', 'tenant']).erros[0]).toMatchObject({ dica: "quis dizer 'props'?" })
    expect(parseHtmlTemplate('{{ props. }}', ['props']).erros[0]!.mensagem).toContain('nome de um campo')
    expect(parseHtmlTemplate('abc {{ props.n', ['props']).erros[0]!.mensagem).toContain("'{{' sem fechar")
  })

  it('valor ausente vira vazio; objeto vira vazio (nunca [object Object])', () => {
    const t = parseHtmlTemplate('[{{ props.nada }}][{{ props }}]', ['props'])
    expect(renderHtmlTemplate(t.partes, escopo)).toBe('[][]')
  })

  it('escapaHtml cobre os cinco caracteres', () => { expect(escapaHtml(`&<>"'`)).toBe('&amp;&lt;&gt;&quot;&#39;') })
})

describe('descrição de UI (saída do modo puro)', () => {
  const ok = (x: unknown) => { const r = sanitizaUI(x); return r }
  const html = (x: unknown) => renderToStaticMarkup(renderUI(sanitizaUI(x).no) as never)

  it('renderiza a allowlist com atributos válidos', () => {
    expect(html({ tag: 'ul', attrs: { class: 'lista a-b' }, children: [{ tag: 'li', children: ['um'] }, { tag: 'li', children: [2] }, { tag: 'a', attrs: { href: '/x', title: 't' }, children: ['ir'] }] }))
      .toBe('<ul class="lista a-b"><li>um</li><li>2</li><a href="/x" title="t">ir</a></ul>')
    expect(html({ tag: 'img', attrs: { src: '/img/i.png', alt: 'a', width: 10 } })).toBe('<img src="/img/i.png" alt="a" width="10" referrerPolicy="no-referrer" loading="lazy" decoding="async"/>')
    expect(html({ tag: 'table', children: [{ tag: 'tr', children: [{ tag: 'td', attrs: { colspan: 2 }, children: ['x'] }] }] })).toBe('<table><tr><td colSpan="2">x</td></tr></table>')
  })

  it('tags perigosas são removidas e reportadas (script, iframe, style, form, input, svg, object, link, meta, base)', () => {
    for (const tag of ['script', 'iframe', 'style', 'form', 'input', 'svg', 'object', 'embed', 'link', 'meta', 'base', 'textarea', 'select', 'video', 'audio', 'math', 'template', 'noscript']) {
      const r = ok({ tag: 'div', children: [{ tag, children: ['x'] }, 'fica'] })
      expect(JSON.stringify(r.no), tag).toBe('{"tag":"div","children":["fica"]}')
      expect(r.violacoes[0]!.mensagem).toContain(`'${tag}'`)
    }
  })

  it('atributos perigosos são removidos: on*, style, id, name, srcdoc, formaction, target, ref, key, dangerouslySetInnerHTML', () => {
    const attrs = { onclick: 'alert(1)', onerror: 'x', onload: 'x', style: 'background:url(//evil)', id: 'x', name: 'y', srcdoc: '<b>', formaction: '/x', target: '_blank', dangerouslySetInnerHTML: { __html: '<b>' }, ref: 'r', key: 'k', is: 'x-y', slot: 's', contenteditable: 'true', class: 'ok' }
    const r = ok({ tag: 'div', attrs, children: [] })
    expect(r.no).toEqual({ tag: 'div', attrs: { class: 'ok' } })
    expect(r.violacoes).toHaveLength(Object.keys(attrs).length - 1)
  })

  it('URLs inseguras em href/src: javascript:, data:, vbscript:, file:, com truques de espaço/quebra de linha', () => {
    for (const u of ['javascript:alert(1)', ' JavaScript:alert(1)', 'java\nscript:alert(1)', 'data:text/html,<script>', 'vbscript:x', 'file:///etc/passwd', '\u0001javascript:x', 5, null, { toString: 'x' }]) {
      const a = ok({ tag: 'a', attrs: { href: u }, children: ['x'] })
      expect(a.no, JSON.stringify(u) ?? 'undefined').toEqual({ tag: 'a', children: ['x'] })
      const i = sanitizaUI({ tag: 'img', attrs: { src: u, alt: 'x' } }, { origensImagem: ['https://img.a.com'] })
      expect(i.no, JSON.stringify(u) ?? 'undefined').toBeNull() // imagem sem src válido é descartada inteira
    }
  })

  it('imagens: só do próprio site ou de origem liberada (senão seria canal de exfiltração dos dados das props)', () => {
    const src = (u: string, op?: { origensImagem?: string[] }) => sanitizaUI({ tag: 'img', attrs: { src: u, alt: 'x' } }, op).no
    // o ataque: o código monta a URL com dados que recebeu nas props
    expect(src('https://rastreador.com/p.gif?cpf=123.456.789-00')).toBeNull()
    expect(src('//rastreador.com/p.gif?x=1')).toBeNull()
    expect(src('/img/a.png')).toMatchObject({ attrs: { src: '/img/a.png' } })
    expect(src('img/a.png')).toBeNull() // relativo sem barra inicial também fora (sem ambiguidade)
    expect(src('https://img.a.com/a.png', { origensImagem: ['https://img.a.com'] })).toMatchObject({ attrs: { src: 'https://img.a.com/a.png' } })
    expect(src('https://IMG.a.com/a.png?x=1', { origensImagem: ['https://img.a.com'] })).toMatchObject({ attrs: { src: 'https://IMG.a.com/a.png?x=1' } })
    expect(src('https://outro.a.com/a.png', { origensImagem: ['https://img.a.com'] })).toBeNull()
    expect(src('https://img.a.com.evil.com/a.png', { origensImagem: ['https://img.a.com'] })).toBeNull()
    expect(src('https://img.a.com@evil.com/a.png', { origensImagem: ['https://img.a.com'] })).toBeNull()
    expect(src('http://img.a.com/a.png', { origensImagem: ['https://img.a.com'] })).toBeNull()
  })

  it('links externos ganham rel="noopener noreferrer"; relativos não', () => {
    expect(html({ tag: 'a', attrs: { href: 'https://a.com' }, children: ['x'] })).toBe('<a href="https://a.com" rel="noopener noreferrer">x</a>')
    expect(html({ tag: 'a', attrs: { href: '/x' }, children: ['x'] })).toBe('<a href="/x">x</a>')
  })

  it('valores de atributo são validados (class, role, números, dir, scope, aria-hidden)', () => {
    expect(ok({ tag: 'div', attrs: { class: 'a"onmouseover="x' } }).no).toEqual({ tag: 'div' })
    expect(ok({ tag: 'div', attrs: { class: 'a'.repeat(300) } }).no).toEqual({ tag: 'div' })
    expect(ok({ tag: 'div', attrs: { role: 'button' } }).no).toEqual({ tag: 'div' })
    expect(ok({ tag: 'div', attrs: { role: 'list' } }).no).toEqual({ tag: 'div', attrs: { role: 'list' } })
    expect(ok({ tag: 'img', attrs: { src: '/a.png', width: 0 } }).no).toEqual({ tag: 'img', attrs: { src: '/a.png' } })
    expect(ok({ tag: 'img', attrs: { src: '/a.png', width: '10' } }).no).toEqual({ tag: 'img', attrs: { src: '/a.png' } })
    expect(ok({ tag: 'div', attrs: { dir: 'ltr', 'aria-hidden': true } }).no).toEqual({ tag: 'div', attrs: { dir: 'ltr', 'aria-hidden': 'true' } })
    expect(ok({ tag: 'th', attrs: { scope: 'col' } }).no).toEqual({ tag: 'th', attrs: { scope: 'col' } })
    expect(ok({ tag: 'th', attrs: { scope: 'x' } }).no).toEqual({ tag: 'th' })
  })

  it('texto é sempre texto (escapado pelo React); tag em caixa alta é normalizada; filho em tag vazia é recusado', () => {
    expect(html({ tag: 'P', children: ['<script>alert(1)</script>'] })).toBe('<p>&lt;script&gt;alert(1)&lt;/script&gt;</p>')
    expect(ok({ tag: 'br', children: ['x'] }).violacoes[0]!.mensagem).toContain('não tem filhos')
    expect(html({ tag: 'br' })).toBe('<br/>')
  })

  it('entradas inválidas nunca lançam: null, lista, número solto, NaN, tag não-string, attrs/children de tipo errado', () => {
    for (const x of [null, undefined, [], [1], true, {}, { tag: 5 }, { tag: ['div'] }, { tag: 'div', attrs: [] }, { tag: 'div', attrs: 'x' }, { tag: 'div', children: 'x' }, { tag: 'div', children: [null, [], {}, true] }, Number.NaN]) {
      expect(() => sanitizaUI(x), JSON.stringify(x)).not.toThrow()
    }
    expect(sanitizaUI(5).no).toBe(5)
    expect(sanitizaUI('oi').no).toBe('oi')
    expect(sanitizaUI(Number.NaN).no).toBeNull()
  })

  it('protótipo: __proto__/constructor como tag ou atributo não passam', () => {
    expect(ok(JSON.parse('{"tag":"div","attrs":{"__proto__":{"x":1},"constructor":"x","class":"a"},"children":[]}')).no).toEqual({ tag: 'div', attrs: { class: 'a' } })
    expect(ok({ tag: '__proto__' }).no).toBeNull()
    expect(ok({ tag: 'constructor' }).no).toBeNull()
    expect(({} as Record<string, unknown>).x).toBeUndefined()
  })

  it('limites: nós, profundidade e tamanho de texto', () => {
    const muitos = ok({ tag: 'div', children: Array.from({ length: LIMITES_UI.nos + 100 }, () => ({ tag: 'span', children: ['x'] })) })
    expect(muitos.violacoes.some((v) => v.mensagem.includes('mais de'))).toBe(true)
    let fundo: unknown = 'x'
    for (let i = 0; i < 50; i++) fundo = { tag: 'div', children: [fundo] }
    expect(ok(fundo).violacoes.some((v) => v.mensagem.includes('profundidade'))).toBe(true)
    const t = ok({ tag: 'p', children: ['x'.repeat(LIMITES_UI.texto + 5)] })
    expect(t.violacoes[0]!.mensagem).toContain('caracteres')
    expect(JSON.stringify(t.no).length).toBeLessThan(LIMITES_UI.texto + 100)
  })
})

describe('compilaCodigo (validação da definição do bloco)', () => {
  const no = (id: string, codigo: object, extra: object = {}) => ({ kind: 'bloco', id, versao: '1.0.0', estatuto: 'publicado', spec: { interface: `x/${id}`, codigo, ...extra } }) as any
  const compila = (codigo: object) => { const r = new Registry(); registraBase(r); r.registra(no('c', codigo)); return compilaCodigo(r, 'x/c') }

  it('padrões: js → puro, html → iframe, altura 240', () => {
    expect(compila({ linguagem: 'js', fonte: 'function render(){}' })).toMatchObject({ ok: true, def: { modo: 'puro', altura: 240, permissoes: [] } })
    expect(compila({ linguagem: 'html', fonte: '<p>x</p>' })).toMatchObject({ ok: true, def: { modo: 'iframe', altura: 240 } })
    expect(compila({ linguagem: 'js', modo: 'iframe', fonte: 'x', altura: 500 })).toMatchObject({ ok: true, def: { modo: 'iframe', altura: 500 } })
  })

  it('html nunca é puro; puro não tem permissões nem altura', () => {
    expect(compila({ linguagem: 'html', modo: 'puro', fonte: 'x' })).toMatchObject({ ok: false, erros: [{ caminho: '/spec/codigo/modo', dica: expect.stringContaining('iframe') }] })
    expect(compila({ linguagem: 'js', fonte: 'x', permissoes: ['formularios'] })).toMatchObject({ ok: false, erros: [{ caminho: '/spec/codigo/permissoes' }] })
    expect(compila({ linguagem: 'js', fonte: 'x', altura: 100 })).toMatchObject({ ok: false, erros: [{ caminho: '/spec/codigo/altura' }] })
  })

  it('permissões inválidas no iframe: IP, localhost, rede interna (o schema só checa o formato)', () => {
    for (const p of ['rede:https://127.0.0.1', 'rede:https://localhost', 'imagens:https://10.0.0.1', 'rede:https://x.internal', 'rede:https://intranet']) {
      expect(compila({ linguagem: 'js', modo: 'iframe', fonte: 'x', permissoes: [p] }), p).toMatchObject({ ok: false })
    }
    expect(compila({ linguagem: 'js', modo: 'iframe', fonte: 'x', permissoes: ['rede:https://api.exemplo.com', 'formularios'] }).ok).toBe(true)
  })

  it('template HTML: variável inexistente e expressão inválida viram erro com caminho', () => {
    const r = compila({ linguagem: 'html', fonte: '<p>{{ propz.x }}</p>' })
    expect(r).toMatchObject({ ok: false, erros: [{ caminho: '/spec/codigo/fonte', dica: "quis dizer 'props'?" }] })
    expect(compila({ linguagem: 'html', fonte: '<p>{{ props.nome | maiusculas }}</p>' }).ok).toBe(true)
  })

  it('bloco sem código e bloco inexistente', () => {
    const r = new Registry(); registraBase(r)
    expect(compilaCodigo(r, 'layout/pilha')).toMatchObject({ ok: false, erros: [{ regra: 'codigo' }] })
    expect(compilaCodigo(r, 'nada/nada')).toMatchObject({ ok: false, erros: [{ regra: 'ref' }] })
  })

  it('herda o código via extends', () => {
    const r = new Registry(); registraBase(r)
    r.registra(no('base', { linguagem: 'js', fonte: 'function render(){ return 1 }' }))
    r.registra({ kind: 'bloco', id: 'filho', versao: '1.0.0', estatuto: 'publicado', spec: { interface: 'x/filho', extends: 'x/base' } } as any)
    expect(compilaCodigo(r, 'x/filho')).toMatchObject({ ok: true, def: { interface: 'x/filho', fonte: 'function render(){ return 1 }' } })
  })
})
