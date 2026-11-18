import { criaAutenticadorJwt } from '@polaris/acesso'
import type { ConfigJwt } from './config'

export function autenticadorDe(j: ConfigJwt) {
  const base = { emissor: j.emissor, audiencia: j.audiencia }
  if ('jwksUrl' in j.chave) return criaAutenticadorJwt({ ...base, chave: { jwksUrl: new URL(j.chave.jwksUrl) } })
  if ('jwk' in j.chave) return criaAutenticadorJwt({ ...base, chave: { publica: j.chave.jwk as never } })
  return criaAutenticadorJwt({ ...base, chave: { segredo: j.chave.segredo } })
}
