import { bytesDe } from './fontes'
import type { Layout, Peso, Rgb } from './modelo'

// HTML a partir do MESMO layout do PDF: cada operação vira um elemento posicionado em pt ("papel na tela", e imprimível com @page do tamanho exato).
// Segurança: todo texto é escapado; imagem só passa como data URL png/jpeg; CSP sem script e sem rede.
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
const rgbCss = (c: Rgb, a = 1) => (a === 1 ? `rgb(${c[0]},${c[1]},${c[2]})` : `rgba(${c[0]},${c[1]},${c[2]},${a})`)
const n = (v: number) => Number(v.toFixed(3)).toString()
const fam = (familia: string) => `Sign-${familia.replace(/[^A-Za-z0-9]/g, '')}`

export type OpcoesHtml = { /** só o `<section>` da peça (sem documento, estilos nem fontes): para embutir em outra página que já carrega o CSS e as fontes */ fragmento?: boolean }

export function cssDoCartaz(l: Layout): string {
  const usadas = new Map<string, Set<Peso>>()
  for (const p of l.paginas) for (const o of p.ops) if (o.tipo === 'texto') { if (!usadas.has(o.familia)) usadas.set(o.familia, new Set()); usadas.get(o.familia)!.add(o.peso) }
  const faces = [...usadas].flatMap(([f, pesos]) => [...pesos].map((p) => `@font-face{font-family:"${fam(f)}";font-weight:${p === 'negrito' ? 700 : 400};src:url(data:font/ttf;base64,${bytesDe(f, p).toString('base64')}) format("truetype")}`)).join('\n')
  // tamanhos de página diferentes no mesmo documento: uma `@page` nomeada por tamanho (sem isso, a impressão usaria só o da primeira)
  const tams = [...new Set(l.paginas.map((p) => `${n(p.largura)}pt ${n(p.altura)}pt`))]
  const paginas = tams.length === 1 ? `@page{size:${tams[0]};margin:0}` : `@page{margin:0}\n${tams.map((t, i) => `@page t${i}{size:${t};margin:0}\n.pagina[data-tam="${i}"]{page:t${i}}`).join('\n')}`
  return `${paginas}
${faces}
html,body{margin:0;padding:0;background:#e8e8e8}
.pagina{position:relative;overflow:hidden;background:#fff;margin:12px auto;box-shadow:0 1px 4px rgba(0,0,0,.25);font-kerning:none;font-variant-ligatures:none;text-rendering:geometricPrecision;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.pagina>*{position:absolute;box-sizing:border-box}
.t{white-space:pre}
.v{left:0;top:0;overflow:visible}
@media print{html,body{background:#fff}.pagina{margin:0;box-shadow:none;break-after:page}.pagina:last-child{break-after:auto}}`
}

export function htmlDe(l: Layout, opcoes: OpcoesHtml = {}): string {
  const tamIdx = (p: { largura: number; altura: number }) => [...new Set(l.paginas.map((q) => `${n(q.largura)}x${n(q.altura)}`))].indexOf(`${n(p.largura)}x${n(p.altura)}`)
  const paginas = l.paginas.map((p, i) => {
    const els = p.ops.map((o) => {
      if (o.tipo === 'ret') return `<div style="left:${n(o.x)}pt;top:${n(o.y)}pt;width:${n(o.l)}pt;height:${n(o.a)}pt;background:${rgbCss(o.cor, o.opacidade)}"></div>`
      if (o.tipo === 'caminho') return `<svg class="v" width="${n(p.largura)}pt" height="${n(p.altura)}pt" viewBox="0 0 ${n(p.largura)} ${n(p.altura)}"><path d="${esc(o.d)}" fill="${rgbCss(o.cor)}"${o.opacidade === 1 ? '' : ` fill-opacity="${o.opacidade}"`}/></svg>`
      if (o.tipo === 'imagem') {
        if (!/^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(o.src)) throw new Error('imagem inválida')
        return `<img src="${o.src}" alt="${esc(o.alt)}" style="left:${n(o.x)}pt;top:${n(o.y)}pt;width:${n(o.l)}pt;height:${n(o.a)}pt">`
      }
      // texto em SVG: a LINHA DE BASE é posicionada exatamente (y), sem a caixa de linha do HTML, cujo ascendente/descendente o Chrome arredonda para pixel inteiro (±0,5 px de erro)
      const a = (o.graus * Math.PI) / 180, bx = o.x + o.tamanho * o.ascender * Math.sin(a), by = o.yTopo + o.tamanho * o.ascender * Math.cos(a)
      return `<svg class="v" width="${n(p.largura)}pt" height="${n(p.altura)}pt" viewBox="0 0 ${n(p.largura)} ${n(p.altura)}"><text class="t" x="${n(bx)}" y="${n(by)}" font-family="'${fam(o.familia)}'" font-size="${n(o.tamanho)}" font-weight="${o.peso === 'negrito' ? 700 : 400}" fill="${rgbCss(o.cor)}"${o.graus ? ` transform="rotate(${n(-o.graus)} ${n(bx)} ${n(by)})"` : ''} xml:space="preserve">${esc(o.texto)}</text></svg>`
    }).join('\n')
    return `<section class="pagina" data-pagina="${i + 1}" data-tam="${tamIdx(p)}" style="width:${n(p.largura)}pt;height:${n(p.altura)}pt">\n${els}\n</section>`
  }).join('\n')
  if (opcoes.fragmento) return paginas
  return `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:">
<title>${esc(l.titulo)}</title><style>${cssDoCartaz(l)}</style></head><body>
${paginas}
</body></html>`
}
