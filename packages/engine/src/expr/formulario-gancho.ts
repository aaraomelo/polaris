import type { Funcao } from './tipos'

// `validaFormulario(definicao, valores, idioma?)` é uma função da linguagem, mas o validador do formulário é grande: a biblioteca de expressões (que vai inteira para o navegador de quem a usa)
// fica leve e só ENCONTRA o validador por este gancho, que o motor do formulário (`formulario/index`) preenche ao ser carregado. Sem ele carregado, a função devolve ausente.
export type ValidadorDeFormulario = (definicao: unknown, valores: unknown, idioma?: unknown) => unknown
let validador: ValidadorDeFormulario | undefined
export const defineValidadorDeFormulario = (f: ValidadorDeFormulario): void => { validador = f }
export const f_validaFormulario: Funcao = { min: 2, max: 3, fn: (definicao, valores, idioma) => validador?.(definicao, valores, idioma) }
