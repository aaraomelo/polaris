// Redação de dados sensíveis ANTES de qualquer saída (log, atributo de span). Duas camadas: pelo NOME da chave e pelo FORMATO do valor.
// Regra de ouro: corpo de requisição e cabeçalhos nunca são registrados; isto é a rede de segurança para o que escapar.

const CHAVE_SENSIVEL = /(senha|password|passwd|secret|segredo|token|authorization|cookie|api[-_]?key|chave|credential|credencial|jwt|bearer|assinatura|signature|cvv|cartao|card[-_]?number)/i
const JWT = /\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]*/g
const BEARER = /\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]{6,}/gi
const USERINFO = /(\w+:\/\/)[^\s/@:]+:[^\s/@]+@/g
export const REDIGIDO = '[REDIGIDO]'
const MAX_TEXTO = 2000, MAX_PROFUNDIDADE = 6, MAX_ITENS = 50

/** Mascara segredos que aparecem DENTRO de um texto (JWT, Bearer/Basic, usuário:senha em URL) e limita o tamanho. */
export function redigeTexto(s: string): string {
  let t = s.replace(JWT, '[JWT]').replace(BEARER, '$1 [REDIGIDO]').replace(USERINFO, '$1[REDIGIDO]@')
  if (t.length > MAX_TEXTO) t = `${t.slice(0, MAX_TEXTO)}…[+${t.length - MAX_TEXTO}]`
  return t
}

export function serializaErro(e: unknown, profundidade = 0): Record<string, unknown> {
  if (!(e instanceof Error)) return { mensagem: redigeTexto(String(e)) }
  const out: Record<string, unknown> = { nome: e.name, mensagem: redigeTexto(e.message) }
  const codigo = (e as { code?: unknown }).code
  if (typeof codigo === 'string' || typeof codigo === 'number') out.codigo = codigo
  if (e.stack) out.stack = redigeTexto(e.stack.split('\n').slice(0, 12).join('\n'))
  if (e.cause !== undefined && profundidade < 3) out.causa = serializaErro(e.cause, profundidade + 1)
  return out
}

/** Copia segura e serializável: sem ciclos, sem funções, com chaves sensíveis mascaradas, limitada em profundidade e tamanho. */
export function redige(v: unknown, vistos = new WeakSet<object>(), prof = 0): unknown {
  if (v === null || v === undefined) return v
  if (typeof v === 'string') return redigeTexto(v)
  if (typeof v === 'number') return Number.isFinite(v) ? v : String(v)
  if (typeof v === 'boolean') return v
  if (typeof v === 'bigint') return v.toString()
  if (typeof v === 'function' || typeof v === 'symbol') return `[${typeof v === 'function' ? 'função' : 'símbolo'}]`
  if (v instanceof Error) return serializaErro(v)
  if (v instanceof Date) return Number.isNaN(v.getTime()) ? 'data inválida' : v.toISOString()
  if (v instanceof Uint8Array) return `[bytes ${v.byteLength}]`
  if (typeof v !== 'object') return String(v)
  if (vistos.has(v)) return '[circular]'
  if (prof >= MAX_PROFUNDIDADE) return '[profundo demais]'
  vistos.add(v)
  if (Array.isArray(v)) { const out = v.slice(0, MAX_ITENS).map((x) => redige(x, vistos, prof + 1)); if (v.length > MAX_ITENS) out.push(`[+${v.length - MAX_ITENS} itens]`); return out }
  const out: Record<string, unknown> = {}
  const chaves = Object.keys(v)
  for (const k of chaves.slice(0, MAX_ITENS * 2)) out[k] = CHAVE_SENSIVEL.test(k) ? REDIGIDO : redige((v as Record<string, unknown>)[k], vistos, prof + 1)
  if (chaves.length > MAX_ITENS * 2) out['…'] = `[+${chaves.length - MAX_ITENS * 2} chaves]`
  return out
}
export const chaveSensivel = (k: string) => CHAVE_SENSIVEL.test(k)
