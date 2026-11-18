import { preparaEntradas, type Entradas, type Saidas } from './contrato'
import { executaInterpretado } from './js'
import type { Kernel } from './ir'
import type { PipelineGl } from './glsl'
import { compilaWasm } from './wasm'
import { contextoGl, executaGl } from './webgl'

// Carregador do navegador para `computacao/canvas-gl`. Nunca usa `eval`/`new Function` (CSP): a ordem é WebGL2 → WebAssembly → interpretador (JS puro).
// Páginas com CSP sem 'wasm-unsafe-eval' caem direto no interpretador (correto, só mais lento).
export type Artefato = { id: string; kernel: Kernel; pipeline: PipelineGl }
export type Via = 'webgl2' | 'wasm' | 'interpretador'

/** executa o kernel numa grade w×h (n = w·h) e devolve RGBA 8 bits; saídas `r`, `g`, `b` e opcional `a` em 0..1 */
export async function renderiza(a: Artefato, w: number, h: number, entradas: Entradas, o: { via?: readonly Via[]; canvas?: () => { getContext(id: string, o?: object): unknown } } = {}): Promise<{ rgba: Uint8ClampedArray; via: Via }> {
  const k = a.kernel
  for (const c of ['r', 'g', 'b']) if (!k.saidas.some((s) => s.nome === c && s.tipo === 'f32')) throw new Error(`o kernel ${a.id} precisa das saídas decimais r, g e b para pintar`)
  if (k.entradas.some((p) => p.vetor)) throw new Error('kernel de canvas não aceita entradas lista')
  if (!k.larguraDe) throw new Error('kernel de canvas precisa de dominio.larguraDe (x e y)')
  const n = w * h, ent: Entradas = { ...entradas, [k.larguraDe]: w }
  const ordem = o.via ?? ['webgl2', 'wasm', 'interpretador']
  let saidas: Saidas | undefined, via: Via | undefined
  for (const v of ordem) {
    try {
      if (v === 'webgl2') {
        const gl = contextoGl((o.canvas ?? (() => document.createElement('canvas')))()); if (!gl) continue
        const p = preparaEntradas(k, ent, n)
        saidas = executaGl(gl, a.pipeline, { escalares: p.escalares, vetores: p.vetores }, n)
      } else if (v === 'wasm') saidas = (await compilaWasm(k))(ent, n)
      else saidas = executaInterpretado(k, ent, n)
      via = v; break
    } catch (e) { if (v === 'interpretador' || (e as Error).name === 'KernelErro') throw e }
  }
  if (!saidas || !via) throw new Error('nenhuma via de execução disponível')
  const rgba = new Uint8ClampedArray(n * 4), q = (x: number) => Math.round(Math.min(1, Math.max(0, Number.isNaN(x) ? 0 : x)) * 255)
  const A = saidas.a
  for (let i = 0; i < n; i++) { rgba[i * 4] = q(saidas.r![i]!); rgba[i * 4 + 1] = q(saidas.g![i]!); rgba[i * 4 + 2] = q(saidas.b![i]!); rgba[i * 4 + 3] = A ? q(A[i]!) : 255 }
  return { rgba, via }
}

type CanvasEl = { width: number; height: number; getAttribute(n: string): string | null; setAttribute(n: string, v: string): void; getContext(id: string): { putImageData(d: unknown, x: number, y: number): void } | null }
/** Pinta todos os `canvas[data-polaris-kernel]` da raiz. O artefato vem de `${base}${id}.json` (mesma origem). Erros não derrubam a página: o canvas fica com o texto alternativo e ganha `data-polaris-erro`. */
export async function montaCanvases(raiz: { querySelectorAll(s: string): ArrayLike<unknown> }, o: { base?: string; via?: readonly Via[]; busca?: (url: string) => Promise<{ ok: boolean; json(): Promise<unknown> }> } = {}): Promise<Array<{ id: string; via?: Via; erro?: string }>> {
  const busca = o.busca ?? ((u: string) => fetch(u, { credentials: 'same-origin' }))
  const cache = new Map<string, Promise<Artefato>>(), out: Array<{ id: string; via?: Via; erro?: string }> = []
  for (const el of Array.from(raiz.querySelectorAll('canvas[data-polaris-kernel]')) as CanvasEl[]) {
    const id = el.getAttribute('data-polaris-kernel') ?? ''
    try {
      if (!/^[a-z][A-Za-z0-9._-]{0,63}$/.test(id)) throw new Error('id de kernel inválido')
      let p = cache.get(id); if (!p) { p = busca(`${o.base ?? '/kernels/'}${id}.json`).then((r) => { if (!r.ok) throw new Error(`artefato ${id} indisponível`); return r.json() as Promise<Artefato> }); cache.set(id, p) }
      const entradas = JSON.parse(el.getAttribute('data-polaris-entradas') || '{}') as Entradas
      const { rgba, via } = await renderiza(await p, el.width, el.height, entradas, o.via ? { via: o.via } : {})
      const ctx = el.getContext('2d'); if (!ctx) throw new Error('sem contexto 2d')
      ctx.putImageData(new ImageData(rgba, el.width, el.height), 0, 0); el.setAttribute('data-polaris-via', via); out.push({ id, via })
    } catch (e) { const erro = (e as Error).message; el.setAttribute('data-polaris-erro', erro.slice(0, 200)); out.push({ id, erro }) }
  }
  return out
}

/** artefato servido em /kernels/<id>.json: o kernel (IR em JSON) e o pipeline GLSL */
export const artefatoCliente = (id: string, kernel: Kernel, pipeline: PipelineGl): Artefato => ({ id, kernel, pipeline })
