process.env.POLARIS_LOG_NIVEL = 'silencio'
import { vi } from 'vitest'
vi.setConfig({ testTimeout: 60_000, hookTimeout: 60_000 })
import { PGlite } from '@electric-sql/pglite'
import { criaAutenticadorJwt } from '@polaris/acesso'
import type { Consulta, DbTenant } from '@polaris/eventos'
import { Registry, emite, type No } from '@polaris/schema'
import { contextoPorJwt, criaServico, regrasDoRegistry } from '@polaris/servico'
import { SignJWT, generateKeyPair, type KeyLike } from 'jose'
import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { criaAlimentos, divideConta, nosDoPack, paraCentavos4 } from '../src/index'

const A = '11111111-1111-1111-1111-111111111111', B = '22222222-2222-2222-2222-222222222222', ISS = 'https://id.teste', AUD = 'polaris'

describe('divideConta: as partes SOMAM exatamente o total', () => {
  it('casos conhecidos: resto de centavos nas primeiras partes', () => {
    expect(divideConta('86.90', 3)).toEqual(['28.97', '28.97', '28.96']); expect(divideConta('100.00', 3)).toEqual(['33.34', '33.33', '33.33']); expect(divideConta('10.00', 4)).toEqual(['2.50', '2.50', '2.50', '2.50'])
    expect(divideConta('0.01', 3)).toEqual(['0.01', '0.00', '0.00']); expect(divideConta('0.0005', 2)).toEqual(['0.0003', '0.0002']); expect(() => divideConta('1', 0)).toThrow(); expect(() => divideConta('-1', 2)).toThrow()
  })
  it('FUZZ: 3000 totais × n — soma exata, partes diferem no máximo uma unidade, nenhuma negativa', () => {
    let s = 987654321; const rnd = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff }
    for (let k = 0; k < 3000; k++) {
      const cent = rnd() < 0.8, v = Math.floor(rnd() * 1_000_000), total = cent ? `${Math.floor(v / 100)}.${String(v % 100).padStart(2, '0')}` : `${Math.floor(v / 10000)}.${String(v % 10000).padStart(4, '0')}`, n = 1 + Math.floor(rnd() * 20)
      const ps = divideConta(total, n).map(paraCentavos4); expect(ps.reduce((a, b) => a + b, 0n)).toBe(paraCentavos4(total))
      expect(ps.every((p) => p >= 0n)).toBe(true); expect(ps.reduce((a, b) => (a > b ? a : b)) - ps.reduce((a, b) => (a < b ? a : b))).toBeLessThanOrEqual(paraCentavos4(total) % 100n === 0n ? 100n : 1n)
    }
  })
})

const reg = new Registry(); for (const n of nosDoPack('alimentos')) reg.registra(n)
const no = reg.resolve('servico', 'alimentos')!.no
const eventos = Object.fromEntries(reg.ids('evento').map((id) => [id, reg.resolve('evento', id)!.no])) as Record<string, No>
it('nós do pack Alimentos: registram, referências resolvem, SQL e OpenAPI emitem', () => { expect(reg.verificaTudo().filter((x) => x.erros.length)).toEqual([]); expect(() => emite(no, 'sql')).not.toThrow(); expect(() => emite(no, 'openapi')).not.toThrow() })

let pg: PGlite, app: FastifyInstance, priv: KeyLike
const consulta = (tx: { query: PGlite['query'] }): Consulta => async (sql, params) => { const r = await tx.query(sql, params as unknown[]); return { rows: r.rows as Record<string, unknown>[], rowCount: r.affectedRows ?? r.rows.length } }
const dbApp: DbTenant = { transacao: (t, fn) => pg.transaction(async (tx) => { await tx.exec('SET LOCAL ROLE app'); await tx.query(`SELECT set_config('app.tenant_id', $1, true)`, [t]); return fn(consulta(tx)) }) }
const sql = async (s: string, p: unknown[] = []) => (await pg.transaction(async (tx) => { await tx.exec('SET LOCAL ROLE relay'); return tx.query(s, p) })).rows as Array<Record<string, any>>
const token = (sub: string, papeis: string[], tid = A) => new SignJWT({ tid, papeis }).setProtectedHeader({ alg: 'RS256' }).setSubject(sub).setIssuer(ISS).setAudience(AUD).setExpirationTime('10m').sign(priv)
const api = async (tok: string, m: string, url: string, corpo: unknown = m === 'POST' ? {} : undefined) => { const r = await app.inject({ method: m as 'GET', url, headers: { authorization: `Bearer ${tok}`, ...(corpo !== undefined ? { 'content-type': 'application/json' } : {}) }, ...(corpo !== undefined ? { payload: JSON.stringify(corpo) } : {}) }); return { status: r.statusCode, corpo: r.body ? JSON.parse(r.body) : null } }
let ger: string, gar: string, coz: string, cai: string
let BURGER = '', SUCO = '', PUDIM = '', PONTO: string[] = [], ADIC: string[] = [], ADIC_OUTRO = '', M1 = '', M2 = '', M3 = ''
const lanca = (c: string, itemId: string, extra: object = {}, tok = gar) => api(tok, 'POST', `/comandas/${c}/itens`, { itemId, quantidade: 1, ...extra })
const abre = async (tipo = 'mesa', extra: object = {}) => (await api(gar, 'POST', '/comandas', { tipo, ...(tipo === 'mesa' ? { mesaId: M1 } : {}), ...extra })).corpo.id as string
const comanda = async (id: string) => (await api(ger, 'GET', `/comandas/${id}`)).corpo
/** leva um item até entregue */
const servir = async (item: string) => { await api(coz, 'POST', `/itens-comanda/${item}/iniciar`); await api(coz, 'POST', `/itens-comanda/${item}/pronto`); await api(gar, 'POST', `/itens-comanda/${item}/entregar`) }

beforeAll(async () => {
  const k = await generateKeyPair('RS256'); priv = k.privateKey
  pg = new PGlite(); await pg.exec(`CREATE ROLE migrador NOLOGIN BYPASSRLS; CREATE ROLE relay NOLOGIN BYPASSRLS; CREATE ROLE app NOLOGIN; GRANT CREATE ON DATABASE postgres TO migrador; SET ROLE migrador;`)
  await pg.exec(emite(no, 'sql')); await pg.exec(`RESET ROLE; GRANT USAGE ON SCHEMA alimentos TO app, relay; GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA alimentos TO app, relay;`)
  app = criaServico(no, { db: dbApp, acesso: regrasDoRegistry(reg), contexto: contextoPorJwt(criaAutenticadorJwt({ emissor: ISS, audiencia: AUD, chave: { publica: k.publicKey } })), operacoes: criaAlimentos(no).operacoes, eventos })
  await app.ready(); ger = await token('gil', ['alimentos.gerente']); gar = await token('gui', ['alimentos.garcom']); coz = await token('cris', ['alimentos.cozinha']); cai = await token('cacá', ['alimentos.caixa'])
  const cat = (await api(ger, 'POST', '/categorias-cardapio', { nome: 'Pratos' })).corpo.id
  BURGER = (await api(ger, 'POST', '/itens-cardapio', { categoriaId: cat, nome: 'Hambúrguer', preco: '30.00', estacao: 'cozinha' })).corpo.id
  SUCO = (await api(ger, 'POST', '/itens-cardapio', { categoriaId: cat, nome: 'Suco', preco: '8.00', estacao: 'bar' })).corpo.id
  PUDIM = (await api(ger, 'POST', '/itens-cardapio', { categoriaId: cat, nome: 'Pudim', preco: '12.00', estacao: 'sobremesa' })).corpo.id
  const gPonto = (await api(ger, 'POST', '/grupos-modificador', { nome: 'Ponto da carne', minimo: 1, maximo: 1 })).corpo.id, gAdic = (await api(ger, 'POST', '/grupos-modificador', { nome: 'Adicionais', minimo: 0, maximo: 2 })).corpo.id, gOutro = (await api(ger, 'POST', '/grupos-modificador', { nome: 'Gelo', minimo: 0, maximo: 1 })).corpo.id
  for (const n of ['Mal passado', 'Ao ponto', 'Bem passado']) PONTO.push((await api(ger, 'POST', '/opcoes', { grupoId: gPonto, nome: n, acrescimo: '0' })).corpo.id)
  for (const [n, a] of [['Bacon', '5.50'], ['Queijo', '4.00'], ['Ovo', '3.00']] as const) ADIC.push((await api(ger, 'POST', '/opcoes', { grupoId: gAdic, nome: n, acrescimo: a })).corpo.id)
  ADIC_OUTRO = (await api(ger, 'POST', '/opcoes', { grupoId: gOutro, nome: 'Sem gelo', acrescimo: '0' })).corpo.id // grupo que NÃO é do hambúrguer
  for (const g of [gPonto, gAdic]) await api(ger, 'POST', '/itens-grupos', { itemId: BURGER, grupoId: g })
  M1 = (await api(ger, 'POST', '/mesas', { numero: 1 })).corpo.id; M2 = (await api(ger, 'POST', '/mesas', { numero: 2 })).corpo.id; M3 = (await api(ger, 'POST', '/mesas', { numero: 3, ativo: false })).corpo.id
})
afterAll(async () => { await app.close(); await pg.close() })

describe('lançar item: modificadores com mínimo e máximo por grupo', () => {
  it('total = (preço + acréscimos) × quantidade; a foto do momento não muda se o cardápio muda depois', async () => {
    const c = await abre('balcao'); const r = await lanca(c, BURGER, { quantidade: 2, modificadores: [PONTO[1], ADIC[0], ADIC[1]], observacao: 'sem cebola' })
    expect(r.status).toBe(200); expect(r.corpo).toMatchObject({ nome: 'Hambúrguer', estacao: 'cozinha', quantidade: 2, precoBase: '30.0000', total: '79.0000', status: 'novo', observacao: 'sem cebola' }) // (30 + 5,50 + 4,00) × 2
    expect(r.corpo.modificadores.map((m: any) => m.nome).sort()).toEqual(['Ao ponto', 'Bacon', 'Queijo']); expect((await comanda(c)).subtotal).toBe('79.0000')
    await api(ger, 'PATCH', `/itens-cardapio/${BURGER}`, { preco: '99.00' }); expect((await api(ger, 'GET', `/itens-comanda/${r.corpo.id}`)).corpo.total).toBe('79.0000'); await api(ger, 'PATCH', `/itens-cardapio/${BURGER}`, { preco: '30.00' })
  })
  it('obrigatório (mín. 1), máximo, opção de outro item, inativa, repetida, inexistente', async () => {
    const c = await abre('balcao'); const cod = async (e: object) => (await lanca(c, BURGER, e)).corpo.erro?.codigo
    expect(await cod({})).toBe('modificador_obrigatorio'); expect(await cod({ modificadores: [ADIC[0]] })).toBe('modificador_obrigatorio'); expect(await cod({ modificadores: [PONTO[0], PONTO[1]] })).toBe('modificador_excedido')
    expect(await cod({ modificadores: [PONTO[0], ADIC[0], ADIC[1], ADIC[2]] })).toBe('modificador_excedido'); expect(await cod({ modificadores: [PONTO[0], ADIC_OUTRO] })).toBe('opcao_invalida')
    expect(await cod({ modificadores: ['99999999-9999-9999-9999-999999999999'] })).toBe('opcao_invalida'); expect((await lanca(c, BURGER, { modificadores: [PONTO[0], PONTO[0]] })).status).toBe(400); expect((await lanca(c, BURGER, { modificadores: ['x'] })).status).toBe(400)
    await api(ger, 'PATCH', `/opcoes/${ADIC[2]}`, { ativo: false }); expect(await cod({ modificadores: [PONTO[0], ADIC[2]] })).toBe('indisponivel'); await api(ger, 'PATCH', `/opcoes/${ADIC[2]}`, { ativo: true })
    expect((await lanca(c, SUCO, { modificadores: [PONTO[0]] })).corpo.erro.codigo).toBe('opcao_invalida') // item sem grupos não aceita modificador
    expect((await lanca(c, SUCO)).status).toBe(200) // item sem grupos: sem exigência
  })
  it('item indisponível (acabou), quantidade fora de 1–99 ou fracionada, comanda fechada', async () => {
    const c = await abre('balcao'); await api(cai, 'PATCH', `/itens-cardapio/${PUDIM}`, { disponivel: false }).catch(() => null); await api(coz, 'PATCH', `/itens-cardapio/${PUDIM}`, { disponivel: false })
    expect((await lanca(c, PUDIM)).corpo.erro.codigo).toBe('indisponivel'); await api(coz, 'PATCH', `/itens-cardapio/${PUDIM}`, { disponivel: true })
    for (const q of [0, 100, 1.5, -1]) expect((await lanca(c, SUCO, { quantidade: q })).status, String(q)).toBe(400)
    expect((await lanca(c, '99999999-9999-9999-9999-999999999999')).status).toBe(404)
  })
})

describe('comanda: mesa, balcão e entrega', () => {
  it('mesa: uma comanda aberta por mesa (409 mesa_ocupada); fechar/cancelar libera; mesa inativa e dados incoerentes são recusados', async () => {
    const c = await abre('mesa'); expect((await api(gar, 'POST', '/comandas', { tipo: 'mesa', mesaId: M1 })).corpo.erro.codigo).toBe('mesa_ocupada'); const o2 = await api(gar, 'POST', '/comandas', { tipo: 'mesa', mesaId: M2 }); expect(o2.status).toBe(200)
    await api(gar, 'POST', `/comandas/${c}/cancelar`); const o1 = await api(gar, 'POST', '/comandas', { tipo: 'mesa', mesaId: M1 }); expect(o1.status).toBe(200)
    for (const x of [o1, o2]) await api(gar, 'POST', `/comandas/${x.corpo.id}/cancelar`) // libera as mesas para os próximos testes
    expect((await api(gar, 'POST', '/comandas', { tipo: 'mesa', mesaId: M3 })).corpo.erro.codigo).toBe('mesa_inativa'); expect((await api(gar, 'POST', '/comandas', { tipo: 'mesa' })).status).toBe(400); expect((await api(gar, 'POST', '/comandas', { tipo: 'balcao', mesaId: M1 })).status).toBe(400)
    expect((await api(gar, 'POST', '/comandas', { tipo: 'entrega' })).status).toBe(400); expect((await api(gar, 'POST', '/comandas', { tipo: 'balcao', taxaEntrega: '5.00' })).status).toBe(400); expect((await api(gar, 'POST', '/comandas', { tipo: 'viagem' })).status).toBe(400)
  })
  it('numeração sequencial por tenant', async () => { const a = await abre('balcao'), b = await abre('balcao'); expect((await comanda(b)).numero - (await comanda(a)).numero).toBe(1) })
  it('cancelar item novo devolve o subtotal; depois de iniciado só o gerente cancela; entregue não se cancela', async () => {
    const c = await abre('balcao'); const i1 = (await lanca(c, SUCO)).corpo.id, i2 = (await lanca(c, SUCO, { quantidade: 2 })).corpo.id; expect((await comanda(c)).subtotal).toBe('24.0000')
    expect((await api(gar, 'POST', `/itens-comanda/${i1}/cancelar`, { motivo: '' })).status).toBe(400); expect((await api(gar, 'POST', `/itens-comanda/${i1}/cancelar`, { motivo: 'cliente desistiu' })).corpo.status).toBe('cancelado'); expect((await comanda(c)).subtotal).toBe('16.0000')
    await api(coz, 'POST', `/itens-comanda/${i2}/iniciar`); expect((await api(gar, 'POST', `/itens-comanda/${i2}/cancelar`, { motivo: 'x' })).status).toBe(403); expect((await api(ger, 'POST', `/itens-comanda/${i2}/cancelar`, { motivo: 'queimou' })).corpo.status).toBe('cancelado')
    const i3 = (await lanca(c, SUCO)).corpo.id; await servir(i3); expect((await api(ger, 'POST', `/itens-comanda/${i3}/cancelar`, { motivo: 'x' })).corpo.erro.codigo).toBe('transicao_invalida')
  })
})

describe('cozinha (KDS) por estação', () => {
  it('a fila mostra só a estação pedida, só novo/em_preparo, do mais antigo ao mais novo; pronto sai da fila', async () => {
    const c = await abre('balcao'); const b1 = (await lanca(c, BURGER, { modificadores: [PONTO[0]] })).corpo.id, s1 = (await lanca(c, SUCO)).corpo.id, b2 = (await lanca(c, BURGER, { modificadores: [PONTO[2]] })).corpo.id
    const fila = async (e: string) => (await api(coz, 'GET', `/kds/fila?estacao=${e}`)).corpo.map((x: any) => x.id)
    expect((await fila('cozinha')).filter((x: string) => [b1, b2].includes(x))).toEqual([b1, b2]); expect((await fila('bar'))).toContain(s1); expect(await fila('bar')).not.toContain(b1)
    await api(coz, 'POST', `/itens-comanda/${b1}/iniciar`); expect(await fila('cozinha')).toContain(b1); await api(coz, 'POST', `/itens-comanda/${b1}/pronto`); expect(await fila('cozinha')).not.toContain(b1)
    expect((await api(coz, 'GET', '/kds/fila')).status).toBe(400)
  })
  it('só transições válidas; repetir é no-op; cada papel faz só a sua parte (cozinha não entrega, garçom não prepara)', async () => {
    const c = await abre('balcao'); const i = (await lanca(c, SUCO)).corpo.id
    expect((await api(coz, 'POST', `/itens-comanda/${i}/pronto`)).corpo.erro.codigo).toBe('transicao_invalida'); expect((await api(gar, 'POST', `/itens-comanda/${i}/iniciar`)).status).toBe(403)
    expect((await api(coz, 'POST', `/itens-comanda/${i}/iniciar`)).corpo.status).toBe('em_preparo'); expect((await api(coz, 'POST', `/itens-comanda/${i}/iniciar`)).status).toBe(200)
    expect((await api(gar, 'POST', `/itens-comanda/${i}/entregar`)).corpo.erro.codigo).toBe('transicao_invalida'); expect((await api(coz, 'POST', `/itens-comanda/${i}/pronto`)).corpo.status).toBe('pronto'); expect((await api(coz, 'POST', `/itens-comanda/${i}/entregar`)).status).toBe(403)
    const e = await api(gar, 'POST', `/itens-comanda/${i}/entregar`); expect(e.corpo.status).toBe('entregue'); expect((await sql(`SELECT preparo_iniciado_em IS NOT NULL AS a, pronto_em IS NOT NULL AS b FROM alimentos.item_comanda WHERE id = $1`, [i]))[0]).toEqual({ a: true, b: true })
  })
})

describe('fechar a conta, dividir e o evento', () => {
  it('só fecha com tudo entregue e ao menos um item; mesa cobra 10% por padrão; total exato; publica comanda.fechada UMA vez; fechada não aceita nada', async () => {
    const c = await abre('mesa', { mesaId: M2 }); expect((await api(cai, 'POST', `/comandas/${c}/fechar`)).corpo.erro.codigo).toBe('comanda_vazia')
    const i1 = (await lanca(c, BURGER, { quantidade: 2, modificadores: [PONTO[1], ADIC[0], ADIC[1]] })).corpo.id, i2 = (await lanca(c, SUCO)).corpo.id
    expect((await api(cai, 'POST', `/comandas/${c}/fechar`)).corpo.erro.codigo).toBe('itens_pendentes'); await servir(i1); expect((await api(cai, 'POST', `/comandas/${c}/fechar`)).status).toBe(422); await servir(i2)
    expect((await api(gar, 'POST', `/comandas/${c}/fechar`)).status).toBe(403) // garçom não fecha a conta
    const f = await api(cai, 'POST', `/comandas/${c}/fechar`); expect(f.corpo).toMatchObject({ status: 'fechada', subtotal: '87.0000', taxaServico: '8.7000', total: '95.7000' }) // 79 + 8 = 87; 10% = 8,70
    expect((await api(cai, 'POST', `/comandas/${c}/fechar`)).status).toBe(200); expect((await sql(`SELECT payload FROM alimentos.outbox WHERE tipo = 'comanda.fechada' AND chave = $1`, [c])).map((r) => r.payload)).toEqual([{ comandaId: c, total: '95.70', tipo: 'mesa' }])
    expect((await lanca(c, SUCO)).corpo.erro.codigo).toBe('comanda_fechada'); expect((await api(gar, 'POST', `/comandas/${c}/cancelar`)).corpo.erro.codigo).toBe('comanda_fechada')
    expect((await abre('mesa', { mesaId: M2 })).length).toBeGreaterThan(10) // a mesa foi liberada
  })
  it('percentual e desconto personalizados; balcão não cobra serviço; desconto maior que a conta é 422; percentual inválido é 400', async () => {
    const mk = async (tipo = 'balcao') => { const c = await abre(tipo, tipo === 'mesa' ? { mesaId: M1 } : {}); await servir((await lanca(c, SUCO, { quantidade: 5 })).corpo.id); return c }
    let c = await mk(); expect((await api(cai, 'POST', `/comandas/${c}/fechar`)).corpo).toMatchObject({ taxaServico: '0.0000', total: '40.0000' })
    c = await mk(); expect((await api(cai, 'POST', `/comandas/${c}/fechar`, { taxaServicoPercentual: 12.5, desconto: '3.00' })).corpo).toMatchObject({ taxaServico: '5.0000', total: '42.0000' }) // 40 + 5 − 3
    c = await mk(); expect((await api(cai, 'POST', `/comandas/${c}/fechar`, { desconto: '41.00' })).corpo.erro.codigo).toBe('desconto_maior_que_total'); expect((await api(cai, 'POST', `/comandas/${c}/fechar`, { taxaServicoPercentual: 101 })).status).toBe(400)
    expect((await api(cai, 'POST', `/comandas/${c}/fechar`, { desconto: '-1' })).status).toBe(400); expect((await comanda(c)).status).toBe('aberta') // as recusas não fecharam nada
  })
  it('dividir a conta: as partes somam o total; redividir antes de pagar substitui; com parte paga não refaz; só conta fechada', async () => {
    const c = await abre('mesa', { mesaId: M1 }); await servir((await lanca(c, BURGER, { quantidade: 2, modificadores: [PONTO[1], ADIC[0], ADIC[1]] })).corpo.id); await servir((await lanca(c, SUCO)).corpo.id)
    expect((await api(cai, 'POST', `/comandas/${c}/dividir`, { partes: 3 })).corpo.erro.codigo).toBe('comanda_aberta'); await api(cai, 'POST', `/comandas/${c}/fechar`) // total 95,70
    const p = await api(cai, 'POST', `/comandas/${c}/dividir`, { partes: 4 }); expect(p.corpo.map((x: any) => x.valor)).toEqual(['23.9300', '23.9300', '23.9200', '23.9200']); expect(p.corpo.reduce((a: number, x: any) => a + Math.round(Number(x.valor) * 10000), 0)).toBe(957000)
    expect((await api(cai, 'POST', `/comandas/${c}/dividir`, { partes: 2 })).corpo.map((x: any) => x.valor)).toEqual(['47.8500', '47.8500']); expect((await sql(`SELECT count(*)::int AS n FROM alimentos.parte_conta WHERE comanda_id = $1`, [c]))[0]!.n).toBe(2)
    await sql(`UPDATE alimentos.parte_conta SET paga = true WHERE comanda_id = $1 AND indice = 1`, [c]); expect((await api(cai, 'POST', `/comandas/${c}/dividir`, { partes: 3 })).corpo.erro.codigo).toBe('parte_paga')
    for (const n of [1, 51, 2.5]) expect((await api(cai, 'POST', `/comandas/${c}/dividir`, { partes: n })).status, String(n)).toBe(400)
  })
})

describe('delivery', () => {
  it('despacha só com tudo pronto; fechar exige a entrega confirmada; a taxa de entrega entra na conta e não paga serviço', async () => {
    const c = await abre('entrega', { enderecoEntrega: 'Rua A, 10', taxaEntrega: '5.00', clienteId: 'cli-7' }); expect((await comanda(c)).statusEntrega).toBe('aguardando')
    const i = (await lanca(c, SUCO, { quantidade: 2 })).corpo.id; expect((await api(gar, 'POST', `/comandas/${c}/despachar`, { entregador: 'moto-1' })).corpo.erro.codigo).toBe('itens_pendentes')
    await api(coz, 'POST', `/itens-comanda/${i}/iniciar`); await api(coz, 'POST', `/itens-comanda/${i}/pronto`); expect((await api(gar, 'POST', `/comandas/${c}/despachar`, {})).status).toBe(400)
    const d = await api(gar, 'POST', `/comandas/${c}/despachar`, { entregador: 'moto-1' }); expect(d.corpo).toMatchObject({ statusEntrega: 'saiu', entregador: 'moto-1' }); expect((await api(gar, 'POST', `/comandas/${c}/despachar`, { entregador: 'moto-1' })).status).toBe(200)
    expect((await api(cai, 'POST', `/comandas/${c}/fechar`)).corpo.erro.codigo).toBe('entrega_pendente'); expect((await api(gar, 'POST', `/comandas/${c}/entrega-confirmada`)).corpo.statusEntrega).toBe('entregue')
    expect((await api(cai, 'POST', `/comandas/${c}/fechar`)).corpo).toMatchObject({ subtotal: '16.0000', taxaServico: '0.0000', taxaEntrega: '5.0000', total: '21.0000' })
    const m = await abre('balcao'); expect((await api(gar, 'POST', `/comandas/${m}/despachar`, { entregador: 'x' })).corpo.erro.codigo).toBe('nao_e_entrega'); expect((await api(gar, 'POST', `/comandas/${m}/entrega-confirmada`)).corpo.erro.codigo).toBe('nao_e_entrega')
  })
  it('cancelar a comanda: só com itens novos (cancela-os junto); em preparo exige tratar antes', async () => {
    const c = await abre('balcao'); await lanca(c, SUCO); const ok = await api(gar, 'POST', `/comandas/${c}/cancelar`); expect(ok.corpo).toMatchObject({ status: 'cancelada', total: '0.0000' }); expect((await sql(`SELECT status FROM alimentos.item_comanda WHERE comanda_id = $1`, [c])).map((r) => r.status)).toEqual(['cancelado'])
    const d = await abre('balcao'); const i = (await lanca(d, SUCO)).corpo.id; await api(coz, 'POST', `/itens-comanda/${i}/iniciar`); expect((await api(gar, 'POST', `/comandas/${d}/cancelar`)).corpo.erro.codigo).toBe('itens_em_andamento')
  })
})

describe('papéis e isolamento', () => {
  it('cada papel só faz o seu: cozinha não abre comanda nem muda preço (só a disponibilidade); garçom não mexe no cardápio; outro tenant não vê nada', async () => {
    expect((await api(coz, 'POST', '/comandas', { tipo: 'balcao' })).status).toBe(403); expect((await api(coz, 'PATCH', `/itens-cardapio/${SUCO}`, { preco: '1.00' })).status).toBe(403); expect((await api(coz, 'PATCH', `/itens-cardapio/${SUCO}`, { disponivel: true })).status).toBe(200)
    expect((await api(gar, 'POST', '/itens-cardapio', { categoriaId: '99999999-9999-9999-9999-999999999999', nome: 'x', preco: '1', estacao: 'x' })).status).toBe(403); expect((await api(await token('x', []), 'GET', '/comandas')).status).toBe(403)
    const gerB = await token('gb', ['alimentos.gerente'], B); expect((await api(gerB, 'GET', '/comandas')).corpo).toEqual([]); expect((await api(gerB, 'GET', `/itens-cardapio/${BURGER}`)).status).toBe(404); expect((await api(gerB, 'POST', '/comandas', { tipo: 'mesa', mesaId: M1 })).status).toBe(404)
  })
})
