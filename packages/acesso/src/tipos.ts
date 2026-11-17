/**
 * Condição de linha em MongoQuery (subconjunto que roda IGUAL em JS e em SQL): igualdade, $eq/$ne/$in/$nin/$gt/$gte/$lt/$lte/$exists, $not (por campo),
 * $and/$or/$nor, e para campos LISTA: contém (`{tags: 'a'}`), $all, $size, $elemMatch. Sem $regex ($: o regex POSIX do Postgres difere do do JS e há risco de ReDoS), $where nem $mod.
 */
export type Condicao = Record<string, unknown>

/** Uma regra de acesso, no formato do nó `papel` (e quase o formato CASL: acoes/sujeitos/negar/onde/campos). */
export type Regra = {
  acoes: string[]
  sujeitos: string[]
  /** proibição: SEMPRE vence uma permissão, independente da ordem */
  negar?: boolean
  onde?: Condicao
  campos?: string[]
  /** saltos de re-delegação permitidos (ausente = ilimitado) */
  profundidade?: number
}

/** Quem chama: os valores que `$usuario`/`$tenant` assumem nas condições. */
export type Variaveis = { usuario?: string; tenant?: string }

export type Resolvido =
  /** sem restrição de linha */
  | { tipo: 'tudo' }
  /** nenhuma linha (inclusive: ação nem permitida) */
  | { tipo: 'nada' }
  /** só as linhas que satisfazem a condição */
  | { tipo: 'onde'; cond: Condicao }

export type TipoCampo = 'texto' | 'inteiro' | 'decimal' | 'booleano' | 'data' | 'dataHora' | 'dinheiro' | 'uuid' | 'json'
/** `texto[]`, `inteiro[]`…: campo lista (no schema, `lista: true`) */
export type TipoLista = `${TipoCampo}[]`
/** campo → tipo (para comparar dinheiro como decimal exato e recusar ordenação em texto) */
export type Tipos = Record<string, TipoCampo | TipoLista>
