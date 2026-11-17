process.env.POLARIS_LOG_NIVEL = 'info'
import { PGlite } from '@electric-sql/pglite'
import { criaBarramentoMemoria, criaConsumidor, criaRelay, dbSistemaDePglite, dbTenantDePglite } from '@polaris/eventos'
import { criaObservabilidade, exportadorMemoria } from '@polaris/observabilidade'
import { Registry, emite, type No } from '@polaris/schema'
import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { criaServico, dbDePglite, regrasDoRegistry, type Contexto, type Db } from '../src/index'

// Observabilidade INJETADA: o autor do serviço não escreveu uma linha de log, métrica ou trace. Aqui se confere o que ela produz (e o que NUNCA produz).

const A = '11111111-1111-1111-1111-111111111111'
const JWT = 'eyJhbGciOiJSUzI1NiJ9.eyJzdWIiOiJhbmEifQ.assinaturaassinaturaassinatura'
const SEGREDO_CORPO = 'senha-super-secreta-123', SEGREDO_QUERY = 'valor-de-query-xyz'
const LOJA: No = { kind: 'servico', id: 'loja', versao: '3.1.4', estatuto: 'publicado', spec: {
  entidades: { pedido: { campos: { nota: { tipo: 'texto' }, total: { tipo: 'dinheiro' } }, crud: { caminho: '/pedidos' } } },
  operacoes: {
    cancelar: { metodo: 'POST', caminho: '/pedidos/:id/cancelar', entrada: { id: { tipo: 'uuid', obrigatorio: true } }, saida: 'pedido', publica: ['pedido.cancelado'] },
    quebra: { metodo: 'POST', caminho: '/quebra', entrada: {} },
  },
  consome: ['pedido.cancelado'],
} } as never
const EVENTO = { kind: 'evento', id: 'pedido.cancelado', versao: '1.0.0', estatuto: 'publicado', spec: { nome: 'pedido.cancelado', payload: { id: { tipo: 'uuid', obrigatorio: true } }, idempotencia: 'id' } } as never
const papel = { kind: 'papel', id: 'gerente', versao: '1.0.0', estatuto: 'publicado', spec: { regras: [{ acoes: ['manage'], sujeitos: ['all'] }] } } as never
const REG = new Registry(); REG.registra(papel)

let pg: PGlite, app: FastifyInstance, falhaBanco = false
const linhas: string[] = []
const spans = exportadorMemoria()
const obs = criaObservabilidade({ servico: 'loja', versao: '3.1.4', saida: (l) => linhas.push(l), exportador: spans, nivel: 'debug' })
const logs = () => linhas.map((l) => JSON.parse(l) as Record<string, any>)
const reqs = () => logs().filter((l) => l.msg === 'requisicao')
const metricas = () => obs.metricas.texto()
const TOKENS: Record<string, Contexto> = { tA: { tenantId: A, usuario: 'ana', papeis: ['gerente'] } }
const dbBase = dbDePglite as unknown as (p: PGlite) => Db
const dbFalho = (): Db => ({ transacao: (t, fn) => (falhaBanco ? Promise.reject(Object.assign(new Error(`conexão recusada postgres://app:s3nha@db:5432/x token ${JWT}`), { code: 'ECONNREFUSED' })) : dbBase(pg).transacao(t, fn)) })
const req = (metodo: string, url: string, corpo?: unknown, headers: Record<string, string> = {}, tok: string | null = 'tA') =>
  app.inject({ method: metodo as 'GET', url, headers: { ...(tok ? { authorization: `Bearer ${tok}` } : {}), ...(corpo !== undefined ? { 'content-type': 'application/json' } : {}), ...headers }, ...(corpo !== undefined ? { payload: JSON.stringify(corpo) } : {}) })
const json = (r: { body: string }) => JSON.parse(r.body)
const limpa = () => { linhas.length = 0; spans.limpa() }
/** valor de uma série na exposição (0 se ainda não existe) */
const serie = (nome: string, rotulos: string) => { const m = new RegExp(`^${nome.replace(/[{}.]/g, '\\$&')}\\{servico="loja"${rotulos ? ',' : ''}${rotulos.replace(/[{}.*+?^$()|[\]\\\/]/g, '\\$&')}\\} (\\S+)$`, 'm').exec(obs.metricas.texto()); return m ? Number(m[1]) : 0 }
const valoresDe = (rotulo: string) => new Set([...obs.metricas.texto().matchAll(new RegExp(`${rotulo}="([^"]*)"`, 'g'))].map((m) => m[1]!))

beforeAll(async () => {
  pg = new PGlite()
  await pg.exec(`CREATE ROLE migrador NOLOGIN BYPASSRLS; CREATE ROLE relay NOLOGIN BYPASSRLS; CREATE ROLE app NOLOGIN; GRANT CREATE ON DATABASE postgres TO migrador; SET ROLE migrador;`)
  await pg.exec(emite(LOJA, 'sql'))
  await pg.exec(`RESET ROLE; GRANT USAGE ON SCHEMA loja TO app, relay; GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA loja TO app, relay; SET ROLE app;`)
  app = criaServico(LOJA, {
    db: dbFalho(), acesso: regrasDoRegistry(REG), obs, metricasToken: 'token-de-metricas-com-16+',
    contexto: (r) => TOKENS[String(r.headers.authorization ?? '').slice(7)] ?? null,
    eventos: { 'pedido.cancelado': EVENTO },
    operacoes: {
      cancelar: async ({ params, q, publica }) => { const r = await q(`UPDATE loja.pedido SET nota = 'cancelado' WHERE id = $1 RETURNING id::text AS id, criado_em::text AS "criadoEm", atualizado_em::text AS "atualizadoEm"`, [params.id]); if (!r.rows[0]) throw new (await import('../src/index')).ErroApi(404, 'nao_encontrado', 'não encontrado'); await publica('pedido.cancelado', { id: params.id }); return r.rows[0] },
      quebra: async () => { throw new Error(`falha interna com ${JWT} e postgres://u:p@h/db`) },
    },
  })
  await app.ready()
})
afterAll(async () => { await app.close(); await pg.close() })

describe('log: uma linha por requisição, sem dado sensível', () => {
  it('campos úteis, rota pelo TEMPLATE (não pela URL), traceId, tenant e usuário', async () => {
    limpa()
    const c = json(await req('POST', '/pedidos', { nota: 'x', total: '5' }))
    const r = await req('GET', `/pedidos/${c.id}`)
    expect(r.statusCode).toBe(200)
    const l = reqs().at(-1)!
    expect(l).toMatchObject({ nivel: 'info', msg: 'requisicao', servico: 'loja', versao: '3.1.4', metodo: 'GET', rota: '/pedidos/:id', status: 200, tenantId: A, usuario: 'ana' })
    expect(typeof l.duracaoMs).toBe('number'); expect(l.traceId).toMatch(/^[0-9a-f]{32}$/); expect(l.requisicaoId).toBe(r.headers['x-request-id'])
    expect(JSON.stringify(l)).not.toContain(c.id) // o id real não entra (cardinalidade e privacidade)
  })
  it('NUNCA registra corpo, cabeçalhos nem query string, nem segredos que passem por mensagens de erro', async () => {
    limpa()
    await req('POST', '/pedidos', { nota: SEGREDO_CORPO, total: '1', senha: SEGREDO_CORPO }, { cookie: 'sid=cookie-secreto', 'x-api-key': 'chave-api-secreta' }) // `senha` é campo desconhecido → 400
    await req('GET', `/pedidos?nota=${SEGREDO_QUERY}&token=${SEGREDO_QUERY}`)
    await req('POST', '/quebra', {}, { authorization: `Bearer tA`, 'x-evil': JWT })
    const tudo = linhas.join('\n') + metricas() + JSON.stringify(spans.spans)
    for (const s of [SEGREDO_CORPO, SEGREDO_QUERY, 'cookie-secreto', 'chave-api-secreta', 'assinaturaassinatura', 's3nha', 'u:p@h']) expect(tudo, s).not.toContain(s)
  })
  it('erro inesperado: nível error com o erro REDIGIDO, requisicaoId e traceId; o cliente recebe só o id', async () => {
    limpa()
    const r = await req('POST', '/quebra', {})
    expect(r.statusCode).toBe(500); expect(json(r).erro).toEqual({ codigo: 'erro_interno', mensagem: 'erro interno', requisicaoId: r.headers['x-request-id'] })
    const e = logs().find((l) => l.msg === 'erro inesperado')!
    expect(e.nivel).toBe('error'); expect(e.requisicaoId).toBe(r.headers['x-request-id']); expect(e.traceId).toMatch(/^[0-9a-f]{32}$/)
    expect(e.erro.mensagem).toBe('falha interna com [JWT] e postgres://[REDIGIDO]@h/db')
    expect(reqs().at(-1)).toMatchObject({ nivel: 'error', status: 500 })
  })
  it('níveis: 4xx é warn; /saude e /pronto não poluem (debug)', async () => {
    limpa()
    await req('GET', `/pedidos/00000000-0000-0000-0000-00000000000a`) // 404
    await req(  'GET', '/saude', undefined, {}, null)
    expect(reqs().find((l) => l.rota === '/pedidos/:id')!.nivel).toBe('warn'); expect(reqs().find((l) => l.rota === '/saude')!.nivel).toBe('debug')
  })
})

describe('x-request-id: só aceita id bem formado (nada de injeção)', () => {
  it('um id válido do cliente é mantido e propagado (cabeçalho, log, corpo de erro)', async () => {
    limpa()
    const r = await req('GET', '/pedidos/nao-e-uuid', undefined, { 'x-request-id': 'abc-123_X.9' })
    expect(r.headers['x-request-id']).toBe('abc-123_X.9'); expect(json(r).erro.requisicaoId).toBe('abc-123_X.9'); expect(reqs().at(-1)!.requisicaoId).toBe('abc-123_X.9')
  })
  it.each(['com espaço', 'a'.repeat(65), 'a\tb', 'ação', '<script>', 'a;b', ''])('id mal formado %j é SUBSTITUÍDO por um uuid', async (id) => {
    limpa()
    let r; try { r = await req('GET', '/saude', undefined, { 'x-request-id': id }, null) } catch { return } // o próprio HTTP já recusa alguns bytes
    expect(r.headers['x-request-id']).toMatch(/^[0-9a-f-]{36}$/)
    expect(linhas.every((l) => !l.includes(id) || id === '')).toBe(true)
  })
})

describe('métricas', () => {
  it('contadores, histograma de duração e gauge em andamento; `servico` em toda série; o id do recurso NÃO vira rótulo', async () => {
    const c = json(await req('POST', '/pedidos', { nota: 'm', total: '1' }))
    const ok0 = serie('http_requests_total', 'metodo="GET",rota="/pedidos/:id",status="200"'), nf0 = serie('http_requests_total', 'metodo="GET",rota="/pedidos/:id",status="404"'), n0 = serie('http_request_duration_seconds_count', 'metodo="GET",rota="/pedidos/:id"')
    const desf0 = serie('db_transacoes_total', 'resultado="desfeita"')
    for (let i = 0; i < 3; i++) await req('GET', `/pedidos/${c.id}`)
    await req('GET', '/pedidos/00000000-0000-0000-0000-0000000000aa') // outro id, MESMA série
    expect(serie('http_requests_total', 'metodo="GET",rota="/pedidos/:id",status="200"') - ok0).toBe(3); expect(serie('http_requests_total', 'metodo="GET",rota="/pedidos/:id",status="404"') - nf0).toBe(1)
    expect(serie('http_request_duration_seconds_count', 'metodo="GET",rota="/pedidos/:id"') - n0).toBe(4)
    expect(metricas()).toMatch(/http_request_duration_seconds_bucket\{servico="loja",metodo="GET",rota="\/pedidos\/:id",le="\+Inf"\} \d+/)
    expect(metricas()).toMatch(/^http_requests_in_flight\{servico="loja"\} 0$/m); expect(serie('http_requests_in_flight', '')).toBe(0); expect(metricas()).not.toContain(c.id)
    expect(serie('db_transacoes_total', 'resultado="desfeita"') - desf0).toBe(1) // o 404 desfez a transação
  })
  it('CARDINALIDADE FIXA: 300 rotas inexistentes e 50 ids aleatórios não criam séries; o conjunto de `rota` é o do schema', async () => {
    for (let i = 0; i < 300; i++) await req('GET', `/lixo/${Math.random()}/${i}`, undefined, {}, null)
    for (let i = 0; i < 50; i++) await req('GET', `/pedidos/${'00000000-0000-0000-0000-' + String(i).padStart(12, '0')}`)
    const t = metricas()
    expect(serie('http_requests_total', 'metodo="GET",rota="desconhecida",status="404"')).toBeGreaterThanOrEqual(300)
    expect(t).not.toContain('/lixo'); expect(t).not.toMatch(/0000-0000-0000-0000000000\d\d/)
    const permitidas = new Set(['/pedidos', '/pedidos/:id', '/pedidos/:id/cancelar', '/quebra', 'desconhecida', '/saude', '/pronto', '/metrics'])
    for (const r of valoresDe('rota')) expect(permitidas.has(r), r).toBe(true)
    expect(t).not.toContain('metricas_series_descartadas_total{servico="loja"} 1') // e nada foi descartado por excesso
  })
  it('recusas contadas por status e código (401/403), sem rótulo livre', async () => {
    await req('GET', '/pedidos', undefined, {}, null); await req('GET', '/pedidos', undefined, {}, 'token-inexistente')
    expect(serie('http_recusadas_total', 'status="401",codigo="nao_autenticado"')).toBeGreaterThanOrEqual(2)
  })
})

describe('/metrics: fechado por padrão, com token em tempo constante', () => {
  it('sem metricasToken a rota NÃO EXISTE (404); token curto é recusado na criação', async () => {
    const sem = criaServico(LOJA, { db: dbFalho(), acesso: regrasDoRegistry(REG), contexto: () => null, eventos: { 'pedido.cancelado': EVENTO }, obs: criaObservabilidade({ servico: 'x', saida: () => {} }) })
    expect((await sem.inject({ url: '/metrics' })).statusCode).toBe(404); await sem.close()
    expect(() => criaServico(LOJA, { db: dbFalho(), acesso: regrasDoRegistry(REG), contexto: () => null, eventos: { 'pedido.cancelado': EVENTO }, metricasToken: 'curto' })).toThrow('16 caracteres')
  })
  it('com token: sem cabeçalho, errado, de outro tamanho e prefixo → 401; certo → 200 em text/plain no formato do Prometheus', async () => {
    for (const h of [undefined, 'Bearer errado', 'Bearer token-de-metricas-com-16+x', 'Bearer token-de-metricas-com-16', 'token-de-metricas-com-16+', 'Basic token-de-metricas-com-16+']) {
      const r = await app.inject({ url: '/metrics', headers: h ? { authorization: h } : {} }); expect(r.statusCode, String(h)).toBe(401)
    }
    const ok = await app.inject({ url: '/metrics', headers: { authorization: 'Bearer token-de-metricas-com-16+' } })
    expect(ok.statusCode).toBe(200); expect(ok.headers['content-type']).toContain('text/plain'); expect(ok.body).toContain('# TYPE http_requests_total counter')
    for (const l of ok.body.trim().split('\n')) expect(l).toMatch(/^(# (HELP|TYPE) .+|[a-z_:][a-z0-9_:]*(\{.*\})? [-+0-9.eInfNa]+)$/)
  })
})

describe('traces', () => {
  it('um span servidor por requisição (nome pelo template) com filho db.transacao; o log leva o mesmo traceId', async () => {
    limpa()
    await req('GET', '/pedidos')
    const srv = spans.spans.find((s) => s.tipo === 'servidor')!, db = spans.spans.find((s) => s.nome === 'db.transacao')!
    expect(srv.nome).toBe('GET /pedidos'); expect(srv.atributos).toMatchObject({ 'http.metodo': 'GET', 'http.rota': '/pedidos', 'http.status': 200, tenant: A, usuario: 'ana' })
    expect(db.traceId).toBe(srv.traceId); expect(db.paiId).toBe(srv.spanId); expect(db.tipo).toBe('cliente'); expect(db.atributos['db.sistema']).toBe('postgresql')
    expect(reqs().at(-1)!.traceId).toBe(srv.traceId)
  })
  it('continua o trace que vem no cabeçalho `traceparent`; cabeçalho inválido gera trace NOVO', async () => {
    limpa()
    const T = '0af7651916cd43dd8448eb211c80319c', S = 'b7ad6b7169203331'
    await req('GET', '/pedidos', undefined, { traceparent: `00-${T}-${S}-01` })
    expect(spans.spans.find((s) => s.tipo === 'servidor')).toMatchObject({ traceId: T, paiId: S })
    limpa()
    await req('GET', '/pedidos', undefined, { traceparent: `00-${'0'.repeat(32)}-${S}-01` })
    const srv = spans.spans.find((s) => s.tipo === 'servidor')!; expect(srv.traceId).not.toBe('0'.repeat(32)); expect(srv.paiId).toBeUndefined()
  })
  it('pai NÃO amostrado: nenhum span é exportado, mas a requisição funciona e o contexto segue', async () => {
    limpa()
    const r = await req('GET', '/pedidos', undefined, { traceparent: '00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-00' })
    expect(r.statusCode).toBe(200); expect(spans.spans.length).toBe(0); expect(reqs().at(-1)!.traceId).toBe('0af7651916cd43dd8448eb211c80319c')
  })
  it('atravessa SERVIÇOS pelos eventos: requisição → db → evento.publica → outbox (traceparent) → relay → consumidor, tudo no MESMO trace', async () => {
    limpa()
    const p = json(await req('POST', '/pedidos', { nota: 'a', total: '1' })).id
    limpa()
    const r = await req('POST', `/pedidos/${p}/cancelar`, {}); expect(r.statusCode).toBe(200)
    const srv = spans.spans.find((s) => s.tipo === 'servidor')!
    const pub = spans.spans.find((s) => s.nome === 'evento.publica')!
    expect(pub.traceId).toBe(srv.traceId)
    await pg.exec('RESET ROLE; SET ROLE migrador')
    const guardado = (await pg.query(`SELECT traceparent FROM loja.outbox WHERE chave = $1`, [p])).rows[0] as { traceparent: string }
    await pg.exec('RESET ROLE; SET ROLE app')
    expect(guardado.traceparent).toBe(`00-${pub.traceId}-${pub.spanId}-01`) // o outbox guarda o contexto de quem publicou
    // relay e consumidor (com obs) continuam o MESMO trace
    const bus = criaBarramentoMemoria()
    const dbRelay = { transacao: <T,>(fn: (q: any) => Promise<T>) => pg.transaction(async (tx) => { await tx.exec('SET LOCAL ROLE relay'); return dbSistemaDePglite(pg).transacao(fn as never) as Promise<T> }) }
    void dbRelay
    const relayDb = { transacao: (fn: any) => pg.transaction(async (tx: any) => { await tx.exec('SET LOCAL ROLE relay'); return fn(async (sql: string, params?: unknown[]) => { const x = await tx.query(sql, params); return { rows: x.rows, rowCount: x.affectedRows ?? x.rows.length } }) }) }
    const appDb = { transacao: (t: string, fn: any) => pg.transaction(async (tx: any) => { await tx.exec('SET LOCAL ROLE app'); await tx.query(`SELECT set_config('app.tenant_id', $1, true)`, [t]); return fn(async (sql: string, params?: unknown[]) => { const x = await tx.query(sql, params); return { rows: x.rows, rowCount: x.affectedRows ?? x.rows.length } }) }) }
    void dbTenantDePglite
    let efeitos = 0
    bus.assina(criaConsumidor({ db: appDb as never, servico: 'loja', consumidor: 'auditar', tipos: ['pedido.cancelado'], obs, handler: async () => { efeitos++ } }))
    const relay = criaRelay({ db: relayDb as never, servico: 'loja', barramento: bus, obs })
    await relay.executa(); await bus.aguarda()
    expect(efeitos).toBe(1)
    const rel = spans.spans.find((s) => s.nome === 'outbox.publica')!, con = spans.spans.find((s) => s.nome === 'evento.consome')!
    expect(rel.traceId).toBe(srv.traceId); expect(rel.paiId).toBe(pub.spanId); expect(rel.tipo).toBe('produtor')
    expect(con.traceId).toBe(srv.traceId); expect(con.paiId).toBe(rel.spanId); expect(con.tipo).toBe('consumidor')
    expect(new Set(spans.spans.map((s) => s.traceId)).size).toBe(1) // UM trace do clique ao efeito
    const t = metricas()
    expect(t).toMatch(/outbox_publicados_total\{servico="loja"\} [1-9]/); expect(t).toContain('eventos_consumidos_total{servico="loja",consumidor="auditar",resultado="processado"} 1'); expect(t).toMatch(/outbox_pendentes\{servico="loja"\} 0/)
    expect(t).toMatch(/eventos_publicados_total\{servico="loja",evento="pedido.cancelado"\} [1-9]/)
  })
})

describe('/pronto e saúde do relay', () => {
  it('/pronto: 200 com o banco; 503 SEM detalhe quando cai (o erro, redigido, vai para o log)', async () => {
    expect((await app.inject({ url: '/pronto' })).statusCode).toBe(200)
    limpa(); falhaBanco = true
    const r = await app.inject({ url: '/pronto' })
    falhaBanco = false
    expect(r.statusCode).toBe(503); expect(json(r)).toEqual({ ok: false }); expect(r.body).not.toMatch(/conexão|postgres|ECONN/)
    const l = logs().find((x) => x.msg === 'dependência indisponível')!; expect(l.nivel).toBe('error'); expect(JSON.stringify(l)).not.toMatch(/s3nha|eyJ/); expect(l.erro.mensagem).toContain('postgres://[REDIGIDO]@db')
  })
  it('relay: pendentes e idade do mais antigo viram gauges; falha e morto viram contadores e logs (sem o payload)', async () => {
    limpa()
    const g = json(await req('POST', '/pedidos', { nota: 'r', total: '1' })).id
    await req('POST', `/pedidos/${g}/cancelar`, {})
    const relayDb = { transacao: (fn: any) => pg.transaction(async (tx: any) => { await tx.exec('SET LOCAL ROLE relay'); return fn(async (sql: string, params?: unknown[]) => { const x = await tx.query(sql, params); return { rows: x.rows, rowCount: x.affectedRows ?? x.rows.length } }) }) }
    const obs2 = criaObservabilidade({ servico: 'loja', saida: (l) => linhas.push(l), exportador: spans, nivel: 'debug' })
    const ruim = { publica: async () => { throw new Error('broker caiu') }, assina: () => () => {} }
    const relay = criaRelay({ db: relayDb as never, servico: 'loja', barramento: ruim as never, obs: obs2, maxTentativas: 2, espera: () => 0 })
    await relay.executa(); await relay.executa()
    const t = obs2.metricas.texto()
    expect(t).toMatch(/outbox_falhas_total\{servico="loja"\} [1-9]/); expect(t).toMatch(/outbox_mortos_total\{servico="loja"\} [1-9]/)
    const morto = logs().find((x) => x.msg === 'evento morto: esgotou as tentativas')!
    expect(morto).toMatchObject({ nivel: 'error', tentativas: 2 }); expect(JSON.stringify(morto)).not.toContain(g) // o payload (com o id do pedido) não vai para o log
    expect(logs().some((x) => x.msg.startsWith('falha ao publicar evento'))).toBe(true)
  })
})
