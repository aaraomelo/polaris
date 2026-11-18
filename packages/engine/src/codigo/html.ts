import { ExprErro, parseExpr, validaExpr } from '../expr/index'

// Template de HTML de bloco em iframe: {{ expressão }}, com `props` e `tenant` no escopo.
// (Chaves duplas porque HTML/CSS/JS usam { } o tempo todo.) O valor é SEMPRE escapado.

export { escapaHtml, type ParteHtml } from './html-render'
import type { ParteHtml } from './html-render'

export function parseHtmlTemplate(src: string, escopo: readonly string[]): { partes: ParteHtml[]; erros: Array<{ mensagem: string; dica?: string }> } {
  const partes: ParteHtml[] = []
  const erros: Array<{ mensagem: string; dica?: string }> = []
  const re = /\{\{([\s\S]*?)\}\}/g
  let ult = 0
  for (let m = re.exec(src); m; m = re.exec(src)) {
    if (m.index > ult) partes.push(src.slice(ult, m.index))
    const fonte = m[1]!.trim()
    try {
      const ast = parseExpr(fonte)
      for (const p of validaExpr(ast, escopo)) erros.push({ mensagem: `${p.mensagem} (em '{{ ${fonte} }}')`, ...(p.dica ? { dica: p.dica } : {}) })
      partes.push({ ast, fonte })
    } catch (e) {
      if (e instanceof ExprErro) erros.push({ mensagem: `${e.message} (em '{{ ${fonte} }}')`, ...(e.dica ? { dica: e.dica } : {}) })
      else throw e
    }
    ult = m.index + m[0].length
  }
  if (ult < src.length) partes.push(src.slice(ult))
  if (/\{\{/.test(src.replace(/\{\{[\s\S]*?\}\}/g, ''))) erros.push({ mensagem: "'{{' sem fechar", dica: 'feche com }}' })
  return { partes, erros }
}

import { renderHtmlTemplate as renderBase } from './html-render'
import { funcoesPadrao } from '../expr/padrao'
import type { Escopo } from '../expr/avalia'
import type { Funcoes } from '../expr/tipos'

/** versão de servidor/React: com a biblioteca padrão completa (o cliente por página usa `html-render` com só as funções que a página usa) */
export const renderHtmlTemplate = (partes: readonly ParteHtml[], escopo: Escopo, funcoes: Funcoes = funcoesPadrao()): string => renderBase(partes, escopo, funcoes)
