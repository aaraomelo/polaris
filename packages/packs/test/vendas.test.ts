process.env.POLARIS_LOG_NIVEL = 'silencio'
import { vi } from 'vitest'
vi.setConfig({ testTimeout: 40_000, hookTimeout: 40_000 })
import { PGlite } from '@electric-sql/pglite'
import { criaAutenticadorJwt } from '@polaris/acesso'
import { criaBarramentoMemoria, criaRelay, type Consulta, type DbSistema, type DbTenant, type Envelope } from '@polaris/eventos'
import { Registry, emite, type No } from '@polaris/schema'
import { contextoPorJwt, criaServico, regrasDoRegistry, type Contexto } from '@polaris/servico'
import type { KeyObject } from 'node:crypto'
import { SignJWT, generateKeyPair } from 'jose'

type KeyLike = CryptoKey | KeyObject
import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { criaVendas, multiplica, nosDoPack, operacoesCatalogo, soma, type PedidoSaga, type Portas, type Resultado } from '../src/index'

const A = '11111111-1111-1111-1111-111111111111', B = '22222222-2222-2222-2222-222222222222'
const ISS = 'https://id.teste', AUD = 'polaris'

describe('dinheiro: preço × quantidade e soma, exatos', () => {
  it('sem float e com arredondamento meio-para-cima em 4 casas', () => {
    expect(multiplica('49.90', '3')).toBe('149.70'); expect(multiplica('19.99', '2.5')).toBe('49.975'); expect(multiplica('0.0001', '0.5')).toBe('0.0001'); expect(multiplica('0.0001', '0.4')).toBe('0.00')
    expect(multiplica('0.10', '3')).toBe('0.30'); expect(soma(['0.10', '0.20', '0.30'])).toBe('0.60'); expect(soma(['100.00', '49.90'])).toBe('149.90')
    for (const q of ['', 'x', '1.23456', '-1', '1e3']) expect(() => multiplica('1', q), q).toThrow('quantidade inválida')
  })
})

const regC = new Registry(), regV = new Registry()
for (const n of nosDoPack('catalogo')) regC.registra(n)
for (const n of nosDoPack('vendas')) regV.registra(n)
const noC = regC.resolve('servico', 'catalogo')!.no, noV = regV.resolve('servico', 'vendas')!.no
const eventos = Object.fromEntries(regV.ids('evento').map((id) => [id, regV.resolve('evento', id)!.no])) as Record<string, No>

let pg: PGlite, appC: FastifyInstance, appV: FastifyInstance, priv: KeyLike, relogio = Date.now()
const consulta = (tx: { query: PGlite['query'] }): Consulta => async (sql, params) => { const r = await tx.query(sql, params as unknown[]); return { rows: r.rows as Record<string, unknown>[], rowCount: r.affectedRows ?? r.rows.length } }
const dbApp: DbTenant = { transacao: (t, fn) => pg.transaction(async (tx) => { await tx.exec('SET LOCAL ROLE app'); await tx.query(`SELECT set_config('app.tenant_id', $1, true)`, [t]); return fn(consulta(tx)) }) }
const dbRelay: DbSistema = { transacao: (fn) => pg.transaction(async (tx) => { await tx.exec('SET LOCAL ROLE relay'); return fn(consulta(tx)) }) }
const sistema = async (sql: string, p: unknown[] = []) => (await dbRelay.transacao((q) => q(sql, p))).rows as Array<Record<string, any>>
const token = (sub: string, papeis: string[], tid = A) => new SignJWT({ tid, papeis }).setProtectedHeader({ alg: 'RS256' }).setSubject(sub).setIssuer(ISS).setAudience(AUD).setExpirationTime('10m').sign(priv)
const http = (app: FastifyInstance) => async (tok: string, m: string, url: string, corpo: unknown = m === 'POST' ? {} : undefined) => { const r = await app.inject({ method: m as 'GET', url, headers: { authorization: `Bearer ${tok}`, ...(corpo !== undefined ? { 'content-type': 'application/json' } : {}) }, ...(corpo !== undefined ? { payload: JSON.stringify(corpo) } : {}) }); return { status: r.statusCode, corpo: r.body ? JSON.parse(r.body) : null } }
let cat: ReturnType<typeof http>, ven: ReturnType<typeof http>

// as portas: estoque e pagamento em memória, IDEMPOTENTES pelo pedido (como o contrato exige)
const cotacoes = new Map<string, any>()
const log: string[] = []
const comp = { estoque: 'ok' as 'ok' | 'recusa' | 'cai', pag: 'ok' as 'ok' | 'recusa', captura: 'ok' as 'ok' | 'recusa' }
const res = (r: string, ref: string): Resultado => (r === 'ok' ? { ok: true, referencia: ref } : { ok: false, motivo: `${ref} recusado` })
const efeitos = new Set<string>()
const portas: Portas = {
  // em produção esta porta chama o serviço Catálogo por HTTP (outra conexão). Aqui o PGlite tem UMA conexão e a chamada, feita dentro da transação de Vendas, travaria:
  // então a porta lê as cotações que a API REAL do Catálogo devolveu (guardadas por tenant) — um tenant nunca enxerga a cotação de outro.
  catalogo: { cotacao: async (ctx: Contexto, id) => cotacoes.get(`${ctx.tenantId}|${id}`) ?? null },
  estoque: {
    reserva: async (p: PedidoSaga) => { log.push('reserva'); if (comp.estoque === 'cai') throw new Error('estoque fora do ar'); if (comp.estoque === 'ok') efeitos.add(`reserva:${p.pedidoId}`); return res(comp.estoque, `res-${p.pedidoId}`) },
    libera: async (p, ref) => { log.push(`libera:${ref}`); efeitos.delete(`reserva:${p.pedidoId}`) },
  },
  pagamento: {
    autoriza: async (p) => { log.push('autoriza'); if (comp.pag === 'ok') efeitos.add(`aut:${p.pedidoId}`); return res(comp.pag, `aut-${p.pedidoId}`) },
    cancela: async (p, ref) => { log.push(`cancela:${ref}`); efeitos.delete(`aut:${p.pedidoId}`) },
    captura: async (p, ref) => { log.push(`captura:${ref}`); return res(comp.captura, `cap-${p.pedidoId}`) },
  },
}
let vendas!: ReturnType<typeof criaVendas>
const reset = async () => { await sistema(`UPDATE vendas.outbox SET publicado_em = now() WHERE publicado_em IS NULL`); log.length = 0; comp.estoque = 'ok'; comp.pag = 'ok'; comp.captura = 'ok'; efeitos.clear() }

let un = '', p1 = '', p2 = ''
const cotar = async (produtoId: string, quantidade: number, tid = A) => { const c = (await cat(await token('ana', ['catalogo.vendedor'], tid), 'POST', '/cotar', { produtoId, quantidade })).corpo; cotacoes.set(`${tid}|${c.id}`, c); return c.id as string }
/** carrinho da `usuario` com os itens; devolve ids */
async function carrinhoCom(usuario: string, itens: Array<[string, number]>) {
  const t = await token(usuario, ['vendas.operador'])
  const c = (await ven(t, 'POST', '/carrinhos', { criadoPor: usuario })).corpo.id as string
  for (const [p, q] of itens) { const r = await ven(t, 'POST', `/carrinhos/${c}/itens`, { cotacaoId: await cotar(p, q) }); expect(r.status).toBe(200) }
  return { t, c }
}
const pedidoDe = async (id: string) => (await sistema(`SELECT status, total::text AS total, motivo_falha AS motivo FROM vendas.pedido WHERE id = $1`, [id]))[0]!
const passos = async (id: string) => Object.fromEntries((await sistema(`SELECT passo, estado FROM vendas.passo_saga WHERE pedido_id = $1`, [id])).map((r) => [r.passo, r.estado]))
const eventosDe = async (id: string) => (await sistema(`SELECT tipo FROM vendas.outbox WHERE chave = $1 ORDER BY ocorrido_em, tipo`, [id])).map((r) => r.tipo as string)
/** roda o relay + barramento + consumidor da saga, como em produção (relay → barramento → inbox → saga) */
async function entrega() { const bus = criaBarramentoMemoria({ maxTentativas: 1 }); bus.assina(vendas.consumidor(dbApp)); await criaRelay({ db: dbRelay, servico: 'vendas', barramento: bus, espera: () => 0 }).executa(); await bus.aguarda(); return bus }

beforeAll(async () => {
  const k = await generateKeyPair('RS256'); priv = k.privateKey
  pg = new PGlite(); await pg.exec(`CREATE ROLE migrador NOLOGIN BYPASSRLS; CREATE ROLE relay NOLOGIN BYPASSRLS; CREATE ROLE app NOLOGIN; GRANT CREATE ON DATABASE postgres TO migrador; SET ROLE migrador;`)
  await pg.exec(emite(noC, 'sql')); await pg.exec(emite(noV, 'sql'))
  await pg.exec(`RESET ROLE; GRANT USAGE ON SCHEMA catalogo, vendas TO app, relay; GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA catalogo, vendas TO app, relay;`)
  const autentica = criaAutenticadorJwt({ emissor: ISS, audiencia: AUD, chave: { publica: k.publicKey } })
  vendas = criaVendas(noV, { portas, eventos, agora: () => relogio })
  appC = criaServico(noC, { db: dbApp, acesso: regrasDoRegistry(regC), contexto: contextoPorJwt(autentica), operacoes: operacoesCatalogo(noC) })
  appV = criaServico(noV, { db: dbApp, acesso: regrasDoRegistry(regV), contexto: contextoPorJwt(autentica), operacoes: vendas.operacoes, eventos })
  await appC.ready(); await appV.ready(); cat = http(appC); ven = http(appV)
  const g = await token('gil', ['catalogo.gerente'])
  un = (await cat(g, 'POST', '/unidades', { codigo: 'UN', descricao: 'Unidade' })).corpo.id
  p1 = (await cat(g, 'POST', '/produtos', { sku: 'A', nome: 'A', unidadeId: un, preco: '100.00' })).corpo.id
  p2 = (await cat(g, 'POST', '/produtos', { sku: 'B', nome: 'B', unidadeId: un, preco: '49.90' })).corpo.id
})
afterAll(async () => { await appC.close(); await appV.close(); await pg.close() })

describe('carrinho → pedido → saga, ponta a ponta', () => {
  it('fluxo feliz: total exato, evento no outbox, relay → barramento → saga confirma; cada efeito UMA vez', async () => {
    await reset(); const { t, c } = await carrinhoCom('ana', [[p1, 2], [p2, 1]])
    const f = await ven(t, 'POST', `/carrinhos/${c}/finalizar`, { chaveIdempotencia: 'chave-feliz-0001' }); expect(f.status).toBe(200)
    expect(f.corpo).toMatchObject({ status: 'criado', total: '249.9000', criadoPor: 'ana' }); const id = f.corpo.id
    expect(await eventosDe(id)).toEqual(['pedido.criado'])
    expect((await sistema(`SELECT status FROM vendas.carrinho WHERE id = $1`, [c]))[0]!.status).toBe('finalizado')
    expect((await sistema(`SELECT count(*)::int AS n FROM vendas.item_pedido WHERE pedido_id = $1`, [id]))[0]!.n).toBe(2)
    const bus = await entrega(); expect(bus.mortas()).toEqual([])
    expect(await pedidoDe(id)).toEqual({ status: 'confirmado', total: '249.9000', motivo: null }); expect(await passos(id)).toEqual({ estoque: 'ok', autorizacao: 'ok', captura: 'ok' })
    expect(log).toEqual(['reserva', 'autoriza', `captura:aut-${id}`]); expect(await eventosDe(id)).toEqual(['pedido.criado', 'pedido.confirmado'])
  })
  it('finalizar é IDEMPOTENTE: a mesma chave devolve o MESMO pedido (1 pedido, 1 evento); chave de outro carrinho é 409', async () => {
    await reset(); const { t, c } = await carrinhoCom('ana', [[p1, 1]])
    const a = await ven(t, 'POST', `/carrinhos/${c}/finalizar`, { chaveIdempotencia: 'chave-idem-0001' }), b = await ven(t, 'POST', `/carrinhos/${c}/finalizar`, { chaveIdempotencia: 'chave-idem-0001' })
    expect(b.status).toBe(200); expect(b.corpo.id).toBe(a.corpo.id)
    expect((await sistema(`SELECT count(*)::int AS n FROM vendas.pedido WHERE carrinho_id = $1`, [c]))[0]!.n).toBe(1); expect(await eventosDe(a.corpo.id)).toEqual(['pedido.criado'])
    const outro = await carrinhoCom('ana', [[p2, 1]])
    const x = await ven(outro.t, 'POST', `/carrinhos/${outro.c}/finalizar`, { chaveIdempotencia: 'chave-idem-0001' }); expect(x.status).toBe(409); expect(x.corpo.erro.codigo).toBe('chave_reutilizada')
    const y = await ven(t, 'POST', `/carrinhos/${c}/finalizar`, { chaveIdempotencia: 'outra-chave-0002' }); expect(y.status).toBe(409); expect(y.corpo.erro.codigo).toBe('carrinho_fechado')
  })
  it('carrinho vazio, chave curta e item em carrinho fechado são recusados', async () => {
    const t = await token('ana', ['vendas.operador']); const c = (await ven(t, 'POST', '/carrinhos', { criadoPor: 'ana' })).corpo.id
    expect((await ven(t, 'POST', `/carrinhos/${c}/finalizar`, { chaveIdempotencia: 'chave-vazio-001' })).corpo.erro.codigo).toBe('carrinho_vazio')
    expect((await ven(t, 'POST', `/carrinhos/${c}/finalizar`, { chaveIdempotencia: 'curta' })).status).toBe(400)
    const { t: t2, c: c2 } = await carrinhoCom('ana', [[p1, 1]]); await ven(t2, 'POST', `/carrinhos/${c2}/finalizar`, { chaveIdempotencia: 'chave-fecha-001' })
    expect((await ven(t2, 'POST', `/carrinhos/${c2}/itens`, { cotacaoId: await cotar(p1, 1) })).corpo.erro.codigo).toBe('carrinho_fechado')
  })
})

describe('o preço NUNCA vem do cliente', () => {
  it('campo de preço no corpo é recusado; cotação de outro tenant, inexistente e expirada não valem; repetida é 409', async () => {
    await reset(); const t = await token('ana', ['vendas.operador']); const c = (await ven(t, 'POST', '/carrinhos', { criadoPor: 'ana' })).corpo.id
    expect((await ven(t, 'POST', `/carrinhos/${c}/itens`, { cotacaoId: await cotar(p1, 1), precoUnitario: '0.01' })).status).toBe(400)
    const gB = await token('zé', ['catalogo.gerente'], B), unB = (await cat(gB, 'POST', '/unidades', { codigo: 'UN', descricao: 'U' })).corpo.id
    const pB = (await cat(gB, 'POST', '/produtos', { sku: 'A', nome: 'B', unidadeId: unB, preco: '1.00' })).corpo.id
    expect((await ven(t, 'POST', `/carrinhos/${c}/itens`, { cotacaoId: await cotar(pB, 1, B) })).corpo.erro.codigo).toBe('cotacao_invalida') // o catálogo do tenant A não enxerga a cotação do B
    expect((await ven(t, 'POST', `/carrinhos/${c}/itens`, { cotacaoId: '99999999-9999-9999-9999-999999999999' })).corpo.erro.codigo).toBe('cotacao_invalida')
    const cot = await cotar(p1, 1); expect((await ven(t, 'POST', `/carrinhos/${c}/itens`, { cotacaoId: cot })).status).toBe(200)
    expect((await ven(t, 'POST', `/carrinhos/${c}/itens`, { cotacaoId: cot })).status).toBe(409)
    // expirada: a cotação foi criada antes (relógio do banco) e o relógio injetado avançou
    const velha = await cotar(p2, 3); relogio += 31 * 60_000; try { const r = await ven(t, 'POST', `/carrinhos/${c}/itens`, { cotacaoId: velha }); expect(r.corpo.erro.codigo).toBe('cotacao_expirada') } finally { relogio -= 31 * 60_000 }
  })
})

describe('isolamento por usuário e por papel', () => {
  it('o operador só vê e mexe nos SEUS carrinhos e pedidos (404, não revela); o gerente enxerga todos', async () => {
    await reset(); const ana = await carrinhoCom('ana', [[p1, 1]]); const bia = await token('bia', ['vendas.operador']), gil = await token('gil', ['vendas.gerente'])
    expect((await ven(bia, 'GET', `/carrinhos/${ana.c}`)).status).toBe(404)
    expect((await ven(bia, 'POST', `/carrinhos/${ana.c}/itens`, { cotacaoId: await cotar(p2, 1) })).status).toBe(404)
    expect((await ven(bia, 'POST', `/carrinhos/${ana.c}/finalizar`, { chaveIdempotencia: 'chave-invasao-1' })).status).toBe(404)
    expect((await ven(bia, 'POST', '/carrinhos', { criadoPor: 'ana' })).status).toBe(403) // criar em nome de outro
    expect((await ven(bia, 'POST', '/carrinhos', { criadoPor: 'bia', status: 'finalizado' })).status).toBe(403) // status só o servidor muda
    expect((await ven(gil, 'GET', `/carrinhos/${ana.c}`)).status).toBe(200)
    const f = await ven(ana.t, 'POST', `/carrinhos/${ana.c}/finalizar`, { chaveIdempotencia: 'chave-papel-001' }); expect(f.status).toBe(200)
    expect((await ven(bia, 'GET', `/pedidos/${f.corpo.id}`)).status).toBe(404); expect((await ven(bia, 'POST', `/pedidos/${f.corpo.id}/cancelar`)).status).toBe(404)
    expect((await ven(ana.t, 'POST', `/pedidos/${f.corpo.id}/processar`)).status).toBe(403) // processar é do gerente
    expect((await ven(ana.t, 'GET', '/passos-saga')).status).toBe(403)
    const outroTenant = await token('ana', ['vendas.operador'], B); expect((await ven(outroTenant, 'GET', `/pedidos/${f.corpo.id}`)).status).toBe(404)
  })
})

describe('a saga: compensação e retomada', () => {
  const novoPedido = async (chave: string) => { const { t, c } = await carrinhoCom('ana', [[p1, 1]]); return { t, id: (await ven(t, 'POST', `/carrinhos/${c}/finalizar`, { chaveIdempotencia: chave })).corpo.id as string } }
  it('pagamento recusado: o estoque reservado é LIBERADO (compensação), pedido falha com motivo e o evento sai', async () => {
    await reset(); comp.pag = 'recusa'; const { id } = await novoPedido('chave-pagrec-001'); await entrega()
    expect(await pedidoDe(id)).toMatchObject({ status: 'falhou', motivo: 'autorizacao: aut-' + id + ' recusado' })
    expect(await passos(id)).toEqual({ estoque: 'compensado', autorizacao: 'falhou' }); expect(log).toEqual(['reserva', 'autoriza', `libera:res-${id}`]); expect(efeitos.size).toBe(0)
    expect(await eventosDe(id)).toEqual(['pedido.criado', 'pedido.falhou'])
  })
  it('captura recusada: cancela a autorização E libera o estoque, na ordem inversa', async () => {
    await reset(); comp.captura = 'recusa'; const { id } = await novoPedido('chave-caprec-001'); await entrega()
    expect((await pedidoDe(id)).status).toBe('falhou'); expect(await passos(id)).toEqual({ estoque: 'compensado', autorizacao: 'compensado', captura: 'falhou' })
    expect(log).toEqual(['reserva', 'autoriza', `captura:aut-${id}`, `cancela:aut-${id}`, `libera:res-${id}`]); expect(efeitos.size).toBe(0)
  })
  it('estoque recusa: nada a compensar, o pagamento nem é tentado', async () => {
    await reset(); comp.estoque = 'recusa'; const { id } = await novoPedido('chave-estrec-001'); await entrega()
    expect(await pedidoDe(id)).toMatchObject({ status: 'falhou' }); expect(log).toEqual(['reserva']); expect(await passos(id)).toEqual({ estoque: 'falhou' })
  })
  it('falha TRANSITÓRIA (porta lança): a transação desfaz tudo; a nova entrega completa e o efeito acontece uma vez', async () => {
    await reset(); comp.estoque = 'cai'; const { id } = await novoPedido('chave-queda-0001')
    const bus1 = await entrega(); expect(bus1.mortas().length).toBe(1) // maxTentativas 1: o evento morreu no barramento, mas o OUTBOX já o marcou publicado
    expect((await pedidoDe(id)).status).toBe('criado'); expect(await passos(id)).toEqual({}) // nada ficou pela metade
    comp.estoque = 'ok'; const env = { id: (await sistema(`SELECT id::text AS id FROM vendas.outbox WHERE chave = $1 AND tipo = 'pedido.criado'`, [id]))[0]!.id, tipo: 'pedido.criado', versao: '1.0.0', tenantId: A, ocorridoEm: new Date().toISOString(), payload: { pedidoId: id, total: '100.00' } } as Envelope
    const cons = vendas.consumidor(dbApp); expect(await cons.processa(env)).toBe('processado'); expect(await cons.processa(env)).toBe('duplicado')
    expect(await pedidoDe(id)).toMatchObject({ status: 'confirmado' }); expect(log.filter((l) => l === 'reserva').length).toBe(2) // tentou 2x, mas o efeito (idempotente) existe 1x
    expect([...efeitos].filter((e) => e.startsWith('reserva:'))).toEqual([`reserva:${id}`])
    expect(log.filter((l) => l.startsWith('captura')).length).toBe(1)
  })
  it('entrega repetida do evento: a saga roda UMA vez (inbox); reprocessar pedido já confirmado é no-op', async () => {
    await reset(); const { id } = await novoPedido('chave-dupla-0001'); await entrega(); const n = log.length
    const g = await token('gil', ['vendas.gerente']); const r = await ven(g, 'POST', `/pedidos/${id}/processar`); expect(r.status).toBe(200); expect(r.corpo.status).toBe('confirmado'); expect(log.length).toBe(n)
    await entrega(); expect(log.length).toBe(n); expect((await sistema(`SELECT count(*)::int AS n FROM vendas.outbox WHERE chave = $1 AND tipo = 'pedido.confirmado'`, [id]))[0]!.n).toBe(1)
  })
  it('cancelar: antes do processamento cancela e a saga depois não faz nada; pedido confirmado não se cancela aqui (409)', async () => {
    await reset(); const { t, id } = await novoPedido('chave-cancel-001')
    expect((await ven(t, 'POST', `/pedidos/${id}/cancelar`)).corpo.status).toBe('cancelado'); expect((await ven(t, 'POST', `/pedidos/${id}/cancelar`)).corpo.status).toBe('cancelado') // idempotente
    await entrega(); expect(log).toEqual([]); expect((await pedidoDe(id)).status).toBe('cancelado')
    const n2 = await novoPedido('chave-cancel-002'); await entrega(); const r = await ven(n2.t, 'POST', `/pedidos/${n2.id}/cancelar`); expect(r.status).toBe(409); expect(r.corpo.erro.codigo).toBe('nao_cancelavel')
  })
  it('o gerente reprocessa um pedido que ficou em `criado` (evento perdido)', async () => {
    await reset(); const { id } = await novoPedido('chave-manual-001'); const g = await token('gil', ['vendas.gerente'])
    const r = await ven(g, 'POST', `/pedidos/${id}/processar`); expect(r.corpo.status).toBe('confirmado'); expect(log).toEqual(['reserva', 'autoriza', `captura:aut-${id}`])
  })
})
