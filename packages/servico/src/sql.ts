import { snake, type Campo } from '@polaris/schema'

// SQL do CRUD, montado SÓ com nomes que vêm do schema do serviço (identificadores citados) e valores por parâmetro ($n). Nada da requisição vira texto de SQL.

export const ident = (s: string) => `"${s.replace(/"/g, '""')}"`
export type Ent = { escopo?: 'usuario'; campos: Record<string, Campo>; busca?: { campos: string[]; modo?: 'exata' | 'aproximada' } }

/** A expressão que lê a coluna já no formato do JSON da API (o driver devolveria bigint/numeric como texto, data como Date…). */
function leitura(nome: string, c: Campo): string {
  const col = ident(snake(nome))
  if (c.lista) return c.tipo === 'json' ? col : `${col}::text[]`
  switch (c.tipo) {
    case 'inteiro': case 'decimal': case 'dinheiro': case 'data': case 'uuid': return `${col}::text`
    case 'dataHora': return `to_char(${col} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`
    default: return col
  }
}
const ISO = (c: string) => `to_char(${c} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')`
/** colunas a ler; `permitidos` (de `camposPermitidos`) restringe: o id vai sempre, o resto só se estiver na lista (`null` = todos) */
export const colunas = (ent: Ent, permitidos: string[] | null = null): string => {
  const ok = (n: string) => permitidos === null || permitidos.includes(n)
  return ['id::text AS "id"', ...Object.entries(ent.campos).filter(([n]) => ok(n)).map(([n, c]) => `${leitura(n, c)} AS ${ident(n)}`),
    ...(ok('criadoEm') ? [`${ISO('criado_em')} AS "criadoEm"`] : []), ...(ok('atualizadoEm') ? [`${ISO('atualizado_em')} AS "atualizadoEm"`] : [])].join(', ')
}
/** todos os nomes de campo que a API expõe de uma entidade */
export const nomesDeCampos = (ent: Ent): string[] => [...Object.keys(ent.campos), 'criadoEm', 'atualizadoEm']
/** campo → tipo, para a linguagem de condição (listas viram `tipo[]`) */
export const tiposDe = (ent: Ent): Record<string, string> => ({ id: 'uuid', criadoEm: 'dataHora', atualizadoEm: 'dataHora', ...Object.fromEntries(Object.entries(ent.campos).map(([n, c]) => [n, c.lista && c.tipo !== 'json' ? `${c.tipo}[]` : c.tipo])) })

/** do que o banco devolveu (texto) para o que a API promete (número onde o campo é inteiro/decimal) */
export function linhaParaApi(ent: Ent, row: Record<string, unknown>): Record<string, unknown> {
  const out = { ...row }
  for (const [n, c] of Object.entries(ent.campos)) {
    const v = out[n]
    if (v === null || v === undefined) { delete out[n]; continue }
    if (c.tipo === 'inteiro' || c.tipo === 'decimal') out[n] = Array.isArray(v) ? v.map(Number) : Number(v)
  }
  return out
}

export function tabela(servico: string, entidade: string): string { return `${ident(servico)}.${ident(snake(entidade))}` }
