import { htmlDe, type OpcoesHtml } from './html'
import { layoutCartaz, validaCartaz } from './layout'
import { pdfDe } from './pdf'

export { layoutCartaz, validaCartaz, gira, caminhoRet } from './layout'
export { htmlDe, cssDoCartaz, type OpcoesHtml } from './html'
export { pdfDe } from './pdf'
export { FONTES, FONTE_PADRAO, bytesDe, fonteDe } from './fontes'
export { ajusta, largura, quebraLinhas } from './texto'
export type { Layout, Op, Pagina } from './modelo'

type No = { kind: string; spec: Record<string, any> }
const spec = (no: No) => { if (no.kind !== 'cartaz') throw new Error(`esperava um nó kind=cartaz, veio ${String(no.kind)}`); return no.spec }

/** UM nó + UM conjunto de dados → o layout e as DUAS saídas (HTML e PDF), a partir do mesmo layout. */
export async function geraCartaz(no: No, dados: unknown, o: { agora?: Date; html?: OpcoesHtml } = {}) {
  const l = layoutCartaz(spec(no), dados)
  return { layout: l, html: htmlDe(l, o.html), pdf: await pdfDe(l, o.agora) }
}
export const validaNoCartaz = (no: No): string[] => validaCartaz(spec(no))
