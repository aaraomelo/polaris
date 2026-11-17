import { createMongoAbility, subject } from '@casl/ability'
import { Registry } from '@polaris/schema'
import { describe, expect, it } from 'vitest'
import { NaoRepresentavelNoCasl, PapelInvalido, criaAbility, paraCasl, paraCaslBasico, podeConceder, regrasDePapeis, type Regra } from '../src/index'

const papel = (id: string, regras: Regra[], extra: object = {}, escopo: object = {}) => ({ kind: 'papel', id, versao: '1.0.0', estatuto: 'publicado', spec: { regras, ...extra }, ...escopo }) as never
const R = (acoes: string[], extra: Partial<Regra> = {}, sujeitos = ['loja.pedido']): Regra => ({ acoes, sujeitos, ...extra })

describe('papéis: herança, cascata, erros', () => {
  const reg = () => { const r = new Registry()
    r.registra(papel('leitor', [R(['listar', 'obter'], {}, ['all'])]))
    r.registra(papel('vendedor', [R(['criar'])], { herda: ['leitor'] }))
    r.registra(papel('gerente', [R(['manage'])], { herda: ['vendedor'] }))
    return r }
  it('herança transitiva: as regras do pai vêm ANTES e cada papel aparece uma vez', () => {
    expect(regrasDePapeis(reg(), ['gerente']).map((x) => x.acoes.join(','))).toEqual(['listar,obter', 'criar', 'manage'])
    expect(regrasDePapeis(reg(), ['gerente', 'vendedor', 'leitor']).length).toBe(3) // sem duplicar
    expect(regrasDePapeis(reg(), [])).toEqual([])
  })
  it('a CASCATA vale por papel: o tenant redefine `vendedor` só para ele; os outros seguem com o do core', () => {
    const r = reg(); r.registra(papel('vendedor', [R(['criar', 'atualizar'])], {}, { tenantId: 'acme' }))
    expect(regrasDePapeis(r, ['vendedor'], { tenantId: 'acme' }).map((x) => x.acoes.join(','))).toEqual(['criar,atualizar'])
    expect(regrasDePapeis(r, ['vendedor'], { tenantId: 'outra' }).map((x) => x.acoes.join(','))).toEqual(['listar,obter', 'criar'])
  })
  it('papel inexistente é ERRO (não "sem regras"), e ciclo de herança também', () => {
    expect(() => regrasDePapeis(reg(), ['fantasma'])).toThrow(PapelInvalido); expect(() => regrasDePapeis(reg(), ['fantasma'])).toThrow("papel 'fantasma' não existe")
    const r = reg(); r.registra(papel('a', [], { herda: ['b'] })); r.registra(papel('b', [], { herda: ['a'] }))
    expect(() => regrasDePapeis(r, ['a'])).toThrow(/ciclo de herança: a → b → a|ciclo de herança de papéis: a → b → a/)
  })
  it('herança profunda demais é recusada (limite 10)', () => {
    const r = new Registry(); for (let i = 0; i < 14; i++) r.registra(papel(`p${i}`, [R(['listar'])], i < 13 ? { herda: [`p${i + 1}`] } : {}))
    expect(() => regrasDePapeis(r, ['p0'])).toThrow(/muito profunda/)
  })
})

describe('paraCaslBasico (CASL padrão, sem $or): o front monta o Ability sem perder regra', () => {
  it('formato CASL; $or vira uma regra por ramo; negações vão por último', () => {
    const c = paraCaslBasico([R(['listar'], { negar: true, onde: { dono: 'a' } }), R(['listar'], { onde: { $or: [{ dono: '$u' }, { total: { $gt: '5' } }] }, campos: ['total'] })])
    expect(c).toEqual([
      { action: ['listar'], subject: ['loja.pedido'], fields: ['total'], conditions: { dono: '$u' } },
      { action: ['listar'], subject: ['loja.pedido'], fields: ['total'], conditions: { total: { $gt: '5' } } },
      { action: ['listar'], subject: ['loja.pedido'], inverted: true, conditions: { dono: 'a' } },
    ])
    expect(createMongoAbility(c as never).can('listar', 'loja.pedido')).toBe(true)
  })
  it('E: $and funde; conflito e $nor são NÃO representáveis e LANÇAM (mostrar errado na tela seria pior)', () => {
    expect(paraCaslBasico([R(['listar'], { onde: { $and: [{ qtd: { $gt: 1 } }, { qtd: { $lt: 5 } }, { dono: 'a' }] } })])).toEqual([{ action: ['listar'], subject: ['loja.pedido'], conditions: { qtd: { $gt: 1, $lt: 5 }, dono: 'a' } }])
    expect(() => paraCaslBasico([R(['listar'], { onde: { $and: [{ qtd: { $gt: 1 } }, { qtd: { $gt: 9 } }] } })])).toThrow(NaoRepresentavelNoCasl)
    expect(() => paraCaslBasico([R(['listar'], { onde: { $nor: [{ dono: 'a' }] } })])).toThrow('$nor')
  })
})

describe('criaAbility + paraCasl: MongoQuery COMPLETO no CASL (o matcher ganha $or/$and/$nor/$not)', () => {
  it('as regras seguem como estão (sem converter); o CASL decide com $or, $nor e $not por campo', () => {
    const regras: Regra[] = [R(['listar'], { onde: { $or: [{ dono: 'a' }, { qtd: { $not: { $gt: 5 } } }] } }), R(['listar'], { negar: true, onde: { $nor: [{ ativo: true }] } })]
    expect(paraCasl(regras)).toEqual([{ action: ['listar'], subject: ['loja.pedido'], conditions: { $or: [{ dono: 'a' }, { qtd: { $not: { $gt: 5 } } }] } }, { action: ['listar'], subject: ['loja.pedido'], inverted: true, conditions: { $nor: [{ ativo: true }] } }])
    const a = criaAbility(regras)
    const can = (l: object) => a.can('listar', subject('loja.pedido', l) as never)
    expect(can({ dono: 'a', qtd: 9, ativo: true })).toBe(true); expect(can({ dono: 'b', qtd: 3, ativo: true })).toBe(true); expect(can({ dono: 'b', qtd: 9, ativo: true })).toBe(false)
    expect(can({ dono: 'a', qtd: 9, ativo: false })).toBe(false) // a proibição ($nor) vence
  })
  it('o CASL PADRÃO (sem o matcher) não entende $or: nunca casa — por isso existe criaAbility', async () => {
    const { createMongoAbility } = await import('@casl/ability')
    const padrao = createMongoAbility(paraCasl([R(['listar'], { onde: { $or: [{ dono: 'a' }] } })]) as never)
    expect(padrao.can('listar', subject('loja.pedido', { dono: 'a' }) as never)).toBe(false)
    expect(criaAbility([R(['listar'], { onde: { $or: [{ dono: 'a' }] } })]).can('listar', subject('loja.pedido', { dono: 'a' }) as never)).toBe(true)
  })
})

describe('delegação sem escalada: ninguém concede mais do que tem', () => {
  const ator: Regra[] = [R(['listar', 'obter', 'criar'], { onde: { dono: 'u1' }, profundidade: 2, campos: ['total', 'dono'] }), R(['listar'], {}, ['loja.produto'])]
  const ok = (r: Regra, a = ator) => podeConceder(a, r)
  it('concede igual ou MENOS: ações contidas, condição igual ou mais restrita, campos ⊆, profundidade atenuada', () => {
    expect(ok(R(['listar'], { onde: { dono: 'u1' }, campos: ['total'], profundidade: 1 }))).toEqual({ ok: true })
    expect(ok(R(['listar'], { onde: { dono: 'u1', ativo: true }, campos: ['total'], profundidade: 0 }))).toEqual({ ok: true }) // condição MAIS restrita
    expect(ok(R(['listar'], {}, ['loja.produto']))).toEqual({ ok: true })
  })
  it.each([
    ['ação que não detém', R(['remover'], { onde: { dono: 'u1' }, campos: ['total'] }), 'não detém'],
    ['sujeito que não detém', R(['listar'], {}, ['loja.cliente']), 'não detém'],
    ['sem a condição do ator (mais ampla)', R(['listar'], { campos: ['total'] }), 'mais ampla'],
    ['condição diferente (outro dono)', R(['listar'], { onde: { dono: 'u2' }, campos: ['total'] }), 'mais ampla'],
    ['condição não comparável ($or): na dúvida, nega', R(['listar'], { onde: { $or: [{ dono: 'u1' }, { dono: 'u2' }] }, campos: ['total'] }), 'não dá para provar'],
    ['campo que o ator não tem', R(['listar'], { onde: { dono: 'u1' }, campos: ['total', 'nota'] }), 'campos que o ator não tem'],
    ['sem restrição de campos (o ator tem lista)', R(['listar'], { onde: { dono: 'u1' } }), 'campos que o ator não tem'],
    ['profundidade maior que a permitida (2 → no máx. 1)', R(['listar'], { onde: { dono: 'u1' }, campos: ['total'], profundidade: 2 }), 'excede'],
    ['profundidade ilimitada', R(['listar'], { onde: { dono: 'u1' }, campos: ['total'] }), 'excede'],
    ['manage (ator não tem manage)', R(['manage'], { onde: { dono: 'u1' }, campos: ['total'] }), 'não detém'],
  ])('NEGA: %s', (_n, r, motivo) => { const x = ok(r); expect(x.ok).toBe(false); expect((x as { motivo: string }).motivo).toContain(motivo) })
  it('quem tem profundidade 0 não re-delega; quem tem manage/all concede o que quiser (dentro da profundidade)', () => {
    expect(podeConceder([R(['listar'], { profundidade: 0 })], R(['listar'], { profundidade: 0 })).ok).toBe(false)
    expect(podeConceder([{ acoes: ['manage'], sujeitos: ['all'] }], R(['remover'], { onde: { dono: 'x' }, profundidade: 5 }))).toEqual({ ok: true })
  })
  it('proposta de NEGAÇÃO é sempre concedível (só reduz); ator proibido de algo não concede esse algo', () => {
    expect(podeConceder([R(['listar'])], R(['remover'], { negar: true })).ok).toBe(true)
    const proibido: Regra[] = [R(['manage'], {}, ['all']), R(['remover'], { negar: true })]
    expect(podeConceder(proibido, R(['remover'])).ok).toBe(false); expect(podeConceder(proibido, R(['listar'])).ok).toBe(true)
  })
})
