process.env.POLARIS_LOG_NIVEL = 'silencio' // o serviço loga em JSON por padrão; os testes não precisam do ruído
import { PGlite } from '@electric-sql/pglite'
import { criaAutenticadorJwt } from '@polaris/acesso'
import { Registry, emite, type No } from '@polaris/schema'
import { SignJWT, generateKeyPair, type KeyLike } from 'jose'
import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { contextoPorJwt, criaServico, dbDePglite, regrasDoRegistry } from '../src/index'

// Controle de acesso de ponta a ponta: JWT → papéis (nós `papel`, herança, cascata) → regras → decisão por rota, escopo de LINHA no SQL, campos, delegação
// dentro de operações. Fastify real + Postgres real (PGlite, RLS, papel sem bypass).

const A = '11111111-1111-1111-1111-111111111111', B = '22222222-2222-2222-2222-222222222222'
const ISS = 'https://id.exemplo.com', AUD = 'polaris-api'
const LOJA: No = { kind: 'servico', id: 'loja', versao: '1.0.0', estatuto: 'publicado', spec: {
  entidades: {
    produto: { campos: { nome: { tipo: 'texto', obrigatorio: true } }, crud: { caminho: '/produtos' } },
    vitrine: { campos: { titulo: { tipo: 'texto' } }, crud: { caminho: '/vitrines', operacoes: ['listar'], permissao: 'publica' } },
    pedido: { campos: { criadoPor: { tipo: 'texto', obrigatorio: true }, total: { tipo: 'dinheiro', obrigatorio: true }, nota: { tipo: 'texto' }, segredo: { tipo: 'texto' }, tags: { tipo: 'texto', lista: true } }, crud: { caminho: '/pedidos' } },
  },
  operacoes: { cancelar: { metodo: 'POST', caminho: '/pedidos/:id/cancelar', entrada: { id: { tipo: 'uuid', obrigatorio: true } }, saida: 'pedido' } },
} } as never
const papel = (id: string, regras: object[], extra: object = {}, escopo: object = {}) => ({ kind: 'papel', id, versao: '1.0.0', estatuto: 'publicado', spec: { regras, ...extra }, ...escopo }) as never
const PEDIDO = ['loja.pedido']
const R = (acoes: string[], extra: object = {}, sujeitos = PEDIDO) => ({ acoes, sujeitos, ...extra })

let pg: PGlite, app: FastifyInstance, priv: KeyLike
const erros: unknown[] = []
const reg = new Registry()
const LEITURA = ['criadoPor', 'total', 'nota', 'tags']
reg.registra(papel('leitor', [R(['listar', 'obter'], {}, ['loja.produto'])]))
reg.registra(papel('vendedor', [R(['listar', 'obter', 'criar', 'atualizar'], { onde: { criadoPor: '$usuario' }, campos: [...LEITURA] }), R(['remover'], { negar: true }, ['all'])], { herda: ['leitor'] }))
reg.registra(papel('supervisor', [R(['listar', 'obter']), R(['atualizar'], { campos: ['nota'] })], { herda: ['vendedor'] }))
reg.registra(papel('gerente', [R(['manage'], {}, ['all']), R(['listar', 'obter'], { negar: true, campos: ['segredo'] })]))
reg.registra(papel('limitado', [R(['listar', 'obter', 'criar', 'atualizar'], { onde: { total: { $lte: '100.00' } } })]))
reg.registra(papel('estragado', [R(['listar'], { onde: { naoExiste: 1 } })]))
reg.registra(papel('somente-tags', [R(['listar'], { onde: { tags: { $all: ['vip'] } } })]))
reg.registra(papel('cancelador', [R(['cancelar'])]))
reg.registra(papel('vendedor', [R(['listar', 'obter', 'criar', 'atualizar'])], {}, { tenantId: B })) // B REDEFINE `vendedor`: vê e edita tudo

const token = async (sub: string, tid: string, papeis: string[], extra: { exp?: string | number; key?: KeyLike } = {}) =>
  new SignJWT({ tid, papeis }).setProtectedHeader({ alg: 'RS256' }).setSubject(sub).setIssuer(ISS).setAudience(AUD).setExpirationTime(extra.exp ?? '5m').sign(extra.key ?? priv)
const req = (tok: string | null, metodo: string, url: string, corpo?: unknown, host = 'a.loja.test') =>
  app.inject({ method: metodo as 'GET', url, headers: { host, ...(tok ? { authorization: `Bearer ${tok}` } : {}), ...(corpo !== undefined ? { 'content-type': 'application/json' } : {}) }, ...(corpo !== undefined ? { payload: JSON.stringify(corpo) } : {}) })
const json = (r: { body: string }) => JSON.parse(r.body)
const bruto = async (sql: string, p: unknown[] = []): Promise<Array<Record<string, any>>> => { await pg.exec('RESET ROLE; SET ROLE migrador'); const r = (await pg.query(sql, p)).rows as Array<Record<string, any>>; await pg.exec('RESET ROLE; SET ROLE app'); return r }

beforeAll(async () => {
  const k = await generateKeyPair('RS256'); priv = k.privateKey
  pg = new PGlite()
  await pg.exec(`CREATE ROLE migrador NOLOGIN BYPASSRLS; CREATE ROLE app NOLOGIN; GRANT CREATE ON DATABASE postgres TO migrador; SET ROLE migrador;`)
  await pg.exec(emite(LOJA, 'sql'))
  await pg.exec(`RESET ROLE; GRANT USAGE ON SCHEMA loja TO app; GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA loja TO app; SET ROLE app;`)
  const autentica = criaAutenticadorJwt({ emissor: ISS, audiencia: AUD, chave: { publica: k.publicKey } })
  app = criaServico(LOJA, {
    db: dbDePglite(pg), acesso: regrasDoRegistry(reg), aoErro: (e) => { erros.push(e) },
    contexto: contextoPorJwt(autentica, (r) => (r.hostname === 'a.loja.test' ? { tenantId: A } : null)),
    operacoes: { cancelar: async ({ params, q, pode, ctx }) => {
      const r = await q(`SELECT criado_por AS "criadoPor", id::text AS id FROM loja.pedido WHERE id = $1`, [params.id])
      const linha = r.rows[0]; if (!linha) { const { ErroApi } = await import('../src/index'); throw new ErroApi(404, 'nao_encontrado', 'não encontrado') }
      if (!pode('cancelar', 'loja.pedido', linha)) { const { ErroApi } = await import('../src/index'); throw new ErroApi(403, 'proibido', 'este pedido não é seu') }
      void ctx; return { id: linha.id as string }
    } },
  })
  await app.ready()
})
afterAll(async () => { await app.close(); await pg.close() })

describe('JWT ponta a ponta', () => {
  it('token válido autentica e carrega o tenant e os papéis; sem token só passa em rota pública (tenant pelo host)', async () => {
    expect((await req(await token('ana', A, ['leitor']), 'GET', '/produtos')).statusCode).toBe(200)
    expect((await req(null, 'GET', '/produtos')).statusCode).toBe(401) // o host dá um tenant ANÔNIMO, que não vale em rota protegida
    expect((await req(null, 'GET', '/vitrines')).statusCode).toBe(200)
    expect((await req(null, 'GET', '/vitrines', undefined, 'desconhecido.test')).statusCode).toBe(400)
  })
  it('token ruim é 401 MESMO em rota pública (nunca vira anônimo): expirado, assinatura errada, alg none, lixo', async () => {
    const forjado = await token('ana', A, ['gerente'], { key: (await generateKeyPair('RS256')).privateKey })
    const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url')
    for (const t of [await token('ana', A, ['leitor'], { exp: Math.floor(Date.now() / 1000) - 60 }), forjado, `${b64({ alg: 'none' })}.${b64({ sub: 'x', tid: A, iss: ISS, aud: AUD, exp: 9999999999, papeis: ['gerente'] })}.`, 'lixo.lixo.lixo']) {
      const r = await req(t, 'GET', '/vitrines'); expect(r.statusCode).toBe(401); expect(json(r).erro.codigo).toBe('credencial_invalida')
    }
  })
  it('o tenant do TOKEN é o que vale: token do tenant B não enxerga dados do A', async () => {
    await req(await token('zed', A, ['vendedor']), 'POST', '/pedidos', { criadoPor: 'zed', total: '10' })
    expect(json(await req(await token('bia', B, ['vendedor']), 'GET', '/pedidos', undefined, 'b.loja.test')).length).toBe(0) // B não vê o do A
    expect((await bruto(`SELECT count(*)::int AS n FROM loja.pedido WHERE criado_por = 'zed'`))[0]!.n).toBe(1)
  })
})

describe('escopo de LINHA: o papel só alcança o que a condição permite (no SQL, não depois)', () => {
  let doAna = '', daBia = ''
  it('o vendedor só cria registro SEU; criar em nome de outro é 403 e a transação desfaz', async () => {
    const ana = await token('ana', A, ['vendedor']), bia = await token('bia', A, ['vendedor'])
    const r = await req(ana, 'POST', '/pedidos', { criadoPor: 'ana', total: '50.00', nota: 'a1', segredo: 's' }); expect(r.statusCode).toBe(403); expect(json(r).erro.codigo).toBe('campo_proibido') // `segredo` não está nos campos do vendedor
    const ok = await req(ana, 'POST', '/pedidos', { criadoPor: 'ana', total: '50.00', nota: 'a1' }); expect(ok.statusCode).toBe(201); doAna = json(ok).id
    daBia = json(await req(bia, 'POST', '/pedidos', { criadoPor: 'bia', total: '70.00', nota: 'b1' })).id
    const antes = (await bruto(`SELECT count(*)::int AS n FROM loja.pedido`))[0]!.n
    const fora = await req(ana, 'POST', '/pedidos', { criadoPor: 'bia', total: '1' }); expect(fora.statusCode).toBe(403); expect(json(fora).erro.codigo).toBe('proibido')
    expect((await bruto(`SELECT count(*)::int AS n FROM loja.pedido`))[0]!.n).toBe(antes) // nada ficou
  })
  it('listar, obter, atualizar: só os seus; os dos outros dão 404 (não revela que existem)', async () => {
    const ana = await token('ana', A, ['vendedor'])
    expect(json(await req(ana, 'GET', '/pedidos')).map((p: { nota: string }) => p.nota)).toEqual(['a1'])
    expect((await req(ana, 'GET', `/pedidos/${doAna}`)).statusCode).toBe(200)
    expect((await req(ana, 'GET', `/pedidos/${daBia}`)).statusCode).toBe(404)
    expect((await req(ana, 'PATCH', `/pedidos/${daBia}`, { nota: 'hack' })).statusCode).toBe(404)
    expect((await bruto(`SELECT nota FROM loja.pedido WHERE id = $1`, [daBia]))[0]).toEqual({ nota: 'b1' })
  })
  it('não dá para "empurrar" o registro para fora do próprio alcance: mudar criadoPor para outro é 403 e desfaz', async () => {
    const ana = await token('ana', A, ['vendedor'])
    const r = await req(ana, 'PATCH', `/pedidos/${doAna}`, { criadoPor: 'bia' }); expect(r.statusCode).toBe(403)
    expect((await bruto(`SELECT criado_por FROM loja.pedido WHERE id = $1`, [doAna]))[0]).toEqual({ criado_por: 'ana' })
  })
  it('filtros da requisição se COMBINAM com o escopo (nunca o contornam)', async () => {
    const ana = await token('ana', A, ['vendedor'])
    expect(json(await req(ana, 'GET', '/pedidos?criadoPor=bia')).length).toBe(0) // pedir os da Bia não os revela
    expect(json(await req(ana, 'GET', '/pedidos?nota=a1')).length).toBe(1)
  })
  it('papel que herda e AMPLIA (supervisor: listar/obter sem condição): união dos grants → vê todos; edita só `nota`', async () => {
    const sup = await token('sara', A, ['supervisor'])
    expect(json(await req(sup, 'GET', '/pedidos')).length).toBe(3) // zed, ana e bia
    expect((await req(sup, 'PATCH', `/pedidos/${daBia}`, { nota: 'revisado' })).statusCode).toBe(200)
    const r = await req(sup, 'PATCH', `/pedidos/${daBia}`, { total: '1.00' }); expect(r.statusCode).toBe(403); expect(json(r).erro.codigo).toBe('campo_proibido')
  })
  it('a CASCATA vale: o tenant B redefiniu `vendedor` (vê tudo); no A o vendedor segue restrito', async () => {
    await req(await token('x', B, ['vendedor']), 'POST', '/pedidos', { criadoPor: 'x', total: '1' }, 'b.loja.test')
    await req(await token('y', B, ['vendedor']), 'POST', '/pedidos', { criadoPor: 'y', total: '2' }, 'b.loja.test')
    expect(json(await req(await token('x', B, ['vendedor']), 'GET', '/pedidos', undefined, 'b.loja.test')).length).toBe(2)
    expect(json(await req(await token('ana', A, ['vendedor']), 'GET', '/pedidos')).length).toBe(1)
  })
  it('condição com DINHEIRO exato: o papel "limitado" só alcança total ≤ 100.00; passar disso ao atualizar é 403', async () => {
    const g = await token('gus', A, ['gerente'])
    const barato = json(await req(g, 'POST', '/pedidos', { criadoPor: 'g', total: '100.0000' })).id, caro = json(await req(g, 'POST', '/pedidos', { criadoPor: 'g', total: '100.01' })).id
    const l = await token('lia', A, ['limitado'])
    const ids = (json(await req(l, 'GET', '/pedidos')) as Array<{ id: string }>).map((p) => p.id)
    expect(ids).toContain(barato); expect(ids).not.toContain(caro) // 100.0000 ≤ 100.00; 100.01 não (como TEXTO "100.01" < "100.00"? não: aqui é decimal)
    expect((await req(l, 'GET', `/pedidos/${caro}`)).statusCode).toBe(404)
    expect((await req(l, 'PATCH', `/pedidos/${barato}`, { total: '100.01' })).statusCode).toBe(403) // sairia do alcance
    expect((await req(l, 'PATCH', `/pedidos/${barato}`, { total: '99.99' })).statusCode).toBe(200)
  })
  it('condição sobre campo LISTA (MongoQuery $all): só alcança os pedidos com a tag', async () => {
    const g = await token('gus', A, ['gerente'])
    const vip = json(await req(g, 'POST', '/pedidos', { criadoPor: 'g', total: '5', tags: ['vip', 'novo'] })).id
    await req(g, 'POST', '/pedidos', { criadoPor: 'g', total: '6', tags: ['novo'] })
    const r = json(await req(await token('tay', A, ['somente-tags']), 'GET', '/pedidos')) as Array<{ id: string }>
    expect(r.map((p) => p.id)).toEqual([vip])
  })
})

describe('campos: o papel só lê e escreve os que lhe cabem', () => {
  it('o vendedor NUNCA recebe `segredo` (nem na lista, nem no obter, nem na resposta do criar)', async () => {
    const g = await token('gus', A, ['gerente'])
    const p = await req(g, 'POST', '/pedidos', { criadoPor: 'ana', total: '9', segredo: 'chave-123' }); expect(p.statusCode).toBe(201)
    const ana = await token('ana', A, ['vendedor'])
    const lista = json(await req(ana, 'GET', '/pedidos')) as Array<Record<string, unknown>>
    for (const x of lista) expect(Object.keys(x)).not.toContain('segredo')
    expect(JSON.stringify(json(await req(ana, 'GET', `/pedidos/${json(p).id}`)))).not.toContain('chave-123')
    expect(Object.keys(json(await req(ana, 'POST', '/pedidos', { criadoPor: 'ana', total: '3' }))).sort()).toEqual(['criadoPor', 'id', 'total'].sort()) // só o que o papel lê (nota/tags ausentes não aparecem)
  })
  it('NEGAR vence até do `manage`: o gerente escreve o segredo mas não o lê de volta, em qualquer ordem de papéis', async () => {
    const reg2 = new Registry(); reg2.registra(papel('g1', [R(['manage'], {}, ['all'])])); reg2.registra(papel('g2', [R(['listar', 'obter'], { negar: true, campos: ['segredo'] })]))
    for (const ordem of [['g1', 'g2'], ['g2', 'g1']]) {
      const app2 = criaServico(LOJA, { db: dbDePglite(pg), acesso: regrasDoRegistry(reg2), contexto: () => ({ tenantId: A, usuario: 'u', papeis: ordem }) })
      const r = await app2.inject({ method: 'GET', url: '/pedidos' }); expect(r.statusCode).toBe(200)
      for (const x of JSON.parse(r.body)) expect(Object.keys(x)).not.toContain('segredo')
      await app2.close()
    }
  })
  it('o gerente (manage all) lê o resto: o escopo e os campos do vendedor não vazam para ele', async () => {
    const r = json(await req(await token('gus', A, ['gerente']), 'GET', '/pedidos')) as Array<Record<string, unknown>>
    expect(r.length).toBeGreaterThan(3); expect(r.every((x) => !('segredo' in x))).toBe(true)
  })
})

describe('proibições e fail-closed', () => {
  it('proibição de `remover` (negar em all) vale mesmo se outro papel permitisse (negar vence); o gerente sozinho remove', async () => {
    const ana = await token('ana', A, ['vendedor'])
    const id = json(await req(ana, 'POST', '/pedidos', { criadoPor: 'ana', total: '2' })).id
    expect((await req(ana, 'DELETE', `/pedidos/${id}`)).statusCode).toBe(403)
    expect((await req(await token('ana', A, ['vendedor', 'gerente']), 'DELETE', `/pedidos/${id}`)).statusCode).toBe(403) // NEGAR VENCE: ter também o gerente não derruba a proibição do vendedor
    expect((await req(await token('gus', A, ['gerente']), 'DELETE', `/pedidos/${id}`)).statusCode).toBe(204) // o gerente sozinho remove
  })
  it('regra que cita campo inexistente NEGA (nunca vira "tudo") e é reportada', async () => {
    erros.length = 0
    expect((await req(await token('e', A, ['estragado']), 'GET', '/pedidos')).statusCode).toBe(403)
    expect(erros.length).toBeGreaterThan(0)
  })
  it('papel desconhecido no token NEGA (403, reportado), não vira "sem regras" nem 500', async () => {
    erros.length = 0
    const r = await req(await token('e', A, ['inexistente']), 'GET', '/produtos'); expect(r.statusCode).toBe(403)
    expect(String((erros[0] as Error).message)).toContain("papel 'inexistente' não existe")
  })
  it('sem nenhum papel: 403 em tudo que é protegido', async () => {
    const t = await token('n', A, [])
    for (const [m, u] of [['GET', '/produtos'], ['GET', '/pedidos'], ['POST', '/pedidos']] as const) expect((await req(t, m, u, m === 'POST' ? { criadoPor: 'n', total: '1' } : undefined)).statusCode, u).toBe(403)
  })
  it('um serviço com rota protegida e SEM `acesso` nem sobe (nunca abre por esquecimento)', () => {
    expect(() => criaServico(LOJA, { db: dbDePglite(pg), contexto: () => null })).toThrow(/falta a opção 'acesso'/)
  })
})

describe('dentro das operações: `pode(acao, sujeito, linha)` decide sobre a linha', () => {
  it('o cancelador só cancela pedidos que o papel alcança; o gerente sem a regra `cancelar` específica não ganha por acidente', async () => {
    const g = await token('gus', A, ['gerente'])
    const meu = json(await req(g, 'POST', '/pedidos', { criadoPor: 'gus', total: '1' })).id
    expect((await req(await token('c', A, ['cancelador']), 'POST', `/pedidos/${meu}/cancelar`, {})).statusCode).toBe(200) // regra sem condição
    expect((await req(g, 'POST', `/pedidos/${meu}/cancelar`, {})).statusCode).toBe(200) // manage all inclui cancelar
    expect((await req(await token('l', A, ['leitor']), 'POST', `/pedidos/${meu}/cancelar`, {})).statusCode).toBe(403)
  })
})
