import { cmp, parse as parseQ, type Q } from '../num/racional'

// Tipos e formatos brasileiros do formulário: CPF/CNPJ com dígito verificador, CEP, telefone com DDD, e-mail, URL, datas reais e dinheiro EXATO (decimal em texto, sem ponto flutuante).

export type Normaliza = 'aparar' | 'colapsaEspacos' | 'minusculas' | 'maiusculas' | 'capitaliza' | 'semAcentos' | 'apenasDigitos' | 'apenasLetras'
const FUNCOES: Record<Normaliza, (s: string) => string> = {
  aparar: (s) => s.trim(),
  colapsaEspacos: (s) => s.replace(/\s+/g, ' '),
  minusculas: (s) => s.toLowerCase(),
  maiusculas: (s) => s.toUpperCase(),
  capitaliza: (s) => s.toLowerCase().replace(/(^|\s|-)(\p{L})/gu, (_m, a: string, b: string) => a + b.toUpperCase()),
  semAcentos: (s) => s.normalize('NFD').replace(/\p{M}/gu, ''),
  apenasDigitos: (s) => s.replace(/\D/g, ''),
  apenasLetras: (s) => s.replace(/[^\p{L}\s]/gu, ''),
}
export const normalizaTexto = (s: string, lista: readonly Normaliza[] = []): string => lista.reduce((t, n) => FUNCOES[n]!(t), s)

const digitos = (s: string) => s.replace(/\D/g, '')
const todosIguais = (d: string) => /^(\d)\1+$/.test(d)

export function cpfValido(v: string): boolean {
  const d = digitos(v); if (d.length !== 11 || todosIguais(d)) return false
  const dv = (n: number) => { let s = 0; for (let i = 0; i < n; i++) s += Number(d[i]) * (n + 1 - i); const r = (s * 10) % 11; return r === 10 ? 0 : r }
  return dv(9) === Number(d[9]) && dv(10) === Number(d[10])
}
export function cnpjValido(v: string): boolean {
  const d = digitos(v); if (d.length !== 14 || todosIguais(d)) return false
  const dv = (n: number) => { const pesos = n === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2]; let s = 0; for (let i = 0; i < n; i++) s += Number(d[i]) * pesos[i]!; const r = s % 11; return r < 2 ? 0 : 11 - r }
  return dv(12) === Number(d[12]) && dv(13) === Number(d[13])
}
export const cepValido = (v: string) => digitos(v).length === 8 && !/^0{8}$/.test(digitos(v))
/** telefone com DDD (11 a 99): 10 dígitos (fixo) ou 11 (celular, que começa com 9 depois do DDD) */
export function telefoneValido(v: string): boolean {
  const d = digitos(v); if (d.length !== 10 && d.length !== 11) return false
  const ddd = Number(d.slice(0, 2)); if (ddd < 11 || ddd > 99) return false
  return d.length === 11 ? d[2] === '9' : /^[2-9]/.test(d[2]!)
}
export const emailValido = (v: string) => v.length <= 254 && /^[^\s@<>()[\]\\,;:"]{1,64}@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/i.test(v)
export function urlValida(v: string): boolean {
  if (v.length > 2048 || /[\s\u0000-\u001f]/.test(v)) return false
  try { const u = new URL(v); return (u.protocol === 'http:' || u.protocol === 'https:') && u.hostname.includes('.') } catch { return false }
}

// ---- datas e horas ---------------------------------------------------------------------------------------------------------------------------
const bissexto = (a: number) => (a % 4 === 0 && a % 100 !== 0) || a % 400 === 0
const diasDoMes = (a: number, m: number) => [31, bissexto(a) ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][m - 1]!
export function dataIsoValida(s: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s); if (!m) return false
  const a = Number(m[1]), mes = Number(m[2]), d = Number(m[3]); return a >= 1 && mes >= 1 && mes <= 12 && d >= 1 && d <= diasDoMes(a, mes)
}
export type FormatoData = 'dd/MM/yyyy' | 'yyyy-MM-dd' | 'MM/dd/yyyy'
/** lê a data como o visitante digitou (`dd/MM/yyyy` por padrão) e devolve ISO (`yyyy-MM-dd`), ou null se não for uma data real */
export function paraDataIso(s: string, formato: FormatoData = 'dd/MM/yyyy'): string | null {
  const t = s.trim(); if (dataIsoValida(t)) return t
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(t); if (!m) return null
  const [d, mes] = formato === 'MM/dd/yyyy' ? [m[2]!, m[1]!] : [m[1]!, m[2]!]
  const iso = `${m[3]}-${mes.padStart(2, '0')}-${d.padStart(2, '0')}`; return dataIsoValida(iso) ? iso : null
}
export function exibeData(iso: string, formato: FormatoData = 'dd/MM/yyyy'): string {
  if (!dataIsoValida(iso)) return iso
  const [a, m, d] = iso.split('-') as [string, string, string]; return formato === 'yyyy-MM-dd' ? iso : formato === 'MM/dd/yyyy' ? `${m}/${d}/${a}` : `${d}/${m}/${a}`
}
export const horaValida = (s: string) => /^([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?$/.test(s)
export function dataHoraValida(s: string): boolean { const m = /^(\d{4}-\d{2}-\d{2})[T ]([01]\d|2[0-3]):[0-5]\d(:[0-5]\d)?(\.\d+)?(Z|[+-]\d{2}:\d{2})?$/.exec(s); return !!m && dataIsoValida(m[1]!) }
/** `hoje`, `hoje+30d`, `hoje-18a`, `hoje+2m` ou uma data ISO → ISO, a partir de `hojeIso` (a data do SERVIDOR: o relógio do visitante não decide) */
export function resolveDataRef(ref: string, hojeIso: string): string | null {
  if (dataIsoValida(ref)) return ref
  const m = /^hoje(?:([+-])(\d{1,4})([dma]))?$/.exec(ref); if (!m) return null
  if (!m[1]) return hojeIso
  const [a, mes, d] = hojeIso.split('-').map(Number) as [number, number, number], n = Number(m[2]) * (m[1] === '-' ? -1 : 1)
  if (m[3] === 'd') { const t = new Date(Date.UTC(a, mes - 1, d + n)); return t.toISOString().slice(0, 10) }
  let ano = a, mm = mes + (m[3] === 'm' ? n : 0); if (m[3] === 'a') ano += n
  ano += Math.floor((mm - 1) / 12); mm = ((mm - 1) % 12 + 12) % 12 + 1
  const dd = Math.min(d, diasDoMes(ano, mm)); return `${String(ano).padStart(4, '0')}-${String(mm).padStart(2, '0')}-${String(dd).padStart(2, '0')}`
}

// ---- números e dinheiro (decimal EXATO em texto) -----------------------------------------------------------------------------------------------
/** lê o que o visitante digitou ("1.234,56", "1234.56", "R$ 12,5") e devolve o decimal canônico ("1234.56"), ou null. `separadorDecimal` padrão: vírgula. */
export function lerDecimal(s: string, separadorDecimal: ',' | '.' = ','): string | null {
  let t = s.trim().replace(/^R\$\s*|^US\$\s*|^\$\s*|^€\s*/i, '').replace(/\s+/g, '')
  if (!t) return null
  const neg = t.startsWith('-'); if (neg || t.startsWith('+')) t = t.slice(1)
  const milhar = separadorDecimal === ',' ? '.' : ','
  if (t.includes(separadorDecimal)) { if (t.split(separadorDecimal).length > 2) return null; const [i, f] = t.split(separadorDecimal) as [string, string]; if (!/^\d+$/.test(f) ) return null; t = `${i.split(milhar).join('')}.${f}`; if (!/^\d+\.\d+$/.test(t)) return null }
  else { t = t.split(milhar).join(''); if (!/^\d+$/.test(t)) return null }
  t = t.replace(/^0+(?=\d)/, '').replace(/(\.\d*?)0+$/, '$1').replace(/\.$/, '')
  return (neg && !/^0(\.0*)?$/.test(t) ? '-' : '') + t
}
export const casasDe = (decimal: string) => (decimal.split('.')[1] ?? '').length
/** compara dois decimais EXATOS ("0.1" < "0.10000000001"): -1, 0, 1, ou null se algum não é decimal */
export function comparaDecimais(a: string, b: string): -1 | 0 | 1 | null { const x: Q | undefined = parseQ(a), y: Q | undefined = parseQ(b); return x && y ? cmp(x, y) : null }
export function exibeDecimal(decimal: string, o: { casasDecimais?: number; separadorDecimal?: ',' | '.'; agrupaMilhar?: boolean; prefixo?: string; sufixo?: string } = {}): string {
  const neg = decimal.startsWith('-'), [i0, f0 = ''] = decimal.replace('-', '').split('.') as [string, string?]
  const casas = o.casasDecimais ?? f0.length, f = (f0 + '0'.repeat(casas)).slice(0, casas), sep = o.separadorDecimal ?? ','
  const i = o.agrupaMilhar ? i0.replace(/\B(?=(\d{3})+(?!\d))/g, sep === ',' ? '.' : ',') : i0
  return `${neg ? '-' : ''}${o.prefixo ?? ''}${i}${casas > 0 ? sep + f : ''}${o.sufixo ?? ''}`
}
export const SIMBOLO_MOEDA = { BRL: 'R$ ', USD: 'US$ ', EUR: '€ ' } as const
