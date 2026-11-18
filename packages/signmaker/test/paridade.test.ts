import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PNG } from 'pngjs'
import { chromium, type Browser } from 'playwright-core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { fonteDe, htmlDe, largura, layoutCartaz, pdfDe, type Layout } from '../src'
import { DADOS_LONGO, DADOS_OFERTA, NO_OFERTA, SPEC_VARIADO } from './exemplos'

// PARIDADE: o MESMO cartaz sai em HTML e PDF; o HTML é aberto num Chrome de verdade e o PDF é rasterizado/lido pelo poppler, e os dois são comparados
// (1) palavra a palavra, por posição (só texto SEM rotação: o poppler dá a caixa do texto girado de outro jeito) e (2) por pixel, que cobre o texto girado e as formas.
// Mesma técnica de packages/documentos/test/paridade.test.ts. Pula se faltar Chrome ou poppler; no CI (variável CI) a falta é FALHA.
const CHROME = process.env.CHROME ?? ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find(existsSync)
const tem = (cmd: string) => { try { execFileSync(cmd, ['-v'], { stdio: 'ignore' }); return true } catch (e) { return (e as { code?: string }).code !== 'ENOENT' } }
const PRONTO = Boolean(CHROME) && tem('pdftoppm') && tem('pdftotext')
const DPI = 144, ESC = DPI / 72
let nav: Browser, tmp: string
beforeAll(async () => { tmp = mkdtempSync(join(tmpdir(), 'sign-paridade-')); if (PRONTO) nav = await chromium.launch({ executablePath: CHROME!, args: ['--no-sandbox'] }) })
afterAll(async () => { await nav?.close(); rmSync(tmp, { recursive: true, force: true }) })

type Palavra = { pag: number; t: string; x0: number; x1: number; y: number }
async function doChrome(html: string): Promise<{ palavras: Palavra[]; imgs: Buffer[] }> {
  const pg = await nav.newPage({ deviceScaleFactor: ESC * 0.75 })
  try {
    await pg.setContent(html, { waitUntil: 'load' }); await pg.evaluate(() => document.fonts.ready)
    const palavras = await pg.evaluate(() => {
      const out: Array<{ pag: number; t: string; x0: number; x1: number; y: number }> = []
      document.querySelectorAll('section.pagina').forEach((sec, i) => {
        const base = sec.getBoundingClientRect()
        sec.querySelectorAll<HTMLElement>('.t').forEach((sp) => {
          if (sp.style.transform) return // girado: conferido por pixel
          const nodo = sp.firstChild as Text; const re = /\S+/g; let m: RegExpExecArray | null
          while ((m = re.exec(nodo.data))) { const r = document.createRange(); r.setStart(nodo, m.index); r.setEnd(nodo, m.index + m[0].length); const b = r.getBoundingClientRect(); out.push({ pag: i + 1, t: m[0], x0: (b.left - base.left) * 0.75, x1: (b.right - base.left) * 0.75, y: ((b.top + b.bottom) / 2 - base.top) * 0.75 }) }
        })
      })
      return out
    })
    const secs = await pg.locator('section.pagina').all(); const imgs: Buffer[] = []
    for (const s of secs) imgs.push(await s.screenshot({ type: 'png' }))
    return { palavras, imgs }
  } finally { await pg.close() }
}
type Regiao = { x0: number; y0: number; x1: number; y1: number }
function doPdf(pdf: Uint8Array, girados: Regiao[]): { palavras: Palavra[]; imgs: Buffer[] } {
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
const dist = (w: Palavra, q: Palavra) => Math.max(Math.abs(w.x0 - q.x0), Math.abs(w.x1 - q.x1), Math.abs(w.y - q.y))
function pior(a: Palavra[], b: Palavra[]): number {
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
function blocos(png: Buffer, n: number) {
  const p = PNG.sync.read(png), w = Math.floor(p.width / n), h = Math.floor(p.height / n), v = new Float32Array(w * h)
  for (let by = 0; by < h; by++) for (let bx = 0; bx < w; bx++) { let s = 0; for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) { const i = ((by * n + y) * p.width + bx * n + x) * 4; s += 0.299 * p.data[i]! + 0.587 * p.data[i + 1]! + 0.114 * p.data[i + 2]! } v[by * w + bx] = s / (n * n) }
  return { w, h, v }
}
function diferenca(a: Buffer, b: Buffer): { medio: number; ruins: number } {
  const A = blocos(a, 6), B = blocos(b, 6); const w = Math.min(A.w, B.w), h = Math.min(A.h, B.h); let soma = 0, ruins = 0
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const d = Math.abs(A.v[y * A.w + x]! - B.v[y * B.w + x]!); soma += d; if (d > 60) ruins++ }
  return { medio: soma / (w * h), ruins: ruins / (w * h) }
}
/** as regiões (caixa que contém a linha girada, +2 pt) onde o poppler fragmenta as palavras: lá só vale o pixel */
const palavrasGiradas = (l: Layout): Regiao[] => l.paginas.flatMap((p) => p.ops.flatMap((o) => {
  if (o.tipo !== 'texto' || o.graus === 0) return []
  const a = (o.graus * Math.PI) / 180, lw = largura(fonteDe(o.familia, o.peso), o.texto, o.tamanho)
  const pts = [[0, 0], [lw, 0], [0, o.alturaLinha], [lw, o.alturaLinha]].map(([dx, dy]) => [o.x + dx! * Math.cos(a) + dy! * Math.sin(a), o.yTopo - dx! * Math.sin(a) + dy! * Math.cos(a)] as const)
  return [{ x0: Math.min(...pts.map((q) => q[0])) - 2, x1: Math.max(...pts.map((q) => q[0])) + 2, y0: Math.min(...pts.map((q) => q[1])) - 2, y1: Math.max(...pts.map((q) => q[1])) + 2 }]
}))

const CASOS: Array<[string, Record<string, any>, unknown]> = [
  ['oferta A5 paisagem', NO_OFERTA.spec, DADOS_OFERTA],
  ['oferta A4 retrato', { ...NO_OFERTA.spec, tamanho: 'A4', orientacao: 'retrato' }, DADOS_OFERTA],
  ['oferta A6 com nome longo', { ...NO_OFERTA.spec, tamanho: 'A6' }, DADOS_LONGO],
  ['oferta A7 sem "de"', { ...NO_OFERTA.spec, tamanho: 'A7', orientacao: 'retrato' }, { ...DADOS_OFERTA, preco: { de: '', por: '0.99' } }],
  ['variado: girado, translúcido, arredondado, alinhamentos, Roboto', SPEC_VARIADO, { nome: 'Promoção da Semana' }],
]

it.runIf(!PRONTO && Boolean(process.env.CI))('CI: Chrome e poppler (pdftoppm, pdftotext) precisam estar instalados', () => { throw new Error('Chrome ou poppler ausentes: a paridade HTML × PDF do cartaz não pôde ser verificada') })
describe.skipIf(!PRONTO)('paridade HTML × PDF do cartaz', () => {
  for (const [nome, spec, dados] of CASOS) {
    it(`${nome}: mesmas palavras nas mesmas posições (±1 pt) e mesmos pixels`, async () => {
      const l = layoutCartaz(spec, dados), html = htmlDe(l), pdf = await pdfDe(l, new Date(0))
      const c = await doChrome(html), p = doPdf(pdf, palavrasGiradas(l))
      expect(c.imgs.length).toBe(1); expect(p.imgs.length).toBe(1); expect(c.palavras.length).toBeGreaterThan(2)
      expect(pior(c.palavras, p.palavras)).toBeLessThanOrEqual(1)
      const d = diferenca(c.imgs[0]!, p.imgs[0]!); expect(d.medio).toBeLessThan(2.5); expect(d.ruins).toBeLessThan(0.004)
      if (process.env.PARIDADE_SALVA) { writeFileSync(join(process.env.PARIDADE_SALVA, `${nome.replace(/\W+/g, '-')}-chrome.png`), c.imgs[0]!); writeFileSync(join(process.env.PARIDADE_SALVA, `${nome.replace(/\W+/g, '-')}-pdf.png`), p.imgs[0]!) }
    })
  }

  it('o detector enxerga defeitos: 1,5 pt de deslocamento, cor trocada, texto trocado e giro diferente são reprovados', async () => {
    const l = layoutCartaz(SPEC_VARIADO, { nome: 'Promoção da Semana' }), p = doPdf(await pdfDe(l, new Date(0)), palavrasGiradas(l))
    const mutado = (f: (t: Layout) => void) => { const m = structuredClone(l); f(m); return m }
    const desloca = mutado((m) => { for (const o of m.paginas[0]!.ops) if (o.tipo === 'texto') o.x += 1.5 })
    const cor = mutado((m) => { for (const o of m.paginas[0]!.ops) if (o.tipo === 'caminho') o.cor = [0, 0, 0] })
    const txt = mutado((m) => { const o = m.paginas[0]!.ops.find((x) => x.tipo === 'texto' && x.graus === 0); if (o?.tipo === 'texto') o.texto = 'XXXX' })
    const gira = mutado((m) => { for (const o of m.paginas[0]!.ops) if (o.tipo === 'texto' && o.graus) o.graus += 3 })
    expect(pior((await doChrome(htmlDe(l))).palavras, p.palavras)).toBeLessThanOrEqual(1)
    expect(pior((await doChrome(htmlDe(desloca))).palavras, p.palavras)).toBeGreaterThan(1)
    const dc = diferenca((await doChrome(htmlDe(cor))).imgs[0]!, p.imgs[0]!); expect(dc.medio > 2.5 || dc.ruins >= 0.004).toBe(true)
    expect(pior((await doChrome(htmlDe(txt))).palavras, p.palavras)).toBe(Infinity)
    const dg = diferenca((await doChrome(htmlDe(gira))).imgs[0]!, p.imgs[0]!); expect(dg.medio > 0.6 || dg.ruins >= 0.0005).toBe(true) // girar 3° também precisa ser visto
  })

  it('o PDF embarca as fontes usadas e o HTML as declara', async () => {
    const l = layoutCartaz(SPEC_VARIADO, { nome: 'x' }), f = join(tmp, 'f.pdf'); writeFileSync(f, await pdfDe(l, new Date(0)))
    const fontes = execFileSync('pdffonts', [f], { encoding: 'utf8' }); expect(fontes).toMatch(/Montserrat.*yes/); expect(fontes).toMatch(/Roboto.*yes/)
    expect(htmlDe(l)).toContain('Sign-Montserrat')
  })
})
