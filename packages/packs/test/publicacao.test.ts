import { PGlite } from '@electric-sql/pglite'
import { registraBase } from '@polaris/engine'
import { Registry } from '@polaris/schema'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { DDL_DIRETORIO, criaArmazemDeNos, criaPreview, criaReleases, criaResolvedorTenant, diretorioSql, registroDaPlataforma } from '../src/index'

const A = '11111111-1111-1111-1111-111111111111', B = '22222222-2222-2222-2222-222222222222', C = '33333333-3333-3333-3333-333333333333'
let pg: PGlite
const q = async (s: string, p: unknown[] = []) => { const r = await pg.query(s, p); return { rows: r.rows as Array<Record<string, unknown>>, rowCount: r.affectedRows ?? r.rows.length } }
const base = registroDaPlataforma(); registraBase(base)
const arm = () => criaArmazemDeNos({ q, base })
const txq = (tx: { query: PGlite['query'] }) => async (sql: string, params: unknown[] = []) => { const r = await tx.query(sql, params); return { rows: r.rows as Array<Record<string, unknown>>, rowCount: r.affectedRows ?? r.rows.length } }
const db = { transacao: <T>(fn: (qq: typeof q) => Promise<T>) => pg.transaction(async (tx) => fn(txq(tx))) }
const rel = (b: Registry = base, max?: number) => criaReleases({ db, armazemDe: (qq) => criaArmazemDeNos({ q: qq, base: b }), ...(max ? { maxEmCache: max } : {}) })
let seqT = 0
/** um tenant NOVO por teste: as releases exigem que o conjunto inteiro feche, e o estado de um teste não pode contaminar o outro */
const fresco = async (status = 'ativo') => { const id = crypto.randomUUID(); await tenant(id, `t-pub-${++seqT}`, status); return id }
const no = (kind: string, id: string, spec: object) => ({ kind, id, versao: '1.0.0', estatuto: 'publicado', spec })
const pagina = (id: string, texto = 'oi') => no('pagina', id, { rota: `/${id}`, raiz: { bloco: 'texto/paragrafo', props: { texto } } })
const textoDe = (r: Registry | null, t: string, id: string) => ((r!.resolve('pagina', id, { tenantId: t })?.no.spec as any)?.raiz.props.texto) as string | undefined
async function tenant(id: string, alias: string, status = 'ativo') { await diretorioSql(q).cria({ tenantId: id, alias, nome: alias, segmento: 'varejo', packs: ['varejo'], donoEmail: `${alias}@x.com`, chave: `chave-pub-${alias}-xxxxxxxxxx` }); await q(`UPDATE plataforma.tenant SET status = $2 WHERE id = $1`, [id, status]) }
beforeAll(async () => { pg = new PGlite(); await pg.exec(DDL_DIRETORIO); await tenant(A, 'pub-a'); await tenant(B, 'pub-b'); await tenant(C, 'pub-c', 'cancelado') })
afterAll(async () => { await pg.close() })

describe('release: snapshot imutável', () => {
  it('fotografa as cabeças; numera em sequência; o mesmo estado devolve a MESMA release; editar depois NÃO muda a release já criada', async () => {
    const a = arm(), r = rel(); await a.salva(A, 'ana', pagina('home', 'v1')); await a.salva(A, 'ana', pagina('sobre', 'sobre-v1'))
    const r1 = await r.cria(A, 'ana', 'primeira'); expect(r1).toMatchObject({ ok: true, nova: true, release: { numero: 1, nos: 2, autor: 'ana', nota: 'primeira' } })
    expect(await r.cria(A, 'bia')).toMatchObject({ ok: true, nova: false, release: { numero: 1 } })
    await a.salva(A, 'ana', pagina('home', 'v2')); const r2 = await r.cria(A, 'ana'); expect(r2).toMatchObject({ ok: true, nova: true, release: { numero: 2 } })
    expect(textoDe(await r.registroDe(A, 1), A, 'home')).toBe('v1'); expect(textoDe(await r.registroDe(A, 2), A, 'home')).toBe('v2') // cada release fixa as SUAS versões
    expect(await r.diferenca(A, 1, 2)).toEqual({ adicionados: [], removidos: [], alterados: ['pagina:home'] }); expect(await r.diferenca(A, 1, 99)).toBeNull()
    expect((await r.lista(A)).map((x) => x.numero)).toEqual([2, 1])
  })
  it('o banco recusa alterar ou apagar uma release e o diário', async () => {
    await expect(q(`UPDATE plataforma.release SET autor = 'x' WHERE tenant_id = $1`, [A])).rejects.toThrow(/imutáveis/); await expect(q(`DELETE FROM plataforma.release WHERE tenant_id = $1`, [A])).rejects.toThrow(/imutáveis/)
  })
  it('a release só nasce se o conjunto FECHA: remover um `dados` de que uma página depende impede a release (e o que já está promovido não é afetado)', async () => {
    const B2 = await fresco(), a = arm(), r = rel(); await a.salva(B2, 'ana', no('dados', 'dados.lista', { fonte: { tipo: 'servico', servico: 'catalogo', operacao: 'listarProduto' } })); await a.salva(B2, 'ana', no('pagina', 'vitrine', { rota: '/vitrine', dados: { itens: 'dados.lista' }, raiz: { bloco: 'texto/paragrafo', props: { texto: 'x' } } }))
    expect((await r.cria(B2, 'ana')).ok).toBe(true); await a.remove(B2, 'dados', 'dados.lista', 'ana')
    const falha = await r.cria(B2, 'ana'); expect(falha.ok).toBe(false); expect((falha as { erros: string[] }).erros.join()).toMatch(/dados.lista/)
    expect((await r.lista(B2)).length).toBe(1) // nada foi criado pela metade
  })
  it('tenant encerrado e inexistente não criam release; criações simultâneas viram números distintos ou a mesma', async () => {
    expect(await rel().cria(C, 'x')).toEqual({ ok: false, erros: ['tenant encerrado'] }); expect(await rel().cria('99999999-9999-9999-9999-999999999999', 'x')).toEqual({ ok: false, erros: ['tenant inexistente'] }); expect(await rel().cria('lixo', 'x')).toEqual({ ok: false, erros: ['tenant inválido'] })
    const A2 = await fresco(); const a = arm(); await a.salva(A2, 'ana', pagina('conc', 'um')); const rs = await Promise.all([rel().cria(A2, 'u1'), rel().cria(A2, 'u2'), rel().cria(A2, 'u3')]); expect(rs.every((x) => x.ok)).toBe(true); expect(new Set(rs.map((x) => (x as { release: { numero: number } }).release.numero)).size).toBe(1) // o mesmo estado: uma release só
  })
})

describe('promoção e rollback: o ponteiro de produção', () => {
  it('promover põe a release em produção; o rascunho e as releases novas NÃO vazam para a produção; o diário registra', async () => {
    const A = await fresco(); const a = arm(), r = rel(); await a.salva(A, 'ana', pagina('prod', 'estavel')); const r1 = (await r.cria(A, 'ana')) as { release: { numero: number } }
    expect(await r.promove(A, r1.release.numero, 'ana', 'lançamento')).toMatchObject({ ok: true, producao: r1.release.numero })
    await a.salva(A, 'ana', pagina('prod', 'rascunho-novo')); const r2 = (await r.cria(A, 'ana')) as { release: { numero: number } }
    expect(textoDe(await r.registroDeProducao(A, (await r.producao(A)).producao), A, 'prod')).toBe('estavel') // a nova release existe, mas não está em produção
    await r.promove(A, r2.release.numero, 'bia'); expect(textoDe(await r.registroDeProducao(A, (await r.producao(A)).producao), A, 'prod')).toBe('rascunho-novo')
    expect((await r.diario(A)).slice(0, 2).map((e) => [e.tipo, e.de, e.para, e.autor])).toEqual([['promocao', r1.release.numero, r2.release.numero, 'bia'], ['promocao', null, r1.release.numero, 'ana']])
    await expect(q(`DELETE FROM plataforma.release_evento WHERE tenant_id = $1`, [A])).rejects.toThrow(/imutáveis/); await expect(q(`UPDATE plataforma.release_ponteiro SET producao = producao WHERE tenant_id = $1`, [A])).resolves.toBeDefined() // o diário não se apaga; o ponteiro (estado) se atualiza
  })
  it('ROLLBACK volta à release anterior (e de novo desfaz); com `para` vai a uma específica; sem anterior ou com número inexistente é recusado; promover a que já está é no-op', async () => {
    const B = await fresco(); const a = arm(), r = rel(); await a.salva(B, 'ana', pagina('rb', 'um')); const n1 = ((await r.cria(B, 'x')) as any).release.numero; await a.salva(B, 'ana', pagina('rb', 'dois')); const n2 = ((await r.cria(B, 'x')) as any).release.numero; await a.salva(B, 'ana', pagina('rb', 'tres')); const n3 = ((await r.cria(B, 'x')) as any).release.numero
    expect(await r.rollback(B, 'ana')).toEqual({ ok: false, erros: ['não há release anterior para voltar'] }); const prod = async () => textoDe(await r.registroDeProducao(B, (await r.producao(B)).producao), B, 'rb')
    await r.promove(B, n1, 'ana'); await r.promove(B, n2, 'ana'); expect(await r.promove(B, n2, 'ana')).toMatchObject({ ok: true, producao: n2, anterior: n1 }); expect(await prod()).toBe('dois')
    expect(await r.rollback(B, 'ana', undefined, 'bug em produção')).toMatchObject({ ok: true, producao: n1, anterior: n2 }); expect(await prod()).toBe('um')
    expect(await r.rollback(B, 'ana')).toMatchObject({ ok: true, producao: n2 }); expect(await prod()).toBe('dois') // voltar de novo desfaz o rollback
    expect(await r.rollback(B, 'ana', n3)).toMatchObject({ ok: true, producao: n3 }); expect(await prod()).toBe('tres')
    for (const x of [999, 0, -1, 1.5]) expect((await r.rollback(B, 'ana', x)).ok, String(x)).toBe(false); expect((await r.promove(B, 999, 'ana'))).toMatchObject({ ok: false })
    expect((await r.diario(B, 10)).map((e) => e.tipo)).toEqual(['rollback', 'rollback', 'rollback', 'promocao', 'promocao'])
  })
  it('release de OUTRO tenant não se promove (o número só vale no próprio tenant)', async () => {
    const A = await fresco(), B = await fresco(); await arm().salva(A, 'a', pagina('x1')); await arm().salva(B, 'b', pagina('x2')); const r = rel(); const nA = ((await r.cria(A, 'x')) as any).release.numero; await r.cria(B, 'x'); expect(await r.promove(B, 9999, 'x')).toMatchObject({ ok: false })
    const antes = await r.producao(B); expect((await r.promove(B, nA + 100, 'x')).ok).toBe(false); expect(await r.producao(B)).toEqual(antes)
    expect(await r.registroDe(B, 9999)).toBeNull()
  })
  it('promoção reconfere contra o CORE de hoje: se o core mudou e a release deixou de fechar, não promove (nem volta)', async () => {
    const A = await fresco(); const a = arm(), r = rel(); await a.salva(A, 'ana', pagina('depende-do-core', 'x')); const n = ((await r.cria(A, 'x')) as any).release.numero
    expect((await r.promove(A, n, 'x')).ok).toBe(true)
    // o "core de amanhã" perdeu o bloco `texto/paragrafo` que a página usa
    const baseNova = new Registry(); for (const id of base.ids('servico')) baseNova.registra(base.resolve('servico', id)!.no)
    const r2 = rel(baseNova); const t = await r2.promove(A, n, 'x'); expect(t.ok).toBe(false); expect((t as { erros: string[] }).erros[0]).toMatch(/não é mais íntegra/); expect((await r2.rollback(A, 'x', n)).ok).toBe(false)
    expect((await r.producao(A)).producao).toBe(n) // a produção segue como estava
  })
})

describe('cache, isolamento e produção sem release', () => {
  it('tenant que nunca publicou serve só core/segmento (o rascunho NÃO vai ao ar)', async () => {
    const B = await fresco(); const a = arm(), r = rel(); await a.salva(B, 'ana', pagina('so-rascunho', 'secreto')); const reg = await r.registroDeProducao(B, null); expect(reg.ids('pagina')).not.toContain('so-rascunho'); expect(textoDe(reg, B, 'so-rascunho')).toBeUndefined()
  })
  it('o registro de uma release é cacheado (imutável) e o cache é LIMITADO', async () => {
    const A = await fresco(); const a = arm(); const r = rel(base, 2); await a.salva(A, 'ana', pagina('cache-a', 'c1')); const n = ((await r.cria(A, 'x')) as any).release.numero
    expect(await r.registroDe(A, n)).toBe(await r.registroDe(A, n)) // mesma instância
    await a.salva(A, 'ana', pagina('cache-a', 'c2')); const n2 = ((await r.cria(A, 'x')) as any).release.numero; await a.salva(A, 'ana', pagina('cache-a', 'c3')); const n3 = ((await r.cria(A, 'x')) as any).release.numero
    const primeira = await r.registroDe(A, n); await r.registroDe(A, n2); await r.registroDe(A, n3); expect(await r.registroDe(A, n)).not.toBe(primeira) // a mais antiga saiu (LRU de 2) e foi remontada, igual
    expect(textoDe(await r.registroDe(A, n), A, 'cache-a')).toBe('c1')
  })
  it('o resolvedor de tenants informa a release de produção (para o gateway)', async () => {
    const res = criaResolvedorTenant({ q, bases: ['polaris.app'], ttlMs: 0, ttlNegativoMs: 0 }); const r = rel(); const T = await fresco(); await arm().salva(T, 'ana', pagina('res-b', 'x')); const n = ((await r.cria(T, 'x')) as any).release.numero
    expect((await res.porId(T))?.release).toBeNull(); await r.promove(T, n, 'x'); expect((await res.porId(T))?.release).toBe(n); expect((await res.porHost(`t-pub-${seqT}.polaris.app`))?.release).toBe(n)
  })
})

describe('preview: link assinado', () => {
  const seg = 'segredo-de-preview-com-mais-de-32-bytes!!'
  it('emite e verifica: tenant e release no token; expira; adulteração, segredo errado, lixo e tamanho são recusados', () => {
    let t = 1_700_000_000_000; const p = criaPreview({ segredo: seg, agora: () => t }), tok = p.emite(A, 3, 3600)
    expect(p.verifica(tok)).toEqual({ tenantId: A, release: 3 }); t += 3_599_000; expect(p.verifica(tok)).toEqual({ tenantId: A, release: 3 }); t += 2_000; expect(p.verifica(tok)).toBeNull()
    t = 1_700_000_000_000; const [v, pay, sig] = tok.split('.'); const outro = Buffer.from(JSON.stringify({ t: B, r: 3, e: 9_999_999_999 })).toString('base64url')
    for (const ruim of [`${v}.${outro}.${sig}`, `${v}.${pay}.${sig!.slice(0, -2)}AA`, `${v}.${pay}`, 'v1..', 'x.y.z', '', 'v2.' + pay + '.' + sig, tok + 'x', 'a'.repeat(3000)]) expect(p.verifica(ruim), ruim.slice(0, 30)).toBeNull()
    expect(criaPreview({ segredo: 'outro-segredo-diferente-com-32-bytes!!!!', agora: () => t }).verifica(tok)).toBeNull(); expect(p.verifica(null as never)).toBeNull()
  })
  it('TTL: mínimo de 60 s, máximo de 7 dias; segredo curto e dados inválidos são recusados', () => {
    const t = 1_700_000_000_000; const p = criaPreview({ segredo: seg, agora: () => t, ttlMaxSeg: 7 * 24 * 3600 })
    const exp = (tok: string) => JSON.parse(Buffer.from(tok.split('.')[1]!, 'base64url').toString()).e - Math.floor(t / 1000); expect(exp(p.emite(A, 1, 1))).toBe(60); expect(exp(p.emite(A, 1, 99 * 24 * 3600))).toBe(7 * 24 * 3600)
    expect(() => criaPreview({ segredo: 'curto' })).toThrow(/32 bytes/); expect(() => p.emite('lixo', 1)).toThrow(); expect(() => p.emite(A, 0)).toThrow(); expect(() => p.emite(A, 1.5)).toThrow()
  })
})

// A trava do tenant só faz diferença com VÁRIAS conexões reais: aqui o PGlite fala pelo protocolo de rede e o pool abre várias.
describe('concorrência real (várias conexões)', () => {
  it('três `cria` simultâneas do mesmo estado, por várias conexões de rede, dão UMA release (a trava `FOR UPDATE` do tenant é do desenho; este PGlite serializa as transações e não a distingue — ver limites)', async () => {
    const { PGLiteSocketServer } = await import('@electric-sql/pglite-socket'); const { criaPool } = await import('@polaris/pg')
    const dbx = new PGlite(); await dbx.exec(DDL_DIRETORIO); const srv = new PGLiteSocketServer({ db: dbx, port: 0, host: '127.0.0.1', maxConnections: 10 }); await srv.start()
    const pool = criaPool({ url: `postgres://postgres@127.0.0.1:${/:(\d+)/.exec(srv.getServerConn())![1]}/postgres`, max: 4 })
    try {
      const qp = async (s: string, p: unknown[] = []) => { const r = await pool.query(s, p); return { rows: r.rows as Array<Record<string, unknown>>, rowCount: r.rowCount ?? 0 } }
      const T = crypto.randomUUID(); await diretorioSql(qp).cria({ tenantId: T, alias: 'conc-real', nome: 'x', segmento: 'varejo', packs: ['varejo'], donoEmail: 'a@b.com', chave: 'chave-conc-real-xxxxxxxx' }); await qp(`UPDATE plataforma.tenant SET status = 'ativo' WHERE id = $1`, [T])
      const txPool = { transacao: async <X>(fn: (qq: typeof qp) => Promise<X>): Promise<X> => { const c = await pool.connect(); try { await c.query('BEGIN'); const r = await fn(async (s, p = []) => { const x = await c.query(s, p as unknown[]); return { rows: x.rows as Array<Record<string, unknown>>, rowCount: x.rowCount ?? 0 } }); await c.query('COMMIT'); return r } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e } finally { c.release() } } }
      const r = criaReleases({ db: txPool, armazemDe: (qq) => criaArmazemDeNos({ q: qq, base }) }); await criaArmazemDeNos({ q: qp, base }).salva(T, 'ana', pagina('conc-real', 'x'))
      const rs = await Promise.all([r.cria(T, 'u1'), r.cria(T, 'u2'), r.cria(T, 'u3')])
      expect(rs.every((x) => x.ok)).toBe(true); expect(new Set(rs.map((x) => (x as { release: { numero: number } }).release.numero))).toEqual(new Set([1])); expect(rs.filter((x) => (x as { nova: boolean }).nova).length).toBe(1)
    } finally { await pool.end(); await srv.stop(); await dbx.close() }
  })
})
