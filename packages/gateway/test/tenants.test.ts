import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { A, B, criaAmbiente, type Ambiente } from './ambiente'
import type { InfoTenant, ResolvedorTenant } from '../src/index'

// O gateway com o DIRETÓRIO de tenants: status, módulos habilitados e a amarração host ↔ tenant.
const C = '33333333-3333-3333-3333-333333333333', D = '44444444-4444-4444-4444-444444444444', Z = '55555555-5555-5555-5555-555555555555'
const dir = new Map<string, InfoTenant>([
  [A, { id: A, status: 'ativo', modulos: ['loja'] }], [B, { id: B, status: 'ativo', modulos: [] }], // B está ativo mas NÃO tem o módulo `loja`
  [C, { id: C, status: 'suspenso', modulos: ['loja'] }], [D, { id: D, status: 'provisionando', modulos: ['loja'] }], [Z, { id: Z, status: 'cancelado', modulos: ['loja'] }],
])
const hosts: Record<string, string> = { 'a.loja.test': A, 'b.loja.test': B, 'c.loja.test': C, 'd.loja.test': D, 'z.loja.test': Z }
const consultas: string[] = []
const resolvedor: ResolvedorTenant = { porHost: async (h) => { consultas.push(`host:${h}`); const id = hosts[h]; return id ? dir.get(id)! : null }, porId: async (id) => { consultas.push(`id:${id}`); return dir.get(id) ?? null } }

let e: Ambiente
beforeAll(async () => { e = await criaAmbiente({ gateway: { tenants: resolvedor } }); await e.semear() })
afterAll(async () => { await e.fim() })
const n = () => e.clienteLoja.chamadas.length

describe('anônimo: o host decide o tenant, e só tenant ATIVO opera', () => {
  it('ativo atende; host desconhecido é 400 (nunca "todos")', async () => {
    expect((await e.req('GET', '/api/loja/vitrines', { host: 'a.loja.test' })).statusCode).toBe(200)
    const r = await e.req('GET', '/api/loja/vitrines', { host: 'fantasma.test' }); expect(r.statusCode).toBe(400); expect(e.json(r).erro.codigo).toBe('tenant_nao_resolvido')
  })
  it('suspenso é 403, encerrado é 410, provisionando é 503 com retry-after — e NADA chega ao serviço', async () => {
    const antes = n()
    const s = await e.req('GET', '/api/loja/vitrines', { host: 'c.loja.test' }); expect([s.statusCode, e.json(s).erro.codigo]).toEqual([403, 'tenant_suspenso'])
    const z = await e.req('GET', '/api/loja/vitrines', { host: 'z.loja.test' }); expect([z.statusCode, e.json(z).erro.codigo]).toEqual([410, 'tenant_encerrado'])
    const d = await e.req('GET', '/api/loja/vitrines', { host: 'd.loja.test' }); expect([d.statusCode, e.json(d).erro.codigo, d.headers['retry-after']]).toEqual([503, 'tenant_indisponivel', '30'])
    expect(n()).toBe(antes)
  })
})

describe('autenticado: o status e o host do TOKEN são conferidos', () => {
  it('token de tenant suspenso é 403 mesmo com token válido; tenant que o diretório não conhece é 403', async () => {
    const tc = await e.token('x', C, ['vendedor']); const r = await e.req('GET', '/api/loja/produtos', { tok: tc, host: 'a.loja.test' }); expect([r.statusCode, e.json(r).erro.codigo]).toEqual([403, 'tenant_suspenso'])
    const tx = await e.token('x', '99999999-9999-9999-9999-999999999999', ['vendedor']); expect(e.json(await e.req('GET', '/api/loja/produtos', { tok: tx })).erro.codigo).toBe('tenant_desconhecido')
  })
  it('o token de um tenant NÃO vale na vitrine de outro (403 tenant_divergente); host genérico da plataforma (sem dono) passa', async () => {
    const ta = await e.token('ana', A, ['vendedor'])
    const r = await e.req('GET', '/api/loja/produtos', { tok: ta, host: 'b.loja.test' }); expect([r.statusCode, e.json(r).erro.codigo]).toEqual([403, 'tenant_divergente'])
    expect((await e.req('GET', '/api/loja/produtos', { tok: ta, host: 'a.loja.test' })).statusCode).toBe(200)
    expect((await e.req('GET', '/api/loja/produtos', { tok: ta, host: 'api.plataforma.test' })).statusCode).toBe(200) // o resolvedor não conhece este host: não tem dono
  })
})

describe('módulos habilitados: um único ponto de checagem, para REST, BFF e GraphQL', () => {
  it('tenant SEM o módulo: o REST é 404 `modulo_nao_habilitado` e a chamada nunca chega ao serviço', async () => {
    const tb = await e.token('bia', B, ['vendedor']); const antes = n()
    const r = await e.req('GET', '/api/loja/produtos', { tok: tb, host: 'b.loja.test' }); expect([r.statusCode, e.json(r).erro.codigo]).toEqual([404, 'modulo_nao_habilitado'])
    const pub = await e.req('GET', '/api/loja/vitrines', { host: 'b.loja.test' }); expect([pub.statusCode, e.json(pub).erro.codigo]).toEqual([404, 'modulo_nao_habilitado']) // também na rota pública
    expect(n()).toBe(antes)
  })
  it('o BFF de página também não alcança o serviço (o dado da página volta com erro, sem chamada)', async () => {
    const tb = await e.token('bia', B, ['vendedor']); const antes = n()
    const r = await e.req('GET', '/bff/paginas/home', { tok: tb, host: 'b.loja.test' }); expect(r.statusCode).toBe(200)
    expect(Object.values(e.json(r).status as Record<string, string>).every((s) => s !== 'ok')).toBe(true); expect(n()).toBe(antes)
  })
  it('o GraphQL tampouco', async () => {
    const tb = await e.token('bia', B, ['vendedor']); const antes = n()
    const r = await e.req('POST', '/graphql', { tok: tb, host: 'b.loja.test', corpo: { query: '{ loja_listarProduto { id } }' } }); expect(JSON.stringify(e.json(r))).toMatch(/modulo_nao_habilitado|não está habilitado/); expect(n()).toBe(antes)
  })
  it('tenant COM o módulo segue normal', async () => { expect((await e.req('GET', '/api/loja/produtos', { tok: await e.token('ana', A, ['vendedor']), host: 'a.loja.test' })).statusCode).toBe(200) })
})

describe('sem o resolvedor o comportamento antigo continua', () => {
  it('(compatibilidade) `tenantPorHost` simples segue valendo quando `tenants` não é informado', async () => {
    const e2 = await criaAmbiente(); try { expect((await e2.req('GET', '/api/loja/vitrines')).statusCode).toBe(200) } finally { await e2.fim() }
  })
})
void consultas
