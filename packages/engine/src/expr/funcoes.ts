import { LIMITES_EXPR, type Funcoes } from './tipos'

// Biblioteca padrão: funções puras e totais (nunca lançam; entrada inválida → undefined ou texto vazio).
// Formatadores em pt-BR com fuso fixo para a saída ser idêntica no servidor (SSR) e no cliente.

const ehNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const aNum = (v: unknown): number | undefined => {
  if (ehNum(v)) return v
  if (typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v))) return Number(v)
  return undefined
}
const txt = (v: unknown) => (v === null || v === undefined || typeof v === 'object' ? '' : String(v))
const casas = (v: unknown, padrao: number) => { const n = aNum(v); return n === undefined ? padrao : Math.min(10, Math.max(0, Math.trunc(n))) }

const FUSO = 'America/Sao_Paulo'

// Intl é caro de CRIAR (~33 µs por toLocaleString) e barato de USAR (~0,4 µs): os formatadores são criados uma vez.
// A saída é idêntica à de toLocaleString com as mesmas opções.
const nfCache = new Map<string, Intl.NumberFormat>()
const nf = (chave: string, opcoes: Intl.NumberFormatOptions): Intl.NumberFormat => {
  let f = nfCache.get(chave)
  if (!f) { f = new Intl.NumberFormat('pt-BR', opcoes); nfCache.set(chave, f) }
  return f
}
const dfCache = new Map<string, Intl.DateTimeFormat>()
const df = (chave: string, opcoes: Intl.DateTimeFormatOptions): Intl.DateTimeFormat => {
  let f = dfCache.get(chave)
  if (!f) { f = new Intl.DateTimeFormat('pt-BR', opcoes); dfCache.set(chave, f) }
  return f
}

function dataDe(v: unknown): Date | null {
  if (v === null || v === undefined || v === '') return null
  if (typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v)) return new Date(`${v}T12:00:00Z`) // data pura: meio-dia UTC não escorrega de dia
  const d = v instanceof Date ? v : new Date(v as string | number)
  return Number.isNaN(d.getTime()) ? null : d
}

// ---- listas e objetos (a lista é o monoide livre: concat é a operação, [] a unidade) ------------------------------

const MAX = LIMITES_EXPR.lista
const ehLista = (v: unknown): v is unknown[] => Array.isArray(v)
const ehObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const inteiro = (v: unknown): number | undefined => (typeof v === 'number' && Number.isInteger(v) ? v : undefined)
const PROFUNDIDADE_IGUAL = 64

/** Igualdade estrutural (JSON): null e ausente são iguais; objetos comparam pelas chaves próprias; ordem das chaves não importa. */
export function igualProfundo(a: unknown, b: unknown, prof = 0): boolean {
  if (prof > PROFUNDIDADE_IGUAL) return false
  if ((a === null || a === undefined) && (b === null || b === undefined)) return true
  if (ehLista(a)) return ehLista(b) && a.length === b.length && a.every((x, i) => igualProfundo(x, b[i], prof + 1))
  if (ehObj(a)) {
    if (!ehObj(b)) return false
    const ka = Object.keys(a), kb = Object.keys(b)
    return ka.length === kb.length && ka.every((k) => Object.prototype.hasOwnProperty.call(b, k) && igualProfundo(a[k], b[k], prof + 1))
  }
  return typeof a === typeof b && a === b
}

/** Chave canônica de um valor JSON (para deduplicar em O(n)); null se for fundo demais. */
function canonico(v: unknown, prof = 0): string | null {
  if (prof > PROFUNDIDADE_IGUAL) return null
  if (v === null || v === undefined) return 'n'
  if (typeof v === 'boolean') return v ? 't' : 'f'
  if (typeof v === 'number') return `d${v}`
  if (typeof v === 'string') return `s${JSON.stringify(v)}`
  if (ehLista(v)) { const xs = v.map((x) => canonico(x, prof + 1)); return xs.includes(null) ? null : `[${xs.join(',')}]` }
  if (ehObj(v)) { const xs = Object.keys(v).sort().map((k) => [k, canonico(v[k], prof + 1)] as const); return xs.some((x) => x[1] === null) ? null : `{${xs.map(([k, c]) => `${JSON.stringify(k)}:${c}`).join(',')}}` }
  return null
}

const chavesOrdenadas = (o: Record<string, unknown>) => Object.keys(o).sort()

export const FUNCOES_PADRAO: Funcoes = {
  igual: { min: 2, max: 2, fn: (a, b) => igualProfundo(a, b) },
  concat: { min: 1, max: 16, fn: (...ls) => {
    if (!ls.every(ehLista)) return undefined
    const n = (ls as unknown[][]).reduce((t, l) => t + l.length, 0)
    return n > MAX ? undefined : (ls as unknown[][]).flat(1)
  } },
  achata: { min: 1, max: 1, fn: (l) => {
    if (!ehLista(l)) return undefined
    const n = l.reduce<number>((t, x) => t + (ehLista(x) ? x.length : 1), 0)
    return n > MAX ? undefined : l.flat(1)
  } },
  fatia: { min: 2, max: 3, fn: (l, i, f) => {
    if (!(ehLista(l) || typeof l === 'string')) return undefined
    const a = inteiro(i), b = f === undefined ? undefined : inteiro(f)
    if (a === undefined || (f !== undefined && b === undefined)) return undefined
    return l.slice(a, b)
  } },
  inverte: { min: 1, max: 1, fn: (l) => (ehLista(l) ? [...l].reverse() : undefined) },
  primeiro: { min: 1, max: 1, fn: (l) => (ehLista(l) ? l[0] : undefined) },
  ultimo: { min: 1, max: 1, fn: (l) => (ehLista(l) ? l[l.length - 1] : undefined) },
  unicos: { min: 1, max: 1, fn: (l) => {
    if (!ehLista(l)) return undefined
    const vistos = new Set<string>(), out: unknown[] = []
    for (const x of l) { const c = canonico(x); if (c === null) return undefined; if (!vistos.has(c)) { vistos.add(c); out.push(x) } }
    return out
  } },
  intervalo: { min: 1, max: 2, fn: (a, b) => {
    const ini = b === undefined ? 0 : inteiro(a), fim = b === undefined ? inteiro(a) : inteiro(b)
    if (ini === undefined || fim === undefined) return undefined
    if (fim <= ini) return []
    return fim - ini > MAX ? undefined : Array.from({ length: fim - ini }, (_, k) => ini + k)
  } },
  soma: { min: 1, max: 1, fn: (l) => {
    if (!ehLista(l) || !l.every((x) => typeof x === 'number' && Number.isFinite(x))) return undefined
    const r = (l as number[]).reduce((t, x) => t + x, 0)
    return Number.isFinite(r) ? r : undefined
  } },
  chaves: { min: 1, max: 1, fn: (o) => (ehObj(o) ? chavesOrdenadas(o) : undefined) },
  valores: { min: 1, max: 1, fn: (o) => (ehObj(o) ? chavesOrdenadas(o).map((k) => o[k]) : undefined) },
  entradas: { min: 1, max: 1, fn: (o) => (ehObj(o) ? chavesOrdenadas(o).map((k) => [k, o[k]]) : undefined) },
  objeto: { min: 1, max: 1, fn: (l) => {
    if (!ehLista(l) || l.length > MAX || !l.every((p) => ehLista(p) && p.length === 2 && typeof p[0] === 'string')) return undefined
    return Object.fromEntries(l as Array<[string, unknown]>)
  } },

  tamanho: { min: 1, max: 1, fn: (x) => (typeof x === 'string' || Array.isArray(x) ? x.length : x && typeof x === 'object' ? Object.keys(x).length : 0) },
  maiusculas: { min: 1, max: 1, fn: (x) => txt(x).toUpperCase() },
  minusculas: { min: 1, max: 1, fn: (x) => txt(x).toLowerCase() },
  aparar: { min: 1, max: 1, fn: (x) => txt(x).trim() },
  contem: { min: 2, max: 2, fn: (a, b) => (typeof a === 'string' ? a.includes(txt(b)) : Array.isArray(a) ? a.includes(b) : false) },
  comeca: { min: 2, max: 2, fn: (a, b) => txt(a).startsWith(txt(b)) },
  termina: { min: 2, max: 2, fn: (a, b) => txt(a).endsWith(txt(b)) },
  junta: { min: 1, max: 2, fn: (l, s) => (Array.isArray(l) ? l.map(txt).join(s === undefined ? ', ' : txt(s)) : '') },
  texto: { min: 1, max: 1, fn: (x) => txt(x) },
  numero: { min: 1, max: 2, fn: (x, c) => {
    const n = aNum(x)
    return n === undefined ? '' : nf(`n${casas(c, 0)}`, { minimumFractionDigits: 0, maximumFractionDigits: casas(c, 0) }).format(n)
  } },
  arredonda: { min: 1, max: 2, fn: (x, c) => { const n = aNum(x); if (n === undefined) return undefined; const f = 10 ** casas(c, 0); return Math.round(n * f) / f } },
  piso: { min: 1, max: 1, fn: (x) => { const n = aNum(x); return n === undefined ? undefined : Math.floor(n) } },
  teto: { min: 1, max: 1, fn: (x) => { const n = aNum(x); return n === undefined ? undefined : Math.ceil(n) } },
  absoluto: { min: 1, max: 1, fn: (x) => { const n = aNum(x); return n === undefined ? undefined : Math.abs(n) } },
  minimo: { min: 1, max: 16, fn: (...xs) => { const ns = xs.map(aNum); return ns.some((n) => n === undefined) ? undefined : Math.min(...(ns as number[])) } },
  maximo: { min: 1, max: 16, fn: (...xs) => { const ns = xs.map(aNum); return ns.some((n) => n === undefined) ? undefined : Math.max(...(ns as number[])) } },
  padrao: { min: 2, max: 2, fn: (x, d) => (x === null || x === undefined || x === '' ? d : x) },
  // formatadores
  brl: { min: 1, max: 1, fn: (x) => { const n = aNum(x); return n === undefined ? '' : nf('brl', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n) } },
  pct: { min: 1, max: 2, fn: (x, c) => { const n = aNum(x); return n === undefined ? '' : nf(`p${casas(c, 0)}`, { minimumFractionDigits: 0, maximumFractionDigits: casas(c, 0) }).format(n * 100) + '%' } },
  data: { min: 1, max: 1, fn: (x) => { const d = dataDe(x); return d ? df(typeof x === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(x) ? 'dUTC' : 'dBR', { timeZone: typeof x === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(x) ? 'UTC' : FUSO }).format(d) : '' } },
  dataHora: { min: 1, max: 1, fn: (x) => { const d = dataDe(x); return d ? df('dh', { timeZone: FUSO, dateStyle: 'short', timeStyle: 'short' }).format(d) : '' } },
}
