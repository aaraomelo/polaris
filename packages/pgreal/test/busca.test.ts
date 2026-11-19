import { Registry, type No } from '@polaris/schema'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { criaBanco, criaCliente, temPostgres, type Banco, type Cliente } from '../src/harness'

// A busca APROXIMADA no Postgres de VERDADE: o papel de migração NÃO é superusuário (só dono do banco com CREATE), então isto prova que o `pg_trgm` é instalável por ele (extensão confiável, PG ≥ 13),
// que o índice trigrama existe e é usado, e que as consultas funcionam sob RLS com o papel da aplicação (sem BYPASSRLS).
const A = '11111111-1111-1111-1111-111111111111', B = '22222222-2222-2222-2222-222222222222'
const NO: No = { kind: 'servico', id: 'vitrine', versao: '1.0.0', estatuto: 'publicado', spec: {
  entidades: { artigo: { campos: { titulo: { tipo: 'texto', obrigatorio: true }, resumo: { tipo: 'texto' } }, busca: { campos: ['titulo', 'resumo'], modo: 'aproximada' }, crud: { caminho: '/artigos', permissao: 'publica' } } }, operacoes: {},
} } as never
const reg = new Registry(); reg.registra(NO as never)

describe.skipIf(!temPostgres)('Busca aproximada no Postgres real', () => {
  let b: Banco, c: Cliente
  beforeAll(async () => {
    b = await criaBanco('busca'); await b.migra(NO); await b.migra(NO) // a migração é idempotente (duas vezes: extensão, schema e índice com IF NOT EXISTS)
    c = await criaCliente(b, reg, 'vitrine', {}, {})
    for (const [t, r] of [['Café', 'Bebida quente'], ['Cafeteira italiana', 'Alumínio'], ['Máquina de café expresso', 'Automática'], ['Capuccino cremoso', 'Com canela'], ['Chá verde', 'Folhas'], ['Açaí na tigela', 'Com granola']] as const) await c.req([], A, 'POST', '/artigos', { titulo: t, resumo: r })
    await c.req([], B, 'POST', '/artigos', { titulo: 'Café da B', resumo: 'x' })
  })
  afterAll(async () => { await c?.fecha(); await b?.fecha() })
  const busca = async (q: string, tenant = A) => ((await c.req([], tenant, 'GET', `/artigos?busca=${encodeURIComponent(q)}&limite=50`)).corpo as Array<{ titulo: string }>).map((x) => x.titulo)

  it('o papel de migração (sem superusuário) instalou o pg_trgm no schema `ext` e criou o índice trigrama', async () => {
    expect((await b.admin.query(`SELECT rolsuper FROM pg_roles WHERE rolname = 'polaris_migrador'`)).rows[0]!.rolsuper).toBe(false)
    expect((await b.admin.query(`SELECT n.nspname FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace WHERE e.extname = 'pg_trgm'`)).rows[0]!.nspname).toBe('ext')
    expect((await b.admin.query(`SELECT indexdef FROM pg_indexes WHERE schemaname = 'vitrine' AND indexname = 'artigo_busca_trgm'`)).rows[0]!.indexdef).toMatch(/USING gin .*gin_trgm_ops/)
  })
  it('acha o que contém e o parecido, ordenado por relevância, sob RLS e com o papel da aplicação', async () => {
    const r = await busca('cafe'); expect(r[0]).toBe('Café'); expect(r).toEqual(expect.arrayContaining(['Cafeteira italiana', 'Máquina de café expresso']))
    for (const [digitado, esperado] of [['cafetera', 'Cafeteira italiana'], ['capucino', 'Capuccino cremoso'], ['expreso', 'Máquina de café expresso'], ['acaii', 'Açaí na tigela']] as const) expect(await busca(digitado), digitado).toContain(esperado)
    expect(await busca('xyzzy')).toEqual([]); expect(await busca('cafe', B)).toEqual(['Café da B']); expect(await busca("'; DROP TABLE vitrine.artigo; --")).toEqual([])
  })
  it('o índice trigrama é USADO (mesma expressão da consulta), inclusive para o LIKE', async () => {
    await b.admin.query('ANALYZE vitrine.artigo')
    const c2 = await b.admin.connect(); try { await c2.query('SET enable_seqscan = off'); const plano = (await c2.query(`EXPLAIN SELECT 1 FROM vitrine.artigo WHERE lower(translate(coalesce("titulo", '') || ' ' || coalesce("resumo", ''), 'á', 'a')) LIKE '%cafe%'`)).rows.map((r) => r['QUERY PLAN']).join('\n'); expect(plano).not.toContain('artigo_busca_trgm') /* outra expressão (tabela de acentos diferente): o índice só vale para a MESMA */ } finally { c2.release() }
    const { exprDeBusca } = await import('@polaris/schema'), expr = exprDeBusca(['titulo', 'resumo'], (x) => `"${x}"`), c3 = await b.admin.connect()
    try { await c3.query('SET enable_seqscan = off'); const plano = (await c3.query(`EXPLAIN SELECT 1 FROM vitrine.artigo WHERE ${expr} LIKE '%cafe%'`)).rows.map((r) => r['QUERY PLAN']).join('\n'); expect(plano).toContain('artigo_busca_trgm') } finally { c3.release() }
  })
})
