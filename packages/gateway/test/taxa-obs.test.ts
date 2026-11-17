import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { LimiteTaxa } from '../src/index'
import { A, B, criaAmbiente, type Ambiente } from './ambiente'

describe('LimiteTaxa (balde de fichas)', () => {
  it('permite a rajada, recusa o excesso com tempo de espera, e repõe com o tempo', () => {
    let t = 0; const l = new LimiteTaxa({ capacidade: 3, porSegundo: 1, agora: () => t })
    expect([1, 2, 3].map(() => l.tenta('k').ok)).toEqual([true, true, true])
    expect(l.tenta('k')).toEqual({ ok: false, esperaSeg: 1 })
    t = 1000; expect(l.tenta('k').ok).toBe(true); expect(l.tenta('k').ok).toBe(false)
    t = 60_000; expect(l.tenta('k', 3).ok).toBe(true) // repôs até a capacidade, nunca acima
    expect(l.tenta('k').ok).toBe(false)
  })
  it('chaves independentes; MEMÓRIA LIMITADA: variar a chave não faz o mapa crescer', () => {
    const l = new LimiteTaxa({ capacidade: 1, porSegundo: 0.001, maxChaves: 100 })
    expect(l.tenta('a').ok).toBe(true); expect(l.tenta('a').ok).toBe(false); expect(l.tenta('b').ok).toBe(true)
    for (let i = 0; i < 5000; i++) l.tenta(`ataque-${i}`)
    expect(l.tamanho).toBeLessThanOrEqual(100)
  })
  it('configuração inválida é recusada', () => { expect(() => new LimiteTaxa({ capacidade: 0, porSegundo: 1 })).toThrow(); expect(() => new LimiteTaxa({ capacidade: 1, porSegundo: 0 })).toThrow() })
})

describe('limite de taxa no gateway', () => {
  let e: Ambiente
  beforeAll(async () => { e = await criaAmbiente({ gateway: { limiteTaxa: { capacidade: 5, porSegundo: 0.01 } } }); await e.semear() })
  afterAll(async () => { await e.fim() })
  it('o 6º pedido do MESMO usuário → 429 com Retry-After; outro usuário e outro tenant não são afetados', async () => {
    const ana = await e.token('ana', A, ['vendedor'])
    const codigos: number[] = []; for (let i = 0; i < 7; i++) codigos.push((await e.req('GET', '/bff/paginas/home', { tok: ana })).statusCode)
    expect(codigos).toEqual([200, 200, 200, 200, 200, 429, 429])
    const r = await e.req('GET', '/bff/paginas/home', { tok: ana }); expect(r.headers['retry-after']).toMatch(/^\d+$/); expect(e.json(r).erro.codigo).toBe('muitas_requisicoes')
    expect((await e.req('GET', '/bff/paginas/home', { tok: await e.token('bia', A, ['vendedor']) })).statusCode).toBe(200)
    expect((await e.req('GET', '/bff/paginas/home', { tok: await e.token('ana', B, ['vendedor']), host: 'b.loja.test' })).statusCode).toBe(200) // mesmo `sub`, outro tenant
  })
  it('anônimo é limitado por IP+tenant; a recusa é contada na métrica', async () => {
    const c: number[] = []; for (let i = 0; i < 7; i++) c.push((await e.req('GET', '/bff/paginas/home')).statusCode)
    expect(c.filter((x) => x === 429).length).toBeGreaterThanOrEqual(2)
    expect(e.obsGw.metricas.texto()).toMatch(/gateway_limite_taxa_total\{servico="gateway",escopo="(usuario|anonimo)"\} [1-9]/)
  })
  it('/saude não conta (fora do limite)', async () => { for (let i = 0; i < 20; i++) expect((await e.req('GET', '/saude', { tok: null })).statusCode).toBe(200) })
})

describe('observabilidade do gateway', () => {
  let e: Ambiente
  beforeAll(async () => { e = await criaAmbiente(); await e.semear() })
  afterAll(async () => { await e.fim() })
  it('UM trace do gateway ao serviço: o span do gateway, a chamada ao serviço e o span do SERVIÇO (continuado pelo traceparent) compartilham o traceId', async () => {
    e.spans.limpa(); e.spansGw.limpa()
    await e.req('GET', '/bff/paginas/home', { tok: await e.token('ana', A, ['vendedor']) })
    const srv = e.spansGw.spans.find((s) => s.tipo === 'servidor')!, cham = e.spansGw.spans.find((s) => s.nome === 'servico.chama')!
    expect(srv.nome).toBe('GET /bff/paginas/:id'); expect(cham.traceId).toBe(srv.traceId); expect(cham.paiId).toBe(srv.spanId); expect(cham.tipo).toBe('cliente')
    const doServico = e.spans.spans.filter((s) => s.tipo === 'servidor')
    expect(doServico.length).toBeGreaterThanOrEqual(3); for (const s of doServico) expect(s.traceId).toBe(srv.traceId) // os 3 dados do serviço continuaram o MESMO trace
    expect(e.spans.spans.every((s) => s.traceId === srv.traceId)).toBe(true)
  })
  it('métricas de chamada a serviço por resultado; rota por template; nenhum segredo (token, cookie, query) em log, métrica ou span', async () => {
    e.logsGw.length = 0
    const tok = await e.token('ana', A, ['vendedor'])
    await e.req('GET', '/bff/paginas/home?q.busca=valor-secreto-de-query', { tok, headers: { cookie: 'sid=cookie-secreto', 'x-api-key': 'chave-secreta' } })
    e.clienteLoja.estado.falha = () => { throw new e.FalhaServico('boom') }; await e.req('GET', '/api/loja/produtos', { tok }); e.clienteLoja.estado.falha = null
    await e.req('GET', '/bff/paginas/lixo-aleatorio-1', { tok })
    const m = e.obsGw.metricas.texto()
    expect(m).toMatch(/gateway_chamadas_servico_total\{servico="gateway",servico="loja"/) // (o rótulo `servico` do serviço chamado)
    const tudo = e.logsGw.join('\n') + m + JSON.stringify(e.spansGw.spans)
    expect(m).toContain('rota="/bff/paginas/:id"'); expect(m).not.toContain('lixo-aleatorio')
    for (const s of ['valor-secreto-de-query', 'cookie-secreto', 'chave-secreta', tok.slice(20, 60)]) expect(tudo, s).not.toContain(s)
  })
  it('/metrics do gateway: fechado sem token, aberto com ele', async () => {
    expect((await e.gw.inject({ url: '/metrics' })).statusCode).toBe(401)
    const ok = await e.gw.inject({ url: '/metrics', headers: { authorization: 'Bearer token-de-metricas-16+' } }); expect(ok.statusCode).toBe(200); expect(ok.body).toContain('http_requests_total')
  })
})
