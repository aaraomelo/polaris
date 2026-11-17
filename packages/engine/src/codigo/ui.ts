import { urlSegura } from '../render/url'
import { normalizaOrigem } from './permissoes'

// ---------------------------------------------------------------------------
// Descrição de UI: o que o código em modo `puro` devolve. É DADO, não HTML: o host valida contra uma
// allowlist (tags, atributos, valores) e renderiza com createElement. Nada de innerHTML, style, id, name,
// on*, script, iframe, style, form. O que foge da allowlist é removido e reportado.
// ---------------------------------------------------------------------------

export type NoUI = string | number | { tag: string; attrs?: Record<string, unknown>; children?: NoUI[] }
export type Violacao = { caminho: string; mensagem: string }

export const LIMITES_UI = { nos: 2000, profundidade: 32, texto: 10_000 }

export type OpcoesUI = {
  /** origens https de onde <img> pode carregar. Sem isso, só imagens do próprio site (caminho relativo). */
  origensImagem?: readonly string[]
}

const TAGS = new Set(['div', 'span', 'p', 'br', 'hr', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'ul', 'ol', 'li', 'a', 'strong', 'em', 'b', 'i', 'u', 'small', 'code', 'pre', 'blockquote', 'img', 'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'caption', 'section', 'article', 'header', 'footer', 'nav', 'main', 'aside', 'figure', 'figcaption'])
export const VAZIAS = new Set(['br', 'hr', 'img'])
const ROLES = new Set(['list', 'listitem', 'img', 'presentation', 'heading', 'article', 'region', 'navigation', 'banner', 'contentinfo', 'main', 'note', 'table', 'row', 'cell', 'columnheader', 'figure'])
const GLOBAIS = new Set(['class', 'title', 'role', 'aria-label', 'aria-hidden', 'lang', 'dir'])
const POR_TAG: Record<string, Set<string>> = { a: new Set(['href']), img: new Set(['src', 'alt', 'width', 'height']), td: new Set(['colspan', 'rowspan']), th: new Set(['colspan', 'rowspan', 'scope']) }

const CLASSE = /^[A-Za-z0-9 _-]{1,200}$/
const curto = (s: string) => (s.length > 40 ? s.slice(0, 40) + '…' : s)

/** <img src>: o código recebe props (que podem ter dados do usuário) e uma imagem externa seria um canal de exfiltração (?dado=...). */
function imagemPermitida(v: unknown, origens: readonly string[]): string | null {
  const u = urlSegura(v)
  if (!u) return null
  const limpa = u.replace(/[\u0000-\u0020\u007f-\u009f]/g, '')
  if (limpa.startsWith('/') && !limpa.startsWith('//')) return u // do próprio site
  const m = /^(https:\/\/[^/?#]+)/i.exec(limpa)
  const o = m ? normalizaOrigem(m[1]!) : null
  return o && o.ok && origens.some((x) => { const n = normalizaOrigem(x); return n.ok && n.origem === o.origem }) ? u : null
}

function atributoOk(tag: string, nome: string, v: unknown, op: OpcoesUI): { ok: true; valor: string | number | boolean } | { ok: false; motivo: string } {
  if (!GLOBAIS.has(nome) && !POR_TAG[tag]?.has(nome)) return { ok: false, motivo: `atributo '${nome}' não é permitido em <${tag}>` }
  if (nome === 'class') return typeof v === 'string' && CLASSE.test(v) ? { ok: true, valor: v } : { ok: false, motivo: "'class' aceita só letras, números, espaço, _ e -" }
  if (nome === 'role') return typeof v === 'string' && ROLES.has(v) ? { ok: true, valor: v } : { ok: false, motivo: `role '${String(v)}' não permitido` }
  if (nome === 'aria-hidden') return v === true || v === false || v === 'true' || v === 'false' ? { ok: true, valor: String(v) } : { ok: false, motivo: "'aria-hidden' é true ou false" }
  if (nome === 'dir') return v === 'ltr' || v === 'rtl' ? { ok: true, valor: v } : { ok: false, motivo: "'dir' é ltr ou rtl" }
  if (nome === 'scope') return v === 'row' || v === 'col' ? { ok: true, valor: v } : { ok: false, motivo: "'scope' é row ou col" }
  if (nome === 'width' || nome === 'height' || nome === 'colspan' || nome === 'rowspan') {
    return typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 4000 ? { ok: true, valor: v } : { ok: false, motivo: `'${nome}' é um inteiro de 1 a 4000` }
  }
  if (nome === 'src' && tag === 'img') { const u = imagemPermitida(v, op.origensImagem ?? []); return u ? { ok: true, valor: u } : { ok: false, motivo: "'src' da imagem: só do próprio site (caminho relativo) ou de origem liberada pela plataforma" } }
  if (nome === 'href' || nome === 'src') {
    const u = urlSegura(v)
    return u ? { ok: true, valor: u } : { ok: false, motivo: `'${nome}' com URL ausente ou insegura` }
  }
  if (typeof v !== 'string' || v.length > 500) return { ok: false, motivo: `'${nome}' precisa ser texto de até 500 caracteres` }
  return { ok: true, valor: v }
}

/** Valida e sanitiza. Fail-safe: nunca lança; o que não passa é descartado e listado em `violacoes`. */
export function sanitizaUI(raiz: unknown, op: OpcoesUI = {}): { no: NoUI | null; violacoes: Violacao[] } {
  const violacoes: Violacao[] = []
  let total = 0
  const v = (caminho: string, mensagem: string) => { violacoes.push({ caminho, mensagem }) }

  const anda = (x: unknown, caminho: string, prof: number): NoUI | null => {
    if (++total > LIMITES_UI.nos) { if (total === LIMITES_UI.nos + 1) v(caminho, `mais de ${LIMITES_UI.nos} nós`); return null }
    if (typeof x === 'string') {
      if (x.length > LIMITES_UI.texto) { v(caminho, `texto com mais de ${LIMITES_UI.texto} caracteres`); return x.slice(0, LIMITES_UI.texto) }
      return x
    }
    if (typeof x === 'number') return Number.isFinite(x) ? x : null
    if (!x || typeof x !== 'object' || Array.isArray(x)) { v(caminho, 'nó inválido: esperado texto, número ou { tag }'); return null }
    if (prof > LIMITES_UI.profundidade) { v(caminho, `mais de ${LIMITES_UI.profundidade} níveis de profundidade`); return null }
    const o = x as { tag?: unknown; attrs?: unknown; children?: unknown }
    const tag = typeof o.tag === 'string' ? o.tag.toLowerCase() : ''
    if (!TAGS.has(tag)) { v(caminho, `tag '${curto(String(o.tag))}' não é permitida`); return null }
    const attrs: Record<string, unknown> = {}
    if (o.attrs !== undefined) {
      if (!o.attrs || typeof o.attrs !== 'object' || Array.isArray(o.attrs)) v(`${caminho}/attrs`, 'attrs deve ser um objeto')
      else for (const [k, val] of Object.entries(o.attrs)) {
        const r = atributoOk(tag, k, val, op)
        if (r.ok) attrs[k] = r.valor
        else v(`${caminho}/attrs/${curto(k)}`, r.motivo)
      }
    }
    if (tag === 'img' && attrs.src === undefined) { v(caminho, '<img> sem um src válido foi removida'); return null }
    if (tag === 'a' && typeof attrs.href === 'string' && /^https?:/i.test(attrs.href)) attrs.rel = 'noopener noreferrer'
    const filhos: NoUI[] = []
    if (o.children !== undefined) {
      if (!Array.isArray(o.children)) v(`${caminho}/children`, 'children deve ser uma lista')
      else if (VAZIAS.has(tag) && o.children.length) v(`${caminho}/children`, `<${tag}> não tem filhos`)
      else o.children.forEach((c, i) => { const r = anda(c, `${caminho}/children/${i}`, prof + 1); if (r !== null) filhos.push(r) })
    }
    return { tag, ...(Object.keys(attrs).length ? { attrs } : {}), ...(filhos.length ? { children: filhos } : {}) }
  }
  return { no: anda(raiz, '', 0), violacoes }
}
