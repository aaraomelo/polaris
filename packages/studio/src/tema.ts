import { contraste } from '@polaris/engine/tema'

const PROIBIDOS = new Set(['__proto__', 'constructor', 'prototype'])
/** devolve NOVAS props com o valor trocado; `undefined` remove a chave e poda objetos que ficaram vazios. Não muta a entrada; recusa chaves perigosas. */
function defineValor(props: Record<string, unknown> | undefined, caminho: readonly string[], valor: unknown): Record<string, unknown> {
  if (!caminho.length || caminho.some((k) => PROIBIDOS.has(k))) throw new Error('caminho inválido')
  const aplica = (obj: unknown, i: number): unknown => {
    const atual = obj !== null && typeof obj === 'object' && !Array.isArray(obj) ? (obj as Record<string, unknown>) : {}
    const k = caminho[i]!, copia: Record<string, unknown> = { ...atual }
    if (i === caminho.length - 1) { if (valor === undefined) delete copia[k]; else copia[k] = valor }
    else { const filho = aplica(copia[k], i + 1); if (filho === undefined) delete copia[k]; else copia[k] = filho }
    return Object.keys(copia).length ? copia : undefined
  }
  return (aplica(props ?? {}, 0) as Record<string, unknown> | undefined) ?? {}
}

// Modelo do EDITOR DE TEMA: tokens por grupo, modos (escuro…) como sobrescritas, validação de valores e auditoria de contraste (WCAG) — tudo sobre o nó `tema` puro, sem UI.
export type Tokens = { cor?: Record<string, string>; tipografia?: Record<string, unknown>; espacamento?: Record<string, number | string>; raio?: Record<string, number | string> }
export type Tema = { tokens: Tokens; modos?: Record<string, Partial<Tokens> | Record<string, unknown>> }
export type Grupo = 'cor' | 'tipografia' | 'espacamento' | 'raio'
export const GRUPOS: readonly Grupo[] = ['cor', 'tipografia', 'espacamento', 'raio']
const NOME = /^[A-Za-z0-9][A-Za-z0-9_-]*$/
const HEX = /^#([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i
const FUNC_COR = /^(rgb|rgba|hsl|hsla)\(\s*[-+0-9.%,\s/deg]+\)$/i
const MEDIDA = /^-?\d+(\.\d+)?(px|rem|em|%)?$/
export const ehCor = (v: unknown): v is string => typeof v === 'string' && (HEX.test(v.trim()) || FUNC_COR.test(v.trim()))

/** valida UM valor de token pelo grupo; devolve a mensagem de erro ou undefined */
export function validaToken(grupo: Grupo, nome: string, valor: unknown): string | undefined {
  if (!NOME.test(nome)) return 'nome inválido (letras, números, _ e -)'
  if (grupo === 'cor') return ehCor(valor) ? undefined : 'cor inválida (use #rrggbb, rgb() ou hsl())'
  if (grupo === 'espacamento' || grupo === 'raio') return typeof valor === 'number' ? (Number.isFinite(valor) && valor >= 0 && valor <= 2000 ? undefined : 'fora da faixa (0 a 2000)') : typeof valor === 'string' && MEDIDA.test(valor.trim()) ? undefined : 'use um número ou medida (8, 0.5rem, 12px)'
  return valor === undefined || valor === null ? 'valor ausente' : undefined
}
export function defineToken(tema: Tema, grupo: Grupo, nome: string, valor: unknown, modo?: string): { ok: true; tema: Tema } | { ok: false; erro: string } {
  const e = validaToken(grupo, nome, valor); if (e) return { ok: false, erro: e }
  if (modo !== undefined && !NOME.test(modo)) return { ok: false, erro: 'nome de modo inválido' }
  const base = modo === undefined ? ['tokens', grupo, nome] : ['modos', modo, grupo, nome]
  try { return { ok: true, tema: defineValor(tema as never, base, valor) as Tema } } catch { return { ok: false, erro: 'nome reservado' } }
}
export function removeToken(tema: Tema, grupo: Grupo, nome: string, modo?: string): Tema {
  const t = defineValor(tema as never, modo === undefined ? ['tokens', grupo, nome] : ['modos', modo, grupo, nome], undefined) as Tema
  return t.tokens ? t : { ...t, tokens: {} } // `tokens` é obrigatório no schema
}
export const removeModo = (tema: Tema, modo: string): Tema => { if (!tema.modos || !Object.hasOwn(tema.modos, modo)) return tema; const { [modo]: _m, ...resto } = tema.modos; const { modos: _o, ...sem } = tema; return Object.keys(resto).length ? { ...sem, modos: resto } : sem }

/** tokens efetivos de um modo: a base com as sobrescritas do modo por cima */
export function efetivos(tema: Tema, modo?: string): Tokens {
  const base = structuredClone(tema.tokens) as Record<string, Record<string, unknown>>
  if (modo !== undefined && tema.modos && Object.hasOwn(tema.modos, modo)) for (const [g, m] of Object.entries(tema.modos[modo] as Record<string, Record<string, unknown>>)) if (m && typeof m === 'object') base[g] = { ...(base[g] ?? {}), ...m }
  return base as Tokens
}

/** pares (texto, fundo) a auditar: o que o Polaris usa; só entra o par que existe no modo. Mínimo WCAG AA: 4.5 (texto), 3 (texto grande/UI). */
export const PARES_CONTRASTE: ReadonlyArray<{ par: string; texto: string; fundo: string; minimo: number }> = [
  { par: 'texto/fundo', texto: 'texto', fundo: 'fundo', minimo: 4.5 }, { par: 'texto/superficie', texto: 'texto', fundo: 'superficie', minimo: 4.5 },
  { par: 'textoSuave/fundo', texto: 'textoSuave', fundo: 'fundo', minimo: 4.5 }, { par: 'primaria/fundo', texto: 'primaria', fundo: 'fundo', minimo: 3 },
  { par: 'sucesso/fundo', texto: 'sucesso', fundo: 'fundo', minimo: 3 }, { par: 'alerta/fundo', texto: 'alerta', fundo: 'fundo', minimo: 3 }, { par: 'erro/fundo', texto: 'erro', fundo: 'fundo', minimo: 3 },
]
export type Aviso = { modo: string; par: string; contraste: number; minimo: number }
const hex6 = (c: string): string | undefined => { const m = /^#([0-9a-f]{3})$/i.exec(c.trim()); if (m) return `#${[...m[1]!].map((x) => x + x).join('')}`; return /^#[0-9a-f]{6}$/i.test(c.trim()) ? c.trim() : undefined }
export function auditaContraste(tema: Tema): Aviso[] {
  const out: Aviso[] = []
  for (const modo of ['base', ...Object.keys(tema.modos ?? {})]) {
    const cor = efetivos(tema, modo === 'base' ? undefined : modo).cor ?? {}
    for (const p of PARES_CONTRASTE) { const a = hex6(cor[p.texto] ?? ''), b = hex6(cor[p.fundo] ?? ''); if (!a || !b) continue; const r = contraste(a, b); if (r < p.minimo) out.push({ modo, par: p.par, contraste: Math.round(r * 100) / 100, minimo: p.minimo }) }
  }
  return out
}
