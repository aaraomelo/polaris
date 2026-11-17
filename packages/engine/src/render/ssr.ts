import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { Pagina, tituloDaPagina, type EntradaPagina } from './pagina'
import type { Programa } from './programa'

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

/** JSON seguro para <script type="application/json">: nada de </script>, <!-- ou U+2028/9. */
export function jsonSeguro(v: unknown): string {
  return JSON.stringify(v).replace(/</g, '\\u003c').replace(/>/g, '\\u003e').replace(/&/g, '\\u0026').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029')
}

export const ID_RAIZ = 'polaris'
export const ID_ESTADO = '__POLARIS__'

/** Estado enviado ao cliente para hidratar sem nova busca. Não inclui os componentes (código do cliente). */
export type EstadoCliente = Pick<EntradaPagina, 'dados' | 'params' | 'consulta' | 'tenant'> & { programa: Programa }

export type SaidaSsr = { html: string; corpo: string; titulo: string; estado: EstadoCliente }

/** Renderiza a página no servidor: documento HTML completo + estado para hidratação. */
export function renderPaginaHtml(entrada: EntradaPagina, opcoes: { scripts?: string[]; lang?: string } = {}): SaidaSsr {
  const corpo = renderToString(createElement(Pagina as never, entrada as never))
  const titulo = tituloDaPagina(entrada)
  const estado: EstadoCliente = {
    programa: entrada.programa,
    ...(entrada.dados ? { dados: entrada.dados } : {}),
    ...(entrada.params ? { params: entrada.params } : {}),
    ...(entrada.consulta ? { consulta: entrada.consulta } : {}),
    ...(entrada.tenant ? { tenant: entrada.tenant } : {}),
  }
  const scripts = (opcoes.scripts ?? []).map((s) => `<script type="module" src="${esc(s)}"></script>`).join('')
  const html =
    `<!doctype html><html lang="${esc(opcoes.lang ?? 'pt-BR')}"><head><meta charset="utf-8">` +
    `<meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(titulo)}</title></head>` +
    `<body><div id="${ID_RAIZ}">${corpo}</div>` +
    `<script type="application/json" id="${ID_ESTADO}">${jsonSeguro(estado)}</script>${scripts}</body></html>`
  return { html, corpo, titulo, estado }
}
