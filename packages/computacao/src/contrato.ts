import { KernelErro } from './erro'
import type { Kernel, No, Tipo } from './ir'

// Contrato comum a TODOS os alvos: o que entra, o que sai, e o que se confere ANTES de executar. Entrada f32 é arredondada para f32 na porta (todos os alvos veem os mesmos bits).
export type Valor = number | boolean
export type Entradas = Record<string, Valor | ArrayLike<Valor>>
export type Saidas = Record<string, Float32Array | Int32Array>
export type Preparado = { n: number; escalares: Record<string, number>; vetores: Record<string, Float32Array | Int32Array> }

export const ArrayDe = (t: Tipo) => (t === 'f32' ? Float32Array : Int32Array)
const f32 = Math.fround

/** converte um f32 ou i32 para o tipo de destino da promoção (i32 → f32 arredonda, como `f32.convert_i32_s`) */
export const sat = (x: number): number => (Number.isNaN(x) ? 0 : x >= 2147483647 ? 2147483647 : x <= -2147483648 ? -2147483648 : Math.trunc(x) | 0)

/** Interpretador de referência de UM nó (o oráculo). Bool = 0|1. */
export function avaliaNo(no: No, env: { escalar: Record<string, number>; vetor: Record<string, ArrayLike<number>>; local: Record<string, number>; i: number; n: number; x?: number; y?: number }): number {
  const c = (x: No, para: Tipo): number => { const v = avaliaNo(x, env); return para === 'f32' && x.tipo === 'i32' ? f32(v) : v }
  switch (no.k) {
    case 'lit': return no.v
    case 'ref': return no.cls === 'i' ? env.i : no.cls === 'n' ? env.n : no.cls === 'x' ? env.x! : no.cls === 'y' ? env.y! : no.cls === 'escalar' ? env.escalar[no.nome]! : no.cls === 'local' ? env.local[no.nome]! : env.vetor[no.nome]![env.i]!
    case 'un': { const x = avaliaNo(no.x, env); return no.op === 'nao' ? (x ? 0 : 1) : no.tipo === 'f32' ? -x : (-x) | 0 }
    case 'bin': {
      const num = no.a.tipo !== 'bool' && no.b.tipo !== 'bool'
      const t: Tipo = no.a.tipo === 'f32' || no.b.tipo === 'f32' || no.op === '/' ? 'f32' : 'i32'
      if (no.op === '&&') return avaliaNo(no.a, env) && avaliaNo(no.b, env) ? 1 : 0
      if (no.op === '||') return avaliaNo(no.a, env) || avaliaNo(no.b, env) ? 1 : 0
      const a = num ? c(no.a, t) : avaliaNo(no.a, env), b = num ? c(no.b, t) : avaliaNo(no.b, env)
      switch (no.op) {
        case '<': return a < b ? 1 : 0
        case '<=': return a <= b ? 1 : 0
        case '>': return a > b ? 1 : 0
        case '>=': return a >= b ? 1 : 0
        case '==': return a === b ? 1 : 0
        case '!=': return a !== b ? 1 : 0
        case '+': return t === 'f32' ? f32(a + b) : (a + b) | 0
        case '-': return t === 'f32' ? f32(a - b) : (a - b) | 0
        case '*': return t === 'f32' ? f32(a * b) : Math.imul(a, b)
        default: return f32(a / b)
      }
    }
    case 'sel': { const cond = avaliaNo(no.c, env), a = no.tipo === 'bool' ? avaliaNo(no.a, env) : c(no.a, no.tipo), b = no.tipo === 'bool' ? avaliaNo(no.b, env) : c(no.b, no.tipo); return cond ? a : b }
    case 'fn': {
      const a = no.args.map((x) => (no.nome === 'i32' ? avaliaNo(x, env) : c(x, 'f32')))
      switch (no.nome) {
        case 'min': return Math.min(a[0]!, a[1]!)
        case 'max': return Math.max(a[0]!, a[1]!)
        case 'abs': return Math.abs(a[0]!)
        case 'sqrt': return f32(Math.sqrt(a[0]!))
        case 'floor': return Math.floor(a[0]!)
        case 'ceil': return Math.ceil(a[0]!)
        case 'f32': return f32(a[0]!)
        default: return sat(a[0]!)
      }
    }
  }
}

/** confere e normaliza as entradas; confere as restrições. Qualquer violação é `KernelErro` ANTES de qualquer alvo executar. */
export function preparaEntradas(k: Kernel, entradas: Entradas, n: number): Preparado {
  if (!Number.isInteger(n) || n < 0) throw new KernelErro(`n inválido: ${String(n)}`)
  if (n > k.maxElementos) throw new KernelErro(`n=${n} acima do limite do kernel (${k.maxElementos})`)
  for (const nome of Object.keys(entradas)) if (!k.entradas.some((p) => p.nome === nome)) throw new KernelErro(`entrada desconhecida: ${nome}`)
  const escalares: Record<string, number> = {}, vetores: Preparado['vetores'] = {}
  for (const p of k.entradas) {
    const v = Object.hasOwn(entradas, p.nome) ? entradas[p.nome] : undefined
    if (v === undefined) throw new KernelErro(`falta a entrada ${p.nome}`)
    const conv = (x: Valor): number => {
      if (p.tipo === 'bool') { if (typeof x !== 'boolean') throw new KernelErro(`${p.nome}: booleano esperado`); return x ? 1 : 0 }
      if (typeof x !== 'number' || !Number.isFinite(x)) throw new KernelErro(`${p.nome}: número finito esperado`)
      if (p.tipo === 'i32') { if (!Number.isInteger(x) || x > 2147483647 || x < -2147483648) throw new KernelErro(`${p.nome}: inteiro de 32 bits esperado`); return x }
      const f = f32(x); if (!Number.isFinite(f)) throw new KernelErro(`${p.nome}: fora da faixa de f32`); return f
    }
    if (p.vetor) {
      if (typeof v === 'number' || typeof v === 'boolean' || (v as ArrayLike<Valor>).length !== n) throw new KernelErro(`${p.nome}: lista de ${n} elementos esperada`)
      const a = new (ArrayDe(p.tipo))(n); for (let j = 0; j < n; j++) a[j] = conv((v as ArrayLike<Valor>)[j]!)
      vetores[p.nome] = a
    } else {
      if (typeof v === 'object') throw new KernelErro(`${p.nome}: valor único esperado`)
      escalares[p.nome] = conv(v as Valor)
    }
  }
  const env = { escalar: escalares, vetor: {}, local: {}, i: 0, n }
  k.restricoes.forEach((r, j) => { if (!avaliaNo(r, env)) throw new KernelErro(`restrição ${j + 1} violada`, 'restricoes') })
  return { n, escalares, vetores }
}
