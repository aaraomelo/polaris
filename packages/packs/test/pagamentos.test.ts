process.env.POLARIS_LOG_NIVEL = 'silencio'
import { vi } from 'vitest'
vi.setConfig({ testTimeout: 40_000, hookTimeout: 40_000 })
import { PGlite } from '@electric-sql/pglite'
import { criaAutenticadorJwt } from '@polaris/acesso'
import { Registry, emite } from '@polaris/schema'
import { contextoPorJwt, criaServico, regrasDoRegistry, type Consulta } from '@polaris/servico'
import type { DbTenant } from '@polaris/eventos'
import { SignJWT, generateKeyPair, type KeyLike } from 'jose'
import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { criaPagamentos, nosDoPack, percentual, proporcional, provedorInterno, subtrai, type Provedor } from '../src/index'

const A = '11111111-1111-1111-1111-111111111111', B = '22222222-2222-2222-2222-222222222222'
const ISS = 'https://id.teste', AUD = 'polaris'
const ped = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`

describe('aritmética de taxa e proporção (exata)', () => {
  it('percentual e proporcional em 4 casas, meio para cima', () => {
    expect(percentual('100.00', '3')).toBe('3.00'); expect(percentual('49.90', '2.99')).toBe('1.492'); expect(percentual('0.01', '50')).toBe('0.005'); expect(percentual('100', '0')).toBe('0.00')
    expect(proporcional('40', '97', '100')).toBe('38.80'); expect(proporcional('1', '1', '3')).toBe('0.3333'); expect(subtrai('100', '3')).toBe('97.00')
    for (const x of ['abc', '1000', '-1', '1.23456']) expect(() => percentual('1', x), x).toThrow('percentual inválido')
    expect(() => proporcional('1', '1', '0')).toThrow('base deve ser positiva')
  })
})

const reg = new Registry(); for (const n of nosDoPack('pagamentos')) reg.registra(n)
const no = reg.resolve('servico', 'pagamentos')!.no
it('nós do pack Pagamentos: registram, referências resolvem, SQL e OpenAPI emitem', () => {
  expect(reg.verificaTudo().filter((x) => x.erros.length)).toEqual([]); expect(() => emite(no, 'sql')).not.toThrow(); expect(() => emite(no, 'openapi')).not.toThrow()
})

let pg: PGlite, app: FastifyInstance, priv: KeyLike
const consulta = (tx: { query: PGlite['query'] }): Consulta => async (sql, params) => { const r = await tx.query(sql, params as unknown[]); return { rows: r.rows as Record<string, unknown>[], rowCount: r.affectedRows ?? r.rows.length } }
const dbApp: DbTenant = { transacao: (t, fn) => pg.transaction(async (tx) => { await tx.exec('SET LOCAL ROLE app'); await tx.query(`SELECT set_config('app.tenant_id', $1, true)`, [t]); return fn(consulta(tx)) }) }
const sql = async (s: string, p: unknown[] = []) => (await pg.transaction(async (tx) => { await tx.exec('SET LOCAL ROLE relay'); return tx.query(s, p) })).rows as Array<Record<string, any>>
const token = (sub: string, papeis: string[], tid = A) => new SignJWT({ tid, papeis }).setProtectedHeader({ alg: 'RS256' }).setSubject(sub).setIssuer(ISS).setAudience(AUD).setExpirationTime('10m').sign(priv)
const req = async (tok: string, m: string, url: string, corpo: unknown = m === 'POST' ? {} : undefined) => { const r = await app.inject({ method: m as 'GET', url, headers: { authorization: `Bearer ${tok}`, ...(corpo !== undefined ? { 'content-type': 'application/json' } : {}) }, ...(corpo !== undefined ? { payload: JSON.stringify(corpo) } : {}) }); return { status: r.statusCode, corpo: r.body ? JSON.parse(r.body) : null } }

// o provedor externo: conta chamadas e recusa/cai sob comando; idempotente pelo pagamentoId
const chamadas: string[] = []
const modo = { autoriza: 'ok' as 'ok' | 'recusa' | 'cai', captura: 'ok' as 'ok' | 'recusa', estorna: 'ok' as 'ok' | 'recusa' }
const gateway: Provedor = {
  autoriza: async (c) => { chamadas.push('autoriza'); if (modo.autoriza === 'cai') throw new Error('timeout'); return modo.autoriza === 'ok' ? { ok: true, referencia: `gw-${c.pagamentoId}` } : { ok: false, motivo: 'cartão recusado pelo emissor' } },
  captura: async (c) => { chamadas.push('captura'); return modo.captura === 'ok' ? { ok: true, referencia: `gw-${c.pagamentoId}` } : { ok: false, motivo: 'captura negada' } },
  cancela: async () => { chamadas.push('cancela') },
  estorna: async (_c, _r, _v, ch) => { chamadas.push('estorna'); return modo.estorna === 'ok' ? { ok: true, referencia: `gw-est-${ch}` } : { ok: false, motivo: 'saldo do lojista insuficiente no provedor' } },
}
const reset = () => { chamadas.length = 0; modo.autoriza = 'ok'; modo.captura = 'ok'; modo.estorna = 'ok' }
let fin: string, sis: string, cx1: string, cx2: string
const saldo = async (t = A) => (await sql(`SELECT saldo::text AS s FROM pagamentos.carteira WHERE tenant_id = $1`, [t]))[0]?.s ?? null
const lanc = async (pid: string) => (await sql(`SELECT tipo, valor::text AS v, saldo_apos::text AS s FROM pagamentos.lancamento WHERE pagamento_id = $1 ORDER BY criado_em, id`, [pid])).map((r) => `${r.tipo}:${r.v}:${r.s}`)

beforeAll(async () => {
  const k = await generateKeyPair('RS256'); priv = k.privateKey
  pg = new PGlite(); await pg.exec(`CREATE ROLE migrador NOLOGIN BYPASSRLS; CREATE ROLE relay NOLOGIN BYPASSRLS; CREATE ROLE app NOLOGIN; GRANT CREATE ON DATABASE postgres TO migrador; SET ROLE migrador;`)
  await pg.exec(emite(no, 'sql')); await pg.exec(`RESET ROLE; GRANT USAGE ON SCHEMA pagamentos TO app, relay; GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA pagamentos TO app, relay;`)
  app = criaServico(no, { db: dbApp, acesso: regrasDoRegistry(reg), contexto: contextoPorJwt(criaAutenticadorJwt({ emissor: ISS, audiencia: AUD, chave: { publica: k.publicKey } })), operacoes: criaPagamentos(no, { provedores: { gateway, interno: provedorInterno } }).operacoes })
  await app.ready(); fin = await token('fin', ['pagamentos.financeiro']); sis = await token('sistema', ['pagamentos.sistema'])
  for (const [metodo, provedor, taxaPercentual] of [['pix', 'gateway', 1.5], ['credito', 'gateway', 3], ['dinheiro', 'interno', 0], ['vale', 'interno', 0]] as const) expect((await req(fin, 'POST', '/config-pagamento', { metodo, provedor, taxaPercentual })).status).toBe(201)
  cx1 = (await req(fin, 'POST', '/caixas', { nome: 'Caixa 1' })).corpo.id; cx2 = (await req(fin, 'POST', '/caixas', { nome: 'Caixa 2' })).corpo.id
})
afterAll(async () => { await app.close(); await pg.close() })

const autoriza = (pedido: number, metodo: string, valor: string, extra: object = {}, tok = sis) => req(tok, 'POST', '/pagamentos/autorizar', { pedidoId: ped(pedido), metodo, valor, ...extra })

describe('ciclo do pagamento eletrônico', () => {
  it('config: método sem config ou inativo é 422; método inválido, valor ≤ 0, parcelas fora de regra são 400', async () => {
    reset(); expect((await autoriza(1, 'debito', '10.00')).corpo.erro.codigo).toBe('metodo_indisponivel')
    for (const [m, v, x] of [['cheque', '10', {}], ['pix', '0', {}], ['pix', '-5', {}], ['pix', '10', { parcelas: 3 }], ['credito', '10', { parcelas: 25 }]] as const) expect((await autoriza(1, m, v, x)).status, `${m} ${v}`).toBe(400)
    expect((await req(sis, 'POST', '/pagamentos/autorizar', { pedidoId: ped(1), metodo: 'pix', valor: 10.5 })).status).toBe(400) // dinheiro como número
  })
  it('pix: autoriza (taxa e líquido exatos), captura, credita o LÍQUIDO na carteira; repetir não recobra nem credita de novo', async () => {
    reset(); const a = await autoriza(10, 'pix', '100.00'); expect(a.status).toBe(200)
    expect(a.corpo).toMatchObject({ status: 'autorizado', valor: '100.0000', taxa: '1.5000', liquido: '98.5000', provedor: 'gateway', estornado: '0.0000' })
    const a2 = await autoriza(10, 'pix', '100.00'); expect(a2.corpo.id).toBe(a.corpo.id); expect(chamadas).toEqual(['autoriza'])
    expect((await autoriza(10, 'pix', '99.00')).corpo.erro.codigo).toBe('pedido_ja_tem_pagamento'); expect((await autoriza(10, 'credito', '100.00')).status).toBe(409)
    const c = await req(sis, 'POST', `/pagamentos/${a.corpo.id}/capturar`); expect(c.corpo).toMatchObject({ status: 'pago' }); expect(c.corpo.pagoEm).toBeTruthy()
    await req(sis, 'POST', `/pagamentos/${a.corpo.id}/capturar`); expect(chamadas).toEqual(['autoriza', 'captura']); expect(await lanc(a.corpo.id)).toEqual(['credito:98.5000:98.5000']); expect(await saldo()).toBe('98.5000')
  })
  it('recusa do provedor é um RESULTADO registrado (200, status falhou) e a repetição não recobra; capturar um falho é 409', async () => {
    reset(); modo.autoriza = 'recusa'; const a = await autoriza(11, 'credito', '200.00', { parcelas: 3 })
    expect(a.status).toBe(200); expect(a.corpo).toMatchObject({ status: 'falhou', motivoFalha: 'cartão recusado pelo emissor', parcelas: 3 })
    modo.autoriza = 'ok'; expect((await autoriza(11, 'credito', '200.00', { parcelas: 3 })).corpo.status).toBe('falhou'); expect(chamadas).toEqual(['autoriza'])
    expect((await req(sis, 'POST', `/pagamentos/${a.corpo.id}/capturar`)).status).toBe(409)
  })
  it('provedor FORA DO AR: 502 e NADA fica gravado; quando volta, a repetição cobra uma vez', async () => {
    reset(); modo.autoriza = 'cai'; const r = await autoriza(12, 'pix', '30.00'); expect(r.status).toBe(502); expect(r.corpo.erro.codigo).toBe('provedor_indisponivel')
    expect(await sql(`SELECT 1 FROM pagamentos.pagamento WHERE pedido_id = $1`, [ped(12)])).toEqual([])
    modo.autoriza = 'ok'; expect((await autoriza(12, 'pix', '30.00')).corpo.status).toBe('autorizado')
  })
  it('cancelar: só autorizado; idempotente; pago não se cancela (é estorno)', async () => {
    reset(); const a = (await autoriza(13, 'pix', '10.00')).corpo.id
    expect((await req(sis, 'POST', `/pagamentos/${a}/cancelar`)).corpo.status).toBe('cancelado'); expect((await req(sis, 'POST', `/pagamentos/${a}/cancelar`)).corpo.status).toBe('cancelado'); expect(chamadas).toEqual(['autoriza', 'cancela'])
    const p = (await autoriza(14, 'pix', '10.00')).corpo.id; await req(sis, 'POST', `/pagamentos/${p}/capturar`); expect((await req(sis, 'POST', `/pagamentos/${p}/cancelar`)).corpo.erro.codigo).toBe('estado_invalido')
  })
  it('captura recusada marca falhou e NÃO credita a carteira', async () => {
    reset(); const antes = await saldo(); const a = (await autoriza(15, 'pix', '10.00')).corpo.id; modo.captura = 'recusa'
    expect((await req(sis, 'POST', `/pagamentos/${a}/capturar`)).corpo).toMatchObject({ status: 'falhou', motivoFalha: 'captura negada' }); expect(await saldo()).toBe(antes)
  })
})

describe('estorno', () => {
  it('parcial e total devolvem exatamente o líquido (sem sobra por arredondamento); a carteira volta ao que era', async () => {
    reset(); const antes = await saldo(); const a = (await autoriza(20, 'credito', '100.00')).corpo.id; await req(sis, 'POST', `/pagamentos/${a}/capturar`)
    const e1 = await req(fin, 'POST', `/pagamentos/${a}/estornar`, { valor: '40.00', motivo: 'cliente devolveu 1 item', chaveIdempotencia: 'estorno-20-parte-1' }); expect(e1.status).toBe(200)
    expect((await req(fin, 'GET', `/pagamentos/${a}`)).corpo).toMatchObject({ status: 'estornado_parcial', estornado: '40.0000' })
    expect((await req(fin, 'POST', `/pagamentos/${a}/estornar`, { valor: '60.01', motivo: 'x', chaveIdempotencia: 'estorno-20-excede' })).corpo.erro.codigo).toBe('estorno_excede')
    await req(fin, 'POST', `/pagamentos/${a}/estornar`, { valor: '60.00', motivo: 'resto', chaveIdempotencia: 'estorno-20-parte-2' })
    expect((await req(fin, 'GET', `/pagamentos/${a}`)).corpo).toMatchObject({ status: 'estornado', estornado: '100.0000' })
    expect(await lanc(a)).toEqual([expect.stringMatching(/^credito:97\.0000:/), expect.stringMatching(/^debito:38\.8000:/), expect.stringMatching(/^debito:58\.2000:/)] as never)
    expect(await saldo()).toBe(antes) // crédito 97 − débitos 38.80 e 58.20 = 0
  })
  it('idempotente pela chave; chave reutilizada com outro valor é 409; estorno de pagamento não pago é 409; provedor que recusa não grava nada', async () => {
    reset(); const a = (await autoriza(21, 'pix', '50.00')).corpo.id
    expect((await req(fin, 'POST', `/pagamentos/${a}/estornar`, { valor: '5', motivo: 'x', chaveIdempotencia: 'estorno-21-aaaa' })).corpo.erro.codigo).toBe('estado_invalido') // ainda só autorizado
    await req(sis, 'POST', `/pagamentos/${a}/capturar`)
    const e = await req(fin, 'POST', `/pagamentos/${a}/estornar`, { valor: '10.00', motivo: 'm', chaveIdempotencia: 'estorno-21-aaaa' }), e2 = await req(fin, 'POST', `/pagamentos/${a}/estornar`, { valor: '10.00', motivo: 'm', chaveIdempotencia: 'estorno-21-aaaa' })
    expect(e2.corpo.id).toBe(e.corpo.id); expect((await sql(`SELECT count(*)::int AS n FROM pagamentos.estorno WHERE pagamento_id = $1`, [a]))[0]!.n).toBe(1); expect(chamadas.filter((c) => c === 'estorna').length).toBe(1)
    expect((await req(fin, 'POST', `/pagamentos/${a}/estornar`, { valor: '11.00', motivo: 'm', chaveIdempotencia: 'estorno-21-aaaa' })).corpo.erro.codigo).toBe('chave_reutilizada')
    modo.estorna = 'recusa'; const r = await req(fin, 'POST', `/pagamentos/${a}/estornar`, { valor: '5.00', motivo: 'm', chaveIdempotencia: 'estorno-21-bbbb' }); expect(r.corpo.erro.codigo).toBe('estorno_recusado')
    expect((await sql(`SELECT count(*)::int AS n FROM pagamentos.estorno WHERE pagamento_id = $1`, [a]))[0]!.n).toBe(1)
  })
})

describe('estorno: arredondamento dos parciais', () => {
  it('três parciais que arredondam para cima (3,33 + 3,33 + 3,34 de 10,00) devolvem EXATAMENTE o líquido: a carteira não ganha nem perde um centésimo de centavo', async () => {
    reset(); const antes = await saldo(); const a = (await autoriza(50, 'pix', '10.00')).corpo.id; await req(sis, 'POST', `/pagamentos/${a}/capturar`)
    for (const [v, k] of [['3.33', 'a'], ['3.33', 'b'], ['3.34', 'c']]) expect((await req(fin, 'POST', `/pagamentos/${a}/estornar`, { valor: v, motivo: 'm', chaveIdempotencia: `estorno-50-parcial-${k}` })).status).toBe(200)
    expect((await req(fin, 'GET', `/pagamentos/${a}`)).corpo.status).toBe('estornado')
    const deb = (await lanc(a)).filter((x) => x.startsWith('debito')).map((x) => x.split(':')[1]); expect(deb).toEqual(['3.2801', '3.2801', '3.2898']) // o último é o RESTANTE
    expect(await saldo()).toBe(antes)
  })
})

describe('caixa: gaveta, sangria, reforço e fechamento com diferença', () => {
  let sessao = ''
  const op = (id: string, tipo: string, valor: string, tok: string) => req(tok, 'POST', `/sessoes-caixa/${id}/movimentos`, { tipo, valor })
  it('abre uma vez por caixa; dinheiro exige sessão aberta', async () => {
    reset(); const ana = await token('ana', ['pagamentos.caixa'])
    expect((await autoriza(30, 'dinheiro', '50.00', {}, ana)).corpo.erro.codigo).toBe('caixa_obrigatorio')
    const s = await req(ana, 'POST', `/caixas/${cx1}/abrir`, { valorAbertura: '100.00' }); expect(s.status).toBe(200); expect(s.corpo).toMatchObject({ status: 'aberta', abertoPor: 'ana', valorAbertura: '100.0000' }); sessao = s.corpo.id
    expect((await req(await token('bia', ['pagamentos.caixa']), 'POST', `/caixas/${cx1}/abrir`, { valorAbertura: '1' })).corpo.erro.codigo).toBe('caixa_ja_aberto')
    expect((await req(ana, 'POST', `/caixas/${cx2}/abrir`, { valorAbertura: '-1' })).status).toBe(400)
  })
  it('venda e estorno em dinheiro entram na gaveta, NÃO na carteira; sangria acima do que há é recusada; só o dono movimenta', async () => {
    const ana = await token('ana', ['pagamentos.caixa']), antes = await saldo()
    const a = (await autoriza(31, 'dinheiro', '50.00', { sessaoCaixaId: sessao }, ana)).corpo.id; expect((await req(ana, 'POST', `/pagamentos/${a}/capturar`)).corpo.status).toBe('pago')
    expect(await saldo()).toBe(antes); expect(await lanc(a)).toEqual([])
    expect((await op(sessao, 'reforco', '20.00', ana)).status).toBe(200); expect((await op(sessao, 'sangria', '30.00', ana)).status).toBe(200)
    expect((await op(sessao, 'sangria', '500.00', ana)).corpo.erro.codigo).toBe('saldo_insuficiente_no_caixa'); expect((await op(sessao, 'troco', '1', ana)).status).toBe(400)
    expect((await op(sessao, 'reforco', '1.00', await token('bia', ['pagamentos.caixa']))).status).toBeGreaterThanOrEqual(403)
    expect((await req(fin, 'POST', `/pagamentos/${a}/estornar`, { valor: '10.00', motivo: 'troco errado', chaveIdempotencia: 'estorno-31-dinheiro' })).corpo.erro.codigo).toBe('caixa_obrigatorio')
    expect((await req(fin, 'POST', `/pagamentos/${a}/estornar`, { valor: '10.00', motivo: 'troco errado', chaveIdempotencia: 'estorno-31-dinheiro', sessaoCaixaId: sessao })).status).toBe(200)
    expect(await saldo()).toBe(antes)
  })
  it('fechar: esperado = abertura + vendas − estornos + reforços − sangrias; a diferença aparece; só o dono fecha; fechada não aceita mais nada', async () => {
    const ana = await token('ana', ['pagamentos.caixa']), bia = await token('bia', ['pagamentos.caixa'])
    expect((await req(bia, 'POST', `/sessoes-caixa/${sessao}/fechar`, { valorContado: '130' })).status).toBeGreaterThanOrEqual(403)
    const f = await req(ana, 'POST', `/sessoes-caixa/${sessao}/fechar`, { valorContado: '128.00' }) // 100 + 50 − 10 + 20 − 30 = 130
    expect(f.corpo).toMatchObject({ status: 'fechada', valorEsperado: '130.0000', valorContado: '128.0000', diferenca: '-2.0000', fechadoPor: 'ana' })
    expect((await req(ana, 'POST', `/sessoes-caixa/${sessao}/fechar`, { valorContado: '130' })).corpo.erro.codigo).toBe('caixa_fechado'); expect((await op(sessao, 'reforco', '1', ana)).corpo.erro.codigo).toBe('caixa_fechado')
    expect((await req(ana, 'POST', `/caixas/${cx1}/abrir`, { valorAbertura: '0' })).status).toBe(200) // pode reabrir (nova sessão)
  })
})

describe('papéis e isolamento', () => {
  it('o sistema autoriza/captura mas não estorna nem configura; o financeiro não autoriza; sem papel nada passa', async () => {
    reset(); const a = (await autoriza(40, 'pix', '10.00')).corpo.id; await req(sis, 'POST', `/pagamentos/${a}/capturar`)
    expect((await req(sis, 'POST', `/pagamentos/${a}/estornar`, { valor: '1', motivo: 'x', chaveIdempotencia: 'estorno-40-sistema' })).status).toBe(403)
    expect((await req(sis, 'POST', '/config-pagamento', { metodo: 'x', provedor: 'y' })).status).toBe(403); expect((await autoriza(41, 'pix', '10.00', {}, fin)).status).toBe(403)
    const nada = await token('x', []); expect((await req(nada, 'GET', '/pagamentos')).status).toBe(403)
  })
  it('um tenant não vê nem estorna o pagamento de outro; cada tenant tem a sua carteira e a sua config', async () => {
    reset(); const a = (await autoriza(42, 'pix', '10.00')).corpo.id; const finB = await token('finb', ['pagamentos.financeiro'], B), sisB = await token('sisb', ['pagamentos.sistema'], B)
    expect((await req(finB, 'GET', `/pagamentos/${a}`)).status).toBe(404); expect((await req(sisB, 'POST', `/pagamentos/${a}/capturar`)).status).toBe(404)
    expect((await autoriza(42, 'pix', '10.00', {}, sisB)).corpo.erro.codigo).toBe('metodo_indisponivel') // B não configurou nada
    expect(await saldo(B)).toBeNull()
  })
})
