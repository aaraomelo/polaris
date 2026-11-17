import type { Contexto, No, Registry } from '@polaris/schema'
import { compilaHtmlVivo } from '../estatico/index'
import { compilaPrograma } from '../render/programa'
import { auditaTema, TOKENS_COR } from '../tema/index'

// ---------------------------------------------------------------------------------------------------------------------------------------------
// Catálogo de blocos: documentação VIVA gerada do registry. Nada é copiado à mão:
//   - props, slots e eventos vêm do bloco RESOLVIDO (com `extends` e override do tenant);
//   - título, descrição e exemplos vêm do próprio nó do bloco (spec.titulo/descricao/exemplos);
//   - cada exemplo é compilado e renderizado pelo runtime real (o preview É o produto), e um exemplo inválido aparece como erro, nunca derruba o catálogo.
// Saída: HTML (claro e escuro) e Markdown, ambos determinísticos.
// ---------------------------------------------------------------------------------------------------------------------------------------------

export type OpcoesCatalogo = {
  contexto?: Contexto
  /** o tema do preview (nó `tema`); com ele, o catálogo mostra os tokens e a auditoria de contraste */
  tema?: No
  /** href da folha de estilo do tema (o chamador a escreve ao lado); sem ele, o preview sai sem estilo */
  estiloHref?: string
  titulo?: string
}
export type SaidaCatalogo = { html: { claro: string; escuro: string }; markdown: string; blocos: number; exemplos: number; erros: string[] }

const esc = (s: unknown): string => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
const slug = (s: string) => s.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '').toLowerCase()
const json = (v: unknown) => JSON.stringify(v, null, 2)

type Schema = Record<string, unknown>
/** descreve o tipo de uma propriedade em português curto: `texto`, `número ≥ 1 ≤ 12`, `'a' | 'b'`… */
export function descreveTipo(s: unknown): string {
  if (!s || typeof s !== 'object') return 'qualquer'
  const x = s as Schema
  if (Array.isArray(x.enum)) return (x.enum as unknown[]).map((v) => JSON.stringify(v)).join(' | ')
  const NOMES: Record<string, string> = { string: 'texto', number: 'número', integer: 'inteiro', boolean: 'booleano', object: 'objeto', array: 'lista', null: 'nulo' }
  const t = Array.isArray(x.type) ? (x.type as string[]).map((n) => NOMES[n] ?? n).join(' | ') : typeof x.type === 'string' ? (NOMES[x.type] ?? x.type) : 'qualquer'
  const lim: string[] = []
  if (typeof x.minimum === 'number') lim.push(`≥ ${x.minimum}`)
  if (typeof x.maximum === 'number') lim.push(`≤ ${x.maximum}`)
  if (typeof x.minLength === 'number') lim.push(`≥ ${x.minLength} caracteres`)
  if (typeof x.maxLength === 'number') lim.push(`≤ ${x.maxLength} caracteres`)
  return lim.length ? `${t} ${lim.join(' ')}` : t
}

type Exemplo = { titulo: string; descricao?: string; instancia: unknown }
type Doc = {
  interface: string; grupo: string; titulo: string; descricao: string; cadeia: string[]
  props: Array<{ nome: string; tipo: string; obrigatorio: boolean; descricao: string; padrao: string }>
  slots: Array<{ nome: string; aceita: string; min: string; max: string }>
  eventos: Array<{ nome: string; payload: string }>
  exemplos: Array<Exemplo & { html: string | null; erro: string | null }>
}

function renderExemplo(reg: Registry, ctx: Contexto, interfaceId: string, i: number, e: Exemplo): { html: string | null; erro: string | null } {
  try {
    const no = { kind: 'pagina', id: `catalogo.${slug(interfaceId)}.${i}`, versao: '1.0.0', estatuto: 'publicado', spec: { rota: '/', raiz: e.instancia } } as unknown as No
    const c = compilaPrograma(reg, no, ctx)
    if (!c.ok) return { html: null, erro: c.erros.map((x) => `${x.caminho}: ${x.mensagem}`).join('; ') }
    const h = compilaHtmlVivo(c.programa)
    if (!h.ok) return { html: null, erro: h.motivos.map((m) => m.motivo).join('; ') }
    return { html: h.pagina.render({}).corpo, erro: null }
  } catch (err) { return { html: null, erro: err instanceof Error ? err.message : String(err) } }
}

function documenta(reg: Registry, ctx: Contexto, interfaceId: string, spec: Record<string, unknown>): Doc {
  const r = reg.resolveBloco(interfaceId, ctx)
  const props = (r.props?.properties ?? {}) as Record<string, Schema>
  const obrig = new Set(r.props?.required ?? [])
  const exemplos = (Array.isArray(spec.exemplos) ? spec.exemplos : []) as Exemplo[]
  return {
    interface: interfaceId, grupo: interfaceId.split('/')[0]!, titulo: typeof spec.titulo === 'string' ? spec.titulo : interfaceId,
    descricao: typeof spec.descricao === 'string' ? spec.descricao : '', cadeia: r.cadeia,
    props: Object.keys(props).sort().map((nome) => ({ nome, tipo: descreveTipo(props[nome]), obrigatorio: obrig.has(nome), descricao: typeof props[nome]!.description === 'string' ? (props[nome]!.description as string) : '', padrao: props[nome]!.default !== undefined ? JSON.stringify(props[nome]!.default) : '' })),
    slots: Object.keys(r.slots).sort().map((nome) => { const s = r.slots[nome]!; return { nome, aceita: s.aceita?.length ? s.aceita.join(', ') : 'qualquer bloco', min: s.min !== undefined ? String(s.min) : '', max: s.max !== undefined ? String(s.max) : '' } }),
    eventos: Object.keys(r.eventos).sort().map((nome) => ({ nome, payload: r.eventos[nome]!.payload ?? '' })),
    exemplos: exemplos.map((e, i) => ({ ...e, ...renderExemplo(reg, ctx, interfaceId, i, e) })),
  }
}

const tabelaHtml = (cab: string[], linhas: string[][]): string =>
  `<table><thead><tr>${cab.map((c) => `<th>${esc(c)}</th>`).join('')}</tr></thead><tbody>${linhas.map((l) => `<tr>${l.map((c, i) => (i === 0 ? `<td><code>${esc(c)}</code></td>` : `<td>${esc(c)}</td>`)).join('')}</tr>`).join('')}</tbody></table>`

function blocoHtml(d: Doc): string {
  const id = slug(d.interface)
  const p = d.props.length ? tabelaHtml(['Prop', 'Tipo', 'Obrigatória', 'Padrão', 'Descrição'], d.props.map((x) => [x.nome, x.tipo, x.obrigatorio ? 'sim' : 'não', x.padrao, x.descricao])) : '<p><small>Sem props.</small></p>'
  const s = d.slots.length ? tabelaHtml(['Slot', 'Aceita', 'Mín.', 'Máx.'], d.slots.map((x) => [x.nome, x.aceita, x.min, x.max])) : ''
  const e = d.eventos.length ? tabelaHtml(['Evento', 'Payload'], d.eventos.map((x) => [x.nome, x.payload || '—'])) : ''
  const ex = d.exemplos.map((x) => `<section class="cat-exemplo"><h4>${esc(x.titulo)}</h4>${x.descricao ? `<p>${esc(x.descricao)}</p>` : ''}` +
    (x.erro !== null ? `<div role="alert" data-tom="erro">Exemplo inválido: ${esc(x.erro)}</div>` : `<div class="cat-previa">${x.html}</div>`) +
    `<details><summary>Como declarar</summary><pre><code>${esc(json(x.instancia))}</code></pre></details></section>`).join('')
  return `<article id="${esc(id)}"><h3>${esc(d.titulo)} <small><code>${esc(d.interface)}</code></small></h3><p>${esc(d.descricao)}</p>` +
    (d.cadeia.length > 1 ? `<p><small>Herda de: ${d.cadeia.slice(1).map((c) => `<code>${esc(c)}</code>`).join(' → ')}</small></p>` : '') +
    `<h4>Props</h4>${p}${s ? `<h4>Slots</h4>${s}` : ''}${e ? `<h4>Eventos</h4>${e}` : ''}${ex ? `<h4>Exemplos</h4>${ex}` : ''}</article>`
}

const HEX = /^#[0-9a-fA-F]{3,8}$/
function temaHtml(tema: No): string {
  const spec = tema.spec as { tokens: { cor?: Record<string, string> }; modos?: Record<string, { cor?: Record<string, string> }> }
  const modos: Array<[string, Record<string, string>]> = [['claro', spec.tokens.cor ?? {}], ...Object.entries(spec.modos ?? {}).map(([m, v]) => [m, { ...(spec.tokens.cor ?? {}), ...(v.cor ?? {}) }] as [string, Record<string, string>])]
  const avisos = auditaTema(tema)
  const tab = modos.map(([m, cor]) => `<h4>Modo ${esc(m)}</h4>` + tabelaHtml(['Token', 'Valor'], TOKENS_COR.filter((t) => cor[t]).map((t) => [t, cor[t]!])).replace(/<td>(#[0-9a-fA-F]{3,8})<\/td>/g, (_x, c: string) => (HEX.test(c) ? `<td><span class="cat-amostra" style="background:${c}"></span> ${esc(c)}</td>` : `<td>${esc(c)}</td>`))).join('')
  const aud = avisos.length ? `<div role="alert" data-tom="alerta">Contraste abaixo de AA: ${avisos.map((a) => `${esc(a.modo)}: ${esc(a.par)} (${a.contraste} &lt; ${a.minimo})`).join('; ')}</div>` : '<div role="alert" data-tom="sucesso">Todos os pares críticos passam AA em todos os modos.</div>'
  return `<section id="tema"><h2>Tema <small><code>${esc(tema.id)}</code></small></h2>${aud}${tab}</section>`
}

const CSS_CATALOGO = `/* catálogo: só o que não é bloco; tudo pelas variáveis do tema */
.cat-corpo{display:grid;grid-template-columns:14rem 1fr;gap:calc(var(--espacamento-base) * 4);max-width:90rem;margin:0 auto;padding:calc(var(--espacamento-base) * 2)}
.cat-nav{position:sticky;top:var(--espacamento-base);align-self:start;max-height:95vh;overflow:auto;font-size:.9em}
.cat-nav ul{list-style:none;padding:0;margin:0 0 var(--espacamento-base)}
.cat-previa{padding:calc(var(--espacamento-base) * 2);background:var(--cor-fundo);border:var(--espacamento-borda) dashed var(--cor-borda);border-radius:var(--raio-grande);margin-bottom:var(--espacamento-base)}
.cat-exemplo{margin-bottom:calc(var(--espacamento-base) * 2)}
.cat-amostra{display:inline-block;width:1em;height:1em;border:var(--espacamento-borda) solid var(--cor-borda);vertical-align:middle}
article{padding-bottom:calc(var(--espacamento-base) * 3);border-bottom:var(--espacamento-borda) solid var(--cor-borda);margin-bottom:calc(var(--espacamento-base) * 3)}
pre{overflow:auto;background:var(--cor-superficie-alt);padding:var(--espacamento-base);border-radius:var(--raio-pequeno)}
@media (max-width:48rem){.cat-corpo{grid-template-columns:1fr}.cat-nav{position:static}}
`
export const CSS_DO_CATALOGO = CSS_CATALOGO

function pagina(titulo: string, corpo: string, nav: string, o: OpcoesCatalogo, modo?: string, cssCatalogo = 'catalogo.css'): string {
  const links = [o.estiloHref, cssCatalogo].filter(Boolean).map((h) => `<link rel="stylesheet" href="${esc(h)}">`).join('')
  return `<!doctype html><html lang="pt-BR"${modo ? ` data-modo="${esc(modo)}"` : ''}><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(titulo)}</title>${links}</head>` +
    `<body><div id="polaris"><div class="cat-corpo"><nav class="cat-nav" aria-label="Blocos">${nav}</nav><main>${corpo}</main></div></div></body></html>`
}

export function geraCatalogo(reg: Registry, opcoes: OpcoesCatalogo = {}): SaidaCatalogo {
  const ctx = opcoes.contexto ?? {}
  const titulo = opcoes.titulo ?? 'Catálogo de blocos'
  const docs: Doc[] = []
  const erros: string[] = []
  const vistos = new Set<string>()
  for (const id of reg.ids('bloco')) {
    const r = reg.resolve('bloco', id, ctx)
    if (!r) continue
    const spec = r.no.spec as Record<string, unknown>
    const i = spec.interface as string
    if (vistos.has(i)) continue
    vistos.add(i)
    try { docs.push(documenta(reg, ctx, i, spec)) } catch (e) { erros.push(`${i}: ${e instanceof Error ? e.message : String(e)}`) }
  }
  docs.sort((a, b) => (a.grupo === b.grupo ? (a.interface < b.interface ? -1 : 1) : a.grupo < b.grupo ? -1 : 1))
  for (const d of docs) for (const e of d.exemplos) if (e.erro !== null) erros.push(`${d.interface} › ${e.titulo}: ${e.erro}`)

  const grupos = [...new Set(docs.map((d) => d.grupo))]
  const nav = (opcoes.tema ? '<ul><li><a href="#tema">Tema</a></li></ul>' : '') + grupos.map((g) => `<strong>${esc(g)}</strong><ul>${docs.filter((d) => d.grupo === g).map((d) => `<li><a href="#${esc(slug(d.interface))}">${esc(d.titulo)}</a></li>`).join('')}</ul>`).join('')
  const corpo = `<h1>${esc(titulo)}</h1><p>${docs.length} blocos, ${docs.reduce((n, d) => n + d.exemplos.length, 0)} exemplos. Gerado do registry: props, slots e eventos do schema; os previews são renderizados pelo runtime. <a href="escuro.html">Ver no modo escuro</a> · <a href="index.html">claro</a></p>` +
    (opcoes.tema ? temaHtml(opcoes.tema) : '') + grupos.map((g) => `<section><h2>${esc(g)}</h2>${docs.filter((d) => d.grupo === g).map(blocoHtml).join('')}</section>`).join('')

  const md: string[] = [`# ${titulo}`, '', `${docs.length} blocos. Gerado do registry (\`pnpm catalogo\`); não edite à mão: a fonte é o nó de cada bloco.`, '']
  for (const g of grupos) {
    md.push(`## ${g}`, '')
    for (const d of docs.filter((x) => x.grupo === g)) {
      md.push(`### ${d.titulo} (\`${d.interface}\`)`, '', d.descricao, '')
      if (d.cadeia.length > 1) md.push(`Herda de: ${d.cadeia.slice(1).map((c) => `\`${c}\``).join(' → ')}`, '')
      const t = (cab: string[], l: string[][]) => [`| ${cab.join(' | ')} |`, `|${cab.map(() => '---').join('|')}|`, ...l.map((r) => `| ${r.map((c) => c.replace(/\|/g, '\\|')).join(' | ')} |`), '']
      if (d.props.length) md.push('**Props**', '', ...t(['Prop', 'Tipo', 'Obrig.', 'Padrão', 'Descrição'], d.props.map((p) => [`\`${p.nome}\``, p.tipo, p.obrigatorio ? 'sim' : 'não', p.padrao, p.descricao])))
      if (d.slots.length) md.push('**Slots**', '', ...t(['Slot', 'Aceita', 'Mín.', 'Máx.'], d.slots.map((s) => [`\`${s.nome}\``, s.aceita, s.min, s.max])))
      if (d.eventos.length) md.push('**Eventos**', '', ...t(['Evento', 'Payload'], d.eventos.map((e) => [`\`${e.nome}\``, e.payload || '—'])))
      for (const e of d.exemplos) md.push(`**Exemplo: ${e.titulo}**`, '', '```json', json(e.instancia), '```', '')
    }
  }
  return {
    html: { claro: pagina(titulo, corpo, nav, opcoes), escuro: pagina(titulo, corpo, nav, opcoes, 'escuro') },
    markdown: md.join('\n') + '\n', blocos: docs.length, exemplos: docs.reduce((n, d) => n + d.exemplos.length, 0), erros,
  }
}
