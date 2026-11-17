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

/** Ação executada em resposta a um evento. As expressões são avaliadas na hora do evento. */
export type IRAcao =
  | { acao: 'definir'; estado: string; valor: Expr; fonte: string; caminho: string }
  | { acao: 'executar'; dados: string; args: Record<string, Valor>; depois: IRAcao[]; emErro: IRAcao[]; caminho: string }
  | { acao: 'navegar'; para: Valor; caminho: string }

type Comum = { caminho: string; se?: Expr; repetir?: { cada: Expr; como: string } }

export type IRElemento = Comum & {
  tipo: 'elemento'
  id?: string
  bloco: IRBloco
  props: Record<string, Valor>
  slots: Record<string, IRNo[]>
  /** evento → ações (só em páginas) */
  eventos?: Record<string, IRAcao[]>
}

/** `core/slot`: projeta, dentro do modelo de um bloco, os filhos que a instância recebeu naquele slot. */
export type IRSlot = Comum & { tipo: 'slot'; nome: string }

export type IRNo = IRElemento | IRSlot

/** Uma variável de dados da página: qual fonte e com quais argumentos. */
export type IRDado = { id: string; args: Record<string, Valor> }

export type CampoParametro = { tipo: string; obrigatorio?: boolean; lista?: boolean; padrao?: unknown; descricao?: string }

/** Definição de uma fonte (nó `dados`), embutida no programa para o carregador não depender do registry. */
export type FonteDados = {
  id: string
  fonte: { tipo: 'servico' | 'estatico' | 'http'; servico?: string; operacao?: string; valor?: unknown; url?: string }
  parametros: Record<string, CampoParametro>
  cache?: { ttlSegundos?: number; chave?: string }
  carregar: 'auto' | 'manual'
  timeoutMs?: number
}

export type IREstado = Record<string, { tipo: string; inicial: unknown; lista?: boolean }>

export type IRPagina = {
  tipo: 'pagina'
  id: string
  versao: string
  rota: string
  titulo?: Valor
  /** nome da variável → fonte + argumentos */
  dados: Record<string, IRDado>
  /** id do nó dados → definição */
  fontes: Record<string, FonteDados>
  estado: IREstado
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
export const ESCOPO_PAGINA = ['params', 'consulta', 'tenant', 'estado', 'status', 'erros'] as const
/** Escopo dos argumentos de dados no carregamento (antes de existir qualquer dado ou status). */
export const ESCOPO_ARGS = ['params', 'consulta', 'tenant', 'estado'] as const
export const ESCOPO_BLOCO = ['props', 'tenant'] as const
export const SLOT_NATIVO = 'core/slot'
/** Nomes que `spec.dados` e `repetir.como` não podem usar (sombreariam valores do sistema). */
export const RESERVADOS = [...ESCOPO_PAGINA, 'indice', 'evento', 'resultado', 'erro', 'props'] as const
