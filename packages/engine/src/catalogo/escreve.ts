import { createHash } from 'node:crypto'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Registry } from '@polaris/schema'
import { cssDoTema } from '../tema/index'
import { CSS_DO_CATALOGO, geraCatalogo, type OpcoesCatalogo, type SaidaCatalogo } from './index'

/** Imagem de exemplo dos blocos de mídia (SVG simples; vive ao lado do catálogo, em `exemplos/produto.svg`). */
export const SVG_EXEMPLO = '<svg xmlns="http://www.w3.org/2000/svg" width="240" height="160" viewBox="0 0 240 160"><rect width="240" height="160" fill="#c9d6e3"/><circle cx="84" cy="60" r="20" fill="#f4f7fa"/><path d="M0 160l70-64 44 40 40-32 86 56z" fill="#7d96b0"/></svg>\n'

/** Gera o catálogo e escreve em `destino`: index.html, escuro.html, catalogo.css, tema.<hash>.css, catalogo.md e exemplos/produto.svg. */
export function escreveCatalogo(reg: Registry, destino: string, opcoes: Omit<OpcoesCatalogo, 'estiloHref'> = {}): SaidaCatalogo & { arquivos: string[] } {
  const css = opcoes.tema ? cssDoTema(opcoes.tema) : null
  const temaNome = css ? `tema.${createHash('sha256').update(css).digest('hex').slice(0, 12)}.css` : undefined
  const s = geraCatalogo(reg, { ...opcoes, ...(temaNome ? { estiloHref: temaNome } : {}) })
  mkdirSync(join(destino, 'exemplos'), { recursive: true })
  const arquivos: Record<string, string> = { 'index.html': s.html.claro, 'escuro.html': s.html.escuro, 'catalogo.css': CSS_DO_CATALOGO, 'catalogo.md': s.markdown, 'exemplos/produto.svg': SVG_EXEMPLO }
  if (css && temaNome) arquivos[temaNome] = css
  for (const [nome, c] of Object.entries(arquivos)) writeFileSync(join(destino, nome), c)
  return { ...s, arquivos: Object.keys(arquivos).sort() }
}
