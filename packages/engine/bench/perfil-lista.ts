// Benchmark do runtime vivo (jsdom): custo de atualizar o DOM a partir do store. Rode: pnpm bench:vivo
import { JSDOM } from 'jsdom'
const dom = new JSDOM('<!doctype html><body></body>')
Object.assign(globalThis, { window: dom.window, document: dom.window.document, Node: dom.window.Node, Event: dom.window.Event })
const { Registry } = await import('@polaris/schema')
const { compilaPrograma, registraBase, montaVivo } = await import('../src/index')

const no = (kind: string, id: string, spec: object) => ({ kind, id, versao: '1.0.0', estatuto: 'publicado', spec }) as any
const P = (b: string, extra: object = {}) => ({ bloco: b, ...extra })
const r = new Registry(); registraBase(r)
r.registra(no('bloco', 'x.cartao', { interface: 'x/cartao', props: { type: 'object', properties: { titulo: { type: 'string' }, preco: { type: 'number' } } },
  modelo: P('layout/pilha', { props: { gap: 4 }, slots: { filhos: [P('texto/titulo', { props: { texto: '{props.titulo}', nivel: 3 } }), P('texto/paragrafo', { props: { texto: '{props.preco | brl}' } })] } }) }))
const res = compilaPrograma(r, r.registra(no('pagina', 'p', { rota: '/', estado: { itens: { tipo: 'json', inicial: [] }, n: { tipo: 'inteiro', inicial: 0 } },
  raiz: P('layout/pilha', { slots: { filhos: [P('texto/paragrafo', { props: { texto: 'n={estado.n}' } }), P('x/cartao', { repetir: { cada: 'estado.itens', como: 'p', chave: 'p.id' }, props: { titulo: '{p.nome}', preco: '{p.preco}' } })] } }) })))
if (!res.ok) throw new Error(JSON.stringify(res.erros))
const itens = (n: number) => Array.from({ length: n }, (_, i) => ({ id: i, nome: `Produto ${i}`, preco: 10 + i * 1.5 }))
const mede = (f: () => void, it = 20) => { for (let i = 0; i < 3; i++) f(); const t: number[] = []; for (let i = 0; i < it; i++) { const a = performance.now(); f(); t.push(performance.now() - a) } t.sort((x, y) => x - y); return t[Math.floor(t.length / 2)]! }

// Perfil do caminho "filtro": alterna 900 ↔ 450 itens (metade some, metade volta). Rode: pnpm perfil:lista
const N = 900
const todos = itens(N), metade = todos.filter((_, i) => i % 2 === 0)
const c = document.createElement('div'); document.body.appendChild(c)
const v = montaVivo({ programa: res.programa, container: c, estado: { itens: todos } })
for (let i = 0; i < 10; i++) { v.despacha({ t: 'estado', nome: 'itens', valor: metade }); v.despacha({ t: 'estado', nome: 'itens', valor: todos }) }
const t = performance.now()
for (let i = 0; i < 150; i++) { v.despacha({ t: 'estado', nome: 'itens', valor: metade }); v.despacha({ t: 'estado', nome: 'itens', valor: todos }) }
console.log(`filtro 900↔450 (jsdom): ${((performance.now() - t) / 300).toFixed(2)} ms por ação`)
