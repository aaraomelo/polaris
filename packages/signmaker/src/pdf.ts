import fontkit from '@pdf-lib/fontkit'
import { PDFDocument, degrees, rgb, type PDFFont } from 'pdf-lib'
import { bytesDe } from './fontes'
import type { Layout, Rgb } from './modelo'

const cor = (c: Rgb) => rgb(c[0] / 255, c[1] / 255, c[2] / 255)
function imagemBytes(src: string): { bytes: Uint8Array; jpg: boolean } {
  const m = /^data:image\/(png|jpeg);base64,(.*)$/.exec(src); if (!m) throw new Error('imagem inválida')
  return { bytes: Uint8Array.from(Buffer.from(m[2]!, 'base64')), jpg: m[1] === 'jpeg' }
}

/** PDF a partir do layout. `agora` fixa as datas dos metadados: com a mesma entrada, o mesmo PDF byte a byte. */
export async function pdfDe(l: Layout, agora: Date = new Date()): Promise<Uint8Array> {
  const doc = await PDFDocument.create()
  doc.registerFontkit(fontkit)
  doc.setTitle(l.titulo); doc.setProducer('Polaris Sign Maker'); doc.setCreator('Polaris'); doc.setCreationDate(agora); doc.setModificationDate(agora)
  const fontes = new Map<string, PDFFont>(), imagens = new Map<string, Awaited<ReturnType<PDFDocument['embedPng']>>>()
  for (const pg of l.paginas) {
    const p = doc.addPage([pg.largura, pg.altura])
    for (const op of pg.ops) {
      if (op.tipo === 'ret') p.drawRectangle({ x: op.x, y: pg.altura - (op.y + op.a), width: op.l, height: op.a, color: cor(op.cor), opacity: op.opacidade })
      else if (op.tipo === 'caminho') p.drawSvgPath(op.d, { x: 0, y: pg.altura, color: cor(op.cor), opacity: op.opacidade, borderWidth: 0 })
      else if (op.tipo === 'texto') {
        const k = `${op.familia}:${op.peso}`; let font = fontes.get(k)
        if (!font) { font = await doc.embedFont(bytesDe(op.familia, op.peso)); fontes.set(k, font) } // sem `subset`: o fontkit tem bug de subsetting com algumas TTF
        // o pdf-lib gira em torno da linha de base: (x, yTopo) é o canto da caixa da linha; a base fica `ascender × tamanho` abaixo dele, no eixo girado
        const a = (op.graus * Math.PI) / 180, desce = op.tamanho * op.ascender
        p.drawText(op.texto, { x: op.x + desce * Math.sin(a), y: pg.altura - (op.yTopo + desce * Math.cos(a)), size: op.tamanho, font, color: cor(op.cor), ...(op.graus ? { rotate: degrees(op.graus) } : {}) })
      } else {
        let im = imagens.get(op.src)
        if (!im) { const { bytes, jpg } = imagemBytes(op.src); im = jpg ? await doc.embedJpg(bytes) : await doc.embedPng(bytes); imagens.set(op.src, im) }
        p.drawImage(im, { x: op.x, y: pg.altura - (op.y + op.a), width: op.l, height: op.a })
      }
    }
  }
  return doc.save()
}
