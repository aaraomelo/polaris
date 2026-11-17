import type { Expr } from '../expr/index'
import type { IRNo, Valor } from '../ir/tipos'

// Dependências por CAMINHO. Uma dependência é uma chave de texto com a cadeia ESTÁTICA que a expressão lê:
//   `estado.itens[0].nome`  →  "estado.itens.0.nome";   `loja.nome`  →  "loja.nome";   `p.preco` (p = item do repetir)  →  "p.preco".
// A cadeia para onde a expressão deixa de ser estática (índice calculado, `.length`, chamada de função…): o resto vira dependência do
// prefixo. O Modelo entrega, a cada mudança, o conjunto de caminhos que mudaram (diff por referência do store imutável).
//
// O conjunto de mudanças `m` contém, para cada caminho-folha que mudou:  todos os seus prefixos ("a", "a.b", "a.b.c")  e a folha com
// a marca MARCA ("a.b.c\u0001"). Uma dependência d é afetada se d é prefixo-ou-igual de uma folha (m tem d) OU se alguma folha é
// ancestral-ou-igual de d (m tem p+MARCA para algum prefixo p de d). É a relação "um contém o outro" dos caminhos.

export const MARCA = '\u0001'
const MAX_CADEIA = 6
const IDENT = /^[A-Za-z_$][A-Za-z0-9_$]*$/
const INDICE = /^(0|[1-9][0-9]*)$/

/** chave de dependência de uma cadeia estática; null se `e` não é uma cadeia a partir de uma variável */
function cadeia(e: Expr): string[] | null {
  if (e.t === 'var') return [e.nome]
  if (e.t === 'mem') {
    if (e.nome === 'length') return null // o tamanho depende do CONTÊINER inteiro
    const c = cadeia(e.obj)
    return c && c.length < MAX_CADEIA ? [...c, e.nome] : c
  }
  if (e.t === 'idx' && e.idx.t === 'lit') {
    const k = typeof e.idx.v === 'number' ? (Number.isInteger(e.idx.v) && e.idx.v >= 0 ? String(e.idx.v) : null) : typeof e.idx.v === 'string' && (IDENT.test(e.idx.v) || INDICE.test(e.idx.v)) ? e.idx.v : null
    const c = cadeia(e.obj)
    return k === null ? null : c && c.length < MAX_CADEIA ? [...c, k] : c
  }
  return null
}

export function depsExpr(e: Expr, out: Set<string>): void {
  if (e.t === 'var' || e.t === 'mem' || e.t === 'idx') {
    const c = cadeia(e)
    if (c) { out.add(c.join('.')); return }
  }
  switch (e.t) {
    case 'var': out.add(e.nome); break
    case 'mem': depsExpr(e.obj, out); break
    case 'idx': depsExpr(e.obj, out); depsExpr(e.idx, out); break
    case 'un': depsExpr(e.x, out); break
    case 'bin': depsExpr(e.a, out); depsExpr(e.b, out); break
    case 'cond': depsExpr(e.c, out); depsExpr(e.a, out); depsExpr(e.b, out); break
    case 'lista': for (const i of e.itens) depsExpr(i, out); break
    case 'call': for (const a of e.args) depsExpr(a, out); break
    case 'fn': {
      // o que o corpo lê, menos os parâmetros (ligados dentro da função)
      const dentro = new Set<string>()
      depsExpr(e.corpo, dentro)
      for (const k of dentro) if (!e.params.includes(raizDe(k))) out.add(k)
      break
    }
    case 'lit': break
  }
}

export function depsValor(v: Valor, out: Set<string>): void {
  switch (v.t) {
    case 'lit': break
    case 'expr': depsExpr(v.ast, out); break
    case 'tpl': for (const p of v.partes) if (typeof p !== 'string') depsExpr(p.ast, out); break
    case 'arr': for (const i of v.itens) depsValor(i, out); break
    case 'obj': for (const x of Object.values(v.campos)) depsValor(x, out)
  }
}

const ancestrais = new Map<string, string[]>()
/** `p + MARCA` para todo prefixo p da chave (inclusive ela mesma) */
function marcasDe(d: string): string[] {
  let r = ancestrais.get(d)
  if (!r) {
    r = []
    for (let i = d.indexOf('.'); ; i = d.indexOf('.', i + 1)) { r.push(`${i < 0 ? d : d.slice(0, i)}${MARCA}`); if (i < 0) break }
    ancestrais.set(d, r)
  }
  return r
}

/** Alguma dependência de `deps` é afetada pelo conjunto de mudanças `m`? (um caminho contém o outro) */
export function cruza(deps: ReadonlySet<string>, m: ReadonlySet<string>): boolean {
  for (const d of deps) {
    if (m.has(d)) return true
    for (const a of marcasDe(d)) if (m.has(a)) return true
  }
  return false
}

/** Primeiro segmento de uma chave (ignora a marca). */
export function raizDe(k: string): string {
  const i = k.search(/[.\u0001]/)
  return i < 0 ? k : k.slice(0, i)
}

/**
 * Acrescenta a `out` as chaves de mudança de caminhos-folha sob `raiz`: cada folha vira todos os seus prefixos mais a folha marcada.
 * Segmento com '.' ou a marca no nome é cortado ali (a mudança fica no pai: mais grosso, nunca perde). Caminho vazio = a própria raiz.
 */
export function chavesDeCaminhos(raiz: string, folhas: ReadonlyArray<ReadonlyArray<string | number>>, out: Set<string>): void {
  for (const f of folhas) {
    let k = raiz
    out.add(k)
    for (const seg of f.slice(0, MAX_CADEIA * 2)) {
      const t = String(seg)
      if (t.includes('.') || t.includes(MARCA)) break
      k = `${k}.${t}`
      out.add(k)
    }
    out.add(k + MARCA)
  }
}

const cacheCabeca = new WeakMap<IRNo, { se: Set<string>; cabeca: Set<string> }>()
const cacheTotal = new WeakMap<IRNo, Set<string>>()

/** Dependências da expressão `se` e da cabeça do `repetir` (cada + chave), cada qual no escopo em que é avaliada. */
export function depsCabeca(no: IRNo): { se: Set<string>; cabeca: Set<string> } {
  let r = cacheCabeca.get(no)
  if (!r) {
    const se = new Set<string>(), cabeca = new Set<string>()
    if (no.se) depsExpr(no.se, se)
    if (no.repetir) { depsExpr(no.repetir.cada, cabeca); if (no.repetir.chave) depsExpr(no.repetir.chave, cabeca) }
    r = { se, cabeca }
    cacheCabeca.set(no, r)
  }
  return r
}

/** Dependências de um nó e de TUDO que ele constrói (props, se, repetir, filhos), sem o que o próprio repetir define. */
export function usaTotal(no: IRNo): Set<string> {
  let r = cacheTotal.get(no)
  if (r) return r
  r = new Set<string>()
  cacheTotal.set(no, r) // entra antes de calcular: sem recursão infinita
  const { se, cabeca } = depsCabeca(no)
  const interno = new Set<string>()
  if (no.tipo === 'elemento') {
    for (const v of Object.values(no.props)) depsValor(v, interno)
    for (const lista of Object.values(no.slots)) for (const f of lista) for (const k of usaTotal(f)) interno.add(k)
  }
  if (no.repetir) { interno.delete(no.repetir.como); interno.delete('indice'); for (const k of [...interno]) if (raizDe(k) === no.repetir.como) interno.delete(k) }
  for (const k of se) r.add(k)
  for (const k of cabeca) { if (no.repetir && (raizDe(k) === no.repetir.como || raizDe(k) === 'indice')) continue; r.add(k) }
  for (const k of interno) r.add(k)
  return r
}
