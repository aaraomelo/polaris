import { verdadeiro } from '../expr/avalia'
import { FUNCOES_PADRAO } from '../expr/funcoes'
import type { Funcoes } from '../expr/tipos'
import type { IRElemento, IRNo, Valor } from '../ir/tipos'
import type { Programa } from '../render/programa'
import { paraTexto } from '../render/valor'
import type { ErroRuntime } from '../render/tipos'
import { INTERATIVOS, type Emissores } from './emissores'
import { compilaExpr, type Fn } from './expr'
import type { Escopo } from '../expr/avalia'

// ---------------------------------------------------------------------------
// Tradução do IR para uma função JS especializada (o "caminho estático").
//  - Bloco composto → uma função; `repetir` → laço; `se` → condicional; bloco nativo → emissor de string.
//  - O código gerado NUNCA contém texto do usuário: só literais escapados por JSON.stringify e referências a closures
//    de expressão já compiladas (E[i]). Não há `eval` de expressão alguma.
//  - Só traduz o que não precisa de JavaScript no navegador. O resto volta com o motivo.
//  - Mesma semântica do interpretador React (render/interpreta.tsx): a equivalência é conferida por teste diferencial.
// ---------------------------------------------------------------------------

export type Motivo = { caminho: string; motivo: string }
export type Estatico = {
  /** o JavaScript gerado (para inspeção e para AOT: pode ser gravado em arquivo) */
  fonte: string
  render(esc: Escopo, onErro?: (e: ErroRuntime) => void): string
  titulo(esc: Escopo): string
}

const LIMITE_ITERACOES = 1000
const LIMITE_PROFUNDIDADE = 200
const chave = (k: string) => (k === '__proto__' ? '["__proto__"]' : JSON.stringify(k)) // literal {"__proto__": v} mudaria o protótipo

type Ctx = { exprs: Fn[]; emissoresUsados: Array<(e: never) => string>; porNome: Map<string, number>; blocos: Map<string, string>; fontesBlocos: string[]; motivos: Motivo[]; programa: Programa; emissores: Emissores; funcoes: Funcoes }

const expr = (c: Ctx, ast: Parameters<typeof compilaExpr>[0]): string => { c.exprs.push(compilaExpr(ast, c.funcoes)); return `E[${c.exprs.length - 1}]` }

function valor(c: Ctx, v: Valor): string {
  switch (v.t) {
    case 'lit': return JSON.stringify(v.v)
    case 'expr': return `${expr(c, v.ast)}(esc)`
    case 'tpl': return '(' + v.partes.map((p) => (typeof p === 'string' ? JSON.stringify(p) : `X.t(${expr(c, p.ast)}(esc))`)).join('+') + ')'
    case 'arr': return '[' + v.itens.map((i) => valor(c, i)).join(',') + ']'
    case 'obj': return '{' + Object.entries(v.campos).map(([k, x]) => `${chave(k)}:${valor(c, x)}`).join(',') + '}'
  }
}

const concat = (partes: string[]) => (partes.length ? '(' + partes.join('+') + ')' : '""')

function emissorDe(c: Ctx, el: IRElemento): number | null {
  for (const i of el.bloco.cadeia) if (INTERATIVOS.has(i)) { c.motivos.push({ caminho: el.caminho, motivo: `o bloco '${i}' é interativo (precisa de JavaScript no cliente)` }); return null }
  const iface = el.bloco.cadeia.find((i) => c.emissores[i])
  if (!iface) { c.motivos.push({ caminho: el.caminho, motivo: `o bloco '${el.bloco.interface}' não tem emissor estático` }); return null }
  let k = c.porNome.get(iface)
  if (k === undefined) { k = c.emissoresUsados.length; c.emissoresUsados.push(c.emissores[iface]! as never); c.porNome.set(iface, k) }
  return k
}

function funcaoDoBloco(c: Ctx, iface: string, caminho: string): string | null {
  const ja = c.blocos.get(iface)
  if (ja) return ja
  const m = c.programa.blocos[iface]
  if (!m) { c.motivos.push({ caminho, motivo: `o modelo do bloco '${iface}' não está no programa` }); return null }
  const nome = `B${c.blocos.size}`
  c.blocos.set(iface, nome) // registrado antes de gerar o corpo (o corpo pode referenciar outros blocos)
  const corpo = nodo(c, m.modelo)
  c.fontesBlocos.push(`function ${nome}(props, tenant, host, d) { if (d > ${LIMITE_PROFUNDIDADE}) return ""; const esc = { props: props, tenant: tenant }; return ${corpo} }`)
  return nome
}

function elemento(c: Ctx, el: IRElemento): string {
  if (el.eventos && Object.keys(el.eventos).length) c.motivos.push({ caminho: el.caminho, motivo: 'tem eventos (precisa de JavaScript no cliente)' })
  if (el.aguarda?.length) c.motivos.push({ caminho: el.caminho, motivo: 'usa dado em streaming' })
  if (el.esqueleto) c.motivos.push({ caminho: el.caminho, motivo: 'tem esqueleto (streaming)' })
  const props = '{' + Object.entries(el.props).map(([k, v]) => `${chave(k)}:${valor(c, v)}`).join(',') + '}'

  if (el.bloco.impl === 'codigo') { c.motivos.push({ caminho: el.caminho, motivo: `o bloco '${el.bloco.interface}' é código customizado (executa isolado)` }); return '""' }
  if (el.bloco.impl === 'composto') {
    const f = funcaoDoBloco(c, el.bloco.interface, el.caminho)
    if (!f) return '""'
    const host = 'X.host([' + Object.entries(el.slots).map(([nome, lista]) => `[${JSON.stringify(nome)},()=>${concat(lista.map((n) => nodo(c, n)))}]`).join(',') + '])'
    return `${f}(${props}, esc.tenant, ${host}, d + 1)`
  }
  const k = emissorDe(c, el)
  if (k === null) return '""'
  const filhos = '{' + Object.entries(el.slots).map(([nome, lista]) => `${chave(nome)}:${concat(lista.map((n) => nodo(c, n)))}`).join(',') + '}'
  return `X.e[${k}]({props:${props},filhos:${filhos},id:${el.id === undefined ? 'undefined' : JSON.stringify(el.id)}})`
}

function nodo(c: Ctx, n: IRNo): string {
  let out = n.tipo === 'slot' ? `X.slot(host, ${JSON.stringify(n.nome)})` : elemento(c, n)
  if (n.repetir) out = `X.rep(${expr(c, n.repetir.cada)}(esc), ${JSON.stringify(n.repetir.como)}, esc, (esc) => ${out}, R, ${JSON.stringify(n.caminho)})`
  if (n.se) out = `(X.v(${expr(c, n.se)}(esc)) ? ${out} : "")`
  return out
}

/** Roteiro de tempo de execução usado pelo código gerado. */
function runtime(emissores: Array<(e: never) => string>) {
  return {
    t: paraTexto,
    v: verdadeiro,
    e: emissores,
    host: (entradas: Array<[string, () => string]>) => { const h = Object.create(null) as Record<string, () => string>; for (const [k, f] of entradas) h[k] = f; return h },
    slot: (host: Record<string, () => string> | null, nome: string) => (host !== null && host[nome] ? host[nome]!() : ''),
    rep: (lista: unknown, como: string, esc: Escopo, f: (e: Escopo) => string, R: ((e: ErroRuntime) => void) | null, caminho: string): string => {
      if (!Array.isArray(lista)) return ''
      const n = lista.length > LIMITE_ITERACOES ? LIMITE_ITERACOES : lista.length
      if (lista.length > LIMITE_ITERACOES) R?.({ caminho, regra: 'limite', mensagem: `repetir com ${lista.length} itens; renderizando os primeiros ${LIMITE_ITERACOES}` })
      let r = ''
      for (let i = 0; i < n; i++) r += f({ ...esc, [como]: lista[i], indice: i })
      return r
    },
  }
}

export function geraEstatico(programa: Programa, emissores: Emissores, funcoes: Funcoes = FUNCOES_PADRAO): { ok: true; estatico: Estatico } | { ok: false; motivos: Motivo[] } {
  const c: Ctx = { exprs: [], emissoresUsados: [], porNome: new Map(), blocos: new Map(), fontesBlocos: [], motivos: [], programa, emissores, funcoes }
  for (const [nome, d] of Object.entries(programa.pagina.dados)) if (d.stream) c.motivos.push({ caminho: `/spec/dados/${nome}`, motivo: 'dado em streaming' })
  const raiz = nodo(c, programa.pagina.raiz)
  const titulo = programa.pagina.titulo ? valor(c, programa.pagina.titulo) : '""'
  if (c.motivos.length) return { ok: false, motivos: c.motivos }
  const fonte = [
    '"use strict";', 'let R = null;',
    ...c.fontesBlocos,
    `function render(esc, onErro) { R = onErro || null; const host = null, d = 0; return ${raiz} }`,
    `function titulo(esc) { const v = ${titulo}; return v === null || v === undefined || typeof v === "object" ? "" : String(v) }`,
    'return { render: render, titulo: titulo };',
  ].join('\n')
  const X = runtime(c.emissoresUsados)
  const f = new Function('E', 'X', fonte) as (E: Fn[], X: unknown) => { render: Estatico['render']; titulo: Estatico['titulo'] }
  return { ok: true, estatico: { fonte, ...f(c.exprs, X) } }
}
