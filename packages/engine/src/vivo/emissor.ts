import { escHtml } from '../estatico/escape'
import type { Emissor, Emissores } from '../estatico/emissores'
import type { Descritor, DescritoresDom } from './blocos'

// Emissor de string DERIVADO do descritor DOM: servidor e cliente leem a mesma definição do bloco (uma fonte só).
const VAZIOS = new Set(['img', 'input', 'br', 'hr'])

export function emissorDe(d: Descritor): Emissor {
  return ({ props, filhos, id }) => {
    if (d.chave(props) === null) return ''
    const tag = d.tag(props)
    let attrs = ''
    for (const [k, v] of Object.entries(d.attrs(props, id))) attrs += ` ${k}="${escHtml(v)}"`
    if (d.valor) attrs += ` value="${escHtml(d.valor(props))}"`
    if (VAZIOS.has(tag)) return `<${tag}${attrs}/>`
    const t = d.texto?.(props)
    return `<${tag}${attrs}>${t !== undefined ? escHtml(t) : d.filhos ? (filhos.filhos ?? '') : ''}</${tag}>`
  }
}

export const emissoresDe = (ds: DescritoresDom): Emissores => Object.fromEntries(Object.entries(ds).map(([k, d]) => [k, emissorDe(d)]))
