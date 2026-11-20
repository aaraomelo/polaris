// Geometria pura da tela de edição (frações da moldura, 0 a 1): mover, redimensionar e encaixar (na grade, nas bordas e centros das outras caixas e da própria moldura). Sem DOM: a ilha só traduz o ponteiro em deslocamentos.

export type Caixa = { topo: number; esquerda: number; largura: number; altura: number }
export type Guia = { eixo: 'x' | 'y'; em: number }
export type Alca = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw'
export const ALCAS: readonly Alca[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']
export const TAMANHO_MIN = 0.02
export const LIMIAR = 0.01
const r4 = (v: number): number => Math.round(v * 10000) / 10000
const limita = (v: number, a: number, b: number): number => Math.min(b, Math.max(a, v))
const grade = (v: number, passo: number): number => Math.round(v / passo) * passo

/** o valor encaixado: no alvo mais próximo (dentro do limiar) ou, sem alvo, na grade. Devolve também o alvo que prendeu (para a guia). */
function encaixa(v: number, alvos: number[], passo: number, limiar: number): { v: number; guia?: number } {
  let melhor: number | undefined
  for (const a of alvos) if (Math.abs(a - v) <= limiar && (melhor === undefined || Math.abs(a - v) < Math.abs(melhor - v))) melhor = a
  return melhor !== undefined ? { v: melhor, guia: melhor } : { v: grade(v, passo) }
}
const alvosX = (outras: Caixa[]): number[] => [0, 0.5, 1, ...outras.flatMap((o) => [o.esquerda, o.esquerda + o.largura / 2, o.esquerda + o.largura])]
const alvosY = (outras: Caixa[]): number[] => [0, 0.5, 1, ...outras.flatMap((o) => [o.topo, o.topo + o.altura / 2, o.topo + o.altura])]

/** move a caixa por (dx, dy): a borda, o centro ou a outra borda de cada eixo prendem no alvo mais próximo; a caixa nunca sai da moldura */
export function move(c: Caixa, dx: number, dy: number, passo: number, outras: Caixa[] = [], limiar = LIMIAR): { caixa: Caixa; guias: Guia[] } {
  const guias: Guia[] = []
  const eixo = (ini: number, tam: number, d: number, alvos: number[], e: 'x' | 'y'): number => {
    const p = ini + d, cands = [{ off: 0, ...encaixa(p, alvos, passo, limiar) }, { off: tam / 2, ...encaixa(p + tam / 2, alvos, passo, limiar) }, { off: tam, ...encaixa(p + tam, alvos, passo, limiar) }]
    const preso = cands.filter((k) => k.guia !== undefined).sort((a, b) => Math.abs(a.v - (p + a.off)) - Math.abs(b.v - (p + b.off)))[0]
    const pos = limita(preso ? preso.v - preso.off : cands[0]!.v, 0, Math.max(0, 1 - tam))
    if (preso && Math.abs(pos - (preso.v - preso.off)) < 1e-9) guias.push({ eixo: e, em: r4(preso.guia!) })
    return pos
  }
  return { caixa: { ...c, esquerda: r4(eixo(c.esquerda, c.largura, dx, alvosX(outras), 'x')), topo: r4(eixo(c.topo, c.altura, dy, alvosY(outras), 'y')) }, guias }
}

/** puxa a alça por (dx, dy): só as bordas que ela move mudam; encaixa a borda movida; respeita o tamanho mínimo e a moldura */
export function redimensiona(c: Caixa, alca: Alca, dx: number, dy: number, passo: number, outras: Caixa[] = [], limiar = LIMIAR): { caixa: Caixa; guias: Guia[] } {
  const guias: Guia[] = []
  let e = c.esquerda, d = c.esquerda + c.largura, t = c.topo, b = c.topo + c.altura
  const prende = (v: number, alvos: number[], eixo: 'x' | 'y'): number => { const k = encaixa(v, alvos, passo, limiar); if (k.guia !== undefined) guias.push({ eixo, em: r4(k.guia) }); return k.v }
  if (alca.includes('w')) e = prende(c.esquerda + dx, alvosX(outras), 'x')
  if (alca.includes('e')) d = prende(c.esquerda + c.largura + dx, alvosX(outras), 'x')
  if (alca.includes('n')) t = prende(c.topo + dy, alvosY(outras), 'y')
  if (alca.includes('s')) b = prende(c.topo + c.altura + dy, alvosY(outras), 'y')
  e = limita(e, 0, 1); d = limita(d, 0, 1); t = limita(t, 0, 1); b = limita(b, 0, 1)
  if (d - e < TAMANHO_MIN) { if (alca.includes('w')) e = d - TAMANHO_MIN; else d = e + TAMANHO_MIN }
  if (b - t < TAMANHO_MIN) { if (alca.includes('n')) t = b - TAMANHO_MIN; else b = t + TAMANHO_MIN }
  e = limita(e, 0, 1 - TAMANHO_MIN); t = limita(t, 0, 1 - TAMANHO_MIN); d = limita(d, e + TAMANHO_MIN, 1); b = limita(b, t + TAMANHO_MIN, 1)
  return { caixa: { esquerda: r4(e), topo: r4(t), largura: r4(r4(d) - r4(e)), altura: r4(r4(b) - r4(t)) }, guias }
}

/** onde fica uma caixa de tamanho (l, a) solta com o centro no ponto (x, y): dentro da moldura e na grade */
export function colocaCentrada(x: number, y: number, l: number, a: number, passo: number): Caixa {
  return { esquerda: r4(limita(grade(x - l / 2, passo), 0, Math.max(0, 1 - l))), topo: r4(limita(grade(y - a / 2, passo), 0, Math.max(0, 1 - a))), largura: l, altura: a }
}

/**
 * Redimensiona uma caixa GIRADA pela alça: o deslocamento do ponteiro (em frações da moldura, nos eixos da TELA) é levado para os eixos da própria caixa, só as bordas da alça mudam, e o ponto oposto à alça fica PARADO na tela.
 * Como o giro é em torno do meio da borda esquerda (o pivô do Sign Maker no HTML e no PDF), mexer na borda esquerda, de cima ou de baixo desloca o pivô: a posição é refeita para o ponto oposto não sair do lugar.
 * A conta é no espaço da peça em pt (altura = 1, largura = `prop`), onde o giro não deforma; `prop` é largura ÷ altura da moldura. Sem encaixe nas guias (a caixa girada não tem alinhamento óbvio); a grade vale para o tamanho.
 */
export function redimensionaGirada(c: Caixa, alca: Alca, dx: number, dy: number, graus: number, prop: number, passo: number): { caixa: Caixa; guias: Guia[] } {
  const a = (graus * Math.PI) / 180, co = Math.cos(a), si = Math.sin(a)
  const dxs = dx * prop, dys = dy // deslocamento da tela, no espaço da peça
  return redimensionaLocal(c, alca, co * dxs - si * dys, si * dxs + co * dys, graus, prop, passo)
}

/** o mesmo, com o deslocamento JÁ nos eixos da caixa (o teclado: "mais largo" é sempre ao longo da própria caixa) */
export function redimensionaLocal(c: Caixa, alca: Alca, dlx: number, dly: number, graus: number, prop: number, passo: number): { caixa: Caixa; guias: Guia[] } {
  const a = (graus * Math.PI) / 180, co = Math.cos(a), si = Math.sin(a)
  const x = c.esquerda * prop, y = c.topo, w = c.largura * prop, h = c.altura
  const ox = x, oy = y + h / 2 // o pivô, antes
  // bordas nos eixos da caixa, com a origem no pivô: esquerda 0, direita w, topo −h/2, base h/2
  let l = 0, r = w, t = -h / 2, b = h / 2
  if (alca.includes('w')) l += dlx
  if (alca.includes('e')) r += dlx
  if (alca.includes('n')) t += dly
  if (alca.includes('s')) b += dly
  const minW = TAMANHO_MIN * prop, minH = TAMANHO_MIN
  if (r - l < minW) { if (alca.includes('w')) l = r - minW; else r = l + minW }
  if (b - t < minH) { if (alca.includes('n')) t = b - minH; else b = t + minH }
  const gp = (v: number): number => grade(v, passo) // a grade vale para o tamanho
  const w2 = Math.max(minW, gp((r - l) / prop) * prop), h2 = Math.max(minH, gp(b - t))
  // o lado fixo é o oposto ao da alça: se a alça mexe na direita, a esquerda fica (l); se mexe na esquerda, a direita (r); idem em cima e embaixo
  if (alca.includes('w')) l = r - w2; else r = l + w2
  if (alca.includes('n')) t = b - h2; else b = t + h2
  // o novo pivô (meio da nova borda esquerda), nos eixos antigos da caixa, vira posição na peça pelo giro
  const px = l, py = (t + b) / 2
  const nx = ox + co * px + si * py, ny = oy - si * px + co * py
  const nh = b - t, nw = r - l
  return { caixa: { esquerda: r4(nx / prop), topo: r4(ny - nh / 2), largura: r4(nw / prop), altura: r4(nh) }, guias: [] }
}
