import type { CampoParametro } from '../ir/tipos'

// Validação e normalização dos argumentos de uma fonte de dados contra os `parametros` do nó `dados`.
// Compartilhado pelo compilador (literais) e pelo carregador (valores reais, em runtime).

const UUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/
const DATA = /^\d{4}-\d{2}-\d{2}$/

export type ResultadoValor = { ok: true; valor: unknown } | { ok: false; esperado: string }

const descreve = (c: Pick<CampoParametro, 'tipo' | 'lista'>) => (c.lista ? `lista de ${c.tipo}` : c.tipo)

function escalar(tipo: string, v: unknown): ResultadoValor {
  switch (tipo) {
    case 'texto': return typeof v === 'string' ? { ok: true, valor: v } : { ok: false, esperado: 'texto' }
    case 'inteiro':
    case 'decimal':
    case 'dinheiro': {
      // aceita texto numérico (parâmetros de URL chegam como texto) e normaliza
      const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v
      if (typeof n !== 'number' || !Number.isFinite(n)) return { ok: false, esperado: tipo }
      if (tipo === 'inteiro' && !Number.isInteger(n)) return { ok: false, esperado: 'inteiro' }
      return { ok: true, valor: n }
    }
    case 'booleano':
      if (typeof v === 'boolean') return { ok: true, valor: v }
      if (v === 'true' || v === 'false') return { ok: true, valor: v === 'true' }
      return { ok: false, esperado: 'booleano' }
    case 'data': return typeof v === 'string' && DATA.test(v) && !Number.isNaN(Date.parse(v)) ? { ok: true, valor: v } : { ok: false, esperado: 'data (AAAA-MM-DD)' }
    case 'dataHora': return typeof v === 'string' && v.length <= 40 && /^\d{4}-\d{2}-\d{2}T/.test(v) && !Number.isNaN(Date.parse(v)) ? { ok: true, valor: v } : { ok: false, esperado: 'data e hora ISO' }
    case 'uuid': return typeof v === 'string' && UUID.test(v) ? { ok: true, valor: v } : { ok: false, esperado: 'uuid' }
    case 'json': return { ok: true, valor: v }
    default: return { ok: false, esperado: tipo }
  }
}

/** Valida (e normaliza) um valor contra o campo. */
export function confereValor(c: Pick<CampoParametro, 'tipo' | 'lista'>, v: unknown): ResultadoValor {
  if (c.lista && c.tipo !== 'json') {
    if (!Array.isArray(v)) return { ok: false, esperado: descreve(c) }
    const itens: unknown[] = []
    for (const x of v) {
      const r = escalar(c.tipo, x)
      if (!r.ok) return { ok: false, esperado: descreve(c) }
      itens.push(r.valor)
    }
    return { ok: true, valor: itens }
  }
  return escalar(c.tipo, v)
}

export type ErroArg = { arg: string; mensagem: string }
export type ResultadoArgs = { ok: true; args: Record<string, unknown> } | { ok: false; erros: ErroArg[] }

const ausente = (v: unknown) => v === null || v === undefined

/** Resolve os argumentos finais: nomes desconhecidos são erro, `padrao` preenche faltas, obrigatórios e tipos são conferidos. */
export function resolveArgs(parametros: Record<string, CampoParametro>, brutos: Record<string, unknown>): ResultadoArgs {
  const erros: ErroArg[] = []
  const args: Record<string, unknown> = {}
  for (const nome of Object.keys(brutos)) {
    if (!Object.prototype.hasOwnProperty.call(parametros, nome)) erros.push({ arg: nome, mensagem: `argumento '${nome}' não é um parâmetro desta fonte` })
  }
  for (const [nome, campo] of Object.entries(parametros)) {
    let v = Object.prototype.hasOwnProperty.call(brutos, nome) ? brutos[nome] : undefined
    if (ausente(v) && campo.padrao !== undefined) v = campo.padrao
    if (ausente(v)) {
      if (campo.obrigatorio) erros.push({ arg: nome, mensagem: `o argumento obrigatório '${nome}' não foi informado` })
      continue
    }
    const r = confereValor(campo, v)
    if (r.ok) args[nome] = r.valor
    else erros.push({ arg: nome, mensagem: `o argumento '${nome}' deveria ser ${descreve(campo)}` })
  }
  return erros.length ? { ok: false, erros } : { ok: true, args }
}
