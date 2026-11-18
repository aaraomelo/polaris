import type { KeyObject } from 'node:crypto'
import { SignJWT, exportJWK, generateKeyPair } from 'jose'

type KeyLike = CryptoKey | KeyObject
import { beforeAll, describe, expect, it } from 'vitest'
import { criaAutenticadorJwt } from '../src/index'

const T = '11111111-1111-1111-1111-111111111111'
const ISS = 'https://id.exemplo.com', AUD = 'polaris-api'
const SEGREDO = 'um-segredo-bem-longo-com-mais-de-32-bytes!!'
const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url')
let priv: KeyLike, pub: KeyLike, jwkPub: Record<string, unknown>, outra: KeyLike

const assina = (claims: object = {}, opts: { alg?: string; key?: KeyLike | Uint8Array; iss?: string; aud?: string; exp?: string | number; nbf?: string | number; sem?: string[] } = {}) => {
  const j = new SignJWT({ tid: T, papeis: ['vendedor'], ...claims }).setProtectedHeader({ alg: opts.alg ?? 'RS256', kid: 'k1' }).setSubject('ana').setIssuedAt().setIssuer(opts.iss ?? ISS).setAudience(opts.aud ?? AUD).setExpirationTime(opts.exp ?? '5m')
  if (opts.nbf !== undefined) j.setNotBefore(opts.nbf)
  return j.sign(opts.key ?? priv)
}
const auth = () => criaAutenticadorJwt({ emissor: ISS, audiencia: AUD, chave: { publica: pub } })
const bearer = (t: string) => `Bearer ${t}`
const recusa = async (cab: string | undefined, trecho: string, a = auth()) => { const r = await a(cab); expect(r.ok, cab?.slice(0, 40)).toBe(false); expect((r as { motivo: string }).motivo).toContain(trecho) }

beforeAll(async () => {
  const k = await generateKeyPair('RS256', { extractable: true }); priv = k.privateKey; pub = k.publicKey; jwkPub = { ...(await exportJWK(pub)), kid: 'k1', alg: 'RS256', use: 'sig' }
  outra = (await generateKeyPair('RS256')).privateKey
})

describe('JWT: o que entra', () => {
  it('token válido → contexto { tenantId, usuario, papeis } (papéis sem repetição; tenant em minúsculas)', async () => {
    const r = await auth()(bearer(await assina({ papeis: ['vendedor', 'vendedor', 'caixa'], tid: T.toUpperCase() })))
    expect(r).toEqual({ ok: true, contexto: { tenantId: T, usuario: 'ana', papeis: ['vendedor', 'caixa'] } })
  })
  it('sem claim de papéis → lista vazia; nomes dos claims configuráveis', async () => {
    expect((await auth()(bearer(await assina({ papeis: undefined })))).ok).toBe(true)
    const a = criaAutenticadorJwt({ emissor: ISS, audiencia: AUD, chave: { publica: pub }, claims: { tenant: 'org', papeis: 'roles' } })
    expect(await a(bearer(await assina({ tid: undefined, org: T, roles: ['x'] })))).toMatchObject({ ok: true, contexto: { tenantId: T, papeis: ['x'] } })
  })
  it('JWKS local: escolhe a chave pelo kid; kid desconhecido é recusado', async () => {
    const a = criaAutenticadorJwt({ emissor: ISS, audiencia: AUD, chave: { jwks: { keys: [jwkPub as never] } } })
    expect((await a(bearer(await assina()))).ok).toBe(true)
    const t = await new SignJWT({ tid: T }).setProtectedHeader({ alg: 'RS256', kid: 'desconhecida' }).setSubject('x').setIssuer(ISS).setAudience(AUD).setExpirationTime('5m').sign(priv)
    expect((await a(bearer(t))).ok).toBe(false)
  })
  it('segredo HS256 funciona (com o segredo certo)', async () => {
    const a = criaAutenticadorJwt({ emissor: ISS, audiencia: AUD, chave: { segredo: SEGREDO } })
    const t = await assina({}, { alg: 'HS256', key: new TextEncoder().encode(SEGREDO) as never })
    expect((await a(bearer(t))).ok).toBe(true)
  })
})

describe('JWT: tokens FORJADOS e abusos (todos recusados)', () => {
  it('assinado por OUTRA chave, adulterado (payload trocado) ou truncado', async () => {
    await recusa(bearer(await assina({}, { key: outra })), 'recusado')
    const t = await assina(); const [h, , s] = t.split('.')
    await recusa(bearer(`${h}.${b64({ sub: 'admin', tid: T, iss: ISS, aud: AUD, exp: 9999999999 })}.${s}`), 'recusado')
    await recusa(bearer(t.slice(0, -5)), 'recusado')
  })
  it('alg "none" (sem assinatura) NUNCA passa', async () => {
    const forjado = `${b64({ alg: 'none', typ: 'JWT' })}.${b64({ sub: 'admin', tid: T, iss: ISS, aud: AUD, exp: 9999999999, papeis: ['admin'] })}.`
    await recusa(bearer(forjado), 'recusado')
    await recusa(bearer(`${b64({ alg: 'NONE' })}.${b64({ sub: 'a' })}.x`), 'recusado')
    expect(() => criaAutenticadorJwt({ emissor: ISS, audiencia: AUD, chave: { publica: pub }, algoritmos: ['none'] })).toThrow("'none' nunca")
  })
  it('CONFUSÃO DE ALGORITMO: HS256 assinado com a chave PÚBLICA (que todo mundo conhece) como segredo é recusado', async () => {
    const pem = JSON.stringify(jwkPub) // o atacante usa o que é público como segredo HMAC
    const forjado = await new SignJWT({ tid: T, papeis: ['admin'] }).setProtectedHeader({ alg: 'HS256' }).setSubject('admin').setIssuer(ISS).setAudience(AUD).setExpirationTime('5m').sign(new TextEncoder().encode(pem))
    await recusa(bearer(forjado), 'recusado')
    expect(() => criaAutenticadorJwt({ emissor: ISS, audiencia: AUD, chave: { publica: pub }, algoritmos: ['HS256'] })).toThrow('incompatíveis')
    expect(() => criaAutenticadorJwt({ emissor: ISS, audiencia: AUD, chave: { segredo: SEGREDO }, algoritmos: ['RS256'] })).toThrow('incompatíveis')
  })
  it('expirado, ainda não válido (nbf), sem exp, sem sub, emissor ou audiência errados', async () => {
    await recusa(bearer(await assina({}, { exp: Math.floor(Date.now() / 1000) - 60 })), 'recusado')
    await recusa(bearer(await assina({}, { nbf: Math.floor(Date.now() / 1000) + 3600 })), 'recusado')
    await recusa(bearer(await assina({}, { iss: 'https://falso.com' })), 'recusado'); await recusa(bearer(await assina({}, { aud: 'outra-api' })), 'recusado')
    const semExp = await new SignJWT({ tid: T }).setProtectedHeader({ alg: 'RS256' }).setSubject('ana').setIssuer(ISS).setAudience(AUD).sign(priv) // token eterno
    await recusa(bearer(semExp), 'recusado')
    const semSub = await new SignJWT({ tid: T }).setProtectedHeader({ alg: 'RS256' }).setIssuer(ISS).setAudience(AUD).setExpirationTime('5m').sign(priv)
    await recusa(bearer(semSub), 'recusado')
  })
  it('tenant: ausente, não-uuid, número, lista; papéis: não-lista, nome malformado, mais de 50', async () => {
    for (const tid of [undefined, 'acme', '123', 7, [T], '11111111-1111-1111-1111-11111111111']) await recusa(bearer(await assina({ tid })), "claim 'tid'")
    for (const papeis of ['admin', [1], ['../x'], ['a b'], [''], Array.from({ length: 51 }, (_, i) => `p${i}`), { a: 1 }]) await recusa(bearer(await assina({ papeis })), "claim 'papeis'")
  })
  it('cabeçalho: ausente, sem Bearer, esquema errado, token malformado, com espaço extra, lixo, token enorme', async () => {
    await recusa(undefined, 'sem cabeçalho'); await recusa('', 'malformado'); await recusa('Basic abc', 'malformado'); await recusa('Bearer', 'malformado'); await recusa('Bearer a.b', 'malformado')
    const t = await assina(); await recusa(`bearer ${t}`, 'malformado'); await recusa(`Bearer  ${t}`, 'malformado'); await recusa(`Bearer ${t} extra`, 'malformado'); await recusa('Bearer a.b.c\n', 'malformado')
    await recusa(`Bearer ${'a'.repeat(9000)}.b.c`, 'grande demais')
  })
  it('segredo curto demais é recusado na configuração', () => { expect(() => criaAutenticadorJwt({ emissor: ISS, audiencia: AUD, chave: { segredo: 'curto' } })).toThrow('32 bytes') })

  it('chave pública em JWK de EC (ES256) e OKP (EdDSA): o algoritmo vem da chave, não do primeiro da lista (que servia só a RSA)', async () => {
    for (const [alg, tipo] of [['ES256', 'EC'], ['EdDSA', 'OKP']] as const) {
      const kp = await generateKeyPair(alg, { extractable: true }), jwk = { ...(await exportJWK(kp.publicKey)), alg }
      const a = criaAutenticadorJwt({ emissor: ISS, audiencia: AUD, chave: { publica: jwk as never } })
      const t = await new SignJWT({ tid: T, papeis: ['x'] }).setProtectedHeader({ alg }).setSubject('u').setIssuer(ISS).setAudience(AUD).setExpirationTime('1h').sign(kp.privateKey)
      expect(await a(`Bearer ${t}`), tipo).toMatchObject({ ok: true, contexto: { tenantId: T, usuario: 'u' } })
      const outra = await generateKeyPair(alg, { extractable: true }), falso = await new SignJWT({ tid: T }).setProtectedHeader({ alg }).setSubject('u').setIssuer(ISS).setAudience(AUD).setExpirationTime('1h').sign(outra.privateKey)
      expect((await a(`Bearer ${falso}`)).ok, `${tipo}: assinatura de outra chave`).toBe(false)
    }
    const kp = await generateKeyPair('ES256', { extractable: true }), semAlg = await exportJWK(kp.publicKey) // sem `alg` no JWK: pela curva P-256 → ES256
    const a = criaAutenticadorJwt({ emissor: ISS, audiencia: AUD, chave: { publica: semAlg as never } }), t = await new SignJWT({ tid: T }).setProtectedHeader({ alg: 'ES256' }).setSubject('u').setIssuer(ISS).setAudience(AUD).setExpirationTime('1h').sign(kp.privateKey)
    expect((await a(`Bearer ${t}`)).ok).toBe(true)
  })
})
