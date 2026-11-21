process.env.POLARIS_LOG_NIVEL = 'silencio'
import { PGlite } from '@electric-sql/pglite'
import { Registry, emite, type No } from '@polaris/schema'
import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { criaServico, dbDePglite, regrasDoRegistry, type Contexto } from '../src/index'

// Escopo por usuário: cada registro é de quem o criou (coluna `dono`, do token, nunca do corpo); um usuário não lê, altera nem remove o que é de outro, mesmo dentro do mesmo tenant.
const A = '11111111-1111-1111-1111-111111111111', B = '22222222-2222-2222-2222-222222222222'
const SVC: No = { kind: 'servico', id: 'pulso', versao: '1.0.0', estatuto: 'publicado', spec: { entidades: {
  conta: { escopo: 'usuario', campos: { nome: { tipo: 'texto', obrigatorio: true }, saude: { tipo: 'inteiro' } }, crud: { caminho: '/contas' } },
  geral: { campos: { texto: { tipo: 'texto' } }, crud: { caminho: '/gerais' } },
}, operacoes: {} } } as never
const papel = { kind: 'papel', id: 'cs', versao: '1.0.0', estatuto: 'publicado', spec: { regras: [{ acoes: ['manage'], sujeitos: ['pulso.conta', 'pulso.geral'] }] } } as never
const REG = new Registry(); REG.registra(papel)
const TOK: Record<string, Contexto> = { ana: { tenantId: A, usuario: 'ana', papeis: ['cs'] }, bia: { tenantId: A, usuario: 'bia', papeis: ['cs'] }, cris: { tenantId: B, usuario: 'ana', papeis: ['cs'] } }
let pg: PGlite, app: FastifyInstance
const req = (tok: string, metodo: string, url: string, corpo?: unknown) => app.inject({ method: metodo as 'GET', url, headers: { authorization: `Bearer ${tok}`, ...(corpo !== undefined ? { 'content-type': 'application/json' } : {}) }, ...(corpo !== undefined ? { payload: JSON.stringify(corpo) } : {}) })
const json = (r: { body: string }) => JSON.parse(r.body)
beforeAll(async () => {
  pg = new PGlite()
  await pg.exec(`CREATE ROLE migrador NOLOGIN BYPASSRLS; CREATE ROLE app NOLOGIN; GRANT CREATE ON DATABASE postgres TO migrador; SET ROLE migrador;`)
  await pg.exec(emite(SVC, 'sql'))
  await pg.exec(`RESET ROLE; GRANT USAGE ON SCHEMA pulso TO app; GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA pulso TO app; SET ROLE app;`)
  app = criaServico(SVC, { db: dbDePglite(pg), acesso: regrasDoRegistry(REG), contexto: (r) => { const a = String(r.headers.authorization ?? ''); return a.startsWith('Bearer ') ? TOK[a.slice(7)] ?? null : null } })
  await app.ready()
})
afterAll(async () => { await app.close(); await pg.close() })

describe('escopo: usuario', () => {
  it('cada usuário só enxerga, altera e remove os PRÓPRIOS registros; o dono vem do token e nunca aparece na API', async () => {
    const c1 = await req('ana', 'POST', '/contas', { nome: 'Acme', saude: 80 }); expect(c1.statusCode).toBe(201); const id = json(c1).id; expect(json(c1).dono).toBeUndefined()
    expect((await req('ana', 'POST', '/contas', { nome: 'Beta', saude: 30, dono: 'bia' })).statusCode).toBe(400) // o dono não é campo da API: não se informa
    await req('bia', 'POST', '/contas', { nome: 'Da Bia', saude: 50 })
    expect(json(await req('ana', 'GET', '/contas')).map((c: any) => c.nome)).toEqual(['Acme']); expect(json(await req('bia', 'GET', '/contas')).map((c: any) => c.nome)).toEqual(['Da Bia'])
    expect((await req('bia', 'GET', `/contas/${id}`)).statusCode).toBe(404); expect((await req('bia', 'PATCH', `/contas/${id}`, { saude: 1 })).statusCode).toBe(404); expect((await req('bia', 'DELETE', `/contas/${id}`)).statusCode).toBe(404)
    expect(json(await req('ana', 'GET', `/contas/${id}`)).saude).toBe(80) // nada mudou para a dona
    expect((await req('ana', 'PATCH', `/contas/${id}`, { saude: 90 })).statusCode).toBe(200); expect(json(await req('ana', 'GET', `/contas/${id}`)).saude).toBe(90)
    // o mesmo nome de usuário em OUTRO tenant é outra pessoa: nada vaza
    expect(json(await req('cris', 'GET', '/contas'))).toEqual([])
    expect((await req('ana', 'DELETE', `/contas/${id}`)).statusCode).toBe(204); expect(json(await req('ana', 'GET', '/contas'))).toEqual([])
  })
  it('entidade sem escopo continua compartilhada no tenant', async () => {
    await req('ana', 'POST', '/gerais', { texto: 'x' }); expect(json(await req('bia', 'GET', '/gerais')).map((g: any) => g.texto)).toEqual(['x'])
  })
  it('crud público com escopo por usuário é recusado na emissão (não haveria dono)', () => {
    const ruim = { ...SVC, spec: { entidades: { conta: { escopo: 'usuario', campos: { nome: { tipo: 'texto' } }, crud: { caminho: '/contas', permissao: 'publica' } } }, operacoes: {} } } as never
    expect(() => emite(ruim, 'sql')).not.toThrow(); expect(() => criaServico(ruim, { db: dbDePglite(pg), acesso: regrasDoRegistry(REG), contexto: () => null })).toThrow(/escopo por usuário/)
  })
})
