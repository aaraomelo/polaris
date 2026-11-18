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
import { criaEstoque, criaServicos, nosDoPack } from '../src/index'

const A = '11111111-1111-1111-1111-111111111111', B = '22222222-2222-2222-2222-222222222222', ISS = 'https://id.teste', AUD = 'polaris'
const PECA = '77777777-0000-0000-0000-000000000001'
const regS = new Registry(); for (const n of nosDoPack('servicos')) regS.registra(n)
const regE = new Registry(); for (const n of nosDoPack('estoque')) regE.registra(n); for (const p of ['vendas', 'servicos'] as const) for (const n of nosDoPack(p)) if ((n as { kind: string }).kind === 'evento') regE.registra(n)
const noS = regS.resolve('servico', 'servicos')!.no, noE = regE.resolve('servico', 'estoque')!.no
const eventos = Object.fromEntries(regS.ids('evento').map((id) => [id, regS.resolve('evento', id)!.no])) as Record<string, No>
it('nós do pack Serviços: registram, referências resolvem, SQL e OpenAPI emitem', () => { expect(regS.verificaTudo().filter((x) => x.erros.length)).toEqual([]); expect(() => emite(noS, 'sql')).not.toThrow(); expect(() => emite(noS, 'openapi')).not.toThrow() })

let pgS: PGlite, pgE: PGlite, appS: FastifyInstance, appE: FastifyInstance, priv: KeyLike
const consulta = (tx: { query: PGlite['query'] }): Consulta => async (sql, params) => { const r = await tx.query(sql, params as unknown[]); return { rows: r.rows as Record<string, unknown>[], rowCount: r.affectedRows ?? r.rows.length } }
const dbDe = (pg: () => PGlite): DbTenant => ({ transacao: (t, fn) => pg().transaction(async (tx) => { await tx.exec('SET LOCAL ROLE app'); await tx.query(`SELECT set_config('app.tenant_id', $1, true)`, [t]); return fn(consulta(tx)) }) })
const dbRelayS: DbSistema = { transacao: (fn) => pgS.transaction(async (tx) => { await tx.exec('SET LOCAL ROLE relay'); return fn(consulta(tx)) }) }
const sqlDe = (pg: () => PGlite) => async (s: string, p: unknown[] = []) => (await pg().transaction(async (tx) => { await tx.exec('SET LOCAL ROLE relay'); return tx.query(s, p) })).rows as Array<Record<string, any>>
const sqlS = sqlDe(() => pgS), sqlE = sqlDe(() => pgE)
const token = (sub: string, papeis: string[], tid = A) => new SignJWT({ tid, papeis }).setProtectedHeader({ alg: 'RS256' }).setSubject(sub).setIssuer(ISS).setAudience(AUD).setExpirationTime('10m').sign(priv)
const http = (app: () => FastifyInstance) => async (tok: string, m: string, url: string, corpo: unknown = m === 'POST' ? {} : undefined) => { const r = await app().inject({ method: m as 'GET', url, headers: { authorization: `Bearer ${tok}`, ...(corpo !== undefined ? { 'content-type': 'application/json' } : {}) }, ...(corpo !== undefined ? { payload: JSON.stringify(corpo) } : {}) }); return { status: r.statusCode, corpo: r.body ? JSON.parse(r.body) : null } }
const api = http(() => appS), estoque = http(() => appE)
let ger: string, atd: string, tec: string, R1 = '', R2 = '', CORTE = '', TINTURA = '', GAR = ''
const amanha = new Date(Date.now() + 24 * 3600_000); amanha.setUTCHours(13, 0, 0, 0)
const em = (minutos: number) => new Date(amanha.getTime() + minutos * 60_000).toISOString()

beforeAll(async () => {
  const k = await generateKeyPair('RS256'); priv = k.privateKey
  const prepara = async (no: No, schema: string) => { const pg = new PGlite(); await pg.exec(`CREATE ROLE migrador NOLOGIN BYPASSRLS; CREATE ROLE relay NOLOGIN BYPASSRLS; CREATE ROLE app NOLOGIN; GRANT CREATE ON DATABASE postgres TO migrador; SET ROLE migrador;`); await pg.exec(emite(no, 'sql')); await pg.exec(`RESET ROLE; GRANT USAGE ON SCHEMA ${schema} TO app, relay; GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA ${schema} TO app, relay;`); return pg }
  pgS = await prepara(noS, 'servicos'); pgE = await prepara(noE, 'estoque')
  const autentica = criaAutenticadorJwt({ emissor: ISS, audiencia: AUD, chave: { publica: k.publicKey } })
  appS = criaServico(noS, { db: dbDe(() => pgS), acesso: regrasDoRegistry(regS), contexto: contextoPorJwt(autentica), operacoes: criaServicos(noS).operacoes, eventos })
  appE = criaServico(noE, { db: dbDe(() => pgE), acesso: regrasDoRegistry(regE), contexto: contextoPorJwt(autentica), operacoes: criaEstoque(noE).operacoes })
  await appS.ready(); await appE.ready(); ger = await token('gil', ['servicos.gerente']); atd = await token('ana', ['servicos.atendente']); tec = await token('teo', ['servicos.tecnico'])
  R1 = (await api(ger, 'POST', '/recursos', { nome: 'Bia' })).corpo.id; R2 = (await api(ger, 'POST', '/recursos', { nome: 'Caio' })).corpo.id
  CORTE = (await api(ger, 'POST', '/servicos-oferecidos', { nome: 'Corte', duracaoMin: 30, preco: '50.00' })).corpo.id; TINTURA = (await api(ger, 'POST', '/servicos-oferecidos', { nome: 'Tintura', duracaoMin: 90, preco: '180.00' })).corpo.id
  GAR = (await api(ger, 'POST', '/termos-garantia', { nome: '90 dias', dias: 90, texto: 'Garantia de 90 dias para o serviço executado.' })).corpo.id
})
afterAll(async () => { await appS.close(); await appE.close(); await pgS.close(); await pgE.close() })

describe('agenda: sem conflito por recurso', () => {
  const agenda = (inicio: string, recursoId = R1, servicoId = CORTE, tok = atd) => api(tok, 'POST', '/agendamentos', { clienteId: 'cli-1', recursoId, servicoId, inicio })
  it('o fim vem da duração do serviço; sobreposição é 409; encostar (fim = início) pode; outro recurso pode', async () => {
    const a = await agenda(em(0)); expect(a.status).toBe(200); expect(a.corpo).toMatchObject({ status: 'agendado', inicio: em(0), fim: em(30) })
    expect((await agenda(em(15))).corpo.erro.codigo).toBe('horario_ocupado'); expect((await agenda(em(-10), R1, TINTURA)).corpo.erro.codigo).toBe('horario_ocupado') // o fim da tintura (90 min) invade
    expect((await agenda(em(30))).status).toBe(200); expect((await agenda(em(-30))).status).toBe(200); expect((await agenda(em(15), R2)).status).toBe(200)
  })
  it('cancelar e faltar LIBERAM o horário; remarcar respeita conflito mas não conflita consigo mesmo', async () => {
    const a = (await agenda(em(300))).corpo.id; expect((await agenda(em(310))).status).toBe(409)
    expect((await api(atd, 'POST', `/agendamentos/${a}/remarcar`, { inicio: em(310) })).status).toBe(200) // desloca 10 min dentro do próprio intervalo
    expect((await api(atd, 'POST', `/agendamentos/${a}/status`, { para: 'cancelado' })).corpo.status).toBe('cancelado'); const b = await agenda(em(310)); expect(b.status).toBe(200)
    expect((await api(atd, 'POST', `/agendamentos/${b.corpo.id}/remarcar`, { inicio: em(0) })).corpo.erro.codigo).toBe('horario_ocupado')
    expect((await api(atd, 'POST', `/agendamentos/${a}/remarcar`, { inicio: em(600) })).corpo.erro.codigo).toBe('estado_invalido') // cancelado não se remarca
    const c = (await agenda(em(700))).corpo.id; await api(atd, 'POST', `/agendamentos/${c}/status`, { para: 'faltou' }); expect((await agenda(em(700))).status).toBe(200)
  })
  it('passado, recurso/serviço inativo ou inexistente, data inválida são recusados', async () => {
    expect((await agenda(new Date(Date.now() - 3600_000).toISOString())).corpo.erro.codigo).toBe('no_passado'); expect((await agenda('ontem')).status).toBe(400)
    const off = (await api(ger, 'POST', '/recursos', { nome: 'Off', ativo: false })).corpo.id; expect((await agenda(em(900), off)).corpo.erro.codigo).toBe('recurso_inativo')
    const soff = (await api(ger, 'POST', '/servicos-oferecidos', { nome: 'Antigo', duracaoMin: 10, preco: '1.00', ativo: false })).corpo.id; expect((await agenda(em(900), R1, soff)).corpo.erro.codigo).toBe('servico_inativo')
    expect((await agenda(em(900), '99999999-9999-9999-9999-999999999999')).status).toBe(404)
  })
  it('máquina de estados do agendamento; repetir a mesma transição é no-op; estado final não sai', async () => {
    const id = (await agenda(em(1200))).corpo.id; const st = (para: string) => api(atd, 'POST', `/agendamentos/${id}/status`, { para })
    expect((await st('confirmado')).corpo.status).toBe('confirmado'); expect((await st('confirmado')).status).toBe(200); expect((await st('concluido')).corpo.erro.codigo).toBe('transicao_invalida')
    expect((await st('em_atendimento')).status).toBe(200); expect((await st('concluido')).corpo.status).toBe('concluido'); expect((await st('cancelado')).corpo.erro.codigo).toBe('transicao_invalida'); expect((await st('banana')).status).toBe(400)
  })
  it('duas requisições concorrentes pelo MESMO horário: só uma entra', async () => {
    const [x, y] = await Promise.all([agenda(em(2000), R2), agenda(em(2000), R2)]); expect([x.status, y.status].sort()).toEqual([200, 409])
  })
  it('outro tenant não vê nem usa recurso do primeiro', async () => {
    const atdB = await token('anab', ['servicos.atendente'], B); expect((await api(atdB, 'POST', '/agendamentos', { clienteId: 'x', recursoId: R1, servicoId: CORTE, inicio: em(0) })).status).toBe(404); expect((await api(atdB, 'GET', '/agendamentos')).corpo).toEqual([])
  })
})

describe('orçamento → ordem de serviço', () => {
  let orc = '', numero = 0
  it('números sequenciais por tenant; totais EXATOS (linha, subtotal, desconto)', async () => {
    const o1 = await api(atd, 'POST', '/orcamentos', { clienteId: 'cli-9', notas: 'revisão geral' }), o2 = await api(atd, 'POST', '/orcamentos', { clienteId: 'cli-9' }); expect([o1.corpo.numero, o2.corpo.numero]).toEqual([1, 2]); orc = o1.corpo.id; numero = o1.corpo.numero
    const pc = await api(atd, 'POST', `/orcamentos/${orc}/itens`, { tipo: 'peca', produtoId: PECA, descricao: 'Filtro', quantidade: 2, precoUnitario: '19.99', desconto: '0.98' }); expect(pc.corpo).toMatchObject({ total: '39.0000' }) // 2 × 19,99 − 0,98
    await api(atd, 'POST', `/orcamentos/${orc}/itens`, { tipo: 'servico', descricao: 'Mão de obra', quantidade: 1, precoUnitario: '100.00' })
    expect((await api(atd, 'GET', `/orcamentos/${orc}`)).corpo).toMatchObject({ subtotal: '139.0000', total: '139.0000', status: 'rascunho' })
    const sem = await api(atd, 'POST', '/orcamentos', { clienteId: 'x', desconto: '9.00' }); await api(atd, 'POST', `/orcamentos/${sem.corpo.id}/itens`, { tipo: 'servico', descricao: 'S', quantidade: 3, precoUnitario: '10.10' })
    expect((await api(atd, 'GET', `/orcamentos/${sem.corpo.id}`)).corpo).toMatchObject({ subtotal: '30.3000', desconto: '9.0000', total: '21.3000' })
  })
  it('validações de item: tipo, serviço sem produto, desconto maior que a linha, quantidade, preço', async () => {
    const add = (e: object) => api(atd, 'POST', `/orcamentos/${orc}/itens`, { tipo: 'servico', descricao: 'x', quantidade: 1, precoUnitario: '10.00', ...e })
    expect((await add({ tipo: 'brinde' })).status).toBe(400); expect((await add({ produtoId: PECA })).status).toBe(400); expect((await add({ desconto: '10.01' })).corpo.erro.codigo).toBe('desconto_maior_que_item')
    for (const e of [{ quantidade: 0 }, { quantidade: -1 }, { precoUnitario: 'abc' }, { descricao: '  ' }]) expect((await add(e)).status, JSON.stringify(e)).toBe(400)
    expect((await api(atd, 'POST', `/orcamentos/${orc}/itens`, { tipo: 'servico', descricao: 'x', quantidade: 1, precoUnitario: 10.5 })).status).toBe(400) // dinheiro como número
  })
  it('remover item recalcula; vazio não envia; enviado não edita; só enviado se decide', async () => {
    const o = (await api(atd, 'POST', '/orcamentos', { clienteId: 'c' })).corpo.id; expect((await api(atd, 'POST', `/orcamentos/${o}/enviar`)).corpo.erro.codigo).toBe('orcamento_vazio')
    const i = (await api(atd, 'POST', `/orcamentos/${o}/itens`, { tipo: 'servico', descricao: 'a', quantidade: 1, precoUnitario: '5.00' })).corpo.id; await api(atd, 'POST', `/orcamentos/${o}/itens`, { tipo: 'servico', descricao: 'b', quantidade: 1, precoUnitario: '7.00' })
    expect((await api(atd, 'POST', `/orcamentos/${o}/itens/${i}/remover`)).corpo.total).toBe('7.0000'); expect((await api(atd, 'POST', `/orcamentos/${o}/itens/${i}/remover`)).status).toBe(404)
    expect((await api(atd, 'POST', `/orcamentos/${o}/decidir`, { decisao: 'aprovar' })).corpo.erro.codigo).toBe('transicao_invalida')
    expect((await api(atd, 'POST', `/orcamentos/${o}/enviar`)).corpo.status).toBe('enviado'); expect((await api(atd, 'POST', `/orcamentos/${o}/enviar`)).status).toBe(200)
    expect((await api(atd, 'POST', `/orcamentos/${o}/itens`, { tipo: 'servico', descricao: 'c', quantidade: 1, precoUnitario: '1.00' })).corpo.erro.codigo).toBe('orcamento_fechado')
    expect((await api(atd, 'POST', `/orcamentos/${o}/decidir`, { decisao: 'rejeitar' })).corpo.status).toBe('rejeitado'); expect((await api(atd, 'POST', `/orcamentos/${o}/converter`)).corpo.erro.codigo).toBe('transicao_invalida')
  })
  it('validade: aprovar depois do prazo é 422; o job expira os vencidos; o que não venceu fica', async () => {
    const vencido = (await api(atd, 'POST', '/orcamentos', { clienteId: 'c', validoAte: '2000-01-01' })).corpo.id; await api(atd, 'POST', `/orcamentos/${vencido}/itens`, { tipo: 'servico', descricao: 'a', quantidade: 1, precoUnitario: '5.00' }); await api(atd, 'POST', `/orcamentos/${vencido}/enviar`)
    expect((await api(atd, 'POST', `/orcamentos/${vencido}/decidir`, { decisao: 'aprovar' })).corpo.erro.codigo).toBe('orcamento_expirado')
    const r = await api(atd, 'POST', '/orcamentos/expirar'); expect(r.corpo.map((x: any) => x.id)).toContain(vencido); expect((await api(atd, 'GET', `/orcamentos/${orc}`)).corpo.status).toBe('rascunho')
  })
  it('aprovado vira OS: itens e totais copiados, orçamento `convertido`, repetir devolve a MESMA OS (sem duplicar)', async () => {
    await api(atd, 'POST', `/orcamentos/${orc}/enviar`); expect((await api(atd, 'POST', `/orcamentos/${orc}/converter`)).corpo.erro.codigo).toBe('transicao_invalida') // ainda não aprovado
    await api(atd, 'POST', `/orcamentos/${orc}/decidir`, { decisao: 'aprovar' }); const os = await api(atd, 'POST', `/orcamentos/${orc}/converter`, { termoGarantiaId: GAR, responsavelId: 'teo', objeto: 'Placa ABC-1234' })
    expect(os.status).toBe(200); expect(os.corpo).toMatchObject({ status: 'aberta', total: '139.0000', totalPecas: '39.0000', totalServicos: '100.0000', responsavelId: 'teo', orcamentoId: orc, objeto: 'Placa ABC-1234' }); expect(os.corpo.descricao).toContain(`nº ${numero}`)
    expect((await api(atd, 'POST', `/orcamentos/${orc}/converter`)).corpo.id).toBe(os.corpo.id); expect((await sqlS(`SELECT count(*)::int AS n FROM servicos.ordem_servico WHERE orcamento_id = $1`, [orc]))[0]!.n).toBe(1)
    expect((await sqlS(`SELECT count(*)::int AS n FROM servicos.item_ordem_servico WHERE ordem_servico_id = $1`, [os.corpo.id]))[0]!.n).toBe(2); expect((await api(atd, 'GET', `/orcamentos/${orc}`)).corpo).toMatchObject({ status: 'convertido', ordemServicoId: os.corpo.id })
  })
})

describe('ordem de serviço: estados, itens, garantia e evento', () => {
  const nova = async (extra: object = {}) => (await api(atd, 'POST', '/ordens-servico', { clienteId: 'cli-5', descricao: 'Trocar filtro', responsavelId: 'teo', ...extra })).corpo.id as string
  const item = (os: string, e: object, tok = atd) => api(tok, 'POST', `/ordens-servico/${os}/itens`, { tipo: 'servico', descricao: 'Mão de obra', quantidade: 1, precoUnitario: '80.00', ...e })
  const st = (os: string, para: string, extra: object = {}, tok = atd) => api(tok, 'POST', `/ordens-servico/${os}/status`, { para, ...extra })
  it('fluxo completo: aberta → andamento → aguardando → andamento → concluída → entregue; só transições válidas', async () => {
    const os = await nova({ termoGarantiaId: GAR }); await item(os, {}); await item(os, { tipo: 'peca', produtoId: PECA, descricao: 'Filtro', quantidade: 2, precoUnitario: '19.99' })
    expect((await api(atd, 'GET', `/ordens-servico/${os}`)).corpo).toMatchObject({ totalPecas: '39.9800', totalServicos: '80.0000', total: '119.9800' })
    expect((await st(os, 'concluida')).corpo.erro.codigo).toBe('transicao_invalida'); expect((await st(os, 'em_andamento', { diagnostico: 'filtro saturado' })).corpo).toMatchObject({ status: 'em_andamento', diagnostico: 'filtro saturado' })
    expect((await st(os, 'aguardando_peca')).status).toBe(200); expect((await st(os, 'entregue')).status).toBe(409); await st(os, 'em_andamento'); expect((await st(os, 'concluida')).corpo.status).toBe('concluida')
    const e = await st(os, 'entregue'); expect(e.corpo.status).toBe('entregue')
    const g = (await sqlS(`SELECT garantia_ate::text AS g, (current_date + 90)::text AS esperado FROM servicos.ordem_servico WHERE id = $1`, [os]))[0]!; expect(g.g).toBe(g.esperado) // garantia = entrega + dias do termo
    expect((await st(os, 'cancelada', { motivo: 'x' })).corpo.erro.codigo).toBe('transicao_invalida'); expect((await item(os, {})).corpo.erro.codigo).toBe('os_fechada')
  })
  it('sem termo não há garantia; OS vazia não conclui; cancelar exige motivo e fecha a OS; remover item recalcula', async () => {
    const os = await nova(); await st(os, 'em_andamento'); expect((await st(os, 'concluida')).corpo.erro.codigo).toBe('os_sem_itens')
    await item(os, {}); await item(os, { descricao: 'Extra', precoUnitario: '20.00' }); const i = (await sqlS(`SELECT id::text AS id FROM servicos.item_ordem_servico WHERE ordem_servico_id = $1 AND descricao = 'Mão de obra'`, [os]))[0]!.id; expect((await api(atd, 'POST', `/ordens-servico/${os}/itens/${i}/remover`)).corpo.total).toBe('20.0000')
    await st(os, 'concluida'); await st(os, 'entregue'); expect((await sqlS(`SELECT garantia_ate FROM servicos.ordem_servico WHERE id = $1`, [os]))[0]!.garantia_ate).toBeNull()
    const c = await nova(); expect((await st(c, 'cancelada')).status).toBe(400); expect((await st(c, 'cancelada', { motivo: 'cliente desistiu' })).corpo).toMatchObject({ status: 'cancelada', motivoCancelamento: 'cliente desistiu' }); expect((await st(c, 'em_andamento')).status).toBe(409)
  })
  it('conclusão publica `os.concluida` UMA vez, com as peças agregadas (só as que têm produto)', async () => {
    const os = await nova(); await item(os, {}); await item(os, { tipo: 'peca', produtoId: PECA, descricao: 'Filtro', quantidade: 1, precoUnitario: '10.00' }); await item(os, { tipo: 'peca', produtoId: PECA, descricao: 'Filtro', quantidade: 2, precoUnitario: '10.00' }); await item(os, { tipo: 'peca', descricao: 'Parafusos (avulso)', quantidade: 5, precoUnitario: '0.10' })
    await st(os, 'em_andamento'); await st(os, 'concluida'); await st(os, 'concluida')
    const ev = await sqlS(`SELECT payload FROM servicos.outbox WHERE tipo = 'os.concluida' AND chave = $1`, [os]); expect(ev.length).toBe(1)
    expect(ev[0]!.payload).toMatchObject({ ordemServicoId: os, itens: [{ produtoId: PECA, quantidade: '3' }] })
  })
  it('papéis: o técnico só mexe na OS em que é o responsável (a dos outros é 404); não abre OS nem vê orçamento; o atendente tudo; só o gerente configura', async () => {
    const minha = await nova(), alheia = await nova({ responsavelId: 'outro' })
    expect((await item(minha, {}, tec)).status).toBe(200); expect((await st(minha, 'em_andamento', {}, tec)).status).toBe(200)
    expect((await item(alheia, {}, tec)).status).toBe(404); expect((await st(alheia, 'em_andamento', {}, tec)).status).toBe(404); expect((await api(tec, 'GET', `/ordens-servico/${alheia}`)).status).toBe(200) // ler todas pode
    expect((await api(tec, 'POST', '/ordens-servico', { clienteId: 'x', descricao: 'y' })).status).toBe(403); expect((await api(tec, 'GET', '/orcamentos')).status).toBe(403)
    expect((await api(atd, 'POST', '/recursos', { nome: 'Novo' })).status).toBe(403); expect((await api(ger, 'POST', '/recursos', { nome: 'Novo' })).status).toBe(201)
    expect((await api(await token('x', []), 'GET', '/ordens-servico')).status).toBe(403)
  })
})

describe('OS concluída → Estoque baixa as peças (dois serviços, dois bancos)', () => {
  const est = criaEstoque(noE)
  async function entrega() { const bus = criaBarramentoMemoria({ maxTentativas: 1 }); bus.assina(est.consumidor(dbDe(() => pgE))); const relay = criaRelay({ db: dbRelayS, servico: 'servicos', barramento: bus, espera: () => 0 }); for (let i = 0; i < 4; i++) { const r = await relay.executa(); await bus.aguarda(); if (!r.publicados) break } return bus }
  const osComPeca = async (quantidade: number) => { const os = (await api(atd, 'POST', '/ordens-servico', { clienteId: 'c', descricao: 'd', responsavelId: 'teo' })).corpo.id; await api(atd, 'POST', `/ordens-servico/${os}/itens`, { tipo: 'peca', produtoId: PECA, descricao: 'Peça', quantidade, precoUnitario: '10.00' }); await api(atd, 'POST', `/ordens-servico/${os}/status`, { para: 'em_andamento' }); await api(atd, 'POST', `/ordens-servico/${os}/status`, { para: 'concluida' }); return os as string }
  const saldo = async () => (await sqlE(`SELECT to_char(quantidade, 'FM999990.0000') AS q FROM estoque.saldo WHERE item_id = $1`, [PECA]))[0]?.q
  it('baixa as peças (consumo, custo médio, uma vez); sem estoque suficiente a OS NÃO volta atrás: fica `divergente`', async () => {
    const gE = await token('ge', ['estoque.gerente']), dep = (await estoque(gE, 'POST', '/depositos', { codigo: 'OF', nome: 'Oficina', padrao: true })).corpo.id
    await estoque(await token('oe', ['estoque.operador']), 'POST', '/estoque/entrada', { produtoId: PECA, depositoId: dep, quantidade: 5, custoUnitario: '6.00', chave: 'entrada-oficina-0001' })
    await sqlS(`UPDATE servicos.outbox SET publicado_em = now() WHERE publicado_em IS NULL`) // as OS dos testes anteriores já têm eventos; aqui só interessam as novas
    const os = await osComPeca(2); const bus = await entrega(); expect(bus.mortas()).toEqual([]); expect(await saldo()).toBe('3.0000')
    expect(await sqlE(`SELECT tipo, to_char(delta, 'FM990.0000') AS d, custo_unitario::text AS c, ref_tipo FROM estoque.movimento WHERE ref_id = $1`, [os])).toEqual([{ tipo: 'consumo', d: '-2.0000', c: '6.0000', ref_tipo: 'ordem_servico' }])
    await entrega(); expect(await saldo()).toBe('3.0000') // reentrega: o inbox barra
    for (let i = 0; i < 2; i++) await dbDe(() => pgE).transacao(A, (q) => est.baixaDaOS(q, A, os, [{ produtoId: PECA, quantidade: '2' }])); expect(await saldo()).toBe('3.0000') // sem o inbox, a própria baixa é idempotente
    const grande = await osComPeca(50); await entrega(); expect(await saldo()).toBe('3.0000'); expect((await sqlE(`SELECT status, motivo FROM estoque.reserva WHERE pedido_id = $1`, [grande]))[0]!.status).toBe('divergente')
    expect((await api(atd, 'GET', `/ordens-servico/${grande}`)).corpo.status).toBe('concluida') // a OS já foi feita
  })
})
