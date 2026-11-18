// Microbenchmark da avaliação de expressões: interpretador (avalia) × closures (avaliaC). Rode: pnpm tsx bench/expr.ts
import { FUNCOES_PADRAO, avalia, parseExpr } from '../src/expr/index'
import { avaliaC } from '../src/expr/compila'

const itens = Array.from({ length: 900 }, (_, i) => ({ id: i, nome: `Produto ${i} ${['pão', 'bolo', 'café', 'suco'][i % 4]}`, preco: 10 + (i % 50) * 1.5, qtd: 1 + (i % 5) }))
const esc = { estado: { itens, filtro: 'a', n: 3 } }
const casos: Array<[string, string]> = [
  ['filtra 900 itens com lambda', 'filtra(estado.itens, p => contem(minusculas(p.nome), minusculas(estado.filtro)))'],
  ['mapeia 900 itens', 'mapeia(estado.itens, p => p.preco * p.qtd)'],
  ['dobra 900 itens', 'dobra(estado.itens, 0, (s, p) => s + p.preco)'],
  ['expressão simples (1000×)', 'estado.n * 2 + 1 > 5 ? "sim" : "não"'],
  ['template com formatador (1000×)', 'brl(estado.n * 1.5)'],
]
const mede = (f: () => unknown, rep: number) => { for (let i = 0; i < 20; i++) f(); const t: number[] = []; for (let k = 0; k < 15; k++) { const a = performance.now(); for (let i = 0; i < rep; i++) f(); t.push((performance.now() - a) / rep) } t.sort((x, y) => x - y); return t[7]! }
for (const [nome, src] of casos) {
  const e = parseExpr(src)
  const rep = nome.includes('900') ? 20 : 1000
  const a = mede(() => avalia(e, esc, FUNCOES_PADRAO), rep), c = mede(() => avaliaC(e, esc, FUNCOES_PADRAO), rep)
  console.log(`${nome.padEnd(34)} interpretado ${(a * 1000).toFixed(1).padStart(9)} µs   closure ${(c * 1000).toFixed(1).padStart(9)} µs   ${(a / c).toFixed(2)}x`)
}
