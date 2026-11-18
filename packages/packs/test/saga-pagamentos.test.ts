process.env.POLARIS_LOG_NIVEL = 'silencio'
import { vi } from 'vitest'
vi.setConfig({ testTimeout: 40_000, hookTimeout: 40_000 })
import { PGlite } from '@electric-sql/pglite'
import { criaAutenticadorJwt } from '@polaris/acesso'
import { criaBarramentoMemoria, criaRelay, type Consulta, type DbSistema, type DbTenant } from '@polaris/eventos'
import { Registry, emite, type No } from '@polaris/schema'
import { contextoPorJwt, criaServico, regrasDoRegistry } from '@polaris/servico'
import type { KeyObject } from 'node:crypto'
import { SignJWT, generateKeyPair } from 'jose'

type KeyLike = CryptoKey | KeyObject
import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { criaPagamentos, criaVendas, nosDoPack, portaPagamento, provedorInterno, type Cotacao, type Portas, type Provedor } from '../src/index'

// Vendas e Pagamentos em BANCOS SEPARADOS (um PGlite cada), como em produção: a saga de Vendas chama o serviço Pagamentos pelo adaptador (HTTP no real, inject aqui).
const A = '11111111-1111-1111-1111-111111111111'
const ISS = 'https://id.teste', AUD = 'polaris'
const reg = (pack: 'vendas' | 'pagamentos') => { const r = new Registry(); for (const n of nosDoPack(pack)) r.registra(n); return r }
const regV = reg('vendas'), regP = reg('pagamentos'), noV = regV.resolve('servico', 'vendas')!.no, noP = regP.resolve('servico', 'pagamentos')!.no
const eventos = Object.fromEntries(regV.ids('evento').map((id) => [id, regV.resolve('evento', id)!.no])) as Record<string, No>

let pgV: PGlite, pgP: PGlite, appV: FastifyInstance, appP: FastifyInstance, priv: KeyLike
const consulta = (tx: { query: PGlite['query'] }): Consulta => async (sql, params) => { const r = await tx.query(sql, params as unknown[]); return { rows: r.rows as Record<string, unknown>[], rowCount: r.affectedRows ?? r.rows.length } }
const dbDe = (pg: () => PGlite): DbTenant => ({ transacao: (t, fn) => pg().transaction(async (tx) => { await tx.exec('SET LOCAL ROLE app'); await tx.query(`SELECT set_config('app.tenant_id', $1, true)`, [t]); return fn(consulta(tx)) }) })
const dbRelayV: DbSistema = { transacao: (fn) => pgV.transaction(async (tx) => { await tx.exec('SET LOCAL ROLE relay'); return fn(consulta(tx)) }) }
const sqlDe = (pg: () => PGlite) => async (s: string, p: unknown[] = []) => (await pg().transaction(async (tx) => { await tx.exec('SET LOCAL ROLE relay'); return tx.query(s, p) })).rows as Array<Record<string, any>>
const sqlV = sqlDe(() => pgV), sqlP = sqlDe(() => pgP)
const token = (sub: string, papeis: string[]) => new SignJWT({ tid: A, papeis }).setProtectedHeader({ alg: 'RS256' }).setSubject(sub).setIssuer(ISS).setAudience(AUD).setExpirationTime('10m').sign(priv)
const http = (app: () => FastifyInstance) => async (tok: string, m: string, url: string, corpo: unknown = m === 'POST' ? {} : undefined) => { const r = await app().inject({ method: m as 'GET', url, headers: { authorization: `Bearer ${tok}`, ...(corpo !== undefined ? { 'content-type': 'application/json' } : {}) }, ...(corpo !== undefined ? { payload: JSON.stringify(corpo) } : {}) }); return { status: r.statusCode, corpo: r.body ? JSON.parse(r.body) : null } }
const ven = http(() => appV), pag = http(() => appP)

const gwModo = { autoriza: 'ok' as 'ok' | 'recusa' | 'cai', captura: 'ok' as 'ok' | 'recusa' }
const gwChamadas: string[] = []
const gateway: Provedor = {
  autoriza: async (c) => { gwChamadas.push('autoriza'); if (gwModo.autoriza === 'cai') throw new Error('gateway fora'); return gwModo.autoriza === 'ok' ? { ok: true, referencia: `gw-${c.pagamentoId}` } : { ok: false, motivo: 'cartão recusado pelo emissor' } },
  captura: async (c) => { gwChamadas.push('captura'); return gwModo.captura === 'ok' ? { ok: true, referencia: `gw-${c.pagamentoId}` } : { ok: false, motivo: 'captura negada' } },
  cancela: async () => { gwChamadas.push('cancela') }, estorna: async (c) => ({ ok: true, referencia: `gw-est-${c.pagamentoId}` }),
}
const estoqueLog: string[] = []
const cotacoes = new Map<string, Cotacao>()
const portas: Portas = {
  catalogo: { cotacao: async (_c, id) => cotacoes.get(id) ?? null },
  estoque: { reserva: async (p) => { estoqueLog.push('reserva'); return { ok: true, referencia: `res-${p.pedidoId}` } }, libera: async (_p, r) => { estoqueLog.push(`libera:${r}`) } },
  pagamento: portaPagamento({ chama: async (_t, _m, caminho, corpo) => pag(await token('saga', ['pagamentos.sistema']), 'POST', caminho, corpo) }),
}
let vendas!: ReturnType<typeof criaVendas>
const reset = async () => { await sqlV(`UPDATE vendas.outbox SET publicado_em = now() WHERE publicado_em IS NULL`); gwChamadas.length = 0; estoqueLog.length = 0; gwModo.autoriza = 'ok'; gwModo.captura = 'ok' }
let seq = 0
async function pedidoCom(metodo: string, parcelas = 1) {
  const t = await token('ana', ['vendas.operador']); const c = (await ven(t, 'POST', '/carrinhos', { criadoPor: 'ana', metodoPagamento: metodo, parcelas })).corpo.id
  const cot: Cotacao = { id: `aaaaaaaa-0000-0000-0000-${String(++seq).padStart(12, '0')}`, produtoId: '99999999-0000-0000-0000-000000000001', varianteId: null, quantidade: '2', precoUnitario: '50.00', criadoEm: new Date().toISOString() }
  cotacoes.set(cot.id, cot); expect((await ven(t, 'POST', `/carrinhos/${c}/itens`, { cotacaoId: cot.id })).status).toBe(200)
  const f = await ven(t, 'POST', `/carrinhos/${c}/finalizar`, { chaveIdempotencia: `chave-saga-pag-${seq}` }); expect(f.status).toBe(200); return f.corpo.id as string
}
async function entrega() { const bus = criaBarramentoMemoria({ maxTentativas: 1 }); bus.assina(vendas.consumidor(dbDe(() => pgV))); await criaRelay({ db: dbRelayV, servico: 'vendas', barramento: bus, espera: () => 0 }).executa(); await bus.aguarda(); return bus }
const pedido = async (id: string) => (await sqlV(`SELECT status, motivo_falha AS motivo, metodo_pagamento AS metodo, parcelas FROM vendas.pedido WHERE id = $1`, [id]))[0]!
const pagamentoDe = async (id: string) => (await sqlP(`SELECT status, metodo, valor::text AS valor, liquido::text AS liquido, parcelas FROM pagamentos.pagamento WHERE pedido_id = $1`, [id]))[0]
const carteira = async () => (await sqlP(`SELECT saldo::text AS s FROM pagamentos.carteira`))[0]?.s ?? '0'

beforeAll(async () => {
  const k = await generateKeyPair('RS256'); priv = k.privateKey
  const prepara = async (no: No, schema: string) => { const pg = new PGlite(); await pg.exec(`CREATE ROLE migrador NOLOGIN BYPASSRLS; CREATE ROLE relay NOLOGIN BYPASSRLS; CREATE ROLE app NOLOGIN; GRANT CREATE ON DATABASE postgres TO migrador; SET ROLE migrador;`); await pg.exec(emite(no, 'sql')); await pg.exec(`RESET ROLE; GRANT USAGE ON SCHEMA ${schema} TO app, relay; GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA ${schema} TO app, relay;`); return pg }
  pgV = await prepara(noV, 'vendas'); pgP = await prepara(noP, 'pagamentos')
  const autentica = criaAutenticadorJwt({ emissor: ISS, audiencia: AUD, chave: { publica: k.publicKey } })
  vendas = criaVendas(noV, { portas, eventos })
  appV = criaServico(noV, { db: dbDe(() => pgV), acesso: regrasDoRegistry(regV), contexto: contextoPorJwt(autentica), operacoes: vendas.operacoes, eventos })
  appP = criaServico(noP, { db: dbDe(() => pgP), acesso: regrasDoRegistry(regP), contexto: contextoPorJwt(autentica), operacoes: criaPagamentos(noP, { provedores: { gateway, interno: provedorInterno } }).operacoes })
  await appV.ready(); await appP.ready()
  const fin = await token('fin', ['pagamentos.financeiro'])
  for (const [metodo, taxaPercentual] of [['pix', 1.5], ['credito', 3]] as const) expect((await pag(fin, 'POST', '/config-pagamento', { metodo, provedor: 'gateway', taxaPercentual })).status).toBe(201)
})
afterAll(async () => { await appV.close(); await appP.close(); await pgV.close(); await pgP.close() })

describe('saga de Vendas ↔ serviço Pagamentos (dois bancos)', () => {
  it('pix: o pedido é confirmado, o pagamento fica PAGO com taxa e líquido, e a carteira recebe o líquido', async () => {
    await reset(); const antes = await carteira(); const id = await pedidoCom('pix'); await entrega()
    expect(await pedido(id)).toMatchObject({ status: 'confirmado', metodo: 'pix' }); expect(await pagamentoDe(id)).toEqual({ status: 'pago', metodo: 'pix', valor: '100.0000', liquido: '98.5000', parcelas: 1 })
    expect(gwChamadas).toEqual(['autoriza', 'captura']); expect(await carteira()).toBe((Number(antes) + 98.5).toFixed(4)); expect(estoqueLog).toEqual(['reserva'])
  })
  it('crédito em 3x recusado pelo emissor: o pedido FALHA com o motivo, o estoque é liberado e a recusa fica registrada no pagamento', async () => {
    await reset(); gwModo.autoriza = 'recusa'; const id = await pedidoCom('credito', 3); await entrega()
    expect(await pedido(id)).toMatchObject({ status: 'falhou', metodo: 'credito', parcelas: 3 }); expect((await pedido(id)).motivo).toContain('cartão recusado pelo emissor')
    expect(await pagamentoDe(id)).toMatchObject({ status: 'falhou', parcelas: 3 }); expect(estoqueLog).toEqual(['reserva', expect.stringMatching(/^libera:res-/)] as never)
  })
  it('gateway FORA DO AR: a saga não compensa à toa nem cobra; ao voltar, reprocessar conclui com UMA cobrança', async () => {
    await reset(); gwModo.autoriza = 'cai'; const id = await pedidoCom('pix'); const bus = await entrega(); expect(bus.mortas().length).toBe(1)
    expect((await pedido(id)).status).toBe('criado'); expect(await pagamentoDe(id)).toBeUndefined(); expect(estoqueLog).toEqual(['reserva'])
    gwModo.autoriza = 'ok'; const g = await token('gil', ['vendas.gerente']); const r = await ven(g, 'POST', `/pedidos/${id}/processar`)
    expect(r.corpo.status).toBe('confirmado'); expect((await sqlP(`SELECT count(*)::int AS n FROM pagamentos.pagamento WHERE pedido_id = $1`, [id]))[0]!.n).toBe(1)
  })
  it('captura recusada: o pedido falha, o estoque é liberado e o pagamento fica `falhou` (sem crédito na carteira)', async () => {
    await reset(); const antes = await carteira(); gwModo.captura = 'recusa'; const id = await pedidoCom('pix'); await entrega()
    expect((await pedido(id)).status).toBe('falhou'); expect(await pagamentoDe(id)).toMatchObject({ status: 'falhou' }); expect(estoqueLog.at(-1)).toMatch(/^libera:/); expect(await carteira()).toBe(antes)
  })
  it('método sem configuração no tenant (débito): recusa de negócio vira falha do pedido, com o motivo', async () => {
    await reset(); const id = await pedidoCom('debito'); await entrega()
    expect((await pedido(id)).status).toBe('falhou'); expect((await pedido(id)).motivo).toContain('não está habilitado'); expect(await pagamentoDe(id)).toBeUndefined(); expect(estoqueLog.at(-1)).toMatch(/^libera:/)
  })
})
