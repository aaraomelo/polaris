import { createElement } from 'react'
import { hydrateRoot, type Root } from 'react-dom/client'
import type { Carregador } from './acoes'
import { preCarregaBlocos } from './lazy'
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
export function hidrata(componentes: Componentes, opcoes: { doc?: Document; estado?: EstadoCliente; onErro?: (e: ErroRuntime) => void; carregador?: Carregador; navegar?: (url: string) => void } = {}): Root {
  const doc = opcoes.doc ?? document
  const raiz = doc.getElementById(ID_RAIZ)
  if (!raiz) throw new Error(`contêiner #${ID_RAIZ} não encontrado`)
  const estado = opcoes.estado ?? leEstado(doc)
  const entrada: EntradaPagina = { ...estado, componentes, ...(opcoes.onErro ? { onErro: opcoes.onErro } : {}), ...(opcoes.carregador ? { carregador: opcoes.carregador } : {}), ...(opcoes.navegar ? { navegar: opcoes.navegar } : {}) }
  return hydrateRoot(raiz, createElement(Pagina as never, entrada as never), { onRecoverableError: (e) => opcoes.onErro?.({ caminho: '/', regra: 'render', mensagem: String((e as Error).message) }) })
}

export { tituloDaPagina }

/**
 * Como `hidrata`, mas primeiro carrega os módulos lazy que a página usa (os mesmos que o servidor pré-carregou).
 * Necessário quando há blocos com code splitting: hidratar sem eles divergiria do HTML do servidor.
 */
export async function hidrataAsync(componentes: Componentes, opcoes: Parameters<typeof hidrata>[1] = {}): Promise<Root> {
  const doc = opcoes.doc ?? document
  const estado = opcoes.estado ?? leEstado(doc)
  const r = await preCarregaBlocos(estado.programa, componentes)
  for (const f of r.falhas) opcoes.onErro?.({ caminho: '/', regra: 'componente-ausente', mensagem: `bloco '${f.interface}' não carregou: ${f.erro}` })
  return hidrata(componentes, { ...opcoes, estado })
}
