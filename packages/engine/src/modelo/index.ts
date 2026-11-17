import { FUNCOES_PADRAO, type Escopo, type Funcoes } from '../expr/index'
import type { IRAcao, IRNo } from '../ir/tipos'
import type { Carregador, ContextoAcoes } from '../render/acoes'
import type { Programa } from '../render/programa'
import { escopoDaStore, iniciaStore, reduz, type AcaoStore, type SementeStore, type Store } from '../render/store'
import type { ErroRuntime } from '../render/tipos'
import { aplica, caminhosMudados, difere, inverso, type Patch } from '../estado/caminho'
import { chavesDeCaminhos } from '../vivo/dep'

// ---------------------------------------------------------------------------
// MODELO: o estado da página e as operações sobre ele. Não conhece DOM, HTML nem React.
//   - store imutável (compartilhamento estrutural): trocar uma parte não copia o resto;
//   - toda mudança é uma AcaoStore pura aplicada por `reduz`; o diff por referência dá as chaves que mudaram;
//   - os "espelhos" (DOM vivo, string do SSR, o React do oráculo…) apenas assinam as mudanças e se projetam;
//   - o histórico de mudanças (ação, chaves, antes/depois) fica disponível sem custo para depuração, undo e diff.
// ---------------------------------------------------------------------------

/** Uma mudança do store. `patches()` (preguiçoso e em cache) são os patches reversíveis entre `antes` e `depois`; os caminhos começam em 'estado' | 'dados' | 'status' | 'erros'. */
export type Mudanca = { acoes: AcaoStore[]; mudou: ReadonlySet<string>; antes: Store; depois: Store; patches(): Patch[] }
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
  /** desfaz a última mudança no ESTADO da página (dados e status vindos do servidor não são desfeitos); precisa de `historico` > 0. false se não há o que desfazer */
  desfaz(): boolean
  refaz(): boolean
  podeDesfazer(): boolean
  podeRefazer(): boolean
  /** contexto do executor de ações (definir / executar / navegar) */
  cx: ContextoAcoes
  destroi(): void
}

const tem = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k)

/**
 * Chaves de mudança entre dois stores: o diff por REFERÊNCIA do store imutável, em granularidade de caminho (`estado.itens.3.nome`).
 * Subárvores com a mesma referência não são visitadas: o custo é proporcional ao que mudou.
 */
export function chavesMudadas(a: Store, b: Store, programa: Programa): Set<string> {
  const m = new Set<string>()
  for (const g of ['estado', 'status', 'erros'] as const) if (a[g] !== b[g]) chavesDeCaminhos(g, caminhosMudados(a[g], b[g]), m)
  for (const k of Object.keys(programa.pagina.dados)) {
    const tinha = tem(a.dados, k), tem2 = tem(b.dados, k)
    if (tinha !== tem2) chavesDeCaminhos(k, [[]], m)
    else if (tinha && a.dados[k] !== b.dados[k]) chavesDeCaminhos(k, caminhosMudados(a.dados[k], b.dados[k]), m)
  }
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
  /** mudanças desfeitas (pilha do refazer); uma mudança nova a esvazia */
  const desfeitas: Array<{ m: Mudanca; patches: Patch[] }> = []
  /** mudanças do histórico que já foram desfeitas */
  const jaDesfeitas = new Set<Mudanca>()
  let emDesfazer = false
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
    let cache: Patch[] | undefined
    const m: Mudanca = { acoes: pendentes, mudou, antes, depois, patches: () => (cache ??= difere(antes, depois) ?? []) }
    pendentes = []
    if (o.historico && !emDesfazer) { hist.push(m); desfeitas.length = 0; if (hist.length > o.historico) hist.shift() }
    for (const e of [...espelhos]) e(m)
  }

  const cx: ContextoAcoes = {
    programa, store, sequencia: {}, vivo, funcoes: o.funcoes ?? FUNCOES_PADRAO,
    dispatch: (a) => { pendentes.push(a); if (!agendado) { agendado = true; queueMicrotask(flush) } },
    ...(o.carregador ? { carregador: o.carregador } : {}),
    ...(o.navegar ? { navegar: o.navegar } : {}),
    ...(o.onErro ? { onErro: o.onErro } : {}),
  }

  /** só os patches do ESTADO da página (o que o desfazer desfaz) */
  const patchesDoEstado = (m: Mudanca) => m.patches().filter((p) => p.caminho[0] === 'estado')
  /** aplica um store novo (vindo de desfazer/refazer) notificando os espelhos, sem gravar no histórico */
  const troca = (novo: Store) => { emDesfazer = true; try { store.atual = novo; flush() } finally { emDesfazer = false } }

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
    podeDesfazer: () => hist.some((m) => !jaDesfeitas.has(m) && patchesDoEstado(m).length > 0),
    podeRefazer: () => desfeitas.length > 0,
    desfaz() {
      flush()
      for (let i = hist.length - 1; i >= 0; i--) {
        const m = hist[i]!
        if (jaDesfeitas.has(m)) continue
        const ps = patchesDoEstado(m)
        if (ps.length === 0) continue
        const novo = aplica(store.atual, inverso(ps))
        if (novo === undefined) return false
        jaDesfeitas.add(m); desfeitas.push({ m, patches: ps })
        troca(novo as Store)
        return true
      }
      return false
    },
    refaz() {
      const d = desfeitas.pop()
      if (!d) return false
      const novo = aplica(store.atual, d.patches)
      if (novo === undefined) { desfeitas.push(d); return false }
      jaDesfeitas.delete(d.m)
      troca(novo as Store)
      return true
    },
    destroi() { vivo.atual = false; espelhos.clear() },
  }
}
