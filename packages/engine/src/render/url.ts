// URL segura para href/src. Módulo puro (sem React): o caminho estático também o usa.

const SCHEMES_OK = new Set(['http:', 'https:', 'mailto:', 'tel:'])

/**
 * URL segura para href/src: relativa ou com esquema permitido. Bloqueia javascript:, data:, vbscript: etc.
 *
 * ATENÇÃO ao que se devolve: o parser de URL do navegador só descarta, nas pontas, controles C0 e espaço (U+0000–U+0020).
 * O `trim()` do JavaScript remove MAIS (NBSP, U+2028, BOM, espaços Unicode): "\u00a0javascript:x" é uma URL relativa
 * inofensiva para o navegador, mas depois de `trim()` vira "javascript:x", executável. Por isso só se apara o que o
 * navegador apara.
 */
export function urlSegura(v: unknown): string | undefined {
  if (typeof v !== 'string') return undefined
  // navegadores ignoram espaços e controles dentro do esquema ("java\nscript:"): para DETECTAR o esquema, removemos todos (conservador)
  const limpa = v.replace(/[\u0000-\u0020\u007f-\u009f]/g, '')
  if (!limpa) return undefined
  const m = /^([a-zA-Z][a-zA-Z0-9+.-]*:)/.exec(limpa)
  if (m && !SCHEMES_OK.has(m[1]!.toLowerCase())) return undefined
  return v.replace(/^[\u0000-\u0020]+|[\u0000-\u0020]+$/g, '') // exatamente o que o navegador apara
}

/** uma URL já considerada segura, escrita como `url("…")` de CSS: aspas, parênteses e contrabarra viram escapes de URL (nada fecha o `url(` nem a declaração) */
export const cssUrl = (u: string): string => `url("${encodeURI(u).replace(/["'()\\]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)}")`
