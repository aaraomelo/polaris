import { Component, createElement, Fragment, Suspense, use, useEffect, useState, type ReactNode } from 'react'
import type { ResultadoUm } from '../dados/carrega'
import { avalia, FUNCOES_PADRAO, verdadeiro, type Escopo, type Funcoes } from '../expr/index'
import type { IRElemento, IRNo } from '../ir/tipos'
import type { Programa } from './programa'
import { LIMITES_RUNTIME, type Componentes, type ErroRuntime } from './tipos'
import { executaAcoes, type ContextoAcoes } from './acoes'
import { jsonSeguro } from './json'
import { carregado, ehLazy, envoltorioLazy, falhou } from './lazy'
import { valorDe } from './valor'

// ---------------------------------------------------------------------------
// Interpretador: percorre o IR e produz elementos React. Puro e síncrono: o mesmo código roda no
// servidor (SSR) e no cliente (hidratação). Não consulta o registry; usa só o Programa.
// ---------------------------------------------------------------------------

export type Ambiente = {
  programa: Programa
  componentes: Componentes
  funcoes?: Funcoes
  onErro?: (e: ErroRuntime) => void
  /** executor de ações (só no cliente interativo; sem ele os eventos não fazem nada) */
  acoes?: ContextoAcoes
  /** SERVIDOR: cargas em streaming já em andamento; o Suspense as consome. No cliente fica indefinido (o valor vem do HTML). */
  stream?: Record<string, Promise<ResultadoUm>>
}

/** Filhos que a instância de um bloco composto recebeu, avaliados no escopo de QUEM os passou. */
type SlotsDoHost = Record<string, () => ReactNode>

/** Isola falhas de render de um bloco no cliente (no servidor o erro propaga ao chamador). */
export class Isola extends Component<{ caminho: string; onErro?: (e: ErroRuntime) => void; children?: ReactNode }, { falhou: boolean }> {
  state = { falhou: false }
  static getDerivedStateFromError() { return { falhou: true } }
  componentDidCatch(erro: Error) {
    this.props.onErro?.({ caminho: this.props.caminho, regra: 'render', mensagem: erro.message })
  }
  render() {
    return this.state.falhou ? createElement('span', { 'data-pl-erro': this.props.caminho, hidden: true }) : this.props.children
  }
}

function relata(amb: Ambiente, e: ErroRuntime): void {
  amb.onErro?.(e)
}

function avaliaProps(el: IRElemento, escopo: Escopo, funcoes: Funcoes): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(el.props)) out[k] = valorDe(v, escopo, funcoes)
  return out
}

function slotsDe(el: IRElemento, escopo: Escopo, amb: Ambiente, host: SlotsDoHost | null, chave: string, prof: number): Record<string, ReactNode> {
  const out: Record<string, ReactNode> = {}
  for (const [nome, lista] of Object.entries(el.slots)) {
    out[nome] = lista.flatMap((f, i) => renderiza(f, escopo, amb, host, `${chave}/${nome}/${i}`, prof + 1))
  }
  return out
}

/** Expande se/repetir e renderiza o nó. Devolve uma lista de elementos com `key` estável. */
export function renderiza(no: IRNo, escopo: Escopo, amb: Ambiente, host: SlotsDoHost | null, chave: string, prof = 0, semFronteira = false): ReactNode[] {
  const funcoes = amb.funcoes ?? FUNCOES_PADRAO
  // Fronteira de streaming: o nó usa dados que ainda podem não ter chegado. Tudo dele (se, repetir, props, filhos) fica atrás do Suspense.
  if (!semFronteira && no.tipo === 'elemento' && no.aguarda?.length) {
    const esqueleto = no.esqueleto ? renderiza(no.esqueleto, escopo, amb, host, `${chave}~e`, prof + 1) : null
    return [createElement(Suspense, { key: chave, fallback: esqueleto }, createElement(NoAguarda, { no, escopo, amb, host, chave, prof }))]
  }
  if (prof > LIMITES_RUNTIME.profundidade) {
    relata(amb, { caminho: no.caminho, regra: 'limite', mensagem: `profundidade de renderização acima de ${LIMITES_RUNTIME.profundidade}` })
    return []
  }
  if (no.se && !verdadeiro(avalia(no.se, escopo, funcoes))) return []

  if (no.repetir) {
    const lista = avalia(no.repetir.cada, escopo, funcoes)
    if (!Array.isArray(lista)) return []
    if (lista.length > LIMITES_RUNTIME.iteracoes) {
      relata(amb, { caminho: no.caminho, regra: 'limite', mensagem: `repetir com ${lista.length} itens; renderizando os primeiros ${LIMITES_RUNTIME.iteracoes}` })
    }
    return lista.slice(0, LIMITES_RUNTIME.iteracoes).flatMap((item, i) =>
      um(no, { ...escopo, [no.repetir!.como]: item, indice: i }, amb, host, `${chave}#${i}`, prof),
    )
  }
  return um(no, escopo, amb, host, chave, prof)
}

function um(no: IRNo, escopo: Escopo, amb: Ambiente, host: SlotsDoHost | null, chave: string, prof: number): ReactNode[] {
  if (no.tipo === 'slot') {
    const f = host?.[no.nome]
    return f ? [createElement(Fragment, { key: chave }, f())] : []
  }
  const funcoes = amb.funcoes ?? FUNCOES_PADRAO
  const props = avaliaProps(no, escopo, funcoes)
  const { interface: iface, cadeia, impl } = no.bloco

  if (impl === 'composto') {
    const m = amb.programa.blocos[iface]
    if (!m) {
      relata(amb, { caminho: no.caminho, regra: 'bloco-ausente', mensagem: `modelo do bloco '${iface}' não está no programa` })
      return []
    }
    // slots: avaliados preguiçosamente no escopo de fora, só quando o modelo chamar core/slot
    const doHost: SlotsDoHost = Object.fromEntries(
      Object.entries(no.slots).map(([nome, lista]) => [nome, () => lista.flatMap((f, i) => renderiza(f, escopo, amb, host, `${chave}/${nome}/${i}`, prof + 1))]),
    )
    const filhos = renderiza(m.modelo, { props, tenant: escopo.tenant }, amb, doHost, `${chave}>`, prof + 1)
    return [createElement(Isola, { key: chave, caminho: no.caminho, onErro: amb.onErro }, ...filhos)]
  }

  if (impl === 'codigo') {
    relata(amb, { caminho: no.caminho, regra: 'codigo', mensagem: `bloco de código '${iface}': execução em sandbox ainda não disponível` })
    return []
  }

  const alvo = cadeia.find((c) => amb.componentes[c])
  if (!alvo) {
    relata(amb, { caminho: no.caminho, regra: 'componente-ausente', mensagem: `não há componente para '${iface}' (cadeia: ${cadeia.join(' → ')})` })
    return []
  }
  const entrada = amb.componentes[alvo]!
  if (ehLazy(entrada) && falhou(entrada)) {
    relata(amb, { caminho: no.caminho, regra: 'componente-ausente', mensagem: `o módulo do bloco '${alvo}' não pôde ser carregado` })
    return []
  }
  const slots = slotsDe(no, escopo, amb, host, chave, prof)
  const on: Record<string, (payload?: unknown) => void> = {}
  for (const [evento, acoes] of Object.entries(no.eventos ?? {})) {
    on[evento] = (payload?: unknown) => { if (amb.acoes) void executaAcoes(acoes, escopo, { evento: payload }, amb.acoes) }
  }
  const pc = { props, slots, on, ...(no.id !== undefined ? { id: no.id } : {}), caminho: no.caminho }
  // bloco lazy já pré-carregado: chamada síncrona, igual a um bloco comum (sem Suspense, SSR e hidratação batem)
  const comp = ehLazy(entrada) ? carregado(entrada) : entrada
  const conteudo = comp
    ? createElement(Fragment, null, comp(pc))
    : createElement(Suspense, { fallback: null }, createElement(envoltorioLazy(entrada as import('./tipos').ComponenteLazy), pc))
  return [createElement(Isola, { key: chave, caminho: no.caminho, onErro: amb.onErro }, conteudo)]
}

// ---------------------------------------------------------------------------
// Streaming: o dado viaja DENTRO do HTML do trecho (um <script type="application/json" data-pl-b=chave> no começo dele).
// O React só hidrata o trecho depois que o HTML dele chegou, então o valor já está no DOM: sem segunda chamada, sem
// depender da ordem de entrega e sem injetar nada fora do que o React emite.
// ---------------------------------------------------------------------------

type Payload = Record<string, ResultadoUm>

function leBruto(chave: string): string | null {
  if (typeof document === 'undefined') return null
  for (const el of document.querySelectorAll('script[data-pl-b]')) if (el.getAttribute('data-pl-b') === chave) return el.textContent
  return null
}

function NoAguarda(p: { no: IRElemento; escopo: Escopo; amb: Ambiente; host: SlotsDoHost | null; chave: string; prof: number }): ReactNode {
  const { no, escopo, amb, host, chave, prof } = p
  const vars = no.aguarda!
  // servidor: consome as promessas (suspende até chegarem). Cliente: lê o que o servidor embutiu (uma vez).
  const [bruto] = useState<string | null>(() => (amb.stream ? null : leBruto(chave)))
  let payload: Payload | null = null
  let texto: string
  if (amb.stream) {
    payload = {}
    for (const v of vars) payload[v] = use(amb.stream[v]!)
    texto = jsonSeguro(payload)
  } else {
    try { payload = bruto ? (JSON.parse(bruto) as Payload) : null } catch { payload = null }
    texto = bruto ?? ''
  }

  // o valor do HTML vale enquanto o store ainda diz "carregando" (hidratação); depois o store manda
  const status = (escopo.status ?? {}) as Record<string, string>
  const doHtml = vars.filter((v) => payload?.[v] && (amb.stream || status[v] === 'carregando'))
  const faltam = vars.filter((v) => !doHtml.includes(v) && status[v] === 'carregando')

  useEffect(() => {
    const d = amb.acoes?.dispatch
    if (!d) return
    for (const v of doHtml) {
      const r = payload![v]!
      d(r.ok ? { t: 'dado', nome: v, valor: r.valor } : { t: 'erro', nome: v, erro: r.erro })
    }
    // roda uma vez, na hidratação
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  if (faltam.length) { // cliente sem o HTML do servidor e sem dado no store: mostra o esqueleto
    return createElement(Fragment, null, ...(no.esqueleto ? renderiza(no.esqueleto, escopo, amb, host, `${chave}~e`, prof + 1) : []))
  }
  const esc: Escopo = { ...escopo, status: { ...(escopo.status as object) }, erros: { ...(escopo.erros as object) } }
  for (const v of doHtml) {
    const r = payload![v]!
    if (r.ok) { esc[v] = r.valor; (esc.status as Record<string, string>)[v] = 'ok'; delete (esc.erros as Record<string, string>)[v] }
    else { delete esc[v]; (esc.status as Record<string, string>)[v] = 'erro'; (esc.erros as Record<string, string>)[v] = r.erro }
  }
  const dados = texto ? createElement('script', { type: 'application/json', 'data-pl-b': chave, dangerouslySetInnerHTML: { __html: texto } }) : null
  return createElement(Fragment, null, dados, ...renderiza(no, esc, amb, host, chave, prof, true))
}
