import { describe, expect, it } from 'vitest'
import { Metricas, Tracer, criaLogger, criaObservabilidade, exportadorMemoria, formataTraceparent, parseTraceparent, redige, redigeTexto } from '../src/index'

const JWT = 'eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJhbmEiLCJ0aWQiOiIxMTExIn0.assinaturaassinaturaassinatura'

describe('redação: nada sensível chega ao log nem aos spans', () => {
  it('chaves sensíveis são mascaradas em qualquer profundidade e em listas (senha, token, authorization, cookie, chave, cartão…)', () => {
    const r = redige({ usuario: 'ana', senha: 'x', nested: { Authorization: 'Bearer abc', api_key: 'k', lista: [{ token: 't', ok: 1 }] }, cookie: 'sid=1', numeroCartao: '4111', cvv: '123' }) as Record<string, any>
    expect(r.usuario).toBe('ana'); expect(r.senha).toBe('[REDIGIDO]'); expect(r.nested.Authorization).toBe('[REDIGIDO]'); expect(r.nested.api_key).toBe('[REDIGIDO]'); expect(r.nested.lista[0]).toEqual({ token: '[REDIGIDO]', ok: 1 })
    expect(r.cookie).toBe('[REDIGIDO]'); expect(r.numeroCartao).toBe('[REDIGIDO]'); expect(r.cvv).toBe('[REDIGIDO]')
  })
  it('segredos DENTRO de um texto: JWT, Bearer/Basic, usuário:senha em URL', () => {
    expect(redigeTexto(`falhou com ${JWT} ao chamar`)).toBe('falhou com [JWT] ao chamar')
    expect(redigeTexto('Authorization: Bearer abc.def.ghi-123')).toBe('Authorization: Bearer [REDIGIDO]'); expect(redigeTexto('Basic dXNlcjpwYXNz')).toBe('Basic [REDIGIDO]')
    expect(redigeTexto('postgres://app:s3nha@db:5432/x')).toBe('postgres://[REDIGIDO]@db:5432/x')
    expect(redigeTexto('x'.repeat(5000))).toMatch(/…\[\+3000\]$/)
  })
  it('seguro contra ciclos, funções, bigint, Date inválida, bytes, objetos gigantes e profundos', () => {
    const c: any = { a: 1 }; c.eu = c
    const r = redige({ c, f: () => 1, big: 10n, d: new Date('x'), b: new Uint8Array(8), longa: Array.from({ length: 80 }, (_, i) => i), nan: NaN }) as Record<string, any>
    expect(r.c.eu).toBe('[circular]'); expect(r.f).toBe('[função]'); expect(r.big).toBe('10'); expect(r.d).toBe('data inválida'); expect(r.b).toBe('[bytes 8]'); expect(r.longa.length).toBe(51); expect(r.longa.at(-1)).toBe('[+30 itens]'); expect(r.nan).toBe('NaN')
    let fundo: any = { v: 1 }; for (let i = 0; i < 20; i++) fundo = { fundo }
    expect(JSON.stringify(redige(fundo))).toContain('[profundo demais]')
  })
  it('erros: nome, mensagem e pilha (curta) redigidos, e a causa', () => {
    const e = new Error(`falha em ${JWT}`, { cause: new Error('postgres://u:p@h/db') })
    const r = redige(e) as Record<string, any>
    expect(r.mensagem).toBe('falha em [JWT]'); expect(r.causa.mensagem).toBe('postgres://[REDIGIDO]@h/db'); expect(JSON.stringify(r)).not.toContain('assinaturaassinatura')
  })
})

describe('logger: uma linha JSON por evento', () => {
  const coleta = (o = {}) => { const linhas: string[] = []; return { linhas, log: criaLogger({ saida: (l) => linhas.push(l), relogio: () => new Date('2026-01-01T00:00:00.000Z'), ...o }), json: () => linhas.map((l) => JSON.parse(l)) } }
  it('formato, nível mínimo e logger filho', () => {
    const { log, json, linhas } = coleta({ nivel: 'warn', base: { servico: 'loja' } })
    log.debug('d'); log.info('i'); log.warn('w', { n: 1 }); log.filho({ tenantId: 't1' }).error('e')
    expect(linhas.length).toBe(2); expect(json()[0]).toEqual({ ts: '2026-01-01T00:00:00.000Z', nivel: 'warn', msg: 'w', servico: 'loja', n: 1 }); expect(json()[1]).toMatchObject({ nivel: 'error', tenantId: 't1', servico: 'loja' })
  })
  it('NÃO se forja linha de log: quebra de linha e aspas em qualquer valor viram escape, e campos não sobrescrevem ts/nivel/msg', () => {
    const { log, linhas, json } = coleta()
    log.info('pedido\n{"nivel":"error","msg":"FORJADO"}', { usuario: 'x\r\n{"nivel":"error"}', nivel: 'debug', ts: 'ontem', msg: 'outra' })
    expect(linhas.length).toBe(1); expect(linhas[0]).not.toContain('\n')
    const l = json()[0]; expect(l.nivel).toBe('info'); expect(l.ts).toBe('2026-01-01T00:00:00.000Z'); expect(l.campo_nivel).toBe('debug'); expect(l.campo_msg).toBe('outra'); expect(l.msg).toContain('FORJADO') // só texto
  })
  it('segredos nos campos e na mensagem são redigidos; saída que lança nunca derruba quem loga', () => {
    const { log, linhas } = coleta()
    log.info(`token ${JWT}`, { headers: { authorization: `Bearer ${JWT}` }, senha: 'x', erro: new Error('db postgres://u:p@h/x') })
    expect(linhas[0]).not.toMatch(/eyJ|Bearer eyJ|"x"|u:p@/); expect(linhas[0]).toContain('[JWT]')
    expect(() => criaLogger({ saida: () => { throw new Error('disco cheio') } }).info('x')).not.toThrow()
  })
  it('campo impossível de serializar vira uma linha de falha, não exceção', () => {
    const { log, json } = coleta()
    const bomba = { toJSON() { throw new Error('x') } }
    log.info('ok', { bomba })
    expect(json()[0].msg).toBeTruthy()
  })
})

describe('métricas: formato Prometheus', () => {
  it('contador, gauge e histograma; contador só sobe', () => {
    const m = new Metricas(); const c = m.contador('req_total', 'Requisições', ['rota']), g = m.gauge('em_andamento', 'Em andamento'), h = m.histograma('dur_seconds', 'Duração', ['rota'], [0.1, 1])
    c.inc({ rota: '/a' }); c.inc({ rota: '/a' }, 2); c.inc({ rota: '/a' }, -5); c.inc({ rota: '/a' }, NaN); g.inc(); g.inc(); g.dec()
    ;[0.05, 0.5, 0.5, 3].forEach((v) => h.observa(v, { rota: '/a' }))
    expect(c.valor({ rota: '/a' })).toBe(3); expect(g.valor()).toBe(1)
    const t = m.texto()
    expect(t).toContain('# TYPE req_total counter'); expect(t).toContain('req_total{rota="/a"} 3'); expect(t).toContain('em_andamento 1')
    // cumulativo: 0.05 ≤ 0.1; 0.05,0.5,0.5 ≤ 1; os 4 em +Inf
    expect(t).toContain('dur_seconds_bucket{rota="/a",le="0.1"} 1'); expect(t).toContain('dur_seconds_bucket{rota="/a",le="1"} 3'); expect(t).toContain('dur_seconds_bucket{rota="/a",le="+Inf"} 4')
    expect(t).toContain('dur_seconds_sum{rota="/a"} 4.05'); expect(t).toContain('dur_seconds_count{rota="/a"} 4')
  })
  it('escape de rótulos e ajuda (aspas, barra, quebra de linha não quebram a exposição nem injetam séries)', () => {
    const m = new Metricas(); const c = m.contador('x_total', 'linha1\nlinha2 \\', ['a'])
    c.inc({ a: 'va"l\\or\nX{b="inj"} 99' })
    const t = m.texto()
    expect(t).toContain('# HELP x_total linha1\\nlinha2 \\\\'); expect(t).toContain('x_total{a="va\\"l\\\\or\\nX{b=\\"inj\\"} 99"} 1')
    for (const l of t.trim().split('\n')) expect(l).toMatch(/^(# (HELP|TYPE) |[a-z_:][a-z0-9_:]*(\{.*\})? [-+0-9.eInfNa]+$)/)
  })
  it('CARDINALIDADE: passado o limite, séries novas caem em _outros e são contadas; as existentes seguem', () => {
    const m = new Metricas(5); const c = m.contador('h_total', 'x', ['rota'])
    for (let i = 0; i < 50; i++) c.inc({ rota: `/r${i}` })
    c.inc({ rota: '/r0' }); const t = m.texto()
    expect(t.match(/^h_total\{/gm)!.length).toBe(6) // 5 + _outros
    expect(c.valor({ rota: '/r0' })).toBe(2); expect(t).toContain('h_total{rota="_outros"} 45'); expect(t).toMatch(/metricas_series_descartadas_total 45/)
  })
  it('nomes inválidos, duplicados e buckets ruins são recusados na criação', () => {
    const m = new Metricas()
    expect(() => m.contador('1ruim', 'x')).toThrow('inválido'); expect(() => m.contador('ok', 'x', ['a-b'])).toThrow('rótulo'); expect(() => m.contador('ok', 'x', ['__r'])).toThrow('rótulo')
    m.contador('dup_total', 'x'); expect(() => m.contador('dup_total', 'x')).toThrow('já registrada')
    expect(() => m.histograma('h', 'x', [], [1, 1])).toThrow('crescentes'); expect(() => m.histograma('h2', 'x', ['le'])).toThrow('reservado')
  })
})

describe('W3C Trace Context', () => {
  const T = '0af7651916cd43dd8448eb211c80319c', S = 'b7ad6b7169203331'
  it('aceita o formato válido (amostrado ou não) e ida-e-volta', () => {
    expect(parseTraceparent(`00-${T}-${S}-01`)).toEqual({ traceId: T, spanId: S, amostrado: true }); expect(parseTraceparent(`00-${T}-${S}-00`)?.amostrado).toBe(false)
    expect(formataTraceparent({ traceId: T, spanId: S, amostrado: true })).toBe(`00-${T}-${S}-01`)
    expect(parseTraceparent(`01-${T}-${S}-01-extra-futuro`)?.traceId).toBe(T) // versões futuras podem acrescentar campos
  })
  it.each([
    ['maiúsculas', `00-${T.toUpperCase()}-${S}-01`], ['trace id zerado', `00-${'0'.repeat(32)}-${S}-01`], ['span id zerado', `00-${T}-${'0'.repeat(16)}-01`], ['versão ff', `ff-${T}-${S}-01`],
    ['trace id curto', `00-${T.slice(1)}-${S}-01`], ['span id longo', `00-${T}-${S}0-01`], ['versão 00 com sobra', `00-${T}-${S}-01-x`], ['sem flags', `00-${T}-${S}`], ['lixo', 'abc'], ['vazio', ''],
    ['hex inválido', `00-${'g'.repeat(32)}-${S}-01`], ['injeção de cabeçalho', `00-${T}-${S}-01\r\nX-Evil: 1`], ['enorme', `00-${T}-${S}-01-${'a'.repeat(600)}`], ['não é texto', 42 as never],
  ])('RECUSA %s (o serviço começa um trace novo, nunca confia)', (_n, h) => { expect(parseTraceparent(h)).toBeNull() })
})

describe('tracer', () => {
  const novo = (o = {}) => { const ex = exportadorMemoria(); return { ex, t: new Tracer({ servico: 'loja', exportador: ex, ...o }) } }
  it('span filho herda o trace e aponta o pai; o contexto atravessa awaits', async () => {
    const { ex, t } = novo()
    await t.emSpan('pai', { tipo: 'servidor' }, async (pai) => {
      await new Promise((r) => setTimeout(r, 2))
      await t.emSpan('filho', {}, async (f) => { await Promise.resolve(); expect(t.atual()).toBe(f); expect(f.traceId).toBe(pai.traceId); expect(f.paiId).toBe(pai.spanId) })
      expect(t.atual()).toBe(pai)
    })
    expect(t.atual()).toBeUndefined()
    expect(ex.spans.map((s) => s.nome)).toEqual(['filho', 'pai']); expect(ex.spans[0]!.paiId).toBe(ex.spans[1]!.spanId); expect(ex.spans[1]!.duracaoMs).toBeGreaterThanOrEqual(2)
  })
  it('continua um trace de FORA; cabeçalho inválido gera trace novo; ids únicos e nunca zerados', () => {
    const { ex, t } = novo()
    const pai = t.extrai('00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01')
    const s = t.inicia('srv', { pai, tipo: 'servidor' }); s.fim()
    expect(ex.spans[0]).toMatchObject({ traceId: '0af7651916cd43dd8448eb211c80319c', paiId: 'b7ad6b7169203331' })
    const novoT = t.inicia('x', { pai: t.extrai('lixo') }); expect(novoT.paiId).toBeUndefined()
    const ids = new Set(Array.from({ length: 500 }, () => t.inicia('y', { pai: null }).spanId)); expect(ids.size).toBe(500); expect([...ids].every((i) => i !== '0'.repeat(16) && /^[0-9a-f]{16}$/.test(i))).toBe(true)
  })
  it('exceção marca o span como erro (e propaga); atributos sensíveis são mascarados e limitados', async () => {
    const { ex, t } = novo()
    await expect(t.emSpan('falha', { atributos: { 'http.method': 'GET', authorization: 'Bearer abc.def.ghi-12', senha: 'x', url: `https://u:p@h/?t=${'a'.repeat(900)}`, n: 5 } }, () => { throw new Error('quebrou') })).rejects.toThrow('quebrou')
    const s = ex.spans[0]!
    expect(s.status).toEqual({ codigo: 'erro', mensagem: 'Error: quebrou' }); expect(s.atributos.authorization).toBe('[REDIGIDO]'); expect(s.atributos.senha).toBe('[REDIGIDO]'); expect(String(s.atributos.url)).not.toContain('u:p@'); expect(String(s.atributos.url).length).toBeLessThanOrEqual(500); expect(s.atributos.n).toBe(5)
  })
  it('amostragem: a decisão do pai manda; na raiz, a fração; span não amostrado não é exportado mas PROPAGA o contexto', () => {
    const { ex, t } = novo({ amostragem: 0.5, aleatorio: () => 0.9 })
    const raiz = t.inicia('r'); raiz.fim(); expect(ex.spans.length).toBe(0); expect(raiz.traceparent()).toMatch(/-00$/)
    const filho = t.inicia('f', { pai: raiz.contexto() }); filho.fim(); expect(ex.spans.length).toBe(0) // herda "não"
    const { ex: ex2, t: t2 } = novo({ amostragem: 0, aleatorio: () => 0.1 })
    t2.inicia('p', { pai: t2.extrai('00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01') }).fim(); expect(ex2.spans.length).toBe(1) // o pai amostrou: segue, mesmo com a fração 0
  })
  it('fim() é idempotente e span terminado ignora novos atributos; eventos são limitados', () => {
    const { ex, t } = novo(); const s = t.inicia('x')
    for (let i = 0; i < 100; i++) s.evento(`e${i}`)
    s.fim(); s.fim(); s.define('depois', 1)
    expect(ex.spans.length).toBe(1); expect(ex.spans[0]!.eventos.length).toBe(32); expect(ex.spans[0]!.atributos.depois).toBeUndefined()
  })
})

describe('criaObservabilidade: o logger enxerga o span corrente', () => {
  it('toda linha de log dentro de um span leva traceId e spanId; fora dele, não', async () => {
    const linhas: string[] = []; const o = criaObservabilidade({ servico: 'loja', versao: '1.2.3', saida: (l) => linhas.push(l), exportador: exportadorMemoria() })
    o.log.info('fora')
    await o.tracer.emSpan('dentro', {}, async (s) => { o.log.info('dentro'); expect(JSON.parse(linhas[1]!)).toMatchObject({ servico: 'loja', versao: '1.2.3', traceId: s.traceId, spanId: s.spanId }) })
    expect(JSON.parse(linhas[0]!).traceId).toBeUndefined()
  })
})
