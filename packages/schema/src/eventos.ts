import type { Campo } from './emissao'
import type { No } from './index'

// Versionamento de eventos. O consumidor atrasado lê o que o produtor atual emite, então a regra é de COMPATIBILIDADE PARA TRÁS DO PAYLOAD:
// o payload novo tem de continuar satisfazendo o contrato antigo. Quebrou → precisa subir o MAJOR (o envelope leva o major; o consumidor declara os que entende).
//   quebra:   remover campo obrigatório, obrigatório → opcional, mudar tipo ou lista, trocar a chave de idempotência
//   minor:    campo novo, opcional → obrigatório, remover campo opcional (o antigo já tratava a ausência)
//   patch:    nada no contrato
type Ev = { nome: string; payload: Record<string, Campo>; idempotencia?: string }
export type BumpEvento = 'major' | 'minor' | 'patch'
export type ResultadoEvento = { ok: boolean; bump: BumpEvento; quebras: string[]; erros: string[] }

export const majorDoEvento = (no: Pick<No, 'versao'>): number => Number(String(no.versao).split('.')[0])

export function comparaEventos(anterior: No, atual: No): ResultadoEvento {
  const a = anterior.spec as Ev, b = atual.spec as Ev
  const quebras: string[] = []
  const aditivo: string[] = []
  if (a.nome !== b.nome) quebras.push(`o evento mudou de nome (${a.nome} → ${b.nome}): é outro evento`)
  for (const [campo, v] of Object.entries(a.payload)) {
    const n = b.payload[campo]
    if (!n) { if (v.obrigatorio) quebras.push(`'${campo}' era obrigatório e foi removido`); else aditivo.push(`'${campo}' (opcional) removido`); continue }
    if (n.tipo !== v.tipo) quebras.push(`'${campo}': tipo ${v.tipo} → ${n.tipo}`)
    if (!!n.lista !== !!v.lista) quebras.push(`'${campo}': ${v.lista ? 'deixou de ser lista' : 'virou lista'}`)
    if (v.obrigatorio && !n.obrigatorio) quebras.push(`'${campo}' passou de obrigatório para opcional (o consumidor antigo espera o campo)`)
    if (!v.obrigatorio && n.obrigatorio) aditivo.push(`'${campo}' passou a obrigatório`)
  }
  for (const campo of Object.keys(b.payload)) if (!(campo in a.payload)) aditivo.push(`'${campo}' novo`)
  if ((a.idempotencia ?? null) !== (b.idempotencia ?? null)) quebras.push(`a chave de idempotência mudou (${a.idempotencia ?? '—'} → ${b.idempotencia ?? '—'}): a deduplicação passaria a tratar eventos diferentes`)
  const bump: BumpEvento = quebras.length ? 'major' : aditivo.length || JSON.stringify(a) !== JSON.stringify(b) ? 'minor' : 'patch'
  const erros: string[] = []
  const [ma, mb] = [majorDoEvento(anterior), majorDoEvento(atual)]
  if (quebras.length && mb <= ma) erros.push(`mudança incompatível exige MAJOR novo (${anterior.versao} → ${atual.versao}): ${quebras.join('; ')}`)
  if (mb < ma) erros.push(`a versão retrocedeu (${anterior.versao} → ${atual.versao})`)
  return { ok: erros.length === 0, bump, quebras, erros }
}
