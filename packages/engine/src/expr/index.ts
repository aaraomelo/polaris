export * from './tipos'
export { parseExpr } from './parser'
export { avalia, verdadeiro, type Escopo } from './avalia'
export { FUNCOES_PADRAO } from './biblioteca'
import { FUNCOES_PADRAO as BIBLIOTECA } from './biblioteca'
import { definePadrao } from './padrao'
export { funcoesPadrao } from './padrao'

// quem importa a entrada da linguagem (servidor, testes, @polaris/engine) tem a biblioteca completa como padrão;
// o bundle de cliente por página importa as funções uma a uma e NÃO passa por aqui
definePadrao(BIBLIOTECA)
export { analisa, validaExpr, type ProblemaExpr } from './analise'
export { deAst, deAstValidado, formata, OPERADORES, paraAst, semPos, validaAst, type Ast, type ErroAst } from './ast'
