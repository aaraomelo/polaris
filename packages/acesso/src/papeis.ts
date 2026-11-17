import type { Registry, Contexto } from '@polaris/schema'
import type { Condicao, Regra } from './tipos'

// Papéis (nós `papel`) → regras, com herança. A cascata tenant → segmento → core vale para CADA papel: o tenant pode redefinir `gerente` só para ele.

export class PapelInvalido extends Error { constructor(m: string) { super(m); this.name = 'PapelInvalido' } }
const PROFUNDIDADE_MAXIMA = 10

/**
 * Regras efetivas de uma lista de papéis (união, com herança). Papel inexistente é ERRO (não "sem regras": um papel digitado errado que silenciosamente
 * não concede nada seria um bug de acesso difícil de ver) e ciclo de herança também. Ordem estável; repetidos aparecem uma vez.
 */
export function regrasDePapeis(reg: Registry, nomes: string[], ctx: Contexto = {}): Regra[] {
  const out: Regra[] = []
  const vistos = new Set<string>()
  const visita = (nome: string, pilha: string[]) => {
    if (pilha.includes(nome)) throw new PapelInvalido(`ciclo de herança de papéis: ${[...pilha, nome].join(' → ')}`)
    if (pilha.length >= PROFUNDIDADE_MAXIMA) throw new PapelInvalido(`herança de papéis muito profunda (> ${PROFUNDIDADE_MAXIMA}): ${[...pilha, nome].join(' → ')}`)
    if (vistos.has(nome)) return
    const r = reg.resolve('papel', nome, ctx)
    if (!r) throw new PapelInvalido(`papel '${nome}' não existe`)
    vistos.add(nome)
    const spec = r.no.spec as { herda?: string[]; regras: Regra[] }
    for (const h of spec.herda ?? []) visita(h, [...pilha, nome])
    out.push(...spec.regras)
  }
  for (const n of nomes) visita(n, [])
  return out
}

// ---- CASL (para o FRONT esconder o que o usuário não pode usar; a aplicação é no servidor) ---------------------------------------------------------
// O CASL PADRÃO só entende comparações simples em `conditions` (sem $or/$and/$nor/$not). `criaAbility` (casl.ts) acrescenta esses operadores ao matcher, e
// as regras seguem como estão (`paraCasl`). Para quem não pode trocar o matcher, `paraCaslBasico` converte para forma normal disjuntiva (cada ramo do $or vira
// uma regra; equivalente para permissão E para proibição) e LANÇA o que não representa, em vez de mostrar errado.

export class NaoRepresentavelNoCasl extends Error { constructor(m: string) { super(m); this.name = 'NaoRepresentavelNoCasl' } }
const MAX_RAMOS = 32
type Plana = Record<string, Record<string, unknown>> // campo → operadores

function funde(a: Plana, b: Plana): Plana {
  const out: Plana = JSON.parse(JSON.stringify(a))
  for (const [campo, ops] of Object.entries(b)) {
    const atual = out[campo] ?? (out[campo] = {})
    for (const [op, v] of Object.entries(ops)) {
      if (op in atual && JSON.stringify(atual[op]) !== JSON.stringify(v)) throw new NaoRepresentavelNoCasl(`o campo '${campo}' tem duas condições '${op}' diferentes na mesma conjunção`)
      atual[op] = v
    }
  }
  return out
}
function dnf(c: Condicao): Plana[] {
  let ramos: Plana[] = [{}]
  const cruza = (outros: Plana[]) => { const novos = ramos.flatMap((r) => outros.map((o) => funde(r, o))); if (novos.length > MAX_RAMOS) throw new NaoRepresentavelNoCasl(`condição com mais de ${MAX_RAMOS} combinações`); ramos = novos }
  for (const [k, v] of Object.entries(c)) {
    if (k === '$or') cruza((v as Condicao[]).flatMap((x) => dnf(x)))
    else if (k === '$and') for (const x of v as Condicao[]) cruza(dnf(x))
    else if (k === '$nor') throw new NaoRepresentavelNoCasl('$nor não existe no CASL')
    else cruza([{ [k]: typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : { $eq: v } }])
  }
  return ramos
}

/** Para o CASL PADRÃO (sem `$or`/`$and`/`$nor`/`$not`): as regras no formato CASL com a condição em forma normal disjuntiva; nenhum ramo é perdido (`$or` vira várias regras). Lança se não der. Com `criaAbility` isso não é necessário. */
export function paraCaslBasico(regras: Regra[]) {
  const out: Array<Record<string, unknown>> = []
  for (const r of regras) {
    const base = { action: r.acoes, subject: r.sujeitos, ...(r.negar ? { inverted: true } : {}), ...(r.campos ? { fields: r.campos } : {}) }
    if (!r.onde || !Object.keys(r.onde).length) { out.push(base); continue }
    for (const ramo of dnf(r.onde)) out.push({ ...base, conditions: Object.fromEntries(Object.entries(ramo).map(([campo, ops]) => [campo, Object.keys(ops).length === 1 && '$eq' in ops ? ops.$eq : ops])) })
  }
  // CASL: a regra posterior vence; proibições por último dão "negar vence", igual ao servidor
  return [...out.filter((x) => !x.inverted), ...out.filter((x) => x.inverted)]
}

/** o CASL exige operadores dentro de `$not`: o atalho `{ $not: 'x' }` vira `{ $not: { $eq: 'x' } }` */
function normalizaNot(c: unknown): unknown {
  if (Array.isArray(c)) return c.map(normalizaNot)
  if (c && typeof c === 'object') return Object.fromEntries(Object.entries(c).map(([k, v]) => [k, k === '$not' && (v === null || typeof v !== 'object') ? { $eq: v } : normalizaNot(v)]))
  return c
}

/** As regras no formato do CASL (`action`/`subject`/`inverted`/`conditions`/`fields`), com a condição em MongoQuery (só o atalho de `$not` é normalizado). Use com `criaAbility`. */
export function paraCasl(regras: Regra[]) {
  const out = regras.map((r) => ({ action: r.acoes, subject: r.sujeitos, ...(r.negar ? { inverted: true } : {}), ...(r.onde && Object.keys(r.onde).length ? { conditions: normalizaNot(r.onde) } : {}), ...(r.campos ? { fields: r.campos } : {}) }))
  return [...out.filter((x) => !('inverted' in x)), ...out.filter((x) => 'inverted' in x)] // CASL: a posterior vence, então as proibições vão por último (negar vence)
}
