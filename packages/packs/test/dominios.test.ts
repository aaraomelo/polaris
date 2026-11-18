import { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { DDL_DIRETORIO, criaGestorDominios, criaResolvedorTenant, diretorioSql, mudaStatusTenant, normalizaHost, validaDominio } from '../src/index'

const BASES = ['polaris.app']
describe('normalizaHost: só nome de host de verdade vira chave de tenant', () => {
  it('canonicaliza (caixa, porta, ponto final) e recusa tudo que não é um nome de host', () => {
    expect(normalizaHost('Loja.Polaris.APP')).toBe('loja.polaris.app'); expect(normalizaHost('loja.polaris.app:8443')).toBe('loja.polaris.app'); expect(normalizaHost('loja.polaris.app.')).toBe('loja.polaris.app'); expect(normalizaHost('  a-b.com ')).toBe('a-b.com')
    for (const h of ['', ' ', '1.2.3.4', '127.0.0.1', '[::1]', '[::1]:80', 'a b.com', 'u@x.com', 'a/b.com', 'a.com/x', 'a.com?x', 'a_b.com', '-a.com', 'a-.com', 'a..com', '.com', 'lojá.com', 'a.com%00', 'a\u0000.com', 'x'.repeat(64) + '.com', ('a.'.repeat(130)) + 'com', 'a:b:c', null, 42, undefined, {}]) expect(normalizaHost(h as never), JSON.stringify(h)).toBeNull()
  })
  it('validaDominio: precisa de TLD real; reservados, internos, IP e o que é da plataforma não se reivindica', () => {
    expect(validaDominio('Minha-Loja.com.br', BASES)).toEqual({ ok: true, dominio: 'minha-loja.com.br' }); expect(validaDominio('xn--caf-dma.example.xn--p1ai', BASES).ok).toBe(true)
    for (const d of ['loja', 'localhost', 'x.localhost', 'a.local', 'a.internal', 'a.test', '1.2.3.4', 'polaris.app', 'x.polaris.app', 'a.b.polaris.app', 'a.c', 'a.123']) expect(validaDominio(d, BASES), d).toMatchObject({ ok: false })
    expect(validaDominio('polaris.app', BASES)).toEqual({ ok: false, motivo: 'da_plataforma' }); expect(validaDominio('lojapolaris.app', BASES).ok).toBe(true) // sufixo SEM o ponto não é da plataforma
  })
})

let pg: PGlite
const q = async (s: string, p: unknown[] = []) => { const r = await pg.query(s, p); return { rows: r.rows as Array<Record<string, unknown>>, rowCount: r.affectedRows ?? r.rows.length } }
let consultas = 0
const qc = async (s: string, p: unknown[] = []) => { consultas++; return q(s, p) }
const dir = () => diretorioSql(q)
let n = 0
async function tenant(alias: string, status = 'ativo', modulos: string[] = []): Promise<string> {
  const id = crypto.randomUUID(); await dir().cria({ tenantId: id, alias, nome: alias, segmento: 'varejo', packs: ['varejo'], donoEmail: `${alias}@x.com`, chave: `chave-dom-${++n}-${'x'.repeat(10)}` })
  await q(`UPDATE plataforma.tenant SET status = $2 WHERE id = $1`, [id, status]); if (modulos.length) await dir().habilita(id, modulos); return id
}
beforeAll(async () => { pg = new PGlite(); await pg.exec(DDL_DIRETORIO) })
afterAll(async () => { await pg.close() })

describe('resolução por subdomínio da plataforma', () => {
  it('<alias>.<base> → o tenant, com status e módulos; um nível só; reservados, apex, estranhos e desconhecidos não resolvem', async () => {
    const id = await tenant('padaria', 'ativo', ['catalogo', 'vendas']); const r = criaResolvedorTenant({ q, bases: BASES })
    expect(await r.porHost('padaria.polaris.app')).toEqual({ id, status: 'ativo', modulos: ['catalogo', 'vendas'] }); expect((await r.porHost('PADARIA.Polaris.App:443'))?.id).toBe(id)
    // defesa em profundidade: mesmo que uma linha com alias reservado ou com ponto chegasse ao diretório (SQL direto, bug), o host nunca resolve para ela
    await tenant('www'); await tenant('x.y'); await tenant('admin')
    for (const h of ['x.y.polaris.app', 'a.padaria.polaris.app', 'polaris.app', 'www.polaris.app', 'api.polaris.app', 'fantasma.polaris.app', 'padaria.polaris.app.evil.com', 'padariapolaris.app', 'padaria.evil.com', 'padaria', '', '1.2.3.4']) expect(await r.porHost(h), h).toBeNull()
  })
  it('o status do diretório chega ao gateway como está (suspenso, cancelado, provisionando) — quem decide é ele', async () => {
    const r = criaResolvedorTenant({ q, bases: BASES, ttlMs: 0, ttlNegativoMs: 0 })
    for (const st of ['suspenso', 'cancelado', 'provisionando', 'falhou']) { await tenant(`t-${st}`, st); expect((await r.porHost(`t-${st}.polaris.app`))?.status).toBe(st) }
  })
  it('porId: uuid válido; lixo e inexistente são nulos', async () => { const id = await tenant('porid'); const r = criaResolvedorTenant({ q, bases: BASES }); expect((await r.porId(id))?.id).toBe(id); expect((await r.porId(id.toUpperCase()))?.id).toBe(id); for (const x of ['x', '', "1' OR '1'='1", crypto.randomUUID()]) expect(await r.porId(x)).toBeNull() })
})

describe('domínio próprio: só vale VERIFICADO por DNS', () => {
  const dnsDe = (tabela: Record<string, string[]>, cai = false) => ({ txt: async (nome: string) => { if (cai) throw new Error('dns fora'); return tabela[nome] ?? [] } })
  it('reivindicar devolve o que publicar no DNS (idempotente); sem o TXT fica pendente e NÃO resolve; com o TXT passa a resolver', async () => {
    const id = await tenant('flor', 'ativo', ['vendas']); const tabela: Record<string, string[]> = {}; const g = criaGestorDominios({ q, dns: dnsDe(tabela), bases: BASES, novoToken: () => 'tok-flor-1' }); const r = criaResolvedorTenant({ q, bases: BASES, ttlMs: 0, ttlNegativoMs: 0 })
    const a = await g.adiciona(id, 'Flor.com.br'); expect(a).toEqual({ ok: true, reivindicacao: { dominio: 'flor.com.br', verificado: false, registro: { tipo: 'TXT', nome: '_polaris-verificacao.flor.com.br', valor: 'polaris-verificacao=tok-flor-1' } } })
    expect(await g.adiciona(id, 'flor.com.br')).toEqual(a); expect(await g.verifica(id, 'flor.com.br')).toBe('pendente'); expect(await r.porHost('flor.com.br')).toBeNull()
    tabela['_polaris-verificacao.flor.com.br'] = ['outra-coisa', 'polaris-verificacao=tok-errado']; expect(await g.verifica(id, 'flor.com.br')).toBe('pendente')
    tabela['_polaris-verificacao.flor.com.br'] = ['polaris-verificacao=tok-flor-1']; expect(await g.verifica(id, 'flor.com.br')).toBe('verificado'); expect(await g.verifica(id, 'flor.com.br')).toBe('verificado')
    expect(await r.porHost('flor.com.br')).toEqual({ id, status: 'ativo', modulos: ['vendas'] }); expect((await g.lista(id))[0]).toMatchObject({ dominio: 'flor.com.br', verificado: true })
    expect(await g.verifica(id, 'nao-reivindicado.com')).toBe('inexistente'); expect(await g.verifica(id, 'lixo!')).toBe('inexistente')
  })
  it('SEQUESTRO: quem só reivindica não resolve; quem PROVA a posse leva o domínio e derruba a reivindicação falsa; com dono verificado, o outro recebe `em_uso`', async () => {
    const squatter = await tenant('invasor'), dono = await tenant('dono-real'), terceiro = await tenant('terceiro'); const tabela: Record<string, string[]> = {}
    const gs = criaGestorDominios({ q, dns: dnsDe(tabela), bases: BASES, novoToken: () => 'tok-invasor' }), gd = criaGestorDominios({ q, dns: dnsDe(tabela), bases: BASES, novoToken: () => 'tok-dono' }), gt = criaGestorDominios({ q, dns: dnsDe(tabela), bases: BASES, novoToken: () => 'tok-terceiro' })
    await gs.adiciona(squatter, 'marca.com'); await gd.adiciona(dono, 'marca.com'); await gt.adiciona(terceiro, 'marca.com'); const r = criaResolvedorTenant({ q, bases: BASES, ttlMs: 0, ttlNegativoMs: 0 }); expect(await r.porHost('marca.com')).toBeNull()
    expect(await gs.verifica(squatter, 'marca.com')).toBe('pendente') // o invasor não controla o DNS
    tabela['_polaris-verificacao.marca.com'] = ['polaris-verificacao=tok-dono']; expect(await gd.verifica(dono, 'marca.com')).toBe('verificado'); expect((await r.porHost('marca.com'))?.id).toBe(dono)
    expect((await q(`SELECT tenant_id::text AS t FROM plataforma.dominio WHERE dominio = 'marca.com'`)).rows.map((x) => x.t)).toEqual([dono]) // as reivindicações não verificadas dos outros caíram
    tabela['_polaris-verificacao.marca.com'] = ['polaris-verificacao=tok-terceiro']; await gt.adiciona(terceiro, 'marca.com'); expect(await gt.verifica(terceiro, 'marca.com')).toBe('em_uso'); expect((await r.porHost('marca.com'))?.id).toBe(dono)
  })
  it('revalida: o domínio que deixou de provar a posse PERDE a verificação (e o DNS fora do ar não revoga ninguém)', async () => {
    const id = await tenant('abandono'); const tabela: Record<string, string[]> = {}; let cai = false; const g = criaGestorDominios({ q, dns: { txt: async (n) => { if (cai) throw new Error('fora'); return tabela[n] ?? [] } }, bases: BASES, novoToken: () => 'tok-ab' }); const r = criaResolvedorTenant({ q, bases: BASES, ttlMs: 0, ttlNegativoMs: 0 })
    await g.adiciona(id, 'abandonado.com'); tabela['_polaris-verificacao.abandonado.com'] = ['polaris-verificacao=tok-ab']; await g.verifica(id, 'abandonado.com'); expect((await r.porHost('abandonado.com'))?.id).toBe(id)
    cai = true; expect(await g.revalida()).toMatchObject({ revogados: [] }); expect((await r.porHost('abandonado.com'))?.id).toBe(id); expect(await g.verifica(id, 'abandonado.com')).toBe('verificado')
    cai = false; delete tabela['_polaris-verificacao.abandonado.com']; expect((await g.revalida()).revogados).toContain('abandonado.com'); expect(await r.porHost('abandonado.com')).toBeNull()
    cai = true; await g.adiciona(id, 'novo-dns-fora.com'); expect(await g.verifica(id, 'novo-dns-fora.com')).toBe('dns_indisponivel')
  })
  it('limites e recusas: domínio inválido/da plataforma, máximo por tenant; remover tira da resolução', async () => {
    const id = await tenant('limite'); const g = criaGestorDominios({ q, dns: dnsDe({}), bases: BASES, maxPorTenant: 2 })
    expect(await g.adiciona(id, 'x.polaris.app')).toEqual({ ok: false, motivo: 'da_plataforma' }); expect(await g.adiciona(id, '1.2.3.4')).toMatchObject({ ok: false }); expect((await g.adiciona(id, 'um.com')).ok).toBe(true); expect((await g.adiciona(id, 'dois.com')).ok).toBe(true); expect(await g.adiciona(id, 'tres.com')).toEqual({ ok: false, motivo: 'limite' })
    expect(await g.remove(id, 'um.com')).toBe(true); expect(await g.remove(id, 'um.com')).toBe(false); expect((await g.adiciona(id, 'tres.com')).ok).toBe(true)
  })
})

describe('cache do resolvedor: rápido, curto e LIMITADO', () => {
  it('positivo evita o banco, expira no TTL (a suspensão passa a valer) e `invalida` vale na hora', async () => {
    const id = await tenant('cache-a'); let t = 1_000; const r = criaResolvedorTenant({ q: qc, bases: BASES, ttlMs: 30_000, ttlNegativoMs: 5_000, agora: () => t })
    consultas = 0; await r.porHost('cache-a.polaris.app'); await r.porHost('cache-a.polaris.app'); await r.porHost('CACHE-A.polaris.app:80'); expect(consultas).toBe(1)
    await mudaStatusTenant(q, id, 'suspenso', 'inadimplência'); expect((await r.porHost('cache-a.polaris.app'))?.status).toBe('ativo') // ainda no cache (no MESMO processo, invalida)
    r.invalida(); expect((await r.porHost('cache-a.polaris.app'))?.status).toBe('suspenso'); await mudaStatusTenant(q, id, 'ativo'); t += 29_999; expect((await r.porHost('cache-a.polaris.app'))?.status).toBe('suspenso'); t += 2; expect((await r.porHost('cache-a.polaris.app'))?.status).toBe('ativo')
  })
  it('negativo tem TTL menor (um cadastro novo aparece logo); a consulta simultânea do mesmo host é UMA só (single-flight)', async () => {
    let t = 0; const r = criaResolvedorTenant({ q: qc, bases: BASES, ttlMs: 30_000, ttlNegativoMs: 5_000, agora: () => t }); consultas = 0
    expect(await r.porHost('novinho.polaris.app')).toBeNull(); expect(await r.porHost('novinho.polaris.app')).toBeNull(); expect(consultas).toBe(1)
    await tenant('novinho'); expect(await r.porHost('novinho.polaris.app')).toBeNull(); t += 5_001; expect((await r.porHost('novinho.polaris.app'))?.status).toBe('ativo')
    consultas = 0; const rs = await Promise.all(Array.from({ length: 25 }, () => r.porHost('simultaneo.polaris.app'))); expect(rs.every((x) => x === null)).toBe(true); expect(consultas).toBe(1)
  })
  it('o cache é LIMITADO: quem varia o Host não faz a memória crescer (e o host inválido nem consulta o banco)', async () => {
    const r = criaResolvedorTenant({ q: qc, bases: BASES, maxEntradas: 50 }); consultas = 0
    for (let i = 0; i < 500; i++) await r.porHost(`aleatorio-${i}.polaris.app`); expect(r.tamanho).toBeLessThanOrEqual(50); expect(consultas).toBe(500)
    consultas = 0; for (const h of ['lixo!', '1.2.3.4', 'a b']) expect(await r.porHost(h)).toBeNull(); expect(consultas).toBe(0)
  })
})

describe('mudança de status do tenant', () => {
  it('ativo ↔ suspenso, qualquer → cancelado; cancelado é terminal; provisionando/falhou não se alcança por aqui; inexistente é acusado', async () => {
    const id = await tenant('estados'); const st = async () => (await q(`SELECT status, motivo FROM plataforma.tenant WHERE id = $1`, [id])).rows[0]
    expect(await mudaStatusTenant(q, id, 'suspenso', 'fatura vencida')).toEqual({ ok: true }); expect(await st()).toEqual({ status: 'suspenso', motivo: 'fatura vencida' }); expect(await mudaStatusTenant(q, id, 'suspenso')).toEqual({ ok: true }); expect(await mudaStatusTenant(q, id, 'ativo')).toEqual({ ok: true })
    expect(await mudaStatusTenant(q, id, 'cancelado', 'a pedido')).toEqual({ ok: true }); expect(await mudaStatusTenant(q, id, 'ativo')).toEqual({ ok: false, motivo: 'transicao_invalida', de: 'cancelado' }); expect((await st())!.status).toBe('cancelado')
    expect(await mudaStatusTenant(q, crypto.randomUUID(), 'suspenso')).toEqual({ ok: false, motivo: 'inexistente' })
    const p = await tenant('em-prov', 'provisionando'); expect(await mudaStatusTenant(q, p, 'ativo')).toEqual({ ok: false, motivo: 'transicao_invalida', de: 'provisionando' }) // ativar é função do cadastro, não de um clique
  })
})
