// Operações PURAS sobre a árvore de instâncias de uma página (`spec.raiz`). Nenhuma muta a entrada (compartilha o que não mudou); nenhuma deixa a árvore inválida:
// recusam slot inexistente, `max`/`min` do slot, `aceita`, mover para dentro de si mesmo, id duplicado, raiz removida e árvores grandes/profundas demais.
export type Inst = { bloco: string; id?: string; props?: Record<string, unknown>; slots?: Record<string, Inst[]>; se?: string; repetir?: unknown; eventos?: unknown }
export type Passo = { slot: string; indice: number }
export type Caminho = readonly Passo[]
export type DefSlot = { aceita?: string[]; min?: number; max?: number }
/** o que a árvore precisa saber de um bloco: seus slots (vem do Registry; ausente = bloco desconhecido) */
export type DefBloco = (interfaceId: string) => { slots?: Record<string, DefSlot> } | undefined
export type Resultado = { ok: true; raiz: Inst; caminho: Caminho } | { ok: false; erro: string }

export const LIMITES = { profundidade: 32, nos: 2000 }
const PROIBIDOS = new Set(['__proto__', 'constructor', 'prototype'])
const falha = (erro: string): Resultado => ({ ok: false, erro })

export function noEm(raiz: Inst, c: Caminho): Inst | undefined {
  let cur: Inst | undefined = raiz
  for (const p of c) cur = cur?.slots && Object.hasOwn(cur.slots, p.slot) ? cur.slots[p.slot]![p.indice] : undefined
  return cur
}
export const contaNos = (i: Inst): number => 1 + Object.values(i.slots ?? {}).reduce((s, l) => s + l.reduce((t, x) => t + contaNos(x), 0), 0)
export const profundidade = (i: Inst): number => 1 + Math.max(0, ...Object.values(i.slots ?? {}).flatMap((l) => l.map(profundidade)))
export function* percorre(i: Inst, c: Caminho = []): Generator<{ inst: Inst; caminho: Caminho }> {
  yield { inst: i, caminho: c }
  for (const [slot, l] of Object.entries(i.slots ?? {})) for (let n = 0; n < l.length; n++) yield* percorre(l[n]!, [...c, { slot, indice: n }])
}
export const caminhoDeId = (raiz: Inst, id: string): Caminho | undefined => { for (const { inst, caminho } of percorre(raiz)) if (inst.id === id) return caminho; return undefined }
export const idsDuplicados = (raiz: Inst): string[] => { const v = new Set<string>(), d = new Set<string>(); for (const { inst } of percorre(raiz)) if (inst.id !== undefined) { if (v.has(inst.id)) d.add(inst.id); v.add(inst.id) } return [...d] }
export const igualCaminho = (a: Caminho, b: Caminho): boolean => a.length === b.length && a.every((p, i) => p.slot === b[i]!.slot && p.indice === b[i]!.indice)
export const ehAncestral = (anc: Caminho, c: Caminho): boolean => anc.length <= c.length && anc.every((p, i) => p.slot === c[i]!.slot && p.indice === c[i]!.indice)

/** reescreve o nó no caminho, devolvendo nova raiz (só os ancestrais são copiados) */
function troca(raiz: Inst, c: Caminho, f: (i: Inst) => Inst): Inst | undefined {
  if (!c.length) return f(raiz)
  const [p, ...resto] = c as [Passo, ...Passo[]]
  const lista = raiz.slots && Object.hasOwn(raiz.slots, p.slot) ? raiz.slots[p.slot] : undefined; const filho = lista?.[p.indice]
  if (!lista || !filho) return undefined
  const novo = troca(filho, resto, f); if (!novo) return undefined
  const nl = lista.slice(); nl[p.indice] = novo
  return { ...raiz, slots: { ...raiz.slots, [p.slot]: nl } }
}
/** troca a lista de um slot do nó no caminho; lista vazia remove o slot (a saída fica mínima) */
function trocaSlot(raiz: Inst, pai: Caminho, slot: string, f: (l: Inst[]) => Inst[]): Inst | undefined {
  return troca(raiz, pai, (n) => {
    const nl = f(n.slots && Object.hasOwn(n.slots, slot) ? n.slots[slot]! : []); const { [slot]: _x, ...resto } = n.slots ?? {}
    const slots = nl.length ? { ...resto, [slot]: nl } : resto
    const { slots: _s, ...semSlots } = n; return Object.keys(slots).length ? { ...semSlots, slots } : semSlots
  })
}
const slotDe = (defs: DefBloco, pai: Inst, slot: string): DefSlot | string => {
  const d = defs(pai.bloco); if (!d) return `bloco desconhecido: ${pai.bloco}`
  if (PROIBIDOS.has(slot) || !d.slots || !Object.hasOwn(d.slots, slot)) return `o bloco ${pai.bloco} não tem o slot "${slot}"${d.slots ? ` (slots: ${Object.keys(d.slots).join(', ') || 'nenhum'})` : ''}`
  return d.slots[slot]!
}
const limites = (raiz: Inst): string | undefined => (contaNos(raiz) > LIMITES.nos ? `a página passaria de ${LIMITES.nos} blocos` : profundidade(raiz) > LIMITES.profundidade ? `a página passaria de ${LIMITES.profundidade} níveis` : undefined)
const idsDe = (i: Inst): string[] => [...percorre(i)].flatMap((x) => (x.inst.id !== undefined ? [x.inst.id] : []))

export function insere(raiz: Inst, pai: Caminho, slot: string, indice: number, inst: Inst, defs: DefBloco): Resultado {
  const p = noEm(raiz, pai); if (!p) return falha('destino inexistente')
  const d = slotDe(defs, p, slot); if (typeof d === 'string') return falha(d)
  if (!defs(inst.bloco)) return falha(`bloco desconhecido: ${inst.bloco}`)
  if (d.aceita && !d.aceita.includes(inst.bloco)) return falha(`o slot "${slot}" só aceita: ${d.aceita.join(', ')}`)
  const atual = p.slots?.[slot] ?? []
  if (d.max !== undefined && atual.length >= d.max) return falha(`o slot "${slot}" aceita no máximo ${d.max}`)
  if (!Number.isInteger(indice) || indice < 0 || indice > atual.length) return falha(`posição inválida (0 a ${atual.length})`)
  const existentes = new Set(idsDe(raiz)); const dup = idsDe(inst).find((x, i, a) => existentes.has(x) || a.indexOf(x) !== i); if (dup !== undefined) return falha(`o id "${dup}" já existe na página`)
  const nova = trocaSlot(raiz, pai, slot, (l) => [...l.slice(0, indice), inst, ...l.slice(indice)]); if (!nova) return falha('destino inexistente')
  const lim = limites(nova); if (lim) return falha(lim)
  return { ok: true, raiz: nova, caminho: [...pai, { slot, indice }] }
}

export function remove(raiz: Inst, c: Caminho, defs: DefBloco): Resultado {
  if (!c.length) return falha('a raiz da página não pode ser removida')
  const pai = c.slice(0, -1), ult = c[c.length - 1]!, p = noEm(raiz, pai); if (!p || !noEm(raiz, c)) return falha('bloco inexistente')
  const d = slotDe(defs, p, ult.slot); if (typeof d !== 'string' && d.min !== undefined && (p.slots?.[ult.slot]?.length ?? 0) <= d.min) return falha(`o slot "${ult.slot}" precisa de pelo menos ${d.min}`)
  const nova = trocaSlot(raiz, pai, ult.slot, (l) => l.filter((_, i) => i !== ult.indice)); return nova ? { ok: true, raiz: nova, caminho: pai } : falha('bloco inexistente')
}

export function move(raiz: Inst, de: Caminho, paraPai: Caminho, slot: string, indice: number, defs: DefBloco): Resultado {
  if (!de.length) return falha('a raiz da página não se move')
  if (ehAncestral(de, paraPai)) return falha('não se move um bloco para dentro dele mesmo')
  const inst = noEm(raiz, de); if (!inst) return falha('bloco inexistente')
  const paiOrigem = de.slice(0, -1), origem = de[de.length - 1]!
  const mesmaLista = igualCaminho(paiOrigem, paraPai) && origem.slot === slot
  // tira, e recoloca: o destino é recalculado na árvore SEM o bloco (os caminhos dos irmãos seguintes mudam quando a origem é anterior no mesmo pai)
  const sem = trocaSlot(raiz, paiOrigem, origem.slot, (l) => l.filter((_, i) => i !== origem.indice)); if (!sem) return falha('bloco inexistente')
  const destino = ajusta(paraPai, paiOrigem, origem)
  const p = noEm(sem, destino); if (!p) return falha('destino inexistente')
  const dSlot = slotDe(defs, p, slot); if (typeof dSlot === 'string') return falha(dSlot)
  if (dSlot.aceita && !dSlot.aceita.includes(inst.bloco)) return falha(`o slot "${slot}" só aceita: ${dSlot.aceita.join(', ')}`)
  const atual = p.slots?.[slot] ?? []
  if (dSlot.max !== undefined && atual.length >= dSlot.max) return falha(`o slot "${slot}" aceita no máximo ${dSlot.max}`)
  const o = slotDe(defs, noEm(raiz, paiOrigem)!, origem.slot); if (!mesmaLista && typeof o !== 'string' && o.min !== undefined && (noEm(raiz, paiOrigem)!.slots?.[origem.slot]?.length ?? 0) <= o.min) return falha(`o slot "${origem.slot}" precisa de pelo menos ${o.min}`)
  const idx = mesmaLista && indice > origem.indice ? indice - 1 : indice // `indice` é a posição na lista ANTES de tirar o bloco
  if (!Number.isInteger(idx) || idx < 0 || idx > atual.length) return falha(`posição inválida (0 a ${atual.length})`)
  const nova = trocaSlot(sem, destino, slot, (l) => [...l.slice(0, idx), inst, ...l.slice(idx)]); if (!nova) return falha('destino inexistente')
  const lim = limites(nova); if (lim) return falha(lim)
  return { ok: true, raiz: nova, caminho: [...destino, { slot, indice: idx }] }
}
/** o caminho `c` (válido ANTES de tirar `origem`) reescrito para valer DEPOIS: irmãos seguintes de `origem` sobem uma posição */
function ajusta(c: Caminho, paiOrigem: Caminho, origem: Passo): Caminho {
  const n = paiOrigem.length
  if (c.length > n && igualCaminho(c.slice(0, n), paiOrigem) && c[n]!.slot === origem.slot && c[n]!.indice > origem.indice) return c.map((p, i) => (i === n ? { ...p, indice: p.indice - 1 } : p))
  return c
}

/** copia o bloco (e os filhos) logo depois dele, com ids novos únicos (`id-2`, `id-3`…) */
export function duplica(raiz: Inst, c: Caminho, defs: DefBloco): Resultado {
  const orig = noEm(raiz, c); if (!c.length || !orig) return falha(c.length ? 'bloco inexistente' : 'a raiz da página não se duplica')
  const usados = new Set(idsDe(raiz))
  const novoId = (id: string): string => { const base = id.replace(/-\d+$/, ''); let n = 2; while (usados.has(`${base}-${n}`)) n++; const x = `${base}-${n}`; usados.add(x); return x }
  const clona = (i: Inst): Inst => ({ ...i, ...(i.id !== undefined ? { id: novoId(i.id) } : {}), ...(i.slots ? { slots: Object.fromEntries(Object.entries(i.slots).map(([k, l]) => [k, l.map(clona)])) } : {}) })
  const ult = c[c.length - 1]!; return insere(raiz, c.slice(0, -1), ult.slot, ult.indice + 1, clona(structuredClone(orig)), defs)
}

export function atualiza(raiz: Inst, c: Caminho, f: (i: Inst) => Inst): Resultado {
  const nova = troca(raiz, c, f); return nova ? { ok: true, raiz: nova, caminho: c } : falha('bloco inexistente')
}
export const trocaProps = (raiz: Inst, c: Caminho, props: Record<string, unknown>): Resultado => atualiza(raiz, c, (i) => { const { props: _p, ...r } = i; return Object.keys(props).length ? { ...r, props } : r })
export function renomeiaId(raiz: Inst, c: Caminho, id: string | undefined): Resultado {
  if (id !== undefined && !/^[A-Za-z][A-Za-z0-9_-]{0,63}$/.test(id)) return falha('id inválido (letras, números, _ e -, começando por letra)')
  if (id !== undefined && [...percorre(raiz)].some((x) => x.inst.id === id && !igualCaminho(x.caminho, c))) return falha(`o id "${id}" já existe na página`)
  return atualiza(raiz, c, (i) => { const { id: _i, ...r } = i; return id === undefined ? r : { ...r, id } })
}
/** blocos que o slot aceita (para o menu "adicionar") */
export const permitidos = (todos: string[], d: DefSlot | undefined): string[] => (d?.aceita ? todos.filter((b) => d.aceita!.includes(b)) : todos)
