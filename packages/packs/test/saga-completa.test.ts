process.env.POLARIS_LOG_NIVEL = 'silencio'
import { vi } from 'vitest'
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })
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
import { criaEstoque, criaPagamentos, criaVendas, nosDoPack, portaEstoque, portaPagamento, provedorInterno, type Cotacao, type Portas, type Provedor } from '../src/index'

// O fluxo de venda COMPLETO com os três serviços reais, cada um com o seu banco: Vendas (saga) → Estoque (reserva/baixa por evento) → Pagamentos.
const A = '11111111-1111-1111-1111-111111111111', ISS = 'https://id.teste', AUD = 'polaris'
const reg = (pack: 'vendas' | 'pagamentos' | 'estoque') => { const r = new Registry(); for (const n of nosDoPack(pack)) r.registra(n); if (pack === 'estoque') for (const p of ['vendas', 'servicos'] as const) for (const n of nosDoPack(p)) if ((n as { kind: string }).kind === 'evento') r.registra(n); return r }
const regV = reg('vendas'), regP = reg('pagamentos'), regE = reg('estoque')
const noV = regV.resolve('servico', 'vendas')!.no, noP = regP.resolve('servico', 'pagamentos')!.no, noE = regE.resolve('servico', 'estoque')!.no
const eventos = Object.fromEntries(regV.ids('evento').map((id) => [id, regV.resolve('evento', id)!.no])) as Record<string, No>
const PROD = '99999999-0000-0000-0000-000000000001'

let pgV: PGlite, pgP: PGlite, pgE: PGlite, appV: FastifyInstance, appP: FastifyInstance, appE: FastifyInstance, priv: KeyLike, DEP = ''
const consulta = (tx: { query: PGlite['query'] }): Consulta => async (sql, params) => { const r = await tx.query(sql, params as unknown[]); return { rows: r.rows as Record<string, unknown>[], rowCount: r.affectedRows ?? r.rows.length } }
const dbDe = (pg: () => PGlite): DbTenant => ({ transacao: (t, fn) => pg().transaction(async (tx) => { await tx.exec('SET LOCAL ROLE app'); await tx.query(`SELECT set_config('app.tenant_id', $1, true)`, [t]); return fn(consulta(tx)) }) })
const dbRelayV: DbSistema = { transacao: (fn) => pgV.transaction(async (tx) => { await tx.exec('SET LOCAL ROLE relay'); return fn(consulta(tx)) }) }
const sqlDe = (pg: () => PGlite) => async (s: string, p: unknown[] = []) => (await pg().transaction(async (tx) => { await tx.exec('SET LOCAL ROLE relay'); return tx.query(s, p) })).rows as Array<Record<string, any>>
const sqlV = sqlDe(() => pgV), sqlP = sqlDe(() => pgP), sqlE = sqlDe(() => pgE)
const token = (sub: string, papeis: string[]) => new SignJWT({ tid: A, papeis }).setProtectedHeader({ alg: 'RS256' }).setSubject(sub).setIssuer(ISS).setAudience(AUD).setExpirationTime('10m').sign(priv)
const http = (app: () => FastifyInstance) => async (tok: string, m: string, url: string, corpo: unknown = m === 'POST' ? {} : undefined) => { const r = await app().inject({ method: m as 'GET', url, headers: { authorization: `Bearer ${tok}`, ...(corpo !== undefined ? { 'content-type': 'application/json' } : {}) }, ...(corpo !== undefined ? { payload: JSON.stringify(corpo) } : {}) }); return { status: r.statusCode, corpo: r.body ? JSON.parse(r.body) : null } }
const ven = http(() => appV), pag = http(() => appP), est = http(() => appE)

const gw = { autoriza: 'ok' as 'ok' | 'recusa' }; const gwLog: string[] = []
const gateway: Provedor = {
  autoriza: async (c) => { gwLog.push('autoriza'); return gw.autoriza === 'ok' ? { ok: true, referencia: `gw-${c.pagamentoId}` } : { ok: false, motivo: 'cartão recusado' } },
  captura: async (c) => { gwLog.push('captura'); return { ok: true, referencia: `gw-${c.pagamentoId}` } }, cancela: async () => {}, estorna: async (c) => ({ ok: true, referencia: `e-${c.pagamentoId}` }),
}
const estoqueFora = { vezes: 0 }
const cotacoes = new Map<string, Cotacao>()
const portas: Portas = {
  catalogo: { cotacao: async (_c, id) => cotacoes.get(id) ?? null },
  estoque: portaEstoque({ chama: async (_t, _m, caminho, corpo) => { if (estoqueFora.vezes > 0) { estoqueFora.vezes--; return { status: 503, corpo: null } } return est(await token('saga', ['estoque.sistema']), 'POST', caminho, corpo) } }),
  pagamento: portaPagamento({ chama: async (_t, _m, caminho, corpo) => pag(await token('saga', ['pagamentos.sistema']), 'POST', caminho, corpo) }),
}
let vendas!: ReturnType<typeof criaVendas>, estoque!: ReturnType<typeof criaEstoque>
let seq = 0
const reset = async () => { await sqlV(`UPDATE vendas.outbox SET publicado_em = now() WHERE publicado_em IS NULL`); gwLog.length = 0; gw.autoriza = 'ok'; estoqueFora.vezes = 0 }
async function pedidoCom(qtd: number, chaveSufixo = ''): Promise<string> {
  const t = await token('ana', ['vendas.operador']); const c = (await ven(t, 'POST', '/carrinhos', { criadoPor: 'ana' })).corpo.id
  const cot: Cotacao = { id: `aaaaaaaa-0000-0000-0000-${String(++seq).padStart(12, '0')}`, produtoId: PROD, varianteId: null, quantidade: String(qtd), precoUnitario: '10.00', criadoEm: new Date().toISOString() }
  cotacoes.set(cot.id, cot); expect((await ven(t, 'POST', `/carrinhos/${c}/itens`, { cotacaoId: cot.id })).status).toBe(200)
  return (await ven(t, 'POST', `/carrinhos/${c}/finalizar`, { chaveIdempotencia: `chave-completa-${seq}${chaveSufixo}` })).corpo.id
}
/** relay do outbox de Vendas → barramento → (saga de Vendas) + (baixa do Estoque), como em produção */
async function entrega() { const bus = criaBarramentoMemoria({ maxTentativas: 1 }); bus.assina(vendas.consumidor(dbDe(() => pgV))); bus.assina(estoque.consumidor(dbDe(() => pgE))); const relay = criaRelay({ db: dbRelayV, servico: 'vendas', barramento: bus, espera: () => 0 })
  for (let i = 0; i < 6; i++) { const r = await relay.executa(); await bus.aguarda(); if (!r.publicados) break } // a saga publica `pedido.confirmado` DURANTE a rodada: o relay roda de novo, como o polling de produção
  return bus }
const pedido = async (id: string) => (await sqlV(`SELECT status, motivo_falha AS motivo FROM vendas.pedido WHERE id = $1`, [id]))[0]!
const saldo = async () => (await sqlE(`SELECT to_char(quantidade, 'FM999999990.0000') AS q, to_char(reservado, 'FM999999990.0000') AS r FROM estoque.saldo WHERE item_id = $1`, [PROD]))[0]!
const reservaDe = async (id: string) => (await sqlE(`SELECT status, motivo FROM estoque.reserva WHERE pedido_id = $1`, [id]))[0]
const pagoDe = async (id: string) => (await sqlP(`SELECT status FROM pagamentos.pagamento WHERE pedido_id = $1`, [id]))[0]
const abastece = async (n: number) => { const o = await token('olga', ['estoque.operador']); await est(o, 'POST', '/estoque/entrada', { produtoId: PROD, depositoId: DEP, quantidade: n, custoUnitario: '4.00', chave: `abastece-${++seq}-${n}-xxxx` }) }
const zera = async () => { const o = await token('olga', ['estoque.operador']); await est(o, 'POST', '/estoque/ajuste', { produtoId: PROD, depositoId: DEP, quantidadeContada: 0, chave: `zera-${++seq}-xxxxxxxx` }) }

beforeAll(async () => {
  const k = await generateKeyPair('RS256'); priv = k.privateKey
  const prepara = async (no: No, schema: string) => { const pg = new PGlite(); await pg.exec(`CREATE ROLE migrador NOLOGIN BYPASSRLS; CREATE ROLE relay NOLOGIN BYPASSRLS; CREATE ROLE app NOLOGIN; GRANT CREATE ON DATABASE postgres TO migrador; SET ROLE migrador;`); await pg.exec(emite(no, 'sql')); await pg.exec(`RESET ROLE; GRANT USAGE ON SCHEMA ${schema} TO app, relay; GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA ${schema} TO app, relay;`); return pg }
  pgV = await prepara(noV, 'vendas'); pgP = await prepara(noP, 'pagamentos'); pgE = await prepara(noE, 'estoque')
  const autentica = criaAutenticadorJwt({ emissor: ISS, audiencia: AUD, chave: { publica: k.publicKey } })
  vendas = criaVendas(noV, { portas, eventos }); estoque = criaEstoque(noE)
  appV = criaServico(noV, { db: dbDe(() => pgV), acesso: regrasDoRegistry(regV), contexto: contextoPorJwt(autentica), operacoes: vendas.operacoes, eventos })
  appP = criaServico(noP, { db: dbDe(() => pgP), acesso: regrasDoRegistry(regP), contexto: contextoPorJwt(autentica), operacoes: criaPagamentos(noP, { provedores: { gateway, interno: provedorInterno } }).operacoes })
  appE = criaServico(noE, { db: dbDe(() => pgE), acesso: regrasDoRegistry(regE), contexto: contextoPorJwt(autentica), operacoes: estoque.operacoes })
  await appV.ready(); await appP.ready(); await appE.ready()
  const fin = await token('fin', ['pagamentos.financeiro']); expect((await pag(fin, 'POST', '/config-pagamento', { metodo: 'pix', provedor: 'gateway', taxaPercentual: 1.5 })).status).toBe(201)
  DEP = (await est(await token('gil', ['estoque.gerente']), 'POST', '/depositos', { codigo: 'LOJA', nome: 'Loja', padrao: true })).corpo.id
})
afterAll(async () => { await appV.close(); await appP.close(); await appE.close(); await pgV.close(); await pgP.close(); await pgE.close() })

describe('venda completa: Vendas + Estoque + Pagamentos', () => {
  it('compra feliz: reserva → cobra → confirma → o estoque BAIXA pelo evento; nada fica reservado', async () => {
    await reset(); await abastece(10); const id = await pedidoCom(2); const bus = await entrega(); expect(bus.mortas()).toEqual([])
    expect(await pedido(id)).toMatchObject({ status: 'confirmado' }); expect(await pagoDe(id)).toEqual({ status: 'pago' }); expect(await reservaDe(id)).toMatchObject({ status: 'confirmada' })
    expect(await saldo()).toEqual({ q: '8.0000', r: '0.0000' }); expect((await sqlE(`SELECT tipo, to_char(delta, 'FM990.0000') AS d FROM estoque.movimento WHERE ref_id = $1`, [id]))).toEqual([{ tipo: 'venda', d: '-2.0000' }])
  })
  it('SEM ESTOQUE: a reserva é recusada, o pedido falha com o motivo e o pagamento NEM É TENTADO', async () => {
    await reset(); const antes = await saldo(); const id = await pedidoCom(50); await entrega()
    expect(await pedido(id)).toMatchObject({ status: 'falhou' }); expect((await pedido(id)).motivo).toContain('sem estoque'); expect(gwLog).toEqual([]); expect(await pagoDe(id)).toBeUndefined()
    expect(await reservaDe(id)).toMatchObject({ status: 'recusada' }); expect(await saldo()).toEqual(antes)
  })
  it('pagamento recusado: a reserva é LIBERADA (compensação real entre serviços) e o saldo fica intacto', async () => {
    await reset(); const antes = await saldo(); gw.autoriza = 'recusa'; const id = await pedidoCom(3); await entrega()
    expect(await pedido(id)).toMatchObject({ status: 'falhou' }); expect(await reservaDe(id)).toMatchObject({ status: 'liberada' }); expect(await saldo()).toEqual(antes); expect(await pagoDe(id)).toEqual({ status: 'falhou' })
  })
  it('DOIS pedidos disputam o que resta: um confirma, o outro falha; NUNCA vende o que não tem', async () => {
    await reset(); await zera(); await abastece(3); const a = await pedidoCom(2), b = await pedidoCom(2); await entrega()
    const st = [(await pedido(a)).status, (await pedido(b)).status].sort(); expect(st).toEqual(['confirmado', 'falhou'])
    expect(await saldo()).toEqual({ q: '1.0000', r: '0.0000' }) // 3 − 2 vendidos; nada negativo, nada preso
  })
  it('estoque FORA DO AR (503): a saga repete sem compensar nem cobrar; ao voltar conclui uma vez', async () => {
    await reset(); await zera(); await abastece(5); estoqueFora.vezes = 1; const id = await pedidoCom(1); const bus = await entrega(); expect(bus.mortas().length).toBe(1)
    expect((await pedido(id)).status).toBe('criado'); expect(gwLog).toEqual([]); expect(await reservaDe(id)).toBeUndefined()
    const r = await ven(await token('gil', ['vendas.gerente']), 'POST', `/pedidos/${id}/processar`); expect(r.corpo.status).toBe('confirmado')
    await entrega(); expect(await saldo()).toEqual({ q: '4.0000', r: '0.0000' }); expect((await sqlE(`SELECT count(*)::int AS n FROM estoque.movimento WHERE ref_id = $1`, [id]))[0]!.n).toBe(1) // a baixa aconteceu uma vez
  })
})
