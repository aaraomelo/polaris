import { existsSync } from 'node:fs'
import { build } from 'esbuild'
import { chromium, type Browser, type Page } from 'playwright-core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { comparaSaidas, compilaJs, compilaKernel, compilaWasm, criaCompute, driverGpuMock, emiteGlsl, emitePtx, executaInterpretado, executaPtx, preparaEntradas, type Kernel } from '../src'
import { geraKernel } from './gera'

// PARIDADE ENTRE BACKENDS (E6): um corpus de kernels × tamanhos, rodado em js, wasm, ptx (mock) — que têm de ser IGUAIS bit a bit ao oráculo — e em glsl (Chrome/WebGL2), dentro da tolerância do kernel.
// No CI faltar Chrome é FALHA (variável CI), não pulo.
const CHROME = process.env.CHROME ?? ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find(existsSync)
let nav: Browser | undefined, pg: Page | undefined, temGl = false
beforeAll(async () => {
  if (!CHROME) return
  const js = (await build({ entryPoints: [new URL('../src/webgl.ts', import.meta.url).pathname], bundle: true, format: 'iife', globalName: 'PolarisGl', write: false })).outputFiles[0]!.text
  nav = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] })
  pg = await nav.newPage(); await pg.setContent('<canvas id=c></canvas>'); await pg.addScriptTag({ content: js })
  temGl = await pg.evaluate(() => { const gl = (window as any).PolarisGl.contextoGl(document.getElementById('c')); (window as any).gl = gl; return gl !== null })
})
afterAll(async () => { await nav?.close() })
const glsl = async (k: Kernel, e: any, n: number) => {
  const p = preparaEntradas(k, e, n), prep = { escalares: p.escalares, vetores: Object.fromEntries(Object.entries(p.vetores).map(([a, v]) => [a, Array.from(v)])) }
  const r = await pg!.evaluate(([pipe, pr, nn]) => { const o = (window as any).PolarisGl.executaGl((window as any).gl, pipe, pr, nn); return Object.fromEntries(Object.entries(o).map(([a, v]) => [a, Array.from(v as ArrayLike<number>)])) }, [emiteGlsl(k), prep, n] as const) as Record<string, number[]>
  return Object.fromEntries(k.saidas.map((s) => [s.nome, s.tipo === 'f32' ? Float32Array.from(r[s.nome]!) : Int32Array.from(r[s.nome]!)]))
}

const CORPUS: Array<[string, Kernel, (n: number) => any, number]> = [
  ['saxpy', compilaKernel('saxpy', { entradas: { a: { tipo: 'decimal' }, x: { tipo: 'decimal', lista: true }, y: { tipo: 'decimal', lista: true } }, saidas: { r: { tipo: 'decimal', lista: true } }, tolerancia: { relativa: 1e-6 }, corpo: { locais: [{ nome: 't', valor: 'a * x' }], saidas: { r: 't + y' } } }), (n) => ({ a: 0.7, x: Array.from({ length: n }, (_, i) => (i % 97) / 7), y: Array.from({ length: n }, (_, i) => 1 - (i % 13) / 5) }), 100],
  ['grade (x, y)', compilaKernel('grade', { entradas: { w: { tipo: 'inteiro' }, k: { tipo: 'decimal' } }, saidas: { r: { tipo: 'decimal', lista: true }, par: { tipo: 'booleano', lista: true } }, dominio: { larguraDe: 'w' }, tolerancia: { relativa: 1e-6 }, corpo: { saidas: { r: 'f32(x) * k + f32(y)', par: 'x > y && !(x == 3)' } } }), () => ({ w: 13, k: 0.3 }), 100],
  ['seleção e funções', compilaKernel('sel', { entradas: { a: { tipo: 'decimal', lista: true }, b: { tipo: 'decimal', lista: true } }, saidas: { m: { tipo: 'decimal', lista: true }, s: { tipo: 'decimal', lista: true } }, tolerancia: { relativa: 1e-6 }, corpo: { locais: [{ nome: 'd', valor: 'a - b' }], saidas: { m: 'd > 0 ? min(a, b) : max(a, b)', s: 'sqrt(abs(d)) + floor(a) - ceil(b)' } } }), (n) => ({ a: Array.from({ length: n }, (_, i) => Math.sin(i) * 50), b: Array.from({ length: n }, (_, i) => Math.cos(i * 3) * 50) }), 100],
]
const TAMANHOS = [0, 1, 255, 256, 257, 1000]
const EXATOS = (k: Kernel) => ({ js: compilaJs(k), ptx: (e: any, n: number) => executaPtx(k, emitePtx(k), e, n) })

describe('paridade entre backends', () => {
  it.runIf(!CHROME && Boolean(process.env.CI))('CI: o Chrome precisa estar instalado (alvo glsl)', () => { throw new Error('Chrome ausente: a paridade do glsl não pôde ser verificada') })

  for (const [nome, k, ent, escala] of CORPUS) {
    it(`${nome}: js, wasm e ptx idênticos ao oráculo em todos os tamanhos; glsl dentro da tolerância`, async () => {
      const wasm = await compilaWasm(k), ex = EXATOS(k)
      for (const n of TAMANHOS) {
        const e = ent(n), ref = executaInterpretado(k, e, n)
        for (const [alvo, f] of [['js', ex.js], ['wasm', wasm], ['ptx', ex.ptx]] as const) { const r = comparaSaidas({ ...k, tolerancia: { relativa: 0, absoluta: 0 } }, ref, f(e, n), escala); expect(r.ok, `${alvo} n=${n}: ${JSON.stringify(r.divergencias)}`).toBe(true) }
        if (CHROME && n > 0) { const r = comparaSaidas(k, ref, await glsl(k, e, n), escala); expect(r.ok, `glsl n=${n}: ${JSON.stringify(r.divergencias)}`).toBe(true) }
      }
    })
  }

  it('FUZZ unificado: 120 kernels aleatórios — js/wasm/ptx bit a bit, glsl na tolerância', async () => {
    let glComparados = 0
    for (let s = 1000; s < 1120; s++) {
      const g = geraKernel(s), k = compilaKernel(`f${s}`, g.spec), wasm = await compilaWasm(k), ex = EXATOS(k)
      for (const n of [1, 300]) {
        const e = g.entradas(n) as any, ref = executaInterpretado(k, e, n), exato = { ...k, tolerancia: { relativa: 0, absoluta: 0 } }
        for (const [alvo, r] of [['js', ex.js(e, n)], ['wasm', wasm(e, n)], ['ptx', ex.ptx(e, n)]] as const) { const c = comparaSaidas(exato, ref, r); expect(c.ok, `${alvo} kernel ${s} n=${n}: ${JSON.stringify(c.divergencias)} ${JSON.stringify(g.spec.corpo)}`).toBe(true) }
        if (CHROME) { const c = comparaSaidas(k, ref, await glsl(k, e, n), g.mag); expect(c.ok, `glsl kernel ${s} n=${n}: ${JSON.stringify(c.divergencias)} ${JSON.stringify(g.spec.corpo)}`).toBe(true); glComparados += c.comparados }
      }
    }
    if (CHROME) expect(glComparados).toBeGreaterThan(1000)
  })

  it('o serviço compute dá o resultado do oráculo por qualquer alvo que ele escolha', async () => {
    const c = criaCompute({ drivers: { ptx: driverGpuMock() } })
    for (const [, k, ent] of CORPUS) for (const n of [10, 5000]) { const e = ent(n), r = await c.submete({ tenant: 't', kernel: k, entradas: e, n }); expect(comparaSaidas({ ...k, tolerancia: { relativa: 0, absoluta: 0 } }, executaInterpretado(k, e, n), r.saidas).ok, r.alvo).toBe(true) }
  })

  it.skipIf(!CHROME)('o glsl realmente executa na GPU (ou SwiftShader): há WebGL2 com render em float', () => { expect(temGl).toBe(true) })

  describe('o comparador enxerga defeitos (senão a paridade não vale nada)', () => {
    const k = CORPUS[0]![1], e = CORPUS[0]![2](50), ref = executaInterpretado(k, e, 50)
    const exato = { ...k, tolerancia: { relativa: 0, absoluta: 0 } }
    const com = (f: (a: Float32Array) => void) => { const o = { r: Float32Array.from(ref.r!) }; f(o.r); return o }
    it('1 ulp de diferença reprova um kernel exato', () => {
      const um = com((a) => { a[7] = a[7]! + Math.abs(a[7]!) * 2 ** -23 }); expect(comparaSaidas(exato, ref, um).ok).toBe(false); expect(comparaSaidas(exato, ref, um).divergencias[0]).toMatchObject({ saida: 'r', indice: 7 })
    })
    it('-0 ≠ +0 e tamanho diferente reprovam; a tolerância aceita o pequeno e recusa o grande', () => {
      const z = com((a) => { a[3] = 0 }), zn = com((a) => { a[3] = -0 }); expect(comparaSaidas(exato, z, zn).ok).toBe(false)
      expect(comparaSaidas(exato, ref, { r: ref.r!.slice(1) }).ok).toBe(false)
      const pouco = com((a) => { a[7] = a[7]! * (1 + 1e-7) }), muito = com((a) => { a[7] = a[7]! * (1 + 1e-3) })
      expect(comparaSaidas(k, ref, pouco).ok).toBe(true); expect(comparaSaidas(k, ref, muito).ok).toBe(false)
    })
    it('NaN contra NaN é igual (nos dois modos) e NaN contra número não é', () => {
      const n = { r: Float32Array.of(NaN, 1) }, ok = { r: Float32Array.of(NaN, 1) }, ruim = { r: Float32Array.of(2, 1) }
      expect(comparaSaidas(k, n, ok).ok).toBe(true); expect(comparaSaidas(exato, n, ok).ok).toBe(true); expect(comparaSaidas(k, n, ruim).ok).toBe(false)
    })
    it('inteiros e booleanos são exatos mesmo com tolerância', () => {
      const g = CORPUS[1]![1], r = executaInterpretado(g, { w: 13, k: 0.3 }, 50), p = { ...r, par: Int32Array.from(r.par!) }; p.par[5] = p.par[5]! ? 0 : 1
      expect(comparaSaidas(g, r, p).ok).toBe(false)
    })
  })
})
