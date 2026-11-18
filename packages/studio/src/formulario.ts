import { criaAjv, traduzTodos, type Erro } from '@polaris/schema'

// Formulário GERADO do JSON Schema das props de um bloco. O que o schema não descreve com simplicidade (oneOf, $ref, tipos mistos…) cai num campo `json` (texto JSON validado),
// nunca some. Valor de prop pode ser LITERAL, binding (`"{estado.nome}"`) ou `{ "$expr": … }`: binding não se valida contra o tipo (só existe em execução).
export type TipoCampo = 'texto' | 'numero' | 'inteiro' | 'booleano' | 'escolha' | 'objeto' | 'lista' | 'json'
export type Campo = {
  nome: string; caminho: string[]; tipo: TipoCampo; rotulo: string; obrigatorio: boolean
  descricao?: string; padrao?: unknown; opcoes?: unknown[]; min?: number; max?: number; formato?: string; regex?: string
  filhos?: Campo[]; item?: Campo
}
type S = Record<string, any>

/** acentuação que não dá para deduzir do nome da propriedade (o schema pode dar `title`, que tem precedência) */
const ROTULOS_PT: Record<string, string> = { nivel: 'Nível', descricao: 'Descrição', numero: 'Número', padrao: 'Padrão', acao: 'Ação', titulo: 'Título', conteudo: 'Conteúdo', endereco: 'Endereço', preco: 'Preço', codigo: 'Código', observacao: 'Observação', variacao: 'Variação', opcoes: 'Opções', quantidade: 'Quantidade', largura: 'Largura', altura: 'Altura', espacamento: 'Espaçamento', alinhamento: 'Alinhamento', rotulo: 'Rótulo', condicao: 'Condição', funcao: 'Função', secao: 'Seção', botao: 'Botão', imagem: 'Imagem', pagina: 'Página', usuario: 'Usuário', excecao: 'Exceção' }
const rotulo = (nome: string): string => {
  if (Object.hasOwn(ROTULOS_PT, nome)) return ROTULOS_PT[nome]!
  const s = nome.replace(/([a-z0-9])([A-Z])/g, '$1 $2').toLowerCase(); return s.charAt(0).toUpperCase() + s.slice(1) }
const simples = (s: S): boolean => !(s.oneOf || s.anyOf || s.allOf || s.$ref || s.not || s.if || Array.isArray(s.type))

function campoDe(nome: string, s: S, caminho: string[], obrigatorio: boolean, prof: number): Campo {
  const base = { nome, caminho, rotulo: typeof s.title === 'string' && s.title ? s.title : rotulo(nome), obrigatorio, ...(typeof s.description === 'string' ? { descricao: s.description } : {}), ...(s.default !== undefined ? { padrao: s.default } : {}) }
  if (prof > 4 || !simples(s)) return { ...base, tipo: 'json' }
  if (Array.isArray(s.enum)) return { ...base, tipo: 'escolha', opcoes: s.enum }
  if (s.const !== undefined) return { ...base, tipo: 'escolha', opcoes: [s.const] }
  switch (s.type) {
    case 'string': return { ...base, tipo: 'texto', ...(typeof s.format === 'string' ? { formato: s.format } : {}), ...(typeof s.pattern === 'string' ? { regex: s.pattern } : {}) }
    case 'number': case 'integer': return { ...base, tipo: s.type === 'integer' ? 'inteiro' : 'numero', ...(typeof s.minimum === 'number' ? { min: s.minimum } : {}), ...(typeof s.maximum === 'number' ? { max: s.maximum } : {}) }
    case 'boolean': return { ...base, tipo: 'booleano' }
    case 'object': return s.properties && typeof s.properties === 'object' ? { ...base, tipo: 'objeto', filhos: camposDe(s, caminho, prof + 1) } : { ...base, tipo: 'json' }
    case 'array': return s.items && simples(s.items) && typeof s.items === 'object' ? { ...base, tipo: 'lista', item: campoDe('item', s.items, [...caminho, '*'], false, prof + 1) } : { ...base, tipo: 'json' }
    default: return { ...base, tipo: 'json' }
  }
}
/** os campos de um schema de props (`type: object`), na ordem de declaração; obrigatórios marcados */
export function camposDe(schema: S, caminho: string[] = [], prof = 0): Campo[] {
  const req = new Set<string>(Array.isArray(schema.required) ? schema.required : [])
  return Object.entries((schema.properties ?? {}) as Record<string, S>).map(([nome, s]) => campoDe(nome, s, [...caminho, nome], req.has(nome), prof))
}

/** `"{x}"` com binding de verdade (chaves `\{` escapadas não contam) ou `{ $expr }` */
export const ehBinding = (v: unknown): boolean =>
  (typeof v === 'string' && /(^|[^\\])\{[^}]+\}/.test(v)) || (typeof v === 'object' && v !== null && !Array.isArray(v) && Object.keys(v).length === 1 && '$expr' in v)

export const leValor = (props: unknown, caminho: readonly string[]): unknown => {
  let cur: unknown = props
  for (const k of caminho) { if (cur === null || typeof cur !== 'object' || !Object.hasOwn(cur, k)) return undefined; cur = (cur as Record<string, unknown>)[k] }
  return cur
}
const PROIBIDOS = new Set(['__proto__', 'constructor', 'prototype'])
/** devolve NOVAS props com o valor trocado; `undefined` remove a chave e poda objetos que ficaram vazios. Não muta a entrada. */
export function defineValor(props: Record<string, unknown> | undefined, caminho: readonly string[], valor: unknown): Record<string, unknown> {
  if (!caminho.length || caminho.some((k) => PROIBIDOS.has(k))) throw new Error('caminho inválido')
  const aplica = (obj: unknown, i: number): unknown => {
    const atual = obj !== null && typeof obj === 'object' && !Array.isArray(obj) ? (obj as Record<string, unknown>) : {}
    const k = caminho[i]!, copia: Record<string, unknown> = { ...atual }
    if (i === caminho.length - 1) { if (valor === undefined) delete copia[k]; else copia[k] = valor }
    else { const filho = aplica(copia[k], i + 1); if (filho === undefined) delete copia[k]; else copia[k] = filho }
    return Object.keys(copia).length ? copia : undefined
  }
  return (aplica(props ?? {}, 0) as Record<string, unknown> | undefined) ?? {}
}

export type Conversao = { ok: true; valor: unknown } | { ok: false; erro: string }
/** do que o usuário digitou para o valor da prop. Vazio = remover (volta ao padrão). Binding passa direto. */
export function converte(c: Campo, entrada: string | boolean): Conversao {
  if (typeof entrada === 'boolean') return c.tipo === 'booleano' ? { ok: true, valor: entrada } : { ok: false, erro: 'esperava texto' }
  const t = entrada.trim()
  if (t === '') return { ok: true, valor: undefined }
  if (ehBinding(entrada) && c.tipo !== 'json') return { ok: true, valor: entrada }
  switch (c.tipo) {
    case 'texto': return { ok: true, valor: entrada }
    case 'numero': case 'inteiro': {
      const n = Number(t.replace(',', '.')); if (!Number.isFinite(n) || !/^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i.test(t.replace(',', '.'))) return { ok: false, erro: 'digite um número' }
      if (c.tipo === 'inteiro' && !Number.isInteger(n)) return { ok: false, erro: 'digite um número inteiro' }
      if (c.min !== undefined && n < c.min) return { ok: false, erro: `o mínimo é ${c.min}` }
      if (c.max !== undefined && n > c.max) return { ok: false, erro: `o máximo é ${c.max}` }
      return { ok: true, valor: n }
    }
    case 'escolha': { const o = (c.opcoes ?? []).find((x) => String(x) === t); return o === undefined ? { ok: false, erro: `escolha uma das opções: ${(c.opcoes ?? []).join(', ')}` } : { ok: true, valor: o } }
    case 'json': { try { return { ok: true, valor: JSON.parse(t) } } catch { return { ok: false, erro: 'JSON inválido' } } }
    default: return { ok: false, erro: 'campo composto: edite seus filhos' }
  }
}

export type ErroCampo = { caminho: string[]; mensagem: string; dica?: string }
const ajv = criaAjv({ verbose: true })
const cache = new WeakMap<object, ReturnType<typeof ajv.compile>>()
/** valida as props contra o schema do bloco; valores com binding ficam de fora (só valem em execução) e não geram "obrigatório" */
export function validaProps(schema: S, props: Record<string, unknown> | undefined): ErroCampo[] {
  let v = cache.get(schema); if (!v) { v = ajv.compile({ ...schema, $id: undefined } as object); cache.set(schema, v) }
  const comBinding = new Set<string>(); const limpo = tiraBindings(props ?? {}, [], comBinding)
  if (v(limpo)) return []
  return traduzTodos(v.errors ?? []).filter((e) => !(e.regra === 'required' && [...comBinding].some((b) => e.dica?.includes(`"${b}"`) || e.mensagem.includes(`'${b}'`)))).map(paraErroCampo)
}
function tiraBindings(v: unknown, caminho: string[], achados: Set<string>): unknown {
  if (ehBinding(v)) { achados.add(caminho[caminho.length - 1] ?? ''); return undefined }
  if (Array.isArray(v)) return v.map((x, i) => tiraBindings(x, [...caminho, String(i)], achados))
  if (v !== null && typeof v === 'object') { const o: Record<string, unknown> = {}; for (const [k, x] of Object.entries(v)) { const r = tiraBindings(x, [...caminho, k], achados); if (r !== undefined || !ehBinding(x)) o[k] = r }; return o }
  return v
}
const paraErroCampo = (e: Erro): ErroCampo => ({ caminho: e.caminho.split('/').filter(Boolean), mensagem: e.mensagem, ...(e.dica ? { dica: e.dica } : {}) })

/** props mínimas que fazem um bloco NOVO ser válido: os campos obrigatórios com um valor razoável (o schema manda: enum → primeira opção, número → mínimo, texto → o rótulo do campo) */
export function propsIniciais(schema: S | undefined): Record<string, unknown> {
  if (!schema) return {}
  let out: Record<string, unknown> = {}
  for (const c of camposDe(schema).filter((x) => x.obrigatorio)) {
    const v = c.padrao !== undefined ? c.padrao : c.tipo === 'texto' ? textoQueCasa(c) : c.tipo === 'numero' || c.tipo === 'inteiro' ? (c.min ?? 0) : c.tipo === 'booleano' ? false : c.tipo === 'escolha' ? c.opcoes?.[0] : c.tipo === 'lista' ? [] : c.tipo === 'objeto' ? {} : undefined
    if (v !== undefined) out = defineValor(out, c.caminho, v)
  }
  return out
}

function textoQueCasa(c: Campo): string {
  if (!c.regex) return c.rotulo
  let re: RegExp; try { re = new RegExp(c.regex) } catch { return c.rotulo }
  return [c.rotulo, c.rotulo.toLowerCase(), 'exemplo', 'a', 'a1', 'a-1'].find((t) => re.test(t)) ?? c.rotulo
}
