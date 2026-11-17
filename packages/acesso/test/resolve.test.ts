import { subject } from '@casl/ability'
import { describe, expect, it } from 'vitest'
import { avalia, camposPermitidos, criaAbility, permite, resolve, type Condicao, type Regra, type Tipos } from '../src/index'

const TIPOS: Tipos = { dono: 'texto', qtd: 'inteiro', ativo: 'booleano', total: 'dinheiro', nota: 'texto', tags: 'texto[]' }
const TODOS = Object.keys(TIPOS)
const S = 'loja.pedido'
const R = (acoes: string[], extra: Partial<Regra> = {}, sujeitos = [S]): Regra => ({ acoes, sujeitos, ...extra })
const res = (rs: Regra[], acao: string, v = { usuario: 'u1' }) => resolve(rs, acao, S, v, TIPOS)
const pode = (rs: Regra[], acao: string, linha?: Record<string, unknown>, campo?: string, v = { usuario: 'u1' }) => permite(rs, acao, S, v, TIPOS, (c, l) => avalia(c, l, TIPOS), linha, campo)

describe('resolve: quais LINHAS a ação alcança', () => {
  it('sem regra que case → nada; grant incondicional → tudo; com condição → onde; vários grants → OR', () => {
    expect(res([], 'listar')).toEqual({ tipo: 'nada' }); expect(res([R(['obter'])], 'listar')).toEqual({ tipo: 'nada' })
    expect(res([R(['listar'])], 'listar')).toEqual({ tipo: 'tudo' })
    expect(res([R(['listar'], { onde: { dono: '$usuario' } })], 'listar')).toEqual({ tipo: 'onde', cond: { dono: 'u1' } })
    expect(res([R(['listar'], { onde: { dono: 'a' } }), R(['listar'], { onde: { qtd: 1 } })], 'listar')).toEqual({ tipo: 'onde', cond: { $or: [{ dono: 'a' }, { qtd: 1 }] } })
    expect(res([R(['listar'], { onde: { dono: 'a' } }), R(['listar'])], 'listar')).toEqual({ tipo: 'tudo' }) // um grant sem condição basta
  })
  it('manage cobre qualquer ação e all qualquer sujeito', () => {
    expect(res([R(['manage'])], 'remover')).toEqual({ tipo: 'tudo' }); expect(resolve([{ acoes: ['listar'], sujeitos: ['all'] }], 'listar', 'qualquer.coisa', {}, TIPOS)).toEqual({ tipo: 'tudo' })
  })
  it('NEGAR VENCE, em qualquer ordem: proibição de linha vira exclusão; proibição incondicional nega a ação inteira', () => {
    const grant = R(['manage']), nega = R(['remover'], { negar: true, onde: { ativo: false } })
    for (const ordem of [[grant, nega], [nega, grant]]) expect(res(ordem, 'remover')).toEqual({ tipo: 'onde', cond: { $nor: [{ ativo: false }] } })
    for (const ordem of [[grant, R(['remover'], { negar: true })], [R(['remover'], { negar: true }), grant]]) expect(res(ordem, 'remover')).toEqual({ tipo: 'nada' })
    expect(res([R(['listar'], { onde: { dono: 'a' } }), R(['listar'], { negar: true, onde: { qtd: 0 } })], 'listar')).toEqual({ tipo: 'onde', cond: { $and: [{ dono: 'a' }, { $nor: [{ qtd: 0 }] }] } })
  })
  it('REGRESSÃO (defeito do access do Tiffany): uma proibição SEM condição não pode ser descartada ao montar o filtro — "nunca" não vira "sempre"', () => {
    // No Tiffany, negativas sem `conditions` eram filtradas fora do `where`: um `cannot('delete','Order')` virava allow-all.
    expect(res([R(['manage']), R(['remover'], { negar: true })], 'remover')).toEqual({ tipo: 'nada' })
    expect(res([R(['remover'], { onde: { dono: 'a' } }), R(['remover'], { negar: true })], 'remover')).toEqual({ tipo: 'nada' })
    expect(pode([R(['manage']), R(['remover'], { negar: true })], 'remover', { dono: 'u1' })).toBe(false)
  })
  it('proibição só de CAMPOS não afeta a linha (a ação segue permitida); sem `campos` e com condição, exclui linhas', () => {
    expect(res([R(['listar']), R(['listar'], { negar: true, campos: ['nota'] })], 'listar')).toEqual({ tipo: 'tudo' })
  })
  it('$usuario sem usuário: o GRANT não vale (fail-closed) e a PROIBIÇÃO vale para tudo', () => {
    expect(res([R(['listar'], { onde: { dono: '$usuario' } })], 'listar', {} as never)).toEqual({ tipo: 'nada' })
    expect(res([R(['manage']), R(['listar'], { negar: true, onde: { dono: '$usuario' } })], 'listar', {} as never)).toEqual({ tipo: 'nada' })
  })
  it('regra malformada FALHA ALTO (lança); nunca é ignorada', () => {
    expect(() => res([R(['listar'], { onde: { naoExiste: 1 } })], 'listar')).toThrow(/não existe/)
    expect(() => res([R(['listar'], { onde: { nota: { $gt: 'a' } } })], 'listar')).toThrow(/ordenar/)
  })
})

describe('campos permitidos (conservador: interseção dos grants)', () => {
  const c = (rs: Regra[], acao = 'listar') => camposPermitidos(rs, acao, S, { usuario: 'u1' }, TIPOS, TODOS)
  it('sem restrição → null (todos); grant com lista → a lista; vários grants → INTERSEÇÃO (nunca mais do que algum grant dá)', () => {
    expect(c([R(['listar'])])).toBeNull()
    expect(c([R(['listar'], { campos: ['dono', 'total'] })])).toEqual(['dono', 'total'])
    expect(c([R(['listar'], { campos: ['dono', 'total'] }), R(['listar'], { onde: { dono: '$usuario' } })])).toEqual(['dono', 'total']) // o outro é "todos"; vale o mais restrito
    expect(c([R(['listar'], { campos: ['dono', 'total'] }), R(['listar'], { campos: ['total', 'nota'] })])).toEqual(['total'])
  })
  it('proibição de campos remove, mesmo de "todos"', () => {
    expect(c([R(['listar']), R(['listar'], { negar: true, campos: ['nota'] })])).toEqual(['dono', 'qtd', 'ativo', 'total', 'tags'])
  })
})

describe('ORÁCULO: o CASL decide igual (MongoQuery completo; negações DEPOIS, que é como o CASL precisa para "negar vence")', () => {
  let seed = 7
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff)
  const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(rnd() * xs.length)]!
  const lit: Record<string, () => unknown> = { dono: () => pick(['a', 'b', 'c']), qtd: () => pick([1, 5, 9]), ativo: () => pick([true, false]), total: () => pick(['1', '5', '9']), nota: () => pick(['x', 'y']), tags: () => pick(['a', 'b', 'c']) }
  const campos = Object.keys(lit)
  const escalares = campos.filter((c) => c !== 'tags')
  const geraCond = (): Condicao | undefined => {
    const r = rnd(); if (r < 0.3) return undefined
    const f = pick(campos)
    if (f === 'tags') { // campo LISTA: contém, $in, $all, $size, $ne, $elemMatch, $not
      const o = pick(['contem', '$in', '$all', '$size', '$ne', '$elemMatch', '$not'])
      return { tags: o === 'contem' ? lit.tags!() : o === '$size' ? { $size: Math.floor(rnd() * 3) } : o === '$elemMatch' ? { $elemMatch: { $in: [lit.tags!(), lit.tags!()] } } : o === '$ne' ? { $ne: lit.tags!() } : o === '$not' ? { $not: { $all: [lit.tags!()] } } : { [o]: [lit.tags!(), lit.tags!()] } }
    }
    if (r < 0.4) return { [f]: { $not: ['qtd', 'total'].includes(f) && rnd() < 0.6 ? { $gt: lit[f]!() } : lit[f]! () } } as Condicao // $not por campo
    if (r < 0.58) return { [f]: lit[f]!() }
    if (r < 0.7) return { [f]: { $in: [lit[f]!(), lit[f]!()] } }
    if (r < 0.8) return { [f]: { $ne: lit[f]!() } }
    if (r < 0.9 && ['qtd', 'total'].includes(f)) return { [f]: { $gt: lit[f]!() } }
    const g = pick(escalares)
    return { $or: [{ [f]: lit[f]!() }, { [g]: lit[g]!() }] } as Condicao // cada valor do TIPO do seu campo (o CASL compara estrito)
  }
  const geraRegra = (negar: boolean): Regra => {
    const cond = geraCond(); const comCampos = rnd() < 0.3
    return { acoes: [pick(['listar', 'listar', 'manage', 'remover'])], sujeitos: [pick([S, S, 'all'])], ...(negar ? { negar: true } : {}), ...(cond ? { onde: cond } : {}), ...(comCampos ? { campos: [pick(campos), pick(campos)] } : {}) }
  }
  const linhaAleatoria = () => ({ dono: lit.dono!(), qtd: lit.qtd!(), ativo: lit.ativo!(), total: lit.total!(), nota: lit.nota!(), tags: pick([[], ['a'], ['a', 'b'], ['b', 'c'], ['c']]) })
  it('800 conjuntos de regras × 8 linhas × ações e campos: `permite` ≡ CASL `can`', () => {
    let divergencias: string[] = [], verdadeiros = 0, total = 0
    for (let i = 0; i < 800; i++) {
      const positivas = Array.from({ length: 1 + Math.floor(rnd() * 3) }, () => geraRegra(false)), negativas = Array.from({ length: Math.floor(rnd() * 3) }, () => geraRegra(true))
      let regras = [...positivas, ...negativas]
      try { for (const r of regras) if (r.onde) avalia(r.onde, linhaAleatoria(), TIPOS) } catch { continue }
      const ability = criaAbility(regras)
      for (let j = 0; j < 8; j++) {
        const linha = linhaAleatoria(), acao = pick(['listar', 'remover']), campo = rnd() < 0.4 ? pick(campos) : undefined
        const meu = pode(regras, acao, linha, campo), casl = campo ? ability.can(acao, subject(S, linha) as never, campo) : ability.can(acao, subject(S, linha) as never)
        total++; if (meu) verdadeiros++
        if (meu !== casl) divergencias.push(`${JSON.stringify(regras)} ${acao} ${JSON.stringify(linha)} campo=${campo} → meu ${meu} × casl ${casl}`)
      }
    }
    expect(divergencias.slice(0, 2)).toEqual([])
    expect(verdadeiros).toBeGreaterThan(total * 0.1); expect(verdadeiros).toBeLessThan(total * 0.9) // não é um teste trivial (tudo permitido ou tudo negado)
  })
  it('`resolve` e `permite` concordam linha a linha: a condição do WHERE é exatamente o conjunto permitido', () => {
    for (let i = 0; i < 500; i++) {
      const regras = [...Array.from({ length: 1 + Math.floor(rnd() * 3) }, () => geraRegra(false)), ...Array.from({ length: Math.floor(rnd() * 3) }, () => geraRegra(true))].map((r) => ({ ...r, campos: undefined })) as Regra[]
      const r = resolve(regras, 'listar', S, { usuario: 'u' }, TIPOS)
      for (let j = 0; j < 8; j++) {
        const linha = linhaAleatoria()
        const viaResolve = r.tipo === 'tudo' ? true : r.tipo === 'nada' ? false : avalia(r.cond, linha, TIPOS)
        expect(viaResolve, JSON.stringify({ regras, linha })).toBe(pode(regras, 'listar', linha))
      }
    }
  })
})
