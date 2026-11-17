// @vitest-environment jsdom
import { Registry } from '@polaris/schema'
import { renderToStaticMarkup } from 'react-dom/server'
import { beforeEach, describe, expect, it } from 'vitest'
import { COMPONENTES_BASE, compilaEstatico, compilaHtmlVivo, compilaPrograma, montaVivo, registraBase, renderPaginaHtml } from '../src/index'
import { avalia, funcoesPadrao, parseExpr, validaExpr } from '../src/expr/index'
import { compilaExpr } from '../src/estatico/expr'
import { streamVivo, textoDoStreamVivo } from '../src/vivo/stream'

// Segurança do runtime (card 1dff4uhe33m): (1) nada de eval de string do usuário, (2) CSP, (3) sanitização, (4) allowlist de expressões.

const no = (kind: string, id: string, spec: object) => ({ kind, id, versao: '1.0.0', estatuto: 'publicado', spec }) as any
const P = (b: string, extra: object = {}) => ({ bloco: b, ...extra })
const g = globalThis as Record<string, unknown>
beforeEach(() => { delete g.__pwn })

// textos que quebram qualquer emissor de JS/HTML/JSON mal escapado
const HOSTIS = [
  '"; globalThis.__pwn = 1; //', "'; globalThis.__pwn = 1; //", '</script><script>globalThis.__pwn = 1</script>', '*/ globalThis.__pwn = 1; /*',
  ' globalThis.__pwn = 1 ', '\\', '\\"', '<img src=x onerror="globalThis.__pwn=1">', '<!--', '-->', ']]>', '<svg/onload=alert(1)>',
]

function programaHostil(texto: string) {
  const r = new Registry(); registraBase(r)
  const c = compilaPrograma(r, r.registra(no('pagina', `h${Math.random().toString(36).slice(2)}`, { rota: '/', titulo: 'T', estado: { s: { tipo: 'texto', inicial: texto } },
    raiz: P('layout/pilha', { slots: { filhos: [P('texto/paragrafo', { id: 'a', props: { texto } }), P('texto/paragrafo', { id: 'b', props: { texto: '{estado.s}' } }), P('nav/link', { id: 'c', props: { href: '/x', texto } }), P('entrada/texto', { id: 'd', props: { valor: texto, placeholder: texto } })] } }) })))
  if (!c.ok) throw new Error(JSON.stringify(c.erros))
  return c.programa
}
const doHtml = (html: string) => { const d = document.createElement('div'); d.innerHTML = html; return d }

describe('1. nenhuma string do usuário vira código', () => {
  it.each(HOSTIS)('texto hostil %j: o gerador de JS (estático e vivo), o SSR React e o cliente tratam como DADO', (h) => {
    const pg = programaHostil(h)
    const est = compilaEstatico(pg); const viv = compilaHtmlVivo(pg)
    const alvo = (s: string) => s
    // 1) HTML estático e vivo gerados por new Function a partir do programa
    for (const m of [est, viv]) {
      if (!m.ok) continue
      const corpo = m.pagina.render({}).corpo
      expect(g.__pwn, 'executou código do texto').toBeUndefined()
      const d = doHtml(corpo)
      expect(d.querySelector('script, img[onerror], svg')).toBeNull()
      expect(d.querySelector('#a')!.textContent).toBe(alvo(h)); expect(d.querySelector('#b')!.textContent).toBe(h)
    }
    // 2) o oráculo React produz o mesmo texto
    const oraculo = doHtml(renderPaginaHtml({ programa: pg, componentes: COMPONENTES_BASE }).corpo)
    expect(oraculo.querySelector('#a')!.textContent).toBe(h)
    // 3) o cliente (DOM API)
    const c = document.createElement('div'); document.body.appendChild(c)
    montaVivo({ programa: pg, container: c })
    expect(g.__pwn).toBeUndefined(); expect(c.querySelector('script, img[onerror], svg')).toBeNull()
    expect(c.querySelector('#a')!.textContent).toBe(h); expect((c.querySelector('#d') as HTMLInputElement).value).toBe(h)
    void renderToStaticMarkup
  })
  it('o código-fonte não tem eval, new Function, innerHTML=, document.write nem timers com string, fora dos 3 pontos revisados', async () => {
    const { readdirSync, readFileSync, statSync } = await import('node:fs')
    const { join, relative } = await import('node:path')
    const raiz = join(__dirname, '..', 'src')
    const arquivos: string[] = []
    const anda = (d: string) => { for (const f of readdirSync(d)) { const c = join(d, f); statSync(c).isDirectory() ? anda(c) : /\.(ts|tsx)$/.test(c) && arquivos.push(c) } }
    anda(raiz)
    const PERIGOSOS = /\beval\s*\(|new\s+Function\s*\(|(?<![.\w])Function\s*\(|\.innerHTML\s*=|insertAdjacentHTML|document\.write|set(Timeout|Interval)\s*\(\s*['"`]/
    // revisados: gera.ts (new Function sobre código que o próprio gerador emite, com todo literal em JSON.stringify), sintaxe.ts (roda DENTRO do QuickJS),
    // stream.ts (template.innerHTML no script de boot, só com HTML que o servidor escapou), sandbox/* (isolamento), render/interpreta.tsx (JSON já escapado por jsonSeguro)
    const PERMITIDOS = ['estatico/gera.ts', 'codigo/sintaxe.ts', 'vivo/stream.ts', 'render/interpreta.tsx']
    const achados: string[] = []
    for (const f of arquivos) {
      const rel = relative(raiz, f)
      if (rel.startsWith('sandbox/') || PERMITIDOS.includes(rel)) continue
      readFileSync(f, 'utf8').split('\n').forEach((l, i) => { const codigo = l.replace(/\/\/.*$/, '').replace(/^\s*\*.*$/, ''); if (PERIGOSOS.test(codigo)) achados.push(`${rel}:${i + 1}: ${l.trim()}`) })
    }
    expect(achados).toEqual([])
  })
})

describe('4. allowlist de expressões: só funções registradas, sem alcançar o protótipo nem o global', () => {
  const ESC = { estado: { nome: 'x', lista: [1, 2], o: { a: 1 } }, props: {}, p: { n: 1 } }
  const ATAQUES = [
    'estado.constructor', 'estado.__proto__', 'estado.constructor.constructor("globalThis.__pwn=1")()', 'estado.nome.constructor', 'estado.lista.constructor',
    'estado.o.__proto__.polluido', 'estado.toString()', 'estado.hasOwnProperty("a")', 'eval("globalThis.__pwn=1")', 'Function("globalThis.__pwn=1")()', 'constructor("x")',
    'globalThis', 'process', 'window', 'this', 'estado["__proto__"]', 'estado["constructor"]["constructor"]("globalThis.__pwn=1")()',
    'chama(estado, "constructor")', 'obter(estado, "__proto__")', 'obter(estado.lista, "constructor")',
  ]
  const funcoes = funcoesPadrao()
  it.each(ATAQUES)('%s não executa código, não devolve função nem o protótipo', (src) => {
    let valor: unknown, caiu = false
    try { const p = parseExpr(src); if (p) valor = avalia(p, ESC as never, funcoes) } catch { caiu = true }
    let compilado: unknown; let caiu2 = false
    try { const f = compilaExpr(parseExpr(src), funcoes); compilado = f(ESC as never) } catch { caiu2 = true }
    for (const v of [valor, compilado]) {
      expect(typeof v).not.toBe('function')
      expect(v === Object.prototype || v === Function.prototype || v === Array.prototype || v === String.prototype).toBe(false)
    }
    expect(g.__pwn).toBeUndefined()
    expect(({} as Record<string, unknown>).polluido).toBeUndefined()
    void caiu; void caiu2
  })
  it('função fora do registro é recusada na análise (não chega ao runtime)', () => {
    for (const f of ['eval("1")', 'Function("1")()', 'setTimeout("1", 0)', 'fetch("/x")', 'constructor("1")']) {
      let recusada = false
      try { recusada = validaExpr(parseExpr(f), ['estado', 'props', 'p']).length > 0 } catch { recusada = true } // recusa no parser ou na análise
      expect(recusada, f).toBe(true)
    }
  })
})

describe('3. sanitização de URL e atributos', () => {
  // o que o navegador faz antes de olhar o esquema: apara U+0000–U+0020 nas pontas e ignora tab/CR/LF (NBSP NÃO é aparado)
  const navega = (x: string) => x.replace(/^[\u0000-\u0020]+|[\u0000-\u0020]+$/g, '').replace(/[\t\r\n]/g, '').toLowerCase()
  it('href/src perigosos (javascript:, data:text/html, vbscript:, com espaço/controle/NBSP) nunca saem', () => {
    const r = new Registry(); registraBase(r)
    const URLS = ['javascript:alert(1)', 'JaVaScRiPt:alert(1)', ' javascript:alert(1)', ' javascript:alert(1)', 'java\tscript:alert(1)', 'data:text/html,<script>alert(1)</script>', 'vbscript:x', '//evil.com/x']
    for (const u of URLS) {
      const c = compilaPrograma(r, r.registra(no('pagina', `u${Math.random().toString(36).slice(2)}`, { rota: '/', raiz: P('layout/pilha', { slots: { filhos: [P('nav/link', { id: 'l', props: { href: u, texto: 'x' } }), P('midia/imagem', { id: 'i', props: { src: u, alt: 'a' } })] } }) })))
      if (!c.ok) throw new Error('x')
      for (const html of [renderPaginaHtml({ programa: c.programa, componentes: COMPONENTES_BASE }).corpo, (compilaHtmlVivo(c.programa) as any).pagina.render({}).corpo]) {
        const d = doHtml(html)
        const hrefs = [...d.querySelectorAll('[href],[src]')].map((e) => navega(e.getAttribute('href') ?? e.getAttribute('src') ?? ''))
        for (const h of hrefs) expect(h, [...u].map((c) => c.charCodeAt(0).toString(16)).slice(0, 3).join(',') + ' em ' + html.slice(0, 200)).not.toMatch(/^(javascript|data|vbscript):/)
      }
      const cont = document.createElement('div'); montaVivo({ programa: c.programa, container: cont })
      for (const e of cont.querySelectorAll('[href],[src]')) expect(navega(e.getAttribute('href') ?? e.getAttribute('src') ?? '')).not.toMatch(/^(javascript|data|vbscript):/)
    }
  })
  it('nenhum atributo on* sai no HTML do servidor (nem mesmo nos blocos interativos)', () => {
    const pg = programaHostil('x')
    const d = doHtml((compilaHtmlVivo(pg) as any).pagina.render({}).corpo)
    for (const el of d.querySelectorAll('*')) for (const a of el.attributes) expect(a.name, el.outerHTML).not.toMatch(/^on/i)
  })
})

describe('2. CSP: nada executa sem nonce; o documento de streaming não depende de unsafe-inline', () => {
  it('todo <script> executável tem o nonce; os dados são application/json; nenhum handler inline', async () => {
    const pg = programaHostil('</script><script>globalThis.__pwn=1</script>')
    const doc = await textoDoStreamVivo(streamVivo(pg, { provedores: { servico: async () => null }, clienteSrc: '/c.js', nonce: 'N0nc3' }))
    const d = doHtml(doc.replace(/^<!doctype html>/i, '')); // jsdom: parse do documento todo no div
    const scripts = [...document.implementation.createHTMLDocument('x').documentElement.appendChild(document.createElement('div')).ownerDocument.createElement('div').querySelectorAll('script')]
    void scripts; void d
    const parsed = new DOMParser().parseFromString(doc, 'text/html')
    const exec = [...parsed.querySelectorAll('script')].filter((s) => !/json/.test(s.getAttribute('type') ?? ''))
    expect(exec.length).toBeGreaterThan(0)
    for (const s of exec) expect(s.getAttribute('nonce'), s.outerHTML.slice(0, 80)).toBe('N0nc3')
    for (const s of parsed.querySelectorAll('script[type="application/json"]')) expect(() => JSON.parse(s.textContent ?? '')).not.toThrow()
    for (const el of parsed.querySelectorAll('*')) for (const a of el.attributes) expect(a.name).not.toMatch(/^on/i)
    expect(doc).not.toMatch(/javascript:/i)
  })
  it('o script de boot é estático (hash estável): serve para CSP por hash também', async () => {
    const pg = programaHostil('a')
    const a = await textoDoStreamVivo(streamVivo(pg, { provedores: { servico: async () => null }, clienteSrc: '/c.js' }))
    const b = await textoDoStreamVivo(streamVivo(programaHostil('outro texto'), { provedores: { servico: async () => null }, clienteSrc: '/c.js' }))
    const boot = (s: string) => /<head>.*?<script>([^]*?)<\/script>/.exec(s)![1]
    expect(boot(a)).toBe(boot(b))
  })
})
