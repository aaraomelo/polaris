import type { Escopo } from '../expr/avalia'
import { funcoesPadrao } from '../expr/padrao'
import type { Funcoes } from '../expr/tipos'
import type { IRAcao, IRNo } from '../ir/tipos'
import type { Carregador, ContextoAcoes } from '../render/acoes'
import type { Programa } from '../render/programa'
import { escopoDaStore, iniciaStore, reduz, type AcaoStore, type SementeStore, type Store } from '../render/store'
import type { ErroRuntime } from '../render/tipos'
import { caminhosMudados } from '../estado/caminho'
import { chavesDeCaminhos } from '../vivo/dep'

// ---------------------------------------------------------------------------
// MODELO: o estado da página e as operações sobre ele. Não conhece DOM, HTML nem React.
//   - store imutável (compartilhamento estrutural): trocar uma parte não copia o resto;
//   - toda mudança é uma AcaoStore pura aplicada por `reduz`; o diff por referência dá as chaves que mudaram;
//   - os "espelhos" (DOM vivo, string do SSR, o React do oráculo…) apenas assinam as mudanças e se projetam;
//   - histórico, desfazer/refazer e patches são um PLUGIN opcional (historico.ts): o núcleo do cliente não paga por eles.
// ---------------------------------------------------------------------------

/** Uma mudança do store: as ações, as chaves (caminhos) que mudaram e o store antes/depois. */
export type Mudanca = { acoes: AcaoStore[]; mudou: ReadonlySet<string>; antes: Store; depois: Store }
export type Espelho = (m: Mudanca) => void

export type OpcoesNucleo = SementeStore & {
  programa: Programa
  params?: Record<string, unknown>
  consulta?: Record<string, unknown>
  tenant?: Record<string, unknown>
  idioma?: string
  carregador?: Carregador
  navegar?: (url: string) => void
  onErro?: (e: ErroRuntime) => void
  funcoes?: Funcoes
  /** mundo fechado: só as chaves que a página declara poder mudar aceitam `despacha` externo (habilita a poda de nós estáticos) */
  fechado?: boolean
}

export type ModeloNucleo = {
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
  /** troca o store inteiro (desfazer/refazer do plugin de histórico) notificando os espelhos */
  substitui(novo: Store): void
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
  for (const [nome, d] of Object.entries(programa.pagina.estado)) if (d.persiste || d.daConsulta) out.add(`estado.${nome}`) // o valor guardado no navegador entra depois da hidratação, mesmo que nenhuma ação desta página o escreva
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

export function criaModeloNucleo(o: OpcoesNucleo): ModeloNucleo {
  const programa = o.programa
  const store = { atual: iniciaStore(programa, o) }
  let ultima = store.atual
  const base = { params: o.params ?? {}, consulta: o.consulta ?? {}, tenant: o.tenant ?? {}, idioma: o.idioma ?? '' }
  const escopo = escopoDaStore(programa, store.atual, base)
  const mutaveis = o.fechado ? chavesMutaveis(programa) : null
  const espelhos = new Set<Espelho>()
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
    for (const e of [...espelhos]) e(m)
  }

  const cx: ContextoAcoes = {
    programa, store, sequencia: {}, vivo, funcoes: o.funcoes ?? funcoesPadrao(),
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
    substitui(novo) { store.atual = novo; flush() },
    destroi() { vivo.atual = false; espelhos.clear() },
  }
}
