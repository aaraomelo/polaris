import fontkit from '@pdf-lib/fontkit'
import { PDFDocument, rgb } from 'pdf-lib'
import { bytesDe } from './fontes'
import type { Layout, Rgb } from './modelo'

const cor = (c: Rgb) => rgb(c[0] / 255, c[1] / 255, c[2] / 255)
function imagemBytes(src: string): { bytes: Uint8Array; jpg: boolean } {
  const m = /^data:image\/(png|jpeg);base64,(.*)$/.exec(src); if (!m) throw new Error('imagem inválida')
  return { bytes: Uint8Array.from(Buffer.from(m[2]!, 'base64')), jpg: m[1] === 'jpeg' }
}

/** PDF a partir do layout. `agora` fixa as datas dos metadados: com a mesma entrada, o mesmo PDF byte a byte (útil para teste e para hash/assinatura). */
export async function pdfDe(l: Layout, agora: Date = new Date()): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  doc.registerFontkit(fontkit)
  doc.setTitle(l.titulo); doc.setProducer('Polaris'); doc.setCreator('Polaris'); doc.setCreationDate(agora); doc.setModificationDate(agora)
  // sem `subset`: o fontkit tem bug de subsetting com algumas TTF
  const fontes = { normal: await doc.embedFont(bytesDe(l.fonte, 'normal')), negrito: await doc.embedFont(bytesDe(l.fonte, 'negrito')) }
  const imagens = new Map<string, Awaited<ReturnType<PDFDocument['embedPng']>>>()
  for (const pg of l.paginas) {
    const p = doc.addPage([pg.largura, pg.altura])
    for (const op of pg.ops) {
      if (op.tipo === 'ret') p.drawRectangle({ x: op.x, y: pg.altura - (op.y + op.a), width: op.l, height: op.a, color: cor(op.cor) })
      else if (op.tipo === 'linha') p.drawLine({ start: { x: op.x1, y: pg.altura - op.y1 }, end: { x: op.x2, y: pg.altura - op.y2 }, thickness: op.espessura, color: cor(op.cor) })
      else if (op.tipo === 'texto') p.drawText(op.texto, { x: op.x, y: pg.altura - (op.yTopo + op.tamanho * op.ascender), size: op.tamanho, font: fontes[op.peso], color: cor(op.cor) })
      else {
        let im = imagens.get(op.src)
        if (!im) { const { bytes, jpg } = imagemBytes(op.src); im = jpg ? await doc.embedJpg(bytes) : await doc.embedPng(bytes); imagens.set(op.src, im) }
        p.drawImage(im, { x: op.x, y: pg.altura - (op.y + op.a), width: op.l, height: op.a })
      }
    }
  }
  return doc.save()
}
