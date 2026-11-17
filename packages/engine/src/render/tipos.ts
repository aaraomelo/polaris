import type { ReactNode } from 'react'

/** Contrato de um bloco nativo: recebe as props já avaliadas, os slots já renderizados e os emissores de evento. */
export type PropsComponente = {
  props: Record<string, unknown>
  slots: Record<string, ReactNode>
  /** evento → função que dispara as ações declaradas na instância (vazio se a instância não ligou nada) */
  on: Record<string, (payload?: unknown) => void>
  id?: string
  /** caminho JSON de origem no schema (útil para depuração e sourcemap) */
  caminho: string
}
export type Componente = (p: PropsComponente) => ReactNode
export type Componentes = Record<string, Componente>

export type ErroRuntime = {
  caminho: string
  regra: 'componente-ausente' | 'bloco-ausente' | 'codigo' | 'limite' | 'render' | 'acao' | 'dados' | 'navegacao'
  mensagem: string
}

export const LIMITES_RUNTIME = { iteracoes: 1000, profundidade: 200 }
