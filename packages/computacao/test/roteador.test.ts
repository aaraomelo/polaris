import { describe, expect, it } from 'vitest'
import { compilaKernel, escolheAlvo, SemAlvoErro } from '../src'

const base = { entradas: { x: { tipo: 'decimal', lista: true } }, saidas: { r: { tipo: 'decimal', lista: true } }, corpo: { saidas: { r: 'x * 2 + 1 - x / 3 + sqrt(abs(x)) * x - min(x, 2) + max(x, 3) * 2 - x * x + x' } }, dominio: { maxElementos: 16777216 } } as const
const exato = compilaKernel('e', base as any)
const tol = compilaKernel('t', { ...base, tolerancia: { relativa: 1e-5 } } as any)
const todas = { js: true, wasm: true, webgl: { maxTextura: 4096 }, ptx: true }

describe('roteador', () => {
  it('kernel exato nunca vai para WebGL, mesmo sendo o mais barato', () => {
    const d = escolheAlvo(exato, 5_000_000, todas); expect(d.alvo).not.toBe('webgl'); expect(d.candidatos.find((c) => c.alvo === 'webgl')!.motivo).toMatch(/tolerância/)
  })
  it('custo: poucos elementos → js; muitos → wasm; muitíssimos com GPU → ptx; com tolerância e WebGL → webgl no meio', () => {
    expect(escolheAlvo(exato, 10, todas).alvo).toBe('js'); expect(escolheAlvo(exato, 5000, todas).alvo).toBe('wasm')
    expect(escolheAlvo(exato, 3_000_000, todas).alvo).toBe('ptx'); expect(escolheAlvo(exato, 3_000_000, { js: true, wasm: true }).alvo).toBe('wasm')
    expect(escolheAlvo(tol, 200_000, todas).alvo).toBe('webgl'); expect(escolheAlvo(tol, 10, todas).alvo).toBe('js')
  })
  it('capacidade: sem WebAssembly cai para js; sem nada, erro com o motivo de CADA alvo', () => {
    expect(escolheAlvo(exato, 5000, { js: true }).alvo).toBe('js')
    try { escolheAlvo(exato, 5, {}); throw new Error('devia falhar') } catch (e) { expect(e).toBeInstanceOf(SemAlvoErro); expect((e as SemAlvoErro).motivos).toMatchObject({ js: expect.any(String), wasm: expect.stringMatching(/WebAssembly/), webgl: expect.any(String), ptx: expect.stringMatching(/driver/) }) }
  })
  it('limites: n acima do limite do kernel é erro', () => {
    const lim = compilaKernel('l', { ...base, dominio: { maxElementos: 100 } } as any); expect(() => escolheAlvo(lim, 101, todas)).toThrow(/acima do limite/); expect(escolheAlvo(lim, 100, todas).alvo).toBe('wasm')
  })
  it('é determinístico e o empate vai para a ordem fixa (wasm antes de js)', () => {
    const a = escolheAlvo(exato, 777, todas), b = escolheAlvo(exato, 777, todas); expect(b).toEqual(a)
    const igual = { js: { fixo: 1, porElemento: 1, porNo: 0 }, wasm: { fixo: 1, porElemento: 1, porNo: 0 }, webgl: { fixo: 9e9, porElemento: 1, porNo: 0 }, ptx: { fixo: 9e9, porElemento: 1, porNo: 0 } }
    expect(escolheAlvo(exato, 10, todas, igual).alvo).toBe('wasm')
  })
  it('kernel com inteiro em lista ou saída: WebGL fora (float exato só até 2^24)', () => {
    const ki = compilaKernel('i', { entradas: { k: { tipo: 'inteiro', lista: true } }, saidas: { r: { tipo: 'inteiro', lista: true } }, corpo: { saidas: { r: 'k + 1' } }, tolerancia: { relativa: 1e-5 }, dominio: { maxElementos: 16777216 } } as any)
    expect(escolheAlvo(ki, 9_000_000, todas).candidatos.find((c) => c.alvo === 'webgl')!.motivo).toMatch(/2\^24/)
  })
  it('textura: n que não cabe tira o WebGL', () => {
    const d = escolheAlvo(tol, 9_000_000, { js: true, wasm: true, webgl: { maxTextura: 2048 } }); expect(d.candidatos.find((c) => c.alvo === 'webgl')!.motivo).toMatch(/não cabe/)
  })
})
