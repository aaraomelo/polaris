// Cliente da API de autoria (`/studio/*`). Mesma origem, sem credencial no JS: a sessão é do cookie/gateway. Todo erro vira `ErroApi` com o corpo `{ erro }` do servidor.
export class ErroApi extends Error {
  constructor(readonly status: number, readonly codigo: string, mensagem: string, readonly extra: Record<string, unknown> = {}) { super(mensagem); this.name = 'ErroApi' }
}
async function chama<T>(metodo: string, url: string, corpo?: unknown): Promise<T> {
  const r = await fetch(url, { method: metodo, headers: corpo === undefined ? {} : { 'content-type': 'application/json' }, ...(corpo === undefined ? {} : { body: JSON.stringify(corpo) }), credentials: 'same-origin' })
  const t = await r.text(); let j: any = null; try { j = t ? JSON.parse(t) : null } catch { /* corpo não-JSON */ }
  if (!r.ok) { const e = j?.erro ?? {}; throw new ErroApi(r.status, e.codigo ?? 'erro', e.mensagem ?? `erro ${r.status}`, e) }
  return j as T
}
const k = (kind: string, id: string) => `${encodeURIComponent(kind)}/${id.split('/').map(encodeURIComponent).join('/')}`
export type Meta = { kind: string; id: string; seq: number; hash: string; autor: string; nota: string | null; criadoEm: string; removido: boolean }
export type DefBlocoApi = { id: string; titulo: string; descricao?: string; props?: Record<string, any>; slots: Record<string, { aceita?: string[]; min?: number; max?: number }>; composto: boolean; codigo?: boolean }
export type Comentario = import('@polaris/studio').Comentario
export const api = {
  blocos: () => chama<{ blocos: DefBlocoApi[] }>('GET', '/studio/blocos').then((r) => r.blocos),
  lista: () => chama<{ nos: Meta[]; base: Record<string, string[]> }>('GET', '/studio/nos'),
  abre: (kind: string, id: string) => chama<{ origem: 'tenant' | 'base'; seq: number | null; no: any }>('GET', `/studio/nos/${k(kind, id)}`),
  salva: (no: any, baseSeq: number | null, nota?: string) => chama<{ versao: Meta; novo: boolean }>('PUT', `/studio/nos/${k(no.kind, no.id)}`, { no, baseSeq, ...(nota ? { nota } : {}) }),
  restaura: (kind: string, id: string) => chama<{ ok: true }>('DELETE', `/studio/nos/${k(kind, id)}`),
  historico: (kind: string, id: string) => chama<{ versoes: Meta[] }>('GET', `/studio/historico/${k(kind, id)}?limite=100`).then((r) => r.versoes),
  versao: (kind: string, id: string, seq: number) => chama<{ meta: Meta; no: any }>('GET', `/studio/versao/${k(kind, id)}?seq=${seq}`),
  diff: (kind: string, id: string, de: string | number, para: string | number) => chama<{ diff: import('@polaris/studio').Diff }>('GET', `/studio/diff/${k(kind, id)}?de=${de}&para=${para}`).then((r) => r.diff),
  comentarios: (kind: string, id: string) => chama<{ comentarios: Comentario[] }>('GET', `/studio/comentarios?kind=${encodeURIComponent(kind)}&id=${encodeURIComponent(id)}`).then((r) => r.comentarios),
  comenta: (c: { kind: string; id: string; texto: string; ancora?: string; versao?: number; respondeA?: string }) => chama<{ comentario: Comentario }>('POST', '/studio/comentarios', c).then((r) => r.comentario),
  resolve: (cid: string, resolvido: boolean) => chama<{ ok: true }>('POST', `/studio/comentarios/${cid}/resolver`, { resolvido }),
}
