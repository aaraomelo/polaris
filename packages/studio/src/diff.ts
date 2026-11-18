import type { Inst } from './arvore'

// DIFF SEMÂNTICO de nós. Não é diff de texto: a árvore da página é comparada por IDENTIDADE dos blocos (id), então "o botão subiu para o cabeçalho" é um MOVIMENTO, não
// uma remoção + uma adição; mudar uma prop é uma alteração daquela prop, não do JSON inteiro. Blocos sem id casam por posição e tipo dentro do mesmo pai.
export type Mudanca = { tipo: 'adicionado' | 'removido' | 'alterado'; caminho: string[]; antes?: unknown; depois?: unknown }
export type MudancaBloco = {
  tipo: 'adicionado' | 'removido' | 'movido' | 'reordenado' | 'alterado'
  /** como o usuário vê o bloco: `raiz › cabecalho › titulo` (id quando existe, senão o tipo) */
  rotulo: string; bloco: string; id?: string
  /** de onde/para onde (rótulos dos pais), nos movimentos */
  de?: string; para?: string
  /** blocos dentro de um bloco adicionado/removido */
  descendentes?: number
  /** o que mudou nas props, se, repetir, eventos e no tipo do bloco, quando `alterado` (ou também movido) */
  campos?: Mudanca[]
}
export type Diff = { igual: boolean; resumo: { adicionados: number; removidos: number; movidos: number; reordenados: number; alterados: number; campos: number }; blocos: MudancaBloco[]; campos: Mudanca[] }

const ehObj = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v)
const PROIBIDOS = new Set(['__proto__', 'constructor', 'prototype'])
export function diffJson(a: unknown, b: unknown, caminho: string[] = [], out: Mudanca[] = [], prof = 0): Mudanca[] {
  if (Object.is(a, b)) return out
  if (caminho.length && a === undefined) { out.push({ tipo: 'adicionado', caminho, depois: b }); return out }
  if (caminho.length && b === undefined) { out.push({ tipo: 'removido', caminho, antes: a }); return out }
  if (prof > 64) { if (JSON.stringify(a) !== JSON.stringify(b)) out.push({ tipo: 'alterado', caminho, antes: a, depois: b }); return out }
  if (ehObj(a) && ehObj(b)) {
    for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
      if (PROIBIDOS.has(k)) continue
      const x = Object.hasOwn(a, k), y = Object.hasOwn(b, k)
      if (x && !y) out.push({ tipo: 'removido', caminho: [...caminho, k], antes: a[k] }); else if (!x && y) out.push({ tipo: 'adicionado', caminho: [...caminho, k], depois: b[k] }); else diffJson(a[k], b[k], [...caminho, k], out, prof + 1)
    }
    return out
  }
  if (Array.isArray(a) && Array.isArray(b)) { for (let i = 0; i < Math.max(a.length, b.length); i++) { if (i >= a.length) out.push({ tipo: 'adicionado', caminho: [...caminho, String(i)], depois: b[i] }); else if (i >= b.length) out.push({ tipo: 'removido', caminho: [...caminho, String(i)], antes: a[i] }); else diffJson(a[i], b[i], [...caminho, String(i)], out, prof + 1) } return out }
  out.push({ tipo: 'alterado', caminho, antes: a, depois: b }); return out
}

type Achatado = { inst: Inst; chave: string; pai: string | undefined; slot: string; indice: number; rotulo: string }
const nome = (i: Inst) => i.id ?? i.bloco
const conta = (i: Inst): number => Object.values(i.slots ?? {}).reduce((s, l) => s + l.reduce((t, x) => t + 1 + conta(x), 0), 0)

/** achata a árvore dando a cada bloco uma CHAVE: o id, ou (sem id) `pai/slot/#posição:bloco` — assim blocos sem id casam por posição dentro do mesmo pai */
function achata(raiz: Inst): Achatado[] {
  const out: Achatado[] = []
  const anda = (i: Inst, chavePai: string | undefined, slot: string, indice: number, rotuloPai: string) => {
    const chave = chavePai === undefined ? '#::raiz' : i.id !== undefined ? `#${i.id}` : `${chavePai ?? ''}/${slot}/${indice}:${i.bloco}`
    const rotulo = rotuloPai ? `${rotuloPai} › ${nome(i)}` : nome(i)
    out.push({ inst: i, chave, pai: chavePai, slot, indice, rotulo })
    for (const [s, l] of Object.entries(i.slots ?? {})) l.forEach((f, n) => anda(f, chave, s, n, rotulo))
  }
  anda(raiz, undefined, '', 0, ''); return out
}
const camposDe = (a: Inst, b: Inst): Mudanca[] => {
  const out: Mudanca[] = []
  if (a.bloco !== b.bloco) out.push({ tipo: 'alterado', caminho: ['bloco'], antes: a.bloco, depois: b.bloco })
  for (const k of ['props', 'se', 'repetir', 'eventos'] as const) diffJson(a[k], b[k], [k], out)
  if (a.id !== b.id) out.push({ tipo: 'alterado', caminho: ['id'], antes: a.id, depois: b.id })
  return out
}
/** maior subsequência comum de ids (para saber quais irmãos mudaram de ordem de verdade, e não só de índice) */
function lcs(a: string[], b: string[]): Set<string> {
  const t: number[][] = Array.from({ length: a.length + 1 }, () => new Array<number>(b.length + 1).fill(0))
  for (let i = a.length - 1; i >= 0; i--) for (let j = b.length - 1; j >= 0; j--) t[i]![j] = a[i] === b[j] ? t[i + 1]![j + 1]! + 1 : Math.max(t[i + 1]![j]!, t[i]![j + 1]!)
  const s = new Set<string>(); let i = 0, j = 0
  while (i < a.length && j < b.length) { if (a[i] === b[j]) { s.add(a[i]!); i++; j++ } else if (t[i + 1]![j]! >= t[i]![j + 1]!) i++; else j++ }
  return s
}

export function diffArvore(antes: Inst, depois: Inst): MudancaBloco[] {
  const A = achata(antes), B = achata(depois), ma = new Map(A.map((x) => [x.chave, x])), mb = new Map(B.map((x) => [x.chave, x]))
  const out: MudancaBloco[] = []
  const rotuloDe = (m: Map<string, Achatado>, chave: string | undefined) => (chave === undefined ? '' : m.get(chave)?.rotulo ?? '')
  // só o bloco MAIS EXTERNO de uma subárvore adicionada/removida é listado (os descendentes entram na contagem)
  for (const x of B) if (!ma.has(x.chave) && (x.pai === undefined || ma.has(x.pai))) out.push({ tipo: 'adicionado', rotulo: x.rotulo, bloco: x.inst.bloco, ...(x.inst.id !== undefined ? { id: x.inst.id } : {}), descendentes: conta(x.inst), para: rotuloDe(mb, x.pai) })
  for (const x of A) if (!mb.has(x.chave) && (x.pai === undefined || mb.has(x.pai))) out.push({ tipo: 'removido', rotulo: x.rotulo, bloco: x.inst.bloco, ...(x.inst.id !== undefined ? { id: x.inst.id } : {}), descendentes: conta(x.inst), de: rotuloDe(ma, x.pai) })
  // um id removido num lugar e adicionado em outro é MOVIMENTO: o `removido`/`adicionado` correspondente vira `movido`
  const movidosIds = new Set<string>()
  for (const x of B) if (x.inst.id !== undefined && ma.has(x.chave)) { const a = ma.get(x.chave)!; if (a.pai !== x.pai || a.slot !== x.slot) movidosIds.add(x.chave) }
  const final = out.filter((m) => !(m.id !== undefined && movidosIds.has(`#${m.id}`) && (m.tipo === 'adicionado' || m.tipo === 'removido')))
  for (const k of movidosIds) { const a = ma.get(k)!, b = mb.get(k)!; const campos = camposDe(a.inst, b.inst); final.push({ tipo: 'movido', rotulo: b.rotulo, bloco: b.inst.bloco, id: b.inst.id!, de: rotuloDe(ma, a.pai), para: rotuloDe(mb, b.pai), ...(campos.length ? { campos } : {}) }) }
  // ordem entre irmãos que continuam no mesmo pai/slot
  const porPai = (L: Achatado[]) => { const m = new Map<string, string[]>(); for (const x of L) if (x.pai !== undefined) { const k = `${x.pai}|${x.slot}`; m.set(k, [...(m.get(k) ?? []), x.chave]) } return m }
  const pa = porPai(A), pb = porPai(B)
  for (const [k, lb] of pb) {
    const la = (pa.get(k) ?? []).filter((c) => lb.includes(c) && !movidosIds.has(c)), lbc = lb.filter((c) => la.includes(c)); if (la.length < 2) continue
    const fixos = lcs(la, lbc)
    for (const c of lbc) if (!fixos.has(c) && !final.some((m) => m.tipo === 'movido' && m.id !== undefined && `#${m.id}` === c)) { const b = mb.get(c)!; final.push({ tipo: 'reordenado', rotulo: b.rotulo, bloco: b.inst.bloco, ...(b.inst.id !== undefined ? { id: b.inst.id } : {}) }) }
  }
  // alterações de conteúdo nos blocos que existem nos dois lados (e não são só movidos)
  for (const x of B) {
    const a = ma.get(x.chave); if (!a || movidosIds.has(x.chave)) continue
    const campos = camposDe(a.inst, x.inst); if (campos.length) final.push({ tipo: 'alterado', rotulo: x.rotulo, bloco: x.inst.bloco, ...(x.inst.id !== undefined ? { id: x.inst.id } : {}), campos })
  }
  return final
}

const ENVELOPE_IGNORADO = new Set(['versao'])
/** diff de dois nós (mesmo kind). Páginas: a árvore (`spec.raiz`) por identidade de bloco; o resto do nó, campo a campo. */
export function diffNo(antes: Record<string, unknown>, depois: Record<string, unknown>): Diff {
  const sa = (antes.spec ?? {}) as Record<string, unknown>, sb = (depois.spec ?? {}) as Record<string, unknown>
  const arvore = antes.kind === 'pagina' && ehObj(sa.raiz) && ehObj(sb.raiz)
  const strip = (n: Record<string, unknown>, s: Record<string, unknown>) => { const { spec: _s, ...env } = n; for (const k of ENVELOPE_IGNORADO) delete env[k]; const { raiz: _r, ...resto } = s; return { ...env, spec: arvore ? resto : s } }
  const campos = diffJson(strip(antes, sa), strip(depois, sb))
  const blocos = arvore ? diffArvore(sa.raiz as Inst, sb.raiz as Inst) : []
  const r = { adicionados: 0, removidos: 0, movidos: 0, reordenados: 0, alterados: 0, campos: campos.length + blocos.reduce((s, b) => s + (b.campos?.length ?? 0), 0) }
  for (const b of blocos) { if (b.tipo === 'adicionado') r.adicionados++; else if (b.tipo === 'removido') r.removidos++; else if (b.tipo === 'movido') r.movidos++; else if (b.tipo === 'reordenado') r.reordenados++; else r.alterados++ }
  return { igual: !campos.length && !blocos.length, resumo: r, blocos, campos }
}
