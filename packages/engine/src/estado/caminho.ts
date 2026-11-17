// ---------------------------------------------------------------------------
// ÁRVORE DE ESTADO IMUTÁVEL. Operações puras sobre valores JSON, por CAMINHO (lista de chaves de texto e índices inteiros):
//   - nunca mutam a entrada; só copiam o que está NO CAMINHO — o resto é a mesma referência (compartilhamento estrutural);
//   - se nada muda, devolvem a MESMA referência (é isso que torna a detecção de mudança O(mudado));
//   - totais: caminho inválido, tipo errado e índice fora do alcance são `undefined` (ausente), nunca exceção;
//   - o diff entre duas árvores pula todo subárvore com a mesma referência e gera PATCHES reversíveis (estilo JSON Patch,
//     com o valor antigo guardado): a base do histórico, do desfazer/refazer e das dependências por caminho.
// ---------------------------------------------------------------------------

export type Seg = string | number
export type Caminho = readonly Seg[]
export type V = unknown

export type Patch =
  | { op: 'add'; caminho: Caminho; valor: V }
  | { op: 'remove'; caminho: Caminho; antes: V }
  | { op: 'replace'; caminho: Caminho; valor: V; antes: V }

export const MAX_PROFUNDIDADE = 64
const PROIBIDAS = new Set(['__proto__', 'constructor', 'prototype'])
const ehLista = (v: unknown): v is unknown[] => Array.isArray(v)
const ehObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const tem = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k)
const indiceOk = (s: Seg): s is number => typeof s === 'number' && Number.isInteger(s) && s >= 0

/** Um caminho válido: até 64 segmentos; texto (fora das chaves proibidas) ou inteiro ≥ 0. */
export function caminhoValido(c: unknown): c is Caminho {
  return Array.isArray(c) && c.length <= MAX_PROFUNDIDADE && c.every((s) => (typeof s === 'string' ? !PROIBIDAS.has(s) : indiceOk(s)))
}

/** Valor no caminho; ausente se qualquer passo não existe. */
export function obter(x: V, c: Caminho): V {
  let cur = x
  for (const s of c) {
    if (typeof s === 'number') { if (!ehLista(cur) || !indiceOk(s)) return undefined; cur = cur[s] }
    else { if (!ehObj(cur) || !tem(cur, s) || PROIBIDAS.has(s)) return undefined; cur = cur[s] }
  }
  return cur
}

/** Troca o valor no caminho. Cria o que falta (texto → objeto, 0 → lista). Índice só até `length` (anexar). `undefined` como valor é ausente. */
export function com(x: V, c: Caminho, v: V): V {
  if (v === undefined || !caminhoValido(c)) return undefined
  const vai = (cur: V, i: number): V => {
    if (i === c.length) return v
    const s = c[i]!
    if (typeof s === 'number') {
      const base = cur === undefined || cur === null ? [] : cur
      if (!ehLista(base) || s > base.length) return undefined
      const filho = vai(base[s], i + 1)
      if (filho === undefined) return undefined
      if (s < base.length && Object.is(base[s], filho)) return base // sem mudança: mesma referência
      const copia = base.slice(); copia[s] = filho
      return copia
    }
    const base = cur === undefined || cur === null ? {} : cur
    if (!ehObj(base)) return undefined
    const filho = vai(tem(base, s) ? base[s] : undefined, i + 1)
    if (filho === undefined) return undefined
    if (tem(base, s) && Object.is(base[s], filho)) return base
    return { ...base, [s]: filho }
  }
  return vai(x, 0)
}

/** Remove a chave/posição. Já ausente: mesma referência. Raiz ou caminho vazio: ausente. */
export function sem(x: V, c: Caminho): V {
  if (c.length === 0 || !caminhoValido(c)) return undefined
  const vai = (cur: V, i: number): V => {
    const s = c[i]!
    const ultimo = i === c.length - 1
    if (typeof s === 'number') {
      if (!ehLista(cur) || s >= cur.length) return cur
      if (ultimo) { const copia = cur.slice(); copia.splice(s, 1); return copia }
      const filho = vai(cur[s], i + 1)
      if (filho === undefined) return undefined
      if (Object.is(filho, cur[s])) return cur
      const copia = cur.slice(); copia[s] = filho
      return copia
    }
    if (!ehObj(cur) || !tem(cur, s)) return cur
    if (ultimo) { const { [s]: _, ...resto } = cur; return resto }
    const filho = vai(cur[s], i + 1)
    if (filho === undefined) return undefined
    return Object.is(filho, cur[s]) ? cur : { ...cur, [s]: filho }
  }
  return vai(x, 0)
}

export function insere(l: V, i: V, v: V): V {
  if (!ehLista(l) || !indiceOk(i as Seg) || (i as number) > l.length || v === undefined) return undefined
  const copia = l.slice(); copia.splice(i as number, 0, v)
  return copia
}

/** Move o item da posição `de` para a posição `para` (ambas existentes). Mesma posição: mesma referência. */
export function move(l: V, de: V, para: V): V {
  if (!ehLista(l) || !indiceOk(de as Seg) || !indiceOk(para as Seg) || (de as number) >= l.length || (para as number) >= l.length) return undefined
  if (de === para) return l
  const copia = l.slice(); const [item] = copia.splice(de as number, 1); copia.splice(para as number, 0, item)
  return copia
}

/** Mescla rasa: as chaves de `b` valem sobre as de `a`. Nada muda: mesma referência. */
export function mescla(a: V, b: V): V {
  if (!ehObj(a) || !ehObj(b)) return undefined
  let mudou = false
  for (const k of Object.keys(b)) if (PROIBIDAS.has(k)) return undefined; else if (!tem(a, k) || !Object.is(a[k], b[k])) mudou = true
  return mudou ? { ...a, ...b } : a
}

// ---- diff e patches ---------------------------------------------------------

const igualRef = (a: V, b: V) => Object.is(a, b) || a === b

/** Patches que levam `a` a `b`. Subárvores com a MESMA referência são puladas (custo proporcional ao que mudou). */
export function difere(a: V, b: V, limite = 100_000): Patch[] | undefined {
  const out: Patch[] = []
  let estourou = false
  const anda = (x: V, y: V, c: Seg[], prof: number): void => {
    if (estourou || igualRef(x, y)) return
    if (out.length > limite || prof > MAX_PROFUNDIDADE) { estourou = true; return }
    if (ehLista(x) && ehLista(y)) {
      const n = Math.min(x.length, y.length)
      for (let i = 0; i < n; i++) anda(x[i], y[i], [...c, i], prof + 1)
      for (let i = x.length - 1; i >= y.length; i--) out.push({ op: 'remove', caminho: [...c, i], antes: x[i] }) // do fim: os índices continuam válidos
      for (let i = x.length; i < y.length; i++) out.push({ op: 'add', caminho: [...c, i], valor: y[i] })
      return
    }
    if (ehObj(x) && ehObj(y)) {
      for (const k of [...new Set([...Object.keys(x), ...Object.keys(y)])].sort()) {
        if (PROIBIDAS.has(k)) continue
        const ex = tem(x, k) && x[k] !== undefined, ey = tem(y, k) && y[k] !== undefined
        if (ex && ey) anda(x[k], y[k], [...c, k], prof + 1)
        else if (ex) out.push({ op: 'remove', caminho: [...c, k], antes: x[k] })
        else if (ey) out.push({ op: 'add', caminho: [...c, k], valor: y[k] })
      }
      return
    }
    out.push({ op: 'replace', caminho: c, valor: y, antes: x }) // tipos diferentes ou escalares diferentes (inclusive a raiz)
  }
  anda(a, b, [], 0)
  return estourou ? undefined : out
}

/** Aplica os patches em sequência (atômico: qualquer falha dá ausente). */
export function aplica(x: V, patches: readonly Patch[]): V {
  let cur = x
  for (const p of patches) {
    if (!p || !caminhoValido(p.caminho)) return undefined
    if (p.caminho.length === 0) { if (p.op === 'remove') return undefined; cur = p.valor; continue }
    if (p.op === 'remove') { cur = sem(cur, p.caminho); }
    else if (p.op === 'add') {
      const ult = p.caminho[p.caminho.length - 1]!
      if (typeof ult === 'number') { // inserir NA posição (empurra os seguintes)
        const pai = obter(cur, p.caminho.slice(0, -1))
        const nova = insere(pai, ult, p.valor)
        cur = nova === undefined ? undefined : com(cur, p.caminho.slice(0, -1), nova)
      } else cur = com(cur, p.caminho, p.valor)
    } else cur = com(cur, p.caminho, p.valor)
    if (cur === undefined) return undefined
  }
  return cur
}

/** O patch que desfaz: ordem inversa, add ↔ remove, replace troca valor e antes. */
export function inverso(patches: readonly Patch[]): Patch[] {
  return [...patches].reverse().map((p): Patch =>
    p.op === 'add' ? { op: 'remove', caminho: p.caminho, antes: p.valor }
      : p.op === 'remove' ? { op: 'add', caminho: p.caminho, valor: p.antes }
        : { op: 'replace', caminho: p.caminho, valor: p.antes, antes: p.valor })
}

// ---- caminhos mudados (para o runtime) ----------------------------------------

/**
 * Caminhos FOLHA que mudaram de `a` para `b` (sem valores): onde a árvore difere, na menor granularidade que cabe no orçamento.
 * Pula subárvores com a mesma referência. Acima de `max` folhas sob um mesmo nó, ou abaixo de `prof`, devolve o nó (mais grosso, nunca perde).
 */
export function caminhosMudados(a: V, b: V, max = 64, prof = 8): Seg[][] {
  const out: Seg[][] = []
  const anda = (x: V, y: V, c: Seg[], nivel: number): void => {
    if (igualRef(x, y)) return
    const ehC = (ehLista(x) && ehLista(y)) || (ehObj(x) && ehObj(y))
    if (!ehC || nivel >= prof) { out.push(c); return }
    const antes = out.length
    if (ehLista(x) && ehLista(y)) {
      const n = Math.max(x.length, y.length)
      for (let i = 0; i < n; i++) { if (i >= x.length || i >= y.length) out.push([...c, i]); else anda(x[i], y[i], [...c, i], nivel + 1) }
    } else {
      const ox = x as Record<string, unknown>, oy = y as Record<string, unknown>
      for (const k of new Set([...Object.keys(ox), ...Object.keys(oy)])) {
        if (!tem(ox, k) || !tem(oy, k)) out.push([...c, k]); else anda(ox[k], oy[k], [...c, k], nivel + 1)
      }
    }
    if (out.length - antes > max) { out.length = antes; out.push(c) } // muita coisa mudou aqui: o nó inteiro
  }
  anda(a, b, [], 0)
  return out
}
