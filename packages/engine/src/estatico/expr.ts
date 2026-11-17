import type { Escopo } from '../expr/avalia'
import { compilaExpr as compila } from '../expr/compila'
import type { Expr, Funcoes } from '../expr/tipos'

// Expressão → closure (a mesma do runtime vivo: src/expr/compila.ts). Mantido aqui por compatibilidade do gerador estático.
export type Fn = (esc: Escopo) => unknown
export const compilaExpr = (e: Expr, funcoes: Funcoes): Fn => compila(e, funcoes)
