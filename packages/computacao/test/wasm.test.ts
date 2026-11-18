import { describe, expect, it } from 'vitest'
import { compilaKernel, compilaWasm, emiteWasm, executaInterpretado } from '../src'
import { geraKernel } from './gera'

const igual = (a: ArrayLike<number>, b: ArrayLike<number>) => a.length === b.length && Array.from(a).every((v, i) => Object.is(v, b[i]))

describe('alvo wasm', () => {
  it('o binário é um módulo válido (WebAssembly.validate) e exporta mem e run', async () => {
    const k = compilaKernel('k', { entradas: { a: { tipo: 'decimal', lista: true } }, saidas: { r: { tipo: 'decimal', lista: true } }, corpo: { saidas: { r: 'a * 2' } } })
    const b = emiteWasm(k); expect(WebAssembly.validate(b)).toBe(true)
    const m = await WebAssembly.compile(b as BufferSource); expect(WebAssembly.Module.exports(m).map((x) => x.name).sort()).toEqual(['mem', 'run'])
    expect(Array.from((await compilaWasm(k))({ a: [1.5, -2] }, 2).r!)).toEqual([3, -4])
  })
  it('n=0, vários tamanhos e a memória cresce e é reaproveitada', async () => {
    const k = compilaKernel('k', { entradas: { a: { tipo: 'inteiro', lista: true } }, saidas: { r: { tipo: 'inteiro', lista: true } }, corpo: { saidas: { r: 'a + i' } } })
    const f = await compilaWasm(k)
    expect(f({ a: [] }, 0).r!.length).toBe(0)
    for (const n of [1, 5, 100_000, 3, 300_000]) { const a = Array.from({ length: n }, (_, i) => i % 7); const r = f({ a }, n).r!; expect(r.length).toBe(n); expect(r[n - 1]).toBe((n - 1) % 7 + n - 1) }
  })
  it('FUZZ: wasm ≡ oráculo js, bit a bit (500 kernels × 3 tamanhos)', async () => {
    for (let s = 1; s <= 500; s++) {
      const g = geraKernel(s), k = compilaKernel(`g${s}`, g.spec), f = await compilaWasm(k)
      for (const n of [0, 1, 37]) { const e = g.entradas(n) as any, a = executaInterpretado(k, e, n), b = f(e, n); for (const nome of Object.keys(a)) expect(igual(a[nome]!, b[nome]!), `kernel ${s} saída ${nome} n=${n}: ${JSON.stringify(g.spec.corpo)}`).toBe(true) }
    }
  })
  it('valores de borda: f32 grande, subnormal, -0, i32 nos limites', async () => {
    const k = compilaKernel('k', { entradas: { a: { tipo: 'decimal', lista: true }, k: { tipo: 'inteiro', lista: true } }, saidas: { r: { tipo: 'decimal', lista: true }, s: { tipo: 'inteiro', lista: true }, t: { tipo: 'inteiro', lista: true } }, corpo: { saidas: { r: 'a * 3 - a / 7 + sqrt(abs(a))', s: 'k + k * 2', t: 'i32(a * 1000000000)' } } })
    const e = { a: [3e38, 1e-45, -0, 16777217, -1e30, 0.1], k: [2147483647, -2147483648, 0, 65536, -1, 7] }
    const a = executaInterpretado(k, e, 6), b = (await compilaWasm(k))(e, 6)
    for (const nome of ['r', 's', 't']) expect(igual(a[nome]!, b[nome]!), nome).toBe(true)
  })
})
