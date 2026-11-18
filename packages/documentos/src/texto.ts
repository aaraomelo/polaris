import type { Font } from 'opentype.js'

export const metricas = (f: Font) => { const asc = f.ascender / f.unitsPerEm, desc = -f.descender / f.unitsPerEm; return { ascender: asc, alturaNatural: asc + desc } }
export const largura = (f: Font, t: string, tam: number) => f.getAdvanceWidth(t, tam, { kerning: false, features: { liga: false, rlig: false, clig: false } })

/** Quebra gulosa. Respeita \n. Palavra maior que a largura vai inteira e é CORTADA em pedaços que cabem (nunca vaza da caixa nem da página). */
export function quebra(f: Font, texto: string, tam: number, max: number): string[] {
  const out: string[] = []
  for (const par of texto.split('\n')) {
    if (par === '') { out.push(''); continue }
    let atual = ''
    const empurra = (s: string) => { if (s.trim()) out.push(s.trim()) }
    for (const tok of par.split(/(\s+)/).filter((t) => t.length > 0)) {
      const espaco = /^\s+$/.test(tok)
      if (largura(f, atual + tok, tam) <= max) { atual += tok; continue }
      if (espaco) { empurra(atual); atual = ''; continue }
      empurra(atual); atual = ''
      let resto = Array.from(tok)
      while (resto.length && largura(f, resto.join(''), tam) > max) {
        let n = resto.length; while (n > 1 && largura(f, resto.slice(0, n).join(''), tam) > max) n--
        out.push(resto.slice(0, n).join('')); resto = resto.slice(n)
      }
      atual = resto.join('')
    }
    empurra(atual)
  }
  return out.length ? out : ['']
}
