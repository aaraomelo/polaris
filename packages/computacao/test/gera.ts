// Gerador pseudoaleatório (semente fixa) de kernels e entradas SEGUROS para paridade: sem NaN/Inf nem estouro de i32, que são onde os alvos legitimamente divergem.
export function rng(semente: number) { let s = semente >>> 0 || 1; return () => { s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0; return s / 4294967296 } }
type G = { t: string; tipo: 'i32' | 'f32' | 'bool'; mag: number }
export type Gerado = { spec: any; entradas: (n: number) => Record<string, unknown>; mag: number }

export function geraKernel(sem: number): Gerado {
  const r = rng(sem), pick = <T,>(a: readonly T[]): T => a[Math.floor(r() * a.length)]!
  const ents = [{ nome: 'a', tipo: 'decimal', lista: true }, { nome: 'b', tipo: 'decimal', lista: true }, { nome: 'k', tipo: 'inteiro', lista: true }, { nome: 'c', tipo: 'decimal', lista: false }, { nome: 'm', tipo: 'inteiro', lista: false }, { nome: 'f', tipo: 'booleano', lista: false }]
  const de: Record<string, { tipo: 'i32' | 'f32' | 'bool'; mag: number }> = { a: { tipo: 'f32', mag: 100 }, b: { tipo: 'f32', mag: 100 }, k: { tipo: 'i32', mag: 9 }, c: { tipo: 'f32', mag: 100 }, m: { tipo: 'i32', mag: 9 }, f: { tipo: 'bool', mag: 1 }, i: { tipo: 'i32', mag: 1000 } }
  const xy = r() < 0.4; if (xy) { de.x = { tipo: 'i32', mag: 1000 }; de.y = { tipo: 'i32', mag: 1000 } }
  const locais: Array<{ nome: string; valor: string }> = []; const vis = Object.keys(de)
  const fl = (): G => { const v = Math.round(r() * 2000 - 1000) / 8; return { t: v < 0 ? `(-${-v})` : String(v), tipo: Number.isInteger(v) ? 'i32' : 'f32', mag: Math.abs(v) } }
  function gen(tipo: 'num' | 'bool', prof: number): G {
    if (tipo === 'bool') {
      if (prof <= 0 || r() < 0.2) return pick([{ t: 'f', tipo: 'bool' as const, mag: 1 }, { t: 'true', tipo: 'bool' as const, mag: 1 }])
      const o = pick(['<', '<=', '>', '>=', '==', '!=', '&&', '||', '!'] as const)
      if (o === '!') return { t: `(!${gen('bool', prof - 1).t})`, tipo: 'bool', mag: 1 }
      if (o === '&&' || o === '||') return { t: `(${gen('bool', prof - 1).t} ${o} ${gen('bool', prof - 1).t})`, tipo: 'bool', mag: 1 }
      return { t: `(${gen('num', prof - 1).t} ${o} ${gen('num', prof - 1).t})`, tipo: 'bool', mag: 1 }
    }
    if (prof <= 0 || r() < 0.25) { const v = pick([...vis.filter((x) => de[x]!.tipo !== 'bool')]); if (r() < 0.2) return fl(); return { t: v, tipo: de[v]!.tipo as 'i32' | 'f32', mag: de[v]!.mag } }
    const op = pick(['+', '-', '*', '/', 'neg', 'min', 'max', 'abs', 'sqrt', 'floor', 'ceil', 'f32', 'i32', 'sel'] as const)
    const a = gen('num', prof - 1), b = gen('num', prof - 1)
    const f = (x: G) => (x.tipo === 'f32' ? 'f' : 'i')
    switch (op) {
      case '+': case '-': { const mag = a.mag + b.mag; return mag > 1e9 ? a : { t: `(${a.t} ${op} ${b.t})`, tipo: a.tipo === 'f32' || b.tipo === 'f32' ? 'f32' : 'i32', mag } }
      case '*': { const mag = a.mag * b.mag; return mag > 1e9 ? a : { t: `(${a.t} * ${b.t})`, tipo: a.tipo === 'f32' || b.tipo === 'f32' ? 'f32' : 'i32', mag } }
      case '/': return { t: `(${a.t} / (abs(${b.t}) + 1))`, tipo: 'f32', mag: a.mag }
      case 'neg': return { t: `(-${a.t})`, tipo: a.tipo, mag: a.mag }
      case 'min': case 'max': return { t: `${op}(${a.t}, ${b.t})`, tipo: 'f32', mag: Math.max(a.mag, b.mag) }
      case 'abs': return { t: `abs(${a.t})`, tipo: 'f32', mag: a.mag }
      case 'sqrt': return { t: `sqrt(abs(${a.t}))`, tipo: 'f32', mag: Math.sqrt(a.mag) + 1 }
      case 'floor': case 'ceil': return { t: `${op}(${a.t})`, tipo: 'f32', mag: a.mag + 1 }
      case 'f32': return { t: `f32(${a.t})`, tipo: 'f32', mag: a.mag }
      case 'i32': return a.mag > 1e9 ? a : { t: `i32(${a.t})`, tipo: 'i32', mag: a.mag + 1 }
      default: { const c = gen('bool', prof - 1); return { t: `(${c.t} ? ${a.t} : ${b.t})`, tipo: a.tipo === 'f32' || b.tipo === 'f32' ? 'f32' : 'i32', mag: Math.max(a.mag, b.mag) } }
    }
    void f
  }
  const nl = Math.floor(r() * 3)
  for (let j = 0; j < nl; j++) { const e = r() < 0.2 ? gen('bool', 2) : gen('num', 3); const nome = `t${j}`; locais.push({ nome, valor: e.t }); de[nome] = { tipo: e.tipo, mag: e.mag ?? 1 }; vis.push(nome) }
  const so: Record<string, { tipo: string; lista: true }> = {}, corpo: Record<string, string> = {}; let mag = 1
  const ns = 1 + Math.floor(r() * 3)
  for (let j = 0; j < ns; j++) {
    const alvo = pick(['f32', 'f32', 'i32', 'bool'] as const)
    let e = alvo === 'bool' ? gen('bool', 3) : gen('num', 4)
    if (alvo === 'i32') e = { t: `i32(${e.t})`, tipo: 'i32', mag: e.mag }
    if (alvo === 'f32') e = { t: e.tipo === 'i32' ? `f32(${e.t})` : e.t, tipo: 'f32', mag: e.mag }
    so[`o${j}`] = { tipo: alvo === 'f32' ? 'decimal' : alvo === 'i32' ? 'inteiro' : 'booleano', lista: true }; corpo[`o${j}`] = e.t; mag = Math.max(mag, e.mag)
  }
  const entradas = (n: number) => { const R = rng(sem * 7 + n); const dec = () => Math.round((R() * 200 - 100) * 64) / 64; return { a: Array.from({ length: n }, dec), b: Array.from({ length: n }, dec), k: Array.from({ length: n }, () => Math.floor(R() * 19) - 9), c: dec(), m: Math.floor(R() * 19) - 9, f: R() < 0.5 } }
  return { spec: { entradas: Object.fromEntries(ents.map((e) => [e.nome, e.lista ? { tipo: e.tipo, lista: true } : { tipo: e.tipo }])), saidas: so, corpo: { locais, saidas: corpo }, ...(xy ? { dominio: { larguraDe: 'm' } } : {}), tolerancia: { relativa: 0.00001 } }, entradas, mag }
}
