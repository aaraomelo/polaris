import { snake, type Campo } from '@polaris/schema'

// SQL do CRUD, montado SÓ com nomes que vêm do schema do serviço (identificadores citados) e valores por parâmetro ($n). Nada da requisição vira texto de SQL.

export const ident = (s: string) => `"${s.replace(/"/g, '""')}"`
export type Ent = { campos: Record<string, Campo> }

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
export const colunas = (ent: Ent): string =>
  ['id::text AS "id"', ...Object.entries(ent.campos).map(([n, c]) => `${leitura(n, c)} AS ${ident(n)}`),
    `to_char(criado_em AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "criadoEm"`, `to_char(atualizado_em AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "atualizadoEm"`].join(', ')

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
