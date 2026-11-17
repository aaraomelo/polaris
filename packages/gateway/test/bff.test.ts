import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { A, B, criaAmbiente, type Ambiente } from './ambiente'

let e: Ambiente, clienteId: string
beforeAll(async () => { e = await criaAmbiente(); clienteId = (await e.semear()).clienteId })
afterAll(async () => { await e.fim() })
const upstream = (op: RegExp) => e.clienteLoja.chamadas.filter((c) => op.test(c.caminho)).length

describe('BFF de página: compõe os dados em UMA chamada', () => {
  it('traz todos os dados da página, com status por dado, e cabeçalhos que proíbem cache compartilhado', async () => {
    const r = await e.req('GET', '/bff/paginas/home', { tok: await e.token('ana', A, ['vendedor']) })
    expect(r.statusCode).toBe(200)
    const j = e.json(r)
    expect(j).toMatchObject({ pagina: 'home', versao: '1.0.0', status: { vitrine: 'ok', produtos: 'ok', pedidos: 'ok' } })
    expect(j.dados.vitrine.map((v: any) => v.titulo)).toEqual(['Vitrine A']); expect(j.dados.produtos.map((p: any) => p.nome)).toEqual(['Pão'])
    expect(j.status.novoProduto).toBeUndefined() // `manual` (mutação): não carrega sozinho
    expect(r.headers['cache-control']).toBe('private, no-store'); expect(r.headers.vary).toContain('Authorization')
  })
  it('os dados independentes carregam EM PARALELO (não em fila)', async () => {
    e.clienteLoja.estado.maxVoo = 0; e.clienteLoja.estado.atrasoMs = 40; e.gw.cache.limpa()
    const t0 = Date.now()
    await e.req('GET', '/bff/paginas/home', { tok: await e.token('ana', A, ['vendedor']) })
    e.clienteLoja.estado.atrasoMs = 0
    expect(e.clienteLoja.estado.maxVoo).toBeGreaterThanOrEqual(3); expect(Date.now() - t0).toBeLessThan(40 * 3) // 3 chamadas de 40 ms em < 120 ms
  })
  it('FALHA PARCIAL: o que o chamador não pode ver vira erro daquele dado; a página e os demais dados vêm; o erro é OPACO', async () => {
    const r = await e.req('GET', '/bff/paginas/home', { tok: await e.token('sem', A, []) }) // sem papel nenhum
    expect(r.statusCode).toBe(200)
    const j = e.json(r)
    expect(j.status).toMatchObject({ vitrine: 'ok', produtos: 'erro', pedidos: 'erro' }); expect(j.dados.vitrine.length).toBe(1)
    expect(JSON.stringify(j.erros)).not.toMatch(/proibido|403|permiss|papel/i); expect(j.erros.produtos).toBe('falha ao carregar os dados')
  })
  it('anônimo (tenant pelo host): só o público carrega; host desconhecido é 400', async () => {
    const r = await e.req('GET', '/bff/paginas/home'); expect(r.statusCode).toBe(200)
    expect(e.json(r).status).toMatchObject({ vitrine: 'ok', produtos: 'erro', pedidos: 'erro' })
    expect((await e.req('GET', '/bff/paginas/home', { host: 'estranho.test' })).statusCode).toBe(400)
    expect(e.json(await e.req('GET', '/bff/paginas/home', { host: 'b.loja.test' })).dados.vitrine[0].titulo).toBe('Vitrine B') // o tenant sai do HOST, e o dado é o dele
  })
  it('página inexistente → 404 (e de outro tenant, idêntico)', async () => {
    expect((await e.req('GET', '/bff/paginas/nao-existe', { tok: await e.token('ana', A, ['vendedor']) })).statusCode).toBe(404)
  })
})

describe('parâmetros da página: tipados e fechados', () => {
  const t = () => e.token('ana', A, ['vendedor'])
  it('p.<nome> é tipado pelo `spec.params`; o dado correto chega', async () => {
    const r = await e.req('GET', `/bff/paginas/ficha?p.id=${clienteId}`, { tok: await t() })
    expect(r.statusCode).toBe(200); expect(e.json(r).dados.cliente.nome).toBe('Cliente A')
  })
  it.each([
    ['uuid inválido', '?p.id=nao-e-uuid', 'parametro_invalido'], ['falta o obrigatório', '', 'parametro_invalido'], ['parâmetro não declarado', `?p.id=${'1'.repeat(8)}-1111-1111-1111-111111111111&p.outro=1`, 'parametro_desconhecido'],
    ['chave sem prefixo', '?id=1', 'parametro_desconhecido'], ['prototype pollution', '?p.__proto__=x', 'parametro_desconhecido'], ['constructor', '?q.constructor=x', 'parametro_desconhecido'], ['prefixo errado', '?x.id=1', 'parametro_desconhecido'],
  ])('RECUSA %s (400)', async (_n, qs, codigo) => {
    const r = await e.req('GET', `/bff/paginas/ficha${qs}`, { tok: await t() }); expect(r.statusCode).toBe(400); expect(e.json(r).erro.codigo).toBe(codigo)
  })
  it('consulta (q.) é texto livre e limitado; parâmetros demais e valores enormes são recusados', async () => {
    expect((await e.req('GET', `/bff/paginas/ficha?p.id=${clienteId}&q.busca=pão`, { tok: await t() })).statusCode).toBe(200)
    expect((await e.req('GET', `/bff/paginas/ficha?p.id=${clienteId}&q.x=${'a'.repeat(501)}`, { tok: await t() })).statusCode).toBe(400)
    const muitos = Array.from({ length: 60 }, (_, i) => `q.k${i}=1`).join('&')
    expect((await e.req('GET', `/bff/paginas/ficha?p.id=${clienteId}&${muitos}`, { tok: await t() })).statusCode).toBe(400)
  })
  it('o tenant NÃO se escolhe por cabeçalho nem por query: x-tenant-id é ignorado; ?tenant= é recusado', async () => {
    const r = await e.req('GET', '/bff/paginas/home', { tok: await e.token('ana', A, ['vendedor']), headers: { 'x-tenant-id': B } })
    expect(e.json(r).dados.produtos.map((p: any) => p.nome)).toEqual(['Pão']) // continua o A
    expect((await e.req('GET', `/bff/paginas/home?tenant=${B}`, { tok: await t() })).statusCode).toBe(400)
  })
})

describe('cache: sempre com tenant, e escopado ao usuário quando o dado é protegido', () => {
  const home = async (tok: string | null, host = 'a.loja.test') => e.json(await e.req('GET', '/bff/paginas/home', { tok, host }))
  const reset = () => { e.gw.cache.limpa(); e.clienteLoja.chamadas.length = 0 }
  it('mesmo usuário: a 2ª requisição vem do cache (o serviço não é chamado de novo)', async () => {
    reset(); const ana = await e.token('ana', A, ['vendedor'])
    await home(ana); const antes = e.clienteLoja.chamadas.length
    await home(ana)
    expect(antes).toBe(3); expect(e.clienteLoja.chamadas.length).toBe(3)
  })
  it('dado PÚBLICO é compartilhado entre usuários do tenant; dado PROTEGIDO não: cada usuário busca o seu', async () => {
    reset()
    await home(await e.token('ana', A, ['vendedor'])); await home(await e.token('bia', A, ['vendedor']))
    expect(upstream(/vitrines/)).toBe(1) // público: 1 chamada para os dois
    expect(upstream(/\/produtos/)).toBe(2); expect(upstream(/\/pedidos/)).toBe(2) // protegido: uma por usuário
  })
  it('ISOLAMENTO ENTRE USUÁRIOS (o vazamento clássico): o Bia nunca recebe do cache o que a Ana viu', async () => {
    reset()
    const ana = await e.token('ana', A, ['vendedor']), bia = await e.token('bia', A, ['vendedor'])
    await e.appLoja.inject({ method: 'POST', url: '/pedidos', headers: { authorization: `Bearer ${ana}`, 'content-type': 'application/json' }, payload: JSON.stringify({ criadoPor: 'ana', total: '10' }) })
    const daAna = await home(ana); expect(daAna.dados.pedidos.length).toBe(1)
    const daBia = await home(bia) // se o cache fosse por tenant, a Bia veria o pedido da Ana
    expect(daBia.dados.pedidos).toEqual([])
  })
  it('ISOLAMENTO ENTRE TENANTS: o tenant B nunca recebe o cache do A (nem o público)', async () => {
    reset()
    await home(await e.token('ana', A, ['vendedor']))
    const b = await home(await e.token('beto', B, ['vendedor']), 'b.loja.test')
    expect(b.dados.vitrine.map((v: any) => v.titulo)).toEqual(['Vitrine B']); expect(b.dados.produtos.map((p: any) => p.nome)).toEqual(['Só do B'])
  })
  it('ERRO não é guardado: quando o serviço volta, a próxima requisição busca e funciona', async () => {
    reset(); const ana = await e.token('ana', A, ['vendedor'])
    e.clienteLoja.estado.falha = () => { throw new e.FalhaServico('rede caiu') }
    const ruim = await home(ana); expect(ruim.status.produtos).toBe('erro')
    e.clienteLoja.estado.falha = null
    expect((await home(ana)).status).toMatchObject({ vitrine: 'ok', produtos: 'ok', pedidos: 'ok' })
  })
  it('SINGLE-FLIGHT: 10 requisições simultâneas à mesma coisa fazem UMA chamada ao serviço', async () => {
    reset(); e.clienteLoja.estado.atrasoMs = 30
    const ana = await e.token('ana', A, ['vendedor'])
    await Promise.all(Array.from({ length: 10 }, () => e.req('GET', '/bff/paginas/home', { tok: ana })))
    e.clienteLoja.estado.atrasoMs = 0
    expect(upstream(/vitrines/)).toBe(1); expect(upstream(/\/produtos/)).toBe(1)
  })
  it('invalidar um tenant apaga o dele e só o dele', async () => {
    reset(); const ana = await e.token('ana', A, ['vendedor']), beto = await e.token('beto', B, ['vendedor'])
    await home(ana); await home(beto, 'b.loja.test'); const n0 = e.clienteLoja.chamadas.length
    expect(e.gw.cache.invalidaTenant(A)).toBeGreaterThan(0)
    await home(beto, 'b.loja.test'); expect(e.clienteLoja.chamadas.length).toBe(n0) // o B segue em cache
    await home(ana); expect(e.clienteLoja.chamadas.length).toBeGreaterThan(n0) // o A recarregou
  })
  it('as consultas ao cache viram métrica (hit/miss)', async () => {
    const m = e.obsGw.metricas.texto()
    expect(m).toMatch(/gateway_cache_total\{servico="gateway",resultado="hit"\} [1-9]/); expect(m).toMatch(/gateway_cache_total\{servico="gateway",resultado="miss"\} [1-9]/)
  })
})

describe('/bff/executar: ações (mutações) pelo mesmo pipeline', () => {
  const exec = (tok: string | null, corpo: unknown) => e.req('POST', '/bff/executar', { tok, corpo })
  it('cria com argumentos tipados; DINHEIRO chega ao serviço como texto exato (não vira número)', async () => {
    const r = await exec(await e.token('ana', A, ['vendedor']), { pagina: 'home', dados: 'novoProduto', args: { nome: 'Bolo', preco: '12.50' } })
    expect(r.statusCode).toBe(200); expect(e.json(r).valor).toMatchObject({ nome: 'Bolo', preco: '12.5000' })
    expect(e.clienteLoja.chamadas.at(-1)!.corpo).toEqual({ nome: 'Bolo', preco: '12.50' }) // string, como o serviço exige
  })
  it('anônimo → 401; argumentos inválidos → 400; dado inexistente → 404; campo extra no corpo → 400', async () => {
    expect((await exec(null, { pagina: 'home', dados: 'novoProduto', args: { nome: 'x', preco: '1' } })).statusCode).toBe(401)
    const ana = await e.token('ana', A, ['vendedor'])
    expect((await exec(ana, { pagina: 'home', dados: 'novoProduto', args: { nome: 'x', preco: 'barato' } })).statusCode).toBe(400)
    expect((await exec(ana, { pagina: 'home', dados: 'novoProduto', args: { preco: '1' } })).statusCode).toBe(400) // falta o nome
    expect((await exec(ana, { pagina: 'home', dados: 'naoexiste' })).statusCode).toBe(404)
    expect((await exec(ana, { pagina: 'home', dados: 'novoProduto', args: { nome: 'x', preco: '1' }, tenantId: B })).statusCode).toBe(400)
  })
  it('o 4xx do SERVIÇO volta como 4xx (um 403 não pode virar 502)', async () => {
    const r = await exec(await e.token('sem', A, []), { pagina: 'home', dados: 'novoProduto', args: { nome: 'x', preco: '1' } })
    expect(r.statusCode).toBe(403); expect(e.json(r).erro.codigo).toBe('proibido')
  })
  it('estado enorme → 413', async () => {
    const r = await exec(await e.token('ana', A, ['vendedor']), { pagina: 'home', dados: 'novoProduto', args: { nome: 'x', preco: '1' }, estado: { lixo: 'a'.repeat(60 * 1024) } })
    expect(r.statusCode).toBe(413)
  })
})

describe('SSRF e o que acompanha a chamada ao serviço', () => {
  it('fonte `http` NÃO tem provedor: nada sai do gateway (nenhum fetch), o dado é erro', async () => {
    const original = globalThis.fetch; let chamou = 0
    globalThis.fetch = (async () => { chamou++; return new Response('x') }) as never
    try {
      const r = await e.req('GET', '/bff/paginas/ext', { tok: await e.token('ana', A, ['vendedor']) })
      expect(e.json(r).status.externo).toBe('erro'); expect(chamou).toBe(0)
    } finally { globalThis.fetch = original }
  })
  it('só uma LISTA FECHADA de cabeçalhos segue: authorization, x-request-id, traceparent (do gateway), x-forwarded-host; cookie, x-tenant-id, host e x-forwarded-for NÃO', async () => {
    e.clienteLoja.chamadas.length = 0; e.gw.cache.limpa()
    await e.req('GET', '/bff/paginas/home', { tok: await e.token('ana', A, ['vendedor']), headers: { cookie: 'sid=segredo', 'x-tenant-id': B, 'x-forwarded-for': '6.6.6.6', 'x-admin': '1', 'x-request-id': 'req-de-teste-1' } })
    const h = e.clienteLoja.chamadas[0]!.headers
    expect(Object.keys(h).sort()).toEqual(['accept', 'authorization', 'traceparent', 'x-forwarded-host', 'x-request-id'].filter((k) => k !== 'accept').sort())
    expect(h['x-request-id']).toBe('req-de-teste-1'); expect(h['x-forwarded-host']).toBe('a.loja.test'); expect(h.traceparent).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/)
  })
  it('o destino é fixo: a operação só pode ser uma rota DO schema do serviço (nada de contrabandear caminho ou argumento)', async () => {
    const { criaChamador } = await import('../src/index')
    const chamar = criaChamador(e.servicos)
    const ctx = { requisicaoId: 'x', authorization: 'Bearer x' }
    await expect(chamar('loja', 'admin/../secreto', {}, ctx)).rejects.toThrow('operação desconhecida')
    await expect(chamar('outro', 'listarProduto', {}, ctx)).rejects.toThrow('operação desconhecida')
    await expect(chamar('loja', 'listarProduto', { naoExiste: 1 }, ctx)).rejects.toThrow("argumento 'naoExiste' não existe")
    await expect(chamar('loja', 'obterCliente', { id: '../../x' }, ctx)).rejects.toThrow() // o id vira segmento CODIFICADO; o caminho montado é validado
    expect(e.clienteLoja.chamadas.every((c) => !c.caminho.includes('..'))).toBe(true)
  })
})
