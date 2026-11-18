import { Registry } from '@polaris/schema'
import { nosDoPack } from './index'

const PACKS = ['catalogo', 'vendas', 'pagamentos', 'estoque', 'servicos', 'alimentos', 'studio', 'segmentos'] as const

/** O registro com TODOS os nós dos packs de domínio e dos segmentos (o que a plataforma entrega "de fábrica", escopo core). */
export function registroDaPlataforma(): Registry {
  const reg = new Registry()
  for (const p of PACKS) for (const n of nosDoPack(p)) reg.registra(n)
  return reg
}
