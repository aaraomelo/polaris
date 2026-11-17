import { ExprErro, parseExpr, type Expr } from './expr/index'

// Template de texto: "Olá {cliente.nome | maiusculas}!"
//  - texto sem binding             → { t: 'lit' }
//  - só um binding, sem texto      → { t: 'expr' }   (mantém o tipo do valor: número, booleano, lista…)
//  - mistura de texto e bindings   → { t: 'tpl' }    (sempre texto)
// Chaves literais: \{ e \}. Um } solto fora de binding é literal.

export type ParteTemplate = string | { ast: Expr; fonte: string; offset: number }
export type Template =
  | { t: 'lit'; v: string }
  | { t: 'expr'; ast: Expr; fonte: string; offset: number }
  | { t: 'tpl'; partes: ParteTemplate[] }

export class TemplateErro extends ExprErro {}

export function parseTemplate(src: string): Template {
  const partes: ParteTemplate[] = []
  let lit = ''
  let i = 0
  const solta = () => { if (lit) { partes.push(lit); lit = '' } }
  while (i < src.length) {
    const c = src[i]!
    if (c === '\\' && (src[i + 1] === '{' || src[i + 1] === '}')) { lit += src[i + 1]; i += 2; continue }
    if (c !== '{') { lit += c; i++; continue }
    // binding: procura o '}' que fecha, ignorando os que estão dentro de textos entre aspas
    let j = i + 1
    let aspa: string | null = null
    for (; j < src.length; j++) {
      const d = src[j]!
      if (aspa) { if (d === '\\') j++; else if (d === aspa) aspa = null; continue }
      if (d === '"' || d === "'") { aspa = d; continue }
      if (d === '}') break
    }
    if (j >= src.length) throw new TemplateErro("binding sem fechar: falta '}'", i, "use \\{ para escrever uma chave literal")
    const fonte = src.slice(i + 1, j)
    if (!fonte.trim()) throw new TemplateErro('binding vazio {}', i, "escreva uma expressão, como {produto.nome}, ou use \\{ \\} para chaves literais")
    let ast: Expr
    try {
      ast = parseExpr(fonte)
    } catch (e) {
      if (e instanceof ExprErro) throw new TemplateErro(e.message, i + 1 + e.pos, e.dica)
      throw e
    }
    solta()
    partes.push({ ast, fonte, offset: i + 1 })
    i = j + 1
  }
  solta()
  if (partes.length === 0) return { t: 'lit', v: '' }
  if (partes.length === 1) {
    const p = partes[0]!
    return typeof p === 'string' ? { t: 'lit', v: p } : { t: 'expr', ast: p.ast, fonte: p.fonte, offset: p.offset }
  }
  return { t: 'tpl', partes }
}
