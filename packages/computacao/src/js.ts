import { ArrayDe, avaliaNo, preparaEntradas, type Entradas, type Saidas } from './contrato'
import type { Kernel, No, Tipo } from './ir'

/** ORÁCULO: o interpretador de referência executa o IR nó a nó. Lento e óbvio; todos os alvos são comparados com ele. */
export function executaInterpretado(k: Kernel, entradas: Entradas, n: number): Saidas {
  const { escalares, vetores } = preparaEntradas(k, entradas, n)
  const out: Saidas = {}; for (const s of k.saidas) out[s.nome] = new (ArrayDe(s.tipo))(n)
  const env = { escalar: escalares, vetor: vetores, local: {} as Record<string, number>, i: 0, n, x: 0, y: 0 }
  const W = k.larguraDe ? Math.max(escalares[k.larguraDe]!, 1) : 1
  for (let i = 0; i < n; i++) {
    env.i = i; env.x = i % W; env.y = Math.floor(i / W)
    for (const l of k.locais) env.local[l.nome] = avaliaNo(l.expr, env)
    for (const s of k.saidas) out[s.nome]![i] = avaliaNo(s.expr, env)
  }
  return out
}

// ---- emissor JS (compilado): o mesmo IR vira uma função; todo identificador e número é GERADO daqui (nada do texto do autor entra no código) ----
const num = (v: number) => (Object.is(v, -0) ? '-0' : String(v))
function c(no: No, para: Tipo): string { const s = g(no); return para === 'f32' && no.tipo === 'i32' ? `Math.fround(${s})` : s }
function g(no: No): string {
  switch (no.k) {
    case 'lit': return no.tipo === 'bool' ? (no.v ? 'true' : 'false') : no.v < 0 ? `(${num(no.v)})` : num(no.v)
    case 'ref': return no.cls === 'i' ? 'i' : no.cls === 'n' ? 'n' : no.cls === 'x' ? 'x' : no.cls === 'y' ? 'y' : no.cls === 'escalar' ? `s_${no.nome}` : no.cls === 'local' ? `l_${no.nome}` : `v_${no.nome}[i]`
    case 'un': return no.op === 'nao' ? `(!${g(no.x)})` : no.tipo === 'f32' ? `(-${g(no.x)})` : `((-${g(no.x)}) | 0)`
    case 'bin': {
      if (no.op === '&&' || no.op === '||') return `(${g(no.a)} ${no.op} ${g(no.b)})`
      const bool = no.a.tipo === 'bool'
      const t: Tipo = no.a.tipo === 'f32' || no.b.tipo === 'f32' || no.op === '/' ? 'f32' : 'i32'
      const a = bool ? g(no.a) : c(no.a, t), b = bool ? g(no.b) : c(no.b, t)
      if (no.op === '==' || no.op === '!=') return `(${a} ${no.op === '==' ? '===' : '!=='} ${b})`
      if (no.op === '<' || no.op === '<=' || no.op === '>' || no.op === '>=') return `(${a} ${no.op} ${b})`
      if (t === 'f32') return `Math.fround(${a} ${no.op} ${b})`
      return no.op === '*' ? `Math.imul(${a}, ${b})` : `((${a} ${no.op} ${b}) | 0)`
    }
    case 'sel': return no.tipo === 'bool' ? `(${g(no.c)} ? ${g(no.a)} : ${g(no.b)})` : `(${g(no.c)} ? ${c(no.a, no.tipo)} : ${c(no.b, no.tipo)})`
    case 'fn': {
      if (no.nome === 'i32') return `sat(${g(no.args[0]!)})`
      const a = no.args.map((x) => c(x, 'f32'))
      return no.nome === 'sqrt' ? `Math.fround(Math.sqrt(${a[0]}))` : no.nome === 'f32' ? `Math.fround(${a[0]})` : `Math.${no.nome}(${a.join(', ')})`
    }
  }
}
const guarda = (t: Tipo, e: string) => (t === 'bool' ? `(${e} ? 1 : 0)` : e)

/** Fonte da função `(n, escalares, vetores, saidas) => void`. Só para inspeção/teste; `compilaJs` a instancia. */
export function fonteJs(k: Kernel): string {
  const L = [
    ...k.entradas.filter((p) => !p.vetor).map((p) => `const s_${p.nome} = ${p.tipo === 'bool' ? `esc.${p.nome} !== 0` : `esc.${p.nome}`};`),
    ...k.entradas.filter((p) => p.vetor).map((p) => `const v_${p.nome} = vet.${p.nome};`),
    ...k.saidas.map((s) => `const o_${s.nome} = out.${s.nome};`),
    ...(k.larguraDe ? [`const W = Math.max(s_${k.larguraDe}, 1);`] : []),
    'for (let i = 0; i < n; i++) {',
    ...(k.larguraDe ? ['  const x = i % W, y = Math.floor(i / W);'] : []),
    ...k.locais.map((l) => `  const l_${l.nome} = ${g(l.expr)};`),
    ...k.saidas.map((s) => `  o_${s.nome}[i] = ${guarda(s.tipo, g(s.expr))};`),
    '}',
  ]
  return L.join('\n')
}
export function compilaJs(k: Kernel): (entradas: Entradas, n: number) => Saidas {
  // o corpo só contém identificadores s_/v_/l_/o_ + nomes validados pelo schema (^[a-z][A-Za-z0-9]*$) e números gerados
  const f = new Function('n', 'esc', 'vet', 'out', 'sat', fonteJs(k)) as (n: number, e: Record<string, number>, v: Record<string, ArrayLike<number>>, o: Saidas, sat: (x: number) => number) => void
  return (entradas, n) => {
    const p = preparaEntradas(k, entradas, n); const out: Saidas = {}; for (const s of k.saidas) out[s.nome] = new (ArrayDe(s.tipo))(n)
    f(n, p.escalares, p.vetores, out, satur); return out
  }
}
import { sat as satur } from './contrato'
