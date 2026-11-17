import Ajv2020 from 'ajv/dist/2020.js'
import type { ValidateFunction } from 'ajv'
import { traduzTodos, type Erro } from './mensagens'

// ---------------------------------------------------------------------------
// Validação das `props` de uma instância contra o JSON Schema de props do bloco resolvido.
//  - Um valor de texto com binding "{caminho | fmt}" é aceito em qualquer propriedade (resolvido em runtime).
//  - Por padrão props desconhecidas são erro (quase sempre typo); o bloco pode liberar com additionalProperties: true.
// ---------------------------------------------------------------------------

type Schema = Record<string, any>
const BINDING = '\\{[^}]+\\}'

/** Em propriedades não-texto, aceita também uma string que contenha um binding. */
function permiteBinding(s: Schema): Schema {
  if (!s || typeof s !== 'object') return s
  const copia: Schema = { ...s }
  if (copia.properties) copia.properties = Object.fromEntries(Object.entries<Schema>(copia.properties).map(([k, v]) => [k, permiteBinding(v)]))
  if (copia.items) copia.items = permiteBinding(copia.items)
  const tipos = copia.type === undefined ? [] : Array.isArray(copia.type) ? copia.type : [copia.type]
  const soTexto = tipos.length === 1 && tipos[0] === 'string'
  if (!soTexto && tipos.length > 0) {
    return { anyOf: [copia, { type: 'string', pattern: BINDING }] }
  }
  return copia
}

const ajv = new Ajv2020({ strict: false, allErrors: true, allowUnionTypes: true, verbose: true })
const cache = new WeakMap<object, ValidateFunction>()

function compila(props: Schema): ValidateFunction {
  let v = cache.get(props)
  if (v) return v
  const raiz: Schema = { ...props, properties: Object.fromEntries(Object.entries<Schema>(props.properties ?? {}).map(([k, p]) => [k, permiteBinding(p)])) }
  if (raiz.additionalProperties === undefined) raiz.additionalProperties = false
  v = ajv.compile(raiz)
  cache.set(props, v)
  return v
}

/** Erros de props da instância; `base` é o caminho JSON da instância (ex.: /spec/raiz). */
export function validaProps(props: unknown, esquemaProps: Schema | undefined, base: string): Erro[] {
  if (!esquemaProps) return []
  const v = compila(esquemaProps)
  const alvo = props ?? {}
  if (v(alvo)) return []
  // O anyOf que acrescentamos (aceitar binding) não deve virar ruído: fica só o erro do schema original.
  const brutos = v.errors ?? []
  const envoltorios = brutos
    .filter((e) => e.keyword === 'anyOf' && (e.schema as Schema[] | undefined)?.[1]?.pattern === BINDING)
    .map((e) => e.schemaPath)
  const limpos = brutos.filter((e) => !envoltorios.some((p) => e.schemaPath === p || e.schemaPath.startsWith(`${p}/1/`)))
  return traduzTodos(limpos, `${base}/props`).map((e) => ({ ...e, regra: 'props' }))
}
