// Padrões de rota: "/produtos/:id", "/docs/*resto", "/". Validados na compilação, nunca na requisição.

export type Segmento = { t: 'est'; v: string } | { t: 'par'; nome: string } | { t: 'resto'; nome: string }

export class RotaErro extends Error {
  constructor(mensagem: string, readonly dica?: string) {
    super(mensagem)
    this.name = 'RotaErro'
  }
}

const ESTATICO = /^[\p{L}\p{N}._~-]+$/u
export const MAX_SEGMENTOS = 16
export const MAX_COMPRIMENTO_ROTA = 512

/** Faz o parse de um padrão. Lança RotaErro com a causa e uma dica. */
export function parseRota(p: string): Segmento[] {
  if (typeof p !== 'string' || !p.startsWith('/')) throw new RotaErro("a rota deve começar com '/'", 'ex.: /produtos/:id')
  if (p.length > MAX_COMPRIMENTO_ROTA) throw new RotaErro(`rota longa demais (mais de ${MAX_COMPRIMENTO_ROTA} caracteres)`)
  if (p === '/') return []
  if (p.endsWith('/')) throw new RotaErro("a rota não pode terminar com '/'", 'remova a barra final: o roteador redireciona /x/ para /x')
  const partes = p.slice(1).split('/')
  if (partes.length > MAX_SEGMENTOS) throw new RotaErro(`rota com mais de ${MAX_SEGMENTOS} segmentos`)
  const nomes = new Set<string>()
  return partes.map((s, i): Segmento => {
    if (s === '') throw new RotaErro("segmento vazio ('//')", 'remova a barra duplicada')
    if (s === '.' || s === '..') throw new RotaErro(`segmento '${s}' não é permitido`)
    if (s.startsWith(':') || s.startsWith('*')) {
      const nome = s.slice(1)
      if (!/^[a-z][A-Za-z0-9]*$/.test(nome)) throw new RotaErro(`nome de parâmetro inválido em '${s}'`, 'use camelCase começando por minúscula, ex.: :produtoId')
      if (nomes.has(nome)) throw new RotaErro(`o parâmetro '${nome}' aparece duas vezes`)
      nomes.add(nome)
      if (s.startsWith('*')) {
        if (i !== partes.length - 1) throw new RotaErro(`o catch-all '${s}' só pode ser o último segmento`)
        return { t: 'resto', nome }
      }
      return { t: 'par', nome }
    }
    if (!ESTATICO.test(s)) throw new RotaErro(`segmento '${s}' tem caracteres não permitidos`, "use letras, números, '.', '_', '-' e '~'")
    return { t: 'est', v: s }
  })
}

export const nomesParams = (segs: readonly Segmento[]): string[] => segs.flatMap((s) => (s.t === 'est' ? [] : [s.nome]))

/** Assinatura estrutural: duas rotas com a mesma forma (mesmo que os nomes dos parâmetros difiram) são ambíguas. */
export const forma = (segs: readonly Segmento[]): string => segs.map((s) => (s.t === 'est' ? `e:${s.v}` : s.t === 'par' ? ':' : '*')).join('/') || '/'

const RANK = { est: 0, par: 1, resto: 2 } as const

/** Ordem de tentativa: segmento estático antes de parâmetro antes de catch-all, da esquerda para a direita. */
export function cmpEspecificidade(a: readonly Segmento[], b: readonly Segmento[]): number {
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    const d = RANK[a[i]!.t] - RANK[b[i]!.t]
    if (d !== 0) return d
  }
  return a.length - b.length
}

/** Valor de parâmetro aceitável: sem barra, sem controle, sem '.'/'..'. Simétrico em casa() e urlDe(). */
export function valorSeguro(v: string): boolean {
  return v.length > 0 && v.length <= 256 && v !== '.' && v !== '..' && !/[/\\\u0000-\u001f\u007f]/.test(v)
}

/** Monta um caminho a partir de um padrão e valores já validados, codificando cada segmento. */
export function montaCaminho(segs: readonly Segmento[], valores: Record<string, string | string[]>): string {
  if (!segs.length) return '/'
  return '/' + segs.map((s) => (s.t === 'est' ? encodeURIComponent(s.v) : s.t === 'par' ? encodeURIComponent(String(valores[s.nome])) : (valores[s.nome] as string[]).map(encodeURIComponent).join('/'))).join('/')
}
