import { aplica, difere, inverso, type Patch } from '../estado/caminho'
import type { Store } from '../render/store'
import { criaModeloNucleo, type Mudanca as MudancaBase, type ModeloNucleo, type OpcoesNucleo } from './nucleo'

// ---------------------------------------------------------------------------
// HISTÓRICO (plugin do Modelo): anel das últimas N mudanças, patches reversíveis sob demanda e desfazer/refazer do ESTADO da página.
// Um cliente que não usa desfazer não importa este módulo (nem o diff/aplicação de patches): o bundle por página o descarta.
// ---------------------------------------------------------------------------

/** Uma mudança do histórico. `patches()` (preguiçoso e em cache): patches reversíveis entre `antes` e `depois`; os caminhos começam em 'estado' | 'dados' | 'status' | 'erros'. */
export type Mudanca = MudancaBase & { patches(): Patch[] }

export type Historico = {
  historico(): readonly Mudanca[]
  /** desfaz a última mudança no ESTADO da página (dados e status vindos do servidor não são desfeitos). false se não há o que desfazer */
  desfaz(): boolean
  refaz(): boolean
  podeDesfazer(): boolean
  podeRefazer(): boolean
}
export type Modelo = ModeloNucleo & Historico

/** Acrescenta ao modelo o histórico (até `max` mudanças; 0 = não grava, e desfazer não tem o que desfazer). Devolve o MESMO objeto. */
export function anexaHistorico(modelo: ModeloNucleo, max: number): Modelo {
  const hist: Mudanca[] = []
  /** mudanças desfeitas (pilha do refazer); uma mudança nova a esvazia */
  const desfeitas: Array<{ m: Mudanca; patches: Patch[] }> = []
  const jaDesfeitas = new Set<Mudanca>()
  let emDesfazer = false

  if (max > 0) {
    modelo.assina((b) => {
      if (emDesfazer) return
      let cache: Patch[] | undefined
      hist.push({ ...b, patches: () => (cache ??= difere(b.antes, b.depois) ?? []) })
      desfeitas.length = 0
      if (hist.length > max) hist.shift()
    })
  }
  /** só os patches do ESTADO da página (o que o desfazer desfaz) */
  const patchesDoEstado = (m: Mudanca) => m.patches().filter((p) => p.caminho[0] === 'estado')
  const troca = (novo: Store) => { emDesfazer = true; try { modelo.substitui(novo) } finally { emDesfazer = false } }

  return Object.assign(modelo, {
    historico: (): readonly Mudanca[] => hist,
    podeDesfazer: () => hist.some((m) => !jaDesfeitas.has(m) && patchesDoEstado(m).length > 0),
    podeRefazer: () => desfeitas.length > 0,
    desfaz() {
      modelo.flush()
      for (let i = hist.length - 1; i >= 0; i--) {
        const m = hist[i]!
        if (jaDesfeitas.has(m)) continue
        const ps = patchesDoEstado(m)
        if (ps.length === 0) continue
        const novo = aplica(modelo.store(), inverso(ps))
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
      const novo = aplica(modelo.store(), d.patches)
      if (novo === undefined) { desfeitas.push(d); return false }
      jaDesfeitas.delete(d.m)
      troca(novo as Store)
      return true
    },
  })
}

export type OpcoesModelo = OpcoesNucleo & {
  /** quantas mudanças guardar no histórico (0 = nenhuma) */
  historico?: number
}

/** Modelo completo: núcleo + histórico (servidor, testes, apps que usam desfazer). */
export function criaModelo(o: OpcoesModelo): Modelo {
  return anexaHistorico(criaModeloNucleo(o), o.historico ?? 0)
}
