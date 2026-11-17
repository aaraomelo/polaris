import { createElement, type ReactNode } from 'react'
import { VAZIAS, type NoUI } from './ui'

/** Renderiza a descrição (já sanitizada) com createElement: o host nunca insere HTML cru. */
export function renderUI(no: NoUI | null, chave = 'ui'): ReactNode {
  if (no === null) return null
  if (typeof no === 'string' || typeof no === 'number') return no
  const props: Record<string, unknown> = { key: chave }
  for (const [k, val] of Object.entries(no.attrs ?? {})) props[k === 'class' ? 'className' : k === 'colspan' ? 'colSpan' : k === 'rowspan' ? 'rowSpan' : k] = val
  const filhos = (no.children ?? []).map((c, i) => renderUI(c, `${chave}.${i}`))
  // imagem vinda de código de tenant: sem referrer, carregamento preguiçoso (também evita o preload automático do React)
  if (no.tag === 'img') Object.assign(props, { referrerPolicy: 'no-referrer', loading: 'lazy', decoding: 'async' })
  return VAZIAS.has(no.tag) ? createElement(no.tag, props) : createElement(no.tag, props, ...filhos)
}
