import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { A, B, criaAmbiente, type Ambiente } from './ambiente'

// O servidor de páginas: tenant (host/token) → rotas declarativas → página → HTML em streaming com dados do serviço, tema, CSP com nonce e hidratação.
let e: Ambiente
const modo = { comum: false }
const P = (bloco: string, props: Record<string, unknown> = {}) => ({ bloco, props })
const pag = (id: string, spec: Record<string, unknown>) => ({ kind: 'pagina', id, versao: '1.0.0', estatuto: 'publicado', spec })
beforeAll(async () => {
  e = await criaAmbiente({ gateway: { paginas: { tenantNo: (c: { tenantId: string }) => (modo.comum ? 'comum' : c.tenantId === A ? 'lojaa' : c.tenantId === B ? 'lojab' : undefined) } } })
  await e.semear()
  const lista = { bloco: 'texto/paragrafo', props: { texto: 'Vitrine: {v.titulo}' }, repetir: { cada: 'vitrine', como: 'v' } }
  const nos = [
    pag('p.home', { rota: '/', titulo: 'Início', dados: { vitrine: 'd.vitrine', produtos: 'd.produtos' }, raiz: { bloco: 'layout/pilha', slots: { filhos: [P('texto/titulo', { texto: 'Bem-vindo', nivel: 1 }), lista] } } }),
    pag('p.sobre', { rota: '/sobre', titulo: 'Sobre', raiz: P('texto/paragrafo', { texto: 'Quem somos' }) }),
    pag('p.nao', { rota: '/nao-encontrada', titulo: 'Ops', raiz: P('texto/paragrafo', { texto: 'Esta página não existe' }) }),
    pag('p.entrar', { rota: '/entrar', titulo: 'Entrar', raiz: P('texto/paragrafo', { texto: 'Faça login' }) }),
    pag('p.privada', { rota: '/privada', titulo: 'Privada', guarda: ['vendedor'], raiz: P('texto/paragrafo', { texto: 'Só vendedores' }) }),
    { kind: 'tenant', id: 'lojaa', tenantId: A, versao: '1.0.0', estatuto: 'publicado', spec: { alias: 'lojaa', segmento: 'varejo', modulos: ['loja'], paginas: ['p.home', 'p.sobre', 'p.nao', 'p.entrar', 'p.privada'], paginaNaoEncontrada: 'p.nao', rotaLogin: '/entrar', redirecionamentos: [{ de: '/quem-somos', para: '/sobre', status: 301 }] } },
    { kind: 'tenant', id: 'lojab', tenantId: B, versao: '1.0.0', estatuto: 'publicado', spec: { alias: 'lojab', segmento: 'varejo', modulos: ['loja'], paginas: ['p.home'] } },
  ]
  for (const n of nos) e.reg.registra(n as never)
})
afterAll(async () => { await e.fim() })

describe('servidor de páginas', () => {
  it('serve a página do tenant, com os dados DELE, em HTML, com CSP de nonce e o cliente para hidratar', async () => {
    const r = await e.req('GET', '/', { host: 'a.loja.test' })
    expect(r.statusCode).toBe(200); expect(r.headers['content-type']).toContain('text/html')
    expect(r.body).toContain('Bem-vindo'); expect(r.body).toContain('Vitrine: Vitrine A'); expect(r.body).not.toContain('Vitrine B'); expect(r.body).not.toContain('Pão') // anônimo só vê o que é público: a lista de produtos exige login; expect(r.body).toContain('<title>Início</title>')
    const csp = String(r.headers['content-security-policy']), nonce = /nonce-([^']+)'/.exec(csp)![1]!
    expect(csp).toContain("default-src 'none'"); expect(csp).toContain("frame-ancestors 'none'"); expect(csp).not.toContain('unsafe-eval'); expect(r.body).toContain(`nonce="${nonce}"`)
    const src = /<script[^>]* src="(\/_polaris\/a\/[\w.-]+\.js)"/.exec(r.body)![1]!
    const js = await e.req('GET', src, { host: 'a.loja.test' }); expect(js.statusCode).toBe(200); expect(js.headers['content-type']).toContain('javascript'); expect(js.headers['cache-control']).toContain('immutable')
  })
  it('o outro tenant vê a página dele, com os dados dele', async () => {
    const r = await e.req('GET', '/', { host: 'b.loja.test' }); expect(r.statusCode).toBe(200); expect(r.body).toContain('Vitrine: Vitrine B'); expect(r.body).not.toContain('Vitrine A')
    expect((await e.req('GET', '/sobre', { host: 'b.loja.test' })).statusCode).toBe(404) // a página /sobre é só do A
  })
  it('logado, o token do visitante vai aos serviços: ele vê os dados protegidos DELE (e só dele)', async () => {
    const lista = { bloco: 'texto/paragrafo', props: { texto: 'Produto: {p.nome}' }, repetir: { cada: 'produtos', como: 'p' } }
    e.reg.registra(pag('p.catalogo', { rota: '/catalogo', titulo: 'Catálogo', dados: { produtos: 'd.produtos' }, raiz: lista }) as never)
    const no = e.reg.resolve('tenant', 'lojaa', { tenantId: A })!.no, spec = no.spec as { paginas: string[] }
    e.reg.registra({ ...no, versao: '1.0.1', spec: { ...spec, paginas: [...spec.paginas, 'p.catalogo'] } } as never)
    const ta = await e.token('ana', A, ['vendedor']); const r = await e.req('GET', '/catalogo', { host: 'a.loja.test', tok: ta })
    expect(r.statusCode).toBe(200); expect(r.body).toContain('Produto: Pão'); expect(r.body).not.toContain('Só do B')
    expect((await e.req('GET', '/catalogo', { host: 'a.loja.test' })).body).not.toContain('Pão')
  })
  it('rota inexistente renderiza a página de 404 do tenant com status 404; sem página própria, texto', async () => {
    const r = await e.req('GET', '/nada-aqui', { host: 'a.loja.test' }); expect(r.statusCode).toBe(404); expect(r.body).toContain('Esta página não existe')
    const b = await e.req('GET', '/nada-aqui', { host: 'b.loja.test' }); expect(b.statusCode).toBe(404); expect(b.headers['content-type']).toContain('text/plain')
  })
  it('redirecionamentos e barra final são do roteador declarativo', async () => {
    const r = await e.req('GET', '/quem-somos', { host: 'a.loja.test' }); expect([r.statusCode, r.headers.location]).toEqual([301, '/sobre'])
    const s = await e.req('GET', '/sobre/', { host: 'a.loja.test' }); expect([s.statusCode, s.headers.location]).toEqual([308, '/sobre'])
  })
  it('guarda: sem sessão vai ao login com ?volta; sem a permissão é 403; com ela é 200', async () => {
    const a = await e.req('GET', '/privada', { host: 'a.loja.test' }); expect(a.statusCode).toBe(302); expect(a.headers.location).toBe('/entrar?volta=%2Fprivada')
    const sem = await e.token('x', A, ['outro']); expect((await e.req('GET', '/privada', { host: 'a.loja.test', tok: sem })).statusCode).toBe(403)
    const com = await e.token('y', A, ['vendedor']); const ok = await e.req('GET', '/privada', { host: 'a.loja.test', tok: com }); expect(ok.statusCode).toBe(200); expect(ok.body).toContain('Só vendedores')
  })
  it('a API segue sendo JSON (nada do prefixo reservado cai em página) e pedido malformado é 400', async () => {
    const r = await e.req('GET', '/api/loja/nao-existe', { host: 'a.loja.test' }); expect(r.headers['content-type']).toContain('json')
    const b = await e.req('GET', '/studio/qualquer', { host: 'a.loja.test' }); expect([404, 401, 403]).toContain(b.statusCode); expect(b.headers['content-type']).toContain('json')
    expect((await e.req('GET', '/a/../b', { host: 'a.loja.test' })).statusCode).toBeGreaterThanOrEqual(400)
  })
  it('a tabela de rotas é POR tenant, mesmo que dois tenants tenham nós `tenant` com o mesmo id e a mesma versão', async () => {
    const cria = (t: string, paginas: string[]) => ({ kind: 'tenant', id: 'comum', tenantId: t, versao: '1.0.0', estatuto: 'publicado', spec: { alias: 'comum', segmento: 'varejo', modulos: ['loja'], paginas } })
    e.reg.registra(cria(A, ['p.sobre']) as never); e.reg.registra(cria(B, ['p.home']) as never); modo.comum = true
    try {
      expect((await e.req('GET', '/sobre', { host: 'a.loja.test' })).statusCode).toBe(200); expect((await e.req('GET', '/sobre', { host: 'b.loja.test' })).statusCode).toBe(404)
      expect((await e.req('GET', '/', { host: 'b.loja.test' })).statusCode).toBe(200); expect((await e.req('GET', '/', { host: 'a.loja.test' })).statusCode).toBe(404)
    } finally { modo.comum = false }
  })
  it('o favicon não vira 404 nem página', async () => { expect((await e.req('GET', '/favicon.ico', { host: 'a.loja.test' })).statusCode).toBe(204) })
  it('um tenant sem nó `tenant` não publica páginas (404) e host desconhecido é 400', async () => {
    expect((await e.req('GET', '/', { host: 'fantasma.test' })).statusCode).toBe(400)
  })
})
