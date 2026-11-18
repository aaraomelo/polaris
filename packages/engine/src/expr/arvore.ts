import { LIMITES_EXPR } from './tipos'

// Duas funções de "documento" que o Studio (e qualquer editor) precisa e que a linguagem não conseguia dizer sem recursão: percorrer uma árvore de instâncias e listar os campos de um JSON Schema.
// Puras e TOTAIS: entrada fora do esperado dá ausente, nunca erro; saída limitada por LIMITES_EXPR.lista; chaves perigosas nunca são seguidas.
const PROIBIDOS = new Set(['__proto__', 'constructor', 'prototype'])
const ehObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const proprio = (o: Record<string, unknown>, k: string) => Object.prototype.hasOwnProperty.call(o, k)

export type NoPercorrido = { caminho: Array<string | number>; no: Record<string, unknown>; nivel: number }
/** Todos os nós da árvore em pré-ordem. Os filhos de um nó estão em `no[chave]`: uma LISTA de nós, ou um objeto cujas chaves levam a listas de nós (slots). `caminho` é o do nó DENTRO do documento, pronto para `obter`/`com`/`sem`/`insere`. */
export function percorre(raiz: unknown, chave: unknown): NoPercorrido[] | undefined {
  if (!ehObj(raiz) || typeof chave !== 'string' || PROIBIDOS.has(chave)) return undefined
  const out: NoPercorrido[] = []
  let estourou = false
  const anda = (no: Record<string, unknown>, caminho: Array<string | number>, nivel: number): void => {
    if (estourou) return
    if (out.length >= LIMITES_EXPR.lista || nivel > LIMITES_EXPR.profundidade * 4) { estourou = true; return }
    out.push({ caminho, no, nivel })
    const f = proprio(no, chave) ? no[chave] : undefined
    if (Array.isArray(f)) f.forEach((x, i) => { if (ehObj(x)) anda(x, [...caminho, chave, i], nivel + 1) })
    else if (ehObj(f)) for (const k of Object.keys(f)) { if (PROIBIDOS.has(k)) continue; const l = f[k]; if (Array.isArray(l)) l.forEach((x, i) => { if (ehObj(x)) anda(x, [...caminho, chave, k, i], nivel + 1) }) }
  }
  anda(raiz, [], 0)
  return estourou ? undefined : out
}

/** acentuação que não dá para deduzir do nome da propriedade; o `title` do schema tem precedência */
const ROTULOS_PT: Record<string, string> = { nivel: 'Nível', descricao: 'Descrição', numero: 'Número', padrao: 'Padrão', acao: 'Ação', titulo: 'Título', conteudo: 'Conteúdo', endereco: 'Endereço', preco: 'Preço', codigo: 'Código', observacao: 'Observação', variacao: 'Variação', opcoes: 'Opções', espacamento: 'Espaçamento', rotulo: 'Rótulo', condicao: 'Condição', funcao: 'Função', secao: 'Seção', botao: 'Botão', imagem: 'Imagem', pagina: 'Página', usuario: 'Usuário' }
const rotuloDe = (nome: string): string => { if (proprio(ROTULOS_PT as never, nome)) return ROTULOS_PT[nome]!; const s = nome.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase(); return s.charAt(0).toUpperCase() + s.slice(1) }
const simples = (s: Record<string, unknown>): boolean => !(s.oneOf || s.anyOf || s.allOf || s.$ref || s.not || s.if || Array.isArray(s.type))

export type CampoDoSchema = { nome: string; caminho: string[]; rotulo: string; tipo: 'texto' | 'numero' | 'inteiro' | 'booleano' | 'escolha' | 'json'; obrigatorio: boolean; descricao?: string; padrao?: unknown; opcoes?: unknown[]; min?: number; max?: number; regex?: string }
/** Os campos de um JSON Schema de objeto, na ordem de declaração, com objetos aninhados ACHATADOS (caminho completo; rótulo `Pai › Filho`). O que o schema não descreve com simplicidade (oneOf, $ref, listas, tipos mistos…) vira `json`: nunca some. */
export function camposDoSchema(schema: unknown): CampoDoSchema[] | undefined {
  if (!ehObj(schema)) return undefined
  const out: CampoDoSchema[] = []
  const anda = (s: Record<string, unknown>, caminho: string[], rotulos: string[], prof: number): void => {
    const props = s.properties, req = new Set<unknown>(Array.isArray(s.required) ? s.required : [])
    if (!ehObj(props)) return
    for (const nome of Object.keys(props)) {
      if (PROIBIDOS.has(nome) || out.length >= LIMITES_EXPR.lista) continue
      const f = props[nome]; if (!ehObj(f)) continue
      const cam = [...caminho, nome], rot = [...rotulos, typeof f.title === 'string' && f.title ? f.title : rotuloDe(nome)]
      const base = { nome, caminho: cam, rotulo: rot.join(' › '), obrigatorio: req.has(nome), ...(typeof f.description === 'string' ? { descricao: f.description } : {}), ...(f.default !== undefined ? { padrao: f.default } : {}) }
      if (prof > 4 || !simples(f)) { out.push({ ...base, tipo: 'json' }); continue }
      if (Array.isArray(f.enum)) { out.push({ ...base, tipo: 'escolha', opcoes: f.enum.slice(0, 200) }); continue }
      if (f.const !== undefined) { out.push({ ...base, tipo: 'escolha', opcoes: [f.const] }); continue }
      switch (f.type) {
        case 'string': out.push({ ...base, tipo: 'texto', ...(typeof f.pattern === 'string' ? { regex: f.pattern } : {}) }); break
        case 'number': case 'integer': out.push({ ...base, tipo: f.type === 'integer' ? 'inteiro' : 'numero', ...(typeof f.minimum === 'number' ? { min: f.minimum } : {}), ...(typeof f.maximum === 'number' ? { max: f.maximum } : {}) }); break
        case 'boolean': out.push({ ...base, tipo: 'booleano' }); break
        case 'object': if (ehObj(f.properties)) anda(f, cam, rot, prof + 1); else out.push({ ...base, tipo: 'json' }); break
        default: out.push({ ...base, tipo: 'json' })
      }
    }
  }
  anda(schema, [], [], 0)
  return out
}
