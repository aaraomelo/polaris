import type { Funcoes } from './tipos'

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

export const FUNCOES_PADRAO: Funcoes = {
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
