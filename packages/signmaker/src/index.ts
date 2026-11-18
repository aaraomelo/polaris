import { htmlDe, type OpcoesHtml } from './html'
import { layoutCartaz, validaCartaz } from './layout'
import { layoutLote, type ItemLote } from './lote'
import { pdfDe } from './pdf'

export { layoutCartaz, validaCartaz, gira, caminhoRet } from './layout'
export { htmlDe, cssDoCartaz, type OpcoesHtml } from './html'
export { pdfDe } from './pdf'
export { FONTES, FONTE_PADRAO, bytesDe, fonteDe } from './fontes'
export { layoutLote, LIMITES_LOTE, type ItemLote } from './lote'
export { analisaCondicao, avalia } from './condicao'
export { FUNCOES, calcula } from './decimal'
export { ajusta, largura, quebraLinhas } from './texto'
export type { Layout, Op, Pagina } from './modelo'

type No = { kind: string; spec: Record<string, any> }
const spec = (no: No) => { if (no.kind !== 'cartaz') throw new Error(`esperava um nó kind=cartaz, veio ${String(no.kind)}`); return no.spec }

/** UM nó + UM conjunto de dados → o layout e as DUAS saídas (HTML e PDF), a partir do mesmo layout. */
export async function geraCartaz(no: No, dados: unknown, o: { agora?: Date; html?: OpcoesHtml; tamanho?: string } = {}) {
  const l = layoutCartaz(spec(no), dados, o.tamanho ? { tamanho: o.tamanho } : {})
  return { layout: l, html: htmlDe(l, o.html), pdf: await pdfDe(l, o.agora) }
}
export const validaNoCartaz = (no: No): string[] => validaCartaz(spec(no))
export { converteConfiguracao, converteGeometria, type Convertido, type Relatorio } from './legado'

/** várias peças num só HTML e PDF (uma página por cópia) */
export async function geraLote(itens: ItemLote[], o: { agora?: Date; html?: OpcoesHtml } = {}) {
  const l = layoutLote(itens)
  return { layout: l, html: htmlDe(l, o.html), pdf: await pdfDe(l, o.agora) }
}
