import type { ErrorObject } from 'ajv'

// ---------------------------------------------------------------------------
// Erros acionáveis: tradução das falhas do Ajv para pt-BR, com o que fazer para corrigir.
// Cada erro traz: caminho JSON, mensagem, regra (keyword) e, quando possível, dica e valor recebido.
// ---------------------------------------------------------------------------

export type Erro = { caminho: string; mensagem: string; regra: string; dica?: string; valor?: unknown }

import { sugere } from './sugere'
export { sugere }

const PADROES: Array<[RegExp, string]> = [
  [/a-z0-9\]\[a-z0-9\._-\]\{0,127\}/, "use minúsculas, números, '.', '_' e '-', começando por letra ou número (ex.: tema.base)"],
  [/\\d\+\\\.\\d\+\\\.\\d\+/, "use MAJOR.MINOR.PATCH (ex.: 1.0.0)"],
  [/^\^\//, "deve começar com '/' (ex.: /produtos)"],
  [/a-z0-9\]\(\?:\[a-z0-9-\]/, "use minúsculas, números e '-', sem '-' nas pontas (ex.: padaria-sol)"],
  [/a-z\]\+\(\\\.\[a-z\]\+\)\+/, "use nomes em minúsculas separados por ponto (ex.: pedido.criado)"],
  [/\^\[A-Za-z0-9\]\[A-Za-z0-9_-\]\*\$/, "use letras, números, '_' e '-', começando por letra ou número (ex.: primaria, 1)"],
  [/formularios\|\(rede\|imagens\)/, "use 'formularios', 'rede:https://origem' ou 'imagens:https://origem': só https, sem curinga (*) e sem caminho"],
  [/\(\\\.\[a-z\]\[A-Za-z0-9\]\*\)\*/, "use nomes em camelCase separados por ponto (ex.: produto.ler, pedido.cancelar)"],
  [/\{2,3\}\(-\[A-Z\]\{2\}\)/, "use o código do idioma: pt, en ou com região, como pt-BR"],
  [/a-z\]\[A-Za-z0-9\]\*/, "use camelCase começando por minúscula (ex.: precoUnitario)"],
  [/a-z0-9\._-\]\*\(\/\[a-z0-9\._-\]\+\)\*/, "use o formato grupo/nome em minúsculas (ex.: commerce/vitrine)"],
]

const tipoDe = (v: unknown) => (v === null ? 'null' : Array.isArray(v) ? 'lista' : typeof v === 'object' ? 'objeto' : typeof v === 'string' ? 'texto' : typeof v === 'number' ? 'número' : typeof v === 'boolean' ? 'booleano' : typeof v)
const lista = (xs: readonly unknown[]) => xs.map((x) => (typeof x === 'string' ? `'${x}'` : JSON.stringify(x))).join(', ')
const nomeTipo = (t: unknown) => (Array.isArray(t) ? t : [t]).map((x) => ({ string: 'texto', number: 'número', integer: 'inteiro', boolean: 'booleano', object: 'objeto', array: 'lista', null: 'null' } as Record<string, string>)[String(x)] ?? String(x)).join(' ou ')

/** Campos conhecidos do objeto onde o erro ocorreu (para sugerir o nome certo). */
function camposConhecidos(e: ErrorObject): string[] {
  const ps = e.parentSchema as { properties?: Record<string, unknown> } | undefined
  return ps?.properties ? Object.keys(ps.properties) : []
}

export function traduz(e: ErrorObject, base = ''): Erro | null {
  if (e.keyword === 'if') return null
  // erro de nome de chave (propertyNames): o caminho é o da chave, não o do objeto
  const daChave = e.schemaPath.includes('/propertyNames/') && typeof e.data === 'string'
  const caminho = base + (e.instancePath || '') + (daChave ? `/${e.data}` : '') || '/'
  const p = e.params as Record<string, any>
  const out = (mensagem: string, dica?: string): Erro => ({ caminho, mensagem, regra: e.keyword, ...(dica ? { dica } : {}), ...(e.data !== undefined ? { valor: e.data } : {}) })

  switch (e.keyword) {
    case 'required':
      return { caminho, regra: 'required', mensagem: `falta o campo obrigatório '${p.missingProperty}'`, dica: `adicione "${p.missingProperty}" ${caminho === '/' ? 'na raiz do nó' : `em ${caminho}`}` }
    case 'additionalProperties':
    case 'unevaluatedProperties': {
      const campo = String(p.additionalProperty ?? p.unevaluatedProperty)
      const conhecidos = camposConhecidos(e)
      const s = sugere(campo, conhecidos)
      const dica = s ? `quis dizer '${s}'?` : conhecidos.length ? `campos válidos: ${conhecidos.join(', ')}` : 'remova o campo'
      return { caminho: `${caminho === '/' ? '' : caminho}/${campo}`, regra: e.keyword, mensagem: `o campo '${campo}' não existe aqui`, dica }
    }
    case 'enum': {
      const opcoes = p.allowedValues as unknown[]
      const s = typeof e.data === 'string' ? sugere(e.data, opcoes.filter((o): o is string => typeof o === 'string')) : null
      return out(`valor ${JSON.stringify(e.data)} não é permitido; aceitos: ${lista(opcoes)}`, s ? `quis dizer '${s}'?` : undefined)
    }
    case 'const':
      return out(`deve ser exatamente ${JSON.stringify(p.allowedValue)}`)
    case 'type':
      return out(`esperado ${nomeTipo(p.type)}, recebido ${tipoDe(e.data)}`)
    case 'pattern': {
      const dica = PADROES.find(([re]) => re.test(String(p.pattern)))?.[1]
      return out(`${JSON.stringify(e.data)} não segue o formato esperado`, dica ?? `deve casar com ${p.pattern}`)
    }
    case 'minItems':
      return out(`a lista precisa de pelo menos ${p.limit} item(ns)`)
    case 'minProperties':
      return out(`o objeto precisa de pelo menos ${p.limit} campo(s)`)
    case 'minLength':
      return out(`o texto precisa de pelo menos ${p.limit} caractere(s)`)
    case 'minimum':
      return out(`deve ser maior ou igual a ${p.limit}`)
    case 'uniqueItems':
      return out('a lista não pode ter itens repetidos', `os itens ${p.j} e ${p.i} são iguais`)
    case 'propertyNames':
      return out(`nome de campo inválido: ${JSON.stringify(p.propertyName)}`)
    case 'false schema': { // `propriedade: false` dentro de uma alternativa (oneOf): a combinação não é permitida
      const campo = (e.instancePath || '').split('/').filter(Boolean).pop() ?? 'campo'
      return out(`o campo '${campo}' não pode ser usado junto com os outros campos desta forma`, `escolha UMA das formas permitidas e remova o que sobra (aqui: '${campo}')`)
    }
    case 'oneOf':
    case 'anyOf':
      return out('não corresponde a nenhuma das formas permitidas', 'confira o campo que distingue a forma (op, acao…) e os campos exigidos por ela')
    case 'not': {
      // proibição condicional (`if … then/else: { not: { required: [x] } }`): diz QUAL campo não cabe, em vez da regra do tenant/segmento
      const req = (e.schema as { required?: string[] } | undefined)?.required
      if (req?.length === 1 && /\/(then|else)\/not$/.test(e.schema ? e.schemaPath : '')) return out(`o campo '${req[0]}' não é permitido aqui`, `remova "${req[0]}" ou mude o tipo do campo (só alguns tipos aceitam "${req[0]}")`)
      return out('combinação de campos não permitida', 'um nó tem escopo de tenant (tenantId) OU de segmento (segmento), nunca os dois')
    }
    default:
      return out(e.message ?? 'inválido')
  }
}

/** Traduz, remove ruído e deduplica (mesmo caminho + regra + mensagem). */
/**
 * oneOf/anyOf: o Ajv devolve os erros de TODOS os ramos, o que é ruído. Mantém só os do ramo que o usuário
 * provavelmente quis (o de menos erros) e descarta o invólucro; se esse ramo falha no discriminador
 * (const/enum), o usuário não escolheu nenhuma forma: fica só o invólucro, com a dica.
 */
function podaRamos(erros: readonly ErrorObject[]): ErrorObject[] {
  const fora = new Set<ErrorObject>()
  for (const w of erros.filter((e) => e.keyword === 'oneOf' || e.keyword === 'anyOf')) {
    const prefixo = `${w.schemaPath}/`
    const porRamo = new Map<number, ErrorObject[]>()
    for (const e of erros) {
      if (e === w || !e.schemaPath.startsWith(prefixo)) continue
      const i = Number(e.schemaPath.slice(prefixo.length).split('/')[0])
      porRamo.set(i, [...(porRamo.get(i) ?? []), e])
    }
    if (porRamo.size === 0) continue
    // ramo que o dado "tenta ser": sem erro de tipo (um objeto não é um ramo de texto), depois o de menos erros
    const pontos = (es: ErrorObject[]) => (es.some((e) => e.keyword === 'type' && e.instancePath === w.instancePath) ? 1000 : 0) + es.length
    const [melhor] = [...porRamo.entries()].sort((a, b) => pontos(a[1]) - pontos(b[1]) || a[0] - b[0])
    const todos = [...porRamo.values()].flat()
    const escolheuForma = !melhor![1].some((e) => e.keyword === 'const' || e.keyword === 'enum')
    if (escolheuForma) { fora.add(w); for (const e of todos) if (!melhor![1].includes(e)) fora.add(e) }
    else for (const e of todos) fora.add(e)
  }
  return erros.filter((e) => !fora.has(e))
}

export function traduzTodos(erros: readonly ErrorObject[], base = ''): Erro[] {
  erros = podaRamos(erros)
  const vistos = new Set<string>()
  const saida: Erro[] = []
  for (const e of erros) {
    // o 'propertyNames' é só o invólucro do erro real da chave
    if (e.keyword === 'propertyNames' && erros.some((o) => o !== e && o.schemaPath.startsWith(`${e.schemaPath}/`))) continue
    const t = traduz(e, base)
    if (!t) continue
    const k = `${t.caminho}|${t.regra}|${t.mensagem}`
    if (vistos.has(k)) continue
    vistos.add(k)
    saida.push(t)
  }
  return saida
}

/** Texto legível para terminal/log: uma linha por erro, com dica. */
export function formataErros(erros: readonly Erro[]): string {
  return erros.map((e) => `• ${e.caminho}: ${e.mensagem}${e.dica ? `\n    → ${e.dica}` : ''}`).join('\n')
}
