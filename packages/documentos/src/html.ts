import { bytesDe } from './fontes'
import type { Layout, Rgb } from './modelo'

// HTML a partir do MESMO layout do PDF: cada operação vira um elemento posicionado em pt. É "papel na tela": serve de pré-visualização e de impressão (@page com o tamanho exato).
// Segurança: todo texto é escapado; `src` de imagem só passa se for data URL png/jpeg (revalidado aqui); CSP sem script e sem rede.
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
const rgbCss = (c: Rgb) => `rgb(${c[0]},${c[1]},${c[2]})`
const n = (v: number) => Number(v.toFixed(3)).toString()

export type OpcoesHtml = { /** URLs das TTF, em vez de embutir em base64 (HTML menor; as fontes precisam estar servidas) */ fontesUrl?: { normal: string; negrito: string } }

export function htmlDe(l: Layout, opcoes: OpcoesHtml = {}): string {
  const fam = `Polaris-${l.fonte.replace(/[^A-Za-z0-9]/g, '')}`
  const src = (peso: 'normal' | 'negrito') => opcoes.fontesUrl ? `url("${esc(opcoes.fontesUrl[peso])}")` : `url(data:font/ttf;base64,${bytesDe(l.fonte, peso).toString('base64')})`
  const css = `@page{size:${n(l.largura)}pt ${n(l.altura)}pt;margin:0}
@font-face{font-family:"${fam}";font-weight:400;src:${src('normal')} format("truetype")}
@font-face{font-family:"${fam}";font-weight:700;src:${src('negrito')} format("truetype")}
html,body{margin:0;padding:0;background:#e8e8e8}
.pagina{position:relative;overflow:hidden;background:#fff;margin:12px auto;box-shadow:0 1px 4px rgba(0,0,0,.25);font-family:"${fam}",sans-serif;font-kerning:none;font-variant-ligatures:none;text-rendering:optimizeSpeed;-webkit-print-color-adjust:exact;print-color-adjust:exact}
.pagina>*{position:absolute;box-sizing:border-box}
.t{white-space:pre;margin:0;padding:0}
@media print{html,body{background:#fff}.pagina{margin:0;box-shadow:none;break-after:page}.pagina:last-child{break-after:auto}}`
  const paginas = l.paginas.map((p, i) => {
    const els = p.ops.map((o) => {
      if (o.tipo === 'ret') return `<div style="left:${n(o.x)}pt;top:${n(o.y)}pt;width:${n(o.l)}pt;height:${n(o.a)}pt;background:${rgbCss(o.cor)}"></div>`
      if (o.tipo === 'linha') {
        // só linhas horizontais/verticais existem no layout; viram um retângulo da espessura da linha, centrado no traço (igual ao traço do PDF)
        const x = Math.min(o.x1, o.x2), y = Math.min(o.y1, o.y2), w = Math.abs(o.x2 - o.x1), h = Math.abs(o.y2 - o.y1)
        return h === 0 ? `<div style="left:${n(x)}pt;top:${n(y - o.espessura / 2)}pt;width:${n(w)}pt;height:${n(o.espessura)}pt;background:${rgbCss(o.cor)}"></div>` : `<div style="left:${n(x - o.espessura / 2)}pt;top:${n(y)}pt;width:${n(o.espessura)}pt;height:${n(h)}pt;background:${rgbCss(o.cor)}"></div>`
      }
      if (o.tipo === 'imagem') {
        if (!/^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(o.src)) throw new Error('imagem inválida')
        return `<img src="${o.src}" alt="${esc(o.alt)}" style="left:${n(o.x)}pt;top:${n(o.y)}pt;width:${n(o.l)}pt;height:${n(o.a)}pt">`
      }
      return `<span class="t" style="left:${n(o.x)}pt;top:${n(o.yTopo)}pt;font-size:${n(o.tamanho)}pt;line-height:${n(o.alturaLinha)}pt;font-weight:${o.peso === 'negrito' ? 700 : 400};color:${rgbCss(o.cor)}">${esc(o.texto)}</span>`
    }).join('\n')
    return `<section class="pagina" data-pagina="${i + 1}" style="width:${n(p.largura)}pt;height:${n(p.altura)}pt">\n${els}\n</section>`
  }).join('\n')
  return `<!doctype html>
<html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:${opcoes.fontesUrl ? ' https: http:' : ''}">
<title>${esc(l.titulo)}</title><style>${css}</style></head><body>
${paginas}
</body></html>`
}
