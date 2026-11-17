// Sugestão "quis dizer…" por distância de edição. Módulo SEM dependências: o navegador importa só isto (e não o Ajv).

function distancia(a: string, b: string): number {
  const d = Array.from({ length: a.length + 1 }, (_, i) => [i, ...Array(b.length).fill(0)] as number[])
  for (let j = 1; j <= b.length; j++) d[0]![j] = j
  for (let i = 1; i <= a.length; i++) {
    for (let j = 1; j <= b.length; j++) {
      d[i]![j] = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1))
    }
  }
  return d[a.length]![b.length]!
}

/** A opção mais parecida, se estiver perto o bastante para ser um erro de digitação. */
export function sugere(valor: string, opcoes: readonly string[]): string | null {
  let melhor: string | null = null
  let menor = Infinity
  for (const o of opcoes) {
    const d = distancia(valor.toLowerCase(), o.toLowerCase())
    if (d < menor) (menor = d), (melhor = o)
  }
  return melhor !== null && menor <= Math.max(1, Math.floor(valor.length / 3)) ? melhor : null
}

