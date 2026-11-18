import { criaIdentidade, type CustoSenha } from '@polaris/packs'
import type { PortaIdentidade } from '@polaris/gateway'
import { SignJWT, importJWK, type JWK } from 'jose'
import { autenticadorDe } from './auth'
import type { ConfigJwt } from './config'

type Q = (sql: string, params?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>>; rowCount: number }>
const ALG: Record<string, string> = { EC: 'ES256', OKP: 'EdDSA', RSA: 'RS256' }

/** a identidade do gateway: os usuários do diretório da plataforma + o JWT da sessão, assinado com a chave PRIVADA que só este processo tem (os serviços verificam com a pública). */
export function criaPortaIdentidade(o: { q: Q; jwt: ConfigJwt; chavePrivada: Record<string, unknown>; horas: number; custo?: CustoSenha }): { porta: PortaIdentidade; id: ReturnType<typeof criaIdentidade>; verifica(): Promise<void> } {
  const id = criaIdentidade({ q: o.q, ...(o.custo ? { custo: o.custo } : {}) })
  const alg = (typeof o.chavePrivada.alg === 'string' ? o.chavePrivada.alg : ALG[String(o.chavePrivada.kty)]) ?? 'ES256'
  const chave = importJWK(o.chavePrivada as JWK, alg)
  const emite: PortaIdentidade['emite'] = async (u) => new SignJWT({ tid: u.tenantId, papeis: u.papeis, nome: u.nome }).setProtectedHeader({ alg, ...(typeof o.chavePrivada.kid === 'string' ? { kid: o.chavePrivada.kid } : {}) })
    .setSubject(u.id).setIssuer(o.jwt.emissor).setAudience(o.jwt.audiencia).setIssuedAt().setExpirationTime(`${o.horas}h`).sign(await chave)
  const porta: PortaIdentidade = {
    entra: (a) => id.entra(a), pedeRedefinicao: (a) => id.pedeRedefinicao(a), redefine: (a) => id.redefine(a), emite,
    enviaEmail: (m) => id.enfileiraEmail(m),
  }
  /** na partida: o que este processo assina TEM de ser aceito pelo verificador configurado (a pública combina com a privada); senão a sessão nasceria morta */
  const verifica = async () => {
    const t = await emite({ id: 'autoteste', tenantId: '00000000-0000-0000-0000-000000000000', email: 'a@a.aa', nome: 'autoteste', papeis: [] })
    const r = await autenticadorDe(o.jwt)(`Bearer ${t}`)
    if (!r.ok) throw new Error(`a chave privada de identidade não combina com a chave pública configurada (${r.motivo})`)
  }
  return { porta, id, verifica }
}
