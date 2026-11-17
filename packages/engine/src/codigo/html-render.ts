import type { Expr, Funcoes } from '../expr/tipos'
import { avaliaC } from '../expr/compila'
import { paraTexto } from '../expr/texto'
import type { Escopo } from '../expr/avalia'

// Renderização do template de HTML de bloco em iframe ({{ expressão }}): valor SEMPRE escapado. Sem parser nem validador (isso é do servidor/build):
// o cliente só avalia expressões já analisadas, com closures, e com as funções que a página usa (`funcoes`; padrão: a biblioteca registrada).

export type ParteHtml = string | { ast: Expr; fonte: string }

export const escapaHtml = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')

export function renderHtmlTemplate(partes: readonly ParteHtml[], escopo: Escopo, funcoes: Funcoes): string {
  return partes.map((p) => (typeof p === 'string' ? p : escapaHtml(paraTexto(avaliaC(p.ast, escopo, funcoes))))).join('')
}
