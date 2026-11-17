import { describe, expect, it } from 'vitest'
import { Registry, comparaEventos, confere, majorDoEvento, type No } from '../src/index'

const ev = (versao: string, payload: object, extra: object = {}): No => ({ kind: 'evento', id: 'pedido.criado', versao, estatuto: 'publicado', spec: { nome: 'pedido.criado', payload, ...extra } }) as never
const V1 = ev('1.0.0', { pedidoId: { tipo: 'uuid', obrigatorio: true }, total: { tipo: 'dinheiro', obrigatorio: true }, nota: { tipo: 'texto' } }, { idempotencia: 'pedidoId' })

describe('compatibilidade de versões de evento', () => {
  it('campo novo (opcional ou obrigatório), opcional→obrigatório, remover opcional: minor, compatível', () => {
    const r = comparaEventos(V1, ev('1.1.0', { pedidoId: { tipo: 'uuid', obrigatorio: true }, total: { tipo: 'dinheiro', obrigatorio: true }, canal: { tipo: 'texto', obrigatorio: true } }, { idempotencia: 'pedidoId' }))
    expect(r).toMatchObject({ ok: true, bump: 'minor', quebras: [] })
    expect(comparaEventos(V1, ev('1.0.1', { pedidoId: { tipo: 'uuid', obrigatorio: true }, total: { tipo: 'dinheiro', obrigatorio: true }, nota: { tipo: 'texto', obrigatorio: true } }, { idempotencia: 'pedidoId' })).ok).toBe(true)
  })
  it('sem mudança no contrato: patch', () => { expect(comparaEventos(V1, ev('1.0.1', (V1.spec as any).payload, { idempotencia: 'pedidoId' }))).toMatchObject({ ok: true, bump: 'patch' }) })
  it.each([
    ['remover campo obrigatório', { pedidoId: { tipo: 'uuid', obrigatorio: true } }, 'era obrigatório e foi removido'],
    ['obrigatório → opcional', { pedidoId: { tipo: 'uuid', obrigatorio: true }, total: { tipo: 'dinheiro' } }, 'passou de obrigatório para opcional'],
    ['mudar o tipo', { pedidoId: { tipo: 'texto', obrigatorio: true }, total: { tipo: 'dinheiro', obrigatorio: true } }, 'tipo uuid → texto'],
    ['virar lista', { pedidoId: { tipo: 'uuid', obrigatorio: true }, total: { tipo: 'dinheiro', obrigatorio: true, lista: true } }, 'virou lista'],
  ])('%s é QUEBRA: sem subir o major é erro; com major novo passa', (_n, payload, trecho) => {
    const sem = comparaEventos(V1, ev('1.1.0', payload, { idempotencia: 'pedidoId' }))
    expect(sem.ok).toBe(false); expect(sem.bump).toBe('major'); expect(sem.erros[0]).toContain('exige MAJOR novo'); expect(sem.quebras.join(' ')).toContain(trecho)
    expect(comparaEventos(V1, ev('2.0.0', payload, { idempotencia: 'pedidoId' })).ok).toBe(true)
  })
  it('trocar a chave de idempotência é quebra; retroceder a versão e renomear o evento são erros', () => {
    expect(comparaEventos(V1, ev('1.1.0', (V1.spec as any).payload, { idempotencia: 'total' })).quebras[0]).toContain('chave de idempotência')
    expect(comparaEventos(ev('2.0.0', {}), ev('1.0.0', {})).erros.join(' ')).toContain('retrocedeu')
    expect(comparaEventos(V1, { ...ev('2.0.0', {}), spec: { nome: 'pedido.pago', payload: {} } } as never).quebras[0]).toContain('outro evento')
  })
  it('majorDoEvento lê o major do semver', () => { expect(majorDoEvento({ versao: '3.12.1' })).toBe(3) })
})

describe('serviço: eventos publicados e consumidos são contratos que existem', () => {
  const servico = (publica: string[], consome: string[]): No => ({ kind: 'servico', id: 'pedidos', versao: '1.0.0', estatuto: 'publicado', spec: { entidades: { pedido: { campos: {} } }, operacoes: { criar: { metodo: 'POST', caminho: '/pedidos', saida: 'pedido', publica } }, consome } }) as never
  it('evento inexistente em `publica` ou `consome` é referência quebrada, com o caminho', () => {
    const r = new Registry(); r.registra(V1 as never)
    const s = r.registra(servico(['pedido.criado', 'pedido.fantasma'], ['pagamento.confirmado']) as never)
    expect(confere(r, s).map((e) => `${e.caminho}`)).toEqual(['/spec/operacoes/criar/publica/1', '/spec/consome/0'])
  })
  it('com os eventos registrados, a verificação passa', () => {
    const r = new Registry(); r.registra(V1 as never)
    const s = r.registra(servico(['pedido.criado'], ['pedido.criado']) as never)
    expect(confere(r, s)).toEqual([])
  })
})
