import { describe, expect, it } from 'vitest'
import { Registry, camposDaCondicao, catalogoDeAcesso, confere, type No } from '../src/index'

const servico: No = { kind: 'servico', id: 'loja', versao: '1.0.0', estatuto: 'publicado', spec: {
  entidades: {
    produto: { campos: { nome: { tipo: 'texto' }, preco: { tipo: 'dinheiro' } }, crud: { caminho: '/produtos', operacoes: ['listar', 'obter', 'criar'] } },
    pedido: { campos: { criadoPor: { tipo: 'texto' }, total: { tipo: 'dinheiro' } }, crud: { caminho: '/pedidos' } },
  },
  operacoes: { cancelar: { metodo: 'POST', caminho: '/pedidos/:id/cancelar', entrada: { id: { tipo: 'uuid', obrigatorio: true } }, saida: 'pedido' }, ping: { metodo: 'GET', caminho: '/ping' } },
} } as never
const papel = (id: string, regras: object[], extra: object = {}): No => ({ kind: 'papel', id, versao: '1.0.0', estatuto: 'publicado', spec: { regras, ...extra } }) as never
const reg = () => { const r = new Registry(); r.registra(servico as never); return r }

describe('catálogo de acesso: o que um papel pode referenciar', () => {
  const cat = catalogoDeAcesso(reg())
  it('sujeitos = servico.entidade (e servico.operacoes), com as ações REAIS de cada um', () => {
    expect([...cat.keys()].sort()).toEqual(['loja.operacoes', 'loja.pedido', 'loja.produto'])
    expect([...cat.get('loja.produto')!.acoes].sort()).toEqual(['criar', 'listar', 'obter']) // o crud declarou só 3
    expect([...cat.get('loja.pedido')!.acoes].sort()).toEqual(['atualizar', 'cancelar', 'criar', 'listar', 'obter', 'remover'])
    expect([...cat.get('loja.operacoes')!.acoes]).toEqual(['ping'])
    expect([...cat.get('loja.pedido')!.campos].sort()).toEqual(['atualizadoEm', 'criadoEm', 'criadoPor', 'id', 'total'])
  })
  it('campos de uma condição, recursivamente, sem os operadores', () => {
    expect([...camposDaCondicao({ criadoPor: '$usuario', $or: [{ total: { $gt: '5' } }, { $and: [{ nome: 'x' }, { preco: { $in: ['1'] } }] }] })].sort()).toEqual(['criadoPor', 'nome', 'preco', 'total'])
  })
})

describe('validação do papel contra os serviços', () => {
  const erros = (p: No) => confere(reg(), reg().registra(p as never)).map((e) => `${e.caminho} [${e.regra}] ${e.mensagem}${e.dica ? ` (${e.dica})` : ''}`)
  it('papel correto não tem erro', () => {
    expect(erros(papel('ok', [{ acoes: ['listar', 'obter'], sujeitos: ['loja.produto'] }, { acoes: ['manage'], sujeitos: ['loja.pedido'], onde: { criadoPor: '$usuario' }, campos: ['total'] }, { acoes: ['remover'], sujeitos: ['all'], negar: true }, { acoes: ['ping'], sujeitos: ['loja.operacoes'] }]))).toEqual([])
  })
  it('sujeito com erro de digitação é apontado, com sugestão (uma regra que nunca casa — ou uma negação que não nega — passaria despercebida)', () => {
    const e = erros(papel('x', [{ acoes: ['listar'], sujeitos: ['loja.produtos'] }, { acoes: ['remover'], sujeitos: ['loja.pedid'], negar: true }]))
    expect(e[0]).toContain("/spec/regras/0/sujeitos/0 [sujeito] o sujeito 'loja.produtos' não existe"); expect(e[0]).toContain("quis dizer 'loja.produto'?")
    expect(e[1]).toContain("quis dizer 'loja.pedido'?")
  })
  it('ação que não existe naquele sujeito, campo inexistente em `campos` e em `onde`', () => {
    const e = erros(papel('x', [{ acoes: ['remover'], sujeitos: ['loja.produto'] }, { acoes: ['listar'], sujeitos: ['loja.pedido'], campos: ['totall'], onde: { dono: '$usuario' } }, { acoes: ['atualizar'], sujeitos: ['loja.produto'] }]))
    expect(e.some((x) => x.startsWith("/spec/regras/0/acoes/0 [acao] a ação 'remover' não existe em loja.produto (ações: criar, listar, obter)"))).toBe(true)
    expect(e.some((x) => x.startsWith("/spec/regras/1/campos/0 [campo] o campo 'totall'"))).toBe(true)
    expect(e.some((x) => x.startsWith("/spec/regras/1/onde [campo] a condição usa o campo 'dono'"))).toBe(true)
    expect(e.some((x) => x.startsWith('/spec/regras/2/acoes/0'))).toBe(true) // o crud do produto não tem atualizar
  })
  it('`all` e `manage` valem sem catálogo; regra que agrupa sujeitos só exige a ação em UM deles', () => {
    expect(erros(papel('a', [{ acoes: ['manage'], sujeitos: ['all'] }, { acoes: ['criar'], sujeitos: ['loja.produto', 'loja.pedido'] }]))).toEqual([])
  })
  it('herda: papel inexistente é referência quebrada; existente passa', () => {
    const r = reg(); r.registra(papel('leitor', [{ acoes: ['listar'], sujeitos: ['all'] }]) as never)
    expect(confere(r, r.registra(papel('v', [], { herda: ['leitor'] }) as never))).toEqual([])
    expect(confere(r, r.registra(papel('w', [], { herda: ['fantasma'] }) as never)).map((e) => e.caminho)).toEqual(['/spec/herda/0'])
  })
})
