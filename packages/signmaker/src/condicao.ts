import { DocumentoErro, leCaminho, verdadeiro } from '@polaris/documentos'

// Condições dos elementos (`se`) e das cores (`cores[].se`). Gramática FECHADA, sem avaliador:
//   caminho            verdadeiro se o dado existe e não é vazio/zero/falso       !caminho   o contrário
//   caminho == lit     igualdade com um literal                                    caminho != lit
//   caminho em [a, b]  um dos literais
// literal: "texto" (aspas duplas ou simples), número, true ou false. Comparação por texto (String(valor) === String(literal)).
const CAM = '[A-Za-z_][A-Za-z0-9_]*(?:\\.[A-Za-z0-9_]+)*', LIT = `(?:"[^"\\\\]{0,100}"|'[^'\\\\]{0,100}'|-?\\d{1,15}(?:\\.\\d{1,6})?|true|false)`
const RE_SIMPLES = new RegExp(`^!?${CAM}$`), RE_CMP = new RegExp(`^(${CAM})\\s*(==|!=)\\s*(${LIT})$`), RE_EM = new RegExp(`^(${CAM})\\s+em\\s+\\[\\s*(${LIT}(?:\\s*,\\s*${LIT}){0,19})\\s*\\]$`)
const lit = (s: string) => (/^["']/.test(s) ? s.slice(1, -1) : s)
const lits = (s: string) => [...s.matchAll(new RegExp(LIT, 'g'))].map((m) => lit(m[0]))

export type Condicao = { raiz: string } & ({ tipo: 'simples'; texto: string } | { tipo: 'cmp'; caminho: string; igual: boolean; valor: string } | { tipo: 'em'; caminho: string; valores: string[] })
export function analisaCondicao(expr: string): Condicao {
  const e = expr.trim()
  if (e.length > 300) throw new DocumentoErro('condição longa demais')
  if (RE_SIMPLES.test(e)) return { tipo: 'simples', texto: e, raiz: e.replace(/^!/, '').split('.')[0]! }
  const c = RE_CMP.exec(e); if (c) return { tipo: 'cmp', caminho: c[1]!, igual: c[2] === '==', valor: lit(c[3]!), raiz: c[1]!.split('.')[0]! }
  const m = RE_EM.exec(e); if (m) return { tipo: 'em', caminho: m[1]!, valores: lits(m[2]!), raiz: m[1]!.split('.')[0]! }
  throw new DocumentoErro(`condição inválida: ${e.slice(0, 40)}`)
}
export function avalia(c: Condicao, dados: unknown): boolean {
  if (c.tipo === 'simples') return verdadeiro(c.texto, dados)
  const v = leCaminho(dados, c.caminho), t = v === undefined || v === null ? undefined : String(v)
  if (c.tipo === 'cmp') return (t === c.valor) === c.igual
  return t !== undefined && c.valores.includes(t)
}
