import { FUNCOES_PADRAO, type Escopo, type Funcoes } from '../expr/index'
import type { IRAcao, IRNo } from '../ir/tipos'
import type { Carregador, ContextoAcoes } from '../render/acoes'
import type { Programa } from '../render/programa'
import { escopoDaStore, iniciaStore, reduz, type AcaoStore, type SementeStore, type Store } from '../render/store'
import type { ErroRuntime } from '../render/tipos'

// ---------------------------------------------------------------------------
// MODELO: o estado da página e as operações sobre ele. Não conhece DOM, HTML nem React.
//   - store imutável (compartilhamento estrutural): trocar uma parte não copia o resto;
//   - toda mudança é uma AcaoStore pura aplicada por `reduz`; o diff por referência dá as chaves que mudaram;
//   - os "espelhos" (DOM vivo, string do SSR, o React do oráculo…) apenas assinam as mudanças e se projetam;
//   - o histórico de mudanças (ação, chaves, antes/depois) fica disponível sem custo para depuração, undo e diff.
// ---------------------------------------------------------------------------

export type Mudanca = { acoes: AcaoStore[]; mudou: ReadonlySet<string>; antes: Store; depois: Store }
export type Espelho = (m: Mudanca) => void

export type OpcoesModelo = SementeStore & {
  programa: Programa
  params?: Record<string, unknown>
  consulta?: Record<string, unknown>
  tenant?: Record<string, unknown>
  idioma?: string
  carregador?: Carregador
  navegar?: (url: string) => void
  onErro?: (e: ErroRuntime) => void
  funcoes?: Funcoes
  /** quantas mudanças guardar no histórico (0 = nenhuma) */
  historico?: number
  /** mundo fechado: só as chaves que a página declara poder mudar aceitam `despacha` externo (habilita a poda de nós estáticos) */
  fechado?: boolean
}

export type Modelo = {
  store(): Store
  /** escopo VIVO da página (mesmo objeto, atualizado a cada mudança): é o que as expressões leem */
  escopo: Escopo
  /** chaves que podem mudar durante a vida da página; null = qualquer uma (mundo aberto) */
  mutaveis: ReadonlySet<string> | null
  /** aplica uma ação ao store e notifica os espelhos na hora */
  despacha(a: AcaoStore): void
  /** notifica os espelhos do que estiver pendente (ações assíncronas agendam isto em microtask) */
  flush(): void
  assina(e: Espelho): () => void
  historico(): readonly Mudanca[]
  /** contexto do executor de ações (definir / executar / navegar) */
  cx: ContextoAcoes
  destroi(): void
}

const tem = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k)

/** Chaves de mudança entre dois stores (por referência). `estado`, `status` e `erros` geram a chave-curinga e uma por campo. */
export function chavesMudadas(a: Store, b: Store, programa: Programa): Set<string> {
  const m = new Set<string>()
  for (const g of ['estado', 'status', 'erros'] as const) {
    if (a[g] === b[g]) continue
    m.add(g)
    const x = a[g] as Record<string, unknown>, y = b[g] as Record<string, unknown>
    for (const k of new Set([...Object.keys(x), ...Object.keys(y)])) if (tem(x, k) !== tem(y, k) || x[k] !== y[k]) m.add(`${g}.${k}`)
  }
  for (const k of Object.keys(programa.pagina.dados)) if (tem(a.dados, k) !== tem(b.dados, k) || a.dados[k] !== b.dados[k]) m.add(k)
  return m
}

function acoesDe(lista: IRAcao[], out: Set<string>): void {
  for (const a of lista) {
    if (a.acao === 'definir') out.add(`estado.${a.estado}`)
    else if (a.acao === 'executar') { out.add(a.dados); out.add(`status.${a.dados}`); out.add(`erros.${a.dados}`); acoesDe(a.depois, out); acoesDe(a.emErro, out) }
  }
}

/** Análise estática: tudo o que a página PODE mudar (ações declaradas + dados em streaming). O resto é constante. */
export function chavesMutaveis(programa: Programa): Set<string> {
  const out = new Set<string>()
  for (const [nome, d] of Object.entries(programa.pagina.dados)) if (d.stream) { out.add(nome); out.add(`status.${nome}`); out.add(`erros.${nome}`) }
  const vistos = new WeakSet<IRNo>()
  const anda = (no: IRNo) => {
    if (vistos.has(no)) return
    vistos.add(no)
    if (no.tipo !== 'elemento') return
    for (const lista of Object.values(no.eventos ?? {})) acoesDe(lista, out)
    for (const l of Object.values(no.slots)) for (const f of l) anda(f)
    if (no.esqueleto) anda(no.esqueleto)
  }
  anda(programa.pagina.raiz)
  for (const m of Object.values(programa.blocos)) anda(m.modelo)
  return out
}

export function criaModelo(o: OpcoesModelo): Modelo {
  const programa = o.programa
  const store = { atual: iniciaStore(programa, o) }
  let ultima = store.atual
  const base = { params: o.params ?? {}, consulta: o.consulta ?? {}, tenant: o.tenant ?? {}, idioma: o.idioma ?? '' }
  const escopo = escopoDaStore(programa, store.atual, base)
  const mutaveis = o.fechado ? chavesMutaveis(programa) : null
  const espelhos = new Set<Espelho>()
  const hist: Mudanca[] = []
  let pendentes: AcaoStore[] = []
  let agendado = false
  const vivo = { atual: true }

  const flush = () => {
    agendado = false
    if (!vivo.atual) return
    const depois = store.atual
    if (depois === ultima) { pendentes = []; return }
    const antes = ultima
    const mudou = chavesMudadas(antes, depois, programa)
    ultima = depois
    escopo.estado = depois.estado; escopo.status = depois.status; escopo.erros = depois.erros
    for (const k of Object.keys(programa.pagina.dados)) { if (tem(depois.dados, k)) escopo[k] = depois.dados[k]; else delete escopo[k] }
    const m: Mudanca = { acoes: pendentes, mudou, antes, depois }
    pendentes = []
    if (o.historico) { hist.push(m); if (hist.length > o.historico) hist.shift() }
    for (const e of [...espelhos]) e(m)
  }

  const cx: ContextoAcoes = {
    programa, store, sequencia: {}, vivo, funcoes: o.funcoes ?? FUNCOES_PADRAO,
    dispatch: (a) => { pendentes.push(a); if (!agendado) { agendado = true; queueMicrotask(flush) } },
    ...(o.carregador ? { carregador: o.carregador } : {}),
    ...(o.navegar ? { navegar: o.navegar } : {}),
    ...(o.onErro ? { onErro: o.onErro } : {}),
  }

  return {
    store: () => store.atual,
    escopo, mutaveis, cx, flush,
    despacha(a) {
      if (mutaveis) {
        const chave = a.t === 'estado' ? `estado.${a.nome}` : a.nome
        const ok = a.t === 'estado' ? mutaveis.has(chave) : mutaveis.has(a.nome) || mutaveis.has(`status.${a.nome}`)
        if (!ok) { o.onErro?.({ caminho: `/${a.nome}`, regra: 'acao', mensagem: `'${a.nome}' não é alterável nesta página (mundo fechado)` }); return }
      }
      store.atual = reduz(store.atual, a); pendentes.push(a); flush()
    },
    assina(e) { espelhos.add(e); return () => { espelhos.delete(e) } },
    historico: () => hist,
    destroi() { vivo.atual = false; espelhos.clear() },
  }
}
