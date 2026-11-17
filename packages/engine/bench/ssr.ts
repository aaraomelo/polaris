// Benchmark do caminho de renderização: onde o tempo vai? (rode: pnpm bench)
import { Registry } from '@polaris/schema'
import { createElement, Fragment } from 'react'
import { renderToString } from 'react-dom/server'
import { avalia, compilaPrograma, escopoDaPagina, FUNCOES_PADRAO, parseExpr, registraBase, renderiza, renderPaginaHtml, COMPONENTES_BASE, type Programa } from '../src/index'

const no = (kind: string, id: string, spec: object) => ({ kind, id, versao: '1.0.0', estatuto: 'publicado', spec }) as any
const P = (b: string, extra: object = {}) => ({ bloco: b, ...extra })

function monta(): Programa {
  const r = new Registry(); registraBase(r)
  r.registra(no('servico', 'catalogo', { entidades: {}, operacoes: {} }))
  r.registra(no('dados', 'd.prod', { fonte: { tipo: 'servico', servico: 'catalogo', operacao: 'listar' } }))
  r.registra(no('bloco', 'x.cartao', { interface: 'x/cartao', props: { type: 'object', properties: { titulo: { type: 'string' }, preco: { type: 'number' }, id: { type: 'integer' } } },
    modelo: P('layout/pilha', { props: { gap: 4 }, slots: { filhos: [
      P('texto/titulo', { props: { texto: '{props.titulo}', nivel: 3 } }),
      P('texto/paragrafo', { props: { texto: '{props.preco | brl}' } }),
      P('nav/link', { props: { href: '/p/{props.id}', texto: 'Ver produto' } }),
    ] } }) }))
  const res = compilaPrograma(r, r.registra(no('pagina', 'p', { rota: '/', titulo: 'Loja ({produtos.length})', dados: { produtos: 'd.prod' },
    raiz: P('layout/pilha', { slots: { filhos: [
      P('texto/titulo', { props: { texto: 'Produtos' } }),
      P('x/cartao', { repetir: { cada: 'produtos', como: 'p' }, props: { titulo: '{p.nome}', preco: '{p.preco}', id: '{p.id}' } }),
    ] } }) })))
  if (!res.ok) throw new Error(JSON.stringify(res.erros))
  return res.programa
}

const dados = (n: number) => ({ produtos: Array.from({ length: n }, (_, i) => ({ id: i, nome: `Produto ${i}`, preco: 10 + i * 1.5 })) })

/** mediana e p95 em ms, com aquecimento. */
function mede(nome: string, f: () => unknown, iter = 15): { nome: string; med: number; p95: number } {
  for (let i = 0; i < 4; i++) f()
  const t: number[] = []
  for (let i = 0; i < iter; i++) { const a = performance.now(); f(); t.push(performance.now() - a) }
  t.sort((x, y) => x - y)
  return { nome, med: t[Math.floor(t.length / 2)]!, p95: t[Math.floor(t.length * 0.95)]! }
}
const tab = (rs: Array<{ nome: string; med: number; p95: number }>, base?: number) => {
  for (const r of rs) console.log(`  ${r.nome.padEnd(46)} ${r.med.toFixed(2).padStart(8)} ms  (p95 ${r.p95.toFixed(2).padStart(7)})${base ? `  ${(base / r.med).toFixed(1).padStart(5)}x` : ''}`)
}

// --- renderizador de string direto do IR, sem React (protótipo para isolar o custo do React) ---
import { valorDe } from '../src/render/valor'
import type { IRNo } from '../src/index'
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const txt = (v: unknown) => (typeof v === 'string' ? v : typeof v === 'number' ? String(v) : '')
function strNo(no: IRNo, escopo: Record<string, unknown>, pg: Programa, host: Record<string, () => string> | null): string {
  if (no.se && !avalia(no.se, escopo, FUNCOES_PADRAO)) return ''
  if (no.repetir) {
    const l = avalia(no.repetir.cada, escopo, FUNCOES_PADRAO)
    return Array.isArray(l) ? l.map((item, i) => um(no, { ...escopo, [no.repetir!.como]: item, indice: i }, pg, host)).join('') : ''
  }
  return um(no, escopo, pg, host)
}
function um(no: IRNo, escopo: Record<string, unknown>, pg: Programa, host: Record<string, () => string> | null): string {
  if (no.tipo === 'slot') return host?.[no.nome]?.() ?? ''
  const props: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(no.props)) props[k] = valorDe(v, escopo)
  const filhos = (n: string) => (no.slots[n] ?? []).map((f) => strNo(f, escopo, pg, host)).join('')
  switch (no.bloco.interface) {
    case 'layout/pilha': return `<div style="display:flex;flex-direction:column${typeof props.gap === 'number' ? `;gap:${props.gap}px` : ''}">${filhos('filhos')}</div>`
    case 'texto/titulo': { const n = Math.min(6, Math.max(1, Math.trunc((props.nivel as number) ?? 1))); return `<h${n}>${esc(txt(props.texto))}</h${n}>` }
    case 'texto/paragrafo': return `<p>${esc(txt(props.texto))}</p>`
    case 'nav/link': return `<a href="${esc(txt(props.href))}">${esc(txt(props.texto))}</a>`
    case 'x/cartao': {
      const doHost = Object.fromEntries(Object.entries(no.slots).map(([n, l]) => [n, () => (l as IRNo[]).map((f) => strNo(f, escopo, pg, host)).join('')]))
      return strNo(pg.blocos['x/cartao']!.modelo, { props, tenant: escopo.tenant }, pg, doHost)
    }
  }
  return ''
}

const pg = monta()
console.log(`Node ${process.version}  |  página: lista de cartões (bloco composto com 3 blocos nativos + 2 bindings por cartão)\n`)
for (const n of [200, 1000]) {
  const d = dados(n)
  const entrada = { programa: pg, componentes: COMPONENTES_BASE, dados: d }
  const escopo = escopoDaPagina(entrada)
  const amb = { programa: pg, componentes: COMPONENTES_BASE }
  const arvore = renderiza(pg.pagina.raiz, escopo, amb, null, 'r')
  const htmlReact = renderPaginaHtml(entrada).corpo
  const htmlStr = strNo(pg.pagina.raiz, escopo, pg, null)
  const igual = htmlReact === htmlStr
  console.log(`=== ${n} cartões  (HTML: ${(htmlReact.length / 1024).toFixed(0)} KB; saída do protótipo sem React idêntica à do React: ${igual})`)
  const total = mede('SSR completo (renderPaginaHtml, hoje)', () => renderPaginaHtml(entrada))
  const interp = mede('  └ interpretador → elementos React', () => renderiza(pg.pagina.raiz, escopo, amb, null, 'r'))
  const rts = mede('  └ React renderToString da árvore pronta', () => renderToString(createElement(Fragment, null, ...arvore)))
  const semReact = mede('protótipo: IR → string direto (sem React)', () => strNo(pg.pagina.raiz, escopo, pg, null))
  tab([total, interp, rts, semReact], total.med)
  console.log(`  → React (renderToString) = ${((rts.med / total.med) * 100).toFixed(0)}% do SSR; interpretador = ${((interp.med / total.med) * 100).toFixed(0)}%\n`)
}

// --- custo das expressões e dos formatadores ---
console.log('=== expressões e formatadores (20 000 chamadas)')
const ast = parseExpr('p.preco | brl'); const sc = { p: { preco: 123.456 } }
const e1 = mede('parseExpr("p.preco | brl")', () => { for (let i = 0; i < 2e4; i++) parseExpr('p.preco | brl') }, 6)
const e2 = mede('avalia(expr já analisada) com brl()', () => { for (let i = 0; i < 2e4; i++) avalia(ast, sc, FUNCOES_PADRAO) }, 6)
const ast2 = parseExpr('p.preco * 2 + 1 > 10 ? p.nome : "x"'); const sc2 = { p: { preco: 5, nome: 'a' } }
const e3 = mede('avalia(aritmética + condicional)', () => { for (let i = 0; i < 2e4; i++) avalia(ast2, sc2, FUNCOES_PADRAO) }, 6)
const e4 = mede('toLocaleString("pt-BR", {currency}) nativo', () => { for (let i = 0; i < 2e4; i++) (123.456).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2, maximumFractionDigits: 2 }) }, 6)
const fmt = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', minimumFractionDigits: 2, maximumFractionDigits: 2 })
const e5 = mede('Intl.NumberFormat reaproveitado', () => { for (let i = 0; i < 2e4; i++) fmt.format(123.456) }, 6)
tab([e1, e2, e3, e4, e5])
console.log(`  → por chamada: avalia+brl ${((e2.med * 1000) / 2e4).toFixed(2)} µs; só o toLocaleString ${((e4.med * 1000) / 2e4).toFixed(2)} µs; formatador reaproveitado ${((e5.med * 1000) / 2e4).toFixed(2)} µs`)
