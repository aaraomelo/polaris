import { urlSegura } from '../render/url'
import { emissoresDe } from '../vivo/emissor'
import { DESCRITORES_BASE } from '../vivo/blocos'
import { escHtml, px } from './escape'

// Emissores estáticos: o mesmo HTML que os componentes React de render/base.tsx produzem (conferido por teste diferencial),
// mas montando string direto. Um bloco só entra no caminho estático se tiver emissor E não for interativo.

export type EntradaEmissor = { props: Record<string, unknown>; filhos: Record<string, string>; id?: string }
export type Emissor = (e: EntradaEmissor) => string
export type Emissores = Record<string, Emissor>

const txt = (v: unknown): string => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '')
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)
const ALINHA: Record<string, string> = { inicio: 'flex-start', centro: 'center', fim: 'flex-end', esticar: 'stretch' }
const idAttr = (id: string | undefined) => (id ? ` id="${escHtml(id)}"` : '')

const caixa = (direcao: 'column' | 'row'): Emissor => ({ props, filhos, id }) => {
  const gap = num(props.gap)
  const alinha = typeof props.alinha === 'string' ? ALINHA[props.alinha] : undefined
  return `<div${idAttr(id)} style="display:flex;flex-direction:${direcao}${gap !== undefined ? `;gap:${px(gap)}` : ''}${alinha ? `;align-items:${alinha}` : ''}">${filhos.filhos ?? ''}</div>`
}

const MAO: Emissores = {
  'layout/pilha': caixa('column'),
  'layout/linha': caixa('row'),
  'texto/titulo': ({ props, id }) => {
    const n = Math.min(6, Math.max(1, Math.trunc(num(props.nivel) ?? 1)))
    return `<h${n}${idAttr(id)}>${escHtml(txt(props.texto))}</h${n}>`
  },
  'texto/paragrafo': ({ props, id }) => `<p${idAttr(id)}>${escHtml(txt(props.texto))}</p>`,
  'midia/imagem': ({ props, id }) => {
    const src = urlSegura(props.src)
    if (!src) return ''
    const w = num(props.largura), h = num(props.altura)
    return `<img${idAttr(id)} src="${escHtml(src)}" alt="${escHtml(txt(props.alt))}"${w !== undefined ? ` width="${w}"` : ''}${h !== undefined ? ` height="${h}"` : ''} loading="lazy" style="max-width:100%;height:auto"/>`
  },
  'nav/link': ({ props, filhos, id }) => {
    const href = urlSegura(props.href)
    const externo = typeof href === 'string' && /^https?:/i.test(href)
    return `<a${idAttr(id)}${href ? ` href="${escHtml(href)}"` : ''}${externo ? ' rel="noopener noreferrer"' : ''}${props.atual === true ? ' aria-current="page"' : ''}${props.botao === 'primario' || props.botao === 'secundario' ? ` data-botao="${props.botao}"` : ''}>${props.texto !== undefined ? escHtml(txt(props.texto)) : (filhos.filhos ?? '')}</a>`
  },
}

/** Os blocos escritos à mão acima (os primeiros) e os demais derivados do descritor DOM: uma definição só para servidor e cliente. */
export const EMISSORES_BASE: Emissores = { ...emissoresDe(DESCRITORES_BASE), ...MAO }

/** Blocos que só fazem sentido com JavaScript (têm eventos/estado no cliente): uma página que os usa não é estática. */
export const INTERATIVOS = new Set(['nav/botao', 'entrada/texto', 'entrada/numero', 'entrada/caixa'])
