import { describe, expect, it } from 'vitest'
import { abertosPorBloco, doBloco, fios, situacao, validaTexto, type Comentario, type Inst } from '../src'

const cm = (id: string, o: Partial<Comentario> = {}): Comentario => ({ id, kind: 'pagina', noId: 'home', autor: 'ana', texto: id, criadoEm: `2026-06-0${id.length}T10:00:00Z`, ...o })
const arvore: Inst = { bloco: 'caixa', id: 'r', slots: { filhos: [{ bloco: 'folha', id: 'a' }] } }
describe('comentários', () => {
  it('fios: respostas sob a raiz em ordem; resposta órfã vira raiz; ciclo não trava; fios por atividade', () => {
    const l = [cm('r1', { criadoEm: '2026-06-01T10:00:00Z' }), cm('x2', { respondeA: 'r1', criadoEm: '2026-06-03T10:00:00Z' }), cm('x1', { respondeA: 'r1', criadoEm: '2026-06-02T10:00:00Z' }), cm('r2', { criadoEm: '2026-06-02T09:00:00Z' }), cm('orf', { respondeA: 'sumiu', criadoEm: '2026-06-01T08:00:00Z' }), cm('neta', { respondeA: 'x1', criadoEm: '2026-06-04T10:00:00Z' })]
    const f = fios(l); expect(f.map((x) => x.raiz.id)).toEqual(['r1', 'r2', 'orf']); expect(f[0]!.respostas.map((x) => x.id)).toEqual(['x1', 'x2', 'neta']); expect(f[0]!.ultimaAtividade).toBe('2026-06-04T10:00:00Z')
    const ciclo = [cm('a', { respondeA: 'b' }), cm('b', { respondeA: 'a' })]; expect(() => fios(ciclo)).not.toThrow(); expect(fios([]).length).toBe(0)
  })
  it('resolvido vem da raiz; situação: geral, ativo e órfão (bloco removido)', () => {
    expect(fios([cm('r1', { resolvido: true }), cm('r2')]).map((f) => f.resolvido).sort()).toEqual([false, true])
    expect(situacao(cm('c'), arvore)).toBe('geral'); expect(situacao(cm('c', { ancora: 'a' }), arvore)).toBe('ativo'); expect(situacao(cm('c', { ancora: 'removido' }), arvore)).toBe('orfao'); expect(situacao(cm('c', { ancora: 'a' }), undefined)).toBe('orfao')
  })
  it('por bloco: lista e contador só de fios ABERTOS', () => {
    const l = [cm('a1', { ancora: 'a' }), cm('a2', { ancora: 'a', resolvido: true }), cm('a3', { ancora: 'a', respondeA: 'a1' }), cm('b1', { ancora: 'b' }), cm('g1')]
    expect(doBloco(l, 'a').map((c) => c.id)).toEqual(['a1', 'a2', 'a3']); expect([...abertosPorBloco(l)]).toEqual([['a', 1], ['b', 1]])
  })
  it('validaTexto', () => { expect(validaTexto('')).toBeDefined(); expect(validaTexto('   ')).toBeDefined(); expect(validaTexto(5)).toBeDefined(); expect(validaTexto('x'.repeat(4001))).toMatch(/4000/); expect(validaTexto('ok')).toBeUndefined() })
})
