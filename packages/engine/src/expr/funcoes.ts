import * as E from '../estado/caminho'
import { camposDoSchema, elementosDoBloco, percorre, semIds } from './arvore'
import { escolheIdioma, formataMensagem } from './icu'
import { LIMITES_EXPR, type Funcao } from './tipos'

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

/** Patches vindos de dados: forma conferida (op, caminho válido, valores presentes); fora disso, ausente. */
function patchesDe(v: unknown, exigeAntes = false): E.Patch[] | undefined {
  if (!ehLista(v) || v.length > MAX) return undefined
  for (const p of v) {
    if (!ehObj(p) || !E.caminhoValido(p.caminho)) return undefined
    if (p.op === 'add') { if (p.valor === undefined) return undefined }
    else if (p.op === 'remove') { if (exigeAntes && p.antes === undefined) return undefined }
    else if (p.op === 'replace') { if (p.valor === undefined || (exigeAntes && p.antes === undefined)) return undefined }
    else return undefined
  }
  return v as E.Patch[]
}

/** texto → número, o inverso de `numero`/`texto`: decimal com ponto (ou vírgula pt-BR, que vale como ponto) e expoente; nada de hex, Infinity, vazio ou espaço solto. Número finito passa; o resto é ausente. */
const NUM_TEXTO = /^[+-]?(\d+([.,]\d*)?|[.,]\d+)([eE][+-]?\d+)?$/
export const f_paraNumero: Funcao = { min: 1, max: 1, fn: (x) => {
  if (typeof x === 'number') return Number.isFinite(x) ? x : undefined
  if (typeof x !== 'string') return undefined
  const t = x.trim(); if (t.length > 64 || !NUM_TEXTO.test(t)) return undefined
  const n = Number(t.replace(',', '.')); return Number.isFinite(n) ? n : undefined
} }
/** JSON em texto → valor (o inverso de `paraJson`). Só até 200 KB; chaves de protótipo somem; ruim é ausente. */
const PROIBIDAS_JSON = new Set(['__proto__', 'constructor', 'prototype'])
export const f_analisaJson: Funcao = { min: 1, max: 1, fn: (t) => {
  if (typeof t !== 'string' || t.length > 200_000 || !t.trim()) return undefined
  try { return JSON.parse(t, (k, v) => (PROIBIDAS_JSON.has(k) ? undefined : v)) as unknown } catch { return undefined }
} }
/** valor → JSON em texto, com `indentacao` espaços (0 a 8; padrão 2). Só até 200 KB. */
export const f_paraJson: Funcao = { min: 1, max: 2, fn: (v, ind) => {
  const n = ind === undefined ? 2 : typeof ind === 'number' && Number.isInteger(ind) && ind >= 0 && ind <= 8 ? ind : undefined; if (n === undefined) return undefined
  try { const t = JSON.stringify(v, null, n); return typeof t === 'string' && t.length <= 200_000 ? t : undefined } catch { return undefined }
} }
/** divide um texto pelo separador (não vazio). Até 1000 pedaços. */
export const f_divide: Funcao = { min: 2, max: 2, fn: (t, sep) => {
  if (typeof t !== 'string' || typeof sep !== 'string' || sep.length === 0 || t.length > 100_000) return undefined
  const partes = t.split(sep); return partes.length <= 1000 ? partes : undefined
} }
export const f_percorre: Funcao = { min: 2, max: 2, fn: (raiz, chave) => percorre(raiz, chave) }
export const f_camposDoSchema: Funcao = { min: 1, max: 1, fn: (schema) => camposDoSchema(schema) }
export const f_semIds: Funcao = { min: 2, max: 2, fn: (raiz, chave) => semIds(raiz, chave) }
export const f_elementosDoBloco: Funcao = { min: 2, max: 2, fn: (props, schema) => elementosDoBloco(props, schema) }
export const f_igual: Funcao = { min: 2, max: 2, fn: (a, b) => igualProfundo(a, b) }
// árvore de estado imutável, por caminho (lista de chaves de texto e índices): ver src/estado/caminho.ts
export const f_obter: Funcao = { min: 2, max: 3, fn: (x, c, d) => { if (!E.caminhoValido(c)) return undefined; const r = E.obter(x, c); return r === undefined || r === null ? d : r } }
export const f_com: Funcao = { min: 3, max: 3, fn: (x, c, v) => (E.caminhoValido(c) ? E.com(x, c, v) : undefined) }
export const f_sem: Funcao = { min: 2, max: 2, fn: (x, c) => (E.caminhoValido(c) ? E.sem(x, c) : undefined) }
export const f_insere: Funcao = { min: 3, max: 3, fn: (l, i, v) => E.insere(l, i, v) }
export const f_move: Funcao = { min: 3, max: 3, fn: (l, de, para) => E.move(l, de, para) }
export const f_mescla: Funcao = { min: 2, max: 2, fn: (a, b) => E.mescla(a, b) }
export const f_difere: Funcao = { min: 2, max: 2, fn: (a, b) => E.difere(a, b) }
export const f_aplica: Funcao = { min: 2, max: 2, fn: (x, ps) => { const p = patchesDe(ps); return p ? E.aplica(x, p) : undefined } }
export const f_inverso: Funcao = { min: 1, max: 1, fn: (ps) => { const p = patchesDe(ps, true); return p ? E.inverso(p) : undefined } }
export const f_concat: Funcao = { min: 1, max: 16, fn: (...ls) => {
    if (!ls.every(ehLista)) return undefined
    const n = (ls as unknown[][]).reduce((t, l) => t + l.length, 0)
    return n > MAX ? undefined : (ls as unknown[][]).flat(1)
  } }
export const f_achata: Funcao = { min: 1, max: 1, fn: (l) => {
    if (!ehLista(l)) return undefined
    const n = l.reduce<number>((t, x) => t + (ehLista(x) ? x.length : 1), 0)
    return n > MAX ? undefined : l.flat(1)
  } }
export const f_fatia: Funcao = { min: 2, max: 3, fn: (l, i, f) => {
    if (!(ehLista(l) || typeof l === 'string')) return undefined
    const a = inteiro(i), b = f === undefined ? undefined : inteiro(f)
    if (a === undefined || (f !== undefined && b === undefined)) return undefined
    return l.slice(a, b)
  } }
export const f_inverte: Funcao = { min: 1, max: 1, fn: (l) => (ehLista(l) ? [...l].reverse() : undefined) }
export const f_primeiro: Funcao = { min: 1, max: 1, fn: (l) => (ehLista(l) ? l[0] : undefined) }
export const f_ultimo: Funcao = { min: 1, max: 1, fn: (l) => (ehLista(l) ? l[l.length - 1] : undefined) }
export const f_unicos: Funcao = { min: 1, max: 1, fn: (l) => {
    if (!ehLista(l)) return undefined
    const vistos = new Set<string>(), out: unknown[] = []
    for (const x of l) { const c = canonico(x); if (c === null) return undefined; if (!vistos.has(c)) { vistos.add(c); out.push(x) } }
    return out
  } }
export const f_intervalo: Funcao = { min: 1, max: 2, fn: (a, b) => {
    const ini = b === undefined ? 0 : inteiro(a), fim = b === undefined ? inteiro(a) : inteiro(b)
    if (ini === undefined || fim === undefined) return undefined
    if (fim <= ini) return []
    return fim - ini > MAX ? undefined : Array.from({ length: fim - ini }, (_, k) => ini + k)
  } }
export const f_soma: Funcao = { min: 1, max: 1, fn: (l) => {
    if (!ehLista(l) || !l.every((x) => typeof x === 'number' && Number.isFinite(x))) return undefined
    const r = (l as number[]).reduce((t, x) => t + x, 0)
    return Number.isFinite(r) ? r : undefined
  } }
export const f_chaves: Funcao = { min: 1, max: 1, fn: (o) => (ehObj(o) ? chavesOrdenadas(o) : undefined) }
export const f_valores: Funcao = { min: 1, max: 1, fn: (o) => (ehObj(o) ? chavesOrdenadas(o).map((k) => o[k]) : undefined) }
export const f_entradas: Funcao = { min: 1, max: 1, fn: (o) => (ehObj(o) ? chavesOrdenadas(o).map((k) => [k, o[k]]) : undefined) }
export const f_objeto: Funcao = { min: 1, max: 1, fn: (l) => {
    if (!ehLista(l) || l.length > MAX || !l.every((p) => ehLista(p) && p.length === 2 && typeof p[0] === 'string')) return undefined
    return Object.fromEntries(l as Array<[string, unknown]>)
  } }
export const f_tamanho: Funcao = { min: 1, max: 1, fn: (x) => (typeof x === 'string' || Array.isArray(x) ? x.length : x && typeof x === 'object' ? Object.keys(x).length : 0) }
/** `encodeURIComponent` (UTF-8, tudo que não é seguro vira %XX): para montar `?q=` em um link. Texto muito longo (> 2000) e surrogate solto viram vazio, nunca erro. */
export const f_urlcodifica: Funcao = { min: 1, max: 1, fn: (x) => { const t = txt(x); if (t.length > 2000) return ''; try { return encodeURIComponent(t) } catch { return '' } } }
/** tira os acentos (decompõe e remove as marcas): "Café" → "Cafe", "ação" → "acao"; mantém maiúsculas e minúsculas */
export const f_semAcentos: Funcao = { min: 1, max: 1, fn: (x) => txt(x).normalize('NFD').replace(/\p{M}+/gu, '') }
export const f_maiusculas: Funcao = { min: 1, max: 1, fn: (x) => txt(x).toUpperCase() }
export const f_minusculas: Funcao = { min: 1, max: 1, fn: (x) => txt(x).toLowerCase() }
export const f_aparar: Funcao = { min: 1, max: 1, fn: (x) => txt(x).trim() }
export const f_contem: Funcao = { min: 2, max: 2, fn: (a, b) => (typeof a === 'string' ? a.includes(txt(b)) : Array.isArray(a) ? a.includes(b) : false) }
export const f_comeca: Funcao = { min: 2, max: 2, fn: (a, b) => txt(a).startsWith(txt(b)) }
export const f_termina: Funcao = { min: 2, max: 2, fn: (a, b) => txt(a).endsWith(txt(b)) }
export const f_junta: Funcao = { min: 1, max: 2, fn: (l, s) => (Array.isArray(l) ? l.map(txt).join(s === undefined ? ', ' : txt(s)) : '') }
export const f_texto: Funcao = { min: 1, max: 1, fn: (x) => txt(x) }
export const f_numero: Funcao = { min: 1, max: 2, fn: (x, c) => {
    const n = aNum(x)
    return n === undefined ? '' : nf(`n${casas(c, 0)}`, { minimumFractionDigits: 0, maximumFractionDigits: casas(c, 0) }).format(n)
  } }
export const f_arredonda: Funcao = { min: 1, max: 2, fn: (x, c) => { const n = aNum(x); if (n === undefined) return undefined; const f = 10 ** casas(c, 0); return Math.round(n * f) / f } }
export const f_piso: Funcao = { min: 1, max: 1, fn: (x) => { const n = aNum(x); return n === undefined ? undefined : Math.floor(n) } }
export const f_teto: Funcao = { min: 1, max: 1, fn: (x) => { const n = aNum(x); return n === undefined ? undefined : Math.ceil(n) } }
export const f_absoluto: Funcao = { min: 1, max: 1, fn: (x) => { const n = aNum(x); return n === undefined ? undefined : Math.abs(n) } }
export const f_minimo: Funcao = { min: 1, max: 16, fn: (...xs) => { const ns = xs.map(aNum); return ns.some((n) => n === undefined) ? undefined : Math.min(...(ns as number[])) } }
export const f_maximo: Funcao = { min: 1, max: 16, fn: (...xs) => { const ns = xs.map(aNum); return ns.some((n) => n === undefined) ? undefined : Math.max(...(ns as number[])) } }
/** mediana de uma lista de números (a média dos dois do meio quando o tamanho é par); lista vazia ou com não numérico, ausente */
export const f_mediana: Funcao = { min: 1, max: 1, fn: (l) => { if (!Array.isArray(l) || !l.length) return undefined; const ns = l.map(aNum); if (ns.some((n) => n === undefined)) return undefined; const o = (ns as number[]).slice().sort((a, b) => a - b), m = o.length >> 1; return o.length % 2 ? o[m] : (o[m - 1]! + o[m]!) / 2 } }
/** interpolação linear: leva `v` do intervalo [d0, d1] para [r0, r1] (sem cortar); domínio de largura zero, ausente */
export const f_escala: Funcao = { min: 5, max: 5, fn: (v, d0, d1, r0, r1) => { const [a, b, c, d, e] = [v, d0, d1, r0, r1].map(aNum); if ([a, b, c, d, e].some((n) => n === undefined) || c === b) return undefined; return Math.round((d! + ((a! - b!) / (c! - b!)) * (e! - d!)) * 1000) / 1000 } }
/** "enxame" (beeswarm): dada uma lista de objetos com `x` e `r` (posição e raio de um círculo), devolve a mesma lista com `y` acrescentado: o deslocamento vertical que evita sobreposição (distância ≥ r₁ + r₂ + folga), o mais perto possível de 0 */
export const f_enxame: Funcao = { min: 1, max: 2, fn: (itens, folga) => {
  if (!Array.isArray(itens) || itens.length > 2000) return undefined
  const g = aNum(folga) ?? 1, x: number[] = [], r: number[] = []
  for (const it of itens) { if (!it || typeof it !== 'object' || Array.isArray(it)) return undefined; const o = it as Record<string, unknown>, a = aNum(o.x), b = aNum(o.r); if (a === undefined || b === undefined || b < 0) return undefined; x.push(a); r.push(b) }
  const ordem = x.map((_, i) => i).sort((a, b) => x[a]! - x[b]! || a - b), colocados: Array<{ x: number; y: number; r: number }> = [], ys: number[] = new Array(x.length).fill(0)
  for (const i of ordem) {
    const cands = [0]; for (const p of colocados) { const d = r[i]! + p.r + g, dx = x[i]! - p.x; if (Math.abs(dx) < d) { const h = Math.sqrt(d * d - dx * dx); cands.push(p.y + h, p.y - h) } }
    cands.sort((a, b) => Math.abs(a) - Math.abs(b) || b - a)
    let y = cands[cands.length - 1]!; for (const c of cands) if (colocados.every((p) => Math.hypot(x[i]! - p.x, c - p.y) >= r[i]! + p.r + g - 1e-6)) { y = c; break }
    colocados.push({ x: x[i]!, y, r: r[i]! }); ys[i] = Math.round(y * 100) / 100
  }
  return itens.map((it, i) => ({ ...(it as object), y: ys[i] }))
} }
export const f_raiz: Funcao = { min: 1, max: 1, fn: (x) => { const n = aNum(x); return n === undefined || n < 0 ? undefined : Math.sqrt(n) } }
/** número compacto no idioma ("6,7 mi" em pt, "6.7M" em en, "621k"); o prefixo (moeda) é do texto */
export const f_compacto: Funcao = { min: 1, max: 2, fn: (x, idioma) => { const n = aNum(x); if (n === undefined) return ''; const loc = typeof idioma === 'string' && /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(idioma) ? idioma : 'en'; const f = new Intl.NumberFormat(loc, { notation: 'compact', maximumFractionDigits: n >= 1e6 ? 1 : n >= 1e3 ? 0 : 1 }).format(n); return f.replace(/K$/, 'k') } }
/** data curta no idioma ("May 24 ’27", "24 mai ’27") a partir de AAAA-MM-DD */
export const f_dataCurta: Funcao = { min: 1, max: 2, fn: (x, idioma) => { if (typeof x !== 'string' || !/^\d{4}-\d{2}-\d{2}/.test(x)) return ''; const loc = typeof idioma === 'string' && /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(idioma) ? idioma : 'en', d = new Date(`${x.slice(0, 10)}T00:00:00Z`); if (Number.isNaN(d.getTime())) return ''; const p = Object.fromEntries(new Intl.DateTimeFormat(loc, { timeZone: 'UTC', month: 'short', day: 'numeric', year: '2-digit' }).formatToParts(d).map((q) => [q.type, q.value])) as Record<string, string>; const mes = (p.month ?? '').replace(/\.$/, ''); return loc.startsWith('en') ? `${mes} ${p.day} ’${p.year}` : `${p.day} ${mes} ’${p.year}` } }
/** o texto (UTF-8) de bytes em base64, como os que `entrada/arquivo` entrega em `dados`; inválido, vazio */
export const f_textoDeBase64: Funcao = { min: 1, max: 1, fn: (b) => { if (typeof b !== 'string' || b.length > 8_000_000 || !/^[A-Za-z0-9+/]*={0,2}$/.test(b)) return ''; try { const bin = atob(b), bytes = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i); return new TextDecoder('utf-8').decode(bytes).replace(/^\ufeff/, '') } catch { return '' } } }
/** CSV → lista de objetos: a primeira linha dá os nomes das colunas (sem espaços nas pontas); aspas, vírgula/ponto e vírgula/tabulação (detectados na 1ª linha) e quebras dentro de aspas valem; até 5000 linhas e 100 colunas */
export const f_csv: Funcao = { min: 1, max: 1, fn: (t) => {
  if (typeof t !== 'string' || t.length > 5_000_000) return undefined
  const s = t.replace(/^\ufeff/, ''), primeira = s.split(/\r?\n/, 1)[0] ?? '', sep = [',', ';', '\t'].reduce((m, c) => (primeira.split(c).length > primeira.split(m).length ? c : m), ',')
  const linhas: string[][] = []; let campo = '', linha: string[] = [], aspas = false
  const fimCampo = () => { linha.push(campo); campo = '' }, fimLinha = () => { fimCampo(); if (!(linha.length === 1 && linha[0] === '')) linhas.push(linha); linha = [] }
  for (let i = 0; i < s.length; i++) {
    const c = s[i]!
    if (aspas) { if (c === '"') { if (s[i + 1] === '"') { campo += '"'; i++ } else aspas = false } else campo += c }
    else if (c === '"' && campo === '') aspas = true
    else if (c === sep) fimCampo()
    else if (c === '\n') fimLinha()
    else if (c !== '\r') campo += c
    if (linhas.length > 5001) return undefined
  }
  if (campo !== '' || linha.length) fimLinha()
  if (!linhas.length) return []
  const cab = linhas[0]!.map((h) => h.trim()); if (cab.length > 100) return undefined
  return linhas.slice(1).map((l) => Object.fromEntries(cab.map((h, i) => [h, (l[i] ?? '').trim()]).filter(([h]) => h !== '')))
} }
/** lista de objetos → texto CSV com as colunas dadas (a primeira linha são os nomes); aspas quando preciso e proteção contra fórmula de planilha (texto que começa com = + - @ ganha um apóstrofo) */
export const f_csvTexto: Funcao = { min: 2, max: 2, fn: (l, cols) => {
  if (!Array.isArray(l) || !Array.isArray(cols) || l.length > 20000 || cols.length > 100 || cols.some((c) => typeof c !== 'string')) return undefined
  const cel = (v: unknown): string => { let t = v === null || v === undefined ? '' : typeof v === 'object' ? JSON.stringify(v) : String(v); if (typeof v === 'string' && /^[=+\-@\t\r]/.test(t) && Number.isNaN(Number(t))) t = `'${t}`; return /[",\r\n;]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t }
  return [cols.map(cel).join(','), ...l.map((o) => cols.map((c) => cel(o && typeof o === 'object' ? (o as Record<string, unknown>)[c as string] : undefined)).join(','))].join('\r\n')
} }
/** fatia de rosca (ou de pizza com r0 = 0) como caminho SVG: centro, raios interno e externo e ângulos em graus a partir de 12 h, no sentido horário; 360° vira um anel inteiro */
export const f_arco: Funcao = { min: 6, max: 6, fn: (cx, cy, r0, r1, a0, a1) => {
  const [x, y, ri, re, aa, ab] = [cx, cy, r0, r1, a0, a1].map(aNum); if ([x, y, ri, re, aa, ab].some((n) => n === undefined) || ri! < 0 || re! <= ri!) return undefined
  const p = (r: number, a: number) => `${Math.round((x! + r * Math.sin((a * Math.PI) / 180)) * 100) / 100} ${Math.round((y! - r * Math.cos((a * Math.PI) / 180)) * 100) / 100}`
  const varre = Math.min(360, Math.max(0, ab! - aa!)); if (varre === 0) return ''
  const fim = varre >= 359.999 ? aa! + 359.99 : aa! + varre, grande = varre > 180 ? 1 : 0
  const ext = `M${p(re!, aa!)}A${re} ${re} 0 ${grande} 1 ${p(re!, fim)}`
  if (ri === 0) return `${ext}L${x} ${y}Z`
  return `${ext}L${p(ri!, fim)}A${ri} ${ri} 0 ${grande} 0 ${p(ri!, aa!)}Z`
} }
export const f_padrao: Funcao = { min: 2, max: 2, fn: (x, d) => (x === null || x === undefined || x === '' ? d : x) }
// formatadores
export const f_brl: Funcao = { min: 1, max: 1, fn: (x) => { const n = aNum(x); return n === undefined ? '' : nf('brl', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(n) } }
export const f_pct: Funcao = { min: 1, max: 2, fn: (x, c) => { const n = aNum(x); return n === undefined ? '' : nf(`p${casas(c, 0)}`, { minimumFractionDigits: 0, maximumFractionDigits: casas(c, 0) }).format(n * 100) + '%' } }
export const f_data: Funcao = { min: 1, max: 1, fn: (x) => { const d = dataDe(x); return d ? df(typeof x === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(x) ? 'dUTC' : 'dBR', { timeZone: typeof x === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(x) ? 'UTC' : FUSO }).format(d) : '' } }
export const f_dataHora: Funcao = { min: 1, max: 1, fn: (x) => { const d = dataDe(x); return d ? df('dh', { timeZone: FUSO, dateStyle: 'short', timeStyle: 'short' }).format(d) : '' } }


// i18n: `t("chave")` vira, na compilação, `traduz(idioma, {pt-BR: …, en: …, "*": …}, params)` com as mensagens que a página usa; aqui só se escolhe e se formata (ICU).
export const f_traduz: Funcao = { min: 2, max: 3, fn: (idioma, entrada, params) => {
  const m = typeof entrada === 'string' ? entrada : ehObj(entrada) ? escolheIdioma(entrada, idioma) : undefined
  return typeof m === 'string' ? formataMensagem(m, params, typeof idioma === 'string' && idioma ? idioma : 'en') : ''
} }
export const f_loc: Funcao = { min: 2, max: 2, fn: (idioma, v) => (ehObj(v) ? escolheIdioma(v, idioma) : v) }
