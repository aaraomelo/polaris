import { px } from '../estatico/escape'
import { urlSegura } from '../render/url'

// Descritores DOM dos blocos base: dizem ao runtime vivo QUE elemento criar e como atualizá-lo a partir das props.
// Têm de produzir exatamente o DOM que os componentes React (render/base.tsx) produzem: o oráculo confere.

export type EventoDom = { dom: string; payload?: (e: Event) => unknown }
export type Descritor = {
  /** identifica a ESTRUTURA do elemento (tag + modo de conteúdo); se mudar, o elemento é refeito. null = não emite elemento */
  chave(props: Record<string, unknown>): string | null
  tag(props: Record<string, unknown>): string
  attrs(props: Record<string, unknown>, id: string | undefined): Record<string, string>
  /** conteúdo de texto; undefined = o conteúdo vem do slot `filhos` (se `filhos`) */
  texto?(props: Record<string, unknown>): string | undefined
  filhos?: boolean
  /** propriedade `value` (campos controlados) */
  valor?(props: Record<string, unknown>): string
  eventos?: Record<string, EventoDom>
}
export type DescritoresDom = Record<string, Descritor>

const txt = (v: unknown): string => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '')
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)
const ALINHA: Record<string, string> = { inicio: 'flex-start', centro: 'center', fim: 'flex-end', esticar: 'stretch' }
const comId = (id: string | undefined): Record<string, string> => (id ? { id } : {})

const caixa = (direcao: 'column' | 'row'): Descritor => ({
  chave: () => 'div', tag: () => 'div', filhos: true,
  attrs: (p, id) => {
    const gap = num(p.gap)
    const alinha = typeof p.alinha === 'string' ? ALINHA[p.alinha] : undefined
    return { ...comId(id), style: `display:flex;flex-direction:${direcao}${gap !== undefined ? `;gap:${px(gap)}` : ''}${alinha ? `;align-items:${alinha}` : ''}` }
  },
})
const nivel = (p: Record<string, unknown>) => Math.min(6, Math.max(1, Math.trunc(num(p.nivel) ?? 1)))

export const DESCRITORES_BASE: DescritoresDom = {
  'layout/pilha': caixa('column'),
  'layout/linha': caixa('row'),
  'texto/titulo': { chave: (p) => `h${nivel(p)}`, tag: (p) => `h${nivel(p)}`, attrs: (_, id) => comId(id), texto: (p) => txt(p.texto) },
  'texto/paragrafo': { chave: () => 'p', tag: () => 'p', attrs: (_, id) => comId(id), texto: (p) => txt(p.texto) },
  'midia/imagem': {
    chave: (p) => (urlSegura(p.src) ? 'img' : null), tag: () => 'img',
    attrs: (p, id) => {
      const w = num(p.largura), h = num(p.altura)
      return { ...comId(id), src: urlSegura(p.src) ?? '', alt: txt(p.alt), ...(w !== undefined ? { width: String(w) } : {}), ...(h !== undefined ? { height: String(h) } : {}), loading: 'lazy' }
    },
  },
  'nav/link': {
    chave: (p) => (p.texto !== undefined ? 'a:t' : 'a:f'), tag: () => 'a', filhos: true,
    attrs: (p, id) => {
      const href = urlSegura(p.href)
      return { ...comId(id), ...(href ? { href } : {}), ...(typeof href === 'string' && /^https?:/i.test(href) ? { rel: 'noopener noreferrer' } : {}) }
    },
    texto: (p) => (p.texto !== undefined ? txt(p.texto) : undefined),
  },
  'nav/botao': {
    chave: () => 'button', tag: () => 'button', texto: (p) => txt(p.texto),
    attrs: (p, id) => ({ ...comId(id), type: 'button', ...(p.desabilitado === true ? { disabled: '' } : {}) }),
    eventos: { aoClicar: { dom: 'click' } },
  },
  'entrada/texto': {
    chave: () => 'input', tag: () => 'input', valor: (p) => txt(p.valor),
    attrs: (p, id) => ({ ...comId(id), type: 'text', placeholder: txt(p.placeholder), ...(p.desabilitado === true ? { disabled: '' } : {}) }),
    eventos: { aoMudar: { dom: 'input', payload: (e) => (e.target as HTMLInputElement).value } },
  },
}
