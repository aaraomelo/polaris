import { PGlite } from '@electric-sql/pglite'
import { registraBase } from '@polaris/engine'
import { registraTemas } from '@polaris/engine/tema'
import Fastify, { type FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { DDL_DIRETORIO, criaArmazemDeNos, diretorioSql, registroDaPlataforma, rotasStudio, sessaoDeToken, type Sessao } from '../src/index'

const A = '11111111-1111-1111-1111-111111111111', B = '22222222-2222-2222-2222-222222222222'
let pg: PGlite
const q = async (s: string, p: unknown[] = []) => { const r = await pg.query(s, p); return { rows: r.rows as Array<Record<string, unknown>>, rowCount: r.affectedRows ?? r.rows.length } }
const base = registroDaPlataforma(); registraBase(base); registraTemas(base)
const armazem = criaArmazemDeNos({ q, base })
type Perm = Parameters<Sessao['pode']>[0]
const PAPEIS: Record<string, Perm[]> = { ver: ['studio.ver'], com: ['studio.ver', 'studio.comentar'], ed: ['studio.ver', 'studio.comentar', 'studio.editar'] }
// o "token" de teste é `tenant|usuario|papel`: só existe para o teste; em produção quem autentica é o JWT do gateway
const autentica = async (req: { headers: Record<string, unknown> }): Promise<Sessao | null> => { const t = String(req.headers.authorization ?? '').replace(/^Bearer /, ''); const [tenantId, usuario, papel] = t.split('|'); return tenantId && usuario && papel && PAPEIS[papel] ? { tenantId, usuario, pode: (p) => PAPEIS[papel]!.includes(p) } : null }
let app: FastifyInstance
const h = (tenant: string, usuario: string, papel = 'ed') => ({ authorization: `Bearer ${tenant}|${usuario}|${papel}` })
const pagina = (id: string, texto = 'oi', extra: object = {}) => ({ kind: 'pagina', id, versao: '1.0.0', estatuto: 'publicado', spec: { rota: `/${id}`, raiz: { bloco: 'layout/pilha', id: 'r', slots: { filhos: [{ bloco: 'texto/paragrafo', id: 'p', props: { texto } }] } } }, ...extra })
const put = (t: string, no: any, extra: object = {}, usuario = 'ana') => app.inject({ method: 'PUT', url: `/studio/nos/${no.kind}/${no.id}`, headers: h(t, usuario), payload: { no, ...extra } })

beforeAll(async () => {
  pg = new PGlite(); await pg.exec(DDL_DIRETORIO)
  for (const [id, alias] of [[A, 'tenant-a'], [B, 'tenant-b']] as const) await diretorioSql(q).cria({ tenantId: id, alias, nome: alias, segmento: 'varejo', packs: ['varejo'], donoEmail: `${alias}@x.com`, chave: `chave-studio-${alias}-xxxxxxxx` })
  app = Fastify(); rotasStudio(app, { armazem, baseDe: async () => base, q, autentica: autentica as never }); await app.ready()
})
afterAll(async () => { await app.close(); await pg.close() })

describe('API de autoria do Studio', () => {
  it('sem sessão 401; sem permissão 403; cabeçalhos de não-cache em tudo', async () => {
    const r = await app.inject({ url: '/studio/nos' }); expect(r.statusCode).toBe(401); expect(r.headers['cache-control']).toBe('no-store')
    const sem = await app.inject({ method: 'PUT', url: '/studio/nos/pagina/x', headers: h(A, 'u', 'ver'), payload: { no: pagina('x') } }); expect(sem.statusCode).toBe(403); expect(sem.json().erro.mensagem).toMatch(/studio\.editar/)
    expect((await app.inject({ method: 'POST', url: '/studio/comentarios', headers: h(A, 'u', 'ver'), payload: {} })).statusCode).toBe(403)
  })
  it('catálogo de blocos: schema de props e slots para montar o formulário', async () => {
    const r = (await app.inject({ url: '/studio/blocos', headers: h(A, 'ana') })).json().blocos as any[]
    expect(r.find((b) => b.id === 'texto/titulo')).toMatchObject({ props: { type: 'object', required: ['texto'] }, composto: false }); expect(r.find((b) => b.id === 'layout/pilha').slots).toHaveProperty('filhos'); expect(r.length).toBeGreaterThan(20)
  })
  it('PUT cria a versão (201), mesmo conteúdo não duplica (200), GET devolve a do tenant; antes dela, a base', async () => {
    expect((await app.inject({ url: '/studio/nos/tema/padrao', headers: h(A, 'ana') })).json()).toMatchObject({ origem: 'base', seq: null })
    const p1 = await put(A, pagina('home', 'v1'), { nota: 'primeira' }); expect(p1.statusCode).toBe(201); expect(p1.json()).toMatchObject({ novo: true, versao: { seq: 1, autor: 'ana', nota: 'primeira' } })
    expect((await put(A, pagina('home', 'v1'))).statusCode).toBe(200)
    expect((await app.inject({ url: '/studio/nos/pagina/home', headers: h(A, 'ana') })).json()).toMatchObject({ origem: 'tenant', seq: 1, no: { id: 'home' } })
    expect((await app.inject({ url: '/studio/nos/pagina/inexistente', headers: h(A, 'ana') })).statusCode).toBe(404)
  })
  it('o autor e o tenant vêm da SESSÃO: corpo com autor/tenant é recusado; um tenant não enxerga o do outro', async () => {
    const r = await app.inject({ method: 'PUT', url: '/studio/nos/pagina/home', headers: h(A, 'ana'), payload: { no: pagina('home', 'x'), autor: 'bia', tenantId: B } }); expect(r.statusCode).toBe(400)
    expect((await app.inject({ url: '/studio/nos/pagina/home', headers: h(B, 'bia') })).statusCode).toBe(404); expect((await app.inject({ url: '/studio/nos', headers: h(B, 'bia') })).json().nos.map((n: any) => n.id)).not.toContain('home')
    const v = await put(A, pagina('home', 'v2'), {}, 'carla'); expect(v.json().versao.autor).toBe('carla')
  })
  it('validação: nó inválido 422 com os erros do schema; kind/id da URL precisam bater com o nó; kind proibido', async () => {
    const ruim = pagina('ruim'); (ruim.spec.raiz as any).bloco = 'bloco/que/nao/existe'
    const r = await put(A, ruim); expect(r.statusCode).toBe(422); expect(r.json().erro.erros.length).toBeGreaterThan(0)
    expect((await app.inject({ method: 'PUT', url: '/studio/nos/pagina/outro', headers: h(A, 'a'), payload: { no: pagina('home') } })).statusCode).toBe(400)
    expect((await app.inject({ method: 'PUT', url: '/studio/nos/servico/x', headers: h(A, 'a'), payload: { no: { kind: 'servico', id: 'x' } } })).statusCode).toBe(400)
    expect((await app.inject({ method: 'PUT', url: '/studio/nos/pagina/Maiuscula', headers: h(A, 'a'), payload: { no: pagina('Maiuscula') } })).statusCode).toBe(400)
    expect((await app.inject({ method: 'PUT', url: '/studio/nos/pagina/home', headers: h(A, 'a'), payload: { no: pagina('home'), nota: 'x'.repeat(201) } })).statusCode).toBe(400)
  })
  it('concorrência otimista: baseSeq desatualizado dá 409 com quem salvou; baseSeq certo grava; null = primeira versão do tenant', async () => {
    expect((await put(A, pagina('disputa', 'a'), { baseSeq: null })).statusCode).toBe(201)
    const c = await put(A, pagina('disputa', 'b'), { baseSeq: null }, 'bia'); expect(c.statusCode).toBe(409); expect(c.json().erro).toMatchObject({ codigo: 'conflito', seqAtual: 1, autor: 'ana' })
    expect((await put(A, pagina('disputa', 'b'), { baseSeq: 1 }, 'bia')).statusCode).toBe(201)
    const velho = await put(A, pagina('disputa', 'c'), { baseSeq: 1 }); expect(velho.statusCode).toBe(409); expect(velho.json().erro.seqAtual).toBe(2)
    expect((await put(A, pagina('disputa', 'c'), { baseSeq: -1 })).statusCode).toBe(400); expect((await put(A, pagina('disputa', 'c'), { baseSeq: 1.5 })).statusCode).toBe(400)
    const corrida = await Promise.all([put(A, pagina('corre', 'x'), { baseSeq: null }, 'u1'), put(A, pagina('corre', 'y'), { baseSeq: null }, 'u2')]); expect(corrida.map((r) => r.statusCode).sort()).toEqual([201, 409])
  })
  it('histórico, versão e diff semântico entre versões e contra a base', async () => {
    await put(A, pagina('hist', 'um')); await put(A, pagina('hist', 'dois'), { nota: 'trocou o texto' })
    const hs = (await app.inject({ url: '/studio/historico/pagina/hist', headers: h(A, 'ana') })).json().versoes; expect(hs.map((v: any) => [v.seq, v.nota])).toEqual([[2, 'trocou o texto'], [1, null]])
    expect((await app.inject({ url: '/studio/versao/pagina/hist?seq=1', headers: h(A, 'ana') })).json().no.spec.raiz.slots.filhos[0].props.texto).toBe('um'); expect((await app.inject({ url: '/studio/versao/pagina/hist?seq=9', headers: h(A, 'ana') })).statusCode).toBe(404)
    const d = (await app.inject({ url: '/studio/diff/pagina/hist?de=1&para=2', headers: h(A, 'ana') })).json().diff
    expect(d.resumo).toMatchObject({ alterados: 1, campos: 1 }); expect(d.blocos[0]).toMatchObject({ tipo: 'alterado', id: 'p', campos: [{ caminho: ['props', 'texto'], antes: 'um', depois: 'dois' }] })
    expect((await app.inject({ url: '/studio/diff/pagina/hist?de=x&para=2', headers: h(A, 'ana') })).statusCode).toBe(400); expect((await app.inject({ url: '/studio/diff/pagina/hist?de=1&para=7', headers: h(A, 'ana') })).statusCode).toBe(404)
    expect((await app.inject({ url: '/studio/historico/pagina/hist?limite=0', headers: h(A, 'ana') })).statusCode).toBe(400); expect((await app.inject({ url: '/studio/historico/pagina/hist', headers: h(B, 'bia') })).json().versoes).toEqual([])
    const comBase = await app.inject({ url: '/studio/diff/tema/padrao?de=base&para=base', headers: h(A, 'ana') }); expect(comBase.json().diff.igual).toBe(true)
  })
  it('DELETE restaura o padrão (lápide) e some das cabeças', async () => {
    await put(A, pagina('efemera')); expect((await app.inject({ method: 'DELETE', url: '/studio/nos/pagina/efemera', headers: h(A, 'ana') })).json()).toEqual({ ok: true })
    expect((await app.inject({ url: '/studio/nos/pagina/efemera', headers: h(A, 'ana') })).statusCode).toBe(404); expect((await app.inject({ method: 'DELETE', url: '/studio/nos/pagina/efemera', headers: h(A, 'ana') })).statusCode).toBe(200)
    expect((await app.inject({ method: 'DELETE', url: '/studio/nos/pagina/nunca', headers: h(A, 'ana') })).statusCode).toBe(404)
  })
  it('comentários: autor da sessão, âncora, fio, resolver só a raiz, sem cruzar tenants nem nós', async () => {
    const com = (t: string, u: string, corpo: object, papel = 'com') => app.inject({ method: 'POST', url: '/studio/comentarios', headers: h(t, u, papel), payload: corpo })
    const c1 = await com(A, 'ana', { kind: 'pagina', id: 'hist', ancora: 'p', versao: 2, texto: 'trocar a fonte' }); expect(c1.statusCode).toBe(201); const raiz = c1.json().comentario
    expect(raiz).toMatchObject({ autor: 'ana', ancora: 'p', versao: 2, resolvido: false, texto: 'trocar a fonte' })
    const r = await com(A, 'bia', { kind: 'pagina', id: 'hist', texto: 'concordo', respondeA: raiz.id }); expect(r.json().comentario).toMatchObject({ autor: 'bia', respondeA: raiz.id })
    expect((await app.inject({ url: '/studio/comentarios?kind=pagina&id=hist', headers: h(A, 'x', 'ver') })).json().comentarios.map((c: any) => c.texto)).toEqual(['trocar a fonte', 'concordo'])
    expect((await app.inject({ url: '/studio/comentarios?kind=pagina&id=hist', headers: h(B, 'bia') })).json().comentarios).toEqual([])
    expect((await com(A, 'x', { kind: 'pagina', id: 'outra', texto: 'x', respondeA: raiz.id })).statusCode).toBe(400); expect((await com(B, 'bia', { kind: 'pagina', id: 'hist', texto: 'x', respondeA: raiz.id })).statusCode).toBe(400)
    const resp = (t: string, id: string, resolvido: unknown) => app.inject({ method: 'POST', url: `/studio/comentarios/${id}/resolver`, headers: h(t, 'ana'), payload: { resolvido } })
    expect((await resp(A, raiz.id, true)).statusCode).toBe(200); expect((await resp(B, raiz.id, true)).statusCode).toBe(404); expect((await resp(A, r.json().comentario.id, true)).statusCode).toBe(404); expect((await resp(A, raiz.id, 'sim')).statusCode).toBe(400)
    expect((await app.inject({ url: '/studio/comentarios?kind=pagina&id=hist', headers: h(A, 'x') })).json().comentarios[0].resolvido).toBe(true)
  })
  it('comentário: texto vazio/gigante, campos extras, âncora com injeção, autor no corpo e kind/id inválidos são recusados', async () => {
    const com = (corpo: object) => app.inject({ method: 'POST', url: '/studio/comentarios', headers: h(A, 'ana'), payload: corpo })
    const ok = { kind: 'pagina', id: 'hist', texto: 'ok' }
    for (const ruim of [{ ...ok, texto: '' }, { ...ok, texto: ' ' }, { ...ok, texto: 'x'.repeat(4001) }, { ...ok, autor: 'bia' }, { ...ok, ancora: "p'; DROP TABLE x;--" }, { ...ok, ancora: '' }, { ...ok, versao: 0 }, { ...ok, versao: 1.5 }, { ...ok, kind: 'servico' }, { ...ok, id: 'ID Ruim' }, { ...ok, respondeA: 'nao-uuid' }, { kind: 'pagina', id: 'hist' }])
      expect((await com(ruim)).statusCode, JSON.stringify(ruim).slice(0, 60)).toBe(400)
    expect((await app.inject({ url: '/studio/comentarios?kind=pagina', headers: h(A, 'a') })).statusCode).toBe(400)
    const evil = await com({ ...ok, texto: '<script>alert(1)</script>' }); expect(evil.statusCode).toBe(201); expect(evil.json().comentario.texto).toBe('<script>alert(1)</script>') // guardado como texto; quem exibe escapa
  })
  it('limite de taxa: 429 com retry-after', async () => {
    let fichas = 2; const a2 = Fastify(); rotasStudio(a2, { armazem, baseDe: async () => base, q, autentica: autentica as never, limite: { tenta: (_k, c = 1) => (fichas >= c ? ((fichas -= c), { ok: true as const }) : { ok: false as const, esperaSeg: 9 }) } })
    expect((await a2.inject({ url: '/studio/nos', headers: h(A, 'a') })).statusCode).toBe(200); expect((await a2.inject({ url: '/studio/nos', headers: h(A, 'a') })).statusCode).toBe(200)
    const r = await a2.inject({ url: '/studio/nos', headers: h(A, 'a') }); expect(r.statusCode).toBe(429); expect(r.headers['retry-after']).toBe('9'); await a2.close()
  })
  it('sessaoDeToken: as permissões vêm dos papéis (leitor ⊂ comentarista ⊂ editor); papel desconhecido e papéis de outros domínios não dão nada', () => {
    const pode = (papeis: string[]) => { const s = sessaoDeToken(base, { tenantId: A, usuario: 'u', papeis }); return (['studio.ver', 'studio.comentar', 'studio.editar'] as const).map((p) => s.pode(p)) }
    expect(pode(['studio.leitor'])).toEqual([true, false, false]); expect(pode(['studio.comentarista'])).toEqual([true, true, false]); expect(pode(['studio.editor'])).toEqual([true, true, true])
    expect(pode([])).toEqual([false, false, false]); expect(pode(['gerente', 'catalogo.gerente'])).toEqual([false, false, false]); expect(pode(['studio.inexistente'])).toEqual([false, false, false]); expect(pode(['studio.leitor', 'studio.inexistente'])).toEqual([false, false, false])
    expect(sessaoDeToken(base, { tenantId: A, usuario: 'u', papeis: ['studio.editor'] })).toMatchObject({ tenantId: A, usuario: 'u' })
  })
  it('previa: sem gerador injetado é 501; com ele, valida o corpo, passa os blocos do tenant e devolve o HTML ou os erros', async () => {
    expect((await app.inject({ method: 'POST', url: '/studio/previa', headers: h(A, 'ana'), payload: { no: pagina('p') } })).statusCode).toBe(501)
    const chamadas: any[] = []; const a2 = Fastify(); rotasStudio(a2, { armazem, baseDe: async () => base, q, autentica: autentica as never, previsualiza: (x) => { chamadas.push(x); return (x.no as any).spec.rota === '/ruim' ? { ok: false, erros: ['quebrou'] } : { ok: true, html: '<p>oi</p>', titulo: 't' } } })
    const post = (corpo: object, t = h(A, 'ana', 'ver')) => a2.inject({ method: 'POST', url: '/studio/previa', headers: t, payload: corpo })
    const pb = await put(A, { kind: 'bloco', id: 'meu.bloco', versao: '1.0.0', estatuto: 'publicado', spec: { interface: 'meu/bloco', modelo: { bloco: 'texto/paragrafo', props: { texto: 'x' } } } }); expect(pb.statusCode, pb.body).toBe(201)
    const ok = await post({ no: pagina('p'), selecionado: 'p1' }); expect(ok.json()).toEqual({ ok: true, html: '<p>oi</p>', erros: [] }); expect(chamadas[0]).toMatchObject({ selecionado: 'p1' }); expect(chamadas[0].blocosDoTenant.map((b: any) => b.id)).toContain('meu.bloco'); expect(chamadas[0].blocosDoTenant.every((b: any) => b.tenantId === A)).toBe(true)
    expect((await post({ no: { ...pagina('p'), spec: { rota: '/ruim' } } })).json()).toEqual({ ok: false, html: '', erros: ['quebrou'] })
    expect((await post({ no: pagina('p') }, h(B, 'bia'))).json().ok).toBe(true); expect(chamadas.at(-1).blocosDoTenant).toEqual([]) // outro tenant: nenhum bloco do A
    for (const ruim of [{}, { no: 5 }, { no: [] }, { no: pagina('p'), extra: 1 }, { no: pagina('p'), selecionado: "x'; --" }]) expect((await post(ruim)).statusCode, JSON.stringify(ruim).slice(0, 40)).toBe(400)
    expect((await a2.inject({ method: 'POST', url: '/studio/previa', payload: { no: pagina('p') } })).statusCode).toBe(401); await a2.close()
  })
  it('tema: valor de token que o CSS não aceita é 422 ANTES de gravar (cor, medida, modos); válidos passam', async () => {
    const tema = (cor: object, extra: object = {}) => ({ kind: 'tema', id: 'validado', versao: '1.0.0', estatuto: 'publicado', spec: { tokens: { cor, ...extra } } })
    const r = await put(A, tema({ primaria: 'azul', fundo: '#fff; } body { display:none' }, { espacamento: { m: '8 8' } })); expect(r.statusCode).toBe(422)
    expect(r.json().erro.erros).toEqual(expect.arrayContaining([expect.stringContaining('tokens.cor.primaria'), expect.stringContaining('tokens.cor.fundo'), expect.stringContaining('tokens.espacamento.m')]))
    const m = await put(A, { ...tema({ primaria: '#fff' }), spec: { tokens: { cor: { primaria: '#fff' } }, modos: { escuro: { cor: { fundo: 'red' } } } } }); expect(m.statusCode).toBe(422); expect(m.json().erro.erros[0]).toContain('modos.escuro.cor.fundo')
    expect((await app.inject({ url: '/studio/historico/tema/validado', headers: h(A, 'ana') })).json().versoes).toEqual([]) // nada foi gravado
    expect((await put(A, tema({ primaria: '#1d4ed8', texto: 'rgb(0,0,0)' }, { espacamento: { m: 8 }, raio: { g: '0.5rem' } }))).statusCode).toBe(201)
  })
})
