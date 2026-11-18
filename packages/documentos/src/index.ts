import { htmlDe, type OpcoesHtml } from './html'
import { layout } from './layout'
import { pdfDe } from './pdf'
import { resolve, validaDocumento } from './resolve'

export { DocumentoErro, analisa, interpola, leCaminho, limpa, raizesDe, verdadeiro } from './interpola'
export { FILTROS, brl, data, datahora, num, cpfcnpj } from './formatos'
export { FONTES, FONTE_PADRAO } from './fontes'
export { resolve, validaDocumento, confereDados } from './resolve'
export { layout } from './layout'
export { pdfDe } from './pdf'
export { htmlDe, type OpcoesHtml } from './html'
export type { DocumentoResolvido, Layout, Op, Pagina, Bloco } from './modelo'

type No = { kind: string; spec: Record<string, any> }
const spec = (no: No) => { if (no.kind !== 'documento') throw new Error(`esperava um nó kind=documento, veio ${String(no.kind)}`); return no.spec }

/** UM nó + UM conjunto de dados → o layout e as DUAS saídas (HTML e PDF), a partir do mesmo layout. */
export async function geraDocumento(no: No, dados: unknown, o: { agora?: Date; html?: OpcoesHtml } = {}) {
  const l = layout(resolve(spec(no), dados))
  return { layout: l, html: htmlDe(l, o.html), pdf: await pdfDe(l, o.agora) }
}
export const validaNoDocumento = (no: No): string[] => validaDocumento(spec(no))
