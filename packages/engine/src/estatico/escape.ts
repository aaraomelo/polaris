// Escape idêntico ao do React DOM Server (medido): & < > " '  → entidades; o resto passa (inclusive NBSP e U+2028).
const MAPA: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#x27;' }
const RE = /["&'<>]/g
const PRECISA = /["&'<>]/

export const escHtml = (s: string): string => (PRECISA.test(s) ? s.replace(RE, (c) => MAPA[c]!) : s)

/** Valor numérico em `style`: como o React, 0 fica `0` e os demais ganham `px`. */
export const px = (n: number): string => (n === 0 ? '0' : `${n}px`)
