import type { Expr } from '../expr/index'

// ---------------------------------------------------------------------------
// IR (representação intermediária) de página e de bloco: árvore tipada, com bindings já
// analisados e blocos resolvidos. É a entrada do runtime (interpretador) e dos geradores (JIT/AOT).
// Cada nó guarda o `caminho` JSON de origem, para erros e sourcemap apontarem para o schema.
// ---------------------------------------------------------------------------

export type Binding = { ast: Expr; fonte: string }
export type Parte = string | Binding

export type Valor =
  | { t: 'lit'; v: string | number | boolean | null }
  | { t: 'expr'; ast: Expr; fonte: string }
  | { t: 'tpl'; partes: Parte[] }
  | { t: 'obj'; campos: Record<string, Valor> }
  | { t: 'arr'; itens: Valor[] }

export type ImplBloco = 'nativo' | 'composto' | 'codigo'

export type IRBloco = {
  interface: string
  /** interface → pai → avô… (resolvida com extends) */
  cadeia: string[]
  /** nativo: implementado pelo runtime; composto: tem `modelo` (outros blocos); codigo: escape hatch em sandbox */
  impl: ImplBloco
}

type Comum = { caminho: string; se?: Expr; repetir?: { cada: Expr; como: string } }

export type IRElemento = Comum & {
  tipo: 'elemento'
  id?: string
  bloco: IRBloco
  props: Record<string, Valor>
  slots: Record<string, IRNo[]>
}

/** `core/slot`: projeta, dentro do modelo de um bloco, os filhos que a instância recebeu naquele slot. */
export type IRSlot = Comum & { tipo: 'slot'; nome: string }

export type IRNo = IRElemento | IRSlot

export type IRPagina = {
  tipo: 'pagina'
  id: string
  versao: string
  rota: string
  titulo?: Valor
  /** nome da variável → id do nó `dados` */
  dados: Record<string, string>
  raiz: IRNo
  /** variáveis raiz realmente usadas pelos bindings (dependências de dados) */
  usa: string[]
}

export type IRBlocoModelo = {
  tipo: 'bloco'
  interface: string
  cadeia: string[]
  modelo: IRNo
  usa: string[]
}

/** Escopo-base de cada contexto de compilação. */
export const ESCOPO_PAGINA = ['params', 'consulta', 'tenant'] as const
export const ESCOPO_BLOCO = ['props', 'tenant'] as const
export const SLOT_NATIVO = 'core/slot'
