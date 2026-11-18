export * from './mascara'
export * from './formato'
export * from './validador'
import './funcao-expr' // registra o validador na função `validaFormulario` da linguagem
export { renderizaFormularioHtml, escapa } from './html'
export { CSS_FORMULARIO, mascaraDoCampo, posicaoDoCursor } from './ilha'
