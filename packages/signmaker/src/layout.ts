import { DocumentoErro, confereDados, interpola, raizesDe, verdadeiro } from '@polaris/documentos'
import { FONTES, FONTE_PADRAO, fonteDe } from './fontes'
import { MM, TAMANHOS_MM, type Layout, type Op, type Peso, type Rgb } from './modelo'
import { ajusta, largura } from './texto'

type Obj = Record<string, any>
const CAMINHO_SE = /^!?[a-z][A-Za-z0-9]*(\.[A-Za-z0-9_]+)*$/

/** problemas do cartaz que o schema não vê (ids únicos, lado da caixa, fonte conhecida, dados declarados); lista vazia = coerente */
export function validaCartaz(spec: Obj): string[] {
  const erros: string[] = [], ids = new Set<string>(), dados = new Set(Object.keys(spec.dados ?? {}))
  const familia = spec.fonte?.familia; if (familia !== undefined && !Object.hasOwn(FONTES, familia)) erros.push(`fonte desconhecida: ${familia}`)
  for (const [i, e] of (spec.elementos ?? []).entries() as Iterable<[number, Obj]>) {
    const onde = `elementos/${i}`
    if (e.id !== undefined) { if (ids.has(e.id)) erros.push(`${onde}: id repetido: ${e.id}`); ids.add(e.id) }
    const c = e.caixa ?? {}; if ((c.esquerda === undefined) === (c.direita === undefined)) erros.push(`${onde}: a caixa precisa de 'esquerda' OU 'direita' (exatamente um)`)
    if (e.fonte?.familia !== undefined && !Object.hasOwn(FONTES, e.fonte.familia)) erros.push(`${onde}: fonte desconhecida: ${e.fonte.familia}`)
    if (e.tamanho && e.tamanho.min !== undefined && e.tamanho.max !== undefined && e.tamanho.min > e.tamanho.max) erros.push(`${onde}: tamanho.min maior que tamanho.max`)
    if (e.se !== undefined) { if (!CAMINHO_SE.test(e.se)) erros.push(`${onde}: condição inválida: ${String(e.se).slice(0, 40)}`); else if (!dados.has(e.se.replace(/^!/, '').split('.')[0]!)) erros.push(`${onde}: a condição usa um dado não declarado em spec.dados`) }
    if (e.tipo === 'texto') { try { for (const r of raizesDe(e.texto)) if (!dados.has(r)) erros.push(`${onde}: o texto usa o dado "${r}", não declarado em spec.dados`) } catch (x) { erros.push(`${onde}: ${(x as Error).message}`) } }
  }
  return erros.slice(0, 20)
}

const n = (v: number) => Number(v.toFixed(3))
/** gira (x, y) em torno de (ox, oy), `graus` ANTI-HORÁRIO na tela (y para baixo) */
export function gira(x: number, y: number, ox: number, oy: number, graus: number): [number, number] {
  const a = (graus * Math.PI) / 180, c = Math.cos(a), s = Math.sin(a), dx = x - ox, dy = y - oy
  return [ox + dx * c + dy * s, oy - dx * s + dy * c]
}

/** caminho SVG (pt) de um retângulo, com cantos arredondados e girado em torno de (ox, oy) */
export function caminhoRet(x: number, y: number, l: number, a: number, raio: number, graus: number, ox: number, oy: number): string {
  const r = Math.min(raio, l / 2, a / 2), K = 0.5522847498 * r
  const P = (px: number, py: number) => { const [gx, gy] = gira(px, py, ox, oy, graus); return `${n(gx)} ${n(gy)}` }
  if (r <= 0) return `M${P(x, y)}L${P(x + l, y)}L${P(x + l, y + a)}L${P(x, y + a)}Z`
  return `M${P(x + r, y)}L${P(x + l - r, y)}C${P(x + l - r + K, y)} ${P(x + l, y + r - K)} ${P(x + l, y + r)}L${P(x + l, y + a - r)}C${P(x + l, y + a - r + K)} ${P(x + l - r + K, y + a)} ${P(x + l - r, y + a)}L${P(x + r, y + a)}C${P(x + r - K, y + a)} ${P(x, y + a - r + K)} ${P(x, y + a - r)}L${P(x, y + r)}C${P(x, y + r - K)} ${P(x + r - K, y)} ${P(x + r, y)}Z`
}

export function layoutCartaz(spec: Obj, dadosEntrada: unknown = {}): Layout {
  const erros = validaCartaz(spec); if (erros.length) throw new DocumentoErro(`cartaz inválido: ${erros.slice(0, 3).join('; ')}`)
  confereDados(spec, dadosEntrada)
  const dados = dadosEntrada as Obj, avisos: string[] = []
  const [wm, hm] = TAMANHOS_MM[spec.tamanho as 'A4'], paisagem = spec.orientacao === 'paisagem'
  const W = n((paisagem ? hm : wm) * MM), H = n((paisagem ? wm : hm) * MM)
  const ops: Op[] = []
  if (spec.fundo?.cor) ops.push({ tipo: 'ret', x: 0, y: 0, l: W, a: H, cor: spec.fundo.cor as Rgb, opacidade: 1 })
  if (spec.fundo?.imagem) ops.push({ tipo: 'imagem', x: 0, y: 0, l: W, a: H, src: spec.fundo.imagem, alt: '' })
  for (const e of spec.elementos as Obj[]) {
    if (e.se !== undefined && !verdadeiro(e.se, dados)) continue
    const c = e.caixa as Obj, w = n(c.largura * W), h = n(c.altura * H), x = n(c.esquerda !== undefined ? c.esquerda * W : W - c.direita * W - w), y = n(c.topo * H)
    const graus = e.rotacao ?? 0, ox = x, oy = n(y + h / 2) // pivô: meio da borda esquerda da caixa
    if (e.tipo === 'faixa') {
      const cor = (e.cor ?? [0, 0, 0]) as Rgb, opacidade = e.opacidade ?? 1, raio = (e.raio ?? 0) * Math.min(w, h)
      ops.push(raio > 0 || graus !== 0 ? { tipo: 'caminho', d: caminhoRet(x, y, w, h, raio, graus, ox, oy), cor, opacidade } : { tipo: 'ret', x, y, l: w, a: h, cor, opacidade })
      continue
    }
    // texto
    const familia = e.fonte?.familia ?? spec.fonte?.familia ?? FONTE_PADRAO, peso = (e.fonte?.peso ?? spec.fonte?.peso ?? 'normal') as Peso
    const texto = interpola(e.texto, dados); if (!texto.trim()) continue
    if (e.fundo) { const [r, g, b, a] = e.fundo as number[]; ops.push(graus !== 0 ? { tipo: 'caminho', d: caminhoRet(x, y, w, h, 0, graus, ox, oy), cor: [r!, g!, b!], opacidade: a! } : { tipo: 'ret', x, y, l: w, a: h, cor: [r!, g!, b!], opacidade: a! }) }
    const f = fonteDe(familia, peso), aj = ajusta(f, texto, w, h, e.quebra ?? 'normal', e.tamanho?.min ?? 6, e.tamanho?.max ?? 300)
    if (!aj.cabe) avisos.push(`${e.id ?? e.tipo}: o texto não cabe nem no tamanho mínimo (${aj.tamanho} pt)`)
    const total = aj.linhas.length * aj.alturaLinha, topo = (e.alinhaV ?? 'topo') === 'meio' ? (h - total) / 2 : e.alinhaV === 'base' ? h - total : 0
    aj.linhas.forEach((linha, i) => {
      const lw = largura(f, linha, aj.tamanho), dx = (e.alinhaH ?? 'centro') === 'centro' ? (w - lw) / 2 : e.alinhaH === 'direita' ? w - lw : 0
      const [px, py] = graus === 0 ? [x + dx, y + topo + i * aj.alturaLinha] : gira(x + dx, y + topo + i * aj.alturaLinha, ox, oy, graus)
      ops.push({ tipo: 'texto', x: n(px), yTopo: n(py), texto: linha, familia, peso, tamanho: aj.tamanho, cor: (e.cor ?? [0, 0, 0]) as Rgb, ascender: aj.ascender, alturaLinha: n(aj.alturaLinha), graus })
    })
  }
  return { paginas: [{ largura: W, altura: H, ops }], largura: W, altura: H, titulo: spec.titulo ?? 'Cartaz', avisos }
}
