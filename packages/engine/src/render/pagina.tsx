import { createElement, Fragment, type ReactNode } from 'react'
import { avalia, FUNCOES_PADRAO, type Escopo } from '../expr/index'
import { renderiza, type Ambiente } from './interpreta'
import type { Programa } from './programa'
import type { Componentes, ErroRuntime } from './tipos'
import { valorDe } from './valor'

export type EntradaPagina = {
  programa: Programa
  componentes: Componentes
  /** valor de cada variável declarada em spec.dados (resolvido por quem chama: serviço, cache, mock) */
  dados?: Record<string, unknown>
  params?: Record<string, unknown>
  consulta?: Record<string, unknown>
  tenant?: Record<string, unknown>
  onErro?: (e: ErroRuntime) => void
}

/** Escopo da página: params/consulta/tenant + SÓ os dados declarados em spec.dados (o resto é ignorado). */
export function escopoDaPagina(e: Pick<EntradaPagina, 'programa' | 'dados' | 'params' | 'consulta' | 'tenant'>): Escopo {
  const escopo: Escopo = { params: e.params ?? {}, consulta: e.consulta ?? {}, tenant: e.tenant ?? {} }
  for (const nome of Object.keys(e.programa.pagina.dados)) {
    // hasOwn: um nome como 'toString' declarado em spec.dados não pode puxar Object.prototype.toString
    if (e.dados && Object.prototype.hasOwnProperty.call(e.dados, nome)) escopo[nome] = e.dados[nome]
  }
  return escopo
}

/** Título da página já avaliado (texto), para <title> / document.title. */
export function tituloDaPagina(e: EntradaPagina): string {
  const t = e.programa.pagina.titulo
  if (!t) return ''
  const v = valorDe(t, escopoDaPagina(e), FUNCOES_PADRAO)
  return v === null || v === undefined || typeof v === 'object' ? '' : String(v)
}

/** Componente React da página. Pura: mesma entrada, mesma saída (SSR e hidratação batem). */
export function Pagina(entrada: EntradaPagina): ReactNode {
  const amb: Ambiente = { programa: entrada.programa, componentes: entrada.componentes, ...(entrada.onErro ? { onErro: entrada.onErro } : {}) }
  return createElement(Fragment, null, ...renderiza(entrada.programa.pagina.raiz, escopoDaPagina(entrada), amb, null, 'r'))
}

export { avalia }
