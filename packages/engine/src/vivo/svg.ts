import type { Descritor } from './blocos'

// SVG declarativo: primitivas (`grafico/*`) que desenham formas a partir de números que a página calcula (expressões, `repetir`). Um gráfico é COMPOSIÇÃO destas primitivas,
// não um bloco com código. A tag do descritor leva o prefixo `svg:` (o cliente cria o elemento no namespace SVG; o HTML do servidor já nasce certo dentro do `<svg>`).
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)
const n2 = (v: unknown, padrao = 0): string => String(Math.round((num(v) ?? padrao) * 100) / 100)
/** uma cor CSS segura: `var()`, `color-mix()`, `oklch()`, `rgb()`, `hsl()`, `#hex` ou palavra-chave; sem `url()`, ponto e vírgula nem chaves */
export const corSegura = (v: unknown): string | undefined =>
  typeof v === 'string' && v.length <= 200 && /^[A-Za-z0-9#%.,\s()\-]+$/.test(v) && !/url|expression|\\/i.test(v) && /^(var|color-mix|oklch|oklab|rgb|rgba|hsl|hsla)\(|^#[0-9a-fA-F]{3,8}$|^(currentColor|none|transparent)$/.test(v) && (v.match(/\(/g)?.length ?? 0) === (v.match(/\)/g)?.length ?? 0) ? v : undefined
const tomDe = (p: Record<string, unknown>): string | undefined => (typeof p.tom === 'string' && /^[a-z][a-z0-9-]{0,23}$/.test(p.tom) ? p.tom : undefined)
/** a cor de um traço/preenchimento: `cor` explícita, ou o token `grafico.<tom>` do tema (cai em `currentColor`) */
const corOuTom = (p: Record<string, unknown>, chave = 'cor'): string | undefined => corSegura(p[chave]) ?? (tomDe(p) ? `var(--grafico-${tomDe(p)}, currentColor)` : undefined)
const ANCORAS: Record<string, string> = { inicio: 'start', centro: 'middle', fim: 'end' }
const CAMINHO = /^[MmLlHhVvCcSsQqTtAaZz0-9eE.,\s-]{1,4000}$/
/** `d` de um caminho: o texto SVG `d`, ou `pontos` (lista de [x, y]) ligados por retas */
export const caminhoDe = (p: Record<string, unknown>): string | undefined => {
  if (typeof p.d === 'string') return CAMINHO.test(p.d) ? p.d : undefined
  if (!Array.isArray(p.pontos)) return undefined
  const pts = p.pontos.slice(0, 2000).filter((q): q is [number, number] => Array.isArray(q) && num(q[0]) !== undefined && num(q[1]) !== undefined)
  return pts.length ? pts.map((q, i) => `${i ? 'L' : 'M'}${n2(q[0])} ${n2(q[1])}`).join('') : undefined
}

export type FormaSvg = { tag: string; attrs: Record<string, string>; estilo: Record<string, string>; texto?: string }
/** o que cada primitiva desenha (fonte única para o descritor do cliente/servidor e para o emissor React) */
export function formaSvg(bloco: string, p: Record<string, unknown>): FormaSvg {
  const attrs: Record<string, string> = {}, estilo: Record<string, string> = {}
  const rot = typeof p.rotulo === 'string' && p.rotulo.trim() ? p.rotulo.trim().slice(0, 200) : ''
  const tom = tomDe(p); if (tom) attrs['data-tom'] = tom
  if (bloco === 'grafico/svg') {
    const w = Math.max(1, num(p.largura) ?? 100), h = Math.max(1, num(p.altura) ?? 100)
    attrs.viewBox = `0 0 ${n2(w)} ${n2(h)}`; attrs.preserveAspectRatio = 'xMidYMid meet'
    if (rot) { attrs.role = 'img'; attrs['aria-label'] = rot } else attrs['aria-hidden'] = 'true'
    return { tag: 'svg:svg', attrs, estilo }
  }
  // interativa: com `rotulo` a forma vira um botão para teclado e leitor de tela (a página liga `aoClicar`)
  const interativa = () => { if (rot) { attrs.role = 'button'; attrs.tabindex = '0'; attrs['aria-label'] = rot; if (p.selecionado === true) attrs['aria-pressed'] = 'true' } if (p.selecionado === true) attrs['data-selecionado'] = '' }
  if (bloco === 'grafico/circulo') {
    attrs.cx = n2(p.cx); attrs.cy = n2(p.cy); attrs.r = n2(p.r, 4); const c = corOuTom(p); if (c) estilo.fill = c; interativa()
    return { tag: 'svg:circle', attrs, estilo }
  }
  if (bloco === 'grafico/retangulo') {
    attrs.x = n2(p.x); attrs.y = n2(p.y); attrs.width = n2(Math.max(0, num(p.largura) ?? 0)); attrs.height = n2(Math.max(0, num(p.altura) ?? 0)); if (num(p.raio)) attrs.rx = n2(p.raio)
    const c = corOuTom(p); if (c) estilo.fill = c; interativa()
    return { tag: 'svg:rect', attrs, estilo }
  }
  if (bloco === 'grafico/reta') {
    attrs.x1 = n2(p.x1); attrs.y1 = n2(p.y1); attrs.x2 = n2(p.x2); attrs.y2 = n2(p.y2)
    const c = corOuTom(p); if (c) estilo.stroke = c; estilo.strokeWidth = n2(p.espessura, 1); if (p.tracejada === true) estilo.strokeDasharray = '3 3'
    return { tag: 'svg:line', attrs, estilo }
  }
  if (bloco === 'grafico/caminho') {
    const d = caminhoDe(p); attrs.d = d ?? ''
    const c = corOuTom(p), f = corSegura(p.preenche); if (c) estilo.stroke = c; estilo.strokeWidth = n2(p.espessura, 1); estilo.fill = f ?? 'none'; estilo.strokeLinejoin = 'round'; estilo.strokeLinecap = 'round'
    return { tag: 'svg:path', attrs, estilo }
  }
  // grafico/rotulo
  attrs.x = n2(p.x); attrs.y = n2(p.y); estilo.textAnchor = ANCORAS[String(p.ancora)] ?? 'start'; estilo.dominantBaseline = p.base === 'central' ? 'central' : 'auto'
  const c = corOuTom(p); if (c) estilo.fill = c; if (num(p.tamanho)) estilo.fontSize = `${n2(p.tamanho)}px`
  return { tag: 'svg:text', attrs, estilo, texto: typeof p.texto === 'string' ? p.texto.slice(0, 200) : typeof p.texto === 'number' ? String(p.texto) : '' }
}
const kebab = (k: string) => k.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)
const cssTexto = (e: Record<string, string>) => Object.entries(e).map(([k, v]) => `${kebab(k)}:${v}`).join(';')

export const descritorSvg = (bloco: string, filhos = false): Descritor => ({
  chave: (p) => formaSvg(bloco, p).tag,
  tag: (p) => formaSvg(bloco, p).tag,
  attrs: (p, id) => { const f = formaSvg(bloco, p); return { ...(id ? { id } : {}), ...f.attrs, ...(Object.keys(f.estilo).length ? { style: cssTexto(f.estilo) } : {}) } },
  ...(bloco === 'grafico/rotulo' ? { texto: (p: Record<string, unknown>) => formaSvg(bloco, p).texto } : {}),
  ...(filhos ? { filhos: true } : {}),
  ...(bloco === 'grafico/circulo' || bloco === 'grafico/retangulo' ? { eventos: { aoClicar: { dom: 'click' } } } : {}),
})
export const d_grafico_svg: Descritor = /* @__PURE__ */ descritorSvg('grafico/svg', true)
export const d_grafico_circulo: Descritor = /* @__PURE__ */ descritorSvg('grafico/circulo')
export const d_grafico_retangulo: Descritor = /* @__PURE__ */ descritorSvg('grafico/retangulo')
export const d_grafico_reta: Descritor = /* @__PURE__ */ descritorSvg('grafico/reta')
export const d_grafico_caminho: Descritor = /* @__PURE__ */ descritorSvg('grafico/caminho')
export const d_grafico_rotulo: Descritor = /* @__PURE__ */ descritorSvg('grafico/rotulo')
