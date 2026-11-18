process.env.POLARIS_LOG_NIVEL = 'silencio'
import { vi } from 'vitest'
vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 })
import { PGlite } from '@electric-sql/pglite'
import { criaAutenticadorJwt } from '@polaris/acesso'
import { Registry, emite } from '@polaris/schema'
import { contextoPorJwt, criaServico, dbDePglite, regrasDoRegistry } from '@polaris/servico'
import { SignJWT, generateKeyPair, type KeyLike } from 'jose'
import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { compara, nosDoPack, normaliza, operacoesCatalogo, resolvePreco, type Candidato } from '../src/index'

const A = '11111111-1111-1111-1111-111111111111', B = '22222222-2222-2222-2222-222222222222'
const ISS = 'https://id.teste', AUD = 'polaris'

describe('dinheiro exato', () => {
  it('normaliza e compara sem float', () => {
    expect(normaliza('49.9000')).toBe('49.90'); expect(normaliza('5')).toBe('5.00'); expect(normaliza('0.1234')).toBe('0.1234'); expect(normaliza('0.10')).toBe('0.10'); expect(normaliza('-3.5')).toBe('-3.50')
    expect(compara('0.10', '0.1000')).toBe(0); expect(compara('0.1', '0.2')).toBe(-1); expect(compara('1000000000000.0001', '1000000000000.0000')).toBe(1)
    for (const x of ['1e3', '1,5', '', 'abc', '1.23456', '--1']) expect(() => normaliza(x), x).toThrow('dinheiro inválido')
  })
})

describe('resolvePreco: regra pura', () => {
  const c = (o: Partial<Candidato> & { preco: string }): Candidato => ({ tabelaPrecoId: 't1', itemId: 'i1', varianteId: null, qtdMinima: null, ...o })
  const base = { produto: '100.00', variante: null }
  it('sem tabela: base; variante sem preço herda o do produto; variante com preço usa o dela', () => {
    expect(resolvePreco(base, [])).toEqual({ preco: '100.00', origem: 'base', tabelaPrecoId: null })
    expect(resolvePreco({ produto: '100.00', variante: '120.5' }, []).preco).toBe('120.50')
  })
  it('tabela aplicável substitui a base (até quando é MAIS CARA: é decisão da tabela)', () => {
    expect(resolvePreco(base, [c({ preco: '80' })])).toMatchObject({ preco: '80.00', origem: 'tabela', tabelaPrecoId: 't1' })
    expect(resolvePreco(base, [c({ preco: '130' })]).preco).toBe('130.00')
  })
  it('precedência: item da variante > item do produto; maior quantidade mínima; menor preço; desempate estável por id', () => {
    expect(resolvePreco(base, [c({ preco: '50', itemId: 'a' }), c({ preco: '90', varianteId: 'v', itemId: 'b' })]).preco).toBe('90.00')
    expect(resolvePreco(base, [c({ preco: '90', qtdMinima: 1, itemId: 'a' }), c({ preco: '85', qtdMinima: 10, itemId: 'b' })]).preco).toBe('85.00')
    expect(resolvePreco(base, [c({ preco: '90', itemId: 'a' }), c({ preco: '85', itemId: 'b' })]).preco).toBe('85.00')
    const x = c({ preco: '70', tabelaPrecoId: 'tA', itemId: '1' }), y = c({ preco: '70', tabelaPrecoId: 'tB', itemId: '2' })
    expect(resolvePreco(base, [y, x]).tabelaPrecoId).toBe('tA'); expect(resolvePreco(base, [x, y]).tabelaPrecoId).toBe('tA')
  })
  it('FUZZ: igual a um oráculo ingênuo (filtro + mínimo por chave) e independente da ordem da entrada', () => {
    let s = 12345; const rnd = () => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff }
    for (let n = 0; n < 2000; n++) {
      const cs: Candidato[] = Array.from({ length: Math.floor(rnd() * 6) }, (_, i) => ({ tabelaPrecoId: `t${Math.floor(rnd() * 3)}`, itemId: `i${i}`, varianteId: rnd() < 0.4 ? 'v' : null, preco: (rnd() * 200).toFixed(2), qtdMinima: rnd() < 0.5 ? null : Math.floor(rnd() * 20) }))
      const r1 = resolvePreco(base, cs), r2 = resolvePreco(base, [...cs].reverse())
      expect(r2).toEqual(r1)
      if (!cs.length) { expect(r1.origem).toBe('base'); continue }
      let melhor = cs[0]!
      for (const k of cs.slice(1)) {
        const ganha = (Number(k.varianteId !== null) - Number(melhor.varianteId !== null)) || ((k.qtdMinima ?? 0) - (melhor.qtdMinima ?? 0)) || -compara(k.preco, melhor.preco) || (k.tabelaPrecoId < melhor.tabelaPrecoId ? 1 : k.tabelaPrecoId > melhor.tabelaPrecoId ? -1 : k.itemId < melhor.itemId ? 1 : -1)
        if (ganha > 0) melhor = k
      }
      expect(r1.preco).toBe(normaliza(melhor.preco)); expect(r1.tabelaPrecoId).toBe(melhor.tabelaPrecoId)
    }
  })
})

describe('pack Catálogo: nós válidos', () => {
  it('todos os nós do pack registram, referências resolvem e o SQL e o OpenAPI emitem', () => {
    const reg = new Registry(); for (const n of nosDoPack('catalogo')) reg.registra(n)
    expect(reg.verificaTudo().filter((x) => x.erros.length)).toEqual([])
    const no = reg.resolve('servico', 'catalogo')!.no
    const sql = emite(no, 'sql'); expect(sql).toContain('CREATE UNIQUE INDEX IF NOT EXISTS "produto_sku_uidx"'); expect(sql).toContain('FOREIGN KEY ("tenant_id", "pai_id")')
    expect(() => emite(no, 'openapi')).not.toThrow()
  })
})

let pg: PGlite, app: FastifyInstance, priv: KeyLike
const reg = new Registry(); for (const n of nosDoPack('catalogo')) reg.registra(n)
const no = reg.resolve('servico', 'catalogo')!.no
const token = (papeis: string[], tid = A) => new SignJWT({ tid, papeis }).setProtectedHeader({ alg: 'RS256' }).setSubject('u1').setIssuer(ISS).setAudience(AUD).setExpirationTime('5m').sign(priv)
const req = async (tok: string, m: string, url: string, corpo?: unknown) => { const r = await app.inject({ method: m as 'GET', url, headers: { authorization: `Bearer ${tok}`, ...(corpo !== undefined ? { 'content-type': 'application/json' } : {}) }, ...(corpo !== undefined ? { payload: JSON.stringify(corpo) } : {}) }); return { status: r.statusCode, corpo: r.body ? JSON.parse(r.body) : null } }

describe('pack Catálogo ponta a ponta (Fastify + Postgres real + RLS + papéis)', () => {
  let g: string, v: string, un = '', prod = '', varP = '', varSem = ''
  beforeAll(async () => {
    const k = await generateKeyPair('RS256'); priv = k.privateKey
    pg = new PGlite(); await pg.exec(`CREATE ROLE migrador NOLOGIN BYPASSRLS; CREATE ROLE app NOLOGIN; GRANT CREATE ON DATABASE postgres TO migrador; SET ROLE migrador;`)
    await pg.exec(emite(no, 'sql')); await pg.exec(`RESET ROLE; GRANT USAGE ON SCHEMA catalogo TO app; GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA catalogo TO app; SET ROLE app;`)
    app = criaServico(no, { db: dbDePglite(pg), acesso: regrasDoRegistry(reg), contexto: contextoPorJwt(criaAutenticadorJwt({ emissor: ISS, audiencia: AUD, chave: { publica: k.publicKey } })), operacoes: operacoesCatalogo(no) })
    await app.ready(); g = await token(['catalogo.gerente']); v = await token(['catalogo.vendedor'])
  })
  afterAll(async () => { await app.close(); await pg.close() })

  it('o gerente monta o catálogo: unidade, marca, categoria em árvore, produto, variantes, imagem', async () => {
    un = (await req(g, 'POST', '/unidades', { codigo: 'UN', descricao: 'Unidade' })).corpo.id
    const marca = (await req(g, 'POST', '/marcas', { nome: 'Polaris' })).corpo.id
    const raiz = (await req(g, 'POST', '/categorias', { nome: 'Roupas' })).corpo.id
    const filha = await req(g, 'POST', '/categorias', { nome: 'Camisetas', paiId: raiz }); expect(filha.status).toBe(201); expect(filha.corpo.paiId).toBe(raiz)
    const p = await req(g, 'POST', '/produtos', { sku: 'CAM-001', nome: 'Camiseta', unidadeId: un, marcaId: marca, categoriaId: filha.corpo.id, preco: '100.00', custo: '40.00', temVariantes: true })
    expect(p.status).toBe(201); prod = p.corpo.id; expect(p.corpo.preco).toBe('100.0000')
    varP = (await req(g, 'POST', '/variantes', { produtoId: prod, sku: 'CAM-001-P', opcao0: 'azul', opcao1: 'P', preco: '120.00' })).corpo.id
    varSem = (await req(g, 'POST', '/variantes', { produtoId: prod, sku: 'CAM-001-M', opcao0: 'azul', opcao1: 'M' })).corpo.id
    expect((await req(g, 'POST', '/imagens', { produtoId: prod, url: 'https://cdn/x.jpg' })).status).toBe(201)
  })
  it('SKU único por tenant (409) mas livre em outro tenant; variante com SKU repetido também é 409', async () => {
    expect((await req(g, 'POST', '/produtos', { sku: 'CAM-001', nome: 'Outra', unidadeId: un })).status).toBe(409)
    expect((await req(g, 'POST', '/variantes', { produtoId: prod, sku: 'CAM-001-P' })).status).toBe(409)
    const gB = await token(['catalogo.gerente'], B), unB = (await req(gB, 'POST', '/unidades', { codigo: 'UN', descricao: 'Unidade' })).corpo.id
    expect((await req(gB, 'POST', '/produtos', { sku: 'CAM-001', nome: 'Do B', unidadeId: unB })).status).toBe(201)
  })
  it('referência cruzada entre tenants é recusada (FK composta): B não pode usar a unidade do A', async () => {
    const gB = await token(['catalogo.gerente'], B)
    expect((await req(gB, 'POST', '/produtos', { sku: 'X', nome: 'x', unidadeId: un })).status).toBe(409)
    expect((await req(gB, 'GET', `/produtos/${prod}`)).status).toBe(404)
  })
  it('cotar: variante com preço próprio; variante sem preço herda; produto com variantes exige a variante', async () => {
    const a = await req(v, 'POST', '/cotar', { produtoId: prod, varianteId: varP, quantidade: 1 }); expect(a.status).toBe(200); expect(a.corpo).toMatchObject({ precoUnitario: '120.0000', origem: 'base' })
    expect((await req(v, 'POST', '/cotar', { produtoId: prod, varianteId: varSem, quantidade: 1 })).corpo.precoUnitario).toBe('100.0000')
    const s = await req(v, 'POST', '/cotar', { produtoId: prod, quantidade: 1 }); expect(s.status).toBe(422); expect(s.corpo.erro.codigo).toBe('variante_obrigatoria')
  })
  it('tabelas de preço: vigência, quantidade mínima e a regra de precedência no banco', async () => {
    const atac = (await req(g, 'POST', '/tabelas-preco', { nome: 'Atacado' })).corpo.id
    const velha = (await req(g, 'POST', '/tabelas-preco', { nome: 'Vencida', terminaEm: '2000-01-01' })).corpo.id
    const futura = (await req(g, 'POST', '/tabelas-preco', { nome: 'Futura', iniciaEm: '2999-01-01' })).corpo.id
    const off = (await req(g, 'POST', '/tabelas-preco', { nome: 'Inativa', ativo: false })).corpo.id
    for (const [t, preco, qtdMinima] of [[atac, '90.00', 10], [velha, '1.00', undefined], [futura, '2.00', undefined], [off, '3.00', undefined]] as const)
      expect((await req(g, 'POST', '/itens-tabela-preco', { tabelaPrecoId: t, produtoId: prod, varianteId: varSem, preco, ...(qtdMinima ? { qtdMinima } : {}) })).status).toBe(201)
    expect((await req(v, 'POST', '/cotar', { produtoId: prod, varianteId: varSem, quantidade: 9 })).corpo).toMatchObject({ precoUnitario: '100.0000', origem: 'base' }) // abaixo do mínimo; as outras tabelas não valem
    const c = await req(v, 'POST', '/cotar', { produtoId: prod, varianteId: varSem, quantidade: 10 }); expect(c.corpo).toMatchObject({ precoUnitario: '90.0000', origem: 'tabela', tabelaPrecoId: atac })
    expect((await req(v, 'POST', '/cotar', { produtoId: prod, varianteId: varP, quantidade: 10 })).corpo.origem).toBe('base') // o item é só da variante M
  })
  it('a cotação fica GRAVADA (preço combinado) e é legível; não é editável por API', async () => {
    const c = await req(v, 'POST', '/cotar', { produtoId: prod, varianteId: varSem, quantidade: 10 })
    expect((await req(v, 'GET', `/cotacoes/${c.corpo.id}`)).corpo.precoUnitario).toBe('90.0000')
    expect((await req(g, 'PATCH', `/cotacoes/${c.corpo.id}`, { precoUnitario: '1' })).status).toBe(404) // a rota não existe
    expect((await req(g, 'POST', '/cotacoes', { produtoId: prod, quantidade: 1, precoUnitario: '1', origem: 'base' })).status).toBe(404)
  })
  it('produto inativo, não vendável, inexistente, quantidade inválida', async () => {
    const p = (await req(g, 'POST', '/produtos', { sku: 'INAT', nome: 'i', unidadeId: un, ativo: false })).corpo.id
    expect((await req(v, 'POST', '/cotar', { produtoId: p, quantidade: 1 })).status).toBe(422)
    expect((await req(v, 'POST', '/cotar', { produtoId: '99999999-9999-9999-9999-999999999999', quantidade: 1 })).status).toBe(404)
    for (const q of [0, -1]) expect((await req(v, 'POST', '/cotar', { produtoId: prod, varianteId: varSem, quantidade: q })).status, String(q)).toBe(400)
    expect((await req(v, 'POST', '/cotar', { produtoId: prod, varianteId: varSem })).status).toBe(400)
  })
  it('papéis: o vendedor lê e cota mas NÃO escreve o catálogo; sem papel nada passa; B não cota produto do A', async () => {
    expect((await req(v, 'GET', '/produtos')).status).toBe(200)
    for (const [m, u, b] of [['POST', '/produtos', { sku: 'Z', nome: 'z', unidadeId: un }], ['PATCH', `/produtos/${prod}`, { nome: 'x' }], ['DELETE', `/produtos/${prod}`, undefined]] as const) expect((await req(v, m, u, b)).status, `${m} ${u}`).toBe(403)
    const sem = await token([]); expect((await req(sem, 'GET', '/produtos')).status).toBe(403); expect((await req(sem, 'POST', '/cotar', { produtoId: prod, varianteId: varSem, quantidade: 1 })).status).toBe(403)
    expect((await req(await token(['catalogo.vendedor'], B), 'POST', '/cotar', { produtoId: prod, varianteId: varSem, quantidade: 1 })).status).toBe(404)
  })
  it('dinheiro é texto exato ponta a ponta: número no corpo é recusado', async () => {
    expect((await req(g, 'POST', '/produtos', { sku: 'NUM', nome: 'n', unidadeId: un, preco: 49.9 })).status).toBe(400)
    expect((await req(g, 'POST', '/produtos', { sku: 'EXATO', nome: 'n', unidadeId: un, preco: '0.1' })).corpo.preco).toBe('0.1000')
  })
})
