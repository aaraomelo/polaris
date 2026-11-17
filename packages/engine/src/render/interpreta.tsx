import { Component, createElement, Fragment, type ReactNode } from 'react'
import { avalia, FUNCOES_PADRAO, verdadeiro, type Escopo, type Funcoes } from '../expr/index'
import type { IRElemento, IRNo } from '../ir/tipos'
import type { Programa } from './programa'
import { LIMITES_RUNTIME, type Componentes, type ErroRuntime } from './tipos'
import { executaAcoes, type ContextoAcoes } from './acoes'
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
export function renderiza(no: IRNo, escopo: Escopo, amb: Ambiente, host: SlotsDoHost | null, chave: string, prof = 0): ReactNode[] {
  const funcoes = amb.funcoes ?? FUNCOES_PADRAO
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
  const slots = slotsDe(no, escopo, amb, host, chave, prof)
  const comp = amb.componentes[alvo]!
  const on: Record<string, (payload?: unknown) => void> = {}
  for (const [evento, acoes] of Object.entries(no.eventos ?? {})) {
    on[evento] = (payload?: unknown) => { if (amb.acoes) void executaAcoes(acoes, escopo, { evento: payload }, amb.acoes) }
  }
  return [createElement(Isola, { key: chave, caminho: no.caminho, onErro: amb.onErro }, createElement(Fragment, null, comp({ props, slots, on, ...(no.id !== undefined ? { id: no.id } : {}), caminho: no.caminho })))]
}
