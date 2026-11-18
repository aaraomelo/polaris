import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { A, B, criaAmbiente, type Ambiente } from './ambiente'

// Formulários no gateway: o servidor valida de novo (é a validação que vale), chama a operação do serviço, mapeia erros por campo e não duplica o envio.
let e: Ambiente
const form = (id: string, spec: Record<string, unknown>, extra: Record<string, unknown> = {}) => ({ kind: 'formulario', id, versao: '1.0.0', estatuto: 'publicado', spec, ...extra })
const campos = [
  { nome: 'nome', tipo: 'texto', rotulo: 'Nome', obrigatorio: true, validacao: { tamanhoMinimo: 3 }, mensagens: { obrigatorio: 'Diga o nome do produto.' } },
  { nome: 'preco', tipo: 'texto', rotulo: 'Preço', obrigatorio: true },
]
const envio = { servico: 'loja', operacao: 'criarProduto', args: { nome: 'valores.nome', preco: 'valores.preco' }, sucesso: { mensagem: { 'pt-BR': 'Produto criado!', en: 'Product created!' }, limpar: true, acoes: [{ acao: 'navegar', para: '/produtos' }] } }
let vend: string, vendB: string
beforeAll(async () => {
  e = await criaAmbiente({}); await e.semear()
  e.reg.registra(form('novo-produto', { titulo: 'Novo produto', campos, envio, mensagens: { envio: 'Não foi possível salvar o produto.' } }, { tenantId: A }) as never)
  e.reg.registra(form('so-valida', { campos: [{ nome: 'a', tipo: 'texto', obrigatorio: true }] }) as never)
  e.reg.registra(form('dois-passos', { campos: [{ nome: 'nome', tipo: 'texto', obrigatorio: true }, { nome: 'preco', tipo: 'texto', obrigatorio: true }], passos: [{ id: 'p1', titulo: 'Um', campos: ['nome'] }, { id: 'p2', titulo: 'Dois', campos: ['preco'] }], envio }, { tenantId: A }) as never)
  vend = await e.token('ana', A, ['vendedor']); vendB = await e.token('bia', B, ['vendedor'])
})
afterAll(async () => { await e.fim() })
const post = (id: string, corpo: unknown, tok: string | null = vend, headers: Record<string, string> = {}) => e.req('POST', `/bff/formularios/${id}`, { tok, corpo, headers, host: 'a.loja.test' })
const produtos = async () => (e.json(await e.req('GET', '/api/loja/produtos', { tok: vend })) as Array<{ nome: string }>).map((p) => p.nome)

describe('formulários no gateway', () => {
  it('GET entrega a definição; formulário de outro tenant é indistinguível de inexistente', async () => {
    const r = await e.req('GET', '/bff/formularios/novo-produto', { host: 'a.loja.test' }); expect(r.statusCode).toBe(200); expect(e.json(r)).toMatchObject({ id: 'novo-produto', spec: { titulo: 'Novo produto' } })
    expect((await e.req('GET', '/bff/formularios/novo-produto', { host: 'b.loja.test' })).statusCode).toBe(404)
    expect((await e.req('GET', '/bff/formularios/nao-existe', { host: 'a.loja.test' })).statusCode).toBe(404); expect((await e.req('GET', '/bff/formularios/..%2Fx', { host: 'a.loja.test' })).statusCode).toBe(404)
    expect((await e.req('GET', '/bff/formularios/so-valida', { host: 'b.loja.test' })).statusCode).toBe(200) // core: vale para todos
  })
  it('valida no servidor: 422 com erros por campo, mensagem do autor e idioma pedido', async () => {
    const r = await post('novo-produto', { valores: { nome: 'ab' } }); expect(r.statusCode).toBe(422)
    expect(e.json(r)).toMatchObject({ erro: { codigo: 'formulario_invalido' }, erros: [{ campo: 'nome', regra: 'tamanhoMinimo' }, { campo: 'preco', regra: 'obrigatorio' }] })
    const vazio = e.json(await post('novo-produto', { valores: {} })); expect(vazio.erros[0].mensagem).toBe('Diga o nome do produto.')
    expect(e.json(await post('novo-produto', { valores: { nome: 'abc' }, idioma: 'en' })).erros[0]).toMatchObject({ campo: 'preco', mensagem: 'Preço is required.' })
    expect(e.json(await post('novo-produto', { valores: {} }, vend, { 'accept-language': 'en' })).erro.mensagem).toBe('Fix the highlighted fields.')
  })
  it('válido: chama o serviço com os valores NORMALIZADOS, descarta o que não é do formulário e devolve mensagem/ações de sucesso', async () => {
    const antes = await produtos()
    const r = await post('novo-produto', { valores: { nome: '  Pão   francês ', preco: '4.50', admin: true, tenantId: B } }); expect(r.statusCode, r.body).toBe(200)
    const j = e.json(r); expect(j).toMatchObject({ ok: true, resultado: { nome: 'Pão   francês', preco: '4.5000' }, sucesso: { mensagem: 'Produto criado!', limpar: true, acoes: [{ acao: 'navegar', para: '/produtos' }] } })
    expect((await produtos()).length).toBe(antes.length + 1)
    expect(e.json(await post('novo-produto', { valores: { nome: 'Bolo', preco: '9.00' }, idioma: 'en' })).sucesso.mensagem).toBe('Product created!')
    // o produto foi criado no tenant do TOKEN (A), nunca no que o corpo pediu
    expect(e.json(await e.req('GET', '/api/loja/produtos', { tok: vendB, host: 'b.loja.test' })).map((p: { nome: string }) => p.nome)).not.toContain('Bolo')
  })
  it('chave de idempotência: o duplo clique devolve o mesmo resultado e cria UM só registro; chave mal formada é 400; falha não fica em cache', async () => {
    const antes = (await produtos()).length, h = { 'idempotency-key': 'chave-unica-0001' }
    const [x, y] = await Promise.all([post('novo-produto', { valores: { nome: 'Dobrado', preco: '1.00' } }, vend, h), post('novo-produto', { valores: { nome: 'Dobrado', preco: '1.00' } }, vend, h)])
    expect([x.statusCode, y.statusCode]).toEqual([200, 200]); expect(e.json(x).resultado.id).toBe(e.json(y).resultado.id); expect([x.headers['idempotent-replay'], y.headers['idempotent-replay']].filter(Boolean)).toEqual(['true'])
    expect((await produtos()).length).toBe(antes + 1)
    const outra = await post('novo-produto', { valores: { nome: 'Dobrado', preco: '1.00' } }, vend, { 'idempotency-key': 'chave-unica-0002' }); expect(outra.statusCode).toBe(200); expect((await produtos()).length).toBe(antes + 2)
    expect((await post('novo-produto', { valores: { nome: 'x1x', preco: '1' } }, vend, { 'idempotency-key': 'curta' })).statusCode).toBe(400)
    // a mesma chave por OUTRO usuário/tenant não colide
    expect((await e.req('POST', '/bff/formularios/so-valida', { tok: vendB, host: 'b.loja.test', corpo: { valores: { a: 'x' } }, headers: { 'idempotency-key': 'chave-unica-0001' } })).statusCode).toBe(200)
  })
  it('erro de validação do SERVIÇO vai para o campo de mesmo nome; erro de permissão e falha do serviço têm mensagem do autor', async () => {
    e.reg.registra(form('preco-livre', { campos: [{ nome: 'nome', tipo: 'texto', obrigatorio: true }, { nome: 'preco', tipo: 'texto' }], envio: { servico: 'loja', operacao: 'criarProduto' } }, { tenantId: A }) as never)
    const r = await post('preco-livre', { valores: { nome: 'Bolo', preco: 'abc' } }); expect(r.statusCode).toBe(422); const j = e.json(r)
    expect(j.erro.codigo).toBe('formulario_invalido'); expect(j.erros[0]).toMatchObject({ campo: 'preco', regra: 'servico' }); expect(typeof j.erros[0].mensagem).toBe('string')
    const anon = await post('novo-produto', { valores: { nome: 'Sem login', preco: '1.00' } }, null); expect(anon.statusCode).toBe(401)
    expect((await e.req('POST', '/bff/formularios/novo-produto', { tok: vend, corpo: { valores: { nome: 'Falha', preco: '1' } }, host: 'a.loja.test', headers: {} })).statusCode).toBe(200)
  })
  it('uma tentativa recusada pelo serviço NÃO fica presa à chave: corrigir e reenviar com a mesma chave funciona', async () => {
    e.reg.registra(form('retenta', { campos: [{ nome: 'nome', tipo: 'texto', obrigatorio: true }, { nome: 'preco', tipo: 'texto' }], envio: { servico: 'loja', operacao: 'criarProduto' } }, { tenantId: A }) as never)
    const h = { 'idempotency-key': 'retentativa-0001' }
    expect((await post('retenta', { valores: { nome: 'Pudim', preco: 'abc' } }, vend, h)).statusCode).toBe(422)
    const ok = await post('retenta', { valores: { nome: 'Pudim', preco: '2.00' } }, vend, h); expect(ok.statusCode, ok.body).toBe(200); expect(ok.headers['idempotent-replay']).toBeUndefined()
  })
  it('sessão do site (cookie): só vale com `x-polaris-form`; sem o cabeçalho ou com cookie vencido o envio segue como visitante', async () => {
    const cookie = `polaris_sessao=${vend}`
    const com = await e.req('POST', '/bff/formularios/novo-produto', { corpo: { valores: { nome: 'Via cookie', preco: '3.00' } }, host: 'a.loja.test', headers: { cookie, 'x-polaris-form': '1' } }); expect(com.statusCode, com.body).toBe(200)
    expect(await produtos()).toContain('Via cookie')
    const sem = await e.req('POST', '/bff/formularios/novo-produto', { corpo: { valores: { nome: 'Sem cabeçalho', preco: '3.00' } }, host: 'a.loja.test', headers: { cookie } }); expect(sem.statusCode).toBe(401) // CSRF: só o cookie não basta
    expect(await produtos()).not.toContain('Sem cabeçalho')
    const vencido = await e.req('POST', '/bff/formularios/novo-produto', { corpo: { valores: { nome: 'Vencido', preco: '3.00' } }, host: 'a.loja.test', headers: { cookie: 'polaris_sessao=aaaa.bbbb.cccc', 'x-polaris-form': '1' } }); expect(vencido.statusCode).toBe(401) // vira visitante; o serviço recusa a operação protegida
    const publico = await e.req('POST', '/bff/formularios/so-valida', { corpo: { valores: { a: 'x' } }, host: 'a.loja.test', headers: { cookie: 'polaris_sessao=aaaa.bbbb.cccc', 'x-polaris-form': '1' } }); expect(publico.statusCode).toBe(200) // formulário sem envio: o cookie ruim não derruba
  })
  it('um passo do assistente valida só os campos do passo e não envia; nomes fora do formulário são recusados', async () => {
    const antes = (await produtos()).length
    expect(e.json(await post('dois-passos', { valores: { nome: 'Passo um' }, campos: ['nome'] }))).toMatchObject({ ok: true, passo: true })
    expect(e.json(await post('dois-passos', { valores: {}, campos: ['nome'] })).erros.map((x: { campo: string }) => x.campo)).toEqual(['nome'])
    expect((await produtos()).length).toBe(antes) // nada foi criado
    expect((await post('dois-passos', { valores: {}, campos: ['hack'] })).statusCode).toBe(400)
  })
  it('formulário sem `envio` devolve os valores validados; corpo malformado é 400; corpo grande é 413', async () => {
    expect(e.json(await post('so-valida', { valores: { a: ' oi ' } }))).toEqual({ ok: true, valores: { a: 'oi' } })
    for (const ruim of [null, {}, { valores: 5 }, { valores: [] }, 'texto']) expect((await post('so-valida', ruim)).statusCode, JSON.stringify(ruim)).toBe(400)
    expect((await post('so-valida', { valores: { a: 'x'.repeat(300_000) } })).statusCode).toBe(413)
  })
})
