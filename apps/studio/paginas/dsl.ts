// Ajudantes para ESCREVER nós da plataforma sem repetição. A saída é JSON puro (o que o schema valida): o DSL não tem semântica própria, só encurta a digitação.
export type Inst = { bloco: string; id?: string; props?: Record<string, unknown>; slots?: Record<string, Inst[]>; se?: string; repetir?: { cada: string; como: string; chave?: string }; eventos?: Record<string, Acao[]> }
export type Acao = { acao: 'definir'; estado: string; valor: string } | { acao: 'executar'; dados: string; args?: Record<string, unknown>; depois?: Acao[]; emErro?: Acao[] } | { acao: 'navegar'; para: string }

export const no = (kind: string, id: string, spec: object, extra: object = {}) => ({ kind, id, versao: '1.0.0', estatuto: 'publicado', ...extra, spec })
type Op = Omit<Inst, 'bloco' | 'slots'> & { filhos?: Inst[]; slots?: Record<string, Inst[]> }
export const P = (bloco: string, { filhos, slots, ...o }: Op = {}): Inst => ({ bloco, ...o, ...(filhos ? { slots: { filhos, ...slots } } : slots ? { slots } : {}) })
export const def = (estado: string, valor: string): Acao => ({ acao: 'definir', estado, valor })
export const exe = (dados: string, args?: Record<string, unknown>, depois?: Acao[], emErro?: Acao[]): Acao => ({ acao: 'executar', dados, ...(args ? { args } : {}), ...(depois ? { depois } : {}), ...(emErro ? { emErro } : {}) })
/** literal de texto numa expressão */
export const q = (s: string) => JSON.stringify(s)

// blocos usados com frequência
export const pilha = (filhos: Inst[], o: Omit<Op, 'filhos'> & { gap?: number } = {}) => { const { gap, ...r } = o; return P('layout/pilha', { ...r, props: { gap: gap ?? 8, ...(r.props ?? {}) }, filhos }) }
export const linha = (filhos: Inst[], o: Omit<Op, 'filhos'> & { gap?: number } = {}) => { const { gap, ...r } = o; return P('layout/linha', { ...r, props: { gap: gap ?? 8, alinha: 'centro', ...(r.props ?? {}) }, filhos }) }
export const texto = (t: string, o: Op = {}) => P('texto/paragrafo', { ...o, props: { texto: t, ...(o.props ?? {}) } })
export const titulo = (t: string, nivel = 2, o: Op = {}) => P('texto/titulo', { ...o, props: { texto: t, nivel, ...(o.props ?? {}) } })
export const botao = (t: string, eventos: Acao[], o: Op = {}) => P('nav/botao', { ...o, props: { texto: t, ...(o.props ?? {}) }, eventos: { aoClicar: eventos } })
