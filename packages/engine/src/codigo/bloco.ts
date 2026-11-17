import { createElement, type ReactNode } from 'react'
import type { Escopo } from '../expr/index'
import type { ErroRuntime } from '../render/tipos'
import { renderHtmlTemplate } from './html'
import { documentoHtml, documentoJs, IframeIsolado } from './iframe'
import { foraDaAllowlist, parsePermissoes } from './permissoes'
import { PADROES_CODIGO } from './sandbox'
import type { CodigoDef } from './def'
import type { SessaoCodigo } from './sessao'
import { renderUI, sanitizaUI } from './ui'

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

/** Renderiza um bloco de código. Fail-closed: qualquer falha omite o bloco e reporta, a página segue. */
export function renderizaCodigo(e: EntradaCodigo): ReactNode {
  const { def, caminho } = e
  const falha = (mensagem: string): null => { e.relata({ caminho, regra: 'codigo', mensagem: `bloco '${def.interface}': ${mensagem}` }); return null }
  if (!e.sessao) return falha('nenhum sandbox configurado (EntradaPagina.codigo)')
  const cfg = e.sessao.cfg

  if (def.modo === 'iframe') {
    const perm = parsePermissoes(def.permissoes)
    if (!perm.ok) return falha(perm.erros.join('; '))
    const nega = foraDaAllowlist(perm.permissoes, cfg.origensPermitidas)
    if (nega.length) return falha(`origens não liberadas pela plataforma: ${nega.join(', ')}`)
    const doc = def.linguagem === 'html'
      ? documentoHtml(renderHtmlTemplate(def.partes ?? [], e.escopo), perm.permissoes)
      : documentoJs(def.fonte, e.props, perm.permissoes)
    const titulo = typeof e.props.titulo === 'string' && e.props.titulo ? e.props.titulo : 'Conteúdo isolado'
    return createElement(IframeIsolado, { key: e.chave, srcDoc: doc.srcDoc, sandbox: doc.sandbox, altura: def.altura, titulo, autoAltura: def.linguagem === 'js' })
  }

  // modo puro: o código só CALCULA uma descrição de UI; o host valida e renderiza
  const r = e.sessao.executa({
    fonte: def.fonte, props: e.props,
    contexto: { agora: cfg.agora ?? '1970-01-01T00:00:00.000Z', ...(e.idioma ? { idioma: e.idioma } : {}), tenant: e.escopo.tenant ?? {} },
    ms: PADROES_CODIGO.ms, memoriaBytes: PADROES_CODIGO.memoriaBytes, saidaMaxBytes: PADROES_CODIGO.saidaMaxBytes,
  })
  if (!r.ok) return falha(`${r.tipo}: ${r.erro}`)
  for (const l of r.logs) e.relata({ caminho, regra: 'codigo', mensagem: `bloco '${def.interface}' (console): ${l}` })
  let bruto: unknown
  try { bruto = JSON.parse(r.saida) } catch { return falha('a saída não é JSON válido') }
  const { no, violacoes } = sanitizaUI(bruto, { origensImagem: cfg.origensPermitidas ?? [] })
  for (const v of violacoes.slice(0, 20)) e.relata({ caminho, regra: 'codigo', mensagem: `bloco '${def.interface}' saída${v.caminho}: ${v.mensagem}` })
  return renderUI(no, e.chave)
}
