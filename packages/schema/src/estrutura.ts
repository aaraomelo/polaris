import type { Erro, No } from './index'
import { validaPapel } from './acesso'
import type { Contexto, Registry } from './registry'
import { validaProps } from './props'

// ---------------------------------------------------------------------------
// Validação estrutural de árvores: o que o JSON Schema não expressa.
//  1. composição de blocos (modelo) é um DAG: sem recursão infinita;
//  2. cada instância respeita os slots do bloco resolvido (existência, aceita, min, max);
//  3. ids de instância únicos dentro da árvore;
//  4. limites de profundidade, fan-out e total de nós;
//  5. props de cada instância conformes ao schema de props do bloco resolvido.
// Referências quebradas (bloco inexistente) são tarefa de Registry.verifica; aqui são puladas.
// ---------------------------------------------------------------------------

export type Limites = { maxProfundidade: number; maxFilhosPorSlot: number; maxNos: number }
export const LIMITES_PADRAO: Limites = { maxProfundidade: 32, maxFilhosPorSlot: 200, maxNos: 5000 }

type Inst = {
  bloco: string
  id?: string
  props?: unknown
  slots?: Record<string, Inst[]>
  se?: string
  repetir?: unknown
}

const erro = (caminho: string, regra: string, mensagem: string): Erro => ({ caminho, regra, mensagem })

/** Interfaces usadas (em qualquer profundidade) numa árvore de instâncias. */
function interfacesUsadas(raiz: Inst | undefined, acc = new Set<string>()): Set<string> {
  if (!raiz) return acc
  acc.add(raiz.bloco)
  for (const lista of Object.values(raiz.slots ?? {})) for (const f of lista) interfacesUsadas(f, acc)
  return acc
}

/** Procura ciclo no grafo bloco → blocos do seu modelo (com herança). Devolve o ciclo ou null. */
function achaCiclo(reg: Registry, inicio: string, ctx: Contexto, estado: Map<string, 'visitando' | 'ok'>, pilha: string[]): string[] | null {
  const st = estado.get(inicio)
  if (st === 'ok') return null
  if (st === 'visitando') return [...pilha.slice(pilha.indexOf(inicio)), inicio]
  estado.set(inicio, 'visitando')
  pilha.push(inicio)
  let resolvido
  try {
    resolvido = reg.resolveBloco(inicio, ctx)
  } catch {
    resolvido = null // inexistente ou ciclo de extends: tratados em verifica/resolveBloco
  }
  if (resolvido?.modelo) {
    for (const alvo of interfacesUsadas(resolvido.modelo as Inst)) {
      const c = achaCiclo(reg, alvo, ctx, estado, pilha)
      if (c) return c
    }
  }
  pilha.pop()
  estado.set(inicio, 'ok')
  return null
}

function conferePasta(reg: Registry, raiz: Inst, base: string, ctx: Contexto, lim: Limites, out: Erro[]): void {
  const ids = new Map<string, string>()
  let total = 0
  const cacheBloco = new Map<string, ReturnType<Registry['resolveBloco']> | null>()
  const bloco = (i: string) => {
    if (!cacheBloco.has(i)) {
      try {
        cacheBloco.set(i, reg.resolveBloco(i, ctx))
      } catch {
        cacheBloco.set(i, null)
      }
    }
    return cacheBloco.get(i)!
  }

  const visita = (inst: Inst, caminho: string, prof: number) => {
    total++
    if (total === lim.maxNos + 1) out.push(erro(caminho, 'limite', `mais de ${lim.maxNos} nós na árvore`))
    if (prof > lim.maxProfundidade) {
      out.push(erro(caminho, 'limite', `profundidade ${prof} excede o máximo de ${lim.maxProfundidade}`))
      return // não desce mais: evita ruído em árvore patológica
    }
    if (inst.id !== undefined) {
      const antes = ids.get(inst.id)
      if (antes) out.push(erro(`${caminho}/id`, 'id-unico', `id '${inst.id}' já usado em ${antes}`))
      else ids.set(inst.id, caminho)
    }

    const def = bloco(inst.bloco)
    const slots = inst.slots ?? {}

    if (def) {
      out.push(...validaProps(inst.props, def.props, caminho))
      for (const nome of Object.keys(slots)) {
        if (!(nome in def.slots)) {
          out.push(erro(`${caminho}/slots/${nome}`, 'slot', `bloco '${inst.bloco}' não tem o slot '${nome}' (tem: ${Object.keys(def.slots).join(', ') || 'nenhum'})`))
        }
      }
      for (const [nome, regra] of Object.entries(def.slots)) {
        const filhos = slots[nome] ?? []
        const fixos = filhos.filter((f) => f.se === undefined && f.repetir === undefined).length
        if (regra.min !== undefined && fixos < regra.min && !filhos.some((f) => f.repetir !== undefined)) {
          out.push(erro(`${caminho}/slots/${nome}`, 'slot-min', `slot '${nome}' de '${inst.bloco}' exige no mínimo ${regra.min} (tem ${fixos})`))
        }
        if (regra.max !== undefined && filhos.length > regra.max && !filhos.some((f) => f.repetir !== undefined)) {
          out.push(erro(`${caminho}/slots/${nome}`, 'slot-max', `slot '${nome}' de '${inst.bloco}' aceita no máximo ${regra.max} (tem ${filhos.length})`))
        }
        const aceita = regra.aceita
        if (aceita) {
          filhos.forEach((f, n) => {
            const fd = bloco(f.bloco)
            if (!fd) return
            if (!fd.cadeia.some((c) => aceita.includes(c))) {
              out.push(erro(`${caminho}/slots/${nome}/${n}/bloco`, 'slot-aceita', `slot '${nome}' de '${inst.bloco}' aceita [${aceita.join(', ')}]; recebeu '${f.bloco}'`))
            }
          })
        }
      }
    }

    for (const [nome, lista] of Object.entries(slots)) {
      if (lista.length > lim.maxFilhosPorSlot) {
        out.push(erro(`${caminho}/slots/${nome}`, 'limite', `slot '${nome}' com ${lista.length} filhos excede o máximo de ${lim.maxFilhosPorSlot}`))
      }
      lista.forEach((f, n) => visita(f, `${caminho}/slots/${nome}/${n}`, prof + 1))
    }
  }
  visita(raiz, base, 1)
}

/** Validação estrutural de um nó (pagina → /spec/raiz; bloco → /spec/modelo). Outros kinds: sem árvore. */
export function validaEstrutura(reg: Registry, no: No, ctx: Contexto = {}, limites: Partial<Limites> = {}): Erro[] {
  if (no.kind === 'papel') return validaPapel(reg, no, ctx) // papel: sujeitos, ações e campos contra os serviços registrados
  const lim = { ...LIMITES_PADRAO, ...limites }
  const out: Erro[] = []
  const spec = no.spec as Record<string, any>
  const arvore: { raiz?: Inst; base: string } | null =
    no.kind === 'pagina' ? { raiz: spec.raiz, base: '/spec/raiz' } : no.kind === 'bloco' ? { raiz: spec.modelo, base: '/spec/modelo' } : null
  // exemplos do catálogo (bloco): cada instância de exemplo precisa respeitar os slots, como qualquer outra
  if (no.kind === 'bloco' && Array.isArray(spec.exemplos)) {
    ;(spec.exemplos as Array<{ instancia?: Inst }>).forEach((e, i) => { if (e?.instancia) conferePasta(reg, e.instancia, `/spec/exemplos/${i}/instancia`, ctx, lim, out) })
  }
  if (!arvore?.raiz) return out

  // 1. DAG: nenhum bloco usado pode (direta ou indiretamente) conter a si mesmo.
  const estado = new Map<string, 'visitando' | 'ok'>()
  const usados = [...interfacesUsadas(arvore.raiz)]
  if (no.kind === 'bloco') usados.unshift(spec.interface as string)
  const reportados = new Set<string>()
  for (const i of usados) {
    if (estado.has(i)) continue // já percorrido (ou parte de um ciclo já reportado)
    const ciclo = achaCiclo(reg, i, ctx, estado, [])
    if (ciclo) {
      const chave = [...ciclo].sort().join('|')
      if (!reportados.has(chave)) {
        reportados.add(chave)
        out.push(erro(arvore.base, 'ciclo', `composição circular de blocos: ${ciclo.join(' → ')}`))
      }
    }
  }

  // 2–4. slots, ids únicos e limites (não desce em árvore cíclica: só há instâncias, sem expansão).
  conferePasta(reg, arvore.raiz, arvore.base, ctx, lim, out)
  return out
}

/** Referências quebradas + estrutura, em uma chamada. */
export function confere(reg: Registry, no: No, ctx: Contexto = {}, limites: Partial<Limites> = {}): Erro[] {
  return [...reg.verifica(no, ctx), ...validaEstrutura(reg, no, ctx, limites)]
}
