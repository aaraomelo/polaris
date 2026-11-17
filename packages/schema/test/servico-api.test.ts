import Ajv from 'ajv'
import addFormats from 'ajv-formats'
import { describe, expect, it } from 'vitest'
import { emite, esquemaDeEntidade, esquemaDoCampo, rotasDe, type No } from '../src/index'

const svc = (spec: object, id = 'loja'): No => ({ kind: 'servico', id, versao: '1.2.0', estatuto: 'publicado', spec: { operacoes: {}, ...spec } }) as never
const LOJA = svc({
  entidades: {
    produto: { campos: { nome: { tipo: 'texto', obrigatorio: true }, preco: { tipo: 'dinheiro', obrigatorio: true }, ativo: { tipo: 'booleano', padrao: true }, tags: { tipo: 'texto', lista: true }, extra: { tipo: 'json' } }, crud: { caminho: '/produtos' } },
    pedido: { campos: { total: { tipo: 'dinheiro', obrigatorio: true } }, crud: { caminho: '/pedidos', operacoes: ['listar', 'obter', 'criar'], permissao: 'vendas' } },
    vitrine: { campos: { titulo: { tipo: 'texto' } }, crud: { caminho: '/vitrines', operacoes: ['listar'], permissao: 'publica' } },
  },
  operacoes: {
    buscar: { metodo: 'GET', caminho: '/produtos/busca', entrada: { termo: { tipo: 'texto', obrigatorio: true } }, saida: 'produto', lista: true, permissao: 'publica' },
    cancelar: { metodo: 'POST', caminho: '/pedidos/:id/cancelar', entrada: { id: { tipo: 'uuid', obrigatorio: true }, motivo: { tipo: 'texto' } }, saida: 'pedido', permissao: 'vendas', publica: ['pedidoCancelado'] },
  },
  consome: ['pagamentoConfirmado'],
})
const doc = JSON.parse(emite(LOJA, 'openapi'))

describe('rotasDe: as rotas do serviço, derivadas uma vez', () => {
  it('operações declaradas + CRUD, com ids, caminhos e métodos, em ordem estável (caminho, método)', () => {
    expect(rotasDe(LOJA).map((r) => `${r.metodo} ${r.caminho} ${r.id}`)).toEqual([
      'get /pedidos listarPedido', 'post /pedidos criarPedido', 'get /pedidos/{id} obterPedido', 'post /pedidos/{id}/cancelar cancelar',
      'get /produtos listarProduto', 'post /produtos criarProduto', 'get /produtos/busca buscar',
      'delete /produtos/{id} removerProduto', 'get /produtos/{id} obterProduto', 'patch /produtos/{id} atualizarProduto', 'get /vitrines listarVitrine',
    ])
  })
  it('permissão: padrão e qualquer nome desconhecido = `protegida` (fail-closed); só publica/autenticada abrem', () => {
    const p = Object.fromEntries(rotasDe(LOJA).map((r) => [r.id, r.permissao]))
    expect(p).toMatchObject({ listarProduto: 'protegida', criarPedido: 'protegida', cancelar: 'protegida', buscar: 'publica', listarVitrine: 'publica' })
  })
  it('cada rota diz (acao, sujeito) para as regras de acesso: CRUD → (operação, servico.entidade); operação → (id, servico.saida ou servico.operacoes)', () => {
    const r = Object.fromEntries(rotasDe(LOJA).map((x) => [x.id, `${x.acao} ${x.sujeito}`]))
    expect(r).toMatchObject({ listarProduto: 'listar loja.produto', criarPedido: 'criar loja.pedido', removerProduto: 'remover loja.produto', cancelar: 'cancelar loja.pedido', buscar: 'buscar loja.produto' })
  })
  it('caminhos Fastify (:id) e OpenAPI ({id}); parâmetros de caminho saem da entrada; filtros do listar são só campos simples', () => {
    const r = Object.fromEntries(rotasDe(LOJA).map((x) => [x.id, x]))
    expect(r.cancelar).toMatchObject({ caminhoFastify: '/pedidos/:id/cancelar', params: ['id'], publica: ['pedidoCancelado'] }); expect(Object.keys(r.cancelar!.entrada)).toEqual(['motivo'])
    expect(Object.keys(r.listarProduto!.entrada).sort()).toEqual(['ativo', 'nome', 'preco']) // sem lista nem json
  })
  it('erros: operação duplicada com o crud, parâmetro sem entrada, saída inexistente', () => {
    expect(() => rotasDe(svc({ entidades: { a: { campos: {}, crud: { caminho: '/as' } } }, operacoes: { listarA: { metodo: 'GET', caminho: '/x', saida: 'a' } } }))).toThrow(/duplicada 'listarA'/)
    expect(() => rotasDe(svc({ entidades: { a: { campos: {} } }, operacoes: { f: { metodo: 'GET', caminho: '/a/:id', saida: 'a' } } }))).toThrow(/usa :id.*não declara/)
    expect(() => rotasDe(svc({ entidades: { a: { campos: {} } }, operacoes: { f: { metodo: 'GET', caminho: '/a', saida: 'fantasma' } } }))).toThrow(/inexistente 'fantasma'/)
  })
})

describe('esquemas JSON dos campos (a MESMA fonte do OpenAPI e da validação em runtime)', () => {
  const ajv = addFormats(new Ajv({ strict: false }))
  const aceita = (c: object, v: unknown) => ajv.compile(esquemaDoCampo(c as never))(v)
  it('dinheiro é texto decimal exato: "49.90" passa; número, 4+ casas e lixo não', () => {
    for (const v of ['49.90', '0', '-0.5', '123456789012345.1234']) expect(aceita({ tipo: 'dinheiro' }, v), String(v)).toBe(true)
    for (const v of [49.9, '49.90000', '1,5', '', 'R$ 1', '1234567890123456.0']) expect(aceita({ tipo: 'dinheiro' }, v), String(v)).toBe(false)
  })
  it('uuid, data, dataHora, inteiro, listas', () => {
    expect(aceita({ tipo: 'uuid' }, '11111111-1111-1111-1111-111111111111')).toBe(true); expect(aceita({ tipo: 'uuid' }, 'x')).toBe(false)
    expect(aceita({ tipo: 'data' }, '2026-02-30') || aceita({ tipo: 'data' }, '2026-13-01')).toBe(false); expect(aceita({ tipo: 'dataHora' }, '2026-01-01T10:00:00Z')).toBe(true)
    expect(aceita({ tipo: 'inteiro' }, 1.5)).toBe(false); expect(aceita({ tipo: 'texto', lista: true }, ['a', 'b'])).toBe(true); expect(aceita({ tipo: 'texto', lista: true }, 'a')).toBe(false)
  })
  it('entidade: saída traz id e auditoria e NUNCA tenant_id; entrada exige só obrigatórios sem padrão; alteração não exige nada; nada de campo extra', () => {
    const e = (LOJA.spec as any).entidades.produto
    const s = esquemaDeEntidade(e, 'saida') as any, i = esquemaDeEntidade(e, 'entrada') as any, a = esquemaDeEntidade(e, 'alteracao') as any
    expect(Object.keys(s.properties)).toEqual(expect.arrayContaining(['id', 'criadoEm', 'atualizadoEm', 'nome'])); expect(JSON.stringify([s, i, a])).not.toMatch(/tenant_?id/i)
    expect(i.required).toEqual(['nome', 'preco']); expect(a.required).toBeUndefined()
    for (const x of [s, i, a]) expect(x.additionalProperties).toBe(false)
  })
})

describe('OpenAPI 3.1 gerado', () => {
  it('estrutura: versão, info, segurança bearer, todos os caminhos e operationIds únicos', () => {
    expect(doc.openapi).toBe('3.1.0'); expect(doc.info).toMatchObject({ title: 'Serviço loja', version: '1.2.0' }); expect(doc.components.securitySchemes.bearer).toMatchObject({ type: 'http', scheme: 'bearer' })
    const ids = Object.values<any>(doc.paths).flatMap((p) => Object.values<any>(p).map((o) => o.operationId))
    expect(new Set(ids).size).toBe(ids.length); expect(ids.length).toBe(rotasDe(LOJA).length)
    expect(Object.keys(doc.paths)).toEqual(['/pedidos', '/pedidos/{id}', '/pedidos/{id}/cancelar', '/produtos', '/produtos/busca', '/produtos/{id}', '/vitrines'])
  })
  it('todo $ref aponta para um schema que existe; todo {param} do caminho está declarado', () => {
    const refs = [...JSON.stringify(doc).matchAll(/"\$ref":"#\/components\/schemas\/([A-Za-z]+)"/g)].map((m) => m[1]!)
    expect(refs.length).toBeGreaterThan(10); for (const r of refs) expect(doc.components.schemas[r], r).toBeDefined()
    for (const [caminho, ops] of Object.entries<any>(doc.paths)) for (const op of Object.values<any>(ops)) for (const p of [...caminho.matchAll(/\{(\w+)\}/g)].map((m) => m[1])) expect(op.parameters.some((x: any) => x.in === 'path' && x.name === p), `${caminho} ${p}`).toBe(true)
  })
  it('lista ganha pagina/limite (limite ≤ 100); GET leva filtros em query e POST leva corpo; DELETE devolve 204', () => {
    const lp = doc.paths['/produtos'].get
    expect(lp.parameters.filter((p: any) => ['pagina', 'limite'].includes(p.name)).map((p: any) => p.schema.maximum)).toContain(100)
    expect(lp.responses['200'].content['application/json'].schema).toEqual({ type: 'array', items: { $ref: '#/components/schemas/Produto' } })
    expect(doc.paths['/produtos'].post.responses['201']).toBeDefined(); expect(doc.paths['/produtos'].post.requestBody.content['application/json'].schema).toEqual({ $ref: '#/components/schemas/ProdutoEntrada' })
    expect(doc.paths['/produtos/{id}'].patch.requestBody.content['application/json'].schema).toEqual({ $ref: '#/components/schemas/ProdutoAlteracao' })
    expect(Object.keys(doc.paths['/produtos/{id}'].delete.responses)).toContain('204')
  })
  it('segurança: pública sem `security` e sem 401/403; as demais exigem bearer e declaram a permissão e os eventos', () => {
    expect(doc.paths['/vitrines'].get.security).toEqual([]); expect(doc.paths['/vitrines'].get.responses['401']).toBeUndefined()
    const c = doc.paths['/pedidos/{id}/cancelar'].post
    expect(c.security).toEqual([{ bearer: [] }]); expect(c.responses['401']).toBeDefined(); expect(c['x-acesso']).toEqual({ modo: 'protegida', acao: 'cancelar', sujeito: 'loja.pedido' }); expect(c['x-publica']).toEqual(['pedidoCancelado'])
    expect(doc['x-consome']).toEqual(['pagamentoConfirmado'])
  })
  it('determinístico e sem tenant em lugar nenhum', () => {
    expect(emite(LOJA, 'openapi')).toBe(emite(LOJA, 'openapi')); expect(JSON.stringify(doc)).not.toMatch(/tenant_?id/i)
  })
})
