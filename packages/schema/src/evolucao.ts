import { EmissaoErro, colunaSql, ddlEntidade, ddlEventos, eventosDoServico, identSql, literalSql, nomeFk, nomeIndice, snake, sqlFk, sqlIndice, TIPO_SQL, validaReferencia, type Campo } from './emissao'
import type { No } from './index'

// ---------------------------------------------------------------------------------------------------------------------------------------------
// Evolução de schema: o DIFF entre duas versões de um `servico` vira SQL de migração para Postgres.
//   - o que é seguro entra em `up`; o que perde dados (remover campo/entidade, estreitar tipo) só entra com `destrutivo: true` e sempre aparece em `destrutivas`;
//   - o que não dá para fazer sem decisão humana (campo obrigatório novo sem padrão, obrigatório sobre dados sem padrão) vira `bloqueios` e `ok: false`;
//   - renomear não é detectável (parece remover + criar): informe `renomeia`, e o dado é preservado (RENAME COLUMN).
// Equivalência (testada contra um Postgres real): aplicar v1 e depois a migração dá o MESMO catálogo que aplicar v2 do zero.
// As migrações rodam com um papel que ignora RLS (BYPASSRLS/superusuário): a tabela tem FORCE RLS, então o dono comum não enxergaria linha alguma.
// ---------------------------------------------------------------------------------------------------------------------------------------------

type Ent = { campos: Record<string, Campo>; indices?: string[][] }
type Spec = { entidades: Record<string, Ent> }
export type OpcoesMigracao = {
  /** inclui no `up` as operações que PERDEM dados (padrão: não; elas só são listadas em `destrutivas`) */
  destrutivo?: boolean
  /** `{ 'entidade.campoAntigo': 'campoNovo' }`: renomeia a coluna em vez de remover e recriar */
  renomeia?: Record<string, string>
}
export type MigracaoSql = {
  /** o SQL, em uma transação; vazio se não há o que fazer */
  up: string
  /** o que mudou, em português */
  mudancas: string[]
  /** o que perde dados (incluído em `up` só com `destrutivo`) */
  destrutivas: string[]
  /** o que impede a migração segura: precisa de decisão humana. Com bloqueios, `ok` é false e `up` não deve ser aplicado */
  bloqueios: string[]
  avisos: string[]
  ok: boolean
}

/** conversões de tipo que não perdem informação (alargam) */
const SEGURAS = new Set(['inteiro>decimal', 'inteiro>dinheiro', 'dinheiro>decimal', 'uuid>texto', 'data>dataHora'])
const tipoSql = (c: Campo) => { const b = TIPO_SQL[c.tipo]!; return c.lista && c.tipo !== 'json' ? `${b}[]` : b }
const mesmo = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

export function migraSql(anterior: No, atual: No, opcoes: OpcoesMigracao = {}): MigracaoSql {
  if (anterior.kind !== 'servico' || atual.kind !== 'servico') throw new EmissaoErro('migraSql: só serviços têm migração SQL')
  if (anterior.id !== atual.id) throw new EmissaoErro(`migraSql: o serviço mudou de '${anterior.id}' para '${atual.id}' (outro schema); migre os dados à mão`)
  const A = (anterior.spec as Spec).entidades, B = (atual.spec as Spec).entidades
  const esq = identSql(atual.id)
  const mudancas: string[] = [], destrutivas: string[] = [], bloqueios: string[] = [], avisos: string[] = []
  const novas: string[] = [], alteracoes: string[] = [], indices: string[] = [], fks: string[] = [], perigosas: string[] = []
  const renomeia = opcoes.renomeia ?? {}

  for (const nome of Object.keys(B).sort()) {
    const nova = B[nome]!
    const tab = `${esq}.${identSql(snake(nome))}`
    for (const [campo, c] of Object.entries(nova.campos)) validaReferencia(atual.id, nome, campo, c, B)
    const antiga = A[nome]
    if (!antiga) {
      const d = ddlEntidade(atual.id, nome, nova, B)
      novas.push(...d.tabela); fks.push(...d.fks)
      mudancas.push(`entidade nova: ${nome}`)
      continue
    }
    // campos que mudam de nome (só o que foi pedido e é coerente)
    const renomeados = new Map<string, string>() // antigo → novo
    for (const [k, novo] of Object.entries(renomeia)) {
      const [e, antigoNome] = k.split('.')
      if (e !== nome) continue
      if (antigoNome && antigoNome in antiga.campos && !(antigoNome in nova.campos) && novo in nova.campos && !(novo in antiga.campos)) renomeados.set(antigoNome, novo)
      else bloqueios.push(`renomeia '${k}' → '${novo}' não confere com as versões (o campo antigo deve existir só na anterior e o novo só na atual)`)
    }
    const doAntigo = (campoNovo: string): string | undefined => { for (const [a, n] of renomeados) if (n === campoNovo) return a; return campoNovo in antiga.campos ? campoNovo : undefined }

    for (const [a, n] of renomeados) {
      alteracoes.push(`ALTER TABLE ${tab} RENAME COLUMN ${identSql(snake(a))} TO ${identSql(snake(n))};`)
      if (antiga.campos[a]!.referencia !== undefined) alteracoes.push(`ALTER TABLE ${tab} DROP CONSTRAINT IF EXISTS ${identSql(nomeFk(nome, a))};`)
      mudancas.push(`${nome}.${a} renomeado para ${n}`)
    }
    for (const campo of Object.keys(nova.campos).sort()) {
      const c = nova.campos[campo]!
      const origem = doAntigo(campo)
      const col = identSql(snake(campo))
      if (origem === undefined) { // campo novo
        if (c.obrigatorio && c.padrao === undefined) { bloqueios.push(`'${nome}.${campo}' é obrigatório e novo, sem padrão: as linhas existentes ficariam sem valor (dê um 'padrao', ou crie opcional e preencha depois)`); continue }
        alteracoes.push(`ALTER TABLE ${tab} ADD COLUMN IF NOT EXISTS ${colunaSql(campo, c).trim()};`)
        if (c.referencia !== undefined) { fks.push(...sqlFk(atual.id, nome, campo, c.referencia)); avisos.push(`'${nome}.${campo}': a chave estrangeira nova é validada contra as linhas existentes`) }
        mudancas.push(`${nome}.${campo} adicionado (${c.tipo}${c.obrigatorio ? ', obrigatório' : ''})`)
        continue
      }
      const v = antiga.campos[origem]!
      // tipo / lista
      if (v.tipo !== c.tipo || !!v.lista !== !!c.lista) {
        const par = `${v.tipo}>${c.tipo}`
        const seguro = !v.lista && !c.lista && SEGURAS.has(par)
        const sql = [`ALTER TABLE ${tab} ALTER COLUMN ${col} DROP DEFAULT;`, `ALTER TABLE ${tab} ALTER COLUMN ${col} TYPE ${tipoSql(c)} USING ${col}::${tipoSql(c)};`]
        if (seguro) alteracoes.push(...sql); else { perigosas.push(...sql); destrutivas.push(`${nome}.${campo}: tipo ${v.tipo}${v.lista ? '[]' : ''} → ${c.tipo}${c.lista ? '[]' : ''} pode perder ou rejeitar dados`) }
        mudancas.push(`${nome}.${campo}: tipo ${v.tipo}${v.lista ? '[]' : ''} → ${c.tipo}${c.lista ? '[]' : ''}`)
        if (c.padrao !== undefined) alteracoes.push(`ALTER TABLE ${tab} ALTER COLUMN ${col} SET DEFAULT ${literalSql(c.padrao, c.tipo)};`)
      } else if (!mesmo(v.padrao, c.padrao)) {
        alteracoes.push(c.padrao === undefined ? `ALTER TABLE ${tab} ALTER COLUMN ${col} DROP DEFAULT;` : `ALTER TABLE ${tab} ALTER COLUMN ${col} SET DEFAULT ${literalSql(c.padrao, c.tipo)};`)
        mudancas.push(`${nome}.${campo}: padrão alterado`)
      }
      // obrigatoriedade
      if (!!v.obrigatorio !== !!c.obrigatorio) {
        if (c.obrigatorio) {
          if (c.padrao === undefined) bloqueios.push(`'${nome}.${campo}' passa a ser obrigatório sem padrão: linhas com valor nulo quebrariam (dê um 'padrao' para preencher, ou preencha antes)`)
          else alteracoes.push(`UPDATE ${tab} SET ${col} = ${literalSql(c.padrao, c.tipo)} WHERE ${col} IS NULL;`, `ALTER TABLE ${tab} ALTER COLUMN ${col} SET NOT NULL;`)
        } else alteracoes.push(`ALTER TABLE ${tab} ALTER COLUMN ${col} DROP NOT NULL;`)
        mudancas.push(`${nome}.${campo}: ${c.obrigatorio ? 'passa a obrigatório' : 'passa a opcional'}`)
      }
      // referência
      if (v.referencia !== c.referencia || (origem !== campo && c.referencia !== undefined)) {
        if (c.referencia === undefined) alteracoes.push(`ALTER TABLE ${tab} DROP CONSTRAINT IF EXISTS ${identSql(nomeFk(nome, origem))};`)
        else { fks.push(...sqlFk(atual.id, nome, campo, c.referencia)); avisos.push(`'${nome}.${campo}': a chave estrangeira nova é validada contra as linhas existentes`) }
        mudancas.push(`${nome}.${campo}: referência ${v.referencia ?? '—'} → ${c.referencia ?? '—'}`)
      }
    }
    for (const campo of Object.keys(antiga.campos).sort()) {
      if (campo in nova.campos || renomeados.has(campo)) continue
      perigosas.push(`ALTER TABLE ${tab} DROP COLUMN IF EXISTS ${identSql(snake(campo))};`)
      destrutivas.push(`${nome}.${campo} removido: apaga a coluna e os dados dela (se foi renomeado, use 'renomeia')`)
      mudancas.push(`${nome}.${campo} removido`)
    }
    // índices, por NOME (o nome vem das colunas; renomear coluna troca o índice)
    const nomesA = new Map((antiga.indices ?? []).map((cols) => [nomeIndice(nome, cols), cols])), nomesB = new Map((nova.indices ?? []).map((cols) => [nomeIndice(nome, cols), cols]))
    for (const cols of nova.indices ?? []) for (const x of cols) if (!(x in nova.campos)) throw new EmissaoErro(`servico ${atual.id}: índice de '${nome}' usa campo inexistente '${x}'`)
    for (const [n] of [...nomesA].sort()) if (!nomesB.has(n)) { indices.push(`DROP INDEX IF EXISTS ${esq}.${identSql(n)};`); mudancas.push(`índice removido: ${n}`) }
    for (const [n, cols] of [...nomesB].sort()) if (!nomesA.has(n)) { indices.push(sqlIndice(atual.id, nome, cols)); mudancas.push(`índice novo: ${n}`) }
  }
  for (const nome of Object.keys(A).sort()) if (!(nome in B)) {
    perigosas.push(`DROP TABLE IF EXISTS ${esq}.${identSql(snake(nome))};`)
    destrutivas.push(`entidade ${nome} removida: apaga a tabela e TODOS os dados dela`); mudancas.push(`entidade removida: ${nome}`)
  }

  // o serviço passou a publicar/consumir eventos: cria `outbox`/`inbox` (idempotente)
  const evA = eventosDoServico(anterior.spec as never), evB = eventosDoServico(atual.spec as never)
  const infra = ddlEventos(atual.id, evB.publica && !evA.publica, evB.consome && !evA.consome)
  if (infra.length) mudancas.push(`infraestrutura de eventos: ${[evB.publica && !evA.publica ? 'outbox' : '', evB.consome && !evA.consome ? 'inbox' : ''].filter(Boolean).join(' + ')}`)
  const corpo = [...novas, ...alteracoes, ...indices, ...(opcoes.destrutivo ? perigosas : []), ...infra, ...fks]
  const ok = bloqueios.length === 0
  const up = corpo.length ? [`-- polaris: migração servico ${atual.id} ${anterior.versao} → ${atual.versao}`, 'BEGIN;', 'SET LOCAL row_security = off;', `CREATE SCHEMA IF NOT EXISTS ${esq};`, ...corpo, 'COMMIT;'].join('\n') + '\n' : ''
  return { up, mudancas, destrutivas, bloqueios, avisos, ok }
}
