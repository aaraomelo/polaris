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
//   html | pagina                                 | HTML canônico (blocos como custom elements, ilhas)
// ---------------------------------------------------------------------------

export type Alvo = 'json' | 'js' | 'tex' | 'css' | 'sql' | 'html'

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
  servico: ['sql'],
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
const identSql = (s: string) => `"${s.replace(/"/g, '""')}"`

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

const TIPO_SQL: Record<string, string> = {
  texto: 'text', inteiro: 'bigint', decimal: 'numeric', booleano: 'boolean', data: 'date',
  dataHora: 'timestamptz', dinheiro: 'numeric(19,4)', uuid: 'uuid', json: 'jsonb',
}
const snake = (s: string) => s.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase()

function literalSql(v: unknown, tipo: string): string {
  if (v === null) return 'NULL'
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE'
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) throw new EmissaoErro(`valor padrão inválido: ${v}`)
    return String(v)
  }
  if (tipo === 'json') return `${aspasSql(JSON.stringify(v))}::jsonb`
  return aspasSql(String(v))
}

type Campo = { tipo: string; obrigatorio?: boolean; lista?: boolean; padrao?: unknown }

function colunaSql(nome: string, c: Campo): string {
  const base = TIPO_SQL[c.tipo]!
  const tipo = c.lista && c.tipo !== 'json' ? `${base}[]` : base
  const partes = [`  ${identSql(snake(nome))} ${tipo}`]
  if (c.obrigatorio) partes.push('NOT NULL')
  if (c.padrao !== undefined) partes.push(`DEFAULT ${literalSql(c.padrao, c.tipo)}`)
  return partes.join(' ')
}

function emiteSql(no: No): string {
  const spec = no.spec as { entidades: Record<string, { campos: Record<string, Campo>; indices?: string[][] }> }
  const esq = identSql(no.id)
  const out: string[] = [`-- polaris: servico ${no.id}@${no.versao}`, `CREATE SCHEMA IF NOT EXISTS ${esq};`]
  for (const nome of Object.keys(spec.entidades).sort()) {
    const ent = spec.entidades[nome]!
    const tab = `${esq}.${identSql(snake(nome))}`
    const reservados = ['id', 'tenant_id', 'criado_em', 'atualizado_em']
    for (const campo of Object.keys(ent.campos)) {
      if (reservados.includes(snake(campo))) throw new EmissaoErro(`servico ${no.id}: campo '${campo}' em '${nome}' colide com coluna reservada (${reservados.join(', ')})`)
    }
    const colunas = [
      '  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid()',
      '  "tenant_id" uuid NOT NULL',
      ...Object.keys(ent.campos).map((c) => colunaSql(c, ent.campos[c]!)),
      '  "criado_em" timestamptz NOT NULL DEFAULT now()',
      '  "atualizado_em" timestamptz NOT NULL DEFAULT now()',
    ]
    out.push('', `CREATE TABLE IF NOT EXISTS ${tab} (\n${colunas.join(',\n')}\n);`)
    out.push(`CREATE INDEX IF NOT EXISTS ${identSql(`${snake(nome)}_tenant_idx`)} ON ${tab} ("tenant_id");`)
    for (const cols of ent.indices ?? []) {
      for (const c of cols) if (!(c in ent.campos)) throw new EmissaoErro(`servico ${no.id}: índice de '${nome}' usa campo inexistente '${c}'`)
      const nomes = cols.map(snake)
      out.push(`CREATE INDEX IF NOT EXISTS ${identSql(`${snake(nome)}_${nomes.join('_')}_idx`)} ON ${tab} ("tenant_id", ${nomes.map(identSql).join(', ')});`)
    }
    out.push(`ALTER TABLE ${tab} ENABLE ROW LEVEL SECURITY;`, `ALTER TABLE ${tab} FORCE ROW LEVEL SECURITY;`)
    const cond = `"tenant_id" = current_setting('app.tenant_id')::uuid`
    // USING cobre SELECT/UPDATE/DELETE e WITH CHECK cobre INSERT/UPDATE: o tenant não escreve linha de outro.
    out.push(`DROP POLICY IF EXISTS ${identSql(`${snake(nome)}_tenant`)} ON ${tab};`, `CREATE POLICY ${identSql(`${snake(nome)}_tenant`)} ON ${tab}\n  USING (${cond})\n  WITH CHECK (${cond});`)
  }
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
