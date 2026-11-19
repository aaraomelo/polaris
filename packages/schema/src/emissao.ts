import { SCHEMA_EXTENSOES, ddlExtensaoBusca, exprDeBusca } from './busca'
import { emiteOpenApi } from './servico-api'
import type { No } from './index'
import type { Contexto, Registry } from './registry'

// ---------------------------------------------------------------------------
// Emissões canônicas: projeções de um nó para outros formatos. Nenhuma é privilegiada:
// `json` é só a forma canônica (chaves ordenadas), e as demais derivam do mesmo nó.
//
//   alvo | kinds                                  | o que gera
//   json | todos                                  | JSON canônico (chaves ordenadas, estável, comparável por texto)
//   js   | todos                                  | módulo ESM com o nó como dado
//   tex  | todos                                  | ficha de documentação em LaTeX
//   css  | tema                                   | custom properties (+ modos)
//   sql  | servico                                | DDL PostgreSQL com tenant_id e RLS
//   openapi | servico                             | OpenAPI 3.1 (rotas das operações e do crud; schemas das entidades)
//   html | pagina                                 | HTML canônico (blocos como custom elements, ilhas)
// ---------------------------------------------------------------------------

export type Alvo = 'json' | 'js' | 'tex' | 'css' | 'sql' | 'html' | 'openapi'

export class EmissaoErro extends Error {
  constructor(mensagem: string) {
    super(mensagem)
    this.name = 'EmissaoErro'
  }
}

export type OpcoesEmissao = { registry?: Registry; ctx?: Contexto }

const TODOS: Alvo[] = ['json', 'js', 'tex']
const POR_KIND: Partial<Record<No['kind'], Alvo[]>> = {
  tema: ['css'],
  servico: ['sql', 'openapi'],
  pagina: ['html'],
}

/** Alvos disponíveis para um kind. */
export function alvosDe(kind: No['kind']): Alvo[] {
  return [...TODOS, ...(POR_KIND[kind] ?? [])]
}

// ---- json canônico --------------------------------------------------------

function canonico(v: unknown): unknown {
  if (Array.isArray(v)) return v.map(canonico)
  if (v && typeof v === 'object') {
    const o = v as Record<string, unknown>
    return Object.fromEntries(
      Object.keys(o).filter((k) => o[k] !== undefined).sort().map((k) => [k, canonico(o[k])]),
    )
  }
  return v
}

/** JSON canônico: chaves em ordem alfabética em todos os níveis, 2 espaços, `\n` final. */
export function jsonCanonico(v: unknown): string {
  return JSON.stringify(canonico(v), null, 2) + '\n'
}

// ---- escapes --------------------------------------------------------------

const escHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')

const escJs = (json: string) => json.replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029')

const TEX: Record<string, string> = { '\\': '\\textbackslash{}', '&': '\\&', '%': '\\%', $: '\\$', '#': '\\#', _: '\\_', '{': '\\{', '}': '\\}', '~': '\\textasciitilde{}', '^': '\\textasciicircum{}' }
const escTex = (s: string) => s.replace(/[\\&%$#_{}~^]/g, (c) => TEX[c]!)

const aspasSql = (s: string) => `'${s.replace(/'/g, "''")}'`
export const identSql = (s: string) => `"${s.replace(/"/g, '""')}"`

// ---- js -------------------------------------------------------------------

function emiteJs(no: No): string {
  const cab = `// polaris: ${no.kind} ${no.id}@${no.versao}`.replace(/[\r\n\u2028\u2029]/g, ' ')
  return [
    cab,
    `export const kind = ${escJs(JSON.stringify(no.kind))};`,
    `export const id = ${escJs(JSON.stringify(no.id))};`,
    `export const versao = ${escJs(JSON.stringify(no.versao))};`,
    `export default ${escJs(JSON.stringify(canonico(no), null, 2))};`,
    '',
  ].join('\n')
}

// ---- tex ------------------------------------------------------------------

function achata(v: unknown, prefixo = '', out: Array<[string, string]> = []): Array<[string, string]> {
  if (v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length) {
    for (const k of Object.keys(v as object).sort()) achata((v as Record<string, unknown>)[k], prefixo ? `${prefixo}.${k}` : k, out)
  } else if (Array.isArray(v) && v.length) {
    v.forEach((x, i) => achata(x, `${prefixo}[${i}]`, out))
  } else {
    out.push([prefixo, typeof v === 'string' ? v : JSON.stringify(v)])
  }
  return out
}

function emiteTex(no: No): string {
  const linhas = achata(no.spec, 'spec').map(([k, v]) => `\\texttt{${escTex(k)}} & ${escTex(v)} \\\\`)
  return [
    `\\subsection*{${escTex(no.kind)}: ${escTex(no.id)}}`,
    '\\begin{tabular}{@{}ll@{}}',
    `versão & ${escTex(no.versao)} \\\\`,
    `estatuto & ${escTex(no.estatuto ?? 'rascunho')} \\\\`,
    ...(no.tenantId ? [`tenant & ${escTex(no.tenantId)} \\\\`] : no.segmento ? [`segmento & ${escTex(no.segmento)} \\\\`] : ['escopo & core \\\\']),
    '\\end{tabular}\n',
    '\\begin{tabular}{@{}p{0.35\\linewidth}p{0.6\\linewidth}@{}}',
    ...linhas,
    '\\end{tabular}',
    '',
  ].join('\n')
}

// ---- css ------------------------------------------------------------------

const NOME_CSS = /^[A-Za-z0-9][A-Za-z0-9_-]*$/
const VALOR_CSS = /^[A-Za-z0-9 #%.,()/'"+_*-]*$/
const kebab = (s: string) => s.replace(/([a-z0-9])([A-Z])/g, '$1-$2').toLowerCase()

function varsCss(grupo: string, v: unknown, out: Array<[string, string]>, prefixo: string[] = []): void {
  if (v && typeof v === 'object' && !Array.isArray(v)) {
    for (const [k, x] of Object.entries(v).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))) {
      if (!NOME_CSS.test(k)) throw new EmissaoErro(`tema: nome de token inválido para CSS: ${JSON.stringify(k)}`)
      varsCss(grupo, x, out, [...prefixo, kebab(k)])
    }
    return
  }
  const nome = `--${[grupo, ...prefixo].join('-')}`
  const bruto = typeof v === 'number' ? (grupo === 'espacamento' || grupo === 'raio' ? `${v}px` : String(v)) : String(v)
  if (!VALOR_CSS.test(bruto) || /\/\*|\*\//.test(bruto)) throw new EmissaoErro(`tema: valor de token inválido em ${nome}: ${JSON.stringify(bruto)}`)
  out.push([nome, bruto])
}

function declaracoes(tokens: Record<string, unknown>): string[] {
  const out: Array<[string, string]> = []
  for (const g of Object.keys(tokens).sort()) {
    if (!NOME_CSS.test(g)) throw new EmissaoErro(`tema: grupo de tokens inválido: ${JSON.stringify(g)}`)
    varsCss(kebab(g), tokens[g], out)
  }
  return out.map(([n, v]) => `  ${n}: ${v};`)
}

function emiteCss(no: No): string {
  const spec = no.spec as { tokens: Record<string, unknown>; modos?: Record<string, Record<string, unknown>> }
  const blocos = [`/* polaris: tema ${no.id}@${no.versao} */`, `:root {\n${declaracoes(spec.tokens).join('\n')}\n}`]
  for (const modo of Object.keys(spec.modos ?? {}).sort()) {
    if (!/^[a-z0-9-]+$/.test(modo)) throw new EmissaoErro(`tema: nome de modo inválido: ${JSON.stringify(modo)}`)
    const decl = declaracoes(spec.modos![modo]!).join('\n')
    blocos.push(`[data-modo="${modo}"] {\n${decl}\n}`)
    if (modo === 'escuro') blocos.push(`@media (prefers-color-scheme: dark) {\n  :root:not([data-modo]) {\n${decl.replace(/^/gm, '  ')}\n  }\n}`)
  }
  return blocos[0] + '\n' + blocos.slice(1).join('\n\n') + '\n'
}

// ---- sql ------------------------------------------------------------------

export const TIPO_SQL: Record<string, string> = {
  texto: 'text', inteiro: 'bigint', decimal: 'numeric', booleano: 'boolean', data: 'date',
  dataHora: 'timestamptz', dinheiro: 'numeric(19,4)', uuid: 'uuid', json: 'jsonb',
}
export const snake = (s: string) => s.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase()

export function literalSql(v: unknown, tipo: string): string {
  if (v === null) return 'NULL'
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE'
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) throw new EmissaoErro(`valor padrão inválido: ${v}`)
    return String(v)
  }
  if (tipo === 'json') return `${aspasSql(JSON.stringify(v))}::jsonb`
  return aspasSql(String(v))
}

export type Campo = { tipo: string; obrigatorio?: boolean; lista?: boolean; padrao?: unknown; referencia?: string }

export function colunaSql(nome: string, c: Campo): string {
  const base = TIPO_SQL[c.tipo]!
  const tipo = c.lista && c.tipo !== 'json' ? `${base}[]` : base
  const partes = [`  ${identSql(snake(nome))} ${tipo}`]
  if (c.obrigatorio) partes.push('NOT NULL')
  if (c.padrao !== undefined) partes.push(`DEFAULT ${literalSql(c.padrao, c.tipo)}`)
  return partes.join(' ')
}

type EntidadeSql = { campos: Record<string, Campo>; indices?: string[][]; unicos?: string[][]; busca?: { campos: string[]; modo?: 'exata' | 'aproximada' } }
const RESERVADOS = ['id', 'tenant_id', 'criado_em', 'atualizado_em']

/** Nome da FK composta de um campo. */
export const nomeFk = (entidade: string, campo: string) => `${snake(entidade)}_${snake(campo)}_fk`
export const nomeIndice = (entidade: string, campos: string[], unico = false) => `${snake(entidade)}_${campos.map(snake).join('_')}_${unico ? 'uidx' : 'idx'}`

/** O comando que cria a FK COMPOSTA (tenant_id, id): as checagens de integridade do Postgres IGNORAM a RLS, então um FK simples deixaria um tenant apontar para a linha de outro. */
export function sqlFk(servico: string, entidade: string, campo: string, alvo: string): string[] {
  const tab = `${identSql(servico)}.${identSql(snake(entidade))}`
  const fk = identSql(nomeFk(entidade, campo))
  return [`ALTER TABLE ${tab} DROP CONSTRAINT IF EXISTS ${fk};`, `ALTER TABLE ${tab} ADD CONSTRAINT ${fk} FOREIGN KEY ("tenant_id", ${identSql(snake(campo))}) REFERENCES ${identSql(servico)}.${identSql(snake(alvo))} ("tenant_id", "id");`]
}

export function validaReferencia(servico: string, entidade: string, campo: string, c: Campo, entidades: Record<string, unknown>): void {
  if (c.referencia === undefined) return
  if (c.tipo !== 'uuid') throw new EmissaoErro(`servico ${servico}: '${entidade}.${campo}' tem referencia '${c.referencia}' mas é do tipo '${c.tipo}' (use uuid)`)
  if (c.lista) throw new EmissaoErro(`servico ${servico}: '${entidade}.${campo}' é uma lista; chave estrangeira não vale para lista de uuids`)
  if (!(c.referencia in entidades)) throw new EmissaoErro(`servico ${servico}: '${entidade}.${campo}' referencia a entidade inexistente '${c.referencia}'`)
}

/** RLS por tenant (ENABLE + FORCE + política com USING e WITH CHECK); `base` nomeia a política. */
export function sqlRls(tab: string, base: string): string[] {
  // `current_setting(…, true)` não falha se o parâmetro nunca foi definido e `nullif` trata o vazio (sobra de um RESET numa conexão reutilizada):
  // sem tenant, a comparação dá NULL e NENHUMA linha passa (falha fechada), em vez de erro de configuração.
  const cond = `"tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid`
  // USING cobre SELECT/UPDATE/DELETE e WITH CHECK cobre INSERT/UPDATE: o tenant não escreve linha de outro.
  return [`ALTER TABLE ${tab} ENABLE ROW LEVEL SECURITY;`, `ALTER TABLE ${tab} FORCE ROW LEVEL SECURITY;`,
    `DROP POLICY IF EXISTS ${identSql(`${base}_tenant`)} ON ${tab};`, `CREATE POLICY ${identSql(`${base}_tenant`)} ON ${tab}\n  USING (${cond})\n  WITH CHECK (${cond});`]
}

/** Infraestrutura de eventos de um serviço: `outbox` (quem PUBLICA: o evento é gravado na MESMA transação do dado) e `inbox` (quem CONSOME: deduplica entregas repetidas). */
export function ddlEventos(servico: string, publica: boolean, consome: boolean): string[] {
  const esq = identSql(servico), out: string[] = []
  if (publica) {
    const t = `${esq}."outbox"`
    out.push('', `CREATE TABLE IF NOT EXISTS ${t} (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL,
  "tipo" text NOT NULL,
  "versao" text NOT NULL,
  "chave" text,
  "payload" jsonb NOT NULL,
  "ocorrido_em" timestamptz NOT NULL DEFAULT now(),
  "publicado_em" timestamptz,
  "tentativas" integer NOT NULL DEFAULT 0,
  "proxima_em" timestamptz NOT NULL DEFAULT now(),
  "erro" text,
  "morto_em" timestamptz,
  "traceparent" text
);`,
      `ALTER TABLE ${t} ADD COLUMN IF NOT EXISTS "traceparent" text;`, // outbox criado antes desta coluna: reaplicar o DDL a acrescenta (o trace atravessa serviços pelo evento)
      `CREATE UNIQUE INDEX IF NOT EXISTS "outbox_chave_uidx" ON ${t} ("tenant_id", "tipo", "chave") WHERE "chave" IS NOT NULL;`, // o MESMO fato publicado duas vezes vira um evento só
      `CREATE INDEX IF NOT EXISTS "outbox_pendentes_idx" ON ${t} ("proxima_em", "ocorrido_em", "id") WHERE "publicado_em" IS NULL AND "morto_em" IS NULL;`,
      ...sqlRls(t, 'outbox'))
  }
  if (consome) {
    const t = `${esq}."inbox"`
    out.push('', `CREATE TABLE IF NOT EXISTS ${t} (
  "consumidor" text NOT NULL,
  "evento_id" uuid NOT NULL,
  "tenant_id" uuid NOT NULL,
  "processado_em" timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY ("consumidor", "evento_id")
);`, ...sqlRls(t, 'inbox'))
  }
  return out
}

export const eventosDoServico = (spec: { operacoes?: Record<string, { publica?: string[] }>; consome?: string[] }) => ({
  publica: Object.values(spec.operacoes ?? {}).some((o) => (o.publica ?? []).length > 0), consome: (spec.consome ?? []).length > 0,
})

/** DDL de UMA entidade (tabela, índices, RLS) e as FKs dela, separadas porque só podem ser criadas depois de todas as tabelas. */
export function ddlEntidade(servico: string, nome: string, ent: EntidadeSql, entidades: Record<string, unknown>): { tabela: string[]; fks: string[] } {
  const esq = identSql(servico), tab = `${esq}.${identSql(snake(nome))}`
  const tabela: string[] = [], fks: string[] = []
  for (const [campo, c] of Object.entries(ent.campos)) {
    validaReferencia(servico, nome, campo, c, entidades)
    if (c.referencia !== undefined) fks.push(...sqlFk(servico, nome, campo, c.referencia))
    if (RESERVADOS.includes(snake(campo))) throw new EmissaoErro(`servico ${servico}: campo '${campo}' em '${nome}' colide com coluna reservada (${RESERVADOS.join(', ')})`)
  }
  const colunas = [
    '  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid()',
    '  "tenant_id" uuid NOT NULL',
    ...Object.keys(ent.campos).map((c) => colunaSql(c, ent.campos[c]!)),
    '  "criado_em" timestamptz NOT NULL DEFAULT now()',
    '  "atualizado_em" timestamptz NOT NULL DEFAULT now()',
  ]
  tabela.push('', `CREATE TABLE IF NOT EXISTS ${tab} (\n${colunas.join(',\n')}\n);`)
  tabela.push(`CREATE UNIQUE INDEX IF NOT EXISTS ${identSql(`${snake(nome)}_tenant_id_uidx`)} ON ${tab} ("tenant_id", "id");`) // alvo das FKs compostas
  tabela.push(`CREATE INDEX IF NOT EXISTS ${identSql(`${snake(nome)}_tenant_idx`)} ON ${tab} ("tenant_id");`)
  for (const cols of ent.indices ?? []) {
    for (const c of cols) if (!(c in ent.campos)) throw new EmissaoErro(`servico ${servico}: índice de '${nome}' usa campo inexistente '${c}'`)
    tabela.push(sqlIndice(servico, nome, cols))
  }
  for (const cols of ent.unicos ?? []) {
    for (const c of cols) if (!(c in ent.campos)) throw new EmissaoErro(`servico ${servico}: único de '${nome}' usa campo inexistente '${c}'`)
    tabela.push(sqlIndice(servico, nome, cols, true))
  }
  if (ent.busca?.modo === 'aproximada') { // índice trigrama sobre a MESMA expressão da consulta: acelera o LIKE '%palavra%' e a busca aproximada
    for (const c of ent.busca.campos) if (!(c in ent.campos)) throw new EmissaoErro(`servico ${servico}: busca de '${nome}' usa campo inexistente '${c}'`)
    tabela.push(`CREATE INDEX IF NOT EXISTS ${identSql(`${snake(nome)}_busca_trgm`)} ON ${tab} USING gin ((${exprDeBusca(ent.busca.campos, (c) => identSql(snake(c)))}) ${SCHEMA_EXTENSOES}.gin_trgm_ops);`)
  }
  tabela.push(...sqlRls(tab, snake(nome)))
  return { tabela, fks }
}

/** `unico`: unicidade POR TENANT (a chave começa por tenant_id): dois tenants podem ter o mesmo SKU */
export const sqlIndice = (servico: string, entidade: string, cols: string[], unico = false): string =>
  `CREATE ${unico ? 'UNIQUE ' : ''}INDEX IF NOT EXISTS ${identSql(nomeIndice(entidade, cols, unico))} ON ${identSql(servico)}.${identSql(snake(entidade))} ("tenant_id", ${cols.map(snake).map(identSql).join(', ')});`

function emiteSql(no: No): string {
  const spec = no.spec as { entidades: Record<string, EntidadeSql>; operacoes?: Record<string, { publica?: string[] }>; consome?: string[] }
  const out: string[] = [`-- polaris: servico ${no.id}@${no.versao}`, `CREATE SCHEMA IF NOT EXISTS ${identSql(no.id)};`]
  if (Object.values(spec.entidades).some((e) => e.busca?.modo === 'aproximada')) out.push(...ddlExtensaoBusca())
  const fks: string[] = [] // FKs vão DEPOIS de todas as tabelas (ordem e ciclos deixam de importar)
  for (const nome of Object.keys(spec.entidades).sort()) {
    const d = ddlEntidade(no.id, nome, spec.entidades[nome]!, spec.entidades)
    out.push(...d.tabela); fks.push(...d.fks)
  }
  if (fks.length) out.push('', ...fks)
  const ev = eventosDoServico(spec)
  out.push(...ddlEventos(no.id, ev.publica, ev.consome))
  return out.join('\n') + '\n'
}

// ---- html -----------------------------------------------------------------

type Inst = { bloco: string; id?: string; props?: unknown; slots?: Record<string, Inst[]>; se?: string; repetir?: { cada: string; como: string } }

const tag = (iface: string) => `pl-${iface.replace(/\//g, '--')}`

function htmlInst(i: Inst, nivel: number): string {
  const pad = '  '.repeat(nivel)
  const attrs: string[] = []
  if (i.id !== undefined) attrs.push(`id="${escHtml(i.id)}"`)
  if (i.se !== undefined) attrs.push(`data-se="${escHtml(i.se)}"`)
  if (i.repetir) attrs.push(`data-repetir-cada="${escHtml(i.repetir.cada)}"`, `data-repetir-como="${escHtml(i.repetir.como)}"`)
  if (i.props !== undefined && Object.keys(i.props as object).length) attrs.push(`data-props="${escHtml(JSON.stringify(canonico(i.props)))}"`)
  const t = tag(i.bloco)
  const slots = Object.keys(i.slots ?? {}).sort()
  const abre = `<${t}${attrs.length ? ' ' + attrs.join(' ') : ''}>`
  if (!slots.length) return `${pad}${abre}</${t}>`
  const corpo = slots.map((s) => `${pad}  <div data-slot="${escHtml(s)}">\n${i.slots![s]!.map((f) => htmlInst(f, nivel + 2)).join('\n')}\n${pad}  </div>`).join('\n')
  return `${pad}${abre}\n${corpo}\n${pad}</${t}>`
}

function emiteHtml(no: No): string {
  const spec = no.spec as { rota: string; titulo?: string; raiz: Inst }
  return [
    '<!doctype html>',
    '<html lang="pt-BR">',
    '<head>',
    '  <meta charset="utf-8">',
    '  <meta name="viewport" content="width=device-width, initial-scale=1">',
    `  <title>${escHtml(spec.titulo ?? no.id)}</title>`,
    '</head>',
    `<body data-pagina="${escHtml(no.id)}" data-versao="${escHtml(no.versao)}" data-rota="${escHtml(spec.rota)}">`,
    htmlInst(spec.raiz, 1),
    '</body>',
    '</html>',
    '',
  ].join('\n')
}

// ---- api ------------------------------------------------------------------

/** Emite o nó no alvo. Lança EmissaoErro se o kind não suporta o alvo ou se o conteúdo é inseguro para o formato. */
export function emite(no: No, alvo: Alvo, _opcoes: OpcoesEmissao = {}): string {
  if (!alvosDe(no.kind).includes(alvo)) {
    throw new EmissaoErro(`o kind '${no.kind}' não tem emissão '${alvo}' (disponíveis: ${alvosDe(no.kind).join(', ')})`)
  }
  switch (alvo) {
    case 'json': return jsonCanonico(no)
    case 'js': return emiteJs(no)
    case 'tex': return emiteTex(no)
    case 'css': return emiteCss(no)
    case 'sql': return emiteSql(no)
    case 'html': return emiteHtml(no)
    case 'openapi': return emiteOpenApi(no)
  }
}

/** Alvos de `no.emit` que são tratados por backends próprios (kernel, documento): não são emissões deste módulo. */
const DELEGADOS = ['wasm', 'glsl', 'ptx', 'pdf'] as const

/** Emite todos os alvos de `no.emit` (padrão: json). Alvos de outros backends voltam em `delegadas`; alvo sem suporte no kind é erro. */
export function emiteDeclaradas(no: No): { saida: Partial<Record<Alvo, string>>; delegadas: string[] } {
  const saida: Partial<Record<Alvo, string>> = {}
  const delegadas: string[] = []
  for (const a of no.emit ?? ['json']) {
    if ((DELEGADOS as readonly string[]).includes(a)) delegadas.push(a)
    else saida[a as Alvo] = emite(no, a as Alvo)
  }
  return { saida, delegadas }
}
