import type { Condicao, Regra } from './tipos'

// Delegação sem escalada (do Tiffany, `grant-check`): "qualquer um pode conceder a quem quiser, mas nunca mais do que tem".
// Verificada no ATO DE CONCEDER. CONSERVADOR: na dúvida sobre "está contido", NEGA.

const cobre = (tem: string[], quer: string[], curinga: string) => tem.includes(curinga) || quer.every((x) => tem.includes(x))
const vazia = (c?: Condicao) => !c || Object.keys(c).length === 0
const igualJson = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

/** cláusulas de igualdade simples de uma condição; `null` se tem qualquer coisa além disso (operadores, $or…) */
function atomicas(c: Condicao): Array<[string, unknown]> | null {
  const out: Array<[string, unknown]> = []
  for (const [k, v] of Object.entries(c)) {
    if (k === '$and') { for (const x of v as Condicao[]) { const s = atomicas(x); if (s === null) return null; out.push(...s) } continue }
    if (k.startsWith('$') || (typeof v === 'object' && v !== null)) return null
    out.push([k, v])
  }
  return out
}
/** a condição `proposta` é pelo menos tão restritiva quanto `tem`? (todas as cláusulas de `tem` aparecem em `proposta`, ou são idênticas) */
function contida(proposta: Condicao | undefined, tem: Condicao | undefined): boolean {
  if (vazia(tem)) return true
  if (vazia(proposta)) return false
  if (igualJson(proposta, tem)) return true
  const a = atomicas(proposta!), b = atomicas(tem!)
  if (a === null || b === null) return false
  return b.every(([k, v]) => a.some(([k2, v2]) => k2 === k && igualJson(v2, v)))
}

export type Concessao = { ok: true } | { ok: false; motivo: string }

/**
 * O `ator` (com as regras `atorRegras`) pode conceder `proposta`? Para uma proposta POSITIVA, algum grant do ator precisa cobrir ações e sujeitos,
 * ter condição igual ou mais ampla, campos ⊇ e orçamento de re-delegação ≥ 1 (a profundidade proposta ≤ a dele − 1). Proposta de NEGAÇÃO é sempre
 * concedível (só reduz). Um ator que está proibido de algo não pode concedê-lo.
 */
export function podeConceder(atorRegras: Regra[], proposta: Regra): Concessao {
  if (proposta.negar) return { ok: true }
  for (const n of atorRegras) {
    if (!n.negar || !vazia(n.onde) || n.campos) continue
    const sobrepoe = n.sujeitos.includes('all') || n.sujeitos.some((s) => proposta.sujeitos.includes(s) || proposta.sujeitos.includes('all'))
    const acoes = n.acoes.includes('manage') || n.acoes.some((a) => proposta.acoes.includes(a) || proposta.acoes.includes('manage'))
    if (sobrepoe && acoes) return { ok: false, motivo: 'o próprio ator está proibido de parte do que quer conceder' }
  }
  const candidatos = atorRegras.filter((g) => !g.negar && cobre(g.acoes, proposta.acoes, 'manage') && cobre(g.sujeitos, proposta.sujeitos, 'all'))
  if (!candidatos.length) return { ok: false, motivo: 'o ator não detém essas ações nesses sujeitos' }
  let motivo = 'a condição proposta é mais ampla que a do ator'
  for (const g of candidatos) {
    if (!contida(proposta.onde, g.onde)) { motivo = 'a condição proposta é mais ampla que a do ator (ou não dá para provar que é mais restrita)'; continue }
    if (g.campos && !(proposta.campos && proposta.campos.every((c) => g.campos!.includes(c)))) { motivo = 'a proposta alcança campos que o ator não tem'; continue }
    const tem = g.profundidade ?? Infinity
    if (tem < 1) { motivo = 'o ator não pode re-delegar (profundidade 0)'; continue }
    const quer = proposta.profundidade ?? Infinity
    if (quer > tem - 1) { motivo = `a profundidade proposta (${quer === Infinity ? 'ilimitada' : quer}) excede o permitido (${tem === Infinity ? 'ilimitada' : tem - 1})`; continue }
    return { ok: true }
  }
  return { ok: false, motivo }
}
