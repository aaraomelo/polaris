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
  /** o valor vai no CONTEÚDO do elemento (textarea), não no atributo `value`: o HTML estático e o React o escrevem como texto */
  valorNoTexto?: true
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
      return { ...comId(id), src: urlSegura(p.src) ?? '', alt: txt(p.alt), ...(w !== undefined ? { width: String(w) } : {}), ...(h !== undefined ? { height: String(h) } : {}), loading: 'lazy', style: 'max-width:100%;height:auto' } // `largura`/`altura` reservam o espaço (sem salto de layout), mas a imagem NUNCA passa do contêiner (coluna estreita, celular)
    },
  }
export const d_nav_link: Descritor = {
    chave: (p) => (p.texto !== undefined ? 'a:t' : 'a:f'), tag: () => 'a', filhos: true,
    attrs: (p, id) => {
      const href = urlSegura(p.href)
      return { ...comId(id), ...(href ? { href } : {}), ...(typeof href === 'string' && /^https?:/i.test(href) ? { rel: 'noopener noreferrer' } : {}), ...(p.atual === true ? { 'aria-current': 'page' } : {}) }
    },
    texto: (p) => (p.texto !== undefined ? txt(p.texto) : undefined),
  }
export const d_nav_botao: Descritor = {
    chave: () => 'button', tag: () => 'button', texto: (p) => txt(p.texto),
    attrs: (p, id) => ({ ...comId(id), type: 'button', ...(p.desabilitado === true ? { disabled: '' } : {}) }),
    eventos: { aoClicar: { dom: 'click' } },
  }
/** nome acessível do campo: `rotulo` vira `aria-label` (sem ele, o único jeito era um `texto/rotulo` ligado por `para`/`id`) */
const rotulo = (p: Record<string, unknown>): Record<string, string> => (typeof p.rotulo === 'string' && p.rotulo.trim() ? { 'aria-label': p.rotulo.trim().slice(0, 200) } : {})
export const d_entrada_texto: Descritor = {
    chave: () => 'input', tag: () => 'input', valor: (p) => txt(p.valor),
    attrs: (p, id) => ({ ...comId(id), type: 'text', ...rotulo(p), placeholder: txt(p.placeholder), ...(p.desabilitado === true ? { disabled: '' } : {}) }),
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
export const d_layout_cabecalho: Descritor = { chave: () => 'header', tag: () => 'header', filhos: true, attrs: (p, id) => ({ ...comId(id), ...(p.fixo === true ? { 'data-fixo': '' } : {}) }) }
export const d_nav_menu: Descritor = { chave: () => 'nav', tag: () => 'nav', filhos: true, attrs: (p, id) => ({ ...comId(id), 'aria-label': typeof p.rotulo === 'string' && p.rotulo ? p.rotulo : 'Principal' }) }
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
  attrs: (p, id) => ({ ...comId(id), type: 'number', ...rotulo(p), placeholder: txt(p.placeholder), ...opcional('min', p.min), ...opcional('max', p.max), ...opcional('step', p.passo), ...(p.desabilitado === true ? { disabled: '' } : {}) }),
  eventos: { aoMudar: { dom: 'input', payload: (e) => { const v = (e.target as HTMLInputElement).value; return v === '' ? null : Number(v) } } },
}
export const d_entrada_caixa: Descritor = {
  chave: () => 'input', tag: () => 'input', marcado: (p) => p.marcado === true,
  attrs: (p, id) => ({ ...comId(id), type: 'checkbox', ...rotulo(p), ...(p.desabilitado === true ? { disabled: '' } : {}) }),
  eventos: { aoMudar: { dom: 'input', payload: (e) => (e.target as HTMLInputElement).checked } },
}
export const ident = (v: unknown): string => (typeof v === 'string' && /^[a-z][A-Za-z0-9._-]{0,63}$/.test(v) ? v : '')
export const dimensao = (v: unknown): string => String(Math.min(2048, Math.max(1, Math.trunc(num(v) ?? 300))))
/** só números, booleanos e textos curtos viram `data-polaris-entradas` (o carregador valida contra o kernel; aqui é só transporte) */
export const entradasJson = (v: unknown): string => {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return '{}'
  const o: Record<string, number | boolean> = {}
  for (const [k, x] of Object.entries(v as Record<string, unknown>)) if (/^[a-z][A-Za-z0-9]*$/.test(k) && (typeof x === 'boolean' || (typeof x === 'number' && Number.isFinite(x)))) o[k] = x
  return JSON.stringify(o)
}
/** Canvas de um kernel de computação (WebGL2, com queda para wasm e depois para o interpretador). O carregador `@polaris/computacao/cliente` o pinta; sem ele, ou sem JS, fica o texto alternativo. */
export const d_computacao_canvas_gl: Descritor = {
  chave: (p) => (ident(p.kernel) ? 'canvas' : null), tag: () => 'canvas', texto: (p) => txt(p.alt),
  attrs: (p, id) => ({ ...comId(id), width: dimensao(p.largura), height: dimensao(p.altura), role: 'img', 'aria-label': txt(p.alt), 'data-polaris-kernel': ident(p.kernel), 'data-polaris-entradas': entradasJson(p.entradas) }),
}
export const d_entrada_area: Descritor = {
  chave: () => 'textarea', tag: () => 'textarea', valor: (p) => txt(p.valor), valorNoTexto: true, texto: (p) => txt(p.valor),
  attrs: (p, id) => ({ ...comId(id), ...rotulo(p), placeholder: txt(p.placeholder), rows: String(inteiro(p.linhas, 1, 40, 4)), ...(p.desabilitado === true ? { disabled: '' } : {}), spellcheck: 'false' }),
  eventos: { aoMudar: { dom: 'input', payload: (e) => (e.target as HTMLTextAreaElement).value } },
}
/** Formulário declarativo (`kind: formulario`): o servidor entrega só o ponto de montagem; o carregador `@polaris/engine/formulario-cliente` (a "ilha") busca a definição, monta os campos com máscaras e validação e envia. Sem JavaScript fica o texto. */
export const idFormulario = (v: unknown): string => (typeof v === 'string' && /^[a-z0-9][a-z0-9._-]{0,127}$/.test(v) ? v : '')
/** valores iniciais: só primitivos (e listas deles) de chaves seguras, até 20 KB: é transporte para o carregador, que valida contra o formulário */
export const valoresIniciaisJson = (v: unknown): string => {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return ''
  const o: Record<string, unknown> = {}
  const prim = (x: unknown) => typeof x === 'string' ? x.slice(0, 2000) : typeof x === 'boolean' || (typeof x === 'number' && Number.isFinite(x)) ? x : undefined
  for (const [k, x] of Object.entries(v as Record<string, unknown>).slice(0, 200)) {
    if (!/^[a-z][A-Za-z0-9]*$/.test(k)) continue
    const val = Array.isArray(x) ? x.slice(0, 100).map(prim).filter((y) => y !== undefined) : prim(x)
    if (val !== undefined) o[k] = val
  }
  const j = JSON.stringify(o); return j.length > 20_000 || j === '{}' ? '' : j
}
export const d_form_formulario: Descritor = {
  chave: (p) => (idFormulario(p.formulario) ? `div:${idFormulario(p.formulario)}` : null), tag: () => 'div', texto: () => 'Carregando formulário…',
  attrs: (p, id) => {
    const valores = valoresIniciaisJson(p.valores), idioma = typeof p.idioma === 'string' && /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})?$/.test(p.idioma) ? p.idioma : ''
    return { ...comId(id), 'data-polaris-formulario': idFormulario(p.formulario), ...(valores ? { 'data-polaris-valores': valores } : {}), ...(idioma ? { 'data-polaris-idioma': idioma } : {}), role: 'group', 'aria-busy': 'true' }
  },
  eventos: { aoEnviado: { dom: 'polaris-enviado', payload: (e) => (e as CustomEvent).detail }, aoErro: { dom: 'polaris-erro', payload: (e) => (e as CustomEvent).detail } },
}
/** Quadro: um documento HTML dentro de um iframe SEMPRE com `sandbox=""` (sem scripts, sem formulários, sem navegação, origem opaca). Nada nas props altera o sandbox. */
export const QUADRO_MAX = 262_144
export const d_midia_quadro: Descritor = {
  chave: () => 'iframe', tag: () => 'iframe',
  attrs: (p, id) => ({ ...comId(id), sandbox: '', title: txt(p.titulo).slice(0, 200), srcdoc: txt(p.html).slice(0, QUADRO_MAX), referrerpolicy: 'no-referrer', style: `width:100%;height:${px(inteiro(p.altura, 40, 4000, 320))};border:0` }),
}
export const d_feedback_selo: Descritor = { chave: () => 'span', tag: () => 'span', attrs: (p, id) => ({ ...comId(id), ...tom(p) }), texto: (p) => txt(p.texto) }
export const d_feedback_alerta: Descritor = { chave: () => 'div', tag: () => 'div', filhos: true, attrs: (p, id) => ({ ...comId(id), role: 'alert', ...tom(p) }) }

export const DESCRITORES_BASE: DescritoresDom = {
  'layout/cabecalho': d_layout_cabecalho, 'nav/menu': d_nav_menu,
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
  'computacao/canvas-gl': d_computacao_canvas_gl,
  'entrada/area': d_entrada_area,
  'midia/quadro': d_midia_quadro,
  'form/formulario': d_form_formulario,
  'nav/link': d_nav_link,
  'nav/botao': d_nav_botao,
  'entrada/texto': d_entrada_texto,
}
