import { ExprErro, parseExpr, type Expr } from '@polaris/engine/expr'

// IR do kernel: mapa elemento a elemento, TIPADO (i32 | f32 | bool), sem efeitos e sem laços. Todos os emissores (js, wasm, glsl, ptx) partem DAQUI, nunca do texto.
// Regras de tipo: literal inteiro é i32 e promove a f32 onde preciso; `/`, min, max, abs, sqrt, floor, ceil são SEMPRE f32; + - * ficam em i32 se os dois forem i32.

export type Tipo = 'i32' | 'f32' | 'bool'
export type No =
  | { k: 'lit'; tipo: 'i32' | 'f32' | 'bool'; v: number }
  | { k: 'ref'; tipo: Tipo; cls: 'escalar' | 'vetor' | 'local' | 'i' | 'n' | 'x' | 'y'; nome: string }
  | { k: 'un'; tipo: Tipo; op: 'neg' | 'nao'; x: No }
  | { k: 'bin'; tipo: Tipo; op: '+' | '-' | '*' | '/' | '<' | '<=' | '>' | '>=' | '==' | '!=' | '&&' | '||'; a: No; b: No }
  | { k: 'sel'; tipo: Tipo; c: No; a: No; b: No }
  | { k: 'fn'; tipo: Tipo; nome: 'min' | 'max' | 'abs' | 'sqrt' | 'floor' | 'ceil' | 'f32' | 'i32'; args: No[] }
export type Param = { nome: string; tipo: Tipo; vetor: boolean }
export type Kernel = { id: string; entradas: Param[]; saidas: Array<Param & { expr: No }>; locais: Array<{ nome: string; tipo: Tipo; expr: No }>; restricoes: No[]; maxElementos: number; larguraDe?: string; tolerancia: { relativa: number; absoluta: number }; nos: number }

import { KernelErro } from './erro'
export { KernelErro }

const MAX_NOS = 2000, MAX_ELEMENTOS_PADRAO = 1_048_576
export const FUNCOES = { min: [2, 'f32'], max: [2, 'f32'], abs: [1, 'f32'], sqrt: [1, 'f32'], floor: [1, 'f32'], ceil: [1, 'f32'], f32: [1, 'f32'], i32: [1, 'i32'] } as const
const TIPO_DE: Record<string, Tipo> = { decimal: 'f32', inteiro: 'i32', booleano: 'bool' }
const RESERVADOS = new Set(['i', 'n', 'true', 'false', 'null', ...Object.keys(FUNCOES)])
const prom = (a: Tipo, b: Tipo): Tipo => (a === 'f32' || b === 'f32' ? 'f32' : 'i32')

type Escopo = Map<string, { cls: 'escalar' | 'vetor' | 'local'; tipo: Tipo }> & { xy?: boolean }

function tipa(e: Expr, esc: Escopo, ctx: { nos: number }, onde: string, permiteVetor: boolean): No {
  if (++ctx.nos > MAX_NOS) throw new KernelErro(`expressão grande demais (mais de ${MAX_NOS} nós)`, onde)
  const er = (m: string): never => { throw new KernelErro(m, onde) }
  const num = (n: No, quem: string) => { if (n.tipo === 'bool') er(`${quem} espera número, veio booleano`); return n }
  const bool = (n: No, quem: string) => { if (n.tipo !== 'bool') er(`${quem} espera booleano, veio ${n.tipo === 'f32' ? 'decimal' : 'inteiro'}`); return n }
  const t = (x: Expr) => tipa(x, esc, ctx, onde, permiteVetor)
  switch (e.t) {
    case 'lit': {
      if (typeof e.v === 'boolean') return { k: 'lit', tipo: 'bool', v: e.v ? 1 : 0 }
      if (typeof e.v !== 'number') return er('só literais numéricos e booleanos')
      if (Number.isInteger(e.v)) { if (e.v > 2147483647) er(`inteiro fora de i32: ${e.v}`); return { k: 'lit', tipo: 'i32', v: e.v } }
      const f = Math.fround(e.v); if (!Number.isFinite(f)) er('literal decimal fora de f32')
      return { k: 'lit', tipo: 'f32', v: f }
    }
    case 'var': {
      if (e.nome === 'i') return { k: 'ref', tipo: 'i32', cls: 'i', nome: 'i' }
      if (e.nome === 'n') return { k: 'ref', tipo: 'i32', cls: 'n', nome: 'n' }
      if ((e.nome === 'x' || e.nome === 'y') && esc.xy) return { k: 'ref', tipo: 'i32', cls: e.nome, nome: e.nome }
      const d = esc.get(e.nome); if (!d) return er(`"${e.nome}" não é uma entrada nem um local declarado antes`)
      if (d.cls !== 'escalar' && !permiteVetor) er(`"${e.nome}" ${d.cls === 'vetor' ? 'é uma lista' : 'é um local'}: só pode ser lido no corpo, não nas restrições`)
      return { k: 'ref', tipo: d.tipo, cls: d.cls, nome: e.nome }
    }
    case 'un': {
      const x = t(e.x)
      return e.op === '!' ? { k: 'un', tipo: 'bool', op: 'nao', x: bool(x, '!') } : { k: 'un', tipo: num(x, '-').tipo, op: 'neg', x }
    }
    case 'bin': {
      if (e.op === '%' || e.op === '??') return er(`o operador ${e.op} não existe em kernels`)
      const a = t(e.a), b = t(e.b)
      if (e.op === '&&' || e.op === '||') return { k: 'bin', tipo: 'bool', op: e.op, a: bool(a, e.op), b: bool(b, e.op) }
      if (e.op === '==' || e.op === '!=') { if ((a.tipo === 'bool') !== (b.tipo === 'bool')) er('não se compara booleano com número'); return { k: 'bin', tipo: 'bool', op: e.op, a, b } }
      if (e.op === '<' || e.op === '<=' || e.op === '>' || e.op === '>=') return { k: 'bin', tipo: 'bool', op: e.op, a: num(a, e.op), b: num(b, e.op) }
      num(a, e.op); num(b, e.op)
      return { k: 'bin', tipo: e.op === '/' ? 'f32' : prom(a.tipo, b.tipo), op: e.op, a, b }
    }
    case 'cond': {
      const c = bool(t(e.c), '?:'), a = t(e.a), b = t(e.b)
      if ((a.tipo === 'bool') !== (b.tipo === 'bool')) er('os dois ramos do ?: precisam do mesmo tipo')
      return { k: 'sel', tipo: a.tipo === 'bool' ? 'bool' : prom(a.tipo, b.tipo), c, a, b }
    }
    case 'call': {
      const f = (FUNCOES as Record<string, readonly [number, Tipo]>)[e.fn]
      if (!f) return er(`função "${e.fn}" não existe em kernels (use ${Object.keys(FUNCOES).join(', ')}; sem sin/cos/exp: variam entre alvos)`)
      if (e.args.length !== f[0]) er(`${e.fn} recebe ${f[0]} argumento(s)`)
      return { k: 'fn', tipo: f[1], nome: e.fn as 'min', args: e.args.map((x) => num(t(x), e.fn)) }
    }
    case 'mem': case 'idx': case 'lista': case 'fn': return er('acesso a campo/índice, listas e funções anônimas não existem em kernels')
  }
}

const parse = (src: string, onde: string): Expr => { try { return parseExpr(src) } catch (e) { if (e instanceof ExprErro) throw new KernelErro(e.message, onde); throw e } }

type Spec = { entradas?: Record<string, { tipo: string; lista?: boolean }>; saidas?: Record<string, { tipo: string; lista?: boolean }>; corpo?: { locais?: Array<{ nome: string; valor: string }>; saidas: Record<string, string> }; restricoes?: string[]; dominio?: { maxElementos?: number; larguraDe?: string }; tolerancia?: { relativa?: number; absoluta?: number } }

/** do spec do nó `kernel` ao IR; todo erro de autoria vira `KernelErro` com o ponto exato */
export function compilaKernel(id: string, spec: Spec): Kernel {
  if (!spec.corpo) throw new KernelErro('o kernel não tem `corpo` (nada a calcular)')
  const esc: Escopo = new Map(), ctx = { nos: 0 }
  const larguraDe = spec.dominio?.larguraDe
  const reservado = (nome: string) => RESERVADOS.has(nome) || (larguraDe !== undefined && (nome === 'x' || nome === 'y'))
  const param = (nome: string, d: { tipo: string; lista?: boolean }, onde: string): Param => {
    const tipo = TIPO_DE[d.tipo]; if (!tipo) throw new KernelErro(`tipo "${d.tipo}" não é suportado (use inteiro, decimal ou booleano)`, onde)
    if (reservado(nome)) throw new KernelErro(`"${nome}" é nome reservado`, onde)
    return { nome, tipo, vetor: d.lista === true }
  }
  const entradas = Object.entries(spec.entradas ?? {}).map(([n, d]) => param(n, d, `entradas.${n}`))
  for (const p of entradas) esc.set(p.nome, { cls: p.vetor ? 'vetor' : 'escalar', tipo: p.tipo })
  if (larguraDe !== undefined) { const w = entradas.find((p) => p.nome === larguraDe); if (!w || w.vetor || w.tipo !== 'i32') throw new KernelErro(`larguraDe "${larguraDe}" precisa ser uma entrada inteira escalar`, 'dominio.larguraDe'); esc.xy = true } // habilita x = i mod max(w,1) e y = i div max(w,1)
  const locais: Kernel['locais'] = []
  for (const [j, l] of (spec.corpo.locais ?? []).entries()) {
    const onde = `corpo.locais[${j}]`
    if (esc.has(l.nome) || reservado(l.nome)) throw new KernelErro(`"${l.nome}" já existe ou é reservado`, onde)
    const expr = tipa(parse(l.valor, onde), esc, ctx, onde, true)
    locais.push({ nome: l.nome, tipo: expr.tipo, expr }); esc.set(l.nome, { cls: 'local', tipo: expr.tipo })
  }
  const saidas: Kernel['saidas'] = []
  for (const [nome, d] of Object.entries(spec.saidas ?? {})) {
    const onde = `corpo.saidas.${nome}`, p = param(nome, d, `saidas.${nome}`)
    if (!p.vetor) throw new KernelErro('toda saída é uma lista (um valor por elemento)', `saidas.${nome}`)
    if (esc.has(nome)) throw new KernelErro(`"${nome}" já é uma entrada`, `saidas.${nome}`)
    const fonte = spec.corpo.saidas[nome]; if (fonte === undefined) throw new KernelErro('a saída não tem expressão no corpo', onde)
    let expr = tipa(parse(fonte, onde), esc, ctx, onde, true)
    if (expr.tipo !== p.tipo) {
      if (p.tipo === 'f32' && expr.tipo === 'i32') expr = { k: 'fn', tipo: 'f32', nome: 'f32', args: [expr] } // promoção exata
      else throw new KernelErro(`a expressão é ${expr.tipo === 'f32' ? 'decimal' : expr.tipo === 'i32' ? 'inteiro' : 'booleana'} e a saída foi declarada ${d.tipo}${expr.tipo === 'f32' && p.tipo === 'i32' ? ' (use i32(...) para truncar)' : ''}`, onde)
    }
    saidas.push({ ...p, expr })
  }
  for (const k of Object.keys(spec.corpo.saidas)) if (!(k in (spec.saidas ?? {}))) throw new KernelErro(`"${k}" tem expressão mas não foi declarada em saidas`, `corpo.saidas.${k}`)
  if (!saidas.length) throw new KernelErro('o kernel não tem saídas')
  if (saidas.length > 4) throw new KernelErro('no máximo 4 saídas')
  const restricoes = (spec.restricoes ?? []).map((r, j) => { const onde = `restricoes[${j}]`, n = tipa(parse(r, onde), esc, ctx, onde, false); if (n.tipo !== 'bool') throw new KernelErro('uma restrição é uma expressão booleana', onde); return n })
  return { id, entradas, saidas, locais, restricoes, maxElementos: spec.dominio?.maxElementos ?? MAX_ELEMENTOS_PADRAO, ...(larguraDe !== undefined ? { larguraDe } : {}), tolerancia: { relativa: spec.tolerancia?.relativa ?? 0, absoluta: spec.tolerancia?.absoluta ?? 0 }, nos: ctx.nos }
}

/** as restrições são verificadas no ESCALAR, com a mesma tipagem (f32 exato) */
export const vetoresDe = (k: Kernel) => k.entradas.filter((p) => p.vetor)
export const escalaresDe = (k: Kernel) => k.entradas.filter((p) => !p.vetor)
