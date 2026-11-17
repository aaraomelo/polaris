import { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { CondicaoInvalida, aSql, avalia, substitui, validaCondicao, type Condicao, type Tipos } from '../src/index'

const TIPOS: Tipos = { dono: 'texto', qtd: 'inteiro', preco: 'dinheiro', ativo: 'booleano', dia: 'data', ref: 'uuid', extra: 'json', tags: 'texto[]', nums: 'inteiro[]', precos: 'dinheiro[]' }

describe('validação (regra malformada FALHA, nunca é ignorada em silêncio)', () => {
  it('aceita igualdade, operadores e lógicos aninhados', () => {
    validaCondicao({ dono: 'x', qtd: { $gt: 1, $lte: 5 }, $or: [{ ativo: true }, { $and: [{ preco: { $gte: '5.50' } }, { ref: { $in: ['a'] } }] }] }, TIPOS)
    validaCondicao({ tags: 'a', nums: { $elemMatch: { $gt: 1, $lt: 5 }, $size: 2 }, precos: { $all: ['1.5'] }, qtd: { $not: { $in: [1] } } }, TIPOS)
  })
  it.each([
    [{ naoExiste: 1 }, "o campo 'naoExiste' não existe"],
    [{ extra: 1 }, 'campos json não entram'],
    [{ dono: { $gt: 'a' } }, "ordenar campo 'texto'"], // a ordem do texto depende da collation do banco
    [{ qtd: { $regex: 'x' } }, "operador '$regex'"],
    [{ $where: 'x' }, "operador '$where'"],
    [{ $or: { qtd: 1 } }, 'lista de condições'],
    [{ qtd: { $in: 5 } }, 'lista de valores simples'],
    [{ qtd: { $in: [{ a: 1 }] } }, 'lista de valores simples'],
    [{ qtd: { $exists: 'sim' } }, 'true ou false'],
    [{ qtd: { $gt: null } }, 'valor inválido'],
    [{ qtd: [1, 2] }, 'valor não suportado'],
    [{ qtd: { $all: [1] } }, 'só vale para campos lista'],
    [{ dono: { $size: 1 } }, 'só vale para campos lista'],
    [{ tags: { $all: [] } }, 'NÃO vazia'],
    [{ tags: { $size: -1 } }, 'inteiro ≥ 0'],
    [{ tags: null }, 'comparar lista com null'],
    [{ tags: { $in: [null] } }, 'sem null'],
    [{ tags: { $elemMatch: { $gt: 'a' } } }, "ordenar campo 'texto'"],
    [{ nums: { $elemMatch: { $exists: true } } }, 'não cabe dentro de $elemMatch'],
    [{ nums: { $elemMatch: { $elemMatch: { $gt: 1 } } } }, 'só vale para campos lista'],
    [{ qtd: { $not: { $regex: 'x' } } }, "operador '$regex'"],
    ['x', 'deve ser um objeto'],
  ])('%j → %s', (c, trecho) => { expect(() => validaCondicao(c, TIPOS)).toThrow(CondicaoInvalida); expect(() => validaCondicao(c, TIPOS)).toThrow(trecho) })
})

describe('$usuario e $tenant', () => {
  it('são substituídos em qualquer profundidade; sem a variável, a condição é marcada INDEFINIDA (o grant não vale, a proibição vale para tudo)', () => {
    expect(substitui({ dono: '$usuario', $or: [{ ref: '$tenant' }, { qtd: { $in: [1, '$usuario'] } }] }, { usuario: 'u1', tenant: 't1' })).toEqual({ cond: { dono: 'u1', $or: [{ ref: 't1' }, { qtd: { $in: [1, 'u1'] } }] }, indefinida: false })
    expect(substitui({ dono: '$usuario' }, {}).indefinida).toBe(true)
    expect(substitui({ ref: '$tenant' }, { usuario: 'u' }).indefinida).toBe(true)
  })
})

describe('avaliação em JS', () => {
  const linha = { dono: 'ana', qtd: 5, preco: '10.0000', ativo: true, dia: '2026-03-01', ref: null }
  it('igualdade, null, operadores, lógicos', () => {
    const ok = (c: Condicao) => avalia(c, linha, TIPOS)
    expect(ok({ dono: 'ana' })).toBe(true); expect(ok({ dono: 'bia' })).toBe(false); expect(ok({ ref: null })).toBe(true); expect(ok({ qtd: { $gt: 4, $lt: 6 } })).toBe(true)
    expect(ok({ qtd: { $ne: 5 } })).toBe(false); expect(ok({ ref: { $ne: 'x' } })).toBe(true); expect(ok({ dono: { $in: ['x', 'ana'] } })).toBe(true); expect(ok({ dono: { $nin: ['ana'] } })).toBe(false)
    expect(ok({ ref: { $exists: false } })).toBe(true); expect(ok({ $or: [{ dono: 'x' }, { qtd: 5 }] })).toBe(true); expect(ok({ $nor: [{ dono: 'x' }, { qtd: 9 }] })).toBe(true); expect(ok({})).toBe(true)
  })
  it('DINHEIRO compara como decimal exato (não como texto, não como float)', () => {
    const ok = (c: Condicao, l = linha) => avalia(c, l, TIPOS)
    expect(ok({ preco: { $gt: '9.9999' } })).toBe(true); expect(ok({ preco: { $gt: '10' } })).toBe(false); expect(ok({ preco: '10' })).toBe(true) // 10.0000 = 10
    expect(ok({ preco: { $gt: '9' } })).toBe(true) // como TEXTO "10.0000" < "9": a armadilha
    expect(ok({ preco: { $gte: '1000000000000000.0001' } }, { ...linha, preco: '1000000000000000.0001' })).toBe(true)
    expect(ok({ preco: { $lt: '0.1' } }, { ...linha, preco: '0.0999' })).toBe(true)
  })
  it('campos LISTA: contém, $in (algum), $nin, $all, $size, $elemMatch (um elemento satisfaz TODOS os operadores), ordem em algum elemento, $ne', () => {
    const l = { tags: ['a', 'b'], nums: [1, 5, 9], precos: ['1.5000', '10.0000'] }
    const ok = (c: Condicao, x: Record<string, unknown> = l) => avalia(c, x, TIPOS)
    expect(ok({ tags: 'a' })).toBe(true); expect(ok({ tags: 'z' })).toBe(false); expect(ok({ tags: { $ne: 'z' } })).toBe(true); expect(ok({ tags: { $ne: 'a' } })).toBe(false)
    expect(ok({ tags: { $in: ['z', 'b'] } })).toBe(true); expect(ok({ tags: { $nin: ['z'] } })).toBe(true); expect(ok({ tags: { $nin: ['b'] } })).toBe(false)
    expect(ok({ tags: { $all: ['a', 'b'] } })).toBe(true); expect(ok({ tags: { $all: ['a', 'z'] } })).toBe(false); expect(ok({ tags: { $size: 2 } })).toBe(true); expect(ok({ tags: { $size: 3 } })).toBe(false)
    expect(ok({ nums: { $elemMatch: { $gt: 1, $lt: 5 } } })).toBe(false) // 1 não é >1, 5 não é <5, 9 não é <5: NENHUM elemento satisfaz os dois
    expect(ok({ nums: { $elemMatch: { $gte: 5, $lt: 9 } } })).toBe(true); expect(ok({ nums: { $gt: 8 } })).toBe(true)
    expect(ok({ precos: { $gt: '9.99' } })).toBe(true); expect(ok({ precos: { $elemMatch: { $gt: '1.5', $lt: '10' } } })).toBe(false) // decimal exato
    expect(ok({ tags: { $size: 0 } }, { tags: [] })).toBe(true); expect(ok({ tags: { $size: 0 } }, { tags: null })).toBe(false)
    expect(ok({ tags: { $ne: 'a' } }, { tags: null })).toBe(true); expect(ok({ tags: { $nin: ['a'] } }, { tags: null })).toBe(true); expect(ok({ tags: 'a' }, { tags: null })).toBe(false)
    expect(ok({ tags: { $exists: true } })).toBe(true); expect(ok({ tags: { $exists: false } }, { tags: null })).toBe(true)
  })
  it('$not por campo: nega a condição do campo, e CASA com valor nulo (como o Mongo)', () => {
    const ok = (c: Condicao, x: Record<string, unknown>) => avalia(c, x, TIPOS)
    expect(ok({ qtd: { $not: { $gt: 5 } } }, { qtd: 3 })).toBe(true); expect(ok({ qtd: { $not: { $gt: 5 } } }, { qtd: 9 })).toBe(false); expect(ok({ qtd: { $not: { $gt: 5 } } }, { qtd: null })).toBe(true)
    expect(ok({ dono: { $not: 'ana' } }, { dono: 'bia' })).toBe(true); expect(ok({ tags: { $not: { $all: ['a'] } } }, { tags: ['a'] })).toBe(false)
  })
  it('nulo nunca satisfaz comparação de ordem', () => { expect(avalia({ qtd: { $gt: 1 } }, { qtd: null }, TIPOS)).toBe(false); expect(avalia({ qtd: { $lte: 1 } }, { qtd: null }, TIPOS)).toBe(false) })
})

describe('SQL ≡ JS: a condição compilada dá a MESMA resposta que a avaliação, no Postgres de verdade (fuzz)', () => {
  let pg: PGlite
  const COL = (c: string) => `"${c}"`
  beforeAll(async () => {
    pg = new PGlite()
    await pg.exec(`CREATE TABLE t (id serial PRIMARY KEY, dono text, qtd bigint, preco numeric(19,4), ativo boolean, dia date, ref uuid, tags text[], nums bigint[], precos numeric(19,4)[])`)
  })
  afterAll(async () => { await pg.close() })
  const U = ['11111111-1111-1111-1111-111111111111', '22222222-2222-2222-2222-222222222222']
  let seed = 12345
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff)
  const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(rnd() * xs.length)]!
  const valores: Record<string, () => unknown> = {
    dono: () => pick(['ana', 'bia', null, 'ana']), qtd: () => pick([1, 5, 10, null, 5]), preco: () => pick(['1.5000', '10.0000', '0.0999', null, '10.0000']),
    ativo: () => pick([true, false, null]), dia: () => pick(['2026-01-01', '2026-03-01', null]), ref: () => pick([...U, null]),
    tags: () => pick([null, [], ['a'], ['a', 'b'], ['b', 'c', 'a'], ['c']]), nums: () => pick([null, [], [1], [1, 5], [5, 10, 7], [10]]), precos: () => pick([null, [], ['1.5000'], ['1.5000', '10.0000'], ['0.0999', '9.9999']]),
  }
  const lit: Record<string, () => unknown> = {
    dono: () => pick(['ana', 'bia', 'cris']), qtd: () => pick([1, 5, 10, 7]), preco: () => pick(['1.5', '10', '0.1', '9.9999', '10.0000']),
    ativo: () => pick([true, false]), dia: () => pick(['2026-01-01', '2026-02-01', '2026-03-01']), ref: () => pick(U),
    tags: () => pick(['a', 'b', 'c', 'z']), nums: () => pick([1, 5, 10, 7]), precos: () => pick(['1.5', '10', '0.1', '9.9999']),
  }
  const campos = Object.keys(valores)
  const ORD = ['qtd', 'preco', 'dia', 'nums', 'precos']
  const LISTAS = ['tags', 'nums', 'precos']
  function gera(p: number): Condicao {
    const n = 1 + Math.floor(rnd() * 2); const c: Condicao = {}
    for (let i = 0; i < n; i++) {
      const r = rnd()
      if (p > 0 && r < 0.2) { c[pick(['$and', '$or', '$nor'])] = Array.from({ length: Math.floor(rnd() * 3) }, () => gera(p - 1)); continue }
      const f = pick(campos); const lista = LISTAS.includes(f)
      if (lista && r < 0.55) { // operadores de LISTA
        const o = pick(['contem', '$all', '$size', '$elemMatch', '$in', '$nin', '$ne', '$exists'])
        c[f] = o === 'contem' ? lit[f]!() : o === '$all' ? { $all: [lit[f]!(), lit[f]!()] } : o === '$size' ? { $size: Math.floor(rnd() * 4) } : o === '$exists' ? { $exists: rnd() < 0.5 }
          : o === '$elemMatch' && ORD.includes(f) ? { $elemMatch: { [pick(['$gt', '$gte', '$lt', '$lte'])]: lit[f]!(), ...(rnd() < 0.5 ? { [pick(['$gt', '$gte', '$lt', '$lte'])]: lit[f]!() } : {}) } }
          : o === '$elemMatch' ? { $elemMatch: { $in: [lit[f]!(), lit[f]!()] } } : o === '$ne' ? { $ne: lit[f]!() } : { [o]: [lit[f]!(), lit[f]!()] }
        continue
      }
      if (rnd() < 0.12) { const g = pick(campos), h = LISTAS.includes(g) ? lit[g]!() : lit[g]!(); c[g] = { $not: ORD.includes(g) && rnd() < 0.5 ? { $gt: h } : LISTAS.includes(g) ? { $all: [h] } : h }; continue } // $not por campo
      if (lista) { c[f] = lit[f]!(); continue }
      if (r < 0.4) c[f] = rnd() < 0.15 ? null : lit[f]!()
      else if (r < 0.55) c[f] = { $ne: rnd() < 0.15 ? null : lit[f]!() }
      else if (r < 0.7) c[f] = { [pick(['$in', '$nin'])]: Array.from({ length: Math.floor(rnd() * 3) }, () => (rnd() < 0.15 ? null : lit[f]!())) }
      else if (r < 0.8) c[f] = { $exists: rnd() < 0.5 }
      else { const f2 = pick(ORD); c[f2] = { [pick(['$gt', '$gte', '$lt', '$lte'])]: lit[f2]!() } }
    }
    return c
  }
  it('2000 condições aleatórias × 80 linhas (com nulos, listas e $not): nenhuma discordância', async () => {
    const linhas = Array.from({ length: 80 }, () => Object.fromEntries(campos.map((c) => [c, valores[c]!()])))
    for (const l of linhas) await pg.query(`INSERT INTO t (dono, qtd, preco, ativo, dia, ref, tags, nums, precos) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`, campos.map((c) => l[c]))
    const tipos: Tipos = { dono: 'texto', qtd: 'inteiro', preco: 'dinheiro', ativo: 'booleano', dia: 'data', ref: 'uuid', tags: 'texto[]', nums: 'inteiro[]', precos: 'dinheiro[]' }
    const todas = (await pg.query(`SELECT id, dono, qtd::int AS qtd, preco::text AS preco, ativo, dia::text AS dia, ref::text AS ref, tags, nums::text[] AS nums, precos::text[] AS precos FROM t ORDER BY id`)).rows as Array<Record<string, unknown>>
    let comLinhas = 0, comLista = 0, comNot = 0, discordancias: string[] = []
    for (let i = 0; i < 2000; i++) {
      const c = gera(2); validaCondicao(c, tipos)
      const params: unknown[] = []
      const sql = aSql(c, COL, params, tipos)
      const viaSql = (await pg.query(`SELECT id FROM t WHERE ${sql} ORDER BY id`, params)).rows.map((r) => (r as { id: number }).id)
      const viaJs = todas.filter((l) => avalia(c, l, tipos)).map((l) => l.id as number)
      if (viaSql.length) { comLinhas++; if (/"(tags|nums|precos)"/.test(JSON.stringify(c).replace(/(tags|nums|precos)/g, '"$1"').replace(/""/g, '"'))) comLista++; if (JSON.stringify(c).includes('$not"')) comNot++ }
      if (JSON.stringify(viaSql) !== JSON.stringify(viaJs)) discordancias.push(`${JSON.stringify(c)} → SQL ${viaSql} × JS ${viaJs}`)
    }
    expect(discordancias.slice(0, 3)).toEqual([])
    expect(comLinhas).toBeGreaterThan(400) // o fuzz não é vazio: muitas condições selecionam linhas
    expect(comLista).toBeGreaterThan(100); expect(comNot).toBeGreaterThan(20) // e cobre listas e $not de verdade
  }, 120_000)
  it('só o NOME do campo vem do schema; todo VALOR vai por parâmetro (injeção em valor não vira SQL)', () => {
    const params: unknown[] = []
    const sql = aSql({ dono: "x'; DROP TABLE t; --", qtd: { $in: [1, 2] } }, COL, params)
    expect(sql).not.toContain('DROP'); expect(sql).toBe('"dono" = $1 AND ("qtd" = ANY($2))'); expect(params).toEqual(["x'; DROP TABLE t; --", [1, 2]])
  })
})
