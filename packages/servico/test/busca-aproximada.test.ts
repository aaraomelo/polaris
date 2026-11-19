import { PGlite } from '@electric-sql/pglite'
import { pg_trgm } from '@electric-sql/pglite/contrib/pg_trgm'
import { ACENTOS, SEM_ACENTO, emite, type No } from '@polaris/schema'
import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { criaServico, dbDePglite } from '../src/index'

// Busca APROXIMADA (`busca.modo: 'aproximada'`): erros de digitação e relevância, com o índice trigrama (pg_trgm). Ponta a ponta: Fastify + Postgres (PGlite com a extensão), RLS, papel SEM bypass.
const A = '11111111-1111-1111-1111-111111111111', B = '22222222-2222-2222-2222-222222222222'
const NO: No = { kind: 'servico', id: 'loja', versao: '1.0.0', estatuto: 'publicado', spec: {
  entidades: {
    artigo: { campos: { titulo: { tipo: 'texto', obrigatorio: true }, resumo: { tipo: 'texto' } }, busca: { campos: ['titulo', 'resumo'], modo: 'aproximada' }, crud: { caminho: '/artigos', permissao: 'publica' } },
    nota: { campos: { texto: { tipo: 'texto' } }, busca: { campos: ['texto'] }, crud: { caminho: '/notas', permissao: 'publica' } },
  }, operacoes: {},
} } as never
let pg: PGlite, app: FastifyInstance
const req = (host: string, metodo: string, url: string, corpo?: unknown) => app.inject({ method: metodo as 'GET', url, headers: { host, ...(corpo !== undefined ? { 'content-type': 'application/json' } : {}) }, ...(corpo !== undefined ? { payload: JSON.stringify(corpo) } : {}) })
const json = (r: { body: string }) => JSON.parse(r.body)
const busca = async (q: string, host = 'a.loja.test', ent = 'artigos') => (json(await req(host, 'GET', `/${ent}?busca=${encodeURIComponent(q)}&limite=50`)) as Array<{ titulo?: string; texto?: string }>).map((x) => x.titulo ?? x.texto)

beforeAll(async () => {
  pg = new PGlite({ extensions: { pg_trgm } })
  await pg.exec(`CREATE ROLE migrador NOLOGIN BYPASSRLS; CREATE ROLE app NOLOGIN; GRANT CREATE ON DATABASE postgres TO migrador; SET ROLE migrador;`)
  await pg.exec(emite(NO, 'sql'))
  await pg.exec(`RESET ROLE; GRANT USAGE ON SCHEMA loja TO app; GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA loja TO app; SET ROLE app;`)
  app = criaServico(NO, { db: dbDePglite(pg), contexto: (r: { hostname: string }) => ({ tenantId: r.hostname === 'a.loja.test' ? A : B }), aoErro: () => {} } as never)
  await app.ready()
  for (const [t, resumo] of [['Café', 'Bebida quente'], ['Cafeteira italiana', 'Alumínio, 6 xícaras'], ['Máquina de café expresso', 'Automática'], ['Capuccino cremoso', 'Com canela'], ['Chá verde', 'Folhas selecionadas'], ['Açaí na tigela', 'Com granola'], ['Bolo de fubá', 'Receita de café da tarde']] as const) await req('a.loja.test', 'POST', '/artigos', { titulo: t, resumo })
  await req('b.loja.test', 'POST', '/artigos', { titulo: 'Café da B', resumo: 'x' })
  for (const t of ['Cafeteira simples', 'Chá mate']) await req('a.loja.test', 'POST', '/notas', { texto: t })
})
afterAll(async () => { await app.close(); await pg.close() })

describe('busca aproximada', () => {
  it('o SQL gerado cria o schema das extensões, o pg_trgm e o índice trigrama sobre a mesma expressão da consulta', () => {
    const sql = emite(NO, 'sql'); expect(sql).toContain('CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA ext;'); expect(sql).toMatch(/CREATE INDEX IF NOT EXISTS "artigo_busca_trgm" ON "loja"\."artigo" USING gin \(\(lower\(translate\(coalesce\("titulo", ''\) \|\| ' ' \|\| coalesce\("resumo", ''\)/); expect(sql).toContain('ext.gin_trgm_ops')
    expect(emite({ ...NO, spec: { ...NO.spec, entidades: { nota: (NO.spec as { entidades: Record<string, unknown> }).entidades.nota } } } as never, 'sql')).not.toContain('pg_trgm') // só quem pede aproximada exige a extensão
  })
  it('acha o que contém (sem acento nem maiúsculas) e também o PARECIDO: erro de digitação, letra trocada, faltando ou sobrando', async () => {
    expect(await busca('cafe')).toEqual(expect.arrayContaining(['Café', 'Cafeteira italiana', 'Máquina de café expresso', 'Bolo de fubá']))
    for (const [digitado, esperado] of [['cafetera', 'Cafeteira italiana'], ['capucino', 'Capuccino cremoso'], ['expreso', 'Máquina de café expresso'], ['acaii', 'Açaí na tigela'], ['granolla', 'Açaí na tigela'], ['cremozo', 'Capuccino cremoso']] as const) expect(await busca(digitado), digitado).toContain(esperado)
  })
  it('o que não se parece NÃO entra (o limiar corta o ruído) e termo só com pontuação não filtra', async () => {
    expect(await busca('xyzzy')).toEqual([]); expect(await busca('futebol')).toEqual([]); expect(await busca('computador')).toEqual([]); expect((await busca('!!!')).length).toBe(7)
  })
  it('RELEVÂNCIA: o título que é a palavra vem antes; achar no título vale mais que no resumo; o texto curto e focado desempata', async () => {
    const r = await busca('cafe'); expect(r[0]).toBe('Café'); expect(r.indexOf('Café')).toBeLessThan(r.indexOf('Cafeteira italiana')); expect(r.indexOf('Máquina de café expresso')).toBeLessThan(r.indexOf('Bolo de fubá')) // "café" no título antes de "café" só no resumo
    expect(r[r.length - 1]).toBe('Bolo de fubá')
  })
  it('várias palavras (todas), junto de paginação e filtros; a ordem por relevância vale entre as páginas', async () => {
    expect(await busca('maquina cafe')).toEqual(['Máquina de café expresso']); expect(await busca('café quente')).toEqual(['Café'])
    const p1 = json(await req('a.loja.test', 'GET', '/artigos?busca=cafe&limite=2&pagina=1')).map((x: { titulo: string }) => x.titulo), p2 = json(await req('a.loja.test', 'GET', '/artigos?busca=cafe&limite=2&pagina=2')).map((x: { titulo: string }) => x.titulo)
    expect([...p1, ...p2]).toEqual((await busca('cafe')).slice(0, 4)); expect(p1[0]).toBe('Café')
    expect(json(await req('a.loja.test', 'GET', `/artigos?busca=cafe&titulo=${encodeURIComponent('Café')}`)).map((x: { titulo: string }) => x.titulo)).toEqual(['Café'])
  })
  it('isolado por tenant (RLS) e o termo nunca vira SQL', async () => {
    expect(await busca('cafe', 'b.loja.test')).toEqual(['Café da B']); expect(await busca("'; DROP TABLE loja.artigo; --")).toEqual([]); expect((await busca('cafe')).length).toBeGreaterThan(3)
  })
  it('o índice trigrama é USADO pela consulta (a expressão do índice é a mesma da consulta)', async () => {
    await pg.exec('RESET ROLE'); await pg.exec('SET enable_seqscan = off')
    const plano = (await pg.query(`EXPLAIN SELECT 1 FROM loja.artigo WHERE lower(translate(coalesce("titulo", '') || ' ' || coalesce("resumo", ''), '${ACENTOS}', '${SEM_ACENTO}')) LIKE '%cafe%'`)).rows.map((r) => String(Object.values(r as Record<string, unknown>)[0])).join('\n')
    await pg.exec('RESET enable_seqscan'); await pg.exec('SET ROLE app'); expect(plano).toContain('artigo_busca_trgm')
  })
  it('o modo exata continua como era: só trechos, sem aproximação, em ordem de criação', async () => {
    expect(await busca('cafeteira', 'a.loja.test', 'notas')).toEqual(['Cafeteira simples']); expect(await busca('cafetera', 'a.loja.test', 'notas')).toEqual([]); expect(await busca('cha', 'a.loja.test', 'notas')).toEqual(['Chá mate'])
  })
})
