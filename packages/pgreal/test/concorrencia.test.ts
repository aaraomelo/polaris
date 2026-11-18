import { criaEstoque, criaPagamentos, criaServicos, provedorInterno, registroDaPlataforma } from '@polaris/packs'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { criaBanco, criaCliente, serviceNo, temPostgres, type Banco, type Cliente } from '../src/harness'

// Concorrência de VERDADE: várias conexões, transações paralelas, travas e deadlock detector do Postgres. O PGlite (uma sessão) não consegue exercitar nada disto.
const A = '11111111-1111-1111-1111-111111111111'
const reg = registroDaPlataforma()
const id = (n: number) => `00000000-0000-0000-0000-${String(n).padStart(12, '0')}`
const tudo = async <T>(n: number, f: (i: number) => Promise<T>) => Promise.all(Array.from({ length: n }, (_, i) => f(i)))

describe.skipIf(!temPostgres)('Estoque sob concorrência', () => {
  let b: Banco, est: Cliente, D1 = '', D2 = ''
  const P = id(101), Q = id(102)
  const ger = ['estoque.gerente'], sis = ['estoque.sistema']
  beforeAll(async () => {
    b = await criaBanco('estoque'); const no = serviceNo(reg, 'estoque'); await b.migra(no)
    est = await criaCliente(b, reg, 'estoque', criaEstoque(no).operacoes as never)
    D1 = (await est.req(ger, A, 'POST', '/depositos', { codigo: 'D1', nome: 'um', padrao: true })).corpo.id; D2 = (await est.req(ger, A, 'POST', '/depositos', { codigo: 'D2', nome: 'dois' })).corpo.id
  })
  afterAll(async () => { await est?.fecha(); await b?.fecha() })
  const entra = (dep: string, produto: string, n: number, chave: string) => est.req(ger, A, 'POST', '/estoque/entrada', { produtoId: produto, depositoId: dep, quantidade: n, custoUnitario: '2.00', chave })
  const saldo = async (dep: string, produto: string) => (await b.admin.query(`SELECT quantidade::float8 AS q, reservado::float8 AS r FROM estoque.saldo WHERE item_id = $1 AND deposito_id = $2`, [produto, dep])).rows[0]!

  it('OVERSELL: 5 em estoque e 20 reservas simultâneas de 1 → exatamente 5 ativas, 15 recusadas, reservado = 5 (a trava do saldo serializa)', async () => {
    expect((await entra(D1, P, 5, 'entrada-oversell-0001')).status).toBe(200)
    const rs = await tudo(20, (i) => est.req(sis, A, 'POST', '/reservas', { pedidoId: id(1000 + i), itens: [{ produtoId: P, quantidade: 1 }] }))
    expect(rs.every((r) => r.status === 200)).toBe(true); expect(rs.filter((r) => r.corpo.status === 'ativa').length).toBe(5); expect(rs.filter((r) => r.corpo.status === 'recusada').length).toBe(15)
    expect(await saldo(D1, P)).toEqual({ q: 5, r: 5 })
  })
  it('SEM DEADLOCK: 40 transferências simultâneas em sentidos OPOSTOS (D1→D2 e D2→D1) terminam todas, sem erro 40P01, e conservam o total', async () => {
    await entra(D1, Q, 60, 'entrada-transf-d1-001'); await entra(D2, Q, 60, 'entrada-transf-d2-001')
    const rs = await tudo(40, (i) => est.req(ger, A, 'POST', '/estoque/transferir', i % 2 ? { produtoId: Q, origemId: D1, destinoId: D2, quantidade: 1, chave: `transf-ida-${String(i).padStart(4, '0')}` } : { produtoId: Q, origemId: D2, destinoId: D1, quantidade: 1, chave: `transf-volta-${String(i).padStart(4, '0')}` }))
    expect(rs.map((r) => r.status).filter((s) => s !== 200)).toEqual([]); const a = await saldo(D1, Q), c = await saldo(D2, Q); expect(a.q + c.q).toBe(120)
    expect((await b.admin.query(`SELECT count(*)::int AS n FROM estoque.movimento WHERE tipo LIKE 'transferencia%'`)).rows[0]!.n).toBe(80) // 40 saídas + 40 entradas
  })
  it('SEM DEADLOCK também em reservas com itens em ORDEM diferente (a ordem de trava é fixa por item)', async () => {
    const X = id(201), Y = id(202); await entra(D1, X, 100, 'entrada-ordem-x-001'); await entra(D1, Y, 100, 'entrada-ordem-y-001')
    const rs = await tudo(30, (i) => est.req(sis, A, 'POST', '/reservas', { pedidoId: id(2000 + i), itens: i % 2 ? [{ produtoId: X, quantidade: 1 }, { produtoId: Y, quantidade: 1 }] : [{ produtoId: Y, quantidade: 1 }, { produtoId: X, quantidade: 1 }] }))
    expect(rs.every((r) => r.status === 200 && r.corpo.status === 'ativa')).toBe(true); expect((await saldo(D1, X)).r).toBe(30); expect((await saldo(D1, Y)).r).toBe(30)
  })
  it('SAÍDAS simultâneas nunca deixam o saldo negativo: 10 em estoque, 30 saídas de 1 → 10 passam, 20 são 422', async () => {
    const Z = id(301); await entra(D1, Z, 10, 'entrada-saida-z-0001')
    const rs = await tudo(30, (i) => est.req(ger, A, 'POST', '/estoque/saida', { produtoId: Z, depositoId: D1, quantidade: 1, tipo: 'consumo', chave: `saida-conc-${String(i).padStart(4, '0')}` }))
    expect(rs.filter((r) => r.status === 200).length).toBe(10); expect(rs.filter((r) => r.status === 422).length).toBe(20); expect((await saldo(D1, Z)).q).toBe(0)
  })
  it('INVARIANTE depois de tudo isso: a soma dos deltas do razão é igual ao saldo, e o reservado é a soma das reservas ativas', async () => {
    const dif = (await b.admin.query(`SELECT s.item_id::text AS item FROM estoque.saldo s LEFT JOIN (SELECT item_id, deposito_id, sum(delta) AS soma FROM estoque.movimento GROUP BY 1, 2) m ON m.item_id = s.item_id AND m.deposito_id = s.deposito_id WHERE s.quantidade <> coalesce(m.soma, 0)`)).rows
    expect(dif).toEqual([])
    const res = (await b.admin.query(`SELECT s.item_id::text AS item FROM estoque.saldo s LEFT JOIN (SELECT i.item_id, i.deposito_id, sum(i.quantidade) AS soma FROM estoque.reserva_item i JOIN estoque.reserva r ON r.id = i.reserva_id AND r.status = 'ativa' GROUP BY 1, 2) x ON x.item_id = s.item_id AND x.deposito_id = s.deposito_id WHERE s.reservado <> coalesce(x.soma, 0)`)).rows
    expect(res).toEqual([])
  })
})

describe.skipIf(!temPostgres)('Pagamentos e Serviços sob concorrência', () => {
  let b: Banco, pag: Cliente, srv: Cliente
  beforeAll(async () => {
    b = await criaBanco('pagserv'); const np = serviceNo(reg, 'pagamentos'), ns = serviceNo(reg, 'servicos'); await b.migra(np); await b.migra(ns)
    pag = await criaCliente(b, reg, 'pagamentos', criaPagamentos(np, { provedores: { interno: provedorInterno } }).operacoes as never)
    srv = await criaCliente(b, reg, 'servicos', criaServicos(ns).operacoes as never)
  })
  afterAll(async () => { await pag?.fecha(); await srv?.fecha(); await b?.fecha() })

  it('CARTEIRA: 25 capturas simultâneas somam EXATAMENTE (saldo atômico); os `saldoApos` do razão são distintos e crescentes', async () => {
    const fin = ['pagamentos.financeiro', 'pagamentos.sistema']; expect((await pag.req(fin, A, 'POST', '/config-pagamento', { metodo: 'vale', provedor: 'interno', taxaPercentual: 0 })).status).toBe(201)
    const rs = await tudo(25, async (i) => { const a = await pag.req(['pagamentos.sistema'], A, 'POST', '/pagamentos/autorizar', { pedidoId: id(5000 + i), metodo: 'vale', valor: '10.00' }); return pag.req(['pagamentos.sistema'], A, 'POST', `/pagamentos/${a.corpo.id}/capturar`) })
    expect(rs.every((r) => r.status === 200 && r.corpo.status === 'pago')).toBe(true)
    expect((await b.admin.query(`SELECT saldo::text AS s FROM pagamentos.carteira`)).rows[0]!.s).toBe('250.0000')
    const apos = (await b.admin.query(`SELECT saldo_apos::float8 AS s FROM pagamentos.lancamento ORDER BY criado_em, id`)).rows.map((r) => r.s as number); expect(new Set(apos).size).toBe(25); expect([...apos].sort((x, y) => x - y)).toEqual(Array.from({ length: 25 }, (_, i) => (i + 1) * 10))
  })
  it('ESTORNOS simultâneos do mesmo pagamento não excedem o valor: 10 estornos de 30 sobre 100 → 3 passam, o resto é 422', async () => {
    const a = await pag.req(['pagamentos.sistema'], A, 'POST', '/pagamentos/autorizar', { pedidoId: id(6000), metodo: 'vale', valor: '100.00' }); await pag.req(['pagamentos.sistema'], A, 'POST', `/pagamentos/${a.corpo.id}/capturar`)
    const rs = await tudo(10, (i) => pag.req(['pagamentos.financeiro'], A, 'POST', `/pagamentos/${a.corpo.id}/estornar`, { valor: '30.00', motivo: 'm', chaveIdempotencia: `estorno-conc-${String(i).padStart(4, '0')}` }))
    expect(rs.filter((r) => r.status === 200).length).toBe(3); expect(rs.filter((r) => r.status === 422).length).toBe(7); expect((await b.admin.query(`SELECT estornado::text AS e FROM pagamentos.pagamento WHERE id = $1`, [a.corpo.id])).rows[0]!.e).toBe('90.0000')
  })
  it('IDEMPOTÊNCIA: o mesmo estorno 8 vezes ao mesmo tempo grava UM (e uma só saída da carteira)', async () => {
    const a = await pag.req(['pagamentos.sistema'], A, 'POST', '/pagamentos/autorizar', { pedidoId: id(6001), metodo: 'vale', valor: '50.00' }); await pag.req(['pagamentos.sistema'], A, 'POST', `/pagamentos/${a.corpo.id}/capturar`)
    const rs = await tudo(8, () => pag.req(['pagamentos.financeiro'], A, 'POST', `/pagamentos/${a.corpo.id}/estornar`, { valor: '20.00', motivo: 'm', chaveIdempotencia: 'estorno-mesma-chave-1' }))
    expect(new Set(rs.map((r) => r.corpo.id)).size).toBe(1); expect((await b.admin.query(`SELECT count(*)::int AS n FROM pagamentos.estorno WHERE pagamento_id = $1`, [a.corpo.id])).rows[0]!.n).toBe(1)
  })
  it('AGENDA: 12 agendamentos simultâneos do MESMO horário e recurso → exatamente 1 entra (a trava do recurso serializa)', async () => {
    const g = ['servicos.gerente', 'servicos.atendente']; const R = (await srv.req(g, A, 'POST', '/recursos', { nome: 'Bia' })).corpo.id, S = (await srv.req(g, A, 'POST', '/servicos-oferecidos', { nome: 'Corte', duracaoMin: 30, preco: '50.00' })).corpo.id
    const inicio = new Date(Date.now() + 48 * 3600_000).toISOString()
    const rs = await tudo(12, (i) => srv.req(g, A, 'POST', '/agendamentos', { clienteId: `cli-${i}`, recursoId: R, servicoId: S, inicio }))
    expect(rs.filter((r) => r.status === 200).length).toBe(1); expect(rs.filter((r) => r.status === 409).length).toBe(11)
    const sobrepostos = (await b.admin.query(`SELECT count(*)::int AS n FROM servicos.agendamento a JOIN servicos.agendamento c ON a.recurso_id = c.recurso_id AND a.id < c.id AND a.inicio < c.fim AND a.fim > c.inicio AND a.status NOT IN ('cancelado','faltou') AND c.status NOT IN ('cancelado','faltou')`)).rows[0]!.n; expect(sobrepostos).toBe(0)
  })
  it('NUMERAÇÃO: 20 orçamentos simultâneos recebem 20 números DISTINTOS e sem buracos', async () => {
    const rs = await tudo(20, (i) => srv.req(['servicos.atendente'], A, 'POST', '/orcamentos', { clienteId: `c${i}` })); expect(rs.every((r) => r.status === 200)).toBe(true)
    expect(rs.map((r) => r.corpo.numero).sort((x, y) => x - y)).toEqual(Array.from({ length: 20 }, (_, i) => i + 1))
  })
})
