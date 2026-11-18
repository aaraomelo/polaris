import { caminhoDeId, type Inst } from './arvore'

// Comentários sobre um nó (página, tema…), opcionalmente ANCORADOS num bloco pelo id. Fios = comentário raiz + respostas. A âncora segue o bloco por identidade:
// se o bloco some da página, o comentário vira ÓRFÃO (continua legível, aponta para o que já foi) — nunca é apagado nem reancorado em outro bloco por posição.
export type Comentario = {
  id: string; kind: string; noId: string
  /** id do bloco (instância); ausente = comentário do nó inteiro */
  ancora?: string
  /** versão (seq) do nó em que foi escrito */
  versao?: number
  autor: string; texto: string; criadoEm: string
  respondeA?: string
  resolvido?: boolean
}
export type Fio = { raiz: Comentario; respostas: Comentario[]; resolvido: boolean; ultimaAtividade: string }

/** agrupa em fios: respostas (por `respondeA`) sob a raiz, em ordem de data; uma resposta cuja raiz não existe mais vira raiz (nunca some). Fios por última atividade, mais recente primeiro. */
export function fios(lista: readonly Comentario[]): Fio[] {
  const porId = new Map(lista.map((c) => [c.id, c])), raizes: Comentario[] = [], filhos = new Map<string, Comentario[]>()
  const raizDe = (c: Comentario): Comentario => { const vistos = new Set<string>(); let cur = c; while (cur.respondeA !== undefined && porId.has(cur.respondeA) && !vistos.has(cur.id)) { vistos.add(cur.id); cur = porId.get(cur.respondeA)! } return cur }
  for (const c of lista) { const r = raizDe(c); if (r.id === c.id) raizes.push(c); else filhos.set(r.id, [...(filhos.get(r.id) ?? []), c]) }
  const cmp = (a: Comentario, b: Comentario) => (a.criadoEm < b.criadoEm ? -1 : a.criadoEm > b.criadoEm ? 1 : a.id < b.id ? -1 : 1)
  return raizes.map((raiz) => { const respostas = (filhos.get(raiz.id) ?? []).sort(cmp); return { raiz, respostas, resolvido: raiz.resolvido === true, ultimaAtividade: [raiz, ...respostas].map((x) => x.criadoEm).sort().pop()! } })
    .sort((a, b) => (a.ultimaAtividade < b.ultimaAtividade ? 1 : a.ultimaAtividade > b.ultimaAtividade ? -1 : a.raiz.id < b.raiz.id ? -1 : 1))
}
export type Situacao = 'geral' | 'ativo' | 'orfao'
export const situacao = (c: Comentario, raiz: Inst | undefined): Situacao => (c.ancora === undefined ? 'geral' : raiz && caminhoDeId(raiz, c.ancora) ? 'ativo' : 'orfao')
/** comentários de um bloco (para o selo na árvore) */
export const doBloco = (lista: readonly Comentario[], id: string): Comentario[] => lista.filter((c) => c.ancora === id)
/** quantos fios ABERTOS há por bloco (para mostrar o contador na árvore) */
export function abertosPorBloco(lista: readonly Comentario[]): Map<string, number> {
  const m = new Map<string, number>(); for (const f of fios(lista)) if (!f.resolvido && f.raiz.ancora !== undefined) m.set(f.raiz.ancora, (m.get(f.raiz.ancora) ?? 0) + 1)
  return m
}
export const TEXTO_MAX = 4000
export const validaTexto = (t: unknown): string | undefined => (typeof t !== 'string' || !t.trim() ? 'escreva o comentário' : t.length > TEXTO_MAX ? `no máximo ${TEXTO_MAX} caracteres` : undefined)
