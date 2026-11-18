import { ArrayDe, preparaEntradas, type Entradas, type Saidas } from './contrato'
import type { Kernel, No, Tipo } from './ir'

// Emissor WebAssembly: monta o binário DIRETO do IR (sem toolchain). Isomórfico: só usa `WebAssembly` e typed arrays (roda no navegador e no Node).
// Assinatura exportada: run(n, ...escalares, ...ponteirosDasEntradasLista, ...ponteirosDasSaídas); ponteiro = byte offset na memória exportada `mem`. f32 e i32 em wasm são IEEE/complemento de 2: bit a bit igual ao oráculo js.

const u = (n: number): number[] => { const o: number[] = []; do { let b = n & 0x7f; n >>>= 7; if (n) b |= 0x80; o.push(b) } while (n); return o }
const s32 = (n: number): number[] => { const o: number[] = []; for (;;) { const b = n & 0x7f; n >>= 7; if ((n === 0 && !(b & 0x40)) || (n === -1 && b & 0x40)) { o.push(b); return o } o.push(b | 0x80) } }
const f32b = (v: number): number[] => Array.from(new Uint8Array(new Float32Array([v]).buffer))
const str = (s: string): number[] => [...u(s.length), ...Array.from(s, (c) => c.charCodeAt(0))]
const sec = (id: number, body: number[]): number[] => [id, ...u(body.length), ...body]
const vec = (items: number[][]): number[] => [...u(items.length), ...items.flat()]
const VT: Record<Tipo, number> = { i32: 0x7f, f32: 0x7d, bool: 0x7f }

const OP = { i32: { '+': 0x6a, '-': 0x6b, '*': 0x6c, '==': 0x46, '!=': 0x47, '<': 0x48, '>': 0x4a, '<=': 0x4c, '>=': 0x4e }, f32: { '+': 0x92, '-': 0x93, '*': 0x94, '/': 0x95, '==': 0x5b, '!=': 0x5c, '<': 0x5d, '>': 0x5e, '<=': 0x5f, '>=': 0x60 } } as const

/** nomes e índices dos locais da função: params (n, escalares, ponteiros), depois `i`, depois os locais do kernel */
function layout(k: Kernel) {
  const escalares = k.entradas.filter((p) => !p.vetor), vet = k.entradas.filter((p) => p.vetor)
  const idx = new Map<string, number>(); let j = 0
  idx.set('n', j++); for (const p of escalares) idx.set(`s:${p.nome}`, j++)
  for (const p of vet) idx.set(`p:${p.nome}`, j++); for (const s of k.saidas) idx.set(`o:${s.nome}`, j++)
  const nParams = j; idx.set('i', j++); idx.set('x', j++); idx.set('y', j++); for (const l of k.locais) idx.set(`l:${l.nome}`, j++)
  return { escalares, vet, idx, nParams }
}

export function emiteWasm(k: Kernel): Uint8Array<ArrayBuffer> {
  const L = layout(k)
  const params = [0x7f, ...L.escalares.map((p) => VT[p.tipo]), ...L.vet.map(() => 0x7f), ...k.saidas.map(() => 0x7f)]
  const I = (n: string): number => L.idx.get(n)!
  const code: number[] = []
  const e = (...b: number[]) => { code.push(...b) }
  const conv = (no: No, para: Tipo) => { gen(no); if (para === 'f32' && no.tipo === 'i32') e(0xb2) /* f32.convert_i32_s */ }
  function gen(no: No): void {
    switch (no.k) {
      case 'lit': if (no.tipo === 'f32') e(0x43, ...f32b(no.v)); else e(0x41, ...s32(no.v)); return
      case 'ref':
        if (no.cls === 'i') e(0x20, ...u(I('i')))
        else if (no.cls === 'n') e(0x20, ...u(I('n')))
        else if (no.cls === 'x' || no.cls === 'y') e(0x20, ...u(I(no.cls)))
        else if (no.cls === 'escalar') e(0x20, ...u(I(`s:${no.nome}`)))
        else if (no.cls === 'local') e(0x20, ...u(I(`l:${no.nome}`)))
        else { e(0x20, ...u(I(`p:${no.nome}`)), 0x20, ...u(I('i')), 0x41, 2, 0x74, 0x6a); e(no.tipo === 'f32' ? 0x2a : 0x28, 2, 0) } // base + (i << 2); f32.load | i32.load
        return
      case 'un':
        if (no.op === 'nao') { gen(no.x); e(0x45) } // i32.eqz
        else if (no.tipo === 'f32') { gen(no.x); e(0x8c) } else { e(0x41, 0); gen(no.x); e(0x6b) } // 0 - x
        return
      case 'bin': {
        if (no.op === '&&') { gen(no.a); gen(no.b); e(0x71); return }
        if (no.op === '||') { gen(no.a); gen(no.b); e(0x72); return }
        if (no.a.tipo === 'bool') { gen(no.a); gen(no.b); e(OP.i32[no.op as '=='] ); return } // == e != em booleanos (0|1)
        const t: Tipo = no.a.tipo === 'f32' || no.b.tipo === 'f32' || no.op === '/' ? 'f32' : 'i32'
        conv(no.a, t); conv(no.b, t); e((OP[t as 'i32'] as Record<string, number>)[no.op]!); return
      }
      case 'sel': // select não tem efeito e os dois ramos são puros: avaliar os dois é seguro
        if (no.tipo === 'bool') { gen(no.a); gen(no.b) } else { conv(no.a, no.tipo); conv(no.b, no.tipo) }
        gen(no.c); e(0x1b); return
      case 'fn': {
        if (no.nome === 'i32') { gen(no.args[0]!); if (no.args[0]!.tipo === 'f32') e(0xfc, 0x00) /* i32.trunc_sat_f32_s */; return }
        for (const a of no.args) conv(a, 'f32')
        e({ min: 0x96, max: 0x97, abs: 0x8b, sqrt: 0x91, floor: 0x8e, ceil: 0x8d, f32: -1, i32: -1 }[no.nome]!); if (no.nome === 'f32') code.pop(); return
      }
    }
  }
  // corpo: for i in [0,n) { locais; saídas }
  e(0x41, 0, 0x21, ...u(I('i'))) // i = 0
  e(0x02, 0x40, 0x03, 0x40) // block { loop {
  e(0x20, ...u(I('i')), 0x20, ...u(I('n')), 0x4e, 0x0d, 1) // if (i >= n) br 1
  if (k.larguraDe) { // W = max(w,1); x = i mod W; y = i div W   (select(a,b,c) = c ? a : b)
    const W = () => { e(0x20, ...u(I(`s:${k.larguraDe}`)), 0x41, 1, 0x20, ...u(I(`s:${k.larguraDe}`)), 0x41, 1, 0x4a, 0x1b) } // w > 1 ? w : 1
    e(0x20, ...u(I('i'))); W(); e(0x70, 0x21, ...u(I('x')), 0x20, ...u(I('i'))); W(); e(0x6e, 0x21, ...u(I('y')))
  }
  for (const l of k.locais) { gen(l.expr); e(0x21, ...u(I(`l:${l.nome}`))) }
  for (const s of k.saidas) { e(0x20, ...u(I(`o:${s.nome}`)), 0x20, ...u(I('i')), 0x41, 2, 0x74, 0x6a); gen(s.expr); e(s.tipo === 'f32' ? 0x38 : 0x36, 2, 0) }
  e(0x20, ...u(I('i')), 0x41, 1, 0x6a, 0x21, ...u(I('i')), 0x0c, 0, 0x0b, 0x0b) // i++ ; br 0 } }
  const decl: number[][] = [[3, 0x7f], ...k.locais.map((l) => [1, VT[l.tipo]])] // i + locais
  const body = [...vec(decl), ...code, 0x0b]
  const bytes = [0x00, 0x61, 0x73, 0x6d, 1, 0, 0, 0,
    ...sec(1, vec([[0x60, ...vec(params.map((p) => [p])), 0]])),
    ...sec(3, vec([[0]])),
    ...sec(5, vec([[0, 1]])), // memória: mín. 1 página, sem máximo
    ...sec(7, vec([[...str('mem'), 2, 0], [...str('run'), 0, 0]])),
    ...sec(10, vec([[...u(body.length), ...body]])),
  ]
  return Uint8Array.from(bytes)
}

export type InstanciaWasm = (entradas: Entradas, n: number) => Saidas
/** compila (assíncrono, para valer no navegador) e devolve o executor; a memória cresce sob demanda e é reaproveitada */
export async function compilaWasm(k: Kernel, bytes: Uint8Array<ArrayBuffer> = emiteWasm(k)): Promise<InstanciaWasm> {
  const { instance } = await WebAssembly.instantiate(bytes as BufferSource, {})
  const mem = instance.exports.mem as WebAssembly.Memory, run = instance.exports.run as (...a: number[]) => void
  const L = layout(k)
  return (entradas, n) => {
    const p = preparaEntradas(k, entradas, n)
    const alinha = (x: number) => (x + 15) & ~15
    const tam = alinha(n * 4); let off = 16; const ptr: Record<string, number> = {}
    for (const v of L.vet) { ptr[v.nome] = off; off += tam }
    for (const s of k.saidas) { ptr[s.nome] = off; off += tam }
    const falta = off - mem.buffer.byteLength; if (falta > 0) mem.grow(Math.ceil(falta / 65536))
    for (const v of L.vet) new (ArrayDe(v.tipo))(mem.buffer, ptr[v.nome]!, n).set(p.vetores[v.nome]!)
    run(n, ...L.escalares.map((s) => p.escalares[s.nome]!), ...L.vet.map((v) => ptr[v.nome]!), ...k.saidas.map((s) => ptr[s.nome]!))
    const out: Saidas = {}
    for (const s of k.saidas) out[s.nome] = new (ArrayDe(s.tipo))(mem.buffer.slice(ptr[s.nome]!, ptr[s.nome]! + n * 4))
    return out
  }
}
