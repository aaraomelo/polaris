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
  /** propriedade `checked` (caixa de seleção controlada) */
  marcado?(props: Record<string, unknown>): boolean
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

export const d_layout_pilha: Descritor = /* @__PURE__ */ caixa('column')
export const d_layout_linha: Descritor = /* @__PURE__ */ caixa('row')
export const d_texto_titulo: Descritor = { chave: (p) => `h${nivel(p)}`, tag: (p) => `h${nivel(p)}`, attrs: (_, id) => comId(id), texto: (p) => txt(p.texto) }
export const d_texto_paragrafo: Descritor = { chave: () => 'p', tag: () => 'p', attrs: (_, id) => comId(id), texto: (p) => txt(p.texto) }
export const d_midia_imagem: Descritor = {
    chave: (p) => (urlSegura(p.src) ? 'img' : null), tag: () => 'img',
    attrs: (p, id) => {
      const w = num(p.largura), h = num(p.altura)
      return { ...comId(id), src: urlSegura(p.src) ?? '', alt: txt(p.alt), ...(w !== undefined ? { width: String(w) } : {}), ...(h !== undefined ? { height: String(h) } : {}), loading: 'lazy' }
    },
  }
export const d_nav_link: Descritor = {
    chave: (p) => (p.texto !== undefined ? 'a:t' : 'a:f'), tag: () => 'a', filhos: true,
    attrs: (p, id) => {
      const href = urlSegura(p.href)
      return { ...comId(id), ...(href ? { href } : {}), ...(typeof href === 'string' && /^https?:/i.test(href) ? { rel: 'noopener noreferrer' } : {}) }
    },
    texto: (p) => (p.texto !== undefined ? txt(p.texto) : undefined),
  }
export const d_nav_botao: Descritor = {
    chave: () => 'button', tag: () => 'button', texto: (p) => txt(p.texto),
    attrs: (p, id) => ({ ...comId(id), type: 'button', ...(p.desabilitado === true ? { disabled: '' } : {}) }),
    eventos: { aoClicar: { dom: 'click' } },
  }
export const d_entrada_texto: Descritor = {
    chave: () => 'input', tag: () => 'input', valor: (p) => txt(p.valor),
    attrs: (p, id) => ({ ...comId(id), type: 'text', placeholder: txt(p.placeholder), ...(p.desabilitado === true ? { disabled: '' } : {}) }),
    eventos: { aoMudar: { dom: 'input', payload: (e) => (e.target as HTMLInputElement).value } },
  }

const inteiro = (v: unknown, min: number, max: number, padrao: number): number => { const n = num(v); return n === undefined ? padrao : Math.min(max, Math.max(min, Math.trunc(n))) }
const opcional = (nome: string, v: unknown): Record<string, string> => { const n = num(v); return n === undefined ? {} : { [nome]: String(n) } }
const TONS = new Set(['neutro', 'sucesso', 'alerta', 'erro'])
const tom = (p: Record<string, unknown>): Record<string, string> => ({ 'data-tom': typeof p.tom === 'string' && TONS.has(p.tom) ? p.tom : 'neutro' })
/** elemento simples: uma tag fixa, com o texto da prop `texto` (folha) ou com o slot `filhos` */
const folha = (tag: string): Descritor => ({ chave: () => tag, tag: () => tag, attrs: (_, id) => comId(id), texto: (p) => txt(p.texto) })
const contem = (tag: string): Descritor => ({ chave: () => tag, tag: () => tag, attrs: (_, id) => comId(id), filhos: true })

export const d_layout_grade: Descritor = {
  chave: () => 'div', tag: () => 'div', filhos: true,
  attrs: (p, id) => { const gap = num(p.gap); return { ...comId(id), style: `display:grid;grid-template-columns:repeat(${inteiro(p.colunas, 1, 12, 2)},minmax(0,1fr))${gap !== undefined ? `;gap:${px(gap)}` : ''}` } },
}
export const d_layout_divisor: Descritor = { chave: () => 'hr', tag: () => 'hr', attrs: (_, id) => comId(id) }
export const d_layout_espacador: Descritor = { chave: () => 'div', tag: () => 'div', attrs: (p, id) => ({ ...comId(id), 'aria-hidden': 'true', style: `height:${px(num(p.tamanho) ?? 8)}` }) }
export const d_texto_rotulo: Descritor = { chave: () => 'label', tag: () => 'label', attrs: (p, id) => ({ ...comId(id), ...(typeof p.para === 'string' && p.para ? { for: p.para } : {}) }), texto: (p) => txt(p.texto) }
export const d_texto_destaque: Descritor = /* @__PURE__ */ folha('strong')
export const d_texto_pequeno: Descritor = /* @__PURE__ */ folha('small')
export const d_texto_codigo: Descritor = /* @__PURE__ */ folha('code')
export const d_lista_lista: Descritor = { chave: (p) => (p.ordenada === true ? 'ol' : 'ul'), tag: (p) => (p.ordenada === true ? 'ol' : 'ul'), attrs: (_, id) => comId(id), filhos: true }
export const d_lista_item: Descritor = /* @__PURE__ */ contem('li')
export const d_tabela_tabela: Descritor = /* @__PURE__ */ contem('table')
export const d_tabela_cabecalho: Descritor = /* @__PURE__ */ contem('thead')
export const d_tabela_corpo: Descritor = /* @__PURE__ */ contem('tbody')
export const d_tabela_linha: Descritor = /* @__PURE__ */ contem('tr')
export const d_tabela_celula: Descritor = {
  chave: (p) => `${p.cabecalho === true ? 'th' : 'td'}:${p.texto !== undefined ? 't' : 'f'}`, tag: (p) => (p.cabecalho === true ? 'th' : 'td'), filhos: true,
  attrs: (p, id) => ({ ...comId(id), ...opcional('colspan', p.colunas !== undefined ? inteiro(p.colunas, 1, 1000, 1) : undefined), ...opcional('rowspan', p.linhas !== undefined ? inteiro(p.linhas, 1, 65534, 1) : undefined) }),
  texto: (p) => (p.texto !== undefined ? txt(p.texto) : undefined),
}
export const d_entrada_numero: Descritor = {
  chave: () => 'input', tag: () => 'input', valor: (p) => txt(p.valor),
  attrs: (p, id) => ({ ...comId(id), type: 'number', placeholder: txt(p.placeholder), ...opcional('min', p.min), ...opcional('max', p.max), ...opcional('step', p.passo), ...(p.desabilitado === true ? { disabled: '' } : {}) }),
  eventos: { aoMudar: { dom: 'input', payload: (e) => { const v = (e.target as HTMLInputElement).value; return v === '' ? null : Number(v) } } },
}
export const d_entrada_caixa: Descritor = {
  chave: () => 'input', tag: () => 'input', marcado: (p) => p.marcado === true,
  attrs: (p, id) => ({ ...comId(id), type: 'checkbox', ...(p.desabilitado === true ? { disabled: '' } : {}) }),
  eventos: { aoMudar: { dom: 'input', payload: (e) => (e.target as HTMLInputElement).checked } },
}
export const d_feedback_selo: Descritor = { chave: () => 'span', tag: () => 'span', attrs: (p, id) => ({ ...comId(id), ...tom(p) }), texto: (p) => txt(p.texto) }
export const d_feedback_alerta: Descritor = { chave: () => 'div', tag: () => 'div', filhos: true, attrs: (p, id) => ({ ...comId(id), role: 'alert', ...tom(p) }) }

export const DESCRITORES_BASE: DescritoresDom = {
  'layout/grade': d_layout_grade, 'layout/divisor': d_layout_divisor, 'layout/espacador': d_layout_espacador,
  'texto/rotulo': d_texto_rotulo, 'texto/destaque': d_texto_destaque, 'texto/pequeno': d_texto_pequeno, 'texto/codigo': d_texto_codigo,
  'lista/lista': d_lista_lista, 'lista/item': d_lista_item,
  'tabela/tabela': d_tabela_tabela, 'tabela/cabecalho': d_tabela_cabecalho, 'tabela/corpo': d_tabela_corpo, 'tabela/linha': d_tabela_linha, 'tabela/celula': d_tabela_celula,
  'entrada/numero': d_entrada_numero, 'entrada/caixa': d_entrada_caixa,
  'feedback/selo': d_feedback_selo, 'feedback/alerta': d_feedback_alerta,
  'layout/pilha': d_layout_pilha,
  'layout/linha': d_layout_linha,
  'texto/titulo': d_texto_titulo,
  'texto/paragrafo': d_texto_paragrafo,
  'midia/imagem': d_midia_imagem,
  'nav/link': d_nav_link,
  'nav/botao': d_nav_botao,
  'entrada/texto': d_entrada_texto,
}
