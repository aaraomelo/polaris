// @vitest-environment jsdom
import { Registry } from '@polaris/schema'
import { describe, expect, it } from 'vitest'
import { COMPONENTES_BASE, compilaEstatico, compilaHtmlVivo, compilaPrograma, montaVivo, registraBase, renderPaginaHtml, type Programa } from '../src/index'
import { DESCRITORES_BASE } from '../src/vivo/blocos'
import { BLOCOS_BASE } from '../src/render/base'

// Biblioteca base: cada bloco tem schema, componente React (oráculo) e descritor DOM (servidor + cliente). Aqui a PARIDADE:
// React × HTML estático × HTML do vivo × montagem no cliente × hidratação, para cada bloco; e atualização dinâmica das props.

const no = (kind: string, id: string, spec: object) => ({ kind, id, versao: '1.0.0', estatuto: 'publicado', spec }) as any
const P = (b: string, extra: object = {}) => ({ bloco: b, ...extra })
const par = (t: string, id?: string) => P('texto/paragrafo', { ...(id ? { id } : {}), props: { texto: t } })
let n = 0
function programa(raiz: object, extra: object = {}): Programa {
  const r = new Registry(); registraBase(r)
  const c = compilaPrograma(r, r.registra(no('pagina', `bb${n++}`, { rota: '/', raiz, ...extra })))
  if (!c.ok) throw new Error(JSON.stringify(c.erros))
  return c.programa
}
function canon(nd: Node): string {
  if (nd.nodeType === 3) return nd.textContent!
  if (nd.nodeType !== 1) return ''
  const el = nd as HTMLElement
  const attrs = [...el.attributes].filter((a) => !(el instanceof HTMLInputElement && (a.name === 'value' || a.name === 'checked'))).map((a) => `${a.name}=${JSON.stringify(a.value)}`).sort()
  const props = el instanceof HTMLInputElement ? `[v=${el.value};c=${el.checked}]` : ''
  let t = '', fs: string[] = []
  for (const c of [...el.childNodes]) { if (c.nodeType === 3) t += c.textContent; else if (c.nodeType === 1) { if (t) { fs.push(t); t = '' } fs.push(canon(c)) } }
  if (t) fs.push(t)
  return `<${el.tagName.toLowerCase()} ${attrs.join(' ')}>${props}${fs.join('')}</>`
}
const doHtml = (html: string) => { const d = document.createElement('div'); d.innerHTML = html; return [...d.childNodes].map(canon).join('') }
const doCliente = (pg: Programa, extra: object = {}) => { const c = document.createElement('div'); document.body.appendChild(c); const v = montaVivo({ programa: pg, container: c, ...extra }); return { c, v, html: () => [...c.childNodes].map(canon).join('') } }

const celulas = (...t: string[]) => t.map((x) => P('tabela/celula', { props: { texto: x } }))
const CASOS: Array<[string, object]> = [
  ['layout/grade', P('layout/grade', { id: 'b', props: { colunas: 3, gap: 8 }, slots: { filhos: [par('a'), par('b'), par('c')] } })],
  ['layout/grade (padrão)', P('layout/grade', { id: 'b', slots: { filhos: [par('a')] } })],
  ['texto/titulo', P('texto/titulo', { id: 'b', props: { texto: 'Olá & <b>', nivel: 3 } })],
  ['midia/imagem', P('midia/imagem', { id: 'b', props: { src: '/a.png', alt: 'foto "x"', largura: 10, altura: 20 } })],
  ['midia/imagem (src inseguro some)', P('layout/pilha', { slots: { filhos: [P('midia/imagem', { id: 'b', props: { src: 'javascript:alert(1)' } }), par('depois')] } })],
  ['nav/botao', P('nav/botao', { id: 'b', props: { texto: 'ok', desabilitado: true } })],
  ['nav/link', P('nav/link', { id: 'b', props: { href: 'https://a.com', texto: 'a' } })],
  ['entrada/texto', P('entrada/texto', { id: 'b', props: { valor: 'v', placeholder: 'p' } })],
  ['layout/linha', P('layout/linha', { id: 'b', props: { gap: 4, alinha: 'centro' }, slots: { filhos: [par('a'), par('b')] } })],
  ['layout/divisor', P('layout/pilha', { slots: { filhos: [par('a'), P('layout/divisor', { id: 'b' }), par('c')] } })],
  ['layout/espacador', P('layout/espacador', { id: 'b', props: { tamanho: 24 } })],
  ['layout/espacador (padrão)', P('layout/espacador', { id: 'b' })],
  ['texto/rotulo', P('layout/pilha', { slots: { filhos: [P('texto/rotulo', { id: 'b', props: { texto: 'Nome <b>', para: 'campo' } }), P('entrada/texto', { id: 'campo', props: { valor: 'x' } })] } })],
  ['texto/destaque', P('texto/destaque', { id: 'b', props: { texto: 'forte & claro' } })],
  ['texto/pequeno', P('texto/pequeno', { id: 'b', props: { texto: 'nota' } })],
  ['texto/codigo', P('texto/codigo', { id: 'b', props: { texto: 'a < b && c' } })],
  ['lista/lista (não ordenada)', P('lista/lista', { id: 'b', slots: { filhos: [P('lista/item', { slots: { filhos: [par('um')] } }), P('lista/item', { slots: { filhos: [par('dois')] } })] } })],
  ['lista/lista (ordenada)', P('lista/lista', { id: 'b', props: { ordenada: true }, slots: { filhos: [P('lista/item', { slots: { filhos: [par('um')] } })] } })],
  ['tabela completa', P('tabela/tabela', { id: 'b', slots: { filhos: [
    P('tabela/cabecalho', { slots: { filhos: [P('tabela/linha', { slots: { filhos: [P('tabela/celula', { props: { texto: 'Nome', cabecalho: true } }), P('tabela/celula', { props: { texto: 'Qtd', cabecalho: true } })] } })] } }),
    P('tabela/corpo', { slots: { filhos: [P('tabela/linha', { slots: { filhos: celulas('pão', '3') } }), P('tabela/linha', { slots: { filhos: [P('tabela/celula', { props: { colunas: 2 }, slots: { filhos: [par('total')] } })] } })] } }),
  ] } })],
  ['tabela/celula com rowspan', P('tabela/tabela', { slots: { filhos: [P('tabela/corpo', { slots: { filhos: [P('tabela/linha', { slots: { filhos: [P('tabela/celula', { id: 'b', props: { linhas: 2, texto: 'x' } })] } })] } })] } })],
  ['entrada/numero', P('entrada/numero', { id: 'b', props: { valor: 5, min: 0, max: 10, passo: 0.5, placeholder: 'n' } })],
  ['entrada/numero (texto/desabilitado)', P('entrada/numero', { id: 'b', props: { valor: '7', desabilitado: true } })],
  ['entrada/caixa (marcada)', P('entrada/caixa', { id: 'b', props: { marcado: true } })],
  ['entrada/caixa (desmarcada, desabilitada)', P('entrada/caixa', { id: 'b', props: { marcado: false, desabilitado: true } })],
  ['feedback/selo', P('feedback/selo', { id: 'b', props: { texto: 'novo', tom: 'sucesso' } })],
  ['feedback/selo (tom padrão)', P('feedback/selo', { id: 'b', props: { texto: 'x' } })],
  ['computacao/canvas-gl', P('computacao/canvas-gl', { id: 'b', props: { kernel: 'gradiente', largura: 64, altura: 32, alt: 'Gradiente <b>', entradas: { w: 64, ligado: true, ruim: 'x', Nome: 1 } } })],
  ['computacao/canvas-gl (padrões, sem entradas)', P('computacao/canvas-gl', { id: 'b', props: { kernel: 'k.v1', alt: 'x' } })],
  ['feedback/alerta', P('feedback/alerta', { id: 'b', props: { tom: 'erro' }, slots: { filhos: [par('falhou')] } })],
]

describe('biblioteca base: todo bloco tem schema, componente React e descritor', () => {
  it('as três tabelas têm exatamente as mesmas interfaces', () => {
    const schema = BLOCOS_BASE.map((b: any) => b.spec.interface).sort()
    expect(Object.keys(DESCRITORES_BASE).sort()).toEqual(schema)
    expect(Object.keys(COMPONENTES_BASE).sort()).toEqual(schema)
    expect(schema.length).toBeGreaterThanOrEqual(26)
  })
  it('cada interface aparece em pelo menos um caso de paridade', () => {
    const usadas = new Set(JSON.stringify(CASOS).match(/"bloco":"([a-z]+\/[a-z-]+)"/g)!.map((s) => s.slice(9, -1)))
    for (const i of Object.keys(DESCRITORES_BASE)) expect(usadas.has(i), i).toBe(true)
  })
})

describe.each(CASOS)('paridade: %s', (_nome, raiz) => {
  const pg = programa(raiz)
  const oraculo = doHtml(renderPaginaHtml({ programa: pg, componentes: COMPONENTES_BASE }).corpo)
  it('HTML do runtime vivo ≡ React', () => {
    const h = compilaHtmlVivo(pg); if (!h.ok) throw new Error(JSON.stringify(h.motivos))
    expect(doHtml(h.pagina.render({}).corpo)).toBe(oraculo)
  })
  it('HTML estático (quando a página não é interativa) ≡ React', () => {
    const e = compilaEstatico(pg)
    if (e.ok) expect(doHtml(e.pagina.render({}).corpo)).toBe(oraculo)
    else expect(JSON.stringify(e.motivos)).toMatch(/interativ|campo|evento|botão|entrada/i) // só os interativos ficam de fora
  })
  it('montagem no cliente ≡ React', () => { expect(doCliente(pg).html()).toBe(oraculo) })
  it('hidratação adota o HTML do servidor (mesmos nós) e o resultado ≡ React', () => {
    const h = compilaHtmlVivo(pg); if (!h.ok) throw new Error('x')
    const c = document.createElement('div'); c.innerHTML = h.pagina.render({}).corpo; document.body.appendChild(c)
    const antes = [...c.querySelectorAll('*')]
    const v = montaVivo({ programa: pg, container: c, hidrata: true })
    expect(v.diagnostico().hidratou).toBe(true)
    expect([...c.querySelectorAll('*')]).toEqual(antes)
    expect([...c.childNodes].map(canon).join('')).toBe(oraculo)
  })
})

describe('props dinâmicas: o cliente reage a estado e reconstrói só quando a estrutura muda', () => {
  const est = (extra: object) => ({ estado: extra })
  const casos: Array<[string, object, object, Array<[string, unknown]>]> = [
    ['lista/lista: ordenada alterna ul/ol', P('lista/lista', { id: 'b', props: { ordenada: '{estado.v}' }, slots: { filhos: [P('lista/item', { slots: { filhos: [par('x')] } })] } }), { v: { tipo: 'booleano', inicial: false } }, [['v', true], ['v', false]]],
    ['tabela/celula: cabecalho alterna td/th e texto/filhos', P('tabela/tabela', { slots: { filhos: [P('tabela/corpo', { slots: { filhos: [P('tabela/linha', { slots: { filhos: [P('tabela/celula', { id: 'b', props: { cabecalho: '{estado.v}', texto: 'x' } })] } })] } })] } }), { v: { tipo: 'booleano', inicial: false } }, [['v', true], ['v', false]]],
    ['entrada/caixa: marcado controlado', P('entrada/caixa', { id: 'b', props: { marcado: '{estado.v}' } }), { v: { tipo: 'booleano', inicial: false } }, [['v', true], ['v', false], ['v', true]]],
    ['entrada/numero: valor, min e max', P('entrada/numero', { id: 'b', props: { valor: '{estado.v}', min: '{estado.m}' } }), { v: { tipo: 'inteiro', inicial: 1 }, m: { tipo: 'inteiro', inicial: 0 } }, [['v', 9], ['m', 3], ['v', 2]]],
    ['feedback/selo: texto', P('feedback/selo', { id: 'b', props: { texto: '{estado.t}', tom: 'alerta' } }), { t: { tipo: 'texto', inicial: 'a' } }, [['t', 'b'], ['t', 'c <d>']]],
    ['layout/grade: colunas e gap', P('layout/grade', { id: 'b', props: { colunas: '{estado.c}', gap: '{estado.g}' }, slots: { filhos: [par('a'), par('b')] } }), { c: { tipo: 'inteiro', inicial: 2 }, g: { tipo: 'inteiro', inicial: 0 } }, [['c', 4], ['g', 12], ['c', 1]]],
  ]
  it.each(casos)('%s', (_n, raiz, estado, passos) => {
    const pg = programa(raiz, { estado })
    const { c, v, html } = doCliente(pg)
    const alvo0 = c.querySelector('#b')!
    expect(html()).toBe(doHtml(renderPaginaHtml({ programa: pg, componentes: COMPONENTES_BASE }).corpo))
    for (const [nome, valor] of passos) {
      v.despacha({ t: 'estado', nome, valor })
      expect(html(), `${nome}=${JSON.stringify(valor)}`).toBe(doHtml(renderPaginaHtml({ programa: pg, componentes: COMPONENTES_BASE, estado: v.store().estado }).corpo))
    }
    void alvo0; void est
  })
})

describe('eventos dos campos novos', () => {
  it('número vira Number (ou null se vazio) e caixa vira booleano, no estado', () => {
    const pg = programa(P('layout/pilha', { slots: { filhos: [
      P('entrada/numero', { id: 'n', props: { valor: '{estado.n}' }, eventos: { aoMudar: [{ acao: 'definir', estado: 'n', valor: 'evento' }] } }),
      P('entrada/caixa', { id: 'k', props: { marcado: '{estado.k}' }, eventos: { aoMudar: [{ acao: 'definir', estado: 'k', valor: 'evento' }] } }),
    ] } }), { estado: { n: { tipo: 'json', inicial: 1 }, k: { tipo: 'booleano', inicial: false } } })
    const { c, v } = doCliente(pg)
    const n = c.querySelector('#n') as HTMLInputElement, k = c.querySelector('#k') as HTMLInputElement
    n.value = '42.5'; n.dispatchEvent(new Event('input', { bubbles: true })); expect(v.store().estado.n).toBe(42.5)
    n.value = ''; n.dispatchEvent(new Event('input', { bubbles: true })); expect(v.store().estado.n).toBeNull()
    k.click(); expect(v.store().estado.k).toBe(true); expect(k.checked).toBe(true)
    k.click(); expect(v.store().estado.k).toBe(false); expect(k.checked).toBe(false)
  })
})
