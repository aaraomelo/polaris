import { substitui, validaCondicao } from './condicao'
import type { Condicao, Regra, Resolvido, Tipos, Variaveis } from './tipos'

// Decisão de acesso. Semântica (a do `c_eff` do Tiffany, com um defeito corrigido):
//   linhas permitidas = ( ⋃ condições dos grants que casam ) ∖ ( ⋃ condições das proibições de LINHA )
//   - NEGAR VENCE sempre, independente da ordem das regras (o CASL puro depende da ordem; aqui não);
//   - proibição SEM condição e SEM campos nega a ação inteira (o resolvedor do Tiffany a descartava ao montar o `where`: regra de "nunca" que virava "sempre");
//   - proibição só de CAMPOS não afeta a linha: remove campos;
//   - condição que usa uma variável que o chamador não tem ($usuario sem usuário): o grant NÃO vale; a proibição vale para TUDO (fail-closed).

const casa = (r: Regra, acao: string, sujeito: string) => (r.acoes.includes(acao) || r.acoes.includes('manage')) && (r.sujeitos.includes(sujeito) || r.sujeitos.includes('all'))
const vazia = (c?: Condicao) => !c || Object.keys(c).length === 0

type Ativa = { r: Regra; cond: Condicao | null }

/** Regras que casam com (ação, sujeito), com as variáveis já substituídas e as condições validadas contra os tipos. */
function ativas(regras: Regra[], acao: string, sujeito: string, v: Variaveis, tipos: Tipos): { positivas: Ativa[]; negativas: Ativa[]; negadoTotal: boolean } {
  const positivas: Ativa[] = [], negativas: Ativa[] = []
  let negadoTotal = false
  for (const r of regras) {
    if (!casa(r, acao, sujeito)) continue
    let cond: Condicao | null = null
    if (!vazia(r.onde)) {
      validaCondicao(r.onde, tipos) // regra malformada FALHA ALTO (lança): nunca é ignorada em silêncio
      const s = substitui(r.onde!, v)
      if (s.indefinida) { if (r.negar) negadoTotal = true; continue } // positiva sem a variável: não vale; negativa: vale para tudo
      cond = s.cond
    }
    ;(r.negar ? negativas : positivas).push({ r, cond })
  }
  return { positivas, negativas, negadoTotal }
}

/** Quais LINHAS a ação alcança: tudo, nada, ou uma condição (que vira WHERE). */
export function resolve(regras: Regra[], acao: string, sujeito: string, v: Variaveis, tipos: Tipos): Resolvido {
  const { positivas, negativas, negadoTotal } = ativas(regras, acao, sujeito, v, tipos)
  if (negadoTotal || !positivas.length) return { tipo: 'nada' }
  // proibição incondicional e sem campos: nega a ação inteira
  if (negativas.some((n) => n.cond === null && !n.r.campos)) return { tipo: 'nada' }
  const incondicional = positivas.some((p) => p.cond === null)
  const base: Condicao | null = incondicional ? null : positivas.length === 1 ? positivas[0]!.cond! : { $or: positivas.map((p) => p.cond!) }
  // proibições de linha: as que têm condição e NÃO são só de campos
  const nega = negativas.filter((n) => n.cond !== null && !n.r.campos).map((n) => n.cond!)
  if (!nega.length) return base === null ? { tipo: 'tudo' } : { tipo: 'onde', cond: base }
  const exclui: Condicao = { $nor: nega }
  return { tipo: 'onde', cond: base === null ? exclui : { $and: [base, exclui] } }
}

/**
 * A ação é permitida sobre ESTA linha (e, se informado, sobre este campo)? É a decisão de UM caso, a que `resolve` + `avalia` dariam.
 * Sem `linha`, é a pergunta "em geral": um grant com condição CONTA (pode valer para alguma linha) e uma proibição com condição NÃO nega (não vale para todas).
 * Sem `campo`, uma proibição só de campos não nega a ação; com `campo`, grant e proibição valem se o campo está na lista (ou ela não tem lista).
 */
export function permite(regras: Regra[], acao: string, sujeito: string, v: Variaveis, tipos: Tipos, avaliaCond: (c: Condicao, linha: Record<string, unknown>) => boolean, linha?: Record<string, unknown>, campo?: string): boolean {
  const { positivas, negativas, negadoTotal } = ativas(regras, acao, sujeito, v, tipos)
  if (negadoTotal) return false
  const aplica = (a: Ativa, positiva: boolean) => {
    const porLinha = a.cond === null ? true : linha === undefined ? positiva : avaliaCond(a.cond, linha)
    const porCampo = campo === undefined ? (positiva ? true : !a.r.campos) : !a.r.campos || a.r.campos.includes(campo)
    return porLinha && porCampo
  }
  return !negativas.some((n) => aplica(n, false)) && positivas.some((p) => aplica(p, true))
}

/**
 * Campos que a ação pode ler/escrever. `null` = todos. CONSERVADOR: interseção das listas dos grants que casam (um grant sem `campos` conta como "todos"):
 * nunca mostra mais do que algum grant permitiria para aquela linha. Proibições de campo removem; proibição sem campos já foi tratada por `resolve`.
 */
export function camposPermitidos(regras: Regra[], acao: string, sujeito: string, v: Variaveis, tipos: Tipos, todos: string[]): string[] | null {
  const { positivas, negativas } = ativas(regras, acao, sujeito, v, tipos)
  let conj: string[] | null = null
  for (const p of positivas) {
    const lista = p.r.campos
    if (!lista) continue
    conj = conj === null ? [...lista] : conj.filter((c) => lista.includes(c))
  }
  const proibidos = new Set(negativas.flatMap((n) => n.r.campos ?? []))
  if (conj === null && !proibidos.size) return null
  return (conj ?? todos).filter((c) => !proibidos.has(c))
}
