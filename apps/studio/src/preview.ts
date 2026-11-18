import { COMPONENTES_BASE, compilaPrograma, registraBase, renderPaginaHtml } from '@polaris/engine'
import { registraCommerce } from '@polaris/engine/commerce'
import { cssDoTema, registraTemas, TEMA_PADRAO } from '@polaris/engine/tema'
import { Registry } from '@polaris/schema'

// Pré-visualização: o mesmo compilador e renderizador da produção sobre o RASCUNHO. Serve ao cliente (SPA) e ao servidor (`/studio/previa`).
// Preview AO VIVO: o mesmo compilador e o mesmo renderizador da produção, no navegador, sobre o RASCUNHO (não sobre o salvo). Roda num iframe `sandbox=""` (sem scripts, origem opaca):
// o HTML vem do engine (texto escapado), então mesmo um nó malicioso não executa nada. Dados externos (spec.dados) não são buscados no editor: os blocos ligados a eles aparecem vazios.
const BASE = (() => { const r = new Registry(); registraBase(r); registraTemas(r); registraCommerce(r); return r })()
const ID_SEGURO = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/

export type ResultadoPreview = { ok: true; html: string; titulo: string } | { ok: false; erros: string[] }
export function geraPreview(no: any, blocosDoTenant: any[], selecionadoId: string | undefined, temaNo?: any): ResultadoPreview {
  try {
    const reg = BASE.derivado()
    for (const b of blocosDoTenant) { try { reg.registra(b) } catch { /* bloco inválido do tenant: o preview segue sem ele */ } }
    let tema: any = TEMA_PADRAO
    if (temaNo) { try { tema = reg.registra({ ...temaNo, id: 'studio.preview-tema' }) } catch { /* tema ainda inválido */ } }
    const pagina = reg.registra({ ...no, id: 'studio.preview', estatuto: 'publicado', tenantId: null })
    const c = compilaPrograma(reg, pagina)
    if (!c.ok) return { ok: false, erros: c.erros.slice(0, 20).map((e: any) => `${e.caminho ?? ''} ${e.mensagem}`.trim()) }
    const r = renderPaginaHtml({ programa: c.programa, componentes: COMPONENTES_BASE, dados: {} })
    const css = cssDoTema(tema)
    const destaque = selecionadoId && ID_SEGURO.test(selecionadoId) ? `#${selecionadoId}{outline:2px solid #f59e0b!important;outline-offset:2px}` : ''
    return { ok: true, titulo: r.titulo, html: `<!doctype html><html lang="pt-BR" data-modo="claro"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}${destaque}</style></head><body><div id="polaris">${r.corpo}</div></body></html>` }
  } catch (e) { return { ok: false, erros: [(e as Error).message.slice(0, 300)] } }
}

