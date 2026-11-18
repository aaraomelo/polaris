import type { Kernel, No, Tipo } from './ir'

// Emissor GLSL ES 3.00: o kernel vira um passe de FRAGMENTO sobre texturas (GPGPU em WebGL2). Um pixel = um elemento i = y*W + x. Entradas lista → textura R32F; escalares → uniforms;
// saídas (até 4) → canais do RGBA32F. Inteiros e booleanos trafegam como float (exatos até 2^24: limite da textura, documentado em docs/computacao.md).
// `PipelineGl` é JSON puro: vai do servidor/AOT ao navegador sem carregar o parser nem o IR.

export type PipelineGl = {
  vs: string; fs: string
  escalares: Array<{ nome: string; tipo: Tipo }>
  vetores: Array<{ nome: string; tipo: Tipo }>
  saidas: Array<{ nome: string; tipo: Tipo }>
}

const flt = (v: number): string => { const s = String(v); return /[.eEn]/.test(s) ? s : `${s}.0` }
function c(no: No, para: Tipo): string { const s = g(no); return para === 'f32' && no.tipo === 'i32' ? (no.k === 'lit' ? flt(no.v) : `float(${s})`) : s }
function g(no: No): string {
  switch (no.k) {
    case 'lit': return no.tipo === 'bool' ? (no.v ? 'true' : 'false') : no.tipo === 'f32' ? (no.v < 0 || Object.is(no.v, -0) ? `(${flt(no.v)})` : flt(no.v)) : no.v < 0 ? `(${no.v})` : String(no.v)
    case 'ref': return no.cls === 'i' ? 'i' : no.cls === 'n' ? 'uN' : no.cls === 'x' ? 'x' : no.cls === 'y' ? 'y' : no.cls === 'escalar' ? `s_${no.nome}` : no.cls === 'local' ? `l_${no.nome}` : `v_${no.nome}`
    case 'un': return no.op === 'nao' ? `(!${g(no.x)})` : `(-${g(no.x)})`
    case 'bin': {
      if (no.op === '&&' || no.op === '||') return `(${g(no.a)} ${no.op} ${g(no.b)})`
      const bool = no.a.tipo === 'bool', t: Tipo = no.a.tipo === 'f32' || no.b.tipo === 'f32' || no.op === '/' ? 'f32' : 'i32'
      return `(${bool ? g(no.a) : c(no.a, t)} ${no.op} ${bool ? g(no.b) : c(no.b, t)})`
    }
    case 'sel': return no.tipo === 'bool' ? `(${g(no.c)} ? ${g(no.a)} : ${g(no.b)})` : `(${g(no.c)} ? ${c(no.a, no.tipo)} : ${c(no.b, no.tipo)})`
    case 'fn': {
      if (no.nome === 'i32') return no.args[0]!.tipo === 'i32' ? g(no.args[0]!) : `i32sat(${g(no.args[0]!)})`
      const a = no.args.map((x) => c(x, 'f32'))
      return no.nome === 'f32' ? a[0]! : `${no.nome}(${a.join(', ')})`
    }
  }
}
const tgl = (t: Tipo) => (t === 'f32' ? 'float' : t === 'i32' ? 'int' : 'bool')
const leitura = (t: Tipo, nome: string) => { const f = `texelFetch(t_${nome}, ivec2(i % uW, i / uW), 0).r`; return t === 'f32' ? f : t === 'i32' ? `int(${f})` : `(${f} != 0.0)` }
const aFloat = (t: Tipo, e: string) => (t === 'f32' ? e : t === 'i32' ? `float(${e})` : `(${e} ? 1.0 : 0.0)`)

export function emiteGlsl(k: Kernel): PipelineGl {
  if (k.saidas.length > 4) throw new Error('GLSL: no máximo 4 saídas (RGBA)')
  const esc = k.entradas.filter((p) => !p.vetor), vet = k.entradas.filter((p) => p.vetor)
  const fs = [
    '#version 300 es', 'precision highp float;', 'precision highp int;', 'precision highp sampler2D;',
    'uniform int uN;', 'uniform int uW;',
    ...esc.map((p) => `uniform ${tgl(p.tipo)} s_${p.nome};`), ...vet.map((p) => `uniform sampler2D t_${p.nome};`),
    'out vec4 o;',
    'int i32sat(float x) { if (x != x) return 0; if (x >= 2147483648.0) return 2147483647; return int(clamp(x, -2147483648.0, 2147483520.0)); }',
    'void main() {',
    '  ivec2 p = ivec2(gl_FragCoord.xy);', '  int i = p.y * uW + p.x;', '  if (i >= uN) { o = vec4(0.0); return; }',
    ...(k.larguraDe ? [`  int x = i % max(s_${k.larguraDe}, 1);`, `  int y = i / max(s_${k.larguraDe}, 1);`] : []),
    ...vet.map((p) => `  ${tgl(p.tipo)} v_${p.nome} = ${leitura(p.tipo, p.nome)};`),
    ...k.locais.map((l) => `  ${tgl(l.tipo)} l_${l.nome} = ${g(l.expr)};`),
    `  o = vec4(${[...k.saidas.map((s) => aFloat(s.tipo, g(s.expr))), '0.0', '0.0', '0.0'].slice(0, 4).join(', ')});`,
    '}',
  ].join('\n')
  const vs = ['#version 300 es', 'void main() {', '  vec2 p = vec2((gl_VertexID << 1) & 2, gl_VertexID & 2);', '  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);', '}'].join('\n')
  return { vs, fs, escalares: esc.map(({ nome, tipo }) => ({ nome, tipo })), vetores: vet.map(({ nome, tipo }) => ({ nome, tipo })), saidas: k.saidas.map(({ nome, tipo }) => ({ nome, tipo })) }
}
