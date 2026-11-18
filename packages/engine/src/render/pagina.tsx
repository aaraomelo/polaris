import { createElement, Fragment, useEffect, useReducer, useRef, type ReactNode } from 'react'
import { FUNCOES_PADRAO, type Escopo } from '../expr/index'
import type { ResultadoUm, StatusDado } from '../dados/carrega'
import { SessaoCodigo, type ConfigCodigo } from '../codigo/sessao'
import type { Carregador, ContextoAcoes } from './acoes'
import { renderiza, type Ambiente } from './interpreta'
import type { Programa } from './programa'
import { escopoDaStore, iniciaStore, reduz } from './store'
import type { Componentes, ErroRuntime } from './tipos'
import { valorDe } from './valor'

export type EntradaPagina = {
  programa: Programa
  componentes: Componentes
  /** valor de cada variável declarada em spec.dados (resolvido por quem chama: carregador, cache, mock) */
  dados?: Record<string, unknown> | undefined
  status?: Record<string, StatusDado> | undefined
  erros?: Record<string, string> | undefined
  /** sobrescreve os valores iniciais de spec.estado (ex.: vindos do servidor) */
  estado?: Record<string, unknown> | undefined
  params?: Record<string, unknown> | undefined
  consulta?: Record<string, unknown> | undefined
  tenant?: Record<string, unknown> | undefined
  /** idioma da requisição (variável `idioma`) */
  idioma?: string | undefined
  onErro?: ((e: ErroRuntime) => void) | undefined
  /** cliente: como executar uma variável de dados (ação `executar`) */
  carregador?: Carregador | undefined
  /** cliente: como navegar (padrão: window.location.assign, só para URLs seguras) */
  navegar?: ((url: string) => void) | undefined
  /** SERVIDOR (streaming): cargas já em andamento que o Suspense consome */
  stream?: Record<string, Promise<ResultadoUm>> | undefined
  /** executor isolado de blocos de código (ver docs/sandbox.md) */
  codigo?: ConfigCodigo | undefined
}

export { escopoDaStore }

/** Escopo da página: params/consulta/tenant + store (estado inicial do schema se não houver). */
export function escopoDaPagina(e: Pick<EntradaPagina, 'programa' | 'dados' | 'status' | 'erros' | 'estado' | 'params' | 'consulta' | 'tenant' | 'idioma'>): Escopo {
  const base: Escopo = { params: e.params ?? {}, consulta: e.consulta ?? {}, tenant: e.tenant ?? {}, idioma: e.idioma ?? '' }
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
  // uma sessão por montagem (o cache sobrevive aos re-renders); o orçamento recomeça a cada passagem de render
  const sessaoCodigo = useRef<SessaoCodigo | null>(null)
  if (e.codigo && (!sessaoCodigo.current || sessaoCodigo.current.cfg !== e.codigo)) sessaoCodigo.current = new SessaoCodigo(e.codigo)
  sessaoCodigo.current?.novaPassagem()
  const vivo = useRef({ atual: true })
  useEffect(() => { vivo.current.atual = true; return () => { vivo.current.atual = false } }, [])

  const base: Escopo = { params: e.params ?? {}, consulta: e.consulta ?? {}, tenant: e.tenant ?? {}, idioma: e.idioma ?? '' }
  const escopo = escopoDaStore(e.programa, store, base)

  const titulo = e.programa.pagina.titulo ? valorDe(e.programa.pagina.titulo, escopo, FUNCOES_PADRAO) : undefined
  useEffect(() => { if (typeof document !== 'undefined' && typeof titulo === 'string' && titulo) document.title = titulo }, [titulo])

  const acoes: ContextoAcoes = {
    programa: e.programa, store: ref.current, dispatch, sequencia: sequencia.current, vivo: vivo.current,
    ...(e.carregador ? { carregador: e.carregador } : {}), ...(e.navegar ? { navegar: e.navegar } : {}), ...(e.onErro ? { onErro: e.onErro } : {}),
  }
  const amb: Ambiente = { programa: e.programa, componentes: e.componentes, acoes, ...(e.onErro ? { onErro: e.onErro } : {}), ...(e.stream ? { stream: e.stream } : {}), ...(sessaoCodigo.current ? { codigo: sessaoCodigo.current } : {}) }
  const filhos = renderiza(e.programa.pagina.raiz, escopo, amb, null, 'r')
  // Uma fronteira Suspense SEM elemento DOM acima dela não é liberada pelo React no streaming: o shell (inclusive o
  // esqueleto) só sairia quando o dado chegasse. Se a raiz da página é a própria fronteira, ela ganha um invólucro
  // sem efeito visual (display: contents).
  const raiz = e.programa.pagina.raiz
  const raizEhFronteira = raiz.tipo === 'elemento' && !!raiz.aguarda?.length
  return raizEhFronteira ? createElement('div', { style: { display: 'contents' } }, ...filhos) : createElement(Fragment, null, ...filhos)
}

/** Componente React da página: mesma entrada inicial, mesma saída (SSR e hidratação batem). */
export function Pagina(entrada: EntradaPagina): ReactNode {
  return createElement(PaginaInterativa, entrada)
}
