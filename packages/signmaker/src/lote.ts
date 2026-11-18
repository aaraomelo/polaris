import { DocumentoErro } from '@polaris/documentos'
import { layoutCartaz } from './layout'
import type { Layout } from './modelo'

export type ItemLote = {
  no: { kind: string; spec: Record<string, any> }
  dados: unknown
  /** cópias da peça (uma página cada); padrão 1 */
  quantidade?: number
  /** sobrescreve o tamanho do nó (precisa estar em `tamanhos`, se o nó declara) */
  tamanho?: string
  /** imprime sem a imagem de fundo (a cor de fundo fica) */
  semFundo?: boolean
}
export const LIMITES_LOTE = { itens: 200, quantidade: 200, paginas: 500 }

/** Várias peças (cada uma com seus dados, tamanho e quantidade) num só documento: uma página por cópia, na ordem dos itens. Fail-closed: um item ruim recusa o lote inteiro, dizendo qual. */
export function layoutLote(itens: ItemLote[]): Layout {
  if (!Array.isArray(itens) || !itens.length) throw new DocumentoErro('lote sem itens')
  if (itens.length > LIMITES_LOTE.itens) throw new DocumentoErro(`lote com ${itens.length} itens (limite ${LIMITES_LOTE.itens})`)
  const paginas: Layout['paginas'] = [], avisos: string[] = []
  let total = 0
  itens.forEach((it, i) => {
    const onde = `item ${i + 1}`, q = it.quantidade ?? 1
    if (!Number.isInteger(q) || q < 1 || q > LIMITES_LOTE.quantidade) throw new DocumentoErro(`${onde}: quantidade deve ser um inteiro de 1 a ${LIMITES_LOTE.quantidade}`)
    total += q; if (total > LIMITES_LOTE.paginas) throw new DocumentoErro(`o lote passa de ${LIMITES_LOTE.paginas} páginas`)
    if (it.no?.kind !== 'cartaz') throw new DocumentoErro(`${onde}: esperava um nó kind=cartaz`)
    let spec = it.no.spec; if (it.semFundo && spec.fundo?.imagem) { const { imagem: _i, ...fundo } = spec.fundo; spec = { ...spec, fundo } }
    let l: Layout; try { l = layoutCartaz(spec, it.dados, it.tamanho ? { tamanho: it.tamanho } : {}) } catch (e) { throw new DocumentoErro(`${onde}: ${(e as Error).message}`) }
    for (const a of l.avisos) avisos.push(`${onde}: ${a}`)
    for (let k = 0; k < q; k++) paginas.push(structuredClone(l.paginas[0]!)) // cópias independentes: ninguém compartilha operações
  })
  return { paginas, largura: paginas[0]!.largura, altura: paginas[0]!.altura, titulo: `Lote de ${total} página${total === 1 ? '' : 's'}`, avisos }
}
