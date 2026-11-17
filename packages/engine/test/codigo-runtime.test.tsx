import { Registry } from '@polaris/schema'
import { JSDOM } from 'jsdom'
import { afterAll, describe, expect, it } from 'vitest'
import {
  COMPONENTES_BASE, compilaPrograma, registraBase, renderPaginaHtml, type ConfigCodigo, type ErroRuntime, type PedidoCodigo, type Programa, type ResultadoCodigo, type Sandbox,
} from '../src/index'
import { criaSandboxWorker } from '../src/sandbox/worker'
import { renderPaginaStream, textoDoStream } from '../src/render/stream'

const no = (kind: string, id: string, spec: object) => ({ kind, id, versao: '1.0.0', estatuto: 'publicado', spec }) as any
const P = (b: string, extra: object = {}) => ({ bloco: b, ...extra })
const AGORA = '2026-06-08T12:00:00.000Z'

const CODIGOS: Record<string, object> = {
  lista: { linguagem: 'js', fonte: 'function render(props){ return { tag: "ul", attrs: { class: "itens" }, children: props.itens.map(function(i){ return { tag: "li", children: [String(i)] } }) } }' },
  relogio: { linguagem: 'js', fonte: 'function render(props, ctx){ return { tag: "p", children: [ctx.agora + "|" + Date.now() + "|" + new Date().getFullYear() + "|" + ctx.idioma + "|" + Math.random().toFixed(6)] } }' },
  hostil: { linguagem: 'js', fonte: 'function render(){ return { tag: "div", attrs: { onclick: "alert(1)", style: "x", id: "a", class: "ok" }, children: [ { tag: "script", children: ["alert(1)"] }, { tag: "img", attrs: { src: "https://rastreador.com/p.gif?x=1" } }, { tag: "a", attrs: { href: "javascript:alert(1)" }, children: ["clique"] }, "texto <b>escapado</b>" ] } }' },
  laco: { linguagem: 'js', fonte: 'function render(){ while(true){} }' },
  sintaxe: { linguagem: 'js', fonte: 'function render( {' },
  erro: { linguagem: 'js', fonte: 'function render(){ throw new Error("falhou") }' },
  html: { linguagem: 'html', fonte: '<h1>{{ props.titulo }}</h1><style>h1{color:red}</style><script>alert(1)</script>', altura: 180 },
  htmlrede: { linguagem: 'html', fonte: '<p>x</p>', permissoes: ['imagens:https://img.a.com', 'rede:https://api.a.com'] },
  jsiframe: { linguagem: 'js', modo: 'iframe', fonte: 'document.getElementById("app").textContent = props.titulo; polaris.altura(300)', permissoes: ['formularios'] },
}

function monta(extra?: (r: Registry) => void) {
  const r = new Registry()
  registraBase(r)
  for (const [n, c] of Object.entries(CODIGOS)) r.registra(no('bloco', `x.${n}`, { interface: `x/${n}`, props: { type: 'object', properties: { itens: { type: 'array' }, titulo: { type: 'string' } } }, codigo: c }))
  r.registra(no('bloco', 'x.cartao', { interface: 'x/cartao', modelo: P('layout/pilha', { slots: { filhos: [P('x/lista', { props: { itens: [1, 2] } })] } }) }))
  r.registra(no('servico', 'catalogo', { entidades: {}, operacoes: {} }))
  r.registra(no('dados', 'd.loja', { fonte: { tipo: 'servico', servico: 'catalogo', operacao: 'loja' } }))
  extra?.(r)
  return r
}
let n = 0
const programa = (raiz: object, extra: object = {}, r = monta()): Programa => {
  const res = compilaPrograma(r, r.registra(no('pagina', `p${n++}`, { rota: '/', raiz, ...extra })))
  if (!res.ok) throw new Error(JSON.stringify(res.erros, null, 1))
  return res.programa
}

const abertos: Sandbox[] = []
afterAll(() => abertos.forEach((s) => s.libera()))
const novoWorker = async () => { const s = await criaSandboxWorker({ margemDuraMs: 150 }); abertos.push(s); return s }

/** Sandbox de mentira que conta execuções e devolve o que mandarmos: para testar orçamento e cache sem depender de tempo. */
function falso(saida: unknown = { tag: 'p', children: ['ok'] }, ms = 1): Sandbox & { chamadas: PedidoCodigo[] } {
  const chamadas: PedidoCodigo[] = []
  return { duro: false, chamadas, libera: () => {}, executa: (p): ResultadoCodigo => { chamadas.push(p); return { ok: true, saida: JSON.stringify(saida), logs: [], ms } } }
}

const ssr = (pg: Programa, codigo: ConfigCodigo | undefined, extra: object = {}) => {
  const erros: ErroRuntime[] = []
  const s = renderPaginaHtml({ programa: pg, componentes: COMPONENTES_BASE, ...(codigo ? { codigo } : {}), onErro: (e) => erros.push(e), ...extra })
  return { ...s, erros }
}

describe('modo puro: o código calcula a UI, o host valida e renderiza', () => {
  it('renderiza a descrição devolvida (SSR) a partir das props do bloco', async () => {
    const sb = await novoWorker()
    const s = ssr(programa(P('x/lista', { props: { itens: ['a', 2, '<b>'] } })), { sandbox: sb, agora: AGORA })
    expect(s.corpo).toBe('<ul class="itens"><li>a</li><li>2</li><li>&lt;b&gt;</li></ul>')
    expect(s.erros).toEqual([])
  })

  it('props vêm de bindings da página (dados) e o texto do dado nunca vira HTML', async () => {
    const sb = await novoWorker()
    const pg = programa(P('x/lista', { props: { itens: '{loja.itens}' } }), { dados: { loja: 'd.loja' } })
    const s = ssr(pg, { sandbox: sb, agora: AGORA }, { dados: { loja: { itens: ['<script>alert(1)</script>', '<img src=x onerror=alert(1)>'] } } })
    expect(s.corpo).not.toContain('<script')
    expect(s.corpo).not.toContain('<img')
    expect(s.corpo).toContain('&lt;script&gt;alert(1)&lt;/script&gt;')
  })

  it('SAÍDA HOSTIL: tag script, onclick/style/id, imagem de rastreador, javascript: são removidos; o resto renderiza; cada violação é reportada', async () => {
    const sb = await novoWorker()
    const s = ssr(programa(P('x/hostil')), { sandbox: sb, agora: AGORA })
    expect(s.corpo).toBe('<div class="ok"><a>clique</a>texto &lt;b&gt;escapado&lt;/b&gt;</div>')
    const msgs = s.erros.map((e) => e.mensagem).join('\n')
    for (const esperado of ["'script' não é permitida", "atributo 'onclick'", "atributo 'style'", "atributo 'id'", 'src', "'href' com URL"]) expect(msgs).toContain(esperado)
    expect(s.erros.every((e) => e.regra === 'codigo')).toBe(true)
  })

  it('falhas (laço infinito, sintaxe, exceção): o bloco é omitido, reportado, e o resto da página sai', async () => {
    const sb = await novoWorker()
    for (const [bloco, tipo] of [['laco', 'tempo'], ['sintaxe', 'sintaxe'], ['erro', 'execucao']] as const) {
      const t0 = Date.now()
      const s = ssr(programa(P('layout/pilha', { slots: { filhos: [P(`x/${bloco}`), P('texto/paragrafo', { props: { texto: 'resto' } })] } })), { sandbox: sb, agora: AGORA })
      expect(s.corpo, bloco).toContain('<p>resto</p>')
      expect(s.erros.some((e) => e.mensagem.includes(`${tipo}:`) && e.caminho === '/spec/raiz/slots/filhos/0'), bloco).toBe(true)
      expect(Date.now() - t0).toBeLessThan(3000)
    }
  })

  it('sem sandbox configurado, blocos de código são omitidos com uma mensagem clara (nunca executam)', () => {
    const s = ssr(programa(P('layout/pilha', { slots: { filhos: [P('x/lista', { props: { itens: [1] } }), P('texto/paragrafo', { props: { texto: 'resto' } })] } })), undefined)
    expect(s.corpo).toBe('<div style="display:flex;flex-direction:column"><p>resto</p></div>')
    expect(s.erros[0]!.mensagem).toContain('nenhum sandbox configurado')
  })

  it('o contexto chega ao código: agora fixo, idioma, tenant; a saída é determinística', async () => {
    const sb = await novoWorker()
    const pg = programa(P('x/relogio'))
    const a = ssr(pg, { sandbox: sb, agora: AGORA }, { idioma: 'en', tenant: { nome: 'Sol' } })
    const b = ssr(pg, { sandbox: sb, agora: AGORA }, { idioma: 'en', tenant: { nome: 'Sol' } })
    expect(a.corpo).toBe(b.corpo)
    expect(a.corpo).toMatch(new RegExp(`^<p>${AGORA.replace(/[.]/g, '\\.')}\\|${Date.parse(AGORA)}\\|2026\\|en\\|0\\.\\d{6}</p>$`))
    expect(ssr(pg, { sandbox: sb, agora: '2030-01-01T00:00:00.000Z' }, { idioma: 'en' }).corpo).toContain('|2030|')
  })

  it('o estado do cliente leva o `agora`, para o navegador reproduzir a mesma saída', async () => {
    const sb = await novoWorker()
    expect(ssr(programa(P('x/relogio')), { sandbox: sb, agora: AGORA }, { idioma: 'pt-BR' }).estado.agora).toBe(AGORA)
  })
})

describe('orçamento e cache (proteção do servidor)', () => {
  it('o mesmo (código, props) executa UMA vez, mesmo repetido 50 vezes; props diferentes executam de novo', () => {
    const sb = falso()
    const pg = programa(P('layout/pilha', { slots: { filhos: [P('x/lista', { repetir: { cada: 'itens', como: 'i' }, props: { itens: ['sempre', 'igual'] } })] } }), { dados: { itens: 'd.loja' } })
    ssr(pg, { sandbox: sb }, { dados: { itens: Array.from({ length: 50 }, (_, k) => k) } })
    expect(sb.chamadas).toHaveLength(1)
    const sb2 = falso()
    const pg2 = programa(P('layout/pilha', { slots: { filhos: [P('x/lista', { repetir: { cada: 'itens', como: 'i' }, props: { itens: ['{i}'] } })] } }), { dados: { itens: 'd.loja' } })
    ssr(pg2, { sandbox: sb2 }, { dados: { itens: [1, 2, 3] } })
    expect(sb2.chamadas).toHaveLength(3)
  })

  it('maxExecucoes: passado o limite, os blocos restantes são omitidos e reportados (orçamento)', () => {
    const sb = falso()
    const pg = programa(P('layout/pilha', { slots: { filhos: [P('x/lista', { repetir: { cada: 'itens', como: 'i' }, props: { itens: ['{i}'] } })] } }), { dados: { itens: 'd.loja' } })
    const s = ssr(pg, { sandbox: sb, maxExecucoes: 5 }, { dados: { itens: Array.from({ length: 20 }, (_, k) => k) } })
    expect(sb.chamadas).toHaveLength(5)
    expect(s.corpo.match(/<p>ok<\/p>/g)).toHaveLength(5)
    expect(s.erros.filter((e) => e.mensagem.includes('orcamento'))).toHaveLength(15)
  })

  it('orcamentoMs: some o tempo gasto nas execuções; esgotado, o resto é omitido', () => {
    const sb = falso({ tag: 'p', children: ['ok'] }, 400)
    const pg = programa(P('layout/pilha', { slots: { filhos: [P('x/lista', { repetir: { cada: 'itens', como: 'i' }, props: { itens: ['{i}'] } })] } }), { dados: { itens: 'd.loja' } })
    const s = ssr(pg, { sandbox: sb, orcamentoMs: 1000 }, { dados: { itens: [1, 2, 3, 4, 5, 6] } })
    expect(sb.chamadas).toHaveLength(3) // 400 + 400 + 400 >= 1000
    expect(s.erros.some((e) => e.mensagem.includes('orçamento de 1000 ms'))).toBe(true)
  })

  it('uma FALHA também é cacheada: um bloco que estourou o prazo não é tentado de novo a cada render', async () => {
    const chamadas: PedidoCodigo[] = []
    const sb: Sandbox = { duro: true, libera: () => {}, executa: (p) => { chamadas.push(p); return { ok: false, tipo: 'tempo', erro: 'x', ms: 150 } } }
    const pg = programa(P('layout/pilha', { slots: { filhos: [P('x/laco', { repetir: { cada: 'itens', como: 'i' } })] } }), { dados: { itens: 'd.loja' } })
    ssr(pg, { sandbox: sb }, { dados: { itens: [1, 2, 3, 4] } })
    expect(chamadas).toHaveLength(1)
  })
})

describe('modo iframe: HTML/JS isolados', () => {
  const doc = (corpo: string) => /<iframe[^>]*>/.exec(corpo)![0]
  const attr = (tag: string, nome: string) => new RegExp(`${nome}="([^"]*)"`).exec(tag)?.[1]

  it('html: sandbox vazio (nenhum script), CSP sem script, props escapadas e altura declarada', async () => {
    const sb = await novoWorker()
    const s = ssr(programa(P('x/html', { props: { titulo: '</h1><script>alert(1)</script>' } })), { sandbox: sb, agora: AGORA })
    const tag = doc(s.corpo)
    expect(attr(tag, 'sandbox')).toBe('')
    expect(attr(tag, 'referrerPolicy')).toBe('no-referrer')
    expect(tag).toContain('allow=""')
    expect(tag).toContain('height:180px')
    const iframe = new DOMParserLike(s.corpo)
    expect(iframe.csp()).toContain("script-src 'none'")
    expect(iframe.srcdoc()).toContain('&lt;/h1&gt;&lt;script&gt;alert(1)&lt;/script&gt;') // o dado foi escapado
    expect(iframe.srcdoc()).toContain('<script>alert(1)</script>') // o <script> do AUTOR está lá, mas a CSP e o sandbox o impedem de executar
  })

  it('js em iframe: allow-scripts, nunca allow-same-origin; formularios libera allow-forms', async () => {
    const sb = await novoWorker()
    const s = ssr(programa(P('x/jsiframe', { props: { titulo: 'oi' } })), { sandbox: sb, agora: AGORA })
    const sbAttr = attr(doc(s.corpo), 'sandbox')!
    expect(sbAttr.split(' ').sort()).toEqual(['allow-forms', 'allow-scripts'])
    expect(sbAttr).not.toContain('same-origin')
    expect(new DOMParserLike(s.corpo).csp()).toContain("script-src 'sha256-")
  })

  it('permissões de rede e imagens só valem se a PLATAFORMA liberou a origem (negado por padrão)', async () => {
    const sb = await novoWorker()
    const pg = programa(P('x/htmlrede'))
    const sem = ssr(pg, { sandbox: sb })
    expect(sem.corpo).toBe('')
    expect(sem.erros[0]!.mensagem).toContain('origens não liberadas pela plataforma: https://api.a.com, https://img.a.com')
    const parcial = ssr(pg, { sandbox: sb, origensPermitidas: ['https://api.a.com'] })
    expect(parcial.corpo).toBe('')
    const total = ssr(pg, { sandbox: sb, origensPermitidas: ['https://api.a.com', 'https://img.a.com'] })
    const csp = new DOMParserLike(total.corpo).csp()
    expect(csp).toContain('connect-src https://api.a.com')
    expect(csp).toContain('img-src data: https://img.a.com')
    expect(total.erros).toEqual([])
  })

  it('o iframe NÃO precisa de sandbox executável: funciona sem sandbox QuickJS configurado só se houver sessão', () => {
    // sem `codigo` nenhum, até o iframe é recusado (fail-closed): a configuração é o interruptor da plataforma
    expect(ssr(programa(P('x/html', { props: { titulo: 'x' } })), undefined).corpo).toBe('')
  })
})

describe('onde o código aparece', () => {
  it('bloco de código dentro do modelo de um bloco composto', async () => {
    const sb = await novoWorker()
    expect(ssr(programa(P('x/cartao')), { sandbox: sb }).corpo).toBe('<div style="display:flex;flex-direction:column"><ul class="itens"><li>1</li><li>2</li></ul></div>')
  })

  it('bloco composto usado SÓ dentro de um esqueleto chega ao programa (correção: a coleta não percorria esqueletos)', () => {
    const r = monta()
    const pg = programa(P('texto/paragrafo', { props: { texto: '{lento.x}' }, esqueleto: P('x/cartao') }), { dados: { lento: { dados: 'd.loja', stream: true } } }, r)
    expect(Object.keys(pg.blocos)).toContain('x/cartao')
    expect(Object.keys(pg.codigos)).toContain('x/lista') // e o bloco de código que está dentro dele
  })

  it('bloco de código dentro de um esqueleto em streaming renderiza no shell', async () => {
    const sb = await novoWorker()
    const pg = programa(P('texto/paragrafo', { props: { texto: '{lento.x}' }, esqueleto: P('x/lista', { props: { itens: ['carregando'] } }) }), { dados: { lento: { dados: 'd.loja', stream: true } } })
    let libera!: () => void
    const portao = new Promise<void>((res) => { libera = res })
    const s = await renderPaginaStream(pg, COMPONENTES_BASE, { codigo: { sandbox: sb }, provedores: { servico: async () => { await portao; return { x: 'chegou' } } } })
    let acc = ''
    s.stream.on('data', (c) => { acc += c })
    const t0 = Date.now()
    while (!acc.includes('<li>carregando</li>')) { if (Date.now() - t0 > 3000) throw new Error('shell sem o esqueleto: ' + acc.slice(0, 200)); await new Promise((r) => setTimeout(r, 5)) }
    libera()
    await new Promise<void>((r) => s.stream.on('end', () => r()))
    expect(acc).toContain('<p>chegou</p>')
  })

  it('streaming: o `agora` do código é decidido uma vez e vai no estado de hidratação', async () => {
    const sb = await novoWorker()
    const s = await renderPaginaStream(programa(P('x/relogio')), COMPONENTES_BASE, { codigo: { sandbox: sb }, provedores: {}, idioma: 'pt-BR' })
    const html = await textoDoStream(s.stream)
    const agora = /"agora":"([^"]+)"/.exec(html)![1]!
    expect(Number.isNaN(Date.parse(agora))).toBe(false)
    expect(html).toContain(`<p>${agora}|${Date.parse(agora)}|`)
  })
})

describe('erros de compilação da definição do código', () => {
  it('html em modo puro, permissões no modo puro e template inválido impedem o programa de compilar', () => {
    const r = monta((reg) => {
      reg.registra(no('bloco', 'x.ruim1', { interface: 'x/ruim1', codigo: { linguagem: 'html', modo: 'puro', fonte: 'x' } }))
      reg.registra(no('bloco', 'x.ruim2', { interface: 'x/ruim2', codigo: { linguagem: 'js', fonte: 'x', permissoes: ['formularios'] } }))
      reg.registra(no('bloco', 'x.ruim3', { interface: 'x/ruim3', codigo: { linguagem: 'html', fonte: '{{ propz.x }}' } }))
    })
    for (const [b, regra] of [['x/ruim1', '/spec/codigo/modo'], ['x/ruim2', '/spec/codigo/permissoes'], ['x/ruim3', '/spec/codigo/fonte']] as const) {
      const res = compilaPrograma(r, r.registra(no('pagina', `e${n++}`, { rota: '/', raiz: P(b) })))
      expect(res.ok, b).toBe(false)
      if (!res.ok) expect(res.erros.some((e) => e.caminho === regra), b).toBe(true)
    }
  })
})

/** Extrai o conteúdo do atributo srcdoc do primeiro <iframe> (desfazendo o escape de atributo do React). */
class DOMParserLike {
  constructor(private readonly html: string) {}
  srcdoc(): string {
    const m = /srcDoc="([^"]*)"|srcdoc="([^"]*)"/i.exec(this.html)
    if (!m) throw new Error('sem srcdoc em: ' + this.html.slice(0, 200))
    return (m[1] ?? m[2]!).replace(/&quot;/g, '"').replace(/&#x27;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
  }
  /** A política de segurança como o NAVEGADOR a lê: o atributo content da <meta> do documento do iframe. */
  csp(): string {
    return new JSDOM(this.srcdoc()).window.document.querySelector('meta[http-equiv="Content-Security-Policy"]')!.getAttribute('content')!
  }
}
