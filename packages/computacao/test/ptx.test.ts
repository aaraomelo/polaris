import { describe, expect, it } from 'vitest'
import { compilaKernel, emitePtx, executaInterpretado, executaPtx, executaPtxMock } from '../src'
import { geraKernel } from './gera'

const igual = (a: ArrayLike<number>, b: ArrayLike<number>) => a.length === b.length && Array.from(a).every((v, i) => Object.is(v, b[i]))

describe('alvo ptx', () => {
  const saxpy = compilaKernel('saxpy-v1', { entradas: { a: { tipo: 'decimal' }, x: { tipo: 'decimal', lista: true }, y: { tipo: 'decimal', lista: true } }, saidas: { r: { tipo: 'decimal', lista: true } }, corpo: { locais: [{ nome: 't', valor: 'a * x' }], saidas: { r: 't + y' } } })
  it('o texto PTX tem a forma esperada: cabeçalho, entrada, parâmetros, guarda i<n e rounding explícito', () => {
    const t = emitePtx(saxpy)
    expect(t).toMatch(/^\/\/ gerado/); expect(t).toContain('.version 7.0'); expect(t).toContain('.target sm_50'); expect(t).toContain('.address_size 64')
    expect(t).toContain('.visible .entry polaris_saxpy_v1(')
    expect(t).toMatch(/\.param \.u32 p_n,\n\s+\.param \.f32 p_s_a,\n\s+\.param \.u64 p_v_x,\n\s+\.param \.u64 p_v_y,\n\s+\.param \.u64 p_o_r\n\)/)
    expect(t).toMatch(/setp\.ge\.s32 %p\d+, %r\d+, %r\d+;\n\s+@%p\d+ bra DONE;/); expect(t).toContain('mul.rn.f32'); expect(t).toContain('add.rn.f32'); expect(t).not.toMatch(/fma|\.approx|\.ftz/)
    expect(t.trimEnd().endsWith('}')).toBe(true); expect(t).toMatch(/DONE:\n\s+ret;/)
  })
  it('o interpretador do mock rejeita o que não conhece e valida a entrada', () => {
    const t = emitePtx(saxpy)
    expect(() => executaPtxMock(t, 'outra', { n: 1, escalares: [1], ponteiros: [0, 0, 0], memoria: new ArrayBuffer(64) })).toThrow(/não existe/)
    expect(() => executaPtxMock(t.replace('add.rn.f32', 'tex.1d.f32'), 'polaris_saxpy_v1', { n: 1, escalares: [1], ponteiros: [16, 32, 48], memoria: new ArrayBuffer(64) })).toThrow(/fora do subconjunto/)
    expect(() => executaPtx(saxpy, t, { a: 1, x: [1], y: [1, 2] }, 2)).toThrow(/lista de 2/)
  })
  it('n=0 e n que não é múltiplo do bloco: nenhuma escrita fora dos n elementos', () => {
    expect(executaPtx(saxpy, emitePtx(saxpy), { a: 1, x: [], y: [] }, 0).r!.length).toBe(0)
    const n = 300, e = { a: 2, x: Array.from({ length: n }, (_, i) => i), y: Array.from({ length: n }, () => 1) }
    const r = executaPtx(saxpy, emitePtx(saxpy), e, n).r!; expect(r[299]).toBe(599); expect(r[256]).toBe(513)
  })
  it('FUZZ: ptx (mock) ≡ oráculo js, bit a bit (400 kernels × 3 tamanhos)', () => {
    for (let s = 1; s <= 400; s++) {
      const g = geraKernel(s), k = compilaKernel(`g${s}`, g.spec), ptx = emitePtx(k)
      for (const n of [0, 1, 37]) { const e = g.entradas(n) as any, a = executaInterpretado(k, e, n), b = executaPtx(k, ptx, e, n); for (const nome of Object.keys(a)) expect(igual(a[nome]!, b[nome]!), `kernel ${s} saída ${nome} n=${n}: ${JSON.stringify(g.spec.corpo)}`).toBe(true) }
    }
  })
  it('bordas: NaN != x é verdadeiro; i32() satura; subnormal e -0', () => {
    const k = compilaKernel('b', { entradas: { a: { tipo: 'decimal', lista: true } }, saidas: { ne: { tipo: 'booleano', lista: true }, s: { tipo: 'inteiro', lista: true }, r: { tipo: 'decimal', lista: true } }, corpo: { locais: [{ nome: 'z', valor: 'sqrt(a - 1) ' }], saidas: { ne: 'z != z', s: 'i32(a * 3000000000.5)', r: 'a * 1e-30 * 1e-30' } } })
    const e = { a: [0, 2, -3, 1e-20] }, a = executaInterpretado(k, e, 4), b = executaPtx(k, emitePtx(k), e, 4)
    for (const nome of ['ne', 's', 'r']) expect(igual(a[nome]!, b[nome]!), nome).toBe(true)
    expect(Array.from(a.ne!)).toEqual([1, 0, 1, 1])
  })
})
