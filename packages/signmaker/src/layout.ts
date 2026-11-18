import { DocumentoErro, brl, confereDados, interpola, raizesDe, verdadeiro } from '@polaris/documentos'
import { FONTES, FONTE_PADRAO, fonteDe } from './fontes'
import { MM, TAMANHOS_MM, type Layout, type Op, type Peso, type Rgb } from './modelo'
import { corridas, matrizQr, modulosBarras } from './codigos'
import { ajusta, alturaDigitos, largura, metricas, partesDoPreco } from './texto'

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
    if (e.tipo === 'preco') { try { for (const r of [...raizesDe(e.valor), ...(e.unidade?.texto ? raizesDe(e.unidade.texto) : [])]) if (!dados.has(r)) erros.push(`${onde}: o preço usa o dado "${r}", não declarado em spec.dados`) } catch (x) { erros.push(`${onde}: ${(x as Error).message}`) } }
    if (e.tipo === 'codigoBarras' || e.tipo === 'qrcode') { try { for (const r of [...raizesDe(e.valor), ...(e.rotulo ? raizesDe(e.rotulo) : [])]) if (!dados.has(r)) erros.push(`${onde}: o valor usa o dado "${r}", não declarado em spec.dados`) } catch (x) { erros.push(`${onde}: ${(x as Error).message}`) } }
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

/** vários retângulos num só caminho (cada um um subcaminho fechado); `girar` aplica a rotação do elemento */
const caminhoRets = (rs: Array<[number, number, number, number]>, graus: number, ox: number, oy: number) => rs.map(([x, y, l, a]) => caminhoRet(x, y, l, a, 0, graus, ox, oy)).join('')

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
    if (e.tipo === 'preco') {
      const bruto = interpola(e.valor, dados).trim(); if (!bruto) continue
      let partes: { real: string; cent: string }; try { partes = partesDoPreco(bruto, e.separadorMilhar ?? '.', brl) } catch (x) { throw new DocumentoErro((x as Error).message) }
      const familia = e.fonte?.familia ?? spec.fonte?.familia ?? FONTE_PADRAO, peso = (e.fonte?.peso ?? spec.fonte?.peso ?? 'negrito') as Peso, f = fonteDe(familia, peso), m = metricas(f), dh = alturaDigitos(f)
      const esc = e.centavos?.escala ?? 0.6, posicao = e.centavos?.posicao ?? 'alto', cor = (e.cor ?? [0, 0, 0]) as Rgb, textoCent = `,${partes.cent}`
      const larg = (t: number) => largura(f, partes.real, t) + largura(f, textoCent, t * esc)
      const cabe = (t: number) => larg(t) <= w + 1e-6 && m.alturaNatural * t <= h + 1e-6
      const min = e.tamanho?.min ?? 6, max = e.tamanho?.max ?? 400
      let lo = Math.round(min * 4), hi = Math.round(max * 4); if (!cabe(lo / 4)) avisos.push(`${e.id ?? 'preco'}: o preço não cabe nem no tamanho mínimo (${min} pt)`); else while (lo < hi) { const mid = Math.ceil((lo + hi) / 2); if (cabe(mid / 4)) lo = mid; else hi = mid - 1 }
      const t = lo / 4, bw = larg(t), bh = m.alturaNatural * t, ct = t * esc
      const bx = x + ((e.alinhaH ?? 'centro') === 'centro' ? (w - bw) / 2 : e.alinhaH === 'direita' ? w - bw : 0), topo = y + ((e.alinhaV ?? 'meio') === 'meio' ? (h - bh) / 2 : e.alinhaV === 'base' ? h - bh : 0)
      const baseReal = topo + m.ascender * t, baseCent = posicao === 'alto' ? baseReal - dh * t * (1 - esc) : baseReal
      const pos = (px: number, py: number): [number, number] => (graus === 0 ? [px, py] : gira(px, py, ox, oy, graus))
      const texto = (txt: string, tx: number, base: number, tam: number) => { const [px, py] = pos(tx, base - m.ascender * tam); ops.push({ tipo: 'texto', x: n(px), yTopo: n(py), texto: txt, familia, peso, tamanho: tam, cor, ascender: m.ascender, alturaLinha: n(m.alturaNatural * tam), graus }) }
      texto(partes.real, bx, baseReal, t)
      const wReal = largura(f, partes.real, t), wCent = largura(f, textoCent, ct)
      texto(textoCent, bx + wReal, baseCent, ct)
      const un = e.unidade?.texto ? interpola(e.unidade.texto, dados).trim() : ''
      if (un) { const ut = ct * (e.unidade.escala ?? 0.22), uw = largura(f, un, ut); texto(un, bx + wReal + (wCent - uw) / 2, baseReal, ut) }
      if (e.riscado) {
        const esp = e.riscado.espessura ?? 2, dx = bw, dy = dh * t, comp = Math.hypot(dx, dy), ang = (Math.atan2(dy, dx) * 180) / Math.PI
        const [px, py] = pos(bx, baseReal) // a ponta de baixo, já girada; o traço gira em torno dela pelo giro do elemento + a inclinação
        ops.push({ tipo: 'caminho', d: caminhoRet(px, py - esp / 2, comp, esp, 0, graus + ang, px, py), cor: (e.riscado.cor ?? cor) as Rgb, opacidade: 1 })
      }
      continue
    }
    if (e.tipo === 'codigoBarras' || e.tipo === 'qrcode') {
      const valor = interpola(e.valor, dados).trim(); if (!valor) continue
      const cor = (e.cor ?? [0, 0, 0]) as Rgb, margem = (e.margem ?? (e.tipo === 'qrcode' ? 0.06 : 0.15))
      if (e.fundo) ops.push({ tipo: 'caminho', d: caminhoRet(x, y, w, h, (e.raio ?? 0) * Math.min(w, h), graus, ox, oy), cor: e.fundo as Rgb, opacidade: 1 })
      const rets: Array<[number, number, number, number]> = []
      if (e.tipo === 'qrcode') {
        const m = matrizQr(valor, e.nivel ?? 'L'), lado = Math.min(w, h), mg = margem * lado, cel = (lado - 2 * mg) / m.length, x0 = x + (w - lado) / 2 + mg, y0 = y + (h - lado) / 2 + mg
        m.forEach((linha, r) => { for (const [c, k] of corridas(linha)) rets.push([n(x0 + c * cel), n(y0 + r * cel), n(k * cel), n(cel)]) })
      } else {
        const bits = modulosBarras(valor, e.formato ?? 'code128'), mg = margem * h, modo = e.numero ?? 'cima', barraH = modo === 'nenhum' ? h - 2 * mg : h * 0.5, mod = (w - 2 * mg) / bits.length
        const yBarras = modo === 'cima' ? y + h - mg - barraH : y + mg
        for (const [c, k] of corridas([...bits])) rets.push([n(x + mg + c * mod), n(yBarras), n(k * mod), n(barraH)])
        const rotulo = e.rotulo !== undefined ? interpola(e.rotulo, dados).trim() : valor
        if (modo !== 'nenhum' && rotulo) {
          const familia = e.fonte?.familia ?? spec.fonte?.familia ?? FONTE_PADRAO, peso = (e.fonte?.peso ?? spec.fonte?.peso ?? 'normal') as Peso, f = fonteDe(familia, peso)
          const faixaH = Math.max(0, (modo === 'cima' ? yBarras - (y + mg * 0.5) : y + h - mg * 0.5 - (yBarras + barraH))), faixaY = modo === 'cima' ? y + mg * 0.5 : yBarras + barraH
          if (faixaH > 0) {
            const aj = ajusta(f, rotulo, w - 2 * mg, faixaH, 'nenhuma', 4, 300), total = aj.linhas.length * aj.alturaLinha
            aj.linhas.forEach((linha, i) => {
              const lw = largura(f, linha, aj.tamanho), px0 = x + (w - lw) / 2, py0 = faixaY + (faixaH - total) / 2 + i * aj.alturaLinha, [px, py] = graus === 0 ? [px0, py0] : gira(px0, py0, ox, oy, graus)
              ops.push({ tipo: 'texto', x: n(px), yTopo: n(py), texto: linha, familia, peso, tamanho: aj.tamanho, cor, ascender: aj.ascender, alturaLinha: n(aj.alturaLinha), graus })
            })
          }
        }
      }
      ops.push({ tipo: 'caminho', d: caminhoRets(rets, graus, ox, oy), cor, opacidade: 1 })
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
