import { createElement, type ReactNode } from 'react'
import { funcoesPadrao } from '../expr/padrao'
import type { Escopo } from '../expr/index'
import type { ErroRuntime } from '../render/tipos'
import { calculaCodigo } from './calcula'
import { IframeIsolado } from './iframe'
import type { CodigoDef } from './def'
import type { SessaoCodigo } from './sessao'
import { renderUI } from './ui-react'

export type EntradaCodigo = {
  def: CodigoDef
  props: Record<string, unknown>
  /** escopo do bloco: props e tenant */
  escopo: Escopo
  idioma?: string
  caminho: string
  chave: string
  sessao: SessaoCodigo | undefined
  relata: (e: ErroRuntime) => void
}

/** Renderiza um bloco de código para o React. Fail-closed: qualquer falha omite o bloco e reporta, a página segue. */
export function renderizaCodigo(e: EntradaCodigo): ReactNode {
  const r = calculaCodigo({ funcoes: funcoesPadrao(), ...e })
  if (r.tipo === 'falha') return null
  if (r.tipo === 'iframe') return createElement(IframeIsolado, { key: e.chave, srcDoc: r.srcDoc, sandbox: r.sandbox, altura: r.altura, titulo: r.titulo, autoAltura: r.autoAltura })
  return renderUI(r.no, e.chave)
}
