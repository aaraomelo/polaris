import type { Saidas } from './contrato'
import type { Kernel } from './ir'

// Comparação de resultados entre alvos. A referência é SEMPRE o oráculo (interpretador). Kernel sem tolerância = igualdade bit a bit (Object.is: distingue -0 e compara NaN com NaN);
// com tolerância, só as saídas decimais podem diferir por |a−b| ≤ relativa·max(|a|,|b|,escala) + absoluta; inteiros e booleanos são sempre exatos.
export type Divergencia = { saida: string; indice: number; esperado: number; obtido: number }
export type Relatorio = { ok: boolean; comparados: number; divergencias: Divergencia[]; piorErroRelativo: number }

export function comparaSaidas(k: Kernel, ref: Saidas, obtido: Saidas, escala = 1, limite = 5): Relatorio {
  const div: Divergencia[] = []; let comparados = 0, pior = 0
  const { relativa, absoluta } = k.tolerancia, exato = relativa === 0 && absoluta === 0
  for (const s of k.saidas) {
    const a = ref[s.nome], b = obtido[s.nome]
    if (!a || !b || a.length !== b.length) { div.push({ saida: s.nome, indice: -1, esperado: a?.length ?? -1, obtido: b?.length ?? -1 }); continue }
    for (let i = 0; i < a.length; i++) {
      comparados++
      const x = a[i]!, y = b[i]!
      const igual = exato || s.tipo !== 'f32' ? Object.is(x, y) : Object.is(x, y) || Math.abs(x - y) <= relativa * Math.max(Math.abs(x), Math.abs(y), escala) + absoluta
      if (s.tipo === 'f32' && !Object.is(x, y) && Number.isFinite(x) && Number.isFinite(y)) pior = Math.max(pior, Math.abs(x - y) / Math.max(Math.abs(x), Math.abs(y), escala))
      if (!igual) div.push({ saida: s.nome, indice: i, esperado: x, obtido: y })
    }
  }
  return { ok: div.length === 0, comparados, divergencias: div.slice(0, limite), piorErroRelativo: pior }
}
