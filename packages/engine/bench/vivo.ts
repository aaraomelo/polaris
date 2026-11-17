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

for (const N of [200, 1000]) {
  const c = document.createElement('div'); document.body.appendChild(c)
  const v = montaVivo({ programa: res.programa, container: c, estado: { itens: [] } })
  const base = itens(N)
  const montagem = mede(() => { v.despacha({ t: 'estado', nome: 'itens', valor: [] }); v.despacha({ t: 'estado', nome: 'itens', valor: base }) }, 8)
  let k = 0
  const contador = mede(() => v.despacha({ t: 'estado', nome: 'n', valor: ++k }))
  const um = mede(() => { const x = base.slice(); x[N >> 1] = { ...x[N >> 1]!, nome: `m${++k}` }; v.despacha({ t: 'estado', nome: 'itens', valor: x }) })
  const insere = mede(() => { const x = base.slice(); x.splice(N >> 1, 0, { id: 1e6 + ++k, nome: 'novo', preco: 1 }); v.despacha({ t: 'estado', nome: 'itens', valor: x }); v.despacha({ t: 'estado', nome: 'itens', valor: base }) })
  const inverte = mede(() => { v.despacha({ t: 'estado', nome: 'itens', valor: base.slice().reverse() }); v.despacha({ t: 'estado', nome: 'itens', valor: base }) }, 8)
  console.log(`=== ${N} cartões (jsdom; em navegador real o DOM é bem mais rápido)`)
  console.log(`  montar a lista inteira (vazia → ${N})            ${montagem.toFixed(2).padStart(8)} ms`)
  console.log(`  mudar um contador fora da lista                    ${contador.toFixed(3).padStart(8)} ms`)
  console.log(`  alterar 1 item no meio                             ${um.toFixed(3).padStart(8)} ms`)
  console.log(`  inserir 1 no meio + voltar (2 ações)               ${insere.toFixed(3).padStart(8)} ms`)
  console.log(`  inverter a lista + voltar (2 ações)                ${inverte.toFixed(2).padStart(8)} ms`)
  v.destroi(); c.remove()
}
