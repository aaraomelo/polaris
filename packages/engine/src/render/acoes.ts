import { avalia, type Escopo } from '../expr/avalia'
import { funcoesPadrao } from '../expr/padrao'
import type { Funcoes } from '../expr/tipos'
import type { IRAcao } from '../ir/tipos'
import { urlSegura } from './url'
import type { Programa } from './programa'
import { escopoDaStore, reduz, type AcaoStore, type Store } from './store'
import type { ErroRuntime } from './tipos'
import { valorDe } from './valor'

// ---------------------------------------------------------------------------
// Executor de ações declarativas (definir / executar / navegar). Roda no cliente, em resposta a eventos.
// ---------------------------------------------------------------------------

/** Faz a chamada de uma variável de dados no cliente (tipicamente um fetch ao gateway). Rejeita em caso de falha. `estado` é o estado VIVO da página. */
export type Carregador = (req: { dados: string; args: Record<string, unknown>; estado: Record<string, unknown> }) => Promise<unknown>

export type ContextoAcoes = {
  programa: Programa
  /** estado vivo (sempre o mais recente, inclusive dentro de uma sequência de ações) */
  store: { atual: Store }
  dispatch: (a: AcaoStore) => void
  /** número da última chamada de cada variável de dados: respostas antigas são descartadas */
  sequencia: Record<string, number>
  vivo: { atual: boolean }
  carregador?: Carregador
  navegar?: (url: string) => void
  onErro?: (e: ErroRuntime) => void
  funcoes?: Funcoes
}

const MAX_MSG = 200

function aplica(cx: ContextoAcoes, a: AcaoStore): void {
  cx.store.atual = reduz(cx.store.atual, a) // visível já para a próxima ação da sequência
  if (cx.vivo.atual) cx.dispatch(a)
}

/** Executa a lista de ações em sequência. `extra` traz evento / resultado / erro. Nunca lança. */
export async function executaAcoes(acoes: IRAcao[], capturado: Escopo, extra: Record<string, unknown>, cx: ContextoAcoes): Promise<void> {
  const funcoes = cx.funcoes ?? funcoesPadrao()
  const escopo = (): Escopo => ({ ...capturado, ...escopoDaStore(cx.programa, cx.store.atual, capturado), ...extra })
  for (const a of acoes) {
    if (!cx.vivo.atual) return
    try {
      if (a.acao === 'definir') {
        aplica(cx, { t: 'estado', nome: a.estado, valor: avalia(a.valor, escopo(), funcoes) })
      } else if (a.acao === 'navegar') {
        const v = valorDe(a.para, escopo(), funcoes)
        const url = typeof v === 'string' ? urlSegura(v) : undefined
        if (!url) { cx.onErro?.({ caminho: a.caminho, regra: 'navegacao', mensagem: 'destino de navegação ausente ou inseguro' }); continue }
        if (cx.navegar) cx.navegar(url)
        else if (typeof window !== 'undefined') window.location.assign(url)
      } else {
        await executa(a, escopo(), extra, cx, capturado)
      }
    } catch (e) {
      cx.onErro?.({ caminho: a.caminho, regra: 'acao', mensagem: e instanceof Error ? e.message : String(e) })
    }
  }
}

async function executa(a: Extract<IRAcao, { acao: 'executar' }>, escopo: Escopo, extra: Record<string, unknown>, cx: ContextoAcoes, capturado: Escopo): Promise<void> {
  const funcoes = cx.funcoes ?? funcoesPadrao()
  const args: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(a.args)) args[k] = valorDe(v, escopo, funcoes)
  const n = (cx.sequencia[a.dados] = (cx.sequencia[a.dados] ?? 0) + 1)
  if (!cx.carregador) {
    cx.onErro?.({ caminho: a.caminho, regra: 'dados', mensagem: 'não há carregador configurado para executar chamadas de dados' })
    aplica(cx, { t: 'erro', nome: a.dados, erro: 'chamada indisponível' })
    return executaAcoes(a.emErro, capturado, { ...extra, erro: 'chamada indisponível' }, cx)
  }
  aplica(cx, { t: 'carregando', nome: a.dados })
  let valor: unknown
  try {
    valor = await cx.carregador({ dados: a.dados, args, estado: cx.store.atual.estado })
  } catch (e) {
    if (cx.sequencia[a.dados] !== n || !cx.vivo.atual) return // resposta antiga ou página desmontada: ignora
    const msg = (e instanceof Error ? e.message : String(e)).slice(0, MAX_MSG)
    aplica(cx, { t: 'erro', nome: a.dados, erro: msg })
    return executaAcoes(a.emErro, capturado, { ...extra, erro: msg }, cx)
  }
  if (cx.sequencia[a.dados] !== n || !cx.vivo.atual) return
  aplica(cx, { t: 'dado', nome: a.dados, valor })
  return executaAcoes(a.depois, capturado, { ...extra, resultado: valor }, cx)
}
