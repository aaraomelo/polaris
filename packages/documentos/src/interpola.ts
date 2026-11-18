import { FILTROS, textoDe } from './formatos'

// Interpolação SEGURA: `{caminho.a.0.b | filtro | filtro:2}`. Não há avaliador de expressões, nem chamada de função, nem acesso a protótipo: só caminho em dados (propriedades
// PRÓPRIAS) e filtros de uma lista fechada. Texto de template inválido é erro de AUTORIA e quebra a geração (fail-closed): nunca sai um papel com pedaço de template.

export class DocumentoErro extends Error { constructor(mensagem: string, readonly caminho?: string) { super(mensagem); this.name = 'DocumentoErro' } }

export type Token = { lit: string } | { caminho: string; filtros: Array<{ nome: string; arg?: number }> }
const PROIBIDOS = new Set(['__proto__', 'constructor', 'prototype'])
const CAMINHO = /^[A-Za-z_][A-Za-z0-9_]*(\.[A-Za-z0-9_]+)*$/
const MAX_TEMPLATE = 4000

export function analisa(template: string): Token[] {
  if (template.length > MAX_TEMPLATE) throw new DocumentoErro(`template com mais de ${MAX_TEMPLATE} caracteres`)
  const out: Token[] = []; let lit = ''
  for (let i = 0; i < template.length; i++) {
    const c = template[i]!
    if (c === '\\' && (template[i + 1] === '{' || template[i + 1] === '}' || template[i + 1] === '\\')) { lit += template[++i]; continue }
    if (c === '}') throw new DocumentoErro('"}" sem "{" (para um "}" literal escreva \\})')
    if (c !== '{') { lit += c; continue }
    const fim = template.indexOf('}', i); if (fim < 0) throw new DocumentoErro('"{" sem "}" (para um "{" literal escreva \\{)')
    const corpo = template.slice(i + 1, fim); if (corpo.includes('{')) throw new DocumentoErro('"{" dentro de um binding')
    const [cam, ...fs] = corpo.split('|').map((s) => s.trim())
    if (!cam || !CAMINHO.test(cam)) throw new DocumentoErro(`caminho inválido em "{${corpo.slice(0, 40)}}": use letras, números, _ e pontos`)
    if (cam.split('.').some((p) => PROIBIDOS.has(p))) throw new DocumentoErro(`caminho proibido: ${cam}`)
    const filtros = fs.map((f) => {
      const [nome, arg, ...resto] = f.split(':').map((s) => s.trim()); const def = nome ? FILTROS[nome] : undefined
      if (!def) throw new DocumentoErro(`filtro desconhecido "${(nome ?? '').slice(0, 20)}" (use ${Object.keys(FILTROS).join(', ')})`)
      if (resto.length || (def.args === 0) !== (arg === undefined)) throw new DocumentoErro(`o filtro ${nome} ${def.args ? 'exige' : 'não aceita'} um argumento numérico`)
      if (arg !== undefined && !/^\d{1,4}$/.test(arg)) throw new DocumentoErro(`argumento inválido do filtro ${nome}`)
      return { nome: nome!, ...(arg !== undefined ? { arg: Number(arg) } : {}) }
    })
    if (lit) { out.push({ lit }); lit = '' }
    out.push({ caminho: cam, filtros }); i = fim
  }
  if (lit) out.push({ lit })
  return out
}

/** o valor num caminho dos dados: só propriedades próprias, índice de lista, nada de protótipo */
export function leCaminho(dados: unknown, caminho: string): unknown {
  let cur: unknown = dados
  for (const p of caminho.split('.')) {
    if (PROIBIDOS.has(p) || cur === null || cur === undefined) return undefined
    if (Array.isArray(cur)) { if (!/^\d{1,6}$/.test(p)) return undefined; cur = cur[Number(p)] }
    else if (typeof cur === 'object') { if (!Object.hasOwn(cur, p)) return undefined; cur = (cur as Record<string, unknown>)[p] }
    else return undefined
  }
  return cur
}

/** Texto limpo para papel: sem controle (exceto \n), sem sobreposição bidirecional (spoofing de "valor") e com tamanho limitado. */
export function limpa(s: string, max = 20_000): string {
  return s.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0009\u000b-\u001f\u007f-\u009f\u200b-\u200f\u202a-\u202e\u2066-\u2069\ufeff]/g, '').slice(0, max)
}

export function interpola(template: string | undefined, dados: unknown): string {
  if (template === undefined) return ''
  let s = ''
  for (const t of analisa(template)) {
    if ('lit' in t) { s += t.lit; continue }
    let v = leCaminho(dados, t.caminho)
    if (t.filtros.length) { for (const f of t.filtros) v = FILTROS[f.nome]!.aplica(v, f.arg) } else v = textoDe(v)
    s += typeof v === 'string' ? v : textoDe(v)
  }
  return limpa(s)
}

/** quais raízes de dados um template usa (para conferir contra `spec.dados`) */
export const raizesDe = (template: string): string[] => analisa(template).flatMap((t) => ('caminho' in t ? [t.caminho.split('.')[0]!] : []))

/** verdadeiro/falso de um `se`: texto não vazio (e que não seja um zero decimal como "0.00"), número ≠ 0, `true`, lista/objeto não vazios; `!x` nega */
export function verdadeiro(cond: string, dados: unknown): boolean {
  const neg = cond.startsWith('!'), cam = neg ? cond.slice(1) : cond
  if (!CAMINHO.test(cam) || cam.split('.').some((p) => PROIBIDOS.has(p))) throw new DocumentoErro(`condição inválida: ${cond.slice(0, 40)}`)
  const v = leCaminho(dados, cam)
  const r = typeof v === 'string' ? v.trim() !== '' && !/^[+-]?0+(\.0+)?$/.test(v.trim()) : typeof v === 'number' ? v !== 0 && Number.isFinite(v) : typeof v === 'boolean' ? v : Array.isArray(v) ? v.length > 0 : v !== null && typeof v === 'object' ? Object.keys(v).length > 0 : false
  return neg ? !r : r
}
