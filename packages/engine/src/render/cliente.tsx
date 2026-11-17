import { createElement } from 'react'
import { hydrateRoot, type Root } from 'react-dom/client'
import { Pagina, tituloDaPagina, type EntradaPagina } from './pagina'
import { ID_ESTADO, ID_RAIZ, type EstadoCliente } from './ssr'
import type { Componentes, ErroRuntime } from './tipos'

/** Lê o estado embutido pelo SSR. */
export function leEstado(doc: Document = document): EstadoCliente {
  const el = doc.getElementById(ID_ESTADO)
  if (!el?.textContent) throw new Error(`estado de hidratação ausente (#${ID_ESTADO})`)
  return JSON.parse(el.textContent) as EstadoCliente
}

/** Hidrata a página renderizada no servidor. `componentes` é o código do cliente (precisa ser o mesmo conjunto do servidor). */
export function hidrata(componentes: Componentes, opcoes: { doc?: Document; estado?: EstadoCliente; onErro?: (e: ErroRuntime) => void } = {}): Root {
  const doc = opcoes.doc ?? document
  const raiz = doc.getElementById(ID_RAIZ)
  if (!raiz) throw new Error(`contêiner #${ID_RAIZ} não encontrado`)
  const estado = opcoes.estado ?? leEstado(doc)
  const entrada: EntradaPagina = { ...estado, componentes, ...(opcoes.onErro ? { onErro: opcoes.onErro } : {}) }
  return hydrateRoot(raiz, createElement(Pagina as never, entrada as never), { onRecoverableError: (e) => opcoes.onErro?.({ caminho: '/', regra: 'render', mensagem: String((e as Error).message) }) })
}

export { tituloDaPagina }
