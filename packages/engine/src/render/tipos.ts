import type { ReactNode } from 'react'

/** Contrato de um bloco nativo: recebe as props já avaliadas e os slots já renderizados. */
export type PropsComponente = {
  props: Record<string, unknown>
  slots: Record<string, ReactNode>
  id?: string
  /** caminho JSON de origem no schema (útil para depuração e sourcemap) */
  caminho: string
}
export type Componente = (p: PropsComponente) => ReactNode
export type Componentes = Record<string, Componente>

export type ErroRuntime = {
  caminho: string
  regra: 'componente-ausente' | 'bloco-ausente' | 'codigo' | 'limite' | 'render'
  mensagem: string
}

export const LIMITES_RUNTIME = { iteracoes: 1000, profundidade: 200 }
