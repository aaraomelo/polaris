import { PGlite } from '@electric-sql/pglite'
import { emite, type No } from '@polaris/schema'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { EventoInvalido, criaBarramentoMemoria, criaConsumidor, criaPublicador, criaRelay, type Consulta, type DbSistema, type DbTenant, type Envelope } from '../src/index'

// Outbox + relay + barramento + inbox, contra um Postgres real (PGlite) com DOIS papéis: `app` (sujeito à RLS) e `relay` (ignora RLS, lê todos os tenants).

const A = '11111111-1111-1111-1111-111111111111', B = '22222222-2222-2222-2222-222222222222'
const no = (kind: string, id: string, versao: string, spec: object): No => ({ kind, id, versao, estatuto: 'publicado', spec }) as never
const PEDIDO_CRIADO = no('evento', 'pedido.criado', '1.2.0', { nome: 'pedido.criado', produtor: 'pedidos', payload: { pedidoId: { tipo: 'uuid', obrigatorio: true }, total: { tipo: 'dinheiro', obrigatorio: true }, nota: { tipo: 'texto' } }, idempotencia: 'pedidoId' })
const PAGAMENTO = no('evento', 'pagamento.confirmado', '2.0.0', { nome: 'pagamento.confirmado', payload: { pedidoId: { tipo: 'uuid', obrigatorio: true } } })
const PEDIDOS = no('servico', 'pedidos', '1.0.0', { entidades: { pedido: { campos: { total: { tipo: 'dinheiro', obrigatorio: true } } } }, operacoes: { criar: { metodo: 'POST', caminho: '/p', saida: 'pedido', publica: ['pedido.criado'] } }, consome: ['pagamento.confirmado'] })
const FATURAMENTO = no('servico', 'faturamento', '1.0.0', { entidades: { fatura: { campos: { pedidoId: { tipo: 'uuid', obrigatorio: true }, valor: { tipo: 'dinheiro', obrigatorio: true } } } }, operacoes: {}, consome: ['pedido.criado'] })

let pg: PGlite
const consulta = (tx: { query: PGlite['query'] }): Consulta => async (sql, params) => { const r = await tx.query(sql, params as unknown[]); return { rows: r.rows as Record<string, unknown>[], rowCount: r.affectedRows ?? r.rows.length } }
const dbApp: DbTenant = { transacao: (t, fn) => pg.transaction(async (tx) => { await tx.exec('SET LOCAL ROLE app'); await tx.query(`SELECT set_config('app.tenant_id', $1, true)`, [t]); return fn(consulta(tx)) }) }
const dbRelay: DbSistema = { transacao: (fn) => pg.transaction(async (tx) => { await tx.exec('SET LOCAL ROLE relay'); return fn(consulta(tx)) }) }
/** o que está no banco, visto pelo relay (sem RLS) */
const sistema = async (sql: string, p: unknown[] = []) => (await dbRelay.transacao((q) => q(sql, p))).rows

const publicador = criaPublicador('pedidos', { 'pedido.criado': PEDIDO_CRIADO })
const pedidoId = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`

beforeAll(async () => {
  pg = new PGlite()
  await pg.exec(`CREATE ROLE migrador NOLOGIN BYPASSRLS; CREATE ROLE relay NOLOGIN BYPASSRLS; CREATE ROLE app NOLOGIN; GRANT CREATE ON DATABASE postgres TO migrador; SET ROLE migrador;`)
  await pg.exec(emite(PEDIDOS, 'sql')); await pg.exec(emite(FATURAMENTO, 'sql'))
  await pg.exec(`RESET ROLE; GRANT USAGE ON SCHEMA pedidos, faturamento TO app, relay; GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA pedidos, faturamento TO app, relay;`)
})
afterAll(async () => { await pg.close() })
beforeEach(async () => { await pg.exec(`RESET ROLE; SET ROLE migrador; TRUNCATE pedidos.outbox, pedidos.pedido, faturamento.inbox, faturamento.fatura; RESET ROLE`) })

const cria = (tenant: string, n: number, total = '10.00') => dbApp.transacao(tenant, async (q) => {
  await q(`INSERT INTO pedidos.pedido (tenant_id, total) VALUES ($1, $2)`, [tenant, total])
  return publicador.publicar(q, tenant, 'pedido.criado', { pedidoId: pedidoId(n), total })
})

describe('publicar: o evento entra no outbox NA MESMA transação do dado', () => {
  it('commit leva os dois; rollback leva os dois (não existe "gravou e perdeu o evento", nem evento de algo que não aconteceu)', async () => {
    await cria(A, 1)
    expect((await sistema('SELECT count(*)::int AS n FROM pedidos.pedido'))[0]).toEqual({ n: 1 }); expect((await sistema('SELECT count(*)::int AS n FROM pedidos.outbox'))[0]).toEqual({ n: 1 })
    await expect(dbApp.transacao(A, async (q) => { await q(`INSERT INTO pedidos.pedido (tenant_id, total) VALUES ($1, '5')`, [A]); await publicador.publicar(q, A, 'pedido.criado', { pedidoId: pedidoId(2), total: '5' }); throw new Error('falha depois de publicar') })).rejects.toThrow('falha depois')
    expect((await sistema('SELECT count(*)::int AS n FROM pedidos.pedido'))[0]).toEqual({ n: 1 }); expect((await sistema('SELECT count(*)::int AS n FROM pedidos.outbox'))[0]).toEqual({ n: 1 })
  })
  it('o registro leva a versão do contrato e o tenant; payload inválido ou evento desconhecido são recusados antes de gravar', async () => {
    await cria(A, 1)
    expect((await sistema('SELECT tipo, versao, tenant_id::text AS t, chave FROM pedidos.outbox'))[0]).toEqual({ tipo: 'pedido.criado', versao: '1.2.0', t: A, chave: pedidoId(1) })
    const mal = (p: object) => dbApp.transacao(A, (q) => publicador.publicar(q, A, 'pedido.criado', p as never))
    await expect(mal({ pedidoId: pedidoId(3) })).rejects.toThrow(/inválido.*total/)
    await expect(mal({ pedidoId: 'x', total: '1' })).rejects.toThrow(EventoInvalido)
    await expect(mal({ pedidoId: pedidoId(3), total: 10 })).rejects.toThrow(EventoInvalido) // dinheiro como número
    await expect(mal({ pedidoId: pedidoId(3), total: '1', extra: 1 })).rejects.toThrow(EventoInvalido)
    await expect(dbApp.transacao(A, (q) => publicador.publicar(q, A, 'pedido.fantasma', {}))).rejects.toThrow(/desconhecido/)
    expect((await sistema('SELECT count(*)::int AS n FROM pedidos.outbox'))[0]).toEqual({ n: 1 })
  })
  it('idempotência do produtor: o mesmo fato (mesma chave) publicado duas vezes vira UM evento; outro tenant com a mesma chave é outro fato', async () => {
    expect(await cria(A, 7)).toMatch(/^[0-9a-f-]{36}$/); expect(await cria(A, 7)).toBeNull(); expect(await cria(B, 7)).not.toBeNull()
    expect((await sistema(`SELECT count(*)::int AS n FROM pedidos.outbox`))[0]).toEqual({ n: 2 })
  })
  it('a RLS vale no outbox: o tenant não lê nem forja eventos de outro', async () => {
    await cria(A, 1); await cria(B, 2)
    expect((await dbApp.transacao(B, (q) => q('SELECT chave FROM pedidos.outbox'))).rows).toEqual([{ chave: pedidoId(2) }])
    await expect(dbApp.transacao(B, (q) => q(`INSERT INTO pedidos.outbox (tenant_id, tipo, versao, payload) VALUES ($1, 'pedido.criado', '1.0.0', '{}')`, [A]))).rejects.toThrow(/row-level security/)
  })
})

describe('relay: outbox → barramento', () => {
  it('publica na ordem de ocorrência, marca como publicado e não repete', async () => {
    await cria(A, 1); await cria(A, 2); await cria(B, 3)
    const bus = criaBarramentoMemoria(); const relay = criaRelay({ db: dbRelay, servico: 'pedidos', barramento: bus })
    expect(await relay.executa()).toEqual({ publicados: 3, falhas: 0, mortos: 0 })
    expect(bus.log().map((e) => e.payload.pedidoId)).toEqual([pedidoId(1), pedidoId(2), pedidoId(3)])
    expect(bus.log()[0]).toMatchObject({ tipo: 'pedido.criado', versao: '1.2.0', tenantId: A, chave: pedidoId(1) })
    expect(await relay.executa()).toEqual({ publicados: 0, falhas: 0, mortos: 0 })
    expect((await sistema('SELECT count(*)::int AS n FROM pedidos.outbox WHERE publicado_em IS NOT NULL'))[0]).toEqual({ n: 3 })
  })
  it('barramento fora do ar: o evento fica, com tentativas e ESPERA; depois que volta, sai (nada se perde)', async () => {
    await cria(A, 1)
    let fora = true
    const bus = { ...criaBarramentoMemoria(), publica: async (e: Envelope) => { if (fora) throw new Error('broker fora'); await base.publica(e) } }
    const base = criaBarramentoMemoria(); const relay = criaRelay({ db: dbRelay, servico: 'pedidos', barramento: { publica: bus.publica, assina: base.assina } })
    expect(await relay.executa()).toEqual({ publicados: 0, falhas: 1, mortos: 0 })
    expect((await sistema('SELECT tentativas, erro, proxima_em > now() AS espera FROM pedidos.outbox'))[0]).toEqual({ tentativas: 1, erro: 'broker fora', espera: true })
    expect(await relay.executa()).toEqual({ publicados: 0, falhas: 0, mortos: 0 }) // ainda na espera: não martela o broker
    fora = false; await sistema(`UPDATE pedidos.outbox SET proxima_em = now()`)
    expect(await relay.executa()).toEqual({ publicados: 1, falhas: 0, mortos: 0 }); expect(base.log().length).toBe(1)
  })
  it('esgotou as tentativas → MORTO (sai da fila, fica registrado com o erro); `reenfileira` devolve à fila', async () => {
    await cria(A, 1)
    let fora = true; const base = criaBarramentoMemoria()
    const relay = criaRelay({ db: dbRelay, servico: 'pedidos', maxTentativas: 3, espera: () => 0, barramento: { publica: async (e) => { if (fora) throw new Error('quebrado'); await base.publica(e) }, assina: base.assina } })
    expect(await relay.executa()).toMatchObject({ falhas: 1 }); expect(await relay.executa()).toMatchObject({ falhas: 1 }); expect(await relay.executa()).toEqual({ publicados: 0, falhas: 0, mortos: 1 })
    expect(await relay.executa()).toEqual({ publicados: 0, falhas: 0, mortos: 0 })
    const m = await relay.mortos(); expect(m.length).toBe(1); expect(m[0]).toMatchObject({ tentativas: 3, erro: 'quebrado', tipo: 'pedido.criado' })
    fora = false; expect(await relay.reenfileira(m[0]!.id)).toBe(true); expect(await relay.reenfileira(m[0]!.id)).toBe(false)
    expect(await relay.executa()).toMatchObject({ publicados: 1 }); expect((await relay.mortos()).length).toBe(0)
  })
  it('ORDEM por tenant: se um evento do A falha, os seguintes do A esperam; o B segue', async () => {
    await cria(A, 1); await cria(A, 2); await cria(B, 3)
    const base = criaBarramentoMemoria()
    const relay = criaRelay({ db: dbRelay, servico: 'pedidos', espera: () => 0, barramento: { publica: async (e) => { if (e.payload.pedidoId === pedidoId(1)) throw new Error('só o 1'); await base.publica(e) }, assina: base.assina } })
    expect(await relay.executa()).toEqual({ publicados: 1, falhas: 1, mortos: 0 })
    expect(base.log().map((e) => e.payload.pedidoId)).toEqual([pedidoId(3)]) // o 2 (do A) NÃO ultrapassou o 1
  })
})

describe('consumidor: efeito uma vez, mesmo com entregas repetidas', () => {
  const consumidor = (extra: object = {}) => criaConsumidor({ db: dbApp, servico: 'faturamento', consumidor: 'faturar', tipos: ['pedido.criado'], handler: async (e, q) => { await q(`INSERT INTO faturamento.fatura (tenant_id, pedido_id, valor) VALUES ($1, $2, $3)`, [e.tenantId, e.payload.pedidoId, e.payload.total]) }, ...extra })
  const env = (n = 1, tenant = A, extra: Partial<Envelope> = {}): Envelope => ({ id: `aaaaaaaa-0000-0000-0000-${String(n).padStart(12, '0')}`, tipo: 'pedido.criado', versao: '1.2.0', tenantId: tenant, ocorridoEm: '2026-01-01T00:00:00.000000Z', payload: { pedidoId: pedidoId(n), total: '10.0000' }, ...extra })
  const faturas = async () => (await sistema('SELECT count(*)::int AS n FROM faturamento.fatura'))[0]!.n

  it('o mesmo evento entregue 3 vezes → o efeito acontece UMA vez (inbox)', async () => {
    const c = consumidor()
    expect(await c.processa(env())).toBe('processado'); expect(await c.processa(env())).toBe('duplicado'); expect(await c.processa(env())).toBe('duplicado')
    expect(await faturas()).toBe(1)
  })
  it('falha no handler desfaz TUDO (inclusive a marca): a próxima entrega tenta de novo e, dando certo, o efeito é um só', async () => {
    let falhas = 2
    const c = consumidor({ handler: async (e: Envelope, q: Consulta) => { await q(`INSERT INTO faturamento.fatura (tenant_id, pedido_id, valor) VALUES ($1, $2, $3)`, [e.tenantId, e.payload.pedidoId, e.payload.total]); if (falhas-- > 0) throw new Error('indisponível') } })
    const bus = criaBarramentoMemoria({ maxTentativas: 5 }); bus.assina(c)
    await bus.publica(env()); await bus.aguarda()
    expect(await faturas()).toBe(1); expect(bus.mortas()).toEqual([]) // 2 falhas, 3ª tentativa passou; os efeitos das falhas foram desfeitos
    expect((await sistema('SELECT count(*)::int AS n FROM faturamento.inbox'))[0]).toEqual({ n: 1 })
  })
  it('falha para sempre → vai para as MORTAS do barramento; nada gravado (nem marca no inbox)', async () => {
    const c = consumidor({ handler: async () => { throw new Error('bug') } })
    const bus = criaBarramentoMemoria({ maxTentativas: 3 }); bus.assina(c); await bus.publica(env()); await bus.aguarda()
    expect(bus.mortas()).toMatchObject([{ consumidor: 'faturar', tentativas: 3, erro: 'bug' }])
    expect(await faturas()).toBe(0); expect((await sistema('SELECT count(*)::int AS n FROM faturamento.inbox'))[0]).toEqual({ n: 0 })
  })
  it('roda COMO o tenant do evento: grava o dele; tentar gravar para outro tenant é barrado pela RLS e desfeito', async () => {
    const c = consumidor(); await c.processa(env(1, B))
    expect((await sistema('SELECT tenant_id::text AS t FROM faturamento.fatura'))[0]).toEqual({ t: B })
    const abusivo = consumidor({ consumidor: 'abusivo', handler: async (e: Envelope, q: Consulta) => { await q(`INSERT INTO faturamento.fatura (tenant_id, pedido_id, valor) VALUES ($1, $2, '1')`, [A, e.payload.pedidoId]) } })
    await expect(abusivo.processa(env(2, B))).rejects.toThrow(/row-level security/)
    expect(await faturas()).toBe(1)
  })
  it('a deduplicação é POR CONSUMIDOR: outro consumidor do mesmo evento também processa', async () => {
    let n = 0; const outro = consumidor({ consumidor: 'auditar', handler: async () => { n++ } })
    await consumidor().processa(env()); expect(await outro.processa(env())).toBe('processado'); expect(n).toBe(1)
  })
  it('versões: o consumidor só recebe os MAJORS que declarou; tipo que não pediu também não chega', async () => {
    const c = consumidor({ versoes: [1] }); const bus = criaBarramentoMemoria(); bus.assina(c)
    await bus.publica(env(1)); await bus.publica(env(2, A, { versao: '2.0.0' })); await bus.publica(env(3, A, { tipo: 'pagamento.confirmado' })); await bus.aguarda()
    expect(await faturas()).toBe(1); expect(bus.mortas()).toEqual([])
  })
})

describe('fim a fim: crash entre publicar e marcar, e replay', () => {
  it('o relay publica e CAI antes de marcar → publica DE NOVO (ao menos uma vez) e o consumidor aplica o efeito UMA vez', async () => {
    await cria(A, 1)
    const bus = criaBarramentoMemoria()
    const consumo = criaConsumidor({ db: dbApp, servico: 'faturamento', consumidor: 'faturar', tipos: ['pedido.criado'], handler: async (e, q) => { await q(`INSERT INTO faturamento.fatura (tenant_id, pedido_id, valor) VALUES ($1, $2, $3)`, [e.tenantId, e.payload.pedidoId, e.payload.total]) } })
    bus.assina(consumo)
    let cai = true
    const dbQueCai: DbSistema = { transacao: (fn) => dbRelay.transacao((q) => fn(async (sql, p) => { if (cai && /SET "publicado_em"/.test(sql)) throw new Error('processo caiu'); return q(sql, p) })) }
    const relay = criaRelay({ db: dbQueCai, servico: 'pedidos', barramento: bus })
    await expect(relay.executa()).rejects.toThrow('processo caiu')
    expect(bus.log().length).toBe(1) // o broker JÁ recebeu…
    expect((await sistema('SELECT count(*)::int AS n FROM pedidos.outbox WHERE publicado_em IS NULL'))[0]).toEqual({ n: 1 }) // …mas o outbox não sabe
    cai = false; await relay.executa(); await bus.aguarda()
    expect(bus.log().length).toBe(2) // duplicata de entrega
    expect(bus.log()[0]!.id).toBe(bus.log()[1]!.id) // mesmo id: é o mesmo evento
    expect((await sistema('SELECT count(*)::int AS n FROM faturamento.fatura'))[0]).toEqual({ n: 1 }) // efeito único
  })
  it('replay: reenviar o que já foi publicado (por tipo, tenant e intervalo) não duplica efeito; o barramento também reentrega do log', async () => {
    await cria(A, 1); await cria(A, 2); await cria(B, 3)
    const bus = criaBarramentoMemoria(); const relay = criaRelay({ db: dbRelay, servico: 'pedidos', barramento: bus })
    let efeitos = 0
    bus.assina(criaConsumidor({ db: dbApp, servico: 'faturamento', consumidor: 'faturar', tipos: ['pedido.criado'], handler: async () => { efeitos++ } }))
    await relay.executa(); await bus.aguarda(); expect(efeitos).toBe(3)
    expect(await relay.republica({ tipo: 'pedido.criado' })).toBe(3); expect(await relay.republica({ tenantId: B })).toBe(1); expect(await relay.republica({ tipo: 'outro.evento' })).toBe(0)
    expect(await relay.republica({ ate: '2000-01-01T00:00:00Z' })).toBe(0); await bus.aguarda()
    expect(efeitos).toBe(3) // 4 reenvios, 0 efeitos novos: o inbox segurou
    expect(await bus.replay({ tipo: 'pedido.criado' })).toBe(7); expect(efeitos).toBe(3) // o log tem 7 envelopes (3 + 4 reenvios): 7 entregas, 0 efeitos novos
    expect((await sistema('SELECT count(*)::int AS n FROM pedidos.outbox WHERE publicado_em IS NOT NULL'))[0]).toEqual({ n: 3 }) // replay não mexe no outbox
  })
  it('um consumidor NOVO (que entrou depois) recebe todo o histórico pelo replay e os antigos não repetem nada', async () => {
    await cria(A, 1); await cria(A, 2)
    const bus = criaBarramentoMemoria(); const relay = criaRelay({ db: dbRelay, servico: 'pedidos', barramento: bus })
    let antigo = 0, novo = 0
    bus.assina(criaConsumidor({ db: dbApp, servico: 'faturamento', consumidor: 'antigo', tipos: ['pedido.criado'], handler: async () => { antigo++ } }))
    await relay.executa(); await bus.aguarda()
    bus.assina(criaConsumidor({ db: dbApp, servico: 'faturamento', consumidor: 'novo', tipos: ['pedido.criado'], handler: async () => { novo++ } }))
    await relay.republica({}); await bus.aguarda(); expect({ antigo, novo }).toEqual({ antigo: 2, novo: 2 })
  })
})
