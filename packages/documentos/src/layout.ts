import type { Font } from 'opentype.js'
import { fonteDe } from './fontes'
import { interpola } from './interpola'
import { BARRA_SECAO, BARRA_TITULO, INK, LINHA_TOTAL, MM, MUTED, REGUA, TAMANHOS_MM, type Alinha, type Bloco, type Celula, type DocumentoResolvido, type Layout, type Op, type Pagina, type Peso, type Rgb } from './modelo'
import { largura, metricas, quebra } from './texto'

// Motor de layout em fluxo (portado do doc/ do tiffany-erp): compõe cada bloco em operações de desenho numa origem local, empilha e pagina (repetindo o cabeçalho da tabela).
// Medição com a MESMA fonte do PDF e do HTML → as três saídas quebram linha e dimensionam igual.

const TAM = { corpo: 9, rotulo: 8, secao: 12, titulo: 15, cabTabela: 8, celula: 9, celulaSec: 8, rodape: 8 }
const FOLGA_PILHA = 3, FOLGA_BLOCO = 4, PAD_X = 2, PAD_Y = 4
type Ctx = { f: (peso: Peso) => Font }
type Comp = { altura: number; ops: Op[] }
type Item = { altura: number; folga: number; render: (x: number, y: number) => Op[]; grupo?: string; cabecalho?: boolean }

const mv = (ops: Op[], dx: number, dy: number): Op[] => ops.map((o) => o.tipo === 'texto' ? { ...o, x: o.x + dx, yTopo: o.yTopo + dy } : o.tipo === 'linha' ? { ...o, x1: o.x1 + dx, x2: o.x2 + dx, y1: o.y1 + dy, y2: o.y2 + dy } : { ...o, x: o.x + dx, y: o.y + dy })

/** troca o que a fonte não tem (emoji etc.) por "?" — igual no layout, no PDF e no HTML, em vez de uma caixinha ou de um erro no meio da geração */
const cobre = (f: Font, s: string) => Array.from(s).map((c) => (c === '\n' || c === ' ' || f.charToGlyphIndex(c) > 0 ? c : '?')).join('')

function texto(ctx: Ctx, t: string, o: { peso: Peso; tam: number; cor: Rgb; max: number; alin?: Alinha | undefined; x?: number; y?: number }): Comp {
  const f = ctx.f(o.peso), m = metricas(f), lh = m.alturaNatural * o.tam
  const linhas = quebra(f, cobre(f, t), o.tam, o.max)
  const ops: Op[] = []; let y = o.y ?? 0
  for (const l of linhas) {
    const w = largura(f, l, o.tam); let x = o.x ?? 0
    if (o.alin === 'centro') x += (o.max - w) / 2; else if (o.alin === 'direita') x += o.max - w
    if (l !== '') ops.push({ tipo: 'texto', x, yTopo: y, texto: l, peso: o.peso, tamanho: o.tam, cor: o.cor, ascender: m.ascender, alturaLinha: lh })
    y += lh
  }
  return { ops, altura: linhas.length * lh }
}

function compoe(b: Bloco, w: number, ctx: Ctx): Comp {
  switch (b.tipo) {
    case 'espaco': return { altura: b.altura, ops: [] }
    case 'barraSecao': {
      const tit = b.variante === 'titulo', tam = tit ? TAM.titulo : TAM.secao, vp = tit ? 6 : 5, lp = tit ? 10 : 8
      const lh = metricas(ctx.f('negrito')).alturaNatural * tam, h = lh + 2 * vp
      const t = texto(ctx, b.texto, { peso: 'negrito', tam, cor: INK, max: w - lp * 2, x: lp, y: vp })
      // texto de várias linhas: a barra cresce com ele (a original ignorava e o texto vazava)
      const altura = Math.max(h, t.altura + 2 * vp)
      return { altura, ops: [{ tipo: 'ret', x: 0, y: 0, l: w, a: altura, cor: tit ? BARRA_TITULO : BARRA_SECAO }, ...t.ops] }
    }
    case 'paragrafo': return texto(ctx, b.texto, { peso: b.peso ?? 'normal', tam: b.tamanho ?? TAM.corpo, cor: b.cor ?? INK, max: w, alin: b.alinhamento })
    case 'campo': {
      const r = texto(ctx, b.rotulo, { peso: 'negrito', tam: TAM.rotulo, cor: MUTED, max: w })
      const e = b.estiloValor
      const v = texto(ctx, b.valor, { peso: e?.peso ?? 'normal', tam: e?.tamanho ?? TAM.corpo, cor: e?.cor ?? INK, max: w, alin: e?.alinhamento, y: r.altura + 2 })
      return { altura: r.altura + 2 + v.altura, ops: [...r.ops, ...v.ops] }
    }
    case 'colunas': {
      const n = b.colunas.length, tf = b.colunas.reduce((s, c) => s + c.flex, 0), inner = w - b.espacamento * (n - 1)
      let x = 0, mx = 0; const ops: Op[] = []
      for (const c of b.colunas) { const cw = (inner * c.flex) / tf, p = pilha(c.blocos, cw, ctx); ops.push(...mv(p.ops, x, 0)); mx = Math.max(mx, p.altura); x += cw + b.espacamento }
      return { altura: mx, ops }
    }
    case 'tabela': { const cab = cabTabela(b, w, ctx); const ops = [...cab.ops]; let y = cab.altura; for (const l of b.linhas) { const r = linhaTabela(b.colunas, l, w, ctx); ops.push(...mv(r.ops, 0, y)); y += r.altura } return { altura: y, ops } }
    case 'resumo': {
      const sw = w * b.larguraFracao, xo = w - sw, pad = 8, rh = 16, ops: Op[] = []; let y = 0
      for (const r of b.linhas) {
        if (r.forte) ops.push({ tipo: 'ret', x: xo, y, l: sw, a: rh, cor: LINHA_TOTAL })
        const peso: Peso = r.forte ? 'negrito' : 'normal', yt = y + (rh - metricas(ctx.f(peso)).alturaNatural * TAM.corpo) / 2
        // rótulo e valor dividem a largura; o valor tem prioridade (alinhado à direita), o rótulo quebra no espaço que sobra
        const vw = Math.min(largura(ctx.f(peso), cobre(ctx.f(peso), r.valor), TAM.corpo), sw - pad * 2)
        ops.push(...texto(ctx, r.rotulo, { peso, tam: TAM.corpo, cor: INK, max: Math.max(10, sw - pad * 2 - vw - 6), x: xo + pad, y: yt }).ops)
        ops.push(...texto(ctx, r.valor, { peso, tam: TAM.corpo, cor: INK, max: sw - pad * 2, alin: 'direita', x: xo + pad, y: yt }).ops)
        y += rh
      }
      return { altura: y, ops }
    }
    case 'assinaturas': {
      const n = b.itens.length, sw = w / n, ly = 26, ops: Op[] = []
      b.itens.forEach((it, i) => {
        const sx = i * sw, ins = sw * 0.12
        ops.push({ tipo: 'linha', x1: sx + ins, y1: ly, x2: sx + sw - ins, y2: ly, cor: INK, espessura: 0.8 })
        ops.push(...texto(ctx, it.rotulo, { peso: 'negrito', tam: TAM.corpo, cor: INK, max: sw, alin: 'centro', x: sx, y: ly + 5 }).ops)
      })
      return { altura: 42, ops }
    }
    case 'imagem': {
      // nunca maior que a largura disponível (mantém a proporção)
      const k = Math.min(1, w / b.largura), iw = b.largura * k, ih = b.altura * k
      const x = b.alinhamento === 'centro' ? (w - iw) / 2 : b.alinhamento === 'direita' ? w - iw : 0
      return { altura: ih, ops: [{ tipo: 'imagem', x, y: 0, l: iw, a: ih, src: b.src, alt: b.alt }] }
    }
  }
}

function pilha(bs: Bloco[], w: number, ctx: Ctx): Comp {
  let y = 0; const ops: Op[] = []
  bs.forEach((b, i) => { if (i > 0 && b.tipo !== 'espaco') y += FOLGA_PILHA; const c = compoe(b, w, ctx); ops.push(...mv(c.ops, 0, y)); y += c.altura })
  return { altura: y, ops }
}

type Col = { flex: number; alinhamento?: Alinha; cabecalho?: string }
function colunasXs(cols: Col[], w: number) { const tf = cols.reduce((s, c) => s + c.flex, 0), ws = cols.map((c) => (w * c.flex) / tf), xs: number[] = []; let a = 0; for (const x of ws) { xs.push(a); a += x } return { xs, ws } }

function cabTabela(b: Extract<Bloco, { tipo: 'tabela' }>, w: number, ctx: Ctx): Comp {
  const { xs, ws } = colunasXs(b.colunas, w), ops: Op[] = []; let mx = 0
  b.colunas.forEach((c, i) => { const t = texto(ctx, c.cabecalho, { peso: 'normal', tam: TAM.cabTabela, cor: MUTED, max: ws[i]! - PAD_X * 2, alin: c.alinhamento, x: xs[i]! + PAD_X, y: PAD_Y }); ops.push(...t.ops); mx = Math.max(mx, t.altura) })
  const h = mx + PAD_Y * 2
  ops.push({ tipo: 'linha', x1: 0, y1: h, x2: w, y2: h, cor: REGUA, espessura: 0.7 })
  return { altura: h, ops }
}
function linhaTabela(cols: Col[], l: Celula[], w: number, ctx: Ctx): Comp {
  const { xs, ws } = colunasXs(cols, w), ops: Op[] = []; let mx = 0
  cols.forEach((c, i) => {
    const cel = l[i] ?? { principal: '' }, al = cel.alinhamento ?? c.alinhamento, max = ws[i]! - PAD_X * 2, x = xs[i]! + PAD_X
    const p = texto(ctx, cel.principal, { peso: cel.peso ?? 'normal', tam: TAM.celula, cor: INK, max, alin: al, x, y: PAD_Y }); ops.push(...p.ops); let h = p.altura
    if (cel.secundario) { const s = texto(ctx, cel.secundario, { peso: 'normal', tam: TAM.celulaSec, cor: MUTED, max, alin: al, x, y: PAD_Y + p.altura + 1 }); ops.push(...s.ops); h += 1 + s.altura }
    mx = Math.max(mx, h)
  })
  return { altura: mx + PAD_Y * 2, ops }
}

function itens(bs: Bloco[], w: number, ctx: Ctx): Item[] {
  const out: Item[] = []; let seq = 0
  bs.forEach((b, idx) => {
    const folga = idx === 0 || b.tipo === 'espaco' ? 0 : FOLGA_BLOCO
    if (b.tipo === 'tabela') {
      const grupo = `t${seq++}`, cab = cabTabela(b, w, ctx)
      out.push({ altura: cab.altura, folga, grupo, cabecalho: true, render: (x, y) => mv(cab.ops, x, y) })
      for (const l of b.linhas) { const r = linhaTabela(b.colunas, l, w, ctx); out.push({ altura: r.altura, folga: 0, grupo, render: (x, y) => mv(r.ops, x, y) }) }
    } else if (b.tipo === 'paragrafo') {
      // parágrafo longo flui entre páginas, linha a linha
      const c = compoe(b, w, ctx), lh = c.ops.length ? (c.ops[0] as { alturaLinha: number }).alturaLinha : 0
      const porLinha = new Map<number, Op[]>(); for (const o of c.ops) { const k = Math.round((o as { yTopo: number }).yTopo / (lh || 1)); porLinha.set(k, [...(porLinha.get(k) ?? []), o]) }
      const n = Math.max(1, Math.round(c.altura / (lh || 1)))
      if (!lh) out.push({ altura: c.altura, folga, render: (x, y) => mv(c.ops, x, y) })
      else for (let i = 0; i < n; i++) { const ops = porLinha.get(i) ?? []; out.push({ altura: lh, folga: i === 0 ? folga : 0, render: (x, y) => mv(ops, x, y - i * lh) }) }
    } else { const c = compoe(b, w, ctx); out.push({ altura: c.altura, folga, render: (x, y) => mv(c.ops, x, y) }) }
  })
  return out
}

export function dimensoes(d: Pick<DocumentoResolvido, 'tamanho' | 'paisagem'>): [number, number] {
  const [a, b] = TAMANHOS_MM[d.tamanho]; return d.paisagem ? [b * MM, a * MM] : [a * MM, b * MM]
}

export function layout(doc: DocumentoResolvido): Layout {
  const [W, H] = dimensoes(doc), mg = { t: doc.margemMm.topo * MM, r: doc.margemMm.direita * MM, b: doc.margemMm.baixo * MM, l: doc.margemMm.esquerda * MM }
  const cw = W - mg.l - mg.r, maxY = H - mg.b
  if (cw < 50 || maxY - mg.t < 50) throw new Error('margens grandes demais para o tamanho da página')
  const ctx: Ctx = { f: (p) => fonteDe(doc.fonte, p) }
  const its = itens(doc.blocos, cw, ctx)
  const paginas: Pagina[] = []; let cur: Op[] = [], y = mg.t; const cabs = new Map<string, Item>()
  const nova = () => { paginas.push({ largura: W, altura: H, ops: cur }); cur = []; y = mg.t }
  for (const it of its) {
    const topo = y === mg.t, folga = topo ? 0 : it.folga
    if (y + folga + it.altura > maxY && !topo) {
      nova()
      const cab = it.grupo && !it.cabecalho ? cabs.get(it.grupo) : undefined
      if (cab) { cur.push(...cab.render(mg.l, y)); y += cab.altura }
    } else y += folga
    cur.push(...it.render(mg.l, y))
    if (it.cabecalho && it.grupo) cabs.set(it.grupo, it)
    y += it.altura
  }
  paginas.push({ largura: W, altura: H, ops: cur })
  if (doc.rodape) {
    const total = paginas.length
    paginas.forEach((p, i) => p.ops.push(...texto(ctx, interpola(doc.rodape, { ...(doc.dados as object), pagina: i + 1, paginas: total }), { peso: 'normal', tam: TAM.rodape, cor: MUTED, max: cw, alin: 'direita', x: mg.l, y: H - mg.b + 8 }).ops))
  }
  return { paginas, largura: W, altura: H, fonte: doc.fonte, titulo: doc.titulo }
}
