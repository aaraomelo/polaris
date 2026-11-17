// AST da linguagem de expressões do Polaris (família do CEL, sem efeitos colaterais, sempre termina).
export type Expr =
  | { t: 'lit'; v: string | number | boolean | null; pos: number }
  | { t: 'var'; nome: string; pos: number }
  | { t: 'mem'; obj: Expr; nome: string; pos: number }
  | { t: 'idx'; obj: Expr; idx: Expr; pos: number }
  | { t: 'call'; fn: string; args: Expr[]; pos: number }
  | { t: 'un'; op: '!' | '-'; x: Expr; pos: number }
  | { t: 'bin'; op: Bin; a: Expr; b: Expr; pos: number }
  | { t: 'cond'; c: Expr; a: Expr; b: Expr; pos: number }
  | { t: 'lista'; itens: Expr[]; pos: number }
  /** função anônima: só vale como argumento de um combinador (mapeia, filtra, dobra…) */
  | { t: 'fn'; params: string[]; corpo: Expr; pos: number }

export type Bin = '+' | '-' | '*' | '/' | '%' | '==' | '!=' | '<' | '<=' | '>' | '>=' | '&&' | '||' | '??'

export class ExprErro extends Error {
  constructor(mensagem: string, readonly pos: number, readonly dica?: string) {
    super(mensagem)
    this.name = 'ExprErro'
  }
}

import type { OrdemSuperior } from './ordem-superior'
/** `os`: combinador (recebe função anônima na posição `os.fnPos`; o avaliador o executa com orçamento de passos) */
export type Funcao = { min: number; max: number; fn: (...args: unknown[]) => unknown; os?: OrdemSuperior }
export type Funcoes = Record<string, Funcao>

/** passos = nós avaliados por avaliação (o orçamento que garante que sempre termina rápido); lista = tamanho máximo de uma lista construída */
export const LIMITES_EXPR = { comprimento: 2000, nos: 500, profundidade: 32, passos: 200_000, lista: 100_000 }
