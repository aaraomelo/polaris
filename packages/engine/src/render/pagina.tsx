import { createElement, Fragment, useEffect, useReducer, useRef, type ReactNode } from 'react'
import { FUNCOES_PADRAO, type Escopo } from '../expr/index'
import type { StatusDado } from '../dados/carrega'
import { executaAcoes, type Carregador, type ContextoAcoes } from './acoes'
import { renderiza, type Ambiente } from './interpreta'
import type { Programa } from './programa'
import { escopoDaStore, iniciaStore, reduz } from './store'
import type { Componentes, ErroRuntime } from './tipos'
import { valorDe } from './valor'

export type EntradaPagina = {
  programa: Programa
  componentes: Componentes
  /** valor de cada variável declarada em spec.dados (resolvido por quem chama: carregador, cache, mock) */
  dados?: Record<string, unknown>
  status?: Record<string, StatusDado>
  erros?: Record<string, string>
  /** sobrescreve os valores iniciais de spec.estado (ex.: vindos do servidor) */
  estado?: Record<string, unknown>
  params?: Record<string, unknown>
  consulta?: Record<string, unknown>
  tenant?: Record<string, unknown>
  onErro?: (e: ErroRuntime) => void
  /** cliente: como executar uma variável de dados (ação `executar`) */
  carregador?: Carregador
  /** cliente: como navegar (padrão: window.location.assign, só para URLs seguras) */
  navegar?: (url: string) => void
}

export { escopoDaStore }

/** Escopo da página: params/consulta/tenant + store (estado inicial do schema se não houver). */
export function escopoDaPagina(e: Pick<EntradaPagina, 'programa' | 'dados' | 'status' | 'erros' | 'estado' | 'params' | 'consulta' | 'tenant'>): Escopo {
  const base: Escopo = { params: e.params ?? {}, consulta: e.consulta ?? {}, tenant: e.tenant ?? {} }
  return escopoDaStore(e.programa, iniciaStore(e.programa, e), base)
}

/** Título da página já avaliado (texto), para <title> / document.title. */
export function tituloDaPagina(e: EntradaPagina): string {
  const t = e.programa.pagina.titulo
  if (!t) return ''
  const v = valorDe(t, escopoDaPagina(e), FUNCOES_PADRAO)
  return v === null || v === undefined || typeof v === 'object' ? '' : String(v)
}

function PaginaInterativa(e: EntradaPagina): ReactNode {
  const [store, dispatch] = useReducer(reduz, undefined, () => iniciaStore(e.programa, e))
  const ref = useRef({ atual: store })
  ref.current.atual = store
  const sequencia = useRef<Record<string, number>>({})
  const vivo = useRef({ atual: true })
  useEffect(() => { vivo.current.atual = true; return () => { vivo.current.atual = false } }, [])

  const base: Escopo = { params: e.params ?? {}, consulta: e.consulta ?? {}, tenant: e.tenant ?? {} }
  const escopo = escopoDaStore(e.programa, store, base)

  const titulo = e.programa.pagina.titulo ? valorDe(e.programa.pagina.titulo, escopo, FUNCOES_PADRAO) : undefined
  useEffect(() => { if (typeof document !== 'undefined' && typeof titulo === 'string' && titulo) document.title = titulo }, [titulo])

  const acoes: ContextoAcoes = {
    programa: e.programa, store: ref.current, dispatch, sequencia: sequencia.current, vivo: vivo.current,
    ...(e.carregador ? { carregador: e.carregador } : {}), ...(e.navegar ? { navegar: e.navegar } : {}), ...(e.onErro ? { onErro: e.onErro } : {}),
  }
  const amb: Ambiente = { programa: e.programa, componentes: e.componentes, acoes, ...(e.onErro ? { onErro: e.onErro } : {}) }
  return createElement(Fragment, null, ...renderiza(e.programa.pagina.raiz, escopo, amb, null, 'r'))
}

/** Componente React da página: mesma entrada inicial, mesma saída (SSR e hidratação batem). */
export function Pagina(entrada: EntradaPagina): ReactNode {
  return createElement(PaginaInterativa, entrada)
}
