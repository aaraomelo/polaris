import type { Condicao, TipoCampo, Tipos, Variaveis } from './tipos'

// A linguagem de condição (MongoQuery): avaliada em JS (decisão sobre UMA linha: criar/atualizar, testes) e compilada para SQL (filtro de listagem).
// As duas dão a MESMA resposta (fuzz contra o Postgres, com nulos e listas). Só entra o que cabe nas duas; o resto é recusado ao carregar a regra (fail-closed).
// Valor nulo/ausente: comparação nunca "casa" (exceto igualdade com null e $exists); `$ne`, `$nin` e `$not` casam com ele (como o Mongo).

export class CondicaoInvalida extends Error { constructor(m: string) { super(m); this.name = 'CondicaoInvalida' } }
const ORDEM = new Set<TipoCampo>(['inteiro', 'decimal', 'dinheiro', 'data', 'dataHora'])
const LOGICOS = new Set(['$and', '$or', '$nor'])
const ESCALARES = new Set(['$eq', '$ne', '$in', '$nin', '$gt', '$gte', '$lt', '$lte'])
const ehObjeto = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const escalar = (v: unknown) => v === null || typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean'

type Info = { base: TipoCampo; lista: boolean }
const info = (t: string): Info => (t.endsWith('[]') ? { base: t.slice(0, -2) as TipoCampo, lista: true } : { base: t as TipoCampo, lista: false })
const SQL_TIPO: Record<string, string> = { texto: 'text', inteiro: 'bigint', decimal: 'numeric', dinheiro: 'numeric', booleano: 'boolean', data: 'date', dataHora: 'timestamptz', uuid: 'uuid' }

/** Confere a forma da condição contra os campos conhecidos. Lança `CondicaoInvalida` com o caminho. */
export function validaCondicao(c: unknown, tipos: Tipos, caminho = 'onde'): void {
  if (!ehObjeto(c)) throw new CondicaoInvalida(`${caminho}: a condição deve ser um objeto`)
  for (const [k, v] of Object.entries(c)) {
    if (LOGICOS.has(k)) {
      if (!Array.isArray(v)) throw new CondicaoInvalida(`${caminho}.${k}: deve ser uma lista de condições`)
      v.forEach((x, i) => validaCondicao(x, tipos, `${caminho}.${k}[${i}]`)); continue
    }
    if (k.startsWith('$')) throw new CondicaoInvalida(`${caminho}: operador '${k}' não é suportado`)
    const t = tipos[k]
    if (!t) throw new CondicaoInvalida(`${caminho}: o campo '${k}' não existe`)
    if (info(t).base === 'json') throw new CondicaoInvalida(`${caminho}.${k}: campos json não entram em condições`)
    validaCampo(v, info(t), `${caminho}.${k}`, false)
  }
}

function validaCampo(spec: unknown, t: Info, caminho: string, noElemento: boolean): void {
  if (escalar(spec)) { if (t.lista && spec === null) throw new CondicaoInvalida(`${caminho}: comparar lista com null não é suportado (use $exists)`); return }
  if (!ehObjeto(spec)) throw new CondicaoInvalida(`${caminho}: valor não suportado`)
  for (const [op, x] of Object.entries(spec)) {
    const aqui = `${caminho}.${op}`
    if (op === '$not') { if (noElemento) throw new CondicaoInvalida(`${aqui}: não cabe dentro de $elemMatch`); validaCampo(x, t, aqui, false); continue }
    if (op === '$exists') { if (noElemento) throw new CondicaoInvalida(`${aqui}: não cabe dentro de $elemMatch`); if (typeof x !== 'boolean') throw new CondicaoInvalida(`${aqui}: deve ser true ou false`); continue }
    if (op === '$all' || op === '$size' || op === '$elemMatch') {
      if (!t.lista) throw new CondicaoInvalida(`${aqui}: só vale para campos lista`)
      if (noElemento) throw new CondicaoInvalida(`${aqui}: não cabe dentro de $elemMatch`)
      if (op === '$all' && !(Array.isArray(x) && x.length > 0 && x.every((y) => escalar(y) && y !== null))) throw new CondicaoInvalida(`${aqui}: deve ser uma lista NÃO vazia de valores simples (no Mongo, $all vazio não casa nada)`)
      if (op === '$size' && !(Number.isInteger(x) && (x as number) >= 0)) throw new CondicaoInvalida(`${aqui}: deve ser um inteiro ≥ 0`)
      if (op === '$elemMatch') { if (!ehObjeto(x)) throw new CondicaoInvalida(`${aqui}: deve ser um objeto de operadores`); validaCampo(x, { base: t.base, lista: false }, aqui, true) }
      continue
    }
    if (!ESCALARES.has(op)) throw new CondicaoInvalida(`${caminho}: operador '${op}' não é suportado`)
    if (op === '$in' || op === '$nin') { if (!(Array.isArray(x) && x.every((y) => escalar(y) && !(t.lista && y === null)))) throw new CondicaoInvalida(`${aqui}: deve ser uma lista de valores simples${t.lista ? ' (sem null)' : ''}`); continue }
    if (op === '$eq' || op === '$ne') { if (!escalar(x) || (t.lista && x === null)) throw new CondicaoInvalida(`${aqui}: valor inválido`); continue }
    if (!ORDEM.has(t.base)) throw new CondicaoInvalida(`${aqui}: ordenar campo '${t.base}' não é suportado (a ordem do texto depende do banco; use número, dinheiro ou data)`)
    if (!escalar(x) || x === null) throw new CondicaoInvalida(`${aqui}: valor inválido`)
  }
}

/** Substitui '$usuario' e '$tenant'. `indefinida`: a condição depende de uma variável que o chamador não tem. */
export function substitui(c: Condicao, v: Variaveis): { cond: Condicao; indefinida: boolean } {
  let indefinida = false
  const rec = (x: unknown): unknown => {
    if (x === '$usuario') { if (v.usuario === undefined) indefinida = true; return v.usuario ?? null }
    if (x === '$tenant') { if (v.tenant === undefined) indefinida = true; return v.tenant ?? null }
    if (Array.isArray(x)) return x.map(rec)
    if (ehObjeto(x)) return Object.fromEntries(Object.entries(x).map(([k, y]) => [k, rec(y)]))
    return x
  }
  return { cond: rec(c) as Condicao, indefinida }
}

// ---- decimal exato (dinheiro) ----------------------------------------------------------------------------------------------------------------
function decimal(v: unknown): { s: 1 | -1; i: bigint; esc: number } | null {
  const m = /^(-?)(\d+)(?:\.(\d+))?$/.exec(String(v).trim()); if (!m) return null
  const f = m[3] ?? ''; return { s: m[1] ? -1 : 1, i: BigInt(m[2] + f), esc: f.length }
}
function cmpDecimal(a: unknown, b: unknown): number | null {
  const x = decimal(a), y = decimal(b); if (!x || !y) return null
  const e = Math.max(x.esc, y.esc)
  const nx = BigInt(x.s) * x.i * 10n ** BigInt(e - x.esc), ny = BigInt(y.s) * y.i * 10n ** BigInt(e - y.esc)
  return nx < ny ? -1 : nx > ny ? 1 : 0
}
function compara(tipo: TipoCampo, a: unknown, b: unknown): number | null {
  if (a === null || a === undefined || b === null || b === undefined) return null
  if (tipo === 'dinheiro' || tipo === 'decimal') return cmpDecimal(a, b)
  if (tipo === 'inteiro') { const x = Number(a), y = Number(b); return Number.isNaN(x) || Number.isNaN(y) ? null : x < y ? -1 : x > y ? 1 : 0 }
  return typeof a === typeof b ? (String(a) < String(b) ? -1 : String(a) > String(b) ? 1 : 0) : null
}
function igual(tipo: TipoCampo, a: unknown, b: unknown): boolean {
  if (a === null || a === undefined) return b === null || b === undefined
  if (b === null || b === undefined) return false
  if (tipo === 'dinheiro' || tipo === 'decimal') return cmpDecimal(a, b) === 0
  if (tipo === 'inteiro') return Number(a) === Number(b)
  return String(a) === String(b) && typeof a === typeof b
}
const ordemOk = (op: string, r: number) => (op === '$gt' ? r > 0 : op === '$gte' ? r >= 0 : op === '$lt' ? r < 0 : r <= 0)

/** A linha satisfaz a condição? */
export function avalia(c: Condicao, linha: Record<string, unknown>, tipos: Tipos): boolean {
  for (const [k, v] of Object.entries(c)) {
    if (k === '$and') { if (!(v as Condicao[]).every((x) => avalia(x, linha, tipos))) return false; continue }
    if (k === '$or') { if (!(v as Condicao[]).some((x) => avalia(x, linha, tipos))) return false; continue }
    if (k === '$nor') { if ((v as Condicao[]).some((x) => avalia(x, linha, tipos))) return false; continue }
    if (!avaliaCampo(info(tipos[k]!), linha[k], v)) return false
  }
  return true
}

function avaliaCampo(t: Info, x: unknown, spec: unknown): boolean {
  const ops: Record<string, unknown> = escalar(spec) ? { $eq: spec } : (spec as Record<string, unknown>)
  const arr = t.lista && Array.isArray(x) ? x : null
  const nulo = x === null || x === undefined
  for (const [op, y] of Object.entries(ops)) {
    let ok: boolean
    switch (op) {
      case '$not': ok = !avaliaCampo(t, x, y); break
      case '$exists': ok = (t.lista ? arr !== null : !nulo) === y; break
      case '$eq': ok = t.lista ? !!arr?.some((e) => igual(t.base, e, y)) : igual(t.base, x, y); break
      case '$ne': ok = !(t.lista ? !!arr?.some((e) => igual(t.base, e, y)) : igual(t.base, x, y)); break
      case '$in': ok = t.lista ? !!arr?.some((e) => (y as unknown[]).some((z) => igual(t.base, e, z))) : (y as unknown[]).some((z) => igual(t.base, x, z)); break
      case '$nin': ok = !(t.lista ? !!arr?.some((e) => (y as unknown[]).some((z) => igual(t.base, e, z))) : (y as unknown[]).some((z) => igual(t.base, x, z))); break
      case '$all': ok = arr !== null && (y as unknown[]).every((z) => arr.some((e) => igual(t.base, e, z))); break
      case '$size': ok = arr !== null && arr.length === y; break
      case '$elemMatch': ok = !!arr?.some((e) => avaliaCampo({ base: t.base, lista: false }, e, y)); break
      default: // $gt $gte $lt $lte
        ok = t.lista ? !!arr?.some((e) => { const r = compara(t.base, e, y); return r !== null && ordemOk(op, r) }) : (() => { const r = compara(t.base, x, y); return r !== null && ordemOk(op, r) })()
    }
    if (!ok) return false
  }
  return true
}

/**
 * Compila para SQL. `coluna` mapeia campo → expressão SQL JÁ citada (vem do schema, nunca do usuário); os VALORES entram por parâmetro (`params` é
 * acrescentado). `tipos` diz quais campos são lista. Devolve uma expressão booleana; condição vazia = TRUE.
 */
export function aSql(c: Condicao, coluna: (campo: string) => string, params: unknown[], tipos: Tipos = {}): string {
  const p = (v: unknown) => { params.push(v); return `$${params.length}` }
  const partes: string[] = []
  for (const [k, v] of Object.entries(c)) {
    const sub = (xs: Condicao[], j: string, vazio: string) => (xs.length ? xs.map((x) => aSql(x, coluna, params, tipos)).join(j) : vazio)
    // COALESCE nos NOT: em SQL, NOT(NULL) é NULL e a linha SAIRIA; aqui "nada casou" (inclusive por valor nulo) tem de INCLUIR a linha, como em JS e no Mongo
    if (k === '$and') partes.push(`(${sub(v as Condicao[], ' AND ', 'TRUE')})`)
    else if (k === '$or') partes.push(`(${sub(v as Condicao[], ' OR ', 'FALSE')})`)
    else if (k === '$nor') partes.push(`(NOT COALESCE((${sub(v as Condicao[], ' OR ', 'FALSE')}), FALSE))`)
    else partes.push(campoSql(info(tipos[k] ?? 'texto'), coluna(k), v, p))
  }
  return partes.length ? partes.join(' AND ') : 'TRUE'
}

function campoSql(t: Info, col: string, spec: unknown, p: (v: unknown) => string): string {
  const ops: Record<string, unknown> = escalar(spec) ? { $eq: spec } : (spec as Record<string, unknown>)
  const out: string[] = []
  const elem = (corpo: (e: string) => string) => `EXISTS (SELECT 1 FROM unnest(${col}) AS "_e"("v") WHERE ${corpo('"_e"."v"')})`
  for (const [op, y] of Object.entries(ops)) {
    switch (op) {
      case '$not': out.push(`(NOT COALESCE((${campoSql(t, col, y, p)}), FALSE))`); break
      case '$exists': out.push(y ? `${col} IS NOT NULL` : `${col} IS NULL`); break
      case '$eq': out.push(t.lista ? `${p(y)} = ANY(${col})` : y === null ? `${col} IS NULL` : `${col} = ${p(y)}`); break
      case '$ne': out.push(t.lista ? `(NOT COALESCE(${p(y)} = ANY(${col}), FALSE))` : y === null ? `${col} IS NOT NULL` : `${col} IS DISTINCT FROM ${p(y)}`); break
      case '$in': case '$nin': {
        const l = y as unknown[], sem = l.filter((z) => z !== null), temNulo = l.length !== sem.length
        if (t.lista) { out.push(op === '$in' ? (sem.length ? `(${col} && ${p(sem)})` : 'FALSE') : (sem.length ? `(NOT COALESCE(${col} && ${p(sem)}, FALSE))` : 'TRUE')); break }
        if (op === '$in') out.push(`(${[sem.length ? `${col} = ANY(${p(sem)})` : '', temNulo ? `${col} IS NULL` : ''].filter(Boolean).join(' OR ') || 'FALSE'})`)
        else out.push(`(${[sem.length ? `(${col} IS NULL OR NOT (${col} = ANY(${p(sem)})))` : '', temNulo ? `${col} IS NOT NULL` : ''].filter(Boolean).join(' AND ') || 'TRUE'})`)
        break
      }
      case '$all': out.push(`(${col} @> ${p(y)})`); break
      case '$size': out.push(`(cardinality(${col}) = ${p(y)})`); break
      case '$elemMatch': out.push(elem((e) => campoSql({ base: t.base, lista: false }, e, y, p))); break
      default: { const cmp = op === '$gt' ? '>' : op === '$gte' ? '>=' : op === '$lt' ? '<' : '<='; out.push(t.lista ? elem((e) => `${e} ${cmp} ${p(y)}`) : `${col} ${cmp} ${p(y)}`) }
    }
  }
  return out.length === 1 ? out[0]! : `(${out.join(' AND ')})`
}
void SQL_TIPO
