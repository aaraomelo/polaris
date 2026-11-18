import { ArrayDe, preparaEntradas, type Entradas, type Saidas } from './contrato'
import { BLOCO, nomeEntrada } from './ptx'
import type { Kernel } from './ir'

// MOCK de GPU: interpreta o subconjunto de PTX que `emitePtx` produz, thread a thread, com a semântica DOCUMENTADA do PTX (não a do nosso IR): é o que torna a paridade
// ptx ≡ js uma verificação de verdade do emissor e não um espelho dele. NÃO é um driver CUDA e não prova nada sobre ptxas/hardware.
const f32 = Math.fround
type Val = number
const FLOAT_IMM = /^0f([0-9A-Fa-f]{8})$/

export function executaPtxMock(ptx: string, entrada: string, args: { n: number; escalares: Val[]; ponteiros: number[]; memoria: ArrayBuffer }): void {
  if (!ptx.includes(`.entry ${entrada}(`)) throw new Error(`entrada ${entrada} não existe no PTX`)
  const corpo = ptx.slice(ptx.indexOf('{', ptx.indexOf('.entry')) + 1, ptx.lastIndexOf('}'))
  const nomesParam = [...ptx.slice(ptx.indexOf('.entry'), ptx.indexOf('{', ptx.indexOf('.entry'))).matchAll(/\.param\s+\.(\w+)\s+(\w+)/g)].map((m) => ({ tipo: m[1]!, nome: m[2]! }))
  const params: Record<string, Val> = {}; let ie = 0, ip = 0
  for (const [j, q] of nomesParam.entries()) params[q.nome] = j === 0 ? args.n : q.tipo === 'u64' ? args.ponteiros[ip++]! : args.escalares[ie++]!
  const prog: Array<{ rotulo?: string; pred?: string; op: string; ops: string[] }> = []
  const rotulos = new Map<string, number>()
  for (const bruta of corpo.split('\n')) {
    const l = bruta.replace(/\/\/.*$/, '').trim(); if (!l || l.startsWith('.reg')) continue
    const m = /^([A-Za-z_]\w*):$/.exec(l); if (m) { rotulos.set(m[1]!, prog.length); continue }
    const pm = /^@(!?)(%\w+)\s+(.*)$/.exec(l), txt = (pm ? pm[3]! : l).replace(/;$/, '')
    const [op, ...resto] = txt.split(/\s+/); const ops = resto.join(' ').split(',').map((s) => s.trim()).filter(Boolean)
    prog.push({ ...(pm ? { pred: `${pm[1]}${pm[2]}` } : {}), op: op!, ops })
  }
  const dv = new DataView(args.memoria)
  for (let tid = 0; tid < Math.ceil(args.n / BLOCO) * BLOCO; tid++) {
    const R = new Map<string, Val>()
    const esp = (s: string): Val | undefined => (s === '%tid.x' ? tid % BLOCO : s === '%ntid.x' ? BLOCO : s === '%ctaid.x' ? Math.floor(tid / BLOCO) : undefined)
    const le = (s: string): Val => {
      const e = esp(s); if (e !== undefined) return e
      if (s.startsWith('%')) { const v = R.get(s); if (v === undefined) throw new Error(`registrador ${s} lido antes de escrito`); return v }
      const h = FLOAT_IMM.exec(s); if (h) { const b = new DataView(new ArrayBuffer(4)); b.setUint32(0, parseInt(h[1]!, 16)); return b.getFloat32(0) }
      if (/^-?\d+$/.test(s)) return Number(s)
      throw new Error(`operando desconhecido: ${s}`)
    }
    const end = (s: string): number => { const m = /^\[(.+)\]$/.exec(s)!; return le(m[1]!) }
    let pc = 0, passos = 0
    while (pc < prog.length) {
      if (++passos > 100_000) throw new Error('PTX: passos demais (laço?)')
      const { pred, op, ops } = prog[pc++]!
      if (pred) { const neg = pred.startsWith('!'), v = R.get(neg ? pred.slice(1) : pred); if (v === undefined) throw new Error('predicado lido antes de escrito'); if ((v !== 0) === neg) continue }
      const [d, a, b, c] = ops as [string, string, string, string]
      const W = (v: Val) => R.set(d, v)
      const p = op.split('.')
      switch (p[0]) {
        case 'ret': pc = prog.length; break
        case 'bra': pc = rotulos.get(ops[0]!)!; break
        case 'ld': {
          if (p[1] === 'param') { const m = /^\[(\w+)\]$/.exec(a)!; W(params[m[1]!]!) }
          else { const ad = end(a); W(p[2] === 'f32' ? dv.getFloat32(ad, true) : dv.getInt32(ad, true)) }
          break
        }
        case 'st': { const ad = end(d); if (p[2] === 'f32') dv.setFloat32(ad, le(a), true); else dv.setInt32(ad, le(a) | 0, true); break }
        case 'cvta': W(le(a)); break
        case 'mov': W(p[1] === 'f32' ? f32(le(a)) : le(a)); break
        case 'mad': W((Math.imul(le(a), le(b)) + le(c)) | 0); break
        case 'mul': if (p[1] === 'wide') W(le(a) * le(b)); else W(p[2] === 'f32' ? f32(le(a) * le(b)) : Math.imul(le(a), le(b))); break
        case 'add': W(p.includes('f32') ? f32(le(a) + le(b)) : p.includes('s64') ? le(a) + le(b) : (le(a) + le(b)) | 0); break
        case 'sub': W(p.includes('f32') ? f32(le(a) - le(b)) : (le(a) - le(b)) | 0); break
        case 'div': W(p.includes('f32') ? f32(le(a) / le(b)) : Math.floor((le(a) >>> 0) / (le(b) >>> 0))); break
        case 'rem': W((le(a) >>> 0) % (le(b) >>> 0)); break
        case 'neg': W(p[1] === 'f32' ? -le(a) : (-le(a)) | 0); break
        case 'abs': W(Math.abs(le(a))); break
        case 'sqrt': W(f32(Math.sqrt(le(a)))); break
        case 'min': case 'max': { const x = le(a), y = le(b); W(Number.isNaN(x) ? y : Number.isNaN(y) ? x : p[0] === 'min' ? Math.min(x, y) : Math.max(x, y)); break } // PTX: se um é NaN, devolve o outro
        case 'cvt': {
          const x = le(a), dst = p[p.length - 2]!, src = p[p.length - 1]!, mod = p[1]!
          if (dst === 'f32' && src === 'f32') W(mod === 'rmi' ? Math.floor(x) : Math.ceil(x))
          else if (dst === 'f32') W(f32(x)) // cvt.rn.f32.s32
          else W(Number.isNaN(x) ? 0 : x >= 2147483647 ? 2147483647 : x <= -2147483648 ? -2147483648 : Math.trunc(x) | 0) // cvt.rzi.s32.f32 satura
          break
        }
        case 'setp': {
          const cmp = p[1]!, x = le(a), y = le(b), un = cmp.endsWith('u') && cmp !== 'u' ? true : false, base = un ? cmp.slice(0, -1) : cmp
          const nan = Number.isNaN(x) || Number.isNaN(y)
          const cmpv = base === 'eq' ? x === y : base === 'ne' ? x !== y : base === 'lt' ? x < y : base === 'le' ? x <= y : base === 'gt' ? x > y : x >= y
          W(nan ? (un ? 1 : 0) : cmpv ? 1 : 0); break // ordenadas (eq, lt…) dão falso com NaN; as `u` (neu) dão verdadeiro
        }
        case 'selp': W(le(c) ? le(a) : le(b)); break
        case 'and': W(le(a) && le(b) ? 1 : 0); break
        case 'or': W(le(a) || le(b) ? 1 : 0); break
        case 'xor': W(le(a) !== le(b) ? 1 : 0); break
        case 'not': W(le(a) ? 0 : 1); break
        default: throw new Error(`instrução PTX fora do subconjunto: ${op}`)
      }
    }
  }
}

/** executa um Kernel pelo PTX no mock: aloca a "memória do dispositivo", copia, roda e lê de volta (o que um driver real faria) */
export function executaPtx(k: Kernel, ptx: string, entradas: Entradas, n: number): Saidas {
  const p = preparaEntradas(k, entradas, n)
  const vet = k.entradas.filter((q) => q.vetor), tam = Math.max(16, (n * 4 + 15) & ~15)
  const mem = new ArrayBuffer(16 + (vet.length + k.saidas.length) * tam); const ptr: Record<string, number> = {}; let off = 16
  for (const q of vet) { ptr[q.nome] = off; new (ArrayDe(q.tipo))(mem, off, n).set(p.vetores[q.nome]!); off += tam }
  for (const s of k.saidas) { ptr[s.nome] = off; off += tam }
  executaPtxMock(ptx, nomeEntrada(k.id), { n, escalares: k.entradas.filter((q) => !q.vetor).map((q) => p.escalares[q.nome]!), ponteiros: [...vet.map((q) => ptr[q.nome]!), ...k.saidas.map((s) => ptr[s.nome]!)], memoria: mem })
  const out: Saidas = {}; for (const s of k.saidas) out[s.nome] = new (ArrayDe(s.tipo))(mem.slice(ptr[s.nome]!, ptr[s.nome]! + n * 4))
  return out
}
