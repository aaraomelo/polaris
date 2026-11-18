process.env.POLARIS_LOG_NIVEL = 'silencio'
import { vi } from 'vitest'
vi.setConfig({ testTimeout: 40_000, hookTimeout: 40_000 })
import { PGlite } from '@electric-sql/pglite'
import { criaAutenticadorJwt } from '@polaris/acesso'
import type { Consulta, DbTenant, Envelope } from '@polaris/eventos'
import { Registry, emite } from '@polaris/schema'
import { contextoPorJwt, criaServico, regrasDoRegistry } from '@polaris/servico'
import { SignJWT, generateKeyPair, type KeyLike } from 'jose'
import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { criaEstoque, custoMedio, nosDoPack } from '../src/index'

const A = '11111111-1111-1111-1111-111111111111', B = '22222222-2222-2222-2222-222222222222'
const ISS = 'https://id.teste', AUD = 'polaris'
const id = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`
const P1 = id(101), P2 = id(102), V1 = id(111)

describe('custo médio ponderado (exato)', () => {
  it('pondera por quantidade; entrada sobre saldo zero assume o custo novo; arredonda meio para cima em 4 casas', () => {
    expect(custoMedio('10', '5.00', '10', '7.00')).toBe('6.00'); expect(custoMedio('0', '0', '4', '9.90')).toBe('9.90'); expect(custoMedio('3', '1.00', '3', '2.00')).toBe('1.50')
    expect(custoMedio('1', '0.0001', '2', '0.0001')).toBe('0.0001'); expect(custoMedio('2', '1.0000', '1', '1.0001')).toBe('1.00') // 1.00003 → 1.0000
    expect(custoMedio('2', '1.0000', '1', '1.0002')).toBe('1.0001') // 1.00007 → 1.0001
  })
})

const reg = new Registry(); for (const n of nosDoPack('estoque')) reg.registra(n)
for (const n of nosDoPack('vendas')) if ((n as { kind: string }).kind === 'evento') reg.registra(n) // o evento que o Estoque consome
const no = reg.resolve('servico', 'estoque')!.no
it('nós do pack Estoque: registram, referências resolvem, SQL e OpenAPI emitem (inbox incluído)', () => {
  expect(reg.verificaTudo().filter((x) => x.erros.length)).toEqual([]); expect(emite(no, 'sql')).toContain('"inbox"'); expect(() => emite(no, 'openapi')).not.toThrow()
})

let pg: PGlite, app: FastifyInstance, priv: KeyLike
const consulta = (tx: { query: PGlite['query'] }): Consulta => async (sql, params) => { const r = await tx.query(sql, params as unknown[]); return { rows: r.rows as Record<string, unknown>[], rowCount: r.affectedRows ?? r.rows.length } }
const dbApp: DbTenant = { transacao: (t, fn) => pg.transaction(async (tx) => { await tx.exec('SET LOCAL ROLE app'); await tx.query(`SELECT set_config('app.tenant_id', $1, true)`, [t]); return fn(consulta(tx)) }) }
const sql = async (s: string, p: unknown[] = []) => (await pg.transaction(async (tx) => { await tx.exec('SET LOCAL ROLE relay'); return tx.query(s, p) })).rows as Array<Record<string, any>>
const token = (sub: string, papeis: string[], tid = A) => new SignJWT({ tid, papeis }).setProtectedHeader({ alg: 'RS256' }).setSubject(sub).setIssuer(ISS).setAudience(AUD).setExpirationTime('10m').sign(priv)
const req = async (tok: string, m: string, url: string, corpo: unknown = m === 'POST' ? {} : undefined) => { const r = await app.inject({ method: m as 'GET', url, headers: { authorization: `Bearer ${tok}`, ...(corpo !== undefined ? { 'content-type': 'application/json' } : {}) }, ...(corpo !== undefined ? { payload: JSON.stringify(corpo) } : {}) }); return { status: r.statusCode, corpo: r.body ? JSON.parse(r.body) : null } }
let ger: string, op: string, sis: string, lei: string, D1 = '', D2 = ''
let ch = 0; const chave = (p = 'chave') => `${p}-estoque-${String(++ch).padStart(6, '0')}`
const saldo = async (item: string, dep: string) => (await sql(`SELECT to_char(quantidade, 'FM999999990.0000') AS q, to_char(reservado, 'FM999999990.0000') AS r, custo_medio::text AS c FROM estoque.saldo WHERE item_id = $1 AND deposito_id = $2`, [item, dep]))[0]
const entra = (item: string, dep: string, quantidade: number | string, custoUnitario: string, extra: object = {}) => req(op, 'POST', '/estoque/entrada', { produtoId: item === V1 ? P1 : item, ...(item === V1 ? { varianteId: V1 } : {}), depositoId: dep, quantidade, custoUnitario, chave: chave(), ...extra })
const reservar = (pedido: number, itens: Array<{ produtoId: string; quantidade: number | string; varianteId?: string }>, extra: object = {}) => req(sis, 'POST', '/reservas', { pedidoId: id(900 + pedido), itens, ...extra })

beforeAll(async () => {
  const k = await generateKeyPair('RS256'); priv = k.privateKey
  pg = new PGlite(); await pg.exec(`CREATE ROLE migrador NOLOGIN BYPASSRLS; CREATE ROLE relay NOLOGIN BYPASSRLS; CREATE ROLE app NOLOGIN; GRANT CREATE ON DATABASE postgres TO migrador; SET ROLE migrador;`)
  await pg.exec(emite(no, 'sql')); await pg.exec(`RESET ROLE; GRANT USAGE ON SCHEMA estoque TO app, relay; GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA estoque TO app, relay;`)
  app = criaServico(no, { db: dbApp, acesso: regrasDoRegistry(reg), contexto: contextoPorJwt(criaAutenticadorJwt({ emissor: ISS, audiencia: AUD, chave: { publica: k.publicKey } })), operacoes: criaEstoque(no).operacoes })
  await app.ready(); ger = await token('gil', ['estoque.gerente']); op = await token('olga', ['estoque.operador']); sis = await token('saga', ['estoque.sistema']); lei = await token('lia', ['estoque.leitor'])
  D1 = (await req(ger, 'POST', '/depositos', { codigo: 'LOJA', nome: 'Loja', padrao: true })).corpo.id; D2 = (await req(ger, 'POST', '/depositos', { codigo: 'CD', nome: 'Centro de distribuição' })).corpo.id
})
afterAll(async () => { await app.close(); await pg.close() })

describe('entrada, saída e ajuste', () => {
  it('entrada: cria o saldo e calcula o custo médio ponderado; idempotente pela chave; chave com outro conteúdo é 409', async () => {
    const c1 = chave(); const r1 = await req(op, 'POST', '/estoque/entrada', { produtoId: P1, depositoId: D1, quantidade: 10, custoUnitario: '5.00', chave: c1 }); expect(r1.status).toBe(200); expect(r1.corpo).toMatchObject({ tipo: 'entrada', delta: 10, custoUnitario: '5.0000' })
    await req(op, 'POST', '/estoque/entrada', { produtoId: P1, depositoId: D1, quantidade: 10, custoUnitario: '5.00', chave: c1 }) // repetição
    expect(await saldo(P1, D1)).toEqual({ q: '10.0000', r: '0.0000', c: '5.0000' })
    await entra(P1, D1, 10, '7.00'); expect(await saldo(P1, D1)).toEqual({ q: '20.0000', r: '0.0000', c: '6.0000' })
    expect((await req(op, 'POST', '/estoque/entrada', { produtoId: P1, depositoId: D1, quantidade: 99, custoUnitario: '5.00', chave: c1 })).corpo.erro.codigo).toBe('chave_reutilizada')
    expect((await sql(`SELECT count(*)::int AS n FROM estoque.movimento WHERE chave = $1`, [c1]))[0]!.n).toBe(1)
  })
  it('variante tem saldo próprio (itemId = variante); validações de quantidade, custo, chave e depósito', async () => {
    await entra(V1, D1, 3, '20.00'); expect(await saldo(V1, D1)).toMatchObject({ q: '3.0000' }); expect(await saldo(P1, D1)).toMatchObject({ q: '20.0000' })
    for (const [x, motivo] of [[0, 'zero'], [-1, 'negativa'], [1.23456, 'casas']] as const) expect((await entra(P2, D1, x, '1.00')).status, motivo).toBe(400)
    expect((await entra(P2, D1, 1, 'abc')).status).toBe(400); expect((await entra(P2, D1, 1, '1.00', { chave: 'curta' })).status).toBe(400); expect((await entra(P2, id(555), 1, '1.00')).status).toBe(404)
    const off = (await req(ger, 'POST', '/depositos', { codigo: 'OFF', nome: 'Off', ativo: false })).corpo.id; expect((await entra(P2, off, 1, '1.00')).corpo.erro.codigo).toBe('deposito_inativo')
  })
  it('saída: perda/consumo baixam ao custo médio; NUNCA deixa o saldo negativo; o reservado não se vende', async () => {
    await entra(P2, D1, 10, '2.00'); expect((await req(op, 'POST', '/estoque/saida', { produtoId: P2, depositoId: D1, quantidade: 11, tipo: 'perda', chave: chave() })).corpo.erro.codigo).toBe('estoque_insuficiente')
    expect((await reservar(1, [{ produtoId: P2, quantidade: 5 }])).corpo.status).toBe('ativa')
    expect((await req(op, 'POST', '/estoque/saida', { produtoId: P2, depositoId: D1, quantidade: 6, tipo: 'consumo', chave: chave() })).corpo.erro.codigo).toBe('estoque_insuficiente') // 10 − 5 reservados = 5 livres
    const s = await req(op, 'POST', '/estoque/saida', { produtoId: P2, depositoId: D1, quantidade: 5, tipo: 'perda', chave: chave() }); expect(s.corpo).toMatchObject({ tipo: 'perda', delta: -5, custoUnitario: '2.0000' })
    expect(await saldo(P2, D1)).toEqual({ q: '5.0000', r: '5.0000', c: '2.0000' }); expect((await req(op, 'POST', '/estoque/saida', { produtoId: P2, depositoId: D1, quantidade: 1, tipo: 'roubo', chave: chave() })).status).toBe(400)
  })
  it('ajuste de inventário grava a diferença; não aceita contagem abaixo do reservado', async () => {
    const a = await req(op, 'POST', '/estoque/ajuste', { produtoId: P1, depositoId: D1, quantidadeContada: 18, chave: chave() }); expect(a.corpo).toMatchObject({ tipo: 'ajuste', delta: -2 }); expect(await saldo(P1, D1)).toMatchObject({ q: '18.0000' })
    expect((await req(op, 'POST', '/estoque/ajuste', { produtoId: P2, depositoId: D1, quantidadeContada: 4, chave: chave() })).corpo.erro.codigo).toBe('abaixo_do_reservado') // reservado = 5
  })
  it('transferência: sai de um, entra no outro com o MESMO custo; idempotente; origem = destino é 400; insuficiente é 422', async () => {
    await entra(P1, D2, 2, '10.00'); const c = chave(); const t = await req(op, 'POST', '/estoque/transferir', { produtoId: P1, origemId: D1, destinoId: D2, quantidade: 4, chave: c }); expect(t.status).toBe(200)
    await req(op, 'POST', '/estoque/transferir', { produtoId: P1, origemId: D1, destinoId: D2, quantidade: 4, chave: c })
    expect(await saldo(P1, D1)).toMatchObject({ q: '14.0000', c: '6.0000' }); expect(await saldo(P1, D2)).toEqual({ q: '6.0000', r: '0.0000', c: '7.3333' }) // (2×10 + 4×6) / 6 = 7,3333
    expect((await req(op, 'POST', '/estoque/transferir', { produtoId: P1, origemId: D1, destinoId: D1, quantidade: 1, chave: chave() })).status).toBe(400)
    expect((await req(op, 'POST', '/estoque/transferir', { produtoId: P1, origemId: D1, destinoId: D2, quantidade: 999, chave: chave() })).status).toBe(422)
  })
})

describe('reservas', () => {
  it('reserva é idempotente por pedido (não reserva em dobro); soma itens repetidos', async () => {
    await entra(P1, D1, 100, '1.00'); const r = await reservar(10, [{ produtoId: P1, quantidade: 3 }, { produtoId: P1, quantidade: 2 }]); expect(r.corpo).toMatchObject({ status: 'ativa' })
    const antes = (await saldo(P1, D1))!.r; const r2 = await reservar(10, [{ produtoId: P1, quantidade: 3 }, { produtoId: P1, quantidade: 2 }]); expect(r2.corpo.id).toBe(r.corpo.id); expect((await saldo(P1, D1))!.r).toBe(antes)
    expect((await sql(`SELECT to_char(quantidade, 'FM999999990.0000') AS q FROM estoque.reserva_item WHERE reserva_id = $1`, [r.corpo.id])).map((x) => x.q)).toEqual(['5.0000'])
  })
  it('TUDO OU NADA: se um item falta, a reserva é RECUSADA com o motivo e nenhum item fica reservado', async () => {
    const antes = await saldo(P1, D1); const r = await reservar(11, [{ produtoId: P1, quantidade: 1 }, { produtoId: P2, quantidade: 999 }])
    expect(r.status).toBe(200); expect(r.corpo.status).toBe('recusada'); expect(r.corpo.motivo).toContain(P2); expect(await saldo(P1, D1)).toEqual(antes)
    expect((await reservar(11, [{ produtoId: P1, quantidade: 1 }])).corpo.status).toBe('recusada') // a recusa também é idempotente
  })
  it('entrada inválida: sem itens, item malformado, quantidade ≤ 0; sem depósito padrão no tenant é 422', async () => {
    for (const itens of [[], [{ produtoId: 'x', quantidade: 1 }], [{ produtoId: P1, quantidade: 0 }], [null]]) expect((await reservar(12, itens as never)).status, JSON.stringify(itens)).toBe(400)
    const sisB = await token('saga', ['estoque.sistema'], B); expect((await req(sisB, 'POST', '/reservas', { pedidoId: id(950), itens: [{ produtoId: P1, quantidade: 1 }] })).corpo.erro.codigo).toBe('sem_deposito_padrao')
  })
  it('liberar devolve o reservado; é idempotente; reserva confirmada não se libera', async () => {
    const r = (await reservar(13, [{ produtoId: P1, quantidade: 7 }])).corpo.id; const com = (await saldo(P1, D1))!.r
    const l = await req(sis, 'POST', `/reservas/${r}/liberar`); expect(l.corpo.status).toBe('liberada'); expect(Number((await saldo(P1, D1))!.r)).toBe(Number(com) - 7)
    await req(sis, 'POST', `/reservas/${r}/liberar`); expect(Number((await saldo(P1, D1))!.r)).toBe(Number(com) - 7)
    await reservar(14, [{ produtoId: P1, quantidade: 1 }]); await dbApp.transacao(A, (q) => criaEstoque(no).baixaDoPedido(q, A, id(914))); expect((await req(ger, 'POST', `/reservas/${(await sql(`SELECT id::text AS id FROM estoque.reserva WHERE pedido_id = $1`, [id(914)]))[0]!.id}/liberar`)).status).toBe(409)
  })
  it('reservas vencidas são liberadas pelo job (expirarReservas); as vigentes ficam', async () => {
    const velha = (await reservar(15, [{ produtoId: P1, quantidade: 4 }], { validadeMinutos: 1 })).corpo.id, viva = (await reservar(16, [{ produtoId: P1, quantidade: 2 }])).corpo.id
    await sql(`UPDATE estoque.reserva SET expira_em = now() - interval '1 minute' WHERE id = $1`, [velha]); const antes = Number((await saldo(P1, D1))!.r)
    const r = await req(ger, 'POST', '/reservas/expirar'); expect(r.status).toBe(200); expect(r.corpo.map((x: any) => x.id)).toEqual([velha]); expect(r.corpo[0].motivo).toBe('expirada')
    expect(Number((await saldo(P1, D1))!.r)).toBe(antes - 4); expect((await req(ger, 'GET', `/reservas/${viva}`)).corpo.status).toBe('ativa')
  })
})

describe('baixa do pedido confirmado (evento)', () => {
  const env = (pedido: number, tenant = A): Envelope => ({ id: `eeeeeeee-0000-0000-0000-${String(pedido).padStart(12, '0')}`, tipo: 'pedido.confirmado', versao: '1.0.0', tenantId: tenant, ocorridoEm: new Date().toISOString(), payload: { pedidoId: id(900 + pedido), total: '10.00' } })
  const est = criaEstoque(no)
  it('a reserva vira SAÍDA DE VENDA ao custo médio; o efeito acontece UMA vez mesmo com a entrega repetida; reprocessar é no-op', async () => {
    await entra(P2, D2, 20, '3.00');
    await reservar(20, [{ produtoId: P1, quantidade: 5 }]); const antes = await saldo(P1, D1); const cons = est.consumidor(dbApp)
    expect(await cons.processa(env(20))).toBe('processado'); expect(await cons.processa(env(20))).toBe('duplicado')
    const depois = await saldo(P1, D1); expect(Number(depois!.q)).toBe(Number(antes!.q) - 5); expect(Number(depois!.r)).toBe(Number(antes!.r) - 5)
    const m = (await sql(`SELECT tipo, to_char(delta, 'FM999999990.0000') AS d, custo_unitario::text AS c, ref_tipo, ref_id FROM estoque.movimento WHERE ref_id = $1`, [id(920)])); expect(m).toEqual([{ tipo: 'venda', d: '-5.0000', c: antes!.c, ref_tipo: 'pedido', ref_id: id(920) }])
    await dbApp.transacao(A, (q) => est.baixaDoPedido(q, A, id(920))); expect(await saldo(P1, D1)).toEqual(depois) // sem o inbox, a própria baixa é idempotente
    expect((await req(ger, 'GET', `/reservas`)).corpo.find((r: any) => r.pedidoId === id(920)).status).toBe('confirmada')
  })
  it('reserva EXPIRADA antes da confirmação: baixa direta se ainda há estoque livre', async () => {
    const r = (await reservar(21, [{ produtoId: P1, quantidade: 2 }])).corpo.id; await req(ger, 'POST', `/reservas/${r}/liberar`); const antes = await saldo(P1, D1)
    await est.consumidor(dbApp).processa(env(21)); expect(Number((await saldo(P1, D1))!.q)).toBe(Number(antes!.q) - 2)
    expect((await sql(`SELECT status, motivo FROM estoque.reserva WHERE pedido_id = $1`, [id(921)]))[0]).toEqual({ status: 'confirmada', motivo: 'reserva expirada: baixa direta' })
  })
  it('reserva expirada E sem estoque, ou pedido sem reserva: vira `divergente` para o time (o estoque não é tocado)', async () => {
    await entra(P2, D1, 1, '1.00')
    const r = (await reservar(22, [{ produtoId: P2, quantidade: 1 }])).corpo.id; await req(ger, 'POST', `/reservas/${r}/liberar`)
    await sql(`UPDATE estoque.saldo SET quantidade = reservado WHERE item_id = $1 AND deposito_id = $2`, [P2, D1]) // nada livre
    await est.consumidor(dbApp).processa(env(22)); expect((await sql(`SELECT status FROM estoque.reserva WHERE pedido_id = $1`, [id(922)]))[0]!.status).toBe('divergente')
    await est.consumidor(dbApp).processa(env(23)); expect((await sql(`SELECT status, motivo FROM estoque.reserva WHERE pedido_id = $1`, [id(923)]))[0]).toEqual({ status: 'divergente', motivo: 'pedido confirmado sem reserva de estoque' })
  })
})

describe('mínimo, papéis, isolamento e o invariante do razão', () => {
  it('gerente define mínimo/máximo (só esses campos); abaixoDoMinimo lista o que está no limite', async () => {
    const s = (await sql(`SELECT id::text AS id FROM estoque.saldo WHERE item_id = $1 AND deposito_id = $2`, [P1, D2]))[0]!.id
    expect((await req(ger, 'PATCH', `/saldos/${s}`, { quantidade: 1000 })).status).toBe(403); expect((await req(ger, 'PATCH', `/saldos/${s}`, { minimo: 10 })).status).toBe(200)
    expect((await req(lei, 'GET', '/estoque/abaixo-do-minimo')).corpo.map((x: any) => x.id)).toEqual([s]); expect((await req(ger, 'PATCH', `/saldos/${s}`, { minimo: 1 })).status).toBe(200); expect((await req(lei, 'GET', '/estoque/abaixo-do-minimo')).corpo).toEqual([])
  })
  it('papéis: leitor só lê; operador movimenta mas não cria depósito; sistema reserva mas não dá entrada; saldo não se cria nem se grava por API', async () => {
    expect((await req(lei, 'GET', '/saldos')).status).toBe(200); expect((await req(lei, 'POST', '/estoque/entrada', { produtoId: P1, depositoId: D1, quantidade: 1, custoUnitario: '1', chave: chave() })).status).toBe(403)
    expect((await req(op, 'POST', '/depositos', { codigo: 'X', nome: 'X' })).status).toBe(403); expect((await req(sis, 'POST', '/estoque/entrada', { produtoId: P1, depositoId: D1, quantidade: 1, custoUnitario: '1', chave: chave() })).status).toBe(403)
    expect((await req(ger, 'POST', '/saldos', { itemId: P1, produtoId: P1, depositoId: D1, quantidade: 999, reservado: 0, custoMedio: '1' })).status).toBe(404); expect((await req(ger, 'POST', '/movimentos', {})).status).toBe(404)
  })
  it('outro tenant não vê nem mexe: saldos, movimentos e reservas são isolados', async () => {
    const gerB = await token('gb', ['estoque.gerente'], B); expect((await req(gerB, 'GET', '/saldos')).corpo).toEqual([]); expect((await req(gerB, 'GET', `/depositos/${D1}`)).status).toBe(404)
    expect((await req(await token('ob', ['estoque.operador'], B), 'POST', '/estoque/entrada', { produtoId: P1, depositoId: D1, quantidade: 1, custoUnitario: '1', chave: chave() })).status).toBe(404)
  })
  it('INVARIANTE: para todo (item, depósito), a soma dos deltas do razão é igual ao saldo, e o reservado é a soma das reservas ativas', async () => {
    const dif = await sql(`SELECT s.item_id::text AS item, s.deposito_id::text AS dep, s.quantidade::text AS saldo, coalesce(m.soma, 0)::text AS razao FROM estoque.saldo s LEFT JOIN (SELECT item_id, deposito_id, sum(delta) AS soma FROM estoque.movimento GROUP BY 1, 2) m ON m.item_id = s.item_id AND m.deposito_id = s.deposito_id WHERE s.quantidade <> coalesce(m.soma, 0) AND s.tenant_id = $1`, [A])
    // o teste de divergência editou um saldo na mão (UPDATE direto) para simular o estado: só esse item pode divergir
    expect(dif.filter((d) => d.item !== P2)).toEqual([])
    const res = await sql(`SELECT s.item_id::text AS item, s.reservado::text AS r, coalesce(x.soma, 0)::text AS ativas FROM estoque.saldo s LEFT JOIN (SELECT i.item_id, i.deposito_id, sum(i.quantidade) AS soma FROM estoque.reserva_item i JOIN estoque.reserva r ON r.id = i.reserva_id AND r.status = 'ativa' GROUP BY 1, 2) x ON x.item_id = s.item_id AND x.deposito_id = s.deposito_id WHERE s.tenant_id = $1 AND s.reservado <> coalesce(x.soma, 0)`, [A])
    expect(res.filter((d) => d.item !== P2)).toEqual([])
  })
})
