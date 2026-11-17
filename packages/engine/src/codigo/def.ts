import type { Contexto, Erro, Registry } from '@polaris/schema'
import { parsePermissoes } from './permissoes'
import { parseHtmlTemplate, type ParteHtml } from './html'

/** Definição validada de um bloco de código, embutida no Programa. JSON puro. */
export type CodigoDef = {
  interface: string
  linguagem: 'js' | 'html'
  modo: 'puro' | 'iframe'
  fonte: string
  permissoes: string[]
  altura: number
  /** modo iframe + html: template já analisado */
  partes?: ParteHtml[]
}

export const ALTURA_PADRAO = 240

type Fonte = { linguagem: 'js' | 'html'; modo?: 'puro' | 'iframe'; fonte: string; permissoes?: string[]; altura?: number }

/** Valida a definição de código de um bloco (síncrono: a sintaxe do JS é conferida na pré-carga, pelo sandbox). */
export function compilaCodigo(reg: Registry, interfaceId: string, ctx: Contexto = {}): { ok: true; def: CodigoDef } | { ok: false; erros: Erro[] } {
  let c: Fonte | undefined
  try { c = reg.resolveBloco(interfaceId, ctx).codigo as Fonte | undefined } catch (e) { return { ok: false, erros: [{ caminho: '/spec/interface', regra: 'ref', mensagem: (e as Error).message }] } }
  if (!c) return { ok: false, erros: [{ caminho: '/spec/codigo', regra: 'codigo', mensagem: `o bloco '${interfaceId}' não tem código` }] }
  const erros: Erro[] = []
  const erro = (caminho: string, mensagem: string, dica?: string) => erros.push({ caminho: `/spec/codigo${caminho}`, regra: 'codigo', mensagem: `bloco '${interfaceId}': ${mensagem}`, ...(dica ? { dica } : {}) })

  const modo = c.modo ?? (c.linguagem === 'html' ? 'iframe' : 'puro')
  if (c.linguagem === 'html' && modo === 'puro') erro('/modo', 'HTML não pode ser executado em modo puro', "use modo 'iframe' (o HTML roda isolado, sem scripts)")
  const perms = c.permissoes ?? []
  if (modo === 'puro' && perms.length) erro('/permissoes', 'o modo puro não tem permissões: o código não acessa rede, DOM nem formulários', "remova permissoes ou use modo 'iframe'")
  if (modo === 'puro' && c.altura !== undefined) erro('/altura', 'altura só vale no modo iframe')
  if (modo === 'iframe') {
    const p = parsePermissoes(perms)
    if (!p.ok) for (const m of p.erros) erro('/permissoes', m)
  }
  let partes: ParteHtml[] | undefined
  if (c.linguagem === 'html') {
    const t = parseHtmlTemplate(c.fonte, ['props', 'tenant'])
    for (const e of t.erros) erro('/fonte', e.mensagem, e.dica)
    partes = t.partes
  }
  if (erros.length) return { ok: false, erros }
  return { ok: true, def: { interface: interfaceId, linguagem: c.linguagem, modo, fonte: c.fonte, permissoes: [...perms], altura: c.altura ?? ALTURA_PADRAO, ...(partes ? { partes } : {}) } }
}
