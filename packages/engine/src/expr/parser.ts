import { sugere } from '@polaris/schema/sugere'
import { ExprErro, LIMITES_EXPR, type Bin, type Expr } from './tipos'

type Tok = { k: 'num' | 'str' | 'id' | 'op' | 'fim'; v: string; pos: number }

const OPS = ['??', '||', '&&', '==', '!=', '<=', '>=', '<', '>', '+', '-', '*', '/', '%', '!', '|', '.', ',', '(', ')', '[', ']', '?', ':']
const ESCAPES: Record<string, string> = { n: '\n', t: '\t', '\\': '\\', "'": "'", '"': '"' }

function lex(src: string): Tok[] {
  const toks: Tok[] = []
  let i = 0
  while (i < src.length) {
    const c = src[i]!
    if (/\s/.test(c)) { i++; continue }
    const pos = i
    if (/[0-9]/.test(c)) {
      let j = i
      while (/[0-9]/.test(src[j] ?? '')) j++
      if (src[j] === '.' && /[0-9]/.test(src[j + 1] ?? '')) { j++; while (/[0-9]/.test(src[j] ?? '')) j++ }
      // notação científica (1e3, 2.5e-7): o que `String(n)` produz para qualquer número, para o texto canônico ler de volta
      if ((src[j] === 'e' || src[j] === 'E') && /[0-9]/.test(src[j + 1] === '+' || src[j + 1] === '-' ? (src[j + 2] ?? '') : (src[j + 1] ?? ''))) {
        j += src[j + 1] === '+' || src[j + 1] === '-' ? 2 : 1
        while (/[0-9]/.test(src[j] ?? '')) j++
      }
      toks.push({ k: 'num', v: src.slice(i, j), pos }); i = j; continue
    }
    if (c === '"' || c === "'") {
      let j = i + 1, out = ''
      for (;;) {
        const d = src[j]
        if (d === undefined) throw new ExprErro('texto sem fechar aspas', pos, `feche com ${c}`)
        if (d === c) break
        if (d === '\\') {
          const e = ESCAPES[src[j + 1] ?? '']
          if (e === undefined) throw new ExprErro(`escape inválido '\\${src[j + 1] ?? ''}'`, j, "use \\n, \\t, \\\\, \\' ou \\\"")
          out += e; j += 2; continue
        }
        out += d; j++
      }
      toks.push({ k: 'str', v: out, pos }); i = j + 1; continue
    }
    if (/[A-Za-z_$]/.test(c)) {
      let j = i
      while (/[A-Za-z0-9_$]/.test(src[j] ?? '')) j++
      toks.push({ k: 'id', v: src.slice(i, j), pos }); i = j; continue
    }
    const op = OPS.find((o) => src.startsWith(o, i))
    if (!op) throw new ExprErro(`caractere inesperado '${c}'`, pos)
    toks.push({ k: 'op', v: op, pos }); i += op.length
  }
  toks.push({ k: 'fim', v: '', pos: src.length })
  return toks
}

class Parser {
  private i = 0
  private nos = 0
  private prof = 0
  constructor(private readonly toks: Tok[]) {}

  private get tok() { return this.toks[this.i]! }
  private op(v: string) { return this.tok.k === 'op' && this.tok.v === v }
  private come(v: string) { if (this.op(v)) { this.i++; return true } return false }
  private espera(v: string, ctx: string) {
    if (!this.come(v)) throw new ExprErro(`esperado '${v}' ${ctx}, encontrado ${this.descreve()}`, this.tok.pos)
  }
  private descreve() { return this.tok.k === 'fim' ? 'o fim da expressão' : `'${this.tok.v}'` }
  private no<T extends Expr>(n: T): T {
    if (++this.nos > LIMITES_EXPR.nos) throw new ExprErro(`expressão grande demais (mais de ${LIMITES_EXPR.nos} nós)`, n.pos)
    return n
  }
  private desce<T>(f: () => T): T {
    if (++this.prof > LIMITES_EXPR.profundidade) throw new ExprErro(`expressão aninhada demais (mais de ${LIMITES_EXPR.profundidade} níveis)`, this.tok.pos)
    try { return f() } finally { this.prof-- }
  }

  programa(): Expr {
    const e = this.pipe()
    if (this.tok.k !== 'fim') throw new ExprErro(`sobrou ${this.descreve()} depois da expressão`, this.tok.pos, this.op(')') ? "há um ')' sem '(' correspondente" : undefined)
    return e
  }

  // x | f | g(a)  →  g(f(x), a): o formatador recebe o valor como primeiro argumento
  private pipe(): Expr {
    let e = this.cond()
    while (this.op('|')) {
      const pos = this.tok.pos
      this.i++
      if (this.tok.k !== 'id') throw new ExprErro(`depois de '|' vem o nome de um formatador, encontrado ${this.descreve()}`, this.tok.pos)
      const fn = this.tok.v
      this.i++
      const args: Expr[] = [e]
      if (this.come('(')) args.push(...this.args())
      e = this.no({ t: 'call', fn, args, pos })
    }
    return e
  }

  private args(): Expr[] {
    const out: Expr[] = []
    if (!this.come(')')) {
      do out.push(this.cond()); while (this.come(','))
      this.espera(')', 'ao fechar os argumentos')
    }
    return out
  }

  private cond(): Expr {
    return this.desce(() => {
      const c = this.nivel(0)
      if (!this.op('?')) return c
      const pos = this.tok.pos
      this.i++
      const a = this.cond()
      this.espera(':', "no meio de 'cond ? a : b'")
      const b = this.cond()
      return this.no({ t: 'cond', c, a, b, pos })
    })
  }

  private static readonly NIVEIS: Bin[][] = [['??'], ['||'], ['&&'], ['==', '!='], ['<', '<=', '>', '>='], ['+', '-'], ['*', '/', '%']]

  private nivel(n: number): Expr {
    if (n === Parser.NIVEIS.length) return this.unario()
    let e = this.nivel(n + 1)
    for (;;) {
      const op = Parser.NIVEIS[n]!.find((o) => this.op(o))
      if (!op) return e
      const pos = this.tok.pos
      this.i++
      e = this.no({ t: 'bin', op, a: e, b: this.nivel(n + 1), pos })
    }
  }

  private unario(): Expr {
    if (this.op('!') || this.op('-')) {
      const pos = this.tok.pos
      const op = this.tok.v as '!' | '-'
      this.i++
      return this.no({ t: 'un', op, x: this.desce(() => this.unario()), pos })
    }
    return this.posfixo()
  }

  private posfixo(): Expr {
    let e = this.primario()
    for (;;) {
      const pos = this.tok.pos
      if (this.come('.')) {
        if (this.tok.k !== 'id') throw new ExprErro(`depois de '.' vem o nome de um campo, encontrado ${this.descreve()}`, this.tok.pos)
        e = this.no({ t: 'mem', obj: e, nome: this.tok.v, pos })
        this.i++
      } else if (this.come('[')) {
        const idx = this.pipe()
        this.espera(']', "ao fechar o índice")
        e = this.no({ t: 'idx', obj: e, idx, pos })
      } else if (this.op('(')) {
        if (e.t !== 'var') throw new ExprErro('só é possível chamar funções pelo nome, como tamanho(x)', pos, 'use a forma funcao(argumentos) ou x | funcao')
        this.i++
        e = this.no({ t: 'call', fn: e.nome, args: this.args(), pos: e.pos })
      } else return e
    }
  }

  private primario(): Expr {
    const t = this.tok
    if (t.k === 'num') {
      const v = Number(t.v)
      if (!Number.isFinite(v)) throw new ExprErro(`número grande demais (${t.v})`, t.pos)
      this.i++; return this.no({ t: 'lit', v, pos: t.pos })
    }
    if (t.k === 'str') { this.i++; return this.no({ t: 'lit', v: t.v, pos: t.pos }) }
    if (t.k === 'id') {
      this.i++
      if (t.v === 'true' || t.v === 'false') return this.no({ t: 'lit', v: t.v === 'true', pos: t.pos })
      if (t.v === 'null') return this.no({ t: 'lit', v: null, pos: t.pos })
      return this.no({ t: 'var', nome: t.v, pos: t.pos })
    }
    if (this.come('(')) {
      const e = this.pipe() // a profundidade já é contada em cond()
      this.espera(')', "ao fechar os parênteses")
      return e
    }
    if (this.come('[')) {
      const itens: Expr[] = []
      if (!this.come(']')) {
        do itens.push(this.cond()); while (this.come(','))
        this.espera(']', 'ao fechar a lista')
      }
      return this.no({ t: 'lista', itens, pos: t.pos })
    }
    throw new ExprErro(`esperado um valor, encontrado ${this.descreve()}`, t.pos, t.k === 'fim' ? 'a expressão está incompleta' : undefined)
  }
}

/** Faz o parse de uma expressão. Lança ExprErro com a posição (índice de caractere) e dica quando possível. */
export function parseExpr(src: string): Expr {
  if (src.length > LIMITES_EXPR.comprimento) throw new ExprErro(`expressão longa demais (${src.length} > ${LIMITES_EXPR.comprimento} caracteres)`, 0)
  if (!src.trim()) throw new ExprErro('expressão vazia', 0)
  return new Parser(lex(src)).programa()
}

export { sugere }
