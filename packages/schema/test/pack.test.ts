import { describe, expect, it } from 'vitest'
import { Registry, criaValidador, fechoDeDependencias, validaEstrutura, type No } from '../src/index'

const svc = (id: string, entidades: object): No => ({ kind: 'servico', id, versao: '1.0.0', estatuto: 'publicado', spec: { entidades, operacoes: {} } }) as never
const pack = (id: string, spec: object): No => ({ kind: 'pack', id, versao: '1.0.0', estatuto: 'publicado', spec: { nome: id, segmento: 'varejo', inclui: {}, ...spec } }) as never
const reg = (...nos: No[]) => { const r = new Registry(); for (const n of nos) r.registra(n); return r }
const ESTOQUE = svc('estoque', { deposito: { campos: { codigo: { tipo: 'texto', obrigatorio: true }, nome: { tipo: 'texto', obrigatorio: true }, padrao: { tipo: 'booleano', padrao: false } } }, marca: { campos: { nome: { tipo: 'texto', obrigatorio: true }, depositoId: { tipo: 'uuid' } } } })
const erros = (r: Registry, id: string) => validaEstrutura(r, r.resolve('pack', id)!.no).map((e) => `${e.regra}:${e.caminho}`)

describe('kind pack: schema', () => {
  const valida = criaValidador()
  it('exige nome, segmento e inclui; recusa campo desconhecido, segmento fora da lista e landing sem título', () => {
    expect(valida({ kind: 'pack', id: 'x', versao: '1.0.0', spec: { nome: 'X', segmento: 'varejo', inclui: {} } }).ok).toBe(true)
    for (const spec of [{ segmento: 'varejo', inclui: {} }, { nome: 'X', inclui: {} }, { nome: 'X', segmento: 'varejo' }, { nome: 'X', segmento: 'espacial', inclui: {} }, { nome: 'X', segmento: 'varejo', inclui: {}, extra: 1 }, { nome: 'X', segmento: 'varejo', inclui: {}, landing: { subtitulo: 's' } }, { nome: 'X', segmento: 'varejo', inclui: { servicos: ['A B'] } }]) expect(valida({ kind: 'pack', id: 'x', versao: '1.0.0', spec }).ok, JSON.stringify(spec)).toBe(false)
  })
})

describe('referências do pack (integridade)', () => {
  it('serviço, papel, pack dependente e conflito inexistentes são acusados', () => {
    const r = reg(pack('a', { depende: ['fantasma'], conflita: ['outro'], inclui: { servicos: ['nada'], papeis: ['ninguem'] }, papeisDono: ['ninguem'] }))
    const quebradas = r.verifica(r.resolve('pack', 'a')!.no).map((e) => e.caminho).sort()
    expect(quebradas).toEqual(['/spec/conflita/0', '/spec/depende/0', '/spec/inclui/papeis/0', '/spec/inclui/servicos/0', '/spec/papeisDono/0'])
  })
})

describe('validaPack: sementes, guardas e ciclos', () => {
  it('semente válida passa; guarda encadeia sementes', () => {
    const r = reg(ESTOQUE, pack('p', { inclui: { servicos: ['estoque'] }, sementes: [{ servico: 'estoque', entidade: 'deposito', dados: { codigo: 'A', nome: 'A' }, guarda: 'dep' }, { servico: 'estoque', entidade: 'marca', dados: { nome: 'M', depositoId: '$dep' } }] }))
    expect(erros(r, 'p')).toEqual([])
  })
  it('acusa serviço/entidade/campo inexistentes, obrigatório ausente e valor `$guarda` sem semente anterior', () => {
    const r = reg(ESTOQUE, pack('p', { inclui: { servicos: ['estoque'] }, sementes: [
      { servico: 'fantasma', entidade: 'x', dados: {} }, { servico: 'estoque', entidade: 'prateleira', dados: {} }, { servico: 'estoque', entidade: 'deposito', dados: { codigo: 'A', nome: 'A', cor: 'azul' } },
      { servico: 'estoque', entidade: 'deposito', dados: { codigo: 'B' } }, { servico: 'estoque', entidade: 'marca', dados: { nome: 'M', depositoId: '$depois' } }, { servico: 'estoque', entidade: 'deposito', dados: { codigo: 'C', nome: 'C' }, guarda: 'depois' }] }))
    expect(erros(r, 'p')).toEqual(['referencia:/spec/sementes/0/servico', 'entidade:/spec/sementes/1/entidade', 'campo:/spec/sementes/2/dados/cor', 'obrigatorio:/spec/sementes/3/dados', 'guarda:/spec/sementes/4/dados/depositoId'])
  })
  it('a guarda repetida e a semente de serviço que o pack não inclui (nem suas dependências) são acusadas', () => {
    const r = reg(ESTOQUE, pack('p', { sementes: [{ servico: 'estoque', entidade: 'deposito', dados: { codigo: 'A', nome: 'A' }, guarda: 'x' }] }), pack('q', { inclui: { servicos: ['estoque'] }, sementes: [{ servico: 'estoque', entidade: 'deposito', dados: { codigo: 'A', nome: 'A' }, guarda: 'x' }, { servico: 'estoque', entidade: 'deposito', dados: { codigo: 'B', nome: 'B' }, guarda: 'x' }] }))
    expect(erros(r, 'p')).toEqual(['servico:/spec/sementes/0/servico']); expect(erros(r, 'q')).toEqual(['guarda:/spec/sementes/1/guarda'])
    const herda = reg(ESTOQUE, pack('base', { inclui: { servicos: ['estoque'] } }), pack('filho', { depende: ['base'], sementes: [{ servico: 'estoque', entidade: 'deposito', dados: { codigo: 'A', nome: 'A' } }] }))
    expect(erros(herda, 'filho')).toEqual([]) // o serviço vem da dependência
  })
  it('dependência circular é acusada com o caminho do ciclo; o fecho sai em ordem de dependência', () => {
    const r = reg(pack('a', { depende: ['b'] }), pack('b', { depende: ['c'] }), pack('c', { depende: ['a'] }))
    expect(erros(r, 'a')).toEqual(['ciclo:/spec/depende']); expect(fechoDeDependencias(r, 'a')).toEqual({ ciclo: ['a', 'b', 'c', 'a'] })
    const ok = reg(pack('base', {}), pack('mid', { depende: ['base'] }), pack('topo', { depende: ['mid', 'base'] }))
    expect(fechoDeDependencias(ok, 'topo')).toEqual({ ordem: ['base', 'mid', 'topo'] })
  })
})
