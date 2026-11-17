import { escopoDaStore, iniciaStore, type SementeStore } from '../render/store'
import type { Programa } from '../render/programa'
import type { ErroRuntime } from '../render/tipos'
import { EMISSORES_BASE, type Emissores } from './emissores'
import { geraEstatico, type Estatico, type Motivo } from './gera'

export { EMISSORES_BASE, INTERATIVOS, type Emissor, type Emissores, type EntradaEmissor } from './emissores'
export { escHtml } from './escape'
export type { Motivo, Estatico } from './gera'

export type EntradaEstatica = SementeStore & {
  params?: Record<string, unknown>
  consulta?: Record<string, unknown>
  tenant?: Record<string, unknown>
  idioma?: string
  onErro?: (e: ErroRuntime) => void
}

export type PaginaEstatica = {
  /** o JavaScript gerado: pode ser gravado em arquivo (AOT) */
  fonte: string
  render(entrada?: EntradaEstatica): { corpo: string; titulo: string }
}

const cache = new WeakMap<Programa, WeakMap<Emissores, ReturnType<typeof geraEstatico>>>()

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
  if (!r.ok) return r
  const est: Estatico = r.estatico
  return {
    ok: true,
    pagina: {
      fonte: est.fonte,
      render(e: EntradaEstatica = {}) {
        // o mesmo escopo que o interpretador React monta (render/pagina.tsx), sem importar React
        const base = { params: e.params ?? {}, consulta: e.consulta ?? {}, tenant: e.tenant ?? {}, idioma: e.idioma ?? '' }
        const esc = escopoDaStore(programa, iniciaStore(programa, e), base)
        return { corpo: est.render(esc, e.onErro), titulo: est.titulo(esc) }
      },
    },
  }
}

const escAttr = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** Documento HTML completo de uma página estática: sem estado de hidratação, sem <script>, sem contêiner. Zero JavaScript. */
export function documentoEstatico(p: { corpo: string; titulo: string; lang?: string }): string {
  return `<!doctype html><html lang="${escAttr(p.lang ?? 'pt-BR')}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escAttr(p.titulo)}</title></head><body>${p.corpo}</body></html>`
}
