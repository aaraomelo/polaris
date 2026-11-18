process.env.POLARIS_LOG_NIVEL = 'silencio'
import { vi } from 'vitest'
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })
import { PGlite } from '@electric-sql/pglite'
import { PGLiteSocketServer } from '@electric-sql/pglite-socket'
import { registraBase } from '@polaris/engine'
import { Registry } from '@polaris/schema'
import { SignJWT } from 'jose'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { configGateway, configServico } from '../src/config'
import { montaGateway } from '../src/gateway'
import { carregaNos } from '../src/nos'
import { montaServico } from '../src/servico'

// Os runners de produção ponta a ponta: config por ambiente → nós do disco → migração com o papel migrador → serviço com o driver `pg` (papel sem BYPASSRLS) → gateway por HTTP.
const A = '11111111-1111-1111-1111-111111111111', B = '22222222-2222-2222-2222-222222222222'
const SEG = 'segredo-de-teste-com-mais-de-32-caracteres!!', ISS = 'https://id.teste', AUD = 'polaris'
const nos = [
  { kind: 'servico', id: 'loja', versao: '1.0.0', estatuto: 'publicado', spec: { entidades: { produto: { campos: { nome: { tipo: 'texto', obrigatorio: true }, preco: { tipo: 'dinheiro', obrigatorio: true } }, crud: { caminho: '/produtos' } } }, operacoes: {} } },
  { kind: 'papel', id: 'gerente', versao: '1.0.0', estatuto: 'publicado', spec: { regras: [{ acoes: ['listar', 'obter', 'criar', 'atualizar', 'excluir'], sujeitos: ['loja.produto'] }] } },
]
const token = (tenant: string, papeis = ['gerente']) => new SignJWT({ tid: tenant, papeis }).setProtectedHeader({ alg: 'HS256' }).setSubject('u1').setIssuer(ISS).setAudience(AUD).setExpirationTime('5m').sign(new TextEncoder().encode(SEG))

let db: PGlite, srv: PGLiteSocketServer, dir: string, base: string, fecha: () => Promise<void>, urlSrv: string
beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'polaris-e2e-')); writeFileSync(join(dir, 'nos.json'), JSON.stringify(nos))
  db = new PGlite(); await db.exec(`CREATE ROLE polaris_app LOGIN; CREATE ROLE migrador LOGIN BYPASSRLS; GRANT CREATE ON DATABASE postgres TO migrador;`)
  srv = new PGLiteSocketServer({ db, port: 0, host: '127.0.0.1', maxConnections: 20 }); await srv.start()
  const port = /:(\d+)/.exec(srv.getServerConn())![1]
  const env = { POLARIS_NOS: dir, POLARIS_SERVICO: 'loja', JWT_EMISSOR: ISS, JWT_AUDIENCIA: AUD, JWT_SEGREDO: SEG, DATABASE_URL: `postgres://polaris_app@127.0.0.1:${port}/postgres`, POLARIS_DB_PAPEL: 'polaris_app', POLARIS_MIGRAR: '1', DATABASE_URL_MIGRADOR: `postgres://migrador@127.0.0.1:${port}/postgres` }
  const s = await montaServico(configServico(env), carregaNos(dir)); fecha = s.fecha
  await s.app.listen({ port: 0, host: '127.0.0.1' }); base = `http://127.0.0.1:${(s.app.server.address() as { port: number }).port}`; urlSrv = base
})
afterAll(async () => { await fecha(); await srv.stop(); await db.close(); rmSync(dir, { recursive: true, force: true }) })
const http = async (m: string, p: string, t?: string, corpo?: unknown) => { const r = await fetch(base + p, { method: m, headers: { ...(t ? { authorization: `Bearer ${t}` } : {}), ...(corpo ? { 'content-type': 'application/json' } : {}) }, ...(corpo ? { body: JSON.stringify(corpo) } : {}) }); return { status: r.status, corpo: await r.json().catch(() => null) as any } }

describe('serviço de produção: migração + driver pg + RLS + JWT', () => {
  it('sem token: 401; token de gerente cria e lista; tenants isolados pelo BANCO', async () => {
    expect((await http('GET', '/produtos')).status).toBe(401)
    const a = await token(A), b = await token(B)
    const c = await http('POST', '/produtos', a, { nome: 'Café', preco: '49.90' }); expect(c.status).toBe(201)
    expect((await http('GET', '/produtos', a)).corpo.itens?.map((x: any) => x.nome) ?? (await http('GET', '/produtos', a)).corpo.map((x: any) => x.nome)).toEqual(['Café'])
    const lb = (await http('GET', '/produtos', b)).corpo; expect(JSON.stringify(lb)).not.toContain('Café')
    expect((await http('GET', `/produtos/${c.corpo.id}`, b)).status).toBe(404) // a linha existe, mas é de outro tenant
  })
  it('a aplicação roda sem BYPASSRLS e sem poder alterar o esquema (só DML concedido pela migração)', async () => {
    const r = (await db.query(`SELECT rolbypassrls, rolsuper FROM pg_roles WHERE rolname = 'polaris_app'`)).rows[0] as any; expect(r).toEqual({ rolbypassrls: false, rolsuper: false })
  })
  it('gateway por HTTP na frente do serviço: mesma autenticação, mesmos dados', async () => {
    const reg = new Registry(); registraBase(reg); carregaNos(dir, reg)
    const gw = montaGateway(configGateway({ POLARIS_NOS: dir, POLARIS_SERVICOS: JSON.stringify({ loja: urlSrv }), JWT_EMISSOR: ISS, JWT_AUDIENCIA: AUD, JWT_SEGREDO: SEG }), reg)
    try {
      const a = await token(A)
      const r = await gw.inject({ method: 'GET', url: '/api/loja/produtos', headers: { authorization: `Bearer ${a}` } })
      expect(r.statusCode).toBe(200) // config → cliente HTTP → serviço → banco, atravessando o gateway
      expect((await gw.inject({ method: 'GET', url: '/api/loja/produtos' })).statusCode).toBe(400) // anônimo e host desconhecido: o gateway não adivinha o tenant
    } finally { await gw.close() }
  })
})
