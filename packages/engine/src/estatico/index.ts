import { escopoDaStore, iniciaStore, type SementeStore } from '../render/store'
import type { Programa } from '../render/programa'
import type { ErroRuntime } from '../render/tipos'
import { EMISSORES_BASE, type Emissores } from './emissores'
import { geraEstatico, type ContextoCodigo, type Estatico, type FronteiraInfo, type Motivo } from './gera'
import { SessaoCodigo, type ConfigCodigo } from '../codigo/sessao'
import { DESCRITORES_BASE, type DescritoresDom } from '../vivo/blocos'
import { emissoresDe } from '../vivo/emissor'

export { EMISSORES_BASE, INTERATIVOS, type Emissor, type Emissores, type EntradaEmissor } from './emissores'
export { escHtml } from './escape'
export type { Motivo, Estatico } from './gera'

export type EntradaEstatica = SementeStore & {
  params?: Record<string, unknown>
  consulta?: Record<string, unknown>
  tenant?: Record<string, unknown>
  idioma?: string
  onErro?: (e: ErroRuntime) => void
  /** sandbox e orçamento dos blocos de código (só no HTML do runtime vivo); sem isso, bloco de código sai vazio e é reportado */
  codigo?: ConfigCodigo
}

export type PaginaEstatica = {
  /** o JavaScript gerado: pode ser gravado em arquivo (AOT) */
  fonte: string
  render(entrada?: EntradaEstatica): { corpo: string; titulo: string }
  /** fronteiras de streaming (HTML marcado do modo vivo) */
  fronteiras: FronteiraInfo[]
  /** dados em streaming usados por fronteiras que não podem ser trocadas no HTML (chegam ao cliente só depois da hidratação) */
  retidas: string[]
  /** HTML do conteúdo de uma fronteira com o estado dado (sem os marcadores) */
  renderFronteira(chave: string, entrada?: EntradaEstatica): string
}

const cache = new WeakMap<Programa, WeakMap<Emissores, ReturnType<typeof geraEstatico>>>()
const cacheVivo = new WeakMap<Programa, WeakMap<DescritoresDom, ReturnType<typeof geraEstatico>>>()
const emissoresVivo = new WeakMap<DescritoresDom, Emissores>()

function paginaDe(programa: Programa, r: Extract<ReturnType<typeof geraEstatico>, { ok: true }>): PaginaEstatica {
  const est: Estatico = r.estatico
  // o mesmo escopo que o interpretador React monta (render/pagina.tsx), sem importar React
  const escopoDe = (e: EntradaEstatica) => escopoDaStore(programa, iniciaStore(programa, e), { params: e.params ?? {}, consulta: e.consulta ?? {}, tenant: e.tenant ?? {}, idioma: e.idioma ?? '' })
  const sessoes = new WeakMap<ConfigCodigo, SessaoCodigo>()
  const contexto = (e: EntradaEstatica): ContextoCodigo => {
    const relata = e.onErro ?? (() => {})
    if (!e.codigo) return { relata }
    let s = sessoes.get(e.codigo)
    if (!s) { s = new SessaoCodigo(e.codigo); sessoes.set(e.codigo, s) }
    s.novaPassagem()
    return { sessao: s, relata }
  }
  return {
    fonte: est.fonte,
    fronteiras: est.fronteiras, retidas: est.retidas,
    render(e: EntradaEstatica = {}) { const esc = escopoDe(e); return { corpo: est.render(esc, e.onErro, contexto(e)), titulo: est.titulo(esc) } },
    renderFronteira(chave: string, e: EntradaEstatica = {}) { return est.renderFronteira(chave, escopoDe(e), contexto(e)) },
  }
}

/**
 * HTML de servidor para o runtime vivo: os mesmos blocos (derivados dos descritores DOM), mais os marcadores de comentário
 * (`<!---->`) de `se`, `repetir` e itens que o cliente ADOTA na hidratação. Aceita eventos e blocos interativos.
 */
export function compilaHtmlVivo(programa: Programa, descritores: DescritoresDom = DESCRITORES_BASE): { ok: true; pagina: PaginaEstatica } | { ok: false; motivos: Motivo[] } {
  let por = cacheVivo.get(programa)
  if (!por) { por = new WeakMap(); cacheVivo.set(programa, por) }
  let r = por.get(descritores)
  if (!r) {
    let em = emissoresVivo.get(descritores)
    if (!em) { em = emissoresDe(descritores); emissoresVivo.set(descritores, em) }
    r = geraEstatico(programa, em, undefined, true)
    por.set(descritores, r)
  }
  return r.ok ? { ok: true, pagina: paginaDe(programa, r) } : r
}

/**
 * Traduz o programa para uma função JS especializada, se a página não precisa de JavaScript no cliente
 * (sem eventos, streaming, blocos de código nem blocos interativos). O resultado é memoizado por programa.
 * Se não puder, devolve os motivos (caminho + por quê).
 */
export function compilaEstatico(programa: Programa, emissores: Emissores = EMISSORES_BASE): { ok: true; pagina: PaginaEstatica } | { ok: false; motivos: Motivo[] } {
  let porEmissores = cache.get(programa)
  if (!porEmissores) { porEmissores = new WeakMap(); cache.set(programa, porEmissores) }
  let r = porEmissores.get(emissores)
  if (!r) { r = geraEstatico(programa, emissores); porEmissores.set(emissores, r) }
  return r.ok ? { ok: true, pagina: paginaDe(programa, r) } : r
}

const escAttr = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** Documento HTML completo de uma página estática: sem estado de hidratação, sem <script>, sem contêiner. Zero JavaScript. */
export function documentoEstatico(p: { corpo: string; titulo: string; lang?: string }): string {
  return `<!doctype html><html lang="${escAttr(p.lang ?? 'pt-BR')}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escAttr(p.titulo)}</title></head><body>${p.corpo}</body></html>`
}
