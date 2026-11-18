import { existsSync } from 'node:fs'
import { build } from 'esbuild'
import { chromium, type Browser, type Page } from 'playwright-core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { compilaKernel, emiteGlsl, executaInterpretado, preparaEntradas } from '../src'
import { geraKernel } from './gera'

// WebGL2 de verdade: Chrome (SwiftShader quando não há GPU). A tolerância é a do kernel (a GPU pode fundir/flush); o oráculo é o interpretador js.
const CHROME = process.env.CHROME ?? ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find(existsSync)
let nav: Browser, pg: Page, temGl = false
beforeAll(async () => {
  if (!CHROME) return
  const js = (await build({ entryPoints: [new URL('../src/webgl.ts', import.meta.url).pathname], bundle: true, format: 'iife', globalName: 'PolarisGl', write: false })).outputFiles[0]!.text
  nav = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] })
  pg = await nav.newPage(); await pg.setContent('<canvas id=c></canvas>'); await pg.addScriptTag({ content: js })
  temGl = await pg.evaluate(() => { const gl = (window as any).PolarisGl.contextoGl(document.getElementById('c')); (window as any).gl = gl; return gl !== null })
})
afterAll(async () => { await nav?.close() })

async function roda(pipe: unknown, prep: unknown, n: number): Promise<Record<string, number[]>> {
  return pg.evaluate(([p, e, nn]) => { const r = (window as any).PolarisGl.executaGl((window as any).gl, p, e, nn); return Object.fromEntries(Object.entries(r).map(([k, v]) => [k, Array.from(v as ArrayLike<number>)])) }, [pipe, prep, n] as const) as Promise<Record<string, number[]>>
}
const prepara = (k: ReturnType<typeof compilaKernel>, e: any, n: number) => { const p = preparaEntradas(k, e, n); return { escalares: p.escalares, vetores: Object.fromEntries(Object.entries(p.vetores).map(([a, v]) => [a, Array.from(v)])) } }

describe.skipIf(!CHROME)('alvo glsl (WebGL2 no Chrome)', () => {
  it('há WebGL2 com render em float (senão este alvo não é verificável aqui)', () => { expect(temGl).toBe(true) })
  it('saxpy: o shader dá o resultado do oráculo', async () => {
    const k = compilaKernel('saxpy', { entradas: { a: { tipo: 'decimal' }, x: { tipo: 'decimal', lista: true }, y: { tipo: 'decimal', lista: true } }, saidas: { r: { tipo: 'decimal', lista: true } }, corpo: { locais: [{ nome: 't', valor: 'a * x' }], saidas: { r: 't + y' } } })
    const e = { a: 2.5, x: [1, 2, 3, 4, 5, 6, 7], y: [0.5, 0.25, 1, 2, 3, 4, 5] }
    const r = await roda(emiteGlsl(k), prepara(k, e, 7), 7); expect(r.r).toEqual(Array.from(executaInterpretado(k, e, 7).r!))
  })
  it('i32(): trunca para zero e SATURA (a GPU não tem comportamento definido fora da faixa; o shader o define)', async () => {
    const k = compilaKernel('sat', { entradas: { a: { tipo: 'decimal', lista: true } }, saidas: { alto: { tipo: 'booleano', lista: true }, baixo: { tipo: 'booleano', lista: true }, t: { tipo: 'inteiro', lista: true } }, corpo: { saidas: { alto: 'i32(a * 10000000000.5) > 2000000000', baixo: 'i32(a * 10000000000.5) < -2000000000', t: 'i32(a)' } } })
    const e = { a: [1, -1, 0.5, 2.9, -2.9] }, ref = executaInterpretado(k, e, 5), r = await roda(emiteGlsl(k), prepara(k, e, 5), 5)
    expect(Array.from(ref.alto!)).toEqual([1, 0, 1, 1, 0]); expect(Array.from(ref.baixo!)).toEqual([0, 1, 0, 0, 1])
    for (const nome of ['alto', 'baixo', 't']) expect(r[nome]).toEqual(Array.from(ref[nome]!))
  })
  it('FUZZ: glsl ≈ oráculo dentro da tolerância (150 kernels; tamanhos 1, 37 e 1000)', async () => {
    let comparados = 0
    for (let s = 1; s <= 150; s++) {
      const g = geraKernel(s), k = compilaKernel(`g${s}`, g.spec), pipe = emiteGlsl(k)
      for (const n of [1, 37, 1000]) {
        const e = g.entradas(n) as any, ref = executaInterpretado(k, e, n), r = await roda(pipe, prepara(k, e, n), n)
        for (const nome of Object.keys(ref)) {
          const tipo = k.saidas.find((x) => x.nome === nome)!.tipo
          ref[nome]!.forEach((v, i) => {
            const got = r[nome]![i]!
            if (tipo === 'f32') { const tol = k.tolerancia.relativa * Math.max(g.mag, Math.abs(v)) + 1e-30; if (!(Math.abs(got - v) <= tol)) throw new Error(`kernel ${s} ${nome}[${i}] n=${n}: glsl=${got} ref=${v} (${JSON.stringify(g.spec.corpo)})`) } else if (got !== v) throw new Error(`kernel ${s} ${nome}[${i}] n=${n}: glsl=${got} ref=${v} (${JSON.stringify(g.spec.corpo)})`)
            comparados++
          })
        }
      }
    }
    expect(comparados).toBeGreaterThan(10_000)
  })
})
