import { existsSync } from 'node:fs'
import { build } from 'esbuild'
import { chromium, type Browser, type Page } from 'playwright-core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { artefatoCliente, compilaKernel, emiteGlsl, renderiza } from '../src'

const CHROME = process.env.CHROME ?? ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find(existsSync)
const k = compilaKernel('gradiente', { entradas: { w: { tipo: 'inteiro' }, t: { tipo: 'decimal' } }, saidas: { r: { tipo: 'decimal', lista: true }, g: { tipo: 'decimal', lista: true }, b: { tipo: 'decimal', lista: true } }, dominio: { larguraDe: 'w' }, restricoes: ['w > 0'],
  corpo: { locais: [{ nome: 'u', valor: 'f32(x) / f32(w)' }, { nome: 'v', valor: 'f32(y) / f32(w)' }], saidas: { r: 'u', g: 'v', b: 'u > v ? t : 1 - t' } } })
const ART = artefatoCliente('gradiente', k, emiteGlsl(k))
let nav: Browser, js = ''
beforeAll(async () => {
  if (!CHROME) return
  js = (await build({ entryPoints: [new URL('../src/cliente.ts', import.meta.url).pathname], bundle: true, format: 'iife', globalName: 'PolarisCliente', write: false })).outputFiles[0]!.text
  nav = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] })
})
afterAll(async () => { await nav?.close() })

const HTML = `<!doctype html><meta charset=utf-8><body><canvas id=a width=16 height=16 role=img aria-label="Gradiente" data-polaris-kernel="gradiente" data-polaris-entradas='{"t":0.25}'>Gradiente</canvas><canvas id=b width=8 height=8 data-polaris-kernel="ausente" data-polaris-entradas="{}">sem kernel</canvas><canvas id=c width=8 height=8 data-polaris-kernel="gradiente" data-polaris-entradas='{"t":"x"}'>ruim</canvas></body>`
async function pagina(csp?: string): Promise<Page> {
  const pg = await nav.newPage()
  await pg.route('http://polaris.test/**', (r) => {
    const u = new URL(r.request().url())
    if (u.pathname === '/kernels/gradiente.json') return r.fulfill({ json: ART })
    if (u.pathname === '/') return r.fulfill({ body: HTML, contentType: 'text/html', headers: csp ? { 'content-security-policy': csp } : {} })
    return r.fulfill({ status: 404, body: '' })
  })
  await pg.goto('http://polaris.test/'); return pg
}
const pixels = (pg: Page, id: string) => pg.evaluate((i) => Array.from((document.getElementById(i) as HTMLCanvasElement).getContext('2d')!.getImageData(0, 0, 16, 16).data), id)

describe.skipIf(!CHROME)('canvas-gl no navegador', () => {
  it('as três vias dão a mesma imagem (wasm ≡ interpretador exato; webgl2 a ±1/255)', async () => {
    const pg = await pagina(); await pg.addScriptTag({ content: js })
    const via = (v: string) => pg.evaluate(async ([a, vv]) => Array.from((await (window as any).PolarisCliente.renderiza(a, 16, 16, { t: 0.25 }, { via: [vv] })).rgba), [ART, v] as const) as Promise<number[]>
    const gl = await via('webgl2'), wasm = await via('wasm'), interp = await via('interpretador')
    expect(wasm).toEqual(interp); expect(gl.length).toBe(wasm.length)
    expect(Math.max(...gl.map((v, i) => Math.abs(v - wasm[i]!)))).toBeLessThanOrEqual(1)
    const node = (await renderiza(ART, 16, 16, { t: 0.25 }, { via: ['interpretador'] })).rgba; expect(Array.from(node)).toEqual(interp) // Node ≡ navegador
    expect(new Set(interp).size).toBeGreaterThan(8) // não é uma imagem chapada
    await pg.close()
  })
  it('montaCanvases: pinta o canvas, registra a via e isola os erros (artefato ausente, entrada inválida)', async () => {
    const pg = await pagina(); await pg.addScriptTag({ content: js })
    const r = await pg.evaluate(() => (window as any).PolarisCliente.montaCanvases(document))
    expect(r[0]).toMatchObject({ id: 'gradiente', via: 'webgl2' }); expect(r[1].erro).toMatch(/indisponível/); expect(r[2].erro).toMatch(/número finito/)
    expect(await pg.evaluate(() => document.getElementById('a')!.getAttribute('data-polaris-via'))).toBe('webgl2')
    expect(await pg.evaluate(() => document.getElementById('b')!.hasAttribute('data-polaris-erro'))).toBe(true)
    const a = await pixels(pg, 'a'); const ref = Array.from((await renderiza(ART, 16, 16, { t: 0.25 }, { via: ['interpretador'] })).rgba)
    expect(Math.max(...a.map((v, i) => Math.abs(v - ref[i]!)))).toBeLessThanOrEqual(1)
    expect((await pixels(pg, 'b')).every((v) => v === 0)).toBe(true) // o canvas com erro continua vazio (texto alternativo)
    await pg.close()
  })
  it('sem WebGL2: cai para wasm; com CSP estrita (sem eval e sem wasm-unsafe-eval): cai para o interpretador, sem violar a CSP', async () => {
    const pg = await pagina(); await pg.addScriptTag({ content: js })
    expect(await pg.evaluate(async () => { const g = HTMLCanvasElement.prototype.getContext; HTMLCanvasElement.prototype.getContext = function (this: HTMLCanvasElement, id: string, ...r: any[]) { return id === 'webgl2' ? null : (g as any).call(this, id, ...r) } as any; const r = await (window as any).PolarisCliente.montaCanvases(document); HTMLCanvasElement.prototype.getContext = g; return r[0].via })).toBe('wasm')
    await pg.close()
    const csp = await pagina("default-src 'none'; script-src 'unsafe-inline'; connect-src 'self'; img-src data:"); const viol: string[] = []
    csp.on('console', (m) => { if (/Content Security Policy|unsafe-eval|wasm/i.test(m.text())) viol.push(m.text()) }); await csp.addScriptTag({ content: js })
    const r = await csp.evaluate(() => (window as any).PolarisCliente.montaCanvases(document, { via: ['wasm', 'interpretador'] }))
    expect(r[0].via).toBe('interpretador'); expect((await pixels(csp, 'a')).some((v) => v > 0)).toBe(true)
    await csp.close()
  })
})
