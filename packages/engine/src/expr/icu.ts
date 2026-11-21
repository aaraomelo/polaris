// Mensagens no formato ICU MessageFormat (subconjunto): `{nome}`, `{n, number}`, `{n, plural, =0{…} one{…} other{… #…}}`, `{x, select, a{…} other{…}}`.
// Apóstrofo escapa: `''` é um apóstrofo e `'{…}'` é texto literal. Regras de plural do CLDR vêm do `Intl.PluralRules` (nos servidores e nos navegadores).
// Puro e TOTAL: mensagem malformada ou valor ausente nunca lança; devolve o texto original (ou o argumento como veio). Limites contra mensagens hostis.

type No = string | { arg: string; tipo?: 'number' | 'plural' | 'select'; ramos?: Array<[string, No[]]> }
const MAX_PROF = 6, MAX_TAM = 4000

class ErroIcu extends Error {}

function lerRamos(s: string, i: number, prof: number): { ramos: Array<[string, No[]]>; fim: number } {
  const ramos: Array<[string, No[]]> = []
  for (;;) {
    while (/\s/.test(s[i] ?? '')) i++
    if (s[i] === '}') return { ramos, fim: i }
    const m = /^(=\d+|[A-Za-z_][\w-]*)\s*\{/.exec(s.slice(i)); if (!m) throw new ErroIcu('ramo')
    i += m[0].length
    const r = analisa(s, i, prof + 1, true); ramos.push([m[1]!, r.nos]); i = r.fim + 1
  }
}

function analisa(s: string, i: number, prof: number, ramo: boolean): { nos: No[]; fim: number } {
  if (prof > MAX_PROF) throw new ErroIcu('profundidade')
  const nos: No[] = []; let txt = ''
  const solta = () => { if (txt) { nos.push(txt); txt = '' } }
  while (i < s.length) {
    const c = s[i]!
    if (c === "'") {
      if (s[i + 1] === "'") { txt += "'"; i += 2; continue }
      if (s[i + 1] === '{' || s[i + 1] === '}') { const f = s.indexOf("'", i + 2); if (f < 0) { txt += s.slice(i + 1); i = s.length; continue } txt += s.slice(i + 1, f); i = f + 1; continue }
      txt += c; i++; continue
    }
    if (c === '}') { if (ramo) { solta(); return { nos, fim: i } } throw new ErroIcu('}') }
    if (c === '{') {
      solta()
      const m = /^\{\s*([A-Za-z_][\w.]*)\s*(?:,\s*(number|plural|select)\s*)?/.exec(s.slice(i)); if (!m) throw new ErroIcu('arg')
      i += m[0].length
      if (!m[2]) { if (s[i] !== '}') throw new ErroIcu('fim'); nos.push({ arg: m[1]! }); i++; continue }
      if (m[2] === 'number') { while (/\s/.test(s[i] ?? '')) i++; if (s[i] !== '}') throw new ErroIcu('number'); nos.push({ arg: m[1]!, tipo: 'number' }); i++; continue }
      if (s[i] !== ',') throw new ErroIcu('virgula'); i++
      const r = lerRamos(s, i, prof); if (!r.ramos.some(([k]) => k === 'other')) throw new ErroIcu('other')
      nos.push({ arg: m[1]!, tipo: m[2] as 'plural' | 'select', ramos: r.ramos }); i = r.fim + 1; continue
    }
    txt += c; i++
  }
  if (ramo) throw new ErroIcu('aberto')
  solta(); return { nos, fim: i }
}

const memo = new Map<string, No[] | null>()
const compila = (msg: string): No[] | null => {
  if (msg.length > MAX_TAM) return null
  let r = memo.get(msg)
  if (r === undefined) { try { r = analisa(msg, 0, 0, false).nos } catch (e) { if (!(e instanceof ErroIcu)) throw e; r = null } if (memo.size > 2000) memo.clear(); memo.set(msg, r) }
  return r
}

/** a mensagem é ICU válida (para validar catálogos no compilador)? Devolve o motivo ou `null` */
export function erroDeMensagem(msg: string): string | null {
  if (msg.length > MAX_TAM) return `passa de ${MAX_TAM} caracteres`
  try { analisa(msg, 0, 0, false); return null } catch (e) { if (e instanceof ErroIcu) return `formato ICU inválido (${e.message}): confira as chaves { } e o ramo 'other'`; throw e }
}

const pr = new Map<string, Intl.PluralRules>(), nfm = new Map<string, Intl.NumberFormat>()
const regraPlural = (id: string, n: number): string => { try { let p = pr.get(id); if (!p) { p = new Intl.PluralRules(id); pr.set(id, p) } return p.select(n) } catch { return 'other' } }
const numero = (id: string, n: number): string => { try { let f = nfm.get(id); if (!f) { f = new Intl.NumberFormat(id); nfm.set(id, f) } return f.format(n) } catch { return String(n) } }
const ehNum = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v)
const aNum = (v: unknown): number | undefined => (ehNum(v) ? v : typeof v === 'string' && v.trim() !== '' && Number.isFinite(Number(v)) ? Number(v) : undefined)
const aTexto = (v: unknown): string => (typeof v === 'string' ? v : ehNum(v) ? String(v) : typeof v === 'boolean' ? String(v) : '')

/** Formata a mensagem ICU com os parâmetros no idioma dado. Malformada: devolve a mensagem como está. */
export function formataMensagem(msg: string, params: unknown, id: string): string {
  const nos = compila(msg); if (!nos) return msg
  const p = params && typeof params === 'object' && !Array.isArray(params) ? (params as Record<string, unknown>) : {}
  return geraRamos(nos, p, id, undefined)
}
function geraRamos(nos: No[], p: Record<string, unknown>, id: string, num: number | undefined): string {
  let out = ''
  for (const n of nos) {
    if (typeof n === 'string') { out += num === undefined ? n : n.split('#').join(numero(id, num)); continue }
    const v = Object.prototype.hasOwnProperty.call(p, n.arg) ? p[n.arg] : undefined
    if (!n.tipo) { out += aTexto(v); continue }
    if (n.tipo === 'number') { const x = aNum(v); out += x === undefined ? '' : numero(id, x); continue }
    if (n.tipo === 'plural') {
      const x = aNum(v) ?? 0, ramo = n.ramos!.find(([k]) => k === `=${x}`) ?? n.ramos!.find(([k]) => k === regraPlural(id, x)) ?? n.ramos!.find(([k]) => k === 'other')!
      out += geraRamos(ramo[1], p, id, x); continue
    }
    const k = aTexto(v), ramo = n.ramos!.find(([r]) => r === k) ?? n.ramos!.find(([r]) => r === 'other')!
    out += geraRamos(ramo[1], p, id, num)
  }
  return out
}

/** O texto de um objeto localizado (`{ "pt-BR": …, "en": …, "*": … }`): o idioma exato, depois o idioma-base (`pt-BR` → `pt`), depois qualquer região do mesmo idioma e por fim `*`. */
export function escolheIdioma(entrada: Record<string, unknown>, id: unknown): unknown {
  const l = typeof id === 'string' ? id : ''
  const tem = (k: string) => Object.prototype.hasOwnProperty.call(entrada, k)
  if (l && tem(l)) return entrada[l]
  const base = l.split('-')[0] ?? ''
  if (base && tem(base)) return entrada[base]
  if (base) for (const k of Object.keys(entrada)) if (k.split('-')[0] === base) return entrada[k]
  return tem('*') ? entrada['*'] : undefined
}
