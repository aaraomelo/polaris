import { criaPool, dbTenantDePg, type DbTenant } from '@polaris/pg'
import { emite, type No, type Registry } from '@polaris/schema'
import pg from 'pg'

// O banco de verdade: cada arquivo de teste cria o SEU banco, com os papéis da produção (migrador com BYPASSRLS, app SEM, relay com), e fala por LOGIN (nada de SET ROLE).
export const URL_REAL = process.env.POLARIS_PG_REAL_URL
export const temPostgres = !!URL_REAL

const SENHA = 'teste-nao-e-segredo'
const com = (url: string, usuario: string, banco: string) => { const u = new URL(url); u.username = usuario; u.password = usuario === 'postgres' ? u.password : SENHA; u.pathname = `/${banco}`; return u.toString() }

export type Banco = {
  nome: string
  /** superusuário: só para inspecionar e para o que o teste precisa "fazer por fora" */
  admin: pg.Pool
  urlApp: string; urlMigrador: string; urlRelay: string
  /** o adaptador de produção, no papel da aplicação (sem BYPASSRLS) */
  appPool: pg.Pool; db: DbTenant
  migra(no: No): Promise<void>
  fecha(): Promise<void>
}

export async function criaBanco(apelido: string): Promise<Banco> {
  if (!URL_REAL) throw new Error('POLARIS_PG_REAL_URL não definida')
  const nome = `t_${apelido.replace(/[^a-z0-9]/gi, '_').toLowerCase()}_${Date.now().toString(36)}`.slice(0, 60)
  const sys = new pg.Pool({ connectionString: URL_REAL, max: 1 })
  // papéis do CLUSTER: criados uma vez, tolerando a corrida entre arquivos
  for (const [papel, extra] of [['polaris_migrador', 'BYPASSRLS CREATEDB'], ['polaris_app', 'NOBYPASSRLS'], ['polaris_relay', 'BYPASSRLS']] as const) {
    await sys.query(`DO $$ BEGIN CREATE ROLE ${papel} LOGIN ${extra} PASSWORD '${SENHA}'; EXCEPTION WHEN duplicate_object THEN NULL; END $$`)
  }
  await sys.query(`CREATE DATABASE ${nome} OWNER polaris_migrador`); await sys.end()
  const admin = new pg.Pool({ connectionString: com(URL_REAL, 'postgres', nome), max: 8 })
  await admin.query(`REVOKE ALL ON DATABASE ${nome} FROM PUBLIC; GRANT CONNECT ON DATABASE ${nome} TO polaris_app, polaris_relay`)
  const urlApp = com(URL_REAL, 'polaris_app', nome), urlMigrador = com(URL_REAL, 'polaris_migrador', nome), urlRelay = com(URL_REAL, 'polaris_relay', nome)
  const appPool = criaPool({ url: urlApp, max: 30 })
  return {
    nome, admin, urlApp, urlMigrador, urlRelay, appPool, db: dbTenantDePg(appPool),
    async migra(no) {
      const m = new pg.Pool({ connectionString: urlMigrador, max: 1 })
      try { await m.query(emite(no, 'sql')); await m.query(`GRANT USAGE ON SCHEMA "${no.id}" TO polaris_app, polaris_relay; GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA "${no.id}" TO polaris_app, polaris_relay; GRANT USAGE ON ALL SEQUENCES IN SCHEMA "${no.id}" TO polaris_app, polaris_relay`) } finally { await m.end() }
    },
    async fecha() { await appPool.end(); await admin.end(); const s = new pg.Pool({ connectionString: URL_REAL, max: 1 }); try { await s.query(`DROP DATABASE IF EXISTS ${nome} WITH (FORCE)`) } finally { await s.end() } },
  }
}

/** o conjunto de nós de uma plataforma de teste: os packs de fábrica (para `criaServico`, papéis e eventos) */
export function serviceNo(reg: Registry, id: string): No { const r = reg.resolve('servico', id); if (!r) throw new Error(`serviço ${id} não existe`); return r.no }

import { criaAutenticadorJwt } from '@polaris/acesso'
import { contextoPorJwt, criaServico, regrasDoRegistry } from '@polaris/servico'
import type { FastifyInstance } from 'fastify'
import type { KeyObject } from 'node:crypto'
import { SignJWT, generateKeyPair } from 'jose'

type KeyLike = CryptoKey | KeyObject

const ISS = 'https://id.teste', AUD = 'polaris'
export type Cliente = { app: FastifyInstance; req(papeis: string[], tenant: string, m: string, url: string, corpo?: unknown, sub?: string): Promise<{ status: number; corpo: any }>; fecha(): Promise<void> }
/** Um serviço de verdade (Fastify + `criaServico`) sobre o banco real, falando JWT RS256; cada `req` é uma requisição HTTP independente: em paralelo, são transações paralelas em conexões distintas. */
export async function criaCliente(b: Banco, reg: Registry, servico: string, operacoes: Record<string, never> = {}, eventos: Record<string, No> = Object.fromEntries(reg.ids('evento').map((e) => [e, reg.resolve('evento', e)!.no])) as Record<string, No>): Promise<Cliente> {
  const k = await generateKeyPair('RS256'); const priv: KeyLike = k.privateKey
  const app = criaServico(serviceNo(reg, servico), { db: b.db, acesso: regrasDoRegistry(reg), contexto: contextoPorJwt(criaAutenticadorJwt({ emissor: ISS, audiencia: AUD, chave: { publica: k.publicKey } })), operacoes: operacoes as never, eventos })
  await app.ready()
  return {
    app,
    async req(papeis, tenant, m, url, corpo = m === 'POST' ? {} : undefined, sub = 'u1') {
      const tok = await new SignJWT({ tid: tenant, papeis }).setProtectedHeader({ alg: 'RS256' }).setSubject(sub).setIssuer(ISS).setAudience(AUD).setExpirationTime('10m').sign(priv)
      const r = await app.inject({ method: m as 'GET', url, headers: { authorization: `Bearer ${tok}`, ...(corpo !== undefined ? { 'content-type': 'application/json' } : {}) }, ...(corpo !== undefined ? { payload: JSON.stringify(corpo) } : {}) })
      return { status: r.statusCode, corpo: r.body ? JSON.parse(r.body) : null }
    },
    fecha: () => app.close(),
  }
}
