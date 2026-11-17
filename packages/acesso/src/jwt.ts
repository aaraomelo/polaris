import { createLocalJWKSet, createRemoteJWKSet, importJWK, jwtVerify, type JWK, type JSONWebKeySet, type JWTVerifyGetKey, type KeyLike } from 'jose'

// Autenticação por JWT. Defesas (cada uma testada com um token forjado):
//  - o ALGORITMO sai de uma lista fixa que depende do TIPO de chave: segredo → só HS*; chave pública → só assimétricos. `alg: none` nunca; e um token HS256
//    assinado com a chave pública (confusão de algoritmo) é recusado porque HS não está na lista de quem tem chave pública;
//  - exp e sub obrigatórios; iss e aud conferidos; nbf respeitado; tolerância de relógio pequena;
//  - o tenant vem de um claim e TEM de ser um uuid; papéis têm de ser uma lista de nomes bem formados (limitada);
//  - tamanho máximo do token; cabeçalho Authorization exatamente `Bearer <token>`.
// Um token ruim é SEMPRE recusado (inclusive em rota pública): nunca cai em "anônimo" por engano.

export type ContextoAuth = { tenantId: string; usuario: string; papeis: string[] }
export type ResultadoAuth = { ok: true; contexto: ContextoAuth } | { ok: false; motivo: string }
export type OpcoesJwt = {
  emissor: string
  audiencia: string
  chave: { segredo: string | Uint8Array } | { publica: JWK | KeyLike } | { jwks: JSONWebKeySet } | { jwksUrl: URL }
  /** padrão: HS256 para segredo; RS256/PS256/ES256/EdDSA para chave pública ou JWKS */
  algoritmos?: string[]
  claims?: { tenant?: string; papeis?: string }
  /** segundos de tolerância de relógio (padrão 5) */
  tolerancia?: number
  /** tamanho máximo do token em bytes (padrão 8 KB) */
  maxBytes?: number
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const NOME_PAPEL = /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/
const ASSIMETRICOS = ['RS256', 'RS384', 'RS512', 'PS256', 'PS384', 'PS512', 'ES256', 'ES384', 'ES512', 'EdDSA']

export function criaAutenticadorJwt(o: OpcoesJwt): (cabecalho: string | undefined) => Promise<ResultadoAuth> {
  const claimTenant = o.claims?.tenant ?? 'tid', claimPapeis = o.claims?.papeis ?? 'papeis'
  const simetrica = 'segredo' in o.chave
  const algoritmos = o.algoritmos ?? (simetrica ? ['HS256'] : ASSIMETRICOS)
  if (algoritmos.some((a) => a.toLowerCase() === 'none')) throw new Error("o algoritmo 'none' nunca é permitido")
  if (simetrica ? algoritmos.some((a) => !a.startsWith('HS')) : algoritmos.some((a) => a.startsWith('HS'))) throw new Error('algoritmos incompatíveis com o tipo de chave (segredo → HS*; chave pública → assimétricos)')
  if (simetrica && (typeof (o.chave as { segredo: string | Uint8Array }).segredo === 'string' ? (o.chave as { segredo: string }).segredo.length : (o.chave as { segredo: Uint8Array }).segredo.length) < 32) throw new Error('o segredo HS deve ter ao menos 32 bytes')

  let chavePronta: Promise<KeyLike | Uint8Array | JWTVerifyGetKey>
  if ('segredo' in o.chave) chavePronta = Promise.resolve(typeof o.chave.segredo === 'string' ? new TextEncoder().encode(o.chave.segredo) : o.chave.segredo)
  else if ('publica' in o.chave) { const k = o.chave.publica; chavePronta = 'kty' in (k as object) ? importJWK(k as JWK, algoritmos[0]!) as Promise<KeyLike> : Promise.resolve(k as KeyLike) }
  else if ('jwks' in o.chave) chavePronta = Promise.resolve(createLocalJWKSet(o.chave.jwks))
  else chavePronta = Promise.resolve(createRemoteJWKSet(o.chave.jwksUrl))
  const max = o.maxBytes ?? 8192

  return async (cabecalho) => {
    if (typeof cabecalho !== 'string') return { ok: false, motivo: 'sem cabeçalho Authorization' }
    const m = /^Bearer ([A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]*)$/.exec(cabecalho)
    if (!m) return { ok: false, motivo: 'cabeçalho Authorization malformado (use "Bearer <jwt>")' }
    const token = m[1]!
    if (token.length > max) return { ok: false, motivo: 'token grande demais' }
    try {
      const chave = await chavePronta
      const { payload } = await jwtVerify(token, chave as never, { issuer: o.emissor, audience: o.audiencia, algorithms: algoritmos, clockTolerance: o.tolerancia ?? 5, requiredClaims: ['exp', 'sub'] })
      const tenant = payload[claimTenant], papeis = payload[claimPapeis]
      if (typeof payload.sub !== 'string' || !payload.sub) return { ok: false, motivo: 'sub inválido' }
      if (typeof tenant !== 'string' || !UUID.test(tenant)) return { ok: false, motivo: `claim '${claimTenant}' ausente ou não é um uuid` }
      if (papeis !== undefined && !(Array.isArray(papeis) && papeis.length <= 50 && papeis.every((p) => typeof p === 'string' && NOME_PAPEL.test(p)))) return { ok: false, motivo: `claim '${claimPapeis}' inválido` }
      return { ok: true, contexto: { tenantId: tenant.toLowerCase(), usuario: payload.sub, papeis: [...new Set((papeis as string[] | undefined) ?? [])] } }
    } catch (e) { return { ok: false, motivo: `token recusado: ${(e as { code?: string }).code ?? (e as Error).message}` } }
  }
}
