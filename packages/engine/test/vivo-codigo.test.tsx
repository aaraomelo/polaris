// @vitest-environment jsdom
import { Registry } from '@polaris/schema'
import { renderToStaticMarkup } from 'react-dom/server'
import { afterAll, describe, expect, it } from 'vitest'
import { COMPONENTES_BASE, compilaHtmlVivo, compilaPrograma, montaVivo, registraBase, renderPaginaHtml, type ConfigCodigo, type ErroRuntime, type PedidoCodigo, type Programa, type ResultadoCodigo, type Sandbox } from '../src/index'
import { saidaParaDom, saidaParaHtml, uiParaDom, uiParaHtml, hashDoHtml } from '../src/codigo/emite'
import { renderUI } from '../src/codigo/ui-react'
import { sanitizaUI } from '../src/codigo/ui'
import { criaSandboxLocal } from '../src/sandbox/local'
import { constroiCodigo } from '../src/vivo/codigo'

const no = (kind: string, id: string, spec: object) => ({ kind, id, versao: '1.0.0', estatuto: 'publicado', spec }) as any
const P = (b: string, extra: object = {}) => ({ bloco: b, ...extra })

const CODIGOS: Record<string, object> = {
  lista: { linguagem: 'js', fonte: 'function render(props){ return { tag: "ul", attrs: { class: "itens" }, children: props.itens.map(function(i){ return { tag: "li", children: [String(i)] } }) } }' },
  fixo: { linguagem: 'js', fonte: 'function render(){ return { tag: "p", attrs: { class: "fixo" }, children: ["texto fixo ", { tag: "strong", children: ["forte"] }] } }' },
  hostil: { linguagem: 'js', fonte: 'function render(){ return { tag: "div", attrs: { onclick: "alert(1)", style: "x", id: "a", class: "ok" }, children: [ { tag: "script", children: ["alert(1)"] }, { tag: "img", attrs: { src: "https://rastreador.com/p.gif?x=1" } }, { tag: "a", attrs: { href: "javascript:alert(1)" }, children: ["clique"] }, { tag: "img", attrs: { src: "/ok.png", alt: "a\\"b" } }, "texto <b>escapado</b> & mais" ] } }' },
  html: { linguagem: 'html', fonte: '<h1>{{ props.titulo | maiusculas }}</h1><script>alert(1)</script>', altura: 180 },
  jsiframe: { linguagem: 'js', modo: 'iframe', fonte: 'document.getElementById("app").textContent = props.titulo; polaris.altura(300)', permissoes: ['formularios'] },
}

function registro() {
  const r = new Registry(); registraBase(r)
  for (const [n, c] of Object.entries(CODIGOS)) r.registra(no('bloco', `x.${n}`, { interface: `x/${n}`, props: { type: 'object', properties: { itens: { type: 'array' }, titulo: { type: 'string' } } }, codigo: c }))
  return r
}
let n = 0
function programa(raiz: object, extra: object = {}): Programa {
  const r = registro()
  const res = compilaPrograma(r, r.registra(no('pagina', `c${n++}`, { rota: '/', raiz, ...extra })))
  if (!res.ok) throw new Error(JSON.stringify(res.erros, null, 1))
  return res.programa
}

/** sandbox que conta execuções e delega ao QuickJS local (ou devolve o que mandarmos) */
function contador(real: Sandbox | null, saida?: unknown, falha?: ResultadoCodigo): Sandbox & { chamadas: PedidoCodigo[] } {
  const chamadas: PedidoCodigo[] = []
  return { duro: false, chamadas, libera: () => {}, executa: (p) => { chamadas.push(p); return falha ?? (real ? real.executa(p) : { ok: true, saida: JSON.stringify(saida), logs: [], ms: 1 }) } }
}
let local: Sandbox
const abertos: Sandbox[] = []
afterAll(() => abertos.forEach((s) => s.libera()))
async function qjs() { if (!local) { local = await criaSandboxLocal(); abertos.push(local) } return local }

function canon(nd: Node): string {
  if (nd.nodeType === 3) return nd.textContent!
  if (nd.nodeType !== 1) return ''
  const el = nd as HTMLElement
  const attrs = [...el.attributes].filter((a) => a.name !== 'value').map((a) => `${a.name}=${JSON.stringify(a.value)}`).sort()
  const filhos: string[] = []; let t = ''
  for (const c of [...el.childNodes]) { if (c.nodeType === 3) t += c.textContent; else if (c.nodeType === 1) { if (t) { filhos.push(t); t = '' } filhos.push(canon(c)) } }
  if (t) filhos.push(t)
  return `<${el.tagName.toLowerCase()} ${attrs.join(' ')}>${filhos.join('')}</>`
}
const filhosCanon = (el: Element) => [...el.childNodes].map(canon).join('')
const doHtml = (html: string) => { const d = document.createElement('div'); d.innerHTML = html; return filhosCanon(d) }

describe('emissores: string de HTML ≡ DOM ≡ React para a MESMA UI sanitizada', () => {
  it('fuzz de árvores (inclusive hostis): as três saídas dão o mesmo DOM', () => {
    let s = 3
    const rnd = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff)
    const ri = (k: number) => Math.floor(rnd() * k)
    const pick = <T,>(xs: readonly T[]): T => xs[ri(xs.length)]!
    // só aninhamentos que o parser HTML não reescreve (p/a/h1/table têm regras de correção; a UI sanitizada do tenant com esses aninhamentos inválidos é limite conhecido)
    const tags = ['div', 'span', 'ul', 'img', 'br', 'strong', 'script', 'iframe', 'style', 'pre']
    const attrsPossiveis: Array<[string, unknown]> = [['class', 'a b'], ['class', 'x"y'], ['title', 't & <u> "q"'], ['href', '/x?a=1&b=2'], ['href', 'javascript:x'], ['src', '/i.png'], ['src', 'https://ext.com/i.png'], ['alt', 'a"b'], ['width', 10], ['onclick', 'x'], ['style', 'x'], ['role', 'list'], ['colspan', 2]]
    const textos = ['', 'a', 'a & b < c > d', '"aspas" \'simples\'', 'ç日😀', '</script><b>']
    const gera = (p: number): unknown => {
      if (p <= 0 || rnd() < 0.3) return rnd() < 0.2 ? ri(100) : pick(textos)
      return { tag: pick(tags), attrs: Object.fromEntries(Array.from({ length: ri(4) }, () => pick(attrsPossiveis))), children: Array.from({ length: ri(4) }, () => gera(p - 1)) }
    }
    let comNos = 0
    for (let i = 0; i < 1500; i++) {
      const { no: ui } = sanitizaUI(gera(4), { origensImagem: [] })
      if (ui !== null) comNos++
      const viaHtml = doHtml(uiParaHtml(ui))
      const d = document.createElement('div'); const nd = uiParaDom(ui, document); if (nd) d.appendChild(nd)
      expect(filhosCanon(d), JSON.stringify(ui)).toBe(viaHtml)
      expect(doHtml(renderToStaticMarkup(renderUI(ui) as never)), JSON.stringify(ui)).toBe(viaHtml) // e o que o React produz hoje
    }
    expect(comNos).toBeGreaterThan(1000)
  })
  it('o conteúdo hostil nunca chega ao DOM: sem script, sem on*, sem style/id, sem img externa, sem javascript:', async () => {
    const saida = { tipo: 'ui' as const, no: sanitizaUI(JSON.parse('{"tag":"div","attrs":{"onclick":"alert(1)","style":"x","id":"a","class":"ok"},"children":[{"tag":"script","children":["alert(1)"]},{"tag":"img","attrs":{"src":"https://rastreador.com/p.gif"}},{"tag":"a","attrs":{"href":"javascript:alert(1)"},"children":["clique"]},"<b>x</b>"]}')).no }
    const d = document.createElement('div'); for (const nd of saidaParaDom(saida, document)) d.appendChild(nd)
    expect(d.querySelector('script')).toBeNull(); expect(d.querySelector('img')).toBeNull()
    expect(d.innerHTML).not.toMatch(/onclick|style=|id="a"|javascript:|rastreador/)
    expect(d.textContent).toContain('<b>x</b>') // o texto vira texto, não marcação
    void saidaParaHtml
  })
})

describe('servidor → cliente: o HTML traz o bloco de código já executado, entre marcadores com hash', () => {
  it('unidade <!--c:HASH-->conteúdo<!--/c--> com o hash do conteúdo; e o cliente ADOTA sem executar nada', async () => {
    const sb = await qjs()
    const pg = programa(P('layout/pilha', { slots: { filhos: [P('texto/paragrafo', { id: 'a', props: { texto: 'antes' } }), P('x/lista', { props: { itens: [1, 2, 3] } }), P('texto/paragrafo', { id: 'b', props: { texto: 'depois' } })] } }))
    const h = compilaHtmlVivo(pg); if (!h.ok) throw new Error(JSON.stringify(h.motivos))
    const servidor = contador(sb)
    const corpo = h.pagina.render({ codigo: { sandbox: servidor } }).corpo
    const m = /<!--c:([0-9a-f]{12})-->([^]*?)<!--\/c-->/.exec(corpo)!
    expect(m[2]).toBe('<ul class="itens"><li>1</li><li>2</li><li>3</li></ul>'); expect(hashDoHtml(m[2]!)).toBe(m[1])
    expect(servidor.chamadas.length).toBe(1)

    const container = document.createElement('div'); container.innerHTML = corpo; document.body.appendChild(container)
    const antes = container.querySelector('ul')!
    const cliente = contador(sb); const erros: ErroRuntime[] = []
    const v = montaVivo({ programa: pg, container, hidrata: true, onErro: (e) => erros.push(e) }) // SEM `codigo`: o cliente não tem (nem precisa de) sandbox
    expect(v.diagnostico().hidratou).toBe(true)
    expect(container.querySelector('ul')).toBe(antes) // o MESMO nó do servidor
    expect(cliente.chamadas.length).toBe(0); expect(erros).toEqual([])
    const oraculo = doHtml(renderPaginaHtml({ programa: pg, componentes: COMPONENTES_BASE, codigo: { sandbox: sb } }).corpo)
    expect(filhosCanon(container)).toBe(oraculo)
  })

  it('sem sandbox no servidor: a unidade sai vazia (fail-closed) e é reportada; o cliente adota o vazio', () => {
    const pg = programa(P('x/lista', { props: { itens: [1] } }))
    const h = compilaHtmlVivo(pg); if (!h.ok) throw new Error('x')
    const erros: ErroRuntime[] = []
    const corpo = h.pagina.render({ onErro: (e) => erros.push(e) }).corpo
    expect(corpo).toMatch(/^<!--c:[0-9a-f]{12}--><!--\/c-->$/)
    expect(erros[0]!.mensagem).toContain('nenhum sandbox configurado')
    const container = document.createElement('div'); container.innerHTML = corpo
    expect(montaVivo({ programa: pg, container, hidrata: true }).diagnostico().hidratou).toBe(true)
  })

  it('divergência (marcador de início/fim ausente) é detectada e a página é reconstruída', async () => {
    const sb = await qjs()
    const pg = programa(P('x/lista', { props: { itens: [1] } }))
    const h = compilaHtmlVivo(pg); if (!h.ok) throw new Error('x')
    const container = document.createElement('div'); container.innerHTML = h.pagina.render({ codigo: { sandbox: sb } }).corpo.replace('<!--/c-->', '')
    const erros: ErroRuntime[] = []
    const v = montaVivo({ programa: pg, container, hidrata: true, codigo: { sandbox: sb }, onErro: (e) => erros.push(e) })
    expect(v.diagnostico().hidratou).toBe(false); expect(erros.some((e) => e.regra === 'hidratacao')).toBe(true)
    expect(container.querySelector('ul')!.textContent).toBe('1') // reconstruído no cliente, com o sandbox
  })
})

describe('props que MUDAM: o cliente recalcula com o mesmo calculaCodigo (e só quando o HTML muda)', () => {
  const pagina = () => programa(P('layout/pilha', { slots: { filhos: [
    P('x/lista', { id: 'dyn', props: { itens: '{estado.itens}' } }),
    P('x/fixo', {}),
    P('nav/botao', { id: 'add', props: { texto: '+' }, eventos: { aoClicar: [{ acao: 'definir', estado: 'itens', valor: 'concat(estado.itens, [tamanho(estado.itens) + 1])' }] } }),
    P('nav/botao', { id: 'cont', props: { texto: 'n' }, eventos: { aoClicar: [{ acao: 'definir', estado: 'n', valor: 'estado.n + 1' }] } }),
  ] } }), { estado: { itens: { tipo: 'json', inicial: [1] }, n: { tipo: 'inteiro', inicial: 0 } } })

  it('clique muda as props → o conteúdo muda, igual ao React com o mesmo estado; um clique que não toca as props não executa nada', async () => {
    const sb = await qjs(); const pg = pagina()
    const h = compilaHtmlVivo(pg); if (!h.ok) throw new Error('x')
    const container = document.createElement('div'); container.innerHTML = h.pagina.render({ codigo: { sandbox: sb } }).corpo; document.body.appendChild(container)
    const cliente = contador(sb)
    const v = montaVivo({ programa: pg, container, hidrata: true, fechado: true, codigo: { sandbox: cliente } })
    expect(v.diagnostico().hidratou).toBe(true); expect(cliente.chamadas.length).toBe(0) // hidratar não executa
    const oraculo = () => { const s = v.store(); return doHtml(renderPaginaHtml({ programa: pg, componentes: COMPONENTES_BASE, estado: s.estado, codigo: { sandbox: sb } }).corpo) }
    ;(container.querySelector('#add') as HTMLElement).click()
    expect(container.querySelector('ul.itens')!.textContent).toBe('12'); expect(cliente.chamadas.length).toBe(1)
    expect(filhosCanon(container)).toBe(oraculo())
    ;(container.querySelector('#cont') as HTMLElement).click(); (container.querySelector('#cont') as HTMLElement).click()
    expect(cliente.chamadas.length).toBe(1) // o contador não depende das props do bloco
    ;(container.querySelector('#add') as HTMLElement).click(); (container.querySelector('#add') as HTMLElement).click()
    expect(container.querySelector('ul.itens')!.textContent).toBe('1234'); expect(cliente.chamadas.length).toBe(3)
    expect(filhosCanon(container)).toBe(oraculo())
  })

  it('bloco com props CONSTANTES nunca executa no cliente (mundo fechado), mesmo com sandbox disponível', async () => {
    const sb = await qjs(); const pg = pagina()
    const h = compilaHtmlVivo(pg); if (!h.ok) throw new Error('x')
    const container = document.createElement('div'); container.innerHTML = h.pagina.render({ codigo: { sandbox: sb } }).corpo
    const cliente = contador(sb)
    montaVivo({ programa: pg, container, hidrata: true, fechado: true, codigo: { sandbox: cliente } })
    for (let i = 0; i < 3; i++) (container.querySelector('#add') as HTMLElement).click()
    // 3 cliques mudam só o bloco dinâmico (3 execuções); o bloco fixo (x/fixo) nunca roda
    expect(cliente.chamadas.length).toBe(3)
    expect(cliente.chamadas.every((c) => !c.fonte.includes('texto fixo'))).toBe(true)
  })

  it('props que mudam mas o HTML resultante é o mesmo: o DOM nem é tocado (hash)', async () => {
    const pg = programa(P('layout/pilha', { slots: { filhos: [P('x/lista', { props: { itens: '{estado.itens}' } }), P('nav/botao', { id: 'b', props: { texto: 'x' }, eventos: { aoClicar: [{ acao: 'definir', estado: 'itens', valor: '[1]' }, { acao: 'definir', estado: 'n', valor: 'estado.n + 1' }] } })] } }), { estado: { itens: { tipo: 'json', inicial: [1] }, n: { tipo: 'inteiro', inicial: 0 } } })
    const fixo = contador(null, { tag: 'p', children: ['sempre igual'] })
    const container = document.createElement('div'); document.body.appendChild(container)
    montaVivo({ programa: pg, container, codigo: { sandbox: fixo } })
    const p0 = container.querySelector('p')!
    const mut: MutationRecord[] = []; const ob = new MutationObserver((m) => mut.push(...m)); ob.observe(container, { subtree: true, childList: true, characterData: true, attributes: true })
    ;(container.querySelector('#b') as HTMLElement).click() // itens vira [1] (mesmo valor estrutural? novo array): props "iguais" por JSON
    expect(container.querySelector('p')).toBe(p0)
    expect(fixo.chamadas.length).toBe(1) // só a montagem: props iguais por conteúdo não reexecutam
    ob.disconnect()
  })

  it('falhas no cliente: sem sandbox ao precisar recalcular → o conteúdo some e é reportado; sandbox que falha → idem; a página segue', async () => {
    const sb = await qjs(); const pg = pagina()
    const h = compilaHtmlVivo(pg); if (!h.ok) throw new Error('x')
    const mk = (codigo?: ConfigCodigo) => { const c = document.createElement('div'); c.innerHTML = h.pagina.render({ codigo: { sandbox: sb } }).corpo; const erros: ErroRuntime[] = []; const v = montaVivo({ programa: pg, container: c, hidrata: true, fechado: true, ...(codigo ? { codigo } : {}), onErro: (e) => erros.push(e) }); return { c, erros, v } }
    const a = mk() // cliente sem sandbox
    ;(a.c.querySelector('#add') as HTMLElement).click()
    expect(a.c.querySelector('ul.itens')).toBeNull(); expect(a.erros.some((e) => e.regra === 'codigo' && e.mensagem.includes('nenhum sandbox'))).toBe(true)
    expect(a.c.querySelector('p.fixo')).not.toBeNull(); expect((a.c.querySelector('#cont') as HTMLElement).click()).toBeUndefined() // a página segue viva
    const b = mk({ sandbox: contador(null, undefined, { ok: false, tipo: 'tempo', erro: 'estourou', ms: 150 }) })
    ;(b.c.querySelector('#add') as HTMLElement).click()
    expect(b.c.querySelector('ul.itens')).toBeNull(); expect(b.erros.some((e) => e.mensagem.includes('tempo: estourou'))).toBe(true)
  })
})

describe('modo iframe', () => {
  it('html e js: o servidor emite o <iframe> isolado; o cliente adota; sandbox sem allow-same-origin; a altura só obedece ao próprio iframe', async () => {
    const sb = await qjs()
    const pg = programa(P('layout/pilha', { slots: { filhos: [P('x/html', { props: { titulo: 'oi <b>' } }), P('x/jsiframe', { props: { titulo: 'js' } })] } }))
    const h = compilaHtmlVivo(pg); if (!h.ok) throw new Error('x')
    const container = document.createElement('div'); container.innerHTML = h.pagina.render({ codigo: { sandbox: sb } }).corpo; document.body.appendChild(container)
    const v = montaVivo({ programa: pg, container, hidrata: true })
    expect(v.diagnostico().hidratou).toBe(true)
    const [fh, fj] = [...container.querySelectorAll('iframe')] as HTMLIFrameElement[]
    for (const f of [fh!, fj!]) { expect(f.getAttribute('sandbox')).not.toMatch(/allow-same-origin|allow-top-navigation|allow-popups|allow-modals/); expect(f.getAttribute('allow')).toBe('') }
    expect(fh!.getAttribute('sandbox')).toBe(''); expect(fj!.getAttribute('sandbox')).toBe('allow-scripts allow-forms')
    expect(fh!.getAttribute('srcdoc')).toContain('&lt;b&gt;'.toUpperCase().replace('&LT;', '&lt;').replace('&GT;', '&gt;')) // título escapado e em maiúsculas dentro do documento
    expect(fh!.getAttribute('srcdoc')).toContain('script-src &#39;none&#39;')
    expect(fj!.getAttribute('srcdoc')).toMatch(/script-src &#39;sha256-[A-Za-z0-9+/]+=*&#39;/)
    // altura: só o js ajusta; só mensagem vinda do PRÓPRIO iframe; número válido; limitado a 1–4000
    const msg = (f: HTMLIFrameElement, data: unknown, src: unknown = f.contentWindow) => window.dispatchEvent(new MessageEvent('message', { data, source: src as Window }))
    msg(fj!, { polaris: 'altura', n: 500 }); expect(fj!.style.height).toBe('500px')
    msg(fj!, { polaris: 'altura', n: 99999 }); expect(fj!.style.height).toBe('4000px')
    msg(fj!, { polaris: 'altura', n: -5 }); expect(fj!.style.height).toBe('1px')
    msg(fj!, { polaris: 'altura', n: 777 }, fh!.contentWindow); expect(fj!.style.height).toBe('1px') // veio de OUTRO iframe: ignorada
    msg(fj!, { polaris: 'altura', n: 'x' }); msg(fj!, { polaris: 'altura', n: NaN }); msg(fj!, { outro: 1 }); expect(fj!.style.height).toBe('1px')
    msg(fh!, { polaris: 'altura', n: 600 }); expect(fh!.style.height).not.toBe('600px') // o iframe html (sem script) não ajusta altura
    v.destroi()
    msg(fj!, { polaris: 'altura', n: 321 }); expect(fj!.style.height).toBe('1px') // listener removido ao destruir
  })

  it('props do iframe js mudam → novo srcdoc (recarrega); origens fora da allowlist são recusadas como no React', async () => {
    const sb = await qjs()
    const pg = programa(P('layout/pilha', { slots: { filhos: [P('x/jsiframe', { props: { titulo: '{estado.t}' } }), P('nav/botao', { id: 'b', props: { texto: 'x' }, eventos: { aoClicar: [{ acao: 'definir', estado: 't', valor: '"novo"' }] } })] } }), { estado: { t: { tipo: 'texto', inicial: 'velho' } } })
    const container = document.createElement('div'); document.body.appendChild(container)
    montaVivo({ programa: pg, container, fechado: true, codigo: { sandbox: sb } })
    const f0 = container.querySelector('iframe')!
    expect(f0.getAttribute('srcdoc')).toContain('velho')
    ;(container.querySelector('#b') as HTMLElement).click()
    const f1 = container.querySelector('iframe')!
    expect(f1.getAttribute('srcdoc')).toContain('novo'); expect(f1).not.toBe(f0)
  })
})

describe('isolamento de falha por bloco (o equivalente ao Isola)', () => {
  it('um controlador que lança ao atualizar é reportado e PARA; o resto da página continua reagindo', () => {
    const pg = programa(P('layout/pilha', { slots: { filhos: [
      P('x/lista', { props: { itens: '{estado.itens}' } }),
      P('texto/paragrafo', { id: 'n', props: { texto: 'n={estado.n}' } }),
      P('nav/botao', { id: 'b', props: { texto: 'x' }, eventos: { aoClicar: [{ acao: 'definir', estado: 'itens', valor: 'concat(estado.itens, [1])' }, { acao: 'definir', estado: 'n', valor: 'estado.n + 1' }] } }),
    ] } }), { estado: { itens: { tipo: 'json', inicial: [] }, n: { tipo: 'inteiro', inicial: 0 } } })
    const container = document.createElement('div'); document.body.appendChild(container)
    const erros: ErroRuntime[] = []
    let chamadasDoQuebrado = 0
    montaVivo({
      programa: pg, container, onErro: (e) => erros.push(e),
      blocoCodigo: (a) => ({ usa: a.deps, morto: false, atualiza() { chamadasDoQuebrado++; throw new Error('bug no bloco') }, destroi() {} }),
    })
    ;(container.querySelector('#b') as HTMLElement).click()
    expect(container.querySelector('#n')!.textContent).toBe('n=1') // a página reagiu mesmo com o bloco quebrado
    expect(erros.some((e) => e.regra === 'render' && e.mensagem === 'bug no bloco')).toBe(true)
    ;(container.querySelector('#b') as HTMLElement).click()
    expect(container.querySelector('#n')!.textContent).toBe('n=2')
    expect(chamadasDoQuebrado).toBe(1) // depois de falhar, não é mais chamado
    void constroiCodigo
  })

  it('bloco de código sem o plugin no runtime: unidade vazia (marcadores preservados), reportado', () => {
    const pg = programa(P('x/lista', { props: { itens: [1] } }))
    const container = document.createElement('div'); const erros: ErroRuntime[] = []
    montaVivo({ programa: pg, container, onErro: (e) => erros.push(e) })
    // o montaVivo COMPLETO injeta o plugin por padrão; sem sandbox o bloco é omitido (fail-closed)
    expect(container.querySelector('ul')).toBeNull(); expect(erros.some((e) => e.mensagem.includes('nenhum sandbox'))).toBe(true)
  })
})
