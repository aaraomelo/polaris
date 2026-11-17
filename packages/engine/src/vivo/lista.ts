// Reconciliação de listas com chave, sem React e sem VDOM.
// Algoritmo clássico (o mesmo princípio de Vue 3, ivi e Inferno):
//   1. apara prefixo e sufixo comuns (caso mais frequente: nada mudou ou só o fim mudou);
//   2. no miolo, mapeia cada chave nova para a posição antiga;
//   3. a maior subsequência crescente (LIS, O(n log n) por busca binária) é o conjunto que NÃO precisa mover;
//   4. só o que está fora da LIS é movido; chaves novas são criadas; chaves que sumiram são removidas.
// Mover é o mínimo possível: |comuns| − |LIS| movimentos.

export type Passo =
  | { op: 'cria'; chave: string; antes: string | null }
  | { op: 'move'; chave: string; antes: string | null }

export type PlanoLista = {
  /** chaves a remover do DOM */
  remover: string[]
  /** passos em ORDEM DE EXECUÇÃO (do fim para o começo); `antes` é a chave do irmão seguinte já posicionado, ou null = fim */
  passos: Passo[]
  /** tamanho da LIS (nós que ficaram no lugar, sem tocar no DOM, no miolo) */
  ficam: number
}

export class ChaveDuplicada extends Error {
  constructor(readonly chave: string) { super(`chave duplicada em lista: '${chave}'`); this.name = 'ChaveDuplicada' }
}

/** Índices (em `seq`) da maior subsequência estritamente crescente, ignorando entradas -1. O(n log n). */
export function lis(seq: readonly number[]): number[] {
  const caudas: number[] = [] // caudas[k] = índice em seq do menor final de uma subsequência de tamanho k+1
  const pai: number[] = new Array(seq.length).fill(-1)
  for (let i = 0; i < seq.length; i++) {
    const v = seq[i]!
    if (v < 0) continue
    let lo = 0, hi = caudas.length
    while (lo < hi) { const m = (lo + hi) >> 1; if (seq[caudas[m]!]! < v) lo = m + 1; else hi = m }
    if (lo > 0) pai[i] = caudas[lo - 1]!
    caudas[lo] = i
  }
  const r: number[] = new Array(caudas.length)
  let k = caudas.length ? caudas[caudas.length - 1]! : -1
  for (let j = caudas.length - 1; j >= 0; j--) { r[j] = k; k = pai[k]! }
  return r
}

function unicas(chaves: readonly string[]): Set<string> {
  const s = new Set<string>()
  for (const c of chaves) { if (s.has(c)) throw new ChaveDuplicada(c); s.add(c) }
  return s
}

export function planoLista(antigas: readonly string[], novas: readonly string[]): PlanoLista {
  unicas(antigas)
  const setNovas = unicas(novas)
  let ini = 0
  const minLen = Math.min(antigas.length, novas.length)
  while (ini < minLen && antigas[ini] === novas[ini]) ini++
  let fimA = antigas.length - 1, fimN = novas.length - 1
  while (fimA >= ini && fimN >= ini && antigas[fimA] === novas[fimN]) { fimA--; fimN-- }

  const remover = antigas.slice(ini, fimA + 1).filter((c) => !setNovas.has(c))
  // posição antiga (relativa ao miolo) de cada chave nova do miolo; -1 = nova
  const pos = new Map<string, number>()
  for (let i = ini; i <= fimA; i++) pos.set(antigas[i]!, i - ini)
  const origem: number[] = []
  for (let i = ini; i <= fimN; i++) origem.push(pos.has(novas[i]!) ? pos.get(novas[i]!)! : -1)
  const naLis = new Set(lis(origem))

  const passos: Passo[] = []
  for (let i = fimN; i >= ini; i--) {
    const chave = novas[i]!
    const antes = i + 1 < novas.length ? novas[i + 1]! : null
    if (origem[i - ini]! < 0) passos.push({ op: 'cria', chave, antes })
    else if (!naLis.has(i - ini)) passos.push({ op: 'move', chave, antes })
  }
  return { remover, passos, ficam: naLis.size }
}

/** Interface mínima do DOM usada pelo aplicador (facilita testar e evita depender de lib.dom no núcleo). */
export type NoDom = { parentNode: unknown }
export type PaiDom<N extends NoDom> = { insertBefore(no: N, ref: N | null): unknown; removeChild(no: N): unknown }

/** Aplica o plano ao DOM. `nos` mapeia chave → nó e é atualizado. `cria` devolve o nó novo para a chave. */
export function aplicaLista<N extends NoDom>(pai: PaiDom<N>, nos: Map<string, N>, plano: PlanoLista, cria: (chave: string) => N): void {
  for (const c of plano.remover) { const n = nos.get(c); if (n) { pai.removeChild(n); nos.delete(c) } }
  for (const p of plano.passos) {
    const ref = p.antes === null ? null : (nos.get(p.antes) ?? null)
    if (p.op === 'cria') { const n = cria(p.chave); nos.set(p.chave, n); pai.insertBefore(n, ref) }
    else pai.insertBefore(nos.get(p.chave)!, ref)
  }
}
