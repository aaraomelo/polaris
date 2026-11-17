import { createElement } from 'react'
import { renderToString } from 'react-dom/server'
import { jsonSeguro } from './json'
import { carregaDados, type OpcoesCarga, type ResultadoDados } from '../dados/carrega'
import { Pagina, tituloDaPagina, type EntradaPagina } from './pagina'
import type { Programa } from './programa'

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

export { jsonSeguro }

export const ID_RAIZ = 'polaris'
export const ID_ESTADO = '__POLARIS__'

/** Estado enviado ao cliente para hidratar sem nova busca. Não inclui os componentes (código do cliente). */
export type EstadoCliente = Pick<EntradaPagina, 'dados' | 'status' | 'erros' | 'estado' | 'params' | 'consulta' | 'tenant'> & { programa: Programa }

export type SaidaSsr = { html: string; corpo: string; titulo: string; estado: EstadoCliente }

/** Renderiza a página no servidor: documento HTML completo + estado para hidratação. */
export function renderPaginaHtml(entrada: EntradaPagina, opcoes: { scripts?: string[]; lang?: string } = {}): SaidaSsr {
  const corpo = renderToString(createElement(Pagina as never, entrada as never))
  const titulo = tituloDaPagina(entrada)
  const estado: EstadoCliente = {
    programa: entrada.programa,
    ...(entrada.dados ? { dados: entrada.dados } : {}),
    ...(entrada.status ? { status: entrada.status } : {}),
    ...(entrada.erros ? { erros: entrada.erros } : {}),
    ...(entrada.estado ? { estado: entrada.estado } : {}),
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

export type SaidaCompleta = SaidaSsr & { resultado: ResultadoDados }

/** Carrega os dados `auto` da página (em paralelo, sem lançar) e renderiza no servidor. Falha de fonte vira status/erro, não exceção. */
export async function renderPaginaCompleta(
  programa: Programa,
  componentes: EntradaPagina['componentes'],
  opcoes: OpcoesCarga & { scripts?: string[]; lang?: string },
): Promise<SaidaCompleta> {
  const resultado = await carregaDados(programa, opcoes)
  const { scripts, lang, ...carga } = opcoes
  const saida = renderPaginaHtml({
    programa, componentes, dados: resultado.dados, status: resultado.status, erros: resultado.erros,
    ...(carga.params ? { params: carga.params } : {}), ...(carga.consulta ? { consulta: carga.consulta } : {}),
    ...(carga.tenant ? { tenant: carga.tenant } : {}), ...(carga.estado ? { estado: carga.estado } : {}),
  }, { ...(scripts ? { scripts } : {}), ...(lang ? { lang } : {}) })
  return { ...saida, resultado }
}
