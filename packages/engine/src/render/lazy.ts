import { lazy as reactLazy, type ComponentType, type ReactNode } from 'react'
import type { IRNo } from '../ir/tipos'
import type { Programa } from './programa'
import type { Componente, ComponenteLazy, Componentes, PropsComponente } from './tipos'

// ---------------------------------------------------------------------------
// Code splitting por bloco. Um bloco pode ser registrado como `lazyBloco(() => import('./x'))`.
//  - Só os blocos que o Programa usa são carregados (os outros nunca são tocados).
//  - `preCarregaBlocos` carrega esses módulos ANTES de renderizar; depois disso o bloco é chamado de forma
//    síncrona (sem Suspense, sem fallback, e servidor e cliente geram a mesma árvore).
//  - Se não foi pré-carregado, cai em React.lazy + Suspense (navegação no cliente).
// ---------------------------------------------------------------------------

export function lazyBloco(carrega: ComponenteLazy['lazy'], opcoes: { chunk?: string } = {}): ComponenteLazy {
  return { lazy: carrega, ...(opcoes.chunk ? { chunk: opcoes.chunk } : {}) }
}

export const ehLazy = (e: Componente | ComponenteLazy | undefined): e is ComponenteLazy => typeof e === 'object' && e !== null && typeof (e as ComponenteLazy).lazy === 'function'

const resolvidos = new WeakMap<ComponenteLazy, Componente>()
const falhos = new WeakSet<ComponenteLazy>()
const envoltorios = new WeakMap<ComponenteLazy, ComponentType<PropsComponente>>()

const extrai = (m: Componente | { default: Componente }): Componente => (typeof m === 'function' ? m : m.default)

/** O componente já carregado desta entrada, se houver. */
export const carregado = (e: ComponenteLazy): Componente | undefined => resolvidos.get(e)
export const falhou = (e: ComponenteLazy): boolean => falhos.has(e)

/** Envoltório React.lazy (um por entrada): usado só quando o módulo ainda não foi pré-carregado. */
export function envoltorioLazy(e: ComponenteLazy): ComponentType<PropsComponente> {
  let w = envoltorios.get(e)
  if (!w) {
    w = reactLazy(async () => {
      const f = extrai(await e.lazy())
      resolvidos.set(e, f)
      return { default: (p: PropsComponente): ReactNode => f(p) }
    }) as unknown as ComponentType<PropsComponente>
    envoltorios.set(e, w)
  }
  return w
}

export type BlocoUsado = { interface: string; entrada: Componente | ComponenteLazy }

/** Os componentes que o Programa realmente usa (nativos, inclusive dentro de modelos de blocos compostos e esqueletos). */
export function blocosUsados(programa: Programa, componentes: Componentes): BlocoUsado[] {
  const achados = new Map<string, BlocoUsado>()
  const anda = (no: IRNo): void => {
    if (no.tipo !== 'elemento') return
    if (no.bloco.impl === 'nativo') {
      const k = no.bloco.cadeia.find((c) => componentes[c])
      if (k && !achados.has(k)) achados.set(k, { interface: k, entrada: componentes[k]! })
    }
    for (const lista of Object.values(no.slots)) lista.forEach(anda)
    if (no.esqueleto) anda(no.esqueleto)
  }
  anda(programa.pagina.raiz)
  for (const b of Object.values(programa.blocos)) anda(b.modelo)
  return [...achados.values()]
}

export type ResultadoPreCarga = { carregados: string[]; falhas: Array<{ interface: string; erro: string }> }

/** Carrega, em paralelo, os módulos lazy que o Programa usa. Nunca lança; falha vira `falhas`. */
export async function preCarregaBlocos(programa: Programa, componentes: Componentes): Promise<ResultadoPreCarga> {
  const lazies = blocosUsados(programa, componentes).filter((b): b is { interface: string; entrada: ComponenteLazy } => ehLazy(b.entrada))
  const saida: ResultadoPreCarga = { carregados: [], falhas: [] }
  await Promise.all(lazies.map(async ({ interface: nome, entrada }) => {
    if (resolvidos.has(entrada)) { saida.carregados.push(nome); return }
    try {
      resolvidos.set(entrada, extrai(await entrada.lazy()))
      falhos.delete(entrada)
      saida.carregados.push(nome)
    } catch (e) {
      falhos.add(entrada)
      saida.falhas.push({ interface: nome, erro: e instanceof Error ? e.message : String(e) })
    }
  }))
  return saida
}

/** URLs de `modulepreload` dos blocos lazy usados (só os que informaram `chunk`). */
export function chunksParaPreload(programa: Programa, componentes: Componentes): string[] {
  return blocosUsados(programa, componentes)
    .map((b) => (ehLazy(b.entrada) ? b.entrada.chunk : undefined))
    .filter((c): c is string => typeof c === 'string')
}
