import { COMPONENTES_BASE, compilaPrograma, registraBase, renderPaginaHtml } from '@polaris/engine'
import { registraCommerce } from '@polaris/engine/commerce'
import { registraSite } from '@polaris/engine/site'
import { cssDoTema, registraTemas, TEMA_PADRAO } from '@polaris/engine/tema'
import { Registry, criaValidador, validaFormulario } from '@polaris/schema'
import { cssDoCartaz, htmlDe, layoutCartaz, validaNoCartaz } from '@polaris/signmaker'
import { CSS_FORMULARIO, confereExpressoes, renderizaFormularioHtml } from '@polaris/engine'

// Pré-visualização: o mesmo compilador e renderizador da produção sobre o RASCUNHO. Serve ao cliente (SPA) e ao servidor (`/studio/previa`).
// Preview AO VIVO: o mesmo compilador e o mesmo renderizador da produção, no navegador, sobre o RASCUNHO (não sobre o salvo). Roda num iframe `sandbox=""` (sem scripts, origem opaca):
// o HTML vem do engine (texto escapado), então mesmo um nó malicioso não executa nada. Dados externos (spec.dados) não são buscados no editor: os blocos ligados a eles aparecem vazios.
const BASE = (() => { const r = new Registry(); registraBase(r); registraTemas(r); registraCommerce(r); registraSite(r); return r })()
const VALIDA_NO = criaValidador()
const ID_SEGURO = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/

/** prévia de um `cartaz`: o MESMO layout e o MESMO desenhador de HTML que a geração real (e que o PDF), sobre o rascunho e os dados de exemplo. Dado faltando ou texto que não cabe vira PROBLEMA, não erro. */
/** a peça INTEIRA ajustada ao quadro da prévia (o SVG com `viewBox` escala o HTML da peça, que é em pt, para caber sem rolagem): a tela de edição põe as caixas por cima na mesma proporção. É só a prévia do editor; o HTML e o PDF reais seguem sendo os de `htmlDe` e `pdfDe`. */
function ajustadoAoQuadro(l: Parameters<typeof htmlDe>[0]): string {
  const p = l.paginas[0]; if (!p) return htmlDe(l)
  const W = Number((p.largura * 96 / 72).toFixed(3)), H = Number((p.altura * 96 / 72).toFixed(3)) // o HTML da peça é em pt e o SVG em px (1 pt = 96/72 px): a moldura tem de ter as medidas em px, senão a peça fica 33% maior e cortada
  return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:"><style>${cssDoCartaz(l)}\nhtml,body{height:100%;overflow:hidden;background:#fff}.pagina{margin:0!important;box-shadow:none!important}svg.ajuste{display:block;width:100%;height:100%}</style></head><body><svg class="ajuste" viewBox="0 0 ${W} ${H}" preserveAspectRatio="xMidYMid meet"><foreignObject x="0" y="0" width="${W}" height="${H}"><div xmlns="http://www.w3.org/1999/xhtml">${htmlDe({ ...l, paginas: [p] }, { fragmento: true })}</div></foreignObject></svg></body></html>`
}
function geraPreviewCartaz(no: any, dados: unknown): ResultadoPreview {
  const fmt = (e: { caminho: string; mensagem: string }) => `${e.caminho} ${e.mensagem}`
  const problemas: string[] = []
  const valido = VALIDA_NO(no); if (!valido.ok) return { ok: true, titulo: '', html: '', problemas: valido.erros.slice(0, 20).map(fmt) }
  const incoerente = validaNoCartaz(no); problemas.push(...incoerente)
  if (incoerente.length) return { ok: true, titulo: String(no.spec?.titulo ?? ''), html: '', problemas } // incoerente: a geração recusaria; a lista de problemas é o que o editor mostra
  let html = '', titulo = String(no.spec?.titulo ?? '')
  try { const l = layoutCartaz(no.spec, dados ?? no.spec?.exemplo ?? {}); html = ajustadoAoQuadro(l); titulo = l.titulo; problemas.push(...l.avisos) } catch (e) { problemas.push((e as Error).message.slice(0, 200)) }
  return { ok: true, titulo, html, problemas: problemas.slice(0, 50) }
}

export type ResultadoPreview = { ok: true; html: string; titulo: string; problemas?: string[] } | { ok: false; erros: string[] }
/** prévia de um `formulario`: o HTML estático (sem comportamento) e os problemas da definição (schema, referências, estrutura contra o serviço, expressões) */
function geraPreviewFormulario(no: any, extras: any[], selecionadoId: string | undefined, temaNo: any, modo: 'claro' | 'escuro'): ResultadoPreview {
  const fmt = (e: { caminho: string; mensagem: string }) => `${e.caminho} ${e.mensagem}`
  const reg = BASE.derivado(); for (const b of extras) { try { reg.registra(b) } catch { /* nó inválido do tenant: a prévia segue sem ele */ } }
  let tema: any = TEMA_PADRAO; if (temaNo) { try { tema = reg.registra({ ...temaNo, id: 'studio.preview-tema' }) } catch { /* tema ainda inválido */ } }
  const problemas: string[] = []
  let registrado
  try { registrado = reg.registra({ ...no, id: 'studio.preview-formulario', estatuto: 'publicado', tenantId: null }) } catch (e) { problemas.push(...(((e as { detalhes?: Array<{ caminho: string; mensagem: string }> }).detalhes ?? [{ caminho: '/', mensagem: (e as Error).message }]).slice(0, 30).map(fmt))); return { ok: true, html: '', titulo: '', problemas } }
  problemas.push(...reg.verifica(registrado).map(fmt), ...validaFormulario(reg, registrado).map(fmt), ...confereExpressoes(registrado.spec as never))
  const spec = registrado.spec as { passos?: Array<{ id: string }> }
  const passo = selecionadoId && spec.passos ? Math.max(0, spec.passos.findIndex((p) => p.id === selecionadoId)) : 0
  let corpo = ''; try { corpo = renderizaFormularioHtml(spec as never, { passo }) } catch (e) { problemas.push(`/spec não pôde ser desenhado: ${(e as Error).message.slice(0, 120)}`) }
  const css = cssDoTema(tema)
  return { ok: true, titulo: String((spec as { titulo?: unknown }).titulo ?? ''), problemas: problemas.slice(0, 50), html: `<!doctype html><html lang="pt-BR" data-modo="${modo === 'escuro' ? 'escuro' : 'claro'}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}${CSS_FORMULARIO}</style></head><body><div id="polaris">${corpo}</div></body></html>` }
}

/** Dá um `id` (`pl-slots-filhos-0`…, o caminho do bloco) a cada bloco que não tem um, SÓ na prévia: o Studio usa para realçar na prévia o bloco que está selecionado ou sob o mouse na árvore. Não mexe no nó salvo nem muda ids que já existem. */
export function anotaIds(no: any): any {
  if (!no?.spec?.raiz || typeof no.spec.raiz !== 'object') return no
  const anda = (n: any, caminho: Array<string | number>, prof: number): any => {
    if (!n || typeof n !== 'object' || Array.isArray(n) || prof > 40) return n
    const slots = n.slots && typeof n.slots === 'object' && !Array.isArray(n.slots) ? Object.fromEntries(Object.entries(n.slots as Record<string, unknown>).map(([k, v]) => [k, Array.isArray(v) ? v.map((f, i) => anda(f, [...caminho, 'slots', k, i], prof + 1)) : v])) : n.slots
    return { ...n, ...(typeof n.id === 'string' && n.id ? {} : { id: ['pl', ...caminho].join('-') }), ...(slots !== undefined ? { slots } : {}) }
  }
  return { ...no, spec: { ...no.spec, raiz: anda(no.spec.raiz, [], 0) } }
}

export function geraPreview(no: any, blocosDoTenant: any[], selecionadoId: string | undefined, temaNo?: any, modo: 'claro' | 'escuro' = 'claro', dados?: unknown): ResultadoPreview {
  if (no?.kind === 'cartaz') return geraPreviewCartaz(no, dados)
  if (no?.kind === 'formulario') { try { return geraPreviewFormulario(no, blocosDoTenant, selecionadoId, temaNo, modo) } catch (e) { return { ok: false, erros: [(e as Error).message.slice(0, 300)] } } }
  try {
    const reg = BASE.derivado()
    for (const b of blocosDoTenant) { try { reg.registra(b) } catch { /* bloco inválido do tenant: o preview segue sem ele */ } }
    let tema: any = TEMA_PADRAO
    if (temaNo) { try { tema = reg.registra({ ...temaNo, id: 'studio.preview-tema' }) } catch { /* tema ainda inválido */ } }
    const pagina = reg.registra({ ...anotaIds(no), id: 'studio.preview', estatuto: 'publicado', tenantId: null })
    const c = compilaPrograma(reg, pagina)
    if (!c.ok) return { ok: false, erros: c.erros.slice(0, 20).map((e: any) => `${e.caminho ?? ''} ${e.mensagem}`.trim()) }
    const r = renderPaginaHtml({ programa: c.programa, componentes: COMPONENTES_BASE, dados: {} })
    const css = cssDoTema(tema)
    const destaque = selecionadoId && ID_SEGURO.test(selecionadoId) ? `#${selecionadoId}{outline:2px solid #f59e0b!important;outline-offset:2px}` : ''
    return { ok: true, titulo: r.titulo, html: `<!doctype html><html lang="pt-BR" data-modo="${modo === 'escuro' ? 'escuro' : 'claro'}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}${destaque}</style></head><body><div id="polaris">${r.corpo}</div></body></html>` }
  } catch (e) { return { ok: false, erros: [(e as Error).message.slice(0, 300)] } }
}

