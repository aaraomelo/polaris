import type { Font } from 'opentype.js'

/** largura do texto em pt, SEM kerning nem ligaduras (o pdf-lib não os desenha; o HTML os desliga): é o que mantém as saídas iguais */
export const largura = (f: Font, t: string, tam: number) => f.getAdvanceWidth(t, tam, { kerning: false, features: { liga: false, rlig: false, clig: false } })
/** altura natural de uma linha, por pt de fonte (ascendente + descendente) e a parte acima da linha de base */
export const metricas = (f: Font) => { const asc = f.ascender / f.unitsPerEm, desc = -f.descender / f.unitsPerEm; return { ascender: asc, alturaNatural: asc + desc } }

/** quebra gulosa por palavras (respeita \n); com `nenhuma`, cada parágrafo é uma linha só. Palavra maior que a caixa fica inteira: é o ajuste de fonte que a faz caber. */
export function quebraLinhas(f: Font, texto: string, tam: number, max: number, modo: 'normal' | 'nenhuma'): string[] {
  const out: string[] = []
  for (const par of texto.split('\n')) {
    const palavras = par.split(/\s+/).filter(Boolean)
    if (modo === 'nenhuma') { out.push(palavras.join(' ')); continue }
    let atual = ''
    for (const p of palavras) {
      const teste = atual ? `${atual} ${p}` : p
      if (!atual || largura(f, teste, tam) <= max) atual = teste
      else { out.push(atual); atual = p }
    }
    out.push(atual)
  }
  return out.filter((l) => l !== '')
}

export type Ajuste = { tamanho: number; linhas: string[]; cabe: boolean; alturaLinha: number; ascender: number }
const PASSO = 0.25
/** o MAIOR tamanho (em passos de 0,25 pt) em que o texto cabe na caixa; se nem o mínimo cabe, usa o mínimo e diz `cabe: false` (o layout avisa). Busca binária: caber é monotônico. */
export function ajusta(f: Font, texto: string, w: number, h: number, modo: 'normal' | 'nenhuma', min: number, max: number): Ajuste {
  const m = metricas(f)
  const cabeEm = (t: number) => { const ls = quebraLinhas(f, texto, t, w, modo); return ls.length > 0 && ls.length * m.alturaNatural * t <= h + 1e-6 && ls.every((l) => largura(f, l, t) <= w + 1e-6) }
  let lo = Math.round(min / PASSO), hi = Math.round(max / PASSO)
  if (!cabeEm(lo * PASSO)) { const t = lo * PASSO; return { tamanho: t, linhas: quebraLinhas(f, texto, t, w, modo), cabe: false, alturaLinha: m.alturaNatural * t, ascender: m.ascender } }
  while (lo < hi) { const mid = Math.ceil((lo + hi) / 2); if (cabeEm(mid * PASSO)) lo = mid; else hi = mid - 1 }
  const t = lo * PASSO
  return { tamanho: t, linhas: quebraLinhas(f, texto, t, w, modo), cabe: true, alturaLinha: m.alturaNatural * t, ascender: m.ascender }
}
