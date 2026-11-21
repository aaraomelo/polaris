// Estado ligado à consulta da URL (`estado.<nome>.daConsulta`): trocar de categoria ou de filtro muda SÓ o estado e a URL, sem recarregar a página (o scroll fica e o
// runtime reativo reescreve apenas o que depende do estado). Três caminhos: clique num link `soConsulta`, botão voltar/avançar e uma mudança de estado por ação (que escreve na URL).
import type { Programa } from '../render/programa'
import type { Store } from '../render/store'

type Modelo = { despacha(a: { t: 'estado'; nome: string; valor: unknown }): void; flush(): void; assina(e: (m: { antes: Store; depois: Store }) => void): () => void }

export function ligaConsulta(programa: Programa, container: Element, modelo: Modelo): () => void {
  const ligados = Object.entries(programa.pagina.estado).filter(([, d]) => d.daConsulta) as Array<[string, { daConsulta: string; inicial: unknown }]>
  if (!ligados.length || typeof window === 'undefined') return () => {}
  const w = window, caminho = w.location.pathname
  const aplica = (u: URL) => { for (const [nome, d] of ligados) { const v = u.searchParams.get(d.daConsulta); modelo.despacha({ t: 'estado', nome, valor: v === null ? d.inicial : v }) } modelo.flush() }
  const noClique = (e: Event) => {
    const m = e as MouseEvent
    if (m.defaultPrevented || m.button !== 0 || m.metaKey || m.ctrlKey || m.shiftKey || m.altKey) return
    const a = (e.target as Element | null)?.closest?.('a[data-consulta]') as HTMLAnchorElement | null
    if (!a) return
    let u: URL; try { u = new URL(a.href, w.location.href) } catch { return }
    if (u.origin !== w.location.origin || u.pathname !== caminho) return // outra página: navegação normal
    e.preventDefault()
    if (u.search !== w.location.search) w.history.pushState({ plc: 1 }, '', u.pathname + u.search + u.hash)
    aplica(u)
  }
  const noVoltar = () => { if (w.location.pathname === caminho) aplica(new URL(w.location.href)) }
  // uma mudança de estado por ação (não por link) acompanha a URL, sem criar entrada no histórico
  const desassina = modelo.assina((m) => {
    const u = new URL(w.location.href); let mudou = false
    for (const [nome, d] of ligados) {
      if (m.antes.estado[nome] === m.depois.estado[nome]) continue
      const v = m.depois.estado[nome], texto = typeof v === 'string' ? v : ''
      if (texto === '' || v === d.inicial) { if (u.searchParams.has(d.daConsulta)) { u.searchParams.delete(d.daConsulta); mudou = true } } else if (u.searchParams.get(d.daConsulta) !== texto) { u.searchParams.set(d.daConsulta, texto); mudou = true }
    }
    if (mudou) w.history.replaceState(w.history.state, '', u.pathname + u.search + u.hash)
  })
  container.addEventListener('click', noClique); w.addEventListener('popstate', noVoltar)
  return () => { desassina(); container.removeEventListener('click', noClique); w.removeEventListener('popstate', noVoltar) }
}
