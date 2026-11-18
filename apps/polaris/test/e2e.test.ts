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
import { migraPlataforma } from '../src/migra'
import { DDL_DIRETORIO, criaArmazemDeNos, criaPreview, criaReleases } from '@polaris/packs'
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

describe('gateway de produção com o diretório de tenants (plataforma)', () => {
  it('subdomínio resolve o tenant, módulo habilitado funciona, módulo ausente é 404, suspenso é 403 e o token de outro tenant na vitrine alheia é 403', async () => {
    await db.exec('RESET ROLE'); await db.exec(DDL_DIRETORIO) // (o PGlite tem UMA sessão: os pools dos testes anteriores deixaram um SET ROLE nela)
    const ativo = A, suspenso = B
    const novo = async (id: string, alias: string, status: string, modulos: string[]) => { await db.query(`INSERT INTO plataforma.tenant (id, alias, nome, segmento, packs, dono_email, status, chave) VALUES ($1, $2, $2, 'varejo', '{varejo}', 'a@b.com', $3, $4)`, [id, alias, status, `chave-e2e-${alias}-xxxxxxxx`]); for (const m of modulos) await db.query(`INSERT INTO plataforma.modulo (tenant_id, servico) VALUES ($1, $2)`, [id, m]) }
    await novo(ativo, 'loja-e2e', 'ativo', ['loja']); await novo(suspenso, 'loja-susp', 'suspenso', ['loja']); await novo('33333333-3333-3333-3333-333333333333', 'sem-modulo', 'ativo', ['catalogo'])
    const reg = new Registry(); registraBase(reg); carregaNos(dir, reg)
    const porta = /:(\d+)/.exec(srv.getServerConn())![1]
    const gw = montaGateway(configGateway({ POLARIS_NOS: dir, POLARIS_SERVICOS: JSON.stringify({ loja: urlSrv }), JWT_EMISSOR: ISS, JWT_AUDIENCIA: AUD, JWT_SEGREDO: SEG, DATABASE_URL_PLATAFORMA: `postgres://postgres@127.0.0.1:${porta}/postgres`, POLARIS_BASES_DOMINIO: 'polaris.test' }), reg)
    try {
      const tok = async (tid: string) => new SignJWT({ tid, papeis: ['gerente'] }).setProtectedHeader({ alg: 'HS256' }).setSubject('u1').setIssuer(ISS).setAudience(AUD).setExpirationTime('5m').sign(new TextEncoder().encode(SEG))
      const get = (host: string, t?: string) => gw.inject({ method: 'GET', url: '/api/loja/produtos', headers: { host, ...(t ? { authorization: `Bearer ${t}` } : {}) } })
      expect((await get('loja-e2e.polaris.test', await tok(ativo))).statusCode).toBe(200)
      expect((await get('loja-susp.polaris.test', await tok(suspenso))).statusCode).toBe(403)
      expect((await get('sem-modulo.polaris.test', await tok('33333333-3333-3333-3333-333333333333'))).statusCode).toBe(404) // tenant ativo, mas sem o módulo `loja`
      expect((await get('loja-susp.polaris.test', await tok(ativo))).statusCode).toBe(403) // o host é de um tenant suspenso e o token é de outro: a conta do host manda
      expect((await get('loja-e2e.polaris.test', await tok(suspenso))).statusCode).toBe(403)
      expect((await gw.inject({ method: 'GET', url: '/api/loja/produtos', headers: { host: 'nao-existe.polaris.test' } })).statusCode).toBe(400)
    } finally { await gw.close() }
  })
})

describe('publicação de ponta a ponta: override → release → produção → preview', () => {
  it('o gateway serve a release de PRODUÇÃO do tenant (a release nova só existe como release) e o preview, assinado, mostra a que ainda não foi promovida', async () => {
    await db.exec('RESET ROLE')
    const T = '66666666-6666-6666-6666-666666666666', porta = /:(\d+)/.exec(srv.getServerConn())![1]
    await db.query(`INSERT INTO plataforma.tenant (id, alias, nome, segmento, packs, dono_email, status, chave) VALUES ($1, 'pub-e2e', 'pub', 'varejo', '{varejo}', 'a@b.com', 'ativo', 'chave-pub-e2e-xxxxxxxxx')`, [T]); await db.query(`INSERT INTO plataforma.modulo (tenant_id, servico) VALUES ($1, 'loja')`, [T])
    const reg = new Registry(); registraBase(reg); carregaNos(dir, reg)
    const q = async (s: string, p: unknown[] = []) => { const r = await db.query(s, p); return { rows: r.rows as Array<Record<string, unknown>>, rowCount: r.affectedRows ?? r.rows.length } }
    const arm = criaArmazemDeNos({ q, base: reg }), rel = criaReleases({ armazemDe: (qq) => criaArmazemDeNos({ q: qq, base: reg }), db: { transacao: (fn) => db.transaction(async (tx) => fn(async (s, p = []) => { const r = await tx.query(s, p); return { rows: r.rows as Array<Record<string, unknown>>, rowCount: r.affectedRows ?? r.rows.length } })) } })
    const pagina = (v: string) => ({ kind: 'pagina', id: 'home', versao: v, estatuto: 'publicado', spec: { rota: '/', raiz: { bloco: 'texto/paragrafo', props: { texto: v } } } })
    await arm.salva(T, 'ana', pagina('1.0.0')); const n1 = ((await rel.cria(T, 'ana')) as any).release.numero; await rel.promove(T, n1, 'ana')
    await arm.salva(T, 'ana', pagina('2.0.0')); const n2 = ((await rel.cria(T, 'ana')) as any).release.numero
    const segredo = 'segredo-de-preview-com-mais-de-32-caracteres!'
    const gw = montaGateway(configGateway({ POLARIS_NOS: dir, POLARIS_SERVICOS: JSON.stringify({ loja: urlSrv }), JWT_EMISSOR: ISS, JWT_AUDIENCIA: AUD, JWT_SEGREDO: SEG, DATABASE_URL_PLATAFORMA: `postgres://postgres@127.0.0.1:${porta}/postgres`, POLARIS_BASES_DOMINIO: 'polaris.test', POLARIS_PREVIEW_SEGREDO: segredo }), reg)
    try {
      const get = (h: Record<string, string> = {}) => gw.inject({ method: 'GET', url: '/bff/paginas/home', headers: { host: 'pub-e2e.polaris.test', ...h } })
      expect((await get()).json().versao).toBe('1.0.0') // produção = release 1; a 2 só existe como release
      const link = criaPreview({ segredo }).emite(T, n2); expect((await get({ 'x-polaris-preview': link })).json().versao).toBe('2.0.0'); expect((await get()).json().versao).toBe('1.0.0')
      expect((await get({ 'x-polaris-preview': criaPreview({ segredo: 'outro-segredo-diferente-com-mais-de-32-bytes' }).emite(T, n2) })).statusCode).toBe(401) // assinado com outro segredo
    } finally { await gw.close() }
    expect(() => configGateway({ POLARIS_NOS: dir, POLARIS_SERVICOS: JSON.stringify({ loja: urlSrv }), JWT_EMISSOR: ISS, JWT_AUDIENCIA: AUD, JWT_SEGREDO: SEG, POLARIS_PREVIEW_SEGREDO: segredo })).toThrow(/só vale com DATABASE_URL_PLATAFORMA/)
  })
})

describe('Studio atrás do gateway', () => {
  it('serve /studio e a API com a autenticação do gateway: tenant e papéis do token, 401 sem token, 403 sem papel, isolamento entre tenants, e o host de outro tenant é recusado', async () => {
    await db.exec('RESET ROLE'); await db.exec(DDL_DIRETORIO)
    const T1 = '44444444-4444-4444-4444-444444444444', T2 = '55555555-5555-5555-5555-555555555555'
    for (const [id, alias] of [[T1, 'studio-um'], [T2, 'studio-dois']] as const) await db.query(`INSERT INTO plataforma.tenant (id, alias, nome, segmento, packs, dono_email, status, chave) VALUES ($1, $2, $2, 'varejo', '{varejo}', 'a@b.com', 'ativo', $3)`, [id, alias, `chave-studio-gw-${alias}-xxxx`])
    const reg = new Registry(); registraBase(reg); carregaNos(dir, reg); const porta = /:(\d+)/.exec(srv.getServerConn())![1]
    const estaticos = mkdtempSync(join(tmpdir(), 'studio-dist-')); writeFileSync(join(estaticos, 'index.html'), '<!doctype html><title>Studio</title>'); writeFileSync(join(estaticos, 'studio.js'), '//js'); writeFileSync(join(estaticos, 'studio.css'), '/*css*/'); writeFileSync(join(estaticos, 'studio.programa.json'), '{}')
    const env = { POLARIS_NOS: dir, POLARIS_SERVICOS: JSON.stringify({ loja: urlSrv }), JWT_EMISSOR: ISS, JWT_AUDIENCIA: AUD, JWT_SEGREDO: SEG, DATABASE_URL_PLATAFORMA: `postgres://postgres@127.0.0.1:${porta}/postgres`, POLARIS_BASES_DOMINIO: 'polaris.test' }
    expect(() => configGateway({ ...env, POLARIS_STUDIO_DIR: 'relativo/x' })).toThrow(/caminho absoluto/); expect(() => configGateway({ POLARIS_NOS: dir, POLARIS_SERVICOS: JSON.stringify({ loja: urlSrv }), JWT_EMISSOR: ISS, JWT_AUDIENCIA: AUD, JWT_SEGREDO: SEG, POLARIS_STUDIO_DIR: estaticos })).toThrow(/DATABASE_URL_PLATAFORMA/)
    const gw = montaGateway(configGateway({ ...env, POLARIS_STUDIO_DIR: estaticos }), reg)
    try {
      const tok = (tid: string, papeis: string[], sub = 'ana') => new SignJWT({ tid, papeis }).setProtectedHeader({ alg: 'HS256' }).setSubject(sub).setIssuer(ISS).setAudience(AUD).setExpirationTime('5m').sign(new TextEncoder().encode(SEG))
      const req = async (metodo: 'GET' | 'PUT' | 'POST', url: string, t?: string, corpo?: object, host = 'studio-um.polaris.test') => gw.inject({ method: metodo, url, headers: { host, ...(t ? { authorization: `Bearer ${t}` } : {}) }, ...(corpo ? { payload: corpo } : {}) })
      const pagina = (id: string, texto: string) => ({ kind: 'pagina', id, versao: '1.0.0', estatuto: 'rascunho', spec: { rota: `/${id}`, raiz: { bloco: 'texto/paragrafo', id: 'p', props: { texto } } } })
      // a página e os ativos
      const pg = await req('GET', '/studio'); expect(pg.statusCode).toBe(200); expect(pg.headers['content-security-policy']).toContain("frame-ancestors 'none'"); expect(pg.payload).toContain('Studio')
      expect((await req('GET', '/studio/ativos/studio.js')).statusCode).toBe(200); expect((await req('GET', '/studio/ativos/outro.js')).statusCode).toBe(404)
      // autenticação e permissão
      expect((await req('GET', '/studio/nos')).statusCode).toBe(401); expect((await req('GET', '/studio/nos', 'lixo')).statusCode).toBe(401)
      expect((await req('GET', '/studio/nos', await tok(T1, ['gerente']))).statusCode).toBe(403) // papel de outro domínio não dá acesso ao Studio
      expect((await req('GET', '/studio/nos', await tok(T1, ['studio.leitor']))).statusCode).toBe(200)
      const leitor = await tok(T1, ['studio.leitor']), editor = await tok(T1, ['studio.editor'], 'beto')
      expect((await req('PUT', '/studio/nos/pagina/home', leitor, { no: pagina('home', 'oi') })).statusCode).toBe(403)
      const gravou = await req('PUT', '/studio/nos/pagina/home', editor, { no: pagina('home', 'oi'), baseSeq: null }); expect(gravou.statusCode).toBe(201); expect(gravou.json().versao).toMatchObject({ seq: 1, autor: 'beto' }) // autor = `sub` do token
      expect((await req('POST', '/studio/comentarios', leitor, { kind: 'pagina', id: 'home', texto: 'x' })).statusCode).toBe(403); expect((await req('POST', '/studio/comentarios', await tok(T1, ['studio.comentarista'], 'cris'), { kind: 'pagina', id: 'home', texto: 'ok' })).json().comentario.autor).toBe('cris')
      // isolamento: o outro tenant não vê, e o token de um tenant não vale no host do outro
      const t2 = await tok(T2, ['studio.editor'], 'dina')
      expect((await req('GET', '/studio/nos/pagina/home', t2, undefined, 'studio-dois.polaris.test')).statusCode).toBe(404)
      expect((await req('GET', '/studio/nos', t2, undefined, 'studio-um.polaris.test')).statusCode).toBe(401) // host do tenant 1 com token do 2: recusado pela regra do gateway
      expect((await req('GET', '/studio/nos', t2, undefined, 'studio-dois.polaris.test')).json().nos.map((n: any) => n.id)).not.toContain('home')
      // o corpo não manda no tenant nem no autor
      expect((await req('PUT', '/studio/nos/pagina/x', editor, { no: pagina('x', 'a'), autor: 'zé', tenantId: T2 })).statusCode).toBe(400)
    } finally { await gw.close(); rmSync(estaticos, { recursive: true, force: true }) }
  })
  it('sem POLARIS_STUDIO_DIR o gateway NÃO expõe /studio (404)', async () => {
    const reg = new Registry(); registraBase(reg); carregaNos(dir, reg); const porta = /:(\d+)/.exec(srv.getServerConn())![1]
    const gw = montaGateway(configGateway({ POLARIS_NOS: dir, POLARIS_SERVICOS: JSON.stringify({ loja: urlSrv }), JWT_EMISSOR: ISS, JWT_AUDIENCIA: AUD, JWT_SEGREDO: SEG, DATABASE_URL_PLATAFORMA: `postgres://postgres@127.0.0.1:${porta}/postgres`, POLARIS_BASES_DOMINIO: 'polaris.test' }), reg)
    try { expect((await gw.inject({ method: 'GET', url: '/studio', headers: { host: 'studio-um.polaris.test' } })).statusCode).toBe(404) } finally { await gw.close() }
  })
})

describe('migração do esquema `plataforma`', () => {
  it('aplica, é idempotente (rodar de novo não muda nada) e concede só o necessário ao papel da plataforma', async () => {
    await db.exec('RESET ROLE; DROP SCHEMA IF EXISTS plataforma CASCADE'); const porta = /:(\d+)/.exec(srv.getServerConn())![1]; const url = `postgres://postgres@127.0.0.1:${porta}/postgres`
    expect(await migraPlataforma({ urlMigrador: url, papelPlataforma: 'polaris_app' })).toEqual({ tabelas: 9 }); expect(await migraPlataforma({ urlMigrador: url, papelPlataforma: 'polaris_app' })).toEqual({ tabelas: 9 })
    const priv = (await db.query(`SELECT table_name, string_agg(privilege_type, ',' ORDER BY privilege_type) AS p FROM information_schema.role_table_grants WHERE grantee = 'polaris_app' AND table_schema = 'plataforma' GROUP BY 1 ORDER BY 1`)).rows as Array<{ table_name: string; p: string }>
    expect(Object.fromEntries(priv.map((r) => [r.table_name, r.p]))).toMatchObject({ no_versao: 'INSERT,SELECT', release: 'INSERT,SELECT', release_evento: 'INSERT,SELECT', tenant: 'DELETE,INSERT,SELECT,UPDATE', comentario: 'INSERT,SELECT,UPDATE' }) // as imutáveis só leem e inserem
  })
  it('recusa papel malformado (injeção) e URL que não é postgres://; a mensagem não carrega a senha', async () => {
    await expect(migraPlataforma({ urlMigrador: 'postgres://u:p@x/y', papelPlataforma: 'a; DROP SCHEMA plataforma' })).rejects.toThrow('papel da plataforma inválido'); await expect(migraPlataforma({ urlMigrador: 'http://u:SENHA-SECRETA@x/y', papelPlataforma: 'polaris_app' })).rejects.toThrow(/postgres/)
    await expect(migraPlataforma({ urlMigrador: 'postgres://u:SENHA-SECRETA@127.0.0.1:1/y', papelPlataforma: 'polaris_app' })).rejects.toThrow(/ECONNREFUSED|connect/); try { await migraPlataforma({ urlMigrador: 'http://u:SENHA-SECRETA@x/y', papelPlataforma: 'polaris_app' }) } catch (e) { expect((e as Error).message).not.toContain('SENHA-SECRETA') }
  })
})

