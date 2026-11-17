import { escapaHtml } from './html-render'
import { sha256Hex } from './sha256'
import type { SaidaCodigo } from './calcula'
import { VAZIAS, type NoUI } from './ui'

// ---------------------------------------------------------------------------
// Como um bloco de código aparece SEM React: o que `calculaCodigo` produz (UI já validada pela allowlist, ou o documento do iframe) vira
//   - string de HTML (servidor), com tudo escapado; ou
//   - nós do DOM via createElement/setAttribute (cliente). Nunca innerHTML.
// Os dois têm de dar a MESMA árvore: a unidade vem entre marcadores `<!--c:HASH-->…<!--/c-->` e o hash é o do HTML; ao hidratar, o cliente
// só confia no HTML do servidor se o hash bater (ou se não puder recalcular).
// ---------------------------------------------------------------------------

const attrHtml = (s: string) => escapaHtml(s)
const textoHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
/** atributos extras de toda <img> vinda de código de tenant: sem referrer, preguiçosa */
const EXTRA_IMG: ReadonlyArray<readonly [string, string]> = [['referrerpolicy', 'no-referrer'], ['loading', 'lazy'], ['decoding', 'async']]

export function uiParaHtml(no: NoUI | null): string {
  if (no === null) return ''
  if (typeof no === 'string') return textoHtml(no)
  if (typeof no === 'number') return String(no)
  let a = ''
  for (const [k, v] of Object.entries(no.attrs ?? {})) a += ` ${k}="${attrHtml(String(v))}"`
  if (no.tag === 'img') for (const [k, v] of EXTRA_IMG) a += ` ${k}="${v}"`
  if (VAZIAS.has(no.tag)) return `<${no.tag}${a}>`
  return `<${no.tag}${a}>${(no.children ?? []).map(uiParaHtml).join('')}</${no.tag}>`
}

export function uiParaDom(no: NoUI | null, doc: Document): Node | null {
  if (no === null) return null
  if (typeof no === 'string' || typeof no === 'number') return doc.createTextNode(String(no))
  const el = doc.createElement(no.tag)
  for (const [k, v] of Object.entries(no.attrs ?? {})) el.setAttribute(k, String(v))
  if (no.tag === 'img') for (const [k, v] of EXTRA_IMG) el.setAttribute(k, v)
  if (!VAZIAS.has(no.tag)) for (const c of no.children ?? []) { const n = uiParaDom(c, doc); if (n) el.appendChild(n) }
  return el
}

type Iframe = Extract<SaidaCodigo, { tipo: 'iframe' }>
const estiloIframe = (altura: number) => `border:0;width:100%;height:${altura}px`

export function iframeParaHtml(r: Iframe): string {
  return `<iframe sandbox="${attrHtml(r.sandbox)}" srcdoc="${attrHtml(r.srcDoc)}" title="${attrHtml(r.titulo)}" referrerpolicy="no-referrer" loading="lazy" allow="" style="${estiloIframe(r.altura)}"></iframe>`
}

export function iframeParaDom(r: Iframe, doc: Document): HTMLIFrameElement {
  const f = doc.createElement('iframe')
  f.setAttribute('sandbox', r.sandbox); f.setAttribute('srcdoc', r.srcDoc); f.setAttribute('title', r.titulo)
  f.setAttribute('referrerpolicy', 'no-referrer'); f.setAttribute('loading', 'lazy'); f.setAttribute('allow', ''); f.setAttribute('style', estiloIframe(r.altura))
  return f
}

/** HTML do conteúdo de um bloco (vazio quando falhou). */
export function saidaParaHtml(s: SaidaCodigo): string { return s.tipo === 'ui' ? uiParaHtml(s.no) : s.tipo === 'iframe' ? iframeParaHtml(s) : '' }

export function saidaParaDom(s: SaidaCodigo, doc: Document): Node[] {
  if (s.tipo === 'ui') { const n = uiParaDom(s.no, doc); return n ? [n] : [] }
  if (s.tipo === 'iframe') return [iframeParaDom(s, doc)]
  return []
}

/** hash curto do HTML do conteúdo: o servidor o escreve no marcador, o cliente o compara */
export const hashDoHtml = (html: string): string => sha256Hex(html).slice(0, 12)
export const marcadorIni = (html: string) => `<!--c:${hashDoHtml(html)}-->`
export const MARCADOR_FIM = '<!--/c-->'
/** unidade do servidor: marcador (com o hash) + conteúdo + marcador de fim */
export const unidadeHtml = (html: string) => `${marcadorIni(html)}${html}${MARCADOR_FIM}`
