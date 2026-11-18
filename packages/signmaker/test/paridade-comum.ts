import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PNG } from 'pngjs'
import { chromium, type Browser } from 'playwright-core'
import { afterAll, beforeAll } from 'vitest'
import { fonteDe, largura, type Layout } from '../src'

// PARIDADE: o MESMO cartaz sai em HTML e PDF; o HTML é aberto num Chrome de verdade e o PDF é rasterizado/lido pelo poppler, e os dois são comparados
// (1) palavra a palavra, por posição (só texto SEM rotação: o poppler dá a caixa do texto girado de outro jeito) e (2) por pixel, que cobre o texto girado e as formas.
// Mesma técnica de packages/documentos/test/paridade.test.ts. Pula se faltar Chrome ou poppler; no CI (variável CI) a falta é FALHA.
export const CHROME = process.env.CHROME ?? ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find(existsSync)
export const tem = (cmd: string) => { try { execFileSync(cmd, ['-v'], { stdio: 'ignore' }); return true } catch (e) { return (e as { code?: string }).code !== 'ENOENT' } }
export const PRONTO = Boolean(CHROME) && tem('pdftoppm') && tem('pdftotext')
const DPI = 144, ESC = DPI / 72
export let nav: Browser, tmp: string
/** registra os hooks que abrem o Chrome e a pasta temporária; chame uma vez por arquivo de teste */
export function usaNavegador() {
  beforeAll(async () => { tmp = mkdtempSync(join(tmpdir(), 'sign-paridade-')); if (PRONTO) nav = await chromium.launch({ executablePath: CHROME!, args: ['--no-sandbox'] }) })
  afterAll(async () => { await nav?.close(); rmSync(tmp, { recursive: true, force: true }) })
}

export type Palavra = { pag: number; t: string; x0: number; x1: number; y: number }
export async function doChrome(html: string): Promise<{ palavras: Palavra[]; imgs: Buffer[] }> {
  const pg = await nav.newPage({ deviceScaleFactor: ESC * 0.75 })
  try {
    await pg.setContent(html, { waitUntil: 'load' }); await pg.evaluate(() => document.fonts.ready)
    // a peça no canto (0,0), sem sombra: com `margin:auto` ela cai numa posição fracionária e o Chrome reamostra o conteúdo inteiro (até 0,75 px de erro, só do teste)
    await pg.addStyleTag({ content: '.pagina{margin:0!important;box-shadow:none!important}' })
    // O Chrome arredonda ascendente/descendente para pixel inteiro ao medir a caixa do texto (por isso a caixa dele não serve de régua): mede-se o que ele de fato POSICIONOU,
    // a linha de base e o início/fim de cada palavra (getStartPositionOfChar/getEndPositionOfChar), e a altura do centro vem das métricas verdadeiras da fonte, como no poppler.
    const k: Record<string, number> = {}
    for (const f of ['Montserrat', 'Roboto']) for (const peso of ['normal', 'negrito'] as const) { const m = fonteDe(f, peso); k[`Sign-${f}:${peso === 'negrito' ? 700 : 400}`] = (m.ascender + m.descender) / 2 / m.unitsPerEm }
    const palavras = await pg.evaluate((k) => {
      const out: Array<{ pag: number; t: string; x0: number; x1: number; y: number }> = []
      document.querySelectorAll('section.pagina').forEach((sec, i) => {
        sec.querySelectorAll<SVGTextElement>('text.t').forEach((sp) => {
          if (sp.getAttribute('transform')) return // girado: conferido por pixel
          const txt = sp.textContent ?? '', re = /\S+/g, tam = Number(sp.getAttribute('font-size')), fam = (sp.getAttribute('font-family') ?? '').replace(/'/g, ''); let m: RegExpExecArray | null
          const kk = k[`${fam}:${sp.getAttribute('font-weight')}`] ?? 0
          while ((m = re.exec(txt))) { const a = sp.getStartPositionOfChar(m.index), b = sp.getEndPositionOfChar(m.index + m[0].length - 1); out.push({ pag: i + 1, t: m[0], x0: a.x, x1: b.x, y: a.y - kk * tam }) }
        })
      })
      return out
    }, k)
    const secs = await pg.locator('section.pagina').all(); const imgs: Buffer[] = []
    for (const s of secs) imgs.push(await s.screenshot({ type: 'png' }))
    return { palavras, imgs }
  } finally { await pg.close() }
}
export type Regiao = { x0: number; y0: number; x1: number; y1: number }
export function doPdf(pdf: Uint8Array, girados: Regiao[]): { palavras: Palavra[]; imgs: Buffer[] } {
  const f = join(tmp, `d${Math.random().toString(36).slice(2)}.pdf`); writeFileSync(f, pdf)
  const xml = execFileSync('pdftotext', ['-bbox', f, '-'], { encoding: 'utf8', maxBuffer: 1 << 26 })
  const palavras: Palavra[] = []; let pag = 0
  for (const linha of xml.split('\n')) {
    if (/<page /.test(linha)) pag++
    const m = /<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">(.*)<\/word>/.exec(linha)
    if (m) { const t = m[5]!.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&'); const cx = (+m[1]! + +m[3]!) / 2, cy = (+m[2]! + +m[4]!) / 2; if (!girados.some((r) => cx >= r.x0 && cx <= r.x1 && cy >= r.y0 && cy <= r.y1)) palavras.push({ pag, t, x0: +m[1]!, x1: +m[3]!, y: cy }) }
  }
  execFileSync('pdftoppm', ['-r', String(DPI), '-png', f, f.replace(/\.pdf$/, '')])
  const base = f.replace(/\.pdf$/, ''), imgs: Buffer[] = []
  for (let i = 1; ; i++) { const c = [`${base}-${i}.png`, `${base}-${String(i).padStart(2, '0')}.png`].find(existsSync); if (!c) break; imgs.push(readFileSync(c)) }
  return { palavras, imgs }
}
/** o poppler cola em UMA palavra pedaços que se tocam na mesma linha (os reais e os centavos ao lado: "12" + ",90"); o mesmo vale para o Chrome, para comparar igual */
export function junta(ws: Palavra[]): Palavra[] {
  const out: Palavra[] = []
  for (const w of ws) { const a = out.find((q) => q.pag === w.pag && Math.abs(q.y - w.y) < 0.05 && w.x0 - q.x1 >= -0.3 && w.x0 - q.x1 < 0.5); if (a) { a.t += w.t; a.x1 = w.x1 } else out.push({ ...w }) }
  return out
}
export const dist = (w: Palavra, q: Palavra) => Math.max(Math.abs(w.x0 - q.x0), Math.abs(w.x1 - q.x1), Math.abs(w.y - q.y))
export function pior(a: Palavra[], b: Palavra[]): number {
  if (a.length !== b.length) return Infinity
  const livres = [...b]; let m = 0
  for (const w of a) {
    let k = -1, d = Infinity
    livres.forEach((q, i) => { if (q.pag === w.pag && q.t === w.t && dist(w, q) < d) { d = dist(w, q); k = i } })
    if (k < 0) return Infinity
    livres.splice(k, 1); m = Math.max(m, d)
  }
  return m
}
export function blocos(png: Buffer, n: number) {
  const p = PNG.sync.read(png), w = Math.floor(p.width / n), h = Math.floor(p.height / n), v = new Float32Array(w * h)
  for (let by = 0; by < h; by++) for (let bx = 0; bx < w; bx++) { let s = 0; for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) { const i = ((by * n + y) * p.width + bx * n + x) * 4; s += 0.299 * p.data[i]! + 0.587 * p.data[i + 1]! + 0.114 * p.data[i + 2]! } v[by * w + bx] = s / (n * n) }
  return { w, h, v }
}
export function diferenca(a: Buffer, b: Buffer): { medio: number; ruins: number } {
  const A = blocos(a, 6), B = blocos(b, 6); const w = Math.min(A.w, B.w), h = Math.min(A.h, B.h); let soma = 0, ruins = 0
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const d = Math.abs(A.v[y * A.w + x]! - B.v[y * B.w + x]!); soma += d; if (d > 60) ruins++ }
  return { medio: soma / (w * h), ruins: ruins / (w * h) }
}
/** as regiões (caixa que contém a linha girada, +2 pt) onde o poppler fragmenta as palavras: lá só vale o pixel */
export const palavrasGiradas = (l: Layout): Regiao[] => l.paginas.flatMap((p) => p.ops.flatMap((o) => {
  if (o.tipo !== 'texto' || o.graus === 0) return []
  const a = (o.graus * Math.PI) / 180, lw = largura(fonteDe(o.familia, o.peso), o.texto, o.tamanho)
  const pts = [[0, 0], [lw, 0], [0, o.alturaLinha], [lw, o.alturaLinha]].map(([dx, dy]) => [o.x + dx! * Math.cos(a) + dy! * Math.sin(a), o.yTopo - dx! * Math.sin(a) + dy! * Math.cos(a)] as const)
  return [{ x0: Math.min(...pts.map((q) => q[0])) - 2, x1: Math.max(...pts.map((q) => q[0])) + 2, y0: Math.min(...pts.map((q) => q[1])) - 2, y1: Math.max(...pts.map((q) => q[1])) + 2 }]
}))


/** limite de pixel entre Chrome e poppler: a média tolera a diferença de antialiasing/gama entre os dois rasterizadores (texto fino de peso normal chega a ~2,8); o deslocamento, a cor e o giro errados passam MUITO disso (o teste do detector prova) */
export const LIMITE_PIXEL = { medio: 3.2, ruins: 0.004 }
export const pixelOk = (d: { medio: number; ruins: number }) => d.medio < LIMITE_PIXEL.medio && d.ruins < LIMITE_PIXEL.ruins
