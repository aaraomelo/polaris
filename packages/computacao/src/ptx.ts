import type { Kernel, No, Tipo } from './ir'

// Emissor PTX 7.0 (sm_50): um thread por elemento, i = ctaid.x*ntid.x + tid.x, guarda i < n. Tudo é SSA de registradores novos (o ptxas aloca de verdade).
// Exatidão: add/sub/mul/div/sqrt com `.rn` (sem fusão em fma), cvt com rounding explícito, `setp.neu` para != (NaN != x é verdadeiro, como em IEEE e JS).
// Inteiros em registradores `.b32` (aceitos por instruções .s32/.u32). Assinatura do kernel: (n, ...escalares, ...ponteirosDeEntradaLista, ...ponteirosDeSaída).

const hexF = (v: number): string => { const b = new DataView(new ArrayBuffer(4)); b.setFloat32(0, v); return `0f${b.getUint32(0).toString(16).toUpperCase().padStart(8, '0')}` }
export const nomeEntrada = (id: string) => `polaris_${id.replace(/[^A-Za-z0-9_]/g, '_')}`
export const BLOCO = 256

export function emitePtx(k: Kernel): string {
  const cnt = { f: 0, r: 0, p: 0, d: 0 }
  const L: string[] = []
  const f = () => `%f${cnt.f++}`, r = () => `%r${cnt.r++}`, p = () => `%p${cnt.p++}`, d = () => `%rd${cnt.d++}`
  const reg = (t: Tipo) => (t === 'f32' ? f() : t === 'i32' ? r() : p())
  const ins = (s: string) => { L.push(`  ${s}`) }
  const escalares = k.entradas.filter((q) => !q.vetor), vet = k.entradas.filter((q) => q.vetor)
  const pt = (t: Tipo) => (t === 'f32' ? '.f32' : '.s32')
  const sc = new Map<string, string>(), ve = new Map<string, string>(), loc = new Map<string, string>()
  let rI = '', rN = '', rX = '', rY = ''

  const conv = (x: No, para: Tipo): string => { const v = gen(x); if (para === 'f32' && x.tipo === 'i32') { const o = f(); ins(`cvt.rn.f32.s32 ${o}, ${v};`); return o } return v }
  function gen(no: No): string {
    switch (no.k) {
      case 'lit': { if (no.tipo === 'f32') { const o = f(); ins(`mov.f32 ${o}, ${hexF(no.v)};`); return o } if (no.tipo === 'i32') { const o = r(); ins(`mov.s32 ${o}, ${no.v};`); return o } const o = p(); ins(`setp.${no.v ? 'eq' : 'ne'}.u32 ${o}, 0, 0;`); return o }
      case 'ref': return no.cls === 'i' ? rI : no.cls === 'n' ? rN : no.cls === 'x' ? rX : no.cls === 'y' ? rY : no.cls === 'escalar' ? sc.get(no.nome)! : no.cls === 'local' ? loc.get(no.nome)! : ve.get(no.nome)!
      case 'un': { const x = gen(no.x), o = reg(no.tipo); ins(no.op === 'nao' ? `not.pred ${o}, ${x};` : `neg${pt(no.tipo)} ${o}, ${x};`); return o }
      case 'bin': {
        const o = reg(no.tipo)
        if (no.op === '&&' || no.op === '||') { const a = gen(no.a), b = gen(no.b); ins(`${no.op === '&&' ? 'and' : 'or'}.pred ${o}, ${a}, ${b};`); return o }
        if (no.a.tipo === 'bool') { const a = gen(no.a), b = gen(no.b); if (no.op === '!=') ins(`xor.pred ${o}, ${a}, ${b};`); else { const t = p(); ins(`xor.pred ${t}, ${a}, ${b};`); ins(`not.pred ${o}, ${t};`) } return o }
        const t: Tipo = no.a.tipo === 'f32' || no.b.tipo === 'f32' || no.op === '/' ? 'f32' : 'i32'
        const a = conv(no.a, t), b = conv(no.b, t), ty = pt(t)
        const cmp: Record<string, string> = { '<': 'lt', '<=': 'le', '>': 'gt', '>=': 'ge', '==': 'eq', '!=': t === 'f32' ? 'neu' : 'ne' }
        if (no.op in cmp) { ins(`setp.${cmp[no.op]}${ty} ${o}, ${a}, ${b};`); return o }
        if (t === 'f32') ins(`${{ '+': 'add', '-': 'sub', '*': 'mul', '/': 'div' }[no.op as '+']}.rn.f32 ${o}, ${a}, ${b};`)
        else ins(no.op === '*' ? `mul.lo.s32 ${o}, ${a}, ${b};` : `${no.op === '+' ? 'add' : 'sub'}.s32 ${o}, ${a}, ${b};`)
        return o
      }
      case 'sel': {
        const c = gen(no.c), o = reg(no.tipo)
        if (no.tipo === 'bool') { const a = gen(no.a), b = gen(no.b), t1 = p(), t2 = p(), t3 = p(); ins(`and.pred ${t1}, ${c}, ${a};`); ins(`not.pred ${t2}, ${c};`); ins(`and.pred ${t3}, ${t2}, ${b};`); ins(`or.pred ${o}, ${t1}, ${t3};`) }
        else { const a = conv(no.a, no.tipo), b = conv(no.b, no.tipo); ins(`selp${pt(no.tipo)} ${o}, ${a}, ${b}, ${c};`) }
        return o
      }
      case 'fn': {
        if (no.nome === 'i32') { const x = gen(no.args[0]!); if (no.args[0]!.tipo === 'i32') return x; const o = r(); ins(`cvt.rzi.s32.f32 ${o}, ${x};`); return o } // satura; NaN → 0 (definido pelo PTX)
        const a = no.args.map((x) => conv(x, 'f32')), o = f()
        const op = { min: `min.f32 ${o}, ${a[0]}, ${a[1]}`, max: `max.f32 ${o}, ${a[0]}, ${a[1]}`, abs: `abs.f32 ${o}, ${a[0]}`, sqrt: `sqrt.rn.f32 ${o}, ${a[0]}`, floor: `cvt.rmi.f32.f32 ${o}, ${a[0]}`, ceil: `cvt.rpi.f32.f32 ${o}, ${a[0]}`, f32: `mov.f32 ${o}, ${a[0]}`, i32: '' }[no.nome]
        ins(`${op};`); return o
      }
    }
  }

  // prólogo
  const parametros = ['.param .u32 p_n', ...escalares.map((q) => `.param ${q.tipo === 'f32' ? '.f32' : '.s32'} p_s_${q.nome}`), ...vet.map((q) => `.param .u64 p_v_${q.nome}`), ...k.saidas.map((s) => `.param .u64 p_o_${s.nome}`)]
  rN = r(); ins(`ld.param.u32 ${rN}, [p_n];`)
  for (const q of escalares) { const o = q.tipo === 'f32' ? f() : r(); ins(`ld.param${pt(q.tipo)} ${o}, [p_s_${q.nome}];`); if (q.tipo === 'bool') { const b = p(); ins(`setp.ne.s32 ${b}, ${o}, 0;`); sc.set(q.nome, b) } else sc.set(q.nome, o) }
  const tid = r(), nt = r(), ct = r(); rI = r()
  ins(`mov.u32 ${tid}, %tid.x;`); ins(`mov.u32 ${nt}, %ntid.x;`); ins(`mov.u32 ${ct}, %ctaid.x;`); ins(`mad.lo.s32 ${rI}, ${ct}, ${nt}, ${tid};`)
  const guarda = p(); ins(`setp.ge.s32 ${guarda}, ${rI}, ${rN};`); ins(`@${guarda} bra DONE;`)
  const endereco = (param: string): string => { const base = d(), off = d(), end = d(); ins(`ld.param.u64 ${base}, [${param}];`); ins(`cvta.to.global.u64 ${base}, ${base};`); ins(`mul.wide.s32 ${off}, ${rI}, 4;`); ins(`add.s64 ${end}, ${base}, ${off};`); return end }
  for (const q of vet) {
    const a = endereco(`p_v_${q.nome}`)
    if (q.tipo === 'f32') { const o = f(); ins(`ld.global.f32 ${o}, [${a}];`); ve.set(q.nome, o) }
    else { const o = r(); ins(`ld.global.s32 ${o}, [${a}];`); if (q.tipo === 'bool') { const b = p(); ins(`setp.ne.s32 ${b}, ${o}, 0;`); ve.set(q.nome, b) } else ve.set(q.nome, o) }
  }
  if (k.larguraDe) { const w = sc.get(k.larguraDe)!, W = r(); rX = r(); rY = r(); ins(`max.s32 ${W}, ${w}, 1;`); ins(`rem.u32 ${rX}, ${rI}, ${W};`); ins(`div.u32 ${rY}, ${rI}, ${W};`) }
  for (const l of k.locais) loc.set(l.nome, gen(l.expr))
  for (const s of k.saidas) {
    const v = gen(s.expr), a = endereco(`p_o_${s.nome}`)
    if (s.tipo === 'f32') ins(`st.global.f32 [${a}], ${v};`)
    else if (s.tipo === 'i32') ins(`st.global.s32 [${a}], ${v};`)
    else { const t = r(); ins(`selp.s32 ${t}, 1, 0, ${v};`); ins(`st.global.s32 [${a}], ${t};`) }
  }
  const decl = [cnt.f && `.reg .f32 %f<${cnt.f}>;`, cnt.r && `.reg .b32 %r<${cnt.r}>;`, cnt.p && `.reg .pred %p<${cnt.p}>;`, cnt.d && `.reg .b64 %rd<${cnt.d}>;`].filter(Boolean).map((s) => `  ${s}`)
  return ['// gerado por @polaris/computacao — não edite', '.version 7.0', '.target sm_50', '.address_size 64', '', `.visible .entry ${nomeEntrada(k.id)}(`, ...parametros.map((x, j) => `  ${x}${j < parametros.length - 1 ? ',' : ''}`), ')', '{', ...decl, ...L, 'DONE:', '  ret;', '}', ''].join('\n')
}
