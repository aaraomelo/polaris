// Filtros de interpolação. Dinheiro e números são formatados por ARITMÉTICA DECIMAL EXATA sobre o texto (nunca por `Number`/`toLocaleString`): `49.90` sai `R$ 49,90`, e
// `0.105` arredonda para `R$ 0,11` (meio para cima, longe do zero) — float daria `0,10` ou `0,11` conforme a representação binária.
// Datas: uma data pura (`2026-06-08`) NÃO sofre fuso (new Date('2026-06-08') escorregaria um dia); instante com hora é mostrado em UTC−3 (Brasília, sem horário de verão desde 2019).

const DEC = /^([+-]?)(\d{1,30})(?:\.(\d{1,30}))?$/

/** o valor como texto decimal canônico, ou null se não é um número finito simples (sem notação científica) */
export function decimalTexto(v: unknown): string | null {
  if (typeof v === 'number') { if (!Number.isFinite(v)) return null; const s = Math.abs(v) < 1e21 && Math.abs(v) >= 1e-6 || v === 0 ? String(v) : v.toFixed(12); return DEC.test(s) ? s : null }
  if (typeof v === 'string') { const s = v.trim(); return DEC.test(s) ? s : null }
  if (typeof v === 'bigint') return String(v)
  return null
}

/** arredonda um decimal em texto para `casas` (meio para cima, em módulo) e devolve [sinal, inteiro, fração] */
function arredonda(txt: string, casas: number): { neg: boolean; int: string; frac: string } | null {
  const m = DEC.exec(txt); if (!m) return null
  const neg = m[1] === '-', int = m[2]!, frac = (m[3] ?? '').padEnd(casas + 1, '0')
  let digitos = BigInt(int + frac.slice(0, casas)); if (frac.charCodeAt(casas) - 48 >= 5) digitos += 1n
  const s = digitos.toString().padStart(casas + 1, '0'), i = s.slice(0, s.length - casas), f = s.slice(s.length - casas)
  return { neg: neg && (BigInt(i) !== 0n || /[1-9]/.test(f)), int: i, frac: f } // "-0,00" não existe
}
const milhares = (i: string) => i.replace(/\B(?=(\d{3})+(?!\d))/g, '.')

export const brl = (v: unknown): string => { const t = decimalTexto(v); const r = t ? arredonda(t, 2) : null; return r ? `${r.neg ? '-' : ''}R$ ${milhares(r.int)},${r.frac}` : '' }
export const num = (v: unknown, casas = 0): string => { const t = decimalTexto(v); const r = t ? arredonda(t, Math.min(Math.max(casas, 0), 6)) : null; return r ? `${r.neg ? '-' : ''}${milhares(r.int)}${r.frac ? `,${r.frac}` : ''}` : '' }

const ISO_DATA = /^(\d{4})-(\d{2})-(\d{2})$/, ISO_HORA = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?$/
const dd = (n: number) => String(n).padStart(2, '0')
function dataValida(a: number, m: number, d: number): boolean { const x = new Date(Date.UTC(a, m - 1, d)); return x.getUTCFullYear() === a && x.getUTCMonth() === m - 1 && x.getUTCDate() === d }
/** instante → partes em UTC−3 */
function emBrasilia(v: string): { a: number; m: number; d: number; h: number; mi: number } | null {
  const m = ISO_HORA.exec(v.trim()); if (!m || !dataValida(+m[1]!, +m[2]!, +m[3]!)) return null
  const zona = m[7]; const base = Date.UTC(+m[1]!, +m[2]! - 1, +m[3]!, +m[4]!, +m[5]!, +(m[6] ?? 0))
  const off = !zona ? -180 : zona === 'Z' ? 0 : (zona[0] === '-' ? -1 : 1) * (+zona.slice(1, 3) * 60 + +zona.slice(-2)) // sem zona = já é hora de Brasília
  const utc = zona ? base - off * 60_000 : base + 180 * 60_000
  const x = new Date(utc - 180 * 60_000); return { a: x.getUTCFullYear(), m: x.getUTCMonth() + 1, d: x.getUTCDate(), h: x.getUTCHours(), mi: x.getUTCMinutes() }
}
export function data(v: unknown): string {
  if (typeof v !== 'string') return ''
  const p = ISO_DATA.exec(v.trim()); if (p) return dataValida(+p[1]!, +p[2]!, +p[3]!) ? `${p[3]}/${p[2]}/${p[1]}` : ''
  const b = emBrasilia(v); return b ? `${dd(b.d)}/${dd(b.m)}/${b.a}` : ''
}
export function datahora(v: unknown): string { if (typeof v !== 'string') return ''; const b = emBrasilia(v); return b ? `${dd(b.d)}/${dd(b.m)}/${b.a} ${dd(b.h)}:${dd(b.mi)}` : '' }
export function cpfcnpj(v: unknown): string {
  const d = String(v ?? '').replace(/\D/g, '')
  if (d.length === 11) return `${d.slice(0, 3)}.${d.slice(3, 6)}.${d.slice(6, 9)}-${d.slice(9)}`
  if (d.length === 14) return `${d.slice(0, 2)}.${d.slice(2, 5)}.${d.slice(5, 8)}/${d.slice(8, 12)}-${d.slice(12)}`
  return typeof v === 'string' ? v : ''
}
const texto = (v: unknown): string => (typeof v === 'string' ? v : typeof v === 'number' && Number.isFinite(v) ? String(v) : typeof v === 'boolean' ? (v ? 'sim' : 'não') : '')

/** os filtros que um template pode usar (lista FECHADA: nome fora dela é erro de autoria) */
export const FILTROS: Record<string, { args: number; aplica: (v: unknown, arg?: number) => string }> = {
  brl: { args: 0, aplica: (v) => brl(v) },
  num: { args: 1, aplica: (v, a) => num(v, a ?? 0) },
  data: { args: 0, aplica: (v) => data(v) },
  datahora: { args: 0, aplica: (v) => datahora(v) },
  upper: { args: 0, aplica: (v) => texto(v).toLocaleUpperCase('pt-BR') },
  lower: { args: 0, aplica: (v) => texto(v).toLocaleLowerCase('pt-BR') },
  cpfcnpj: { args: 0, aplica: (v) => cpfcnpj(v) },
  trunc: { args: 1, aplica: (v, a) => { const t = Array.from(texto(v)); const n = Math.min(Math.max(Math.trunc(a ?? 0), 1), 2000); return t.length > n ? `${t.slice(0, n - 1).join('')}…` : t.join('') } },
}
export { texto as textoDe }
