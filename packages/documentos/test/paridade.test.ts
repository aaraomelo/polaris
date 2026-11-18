import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { PNG } from 'pngjs'
import { chromium, type Browser } from 'playwright-core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { geraDocumento, htmlDe, layout, pdfDe, resolve } from '../src'
import { DADOS_OS, DADOS_PEDIDO, DADOS_RECIBO, NO_OS, NO_PEDIDO, NO_RECIBO } from './dados'

// PARIDADE: o MESMO documento sai em HTML e PDF; aqui o HTML é aberto num Chrome de verdade e o PDF é rasterizado/lido pelo poppler, e os dois são comparados
// (1) palavra a palavra, por posição, e (2) por pixel. Pula se faltar Chrome ou poppler (o CI instala os dois: ver docs/documentos.md).
const CHROME = process.env.CHROME ?? ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find(existsSync)
const tem = (cmd: string) => { try { execFileSync(cmd, ['-v'], { stdio: 'ignore' }); return true } catch (e) { return (e as { code?: string }).code !== 'ENOENT' } }
const PRONTO = Boolean(CHROME) && tem('pdftoppm') && tem('pdftotext')
const DPI = 144, ESC = DPI / 72 // px por pt
let nav: Browser, tmp: string
beforeAll(async () => { tmp = mkdtempSync(join(tmpdir(), 'paridade-')); if (PRONTO) nav = await chromium.launch({ executablePath: CHROME!, args: ['--no-sandbox'] }) })
afterAll(async () => { await nav?.close(); rmSync(tmp, { recursive: true, force: true }) })

type Palavra = { pag: number; t: string; x0: number; x1: number; y: number }
async function doChrome(html: string): Promise<{ palavras: Palavra[]; imgs: Buffer[] }> {
  const pg = await nav.newPage({ deviceScaleFactor: ESC * 0.75 /* 1pt = 4/3 css px */ })
  try {
    await pg.setContent(html, { waitUntil: 'load' }); await pg.evaluate(() => document.fonts.ready)
    const palavras = await pg.evaluate(() => {
      const out: Array<{ pag: number; t: string; x0: number; x1: number; y: number }> = []
      document.querySelectorAll('section.pagina').forEach((sec, i) => {
        const base = sec.getBoundingClientRect()
        sec.querySelectorAll('.t').forEach((sp) => {
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
function doPdf(pdf: Uint8Array): { palavras: Palavra[]; imgs: Buffer[] } {
  const f = join(tmp, `d${Math.random().toString(36).slice(2)}.pdf`); writeFileSync(f, pdf)
  const xml = execFileSync('pdftotext', ['-bbox', f, '-'], { encoding: 'utf8', maxBuffer: 1 << 26 })
  const palavras: Palavra[] = []; let pag = 0
  for (const linha of xml.split('\n')) {
    if (/<page /.test(linha)) pag++
    const m = /<word xMin="([\d.]+)" yMin="([\d.]+)" xMax="([\d.]+)" yMax="([\d.]+)">(.*)<\/word>/.exec(linha)
    if (m) palavras.push({ pag, t: m[5]!.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&'), x0: +m[1]!, x1: +m[3]!, y: (+m[2]! + +m[4]!) / 2 })
  }
  execFileSync('pdftoppm', ['-r', String(DPI), '-png', f, f.replace(/\.pdf$/, '')])
  const imgs: Buffer[] = []; for (let i = 1; existsSync(`${f.replace(/\.pdf$/, '')}-${i}.png`) || existsSync(`${f.replace(/\.pdf$/, '')}-${String(i).padStart(2, '0')}.png`); i++) imgs.push(readFileSync(existsSync(`${f.replace(/\.pdf$/, '')}-${i}.png`) ? `${f.replace(/\.pdf$/, '')}-${i}.png` : `${f.replace(/\.pdf$/, '')}-${String(i).padStart(2, '0')}.png`))
  return { palavras, imgs }
}
const dist = (w: Palavra, q: Palavra) => Math.max(Math.abs(w.x0 - q.x0), Math.abs(w.x1 - q.x1), Math.abs(w.y - q.y))
/** casa cada palavra do Chrome com a mais próxima, de mesmo texto e página, do PDF (um para um) e devolve o PIOR deslocamento; Infinity se alguma não casa */
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

/** luminância em blocos de n×n px: tolera o antialiasing (que difere entre Chrome e poppler) e ainda acusa 1 pt de deslocamento */
function blocos(png: Buffer, n: number): { w: number; h: number; v: Float32Array } {
  const p = PNG.sync.read(png), w = Math.floor(p.width / n), h = Math.floor(p.height / n), v = new Float32Array(w * h)
  for (let by = 0; by < h; by++) for (let bx = 0; bx < w; bx++) { let s = 0; for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) { const i = ((by * n + y) * p.width + bx * n + x) * 4; s += 0.299 * p.data[i]! + 0.587 * p.data[i + 1]! + 0.114 * p.data[i + 2]! } v[by * w + bx] = s / (n * n) }
  return { w, h, v }
}
function diferenca(a: Buffer, b: Buffer): { medio: number; ruins: number } {
  const A = blocos(a, 6), B = blocos(b, 6); const w = Math.min(A.w, B.w), h = Math.min(A.h, B.h); let soma = 0, ruins = 0
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const d = Math.abs(A.v[y * A.w + x]! - B.v[y * B.w + x]!); soma += d; if (d > 60) ruins++ }
  return { medio: soma / (w * h), ruins: ruins / (w * h) }
}

const CASOS = [
  ['ordem de serviço', NO_OS.spec, DADOS_OS],
  ['pedido', NO_PEDIDO.spec, DADOS_PEDIDO],
  ['recibo (A5 paisagem)', NO_RECIBO.spec, DADOS_RECIBO],
  ['ordem de serviço com 3 páginas', NO_OS.spec, { ...DADOS_OS, itens: Array.from({ length: 110 }, (_, i) => ({ descricao: `Peça ${i} — conector “especial” fiação`, tipo: i % 2 ? 'peca' : 'servico', quantidade: '1.5', precoUnitario: '10.10', total: '15.15' })) }],
] as const

// no CI (variável CI) faltar ferramenta é FALHA, não pulo: senão a paridade pararia de ser verificada sem ninguém notar
it.runIf(!PRONTO && Boolean(process.env.CI))('CI: Chrome e poppler (pdftoppm, pdftotext, pdffonts) precisam estar instalados', () => { throw new Error('Chrome ou poppler ausentes: a paridade HTML × PDF não pôde ser verificada') })
describe.skipIf(!PRONTO)('paridade HTML × PDF', () => {
  for (const [nome, spec, dados] of CASOS) {
    it(`${nome}: mesmas palavras, nas mesmas posições (±1 pt), e mesmos pixels`, async () => {
      const l = layout(resolve(spec as never, dados)); const html = htmlDe(l), pdf = await pdfDe(l, new Date(0))
      const c = await doChrome(html), p = doPdf(pdf)
      expect(c.imgs.length).toBe(l.paginas.length); expect(p.imgs.length).toBe(l.paginas.length)
      expect(c.palavras.length).toBeGreaterThan(20)
      expect(pior(c.palavras, p.palavras)).toBeLessThanOrEqual(1)
      for (let i = 0; i < c.imgs.length; i++) { const d = diferenca(c.imgs[i]!, p.imgs[i]!); expect(d.medio).toBeLessThan(2.5); expect(d.ruins).toBeLessThan(0.004) }
      if (process.env.PARIDADE_SALVA) for (let i = 0; i < c.imgs.length; i++) { writeFileSync(join(process.env.PARIDADE_SALVA, `${nome.replace(/\W+/g, '-')}-${i + 1}-chrome.png`), c.imgs[i]!); writeFileSync(join(process.env.PARIDADE_SALVA, `${nome.replace(/\W+/g, '-')}-${i + 1}-pdf.png`), p.imgs[i]!) }
    })
  }

  it('o detector enxerga defeitos: 1,5 pt de deslocamento, cor trocada e texto trocado são reprovados', async () => {
    const l = layout(resolve(NO_PEDIDO.spec, DADOS_PEDIDO)), pdf = await pdfDe(l, new Date(0)), p = doPdf(pdf)
    const mutado = (f: (t: typeof l) => void) => { const m = structuredClone(l); f(m); return m }
    const desloca = mutado((m) => { for (const o of m.paginas[0]!.ops) if (o.tipo === 'texto') o.x += 1.5 })
    const cor = mutado((m) => { for (const o of m.paginas[0]!.ops) if (o.tipo === 'ret') o.cor = [255, 0, 0] })
    const txt = mutado((m) => { const o = m.paginas[0]!.ops.find((x) => x.tipo === 'texto'); if (o?.tipo === 'texto') o.texto = 'XXXX' })
    expect(pior((await doChrome(htmlDe(l))).palavras, p.palavras)).toBeLessThanOrEqual(1)
    expect(pior((await doChrome(htmlDe(desloca))).palavras, p.palavras)).toBeGreaterThan(1)
    const c = await doChrome(htmlDe(cor)); const dc = diferenca(c.imgs[0]!, p.imgs[0]!); expect(dc.medio > 2.5 || dc.ruins >= 0.004).toBe(true)
    expect(pior((await doChrome(htmlDe(txt))).palavras, p.palavras)).toBe(Infinity)
  })

  it('o PDF embarca a fonte (Roboto) e o HTML a declara', async () => {
    const r = await geraDocumento(NO_OS, DADOS_OS, { agora: new Date(0) }); const f = join(tmp, 'f.pdf'); writeFileSync(f, r.pdf)
    expect(execFileSync('pdffonts', [f], { encoding: 'utf8' })).toMatch(/Roboto.*yes/)
    expect(r.html).toContain('@font-face')
  })
})
