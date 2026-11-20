// A TELA DE EDIÇÃO (`midia/tela`): uma moldura de proporção fixa que mostra os filhos (a prévia) e, por cima, CAIXAS que o usuário arrasta e redimensiona (a ilha em `ilha.ts`).
// Este módulo é o que os dois renderizadores (React e runtime vivo) compartilham: os atributos saem iguais nos dois, validados e limitados.

export type CaixaTela = { id: string; rotulo: string; topo: number; esquerda: number; largura: number; altura: number; rotacao: number; atual: boolean }
const ID = /^[A-Za-z0-9_-]{1,64}$/
const fin = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)
const frac = (v: unknown, padrao: number): number => Math.min(2, Math.max(-1, fin(v) ?? padrao))
export const CAIXAS_MAX = 200
export const proporcaoDe = (p: Record<string, unknown>): number => { const v = fin(p.proporcao); return v !== undefined && v > 0.05 && v <= 20 ? Math.round(v * 1e6) / 1e6 : 1 }
export const passoDe = (p: Record<string, unknown>): number => { const v = fin(p.passo); return v !== undefined && v >= 0.001 && v <= 0.1 ? v : 0.005 }
/** as caixas válidas (id seguro, rótulo curto, frações em [-1, 2]); o que não presta é descartado */
export function caixasDe(p: Record<string, unknown>): CaixaTela[] {
  if (!Array.isArray(p.caixas)) return []
  const out: CaixaTela[] = []
  for (const c of p.caixas.slice(0, CAIXAS_MAX)) {
    if (typeof c !== 'object' || c === null || Array.isArray(c)) continue
    const o = c as Record<string, unknown>, id = typeof o.id === 'string' ? o.id : typeof o.id === 'number' ? String(o.id) : ''
    if (!ID.test(id)) continue
    out.push({ id, rotulo: (typeof o.rotulo === 'string' ? o.rotulo : id).slice(0, 120), topo: frac(o.topo, 0), esquerda: frac(o.esquerda, 0), largura: Math.max(0, frac(o.largura, 0.1)), altura: Math.max(0, frac(o.altura, 0.1)), rotacao: Math.min(360, Math.max(-360, fin(o.rotacao) ?? 0)), atual: o.atual === true })
  }
  return out
}
/** os atributos da moldura: marca da ilha, caixas em JSON, passo e a proporção (CSS `aspect-ratio`) */
export function atributosDaTela(p: Record<string, unknown>): Record<string, string> {
  const caixas = caixasDe(p), json = JSON.stringify(caixas)
  return { 'data-polaris-tela': '', 'data-passo': String(passoDe(p)), ...(caixas.length ? { 'data-polaris-caixas': json } : {}), style: `aspect-ratio:${proporcaoDe(p)};position:relative;width:100%` }
}
