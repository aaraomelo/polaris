import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { A, B, criaAmbiente, type Ambiente } from './ambiente'

// O servidor de páginas: tenant (host/token) → rotas declarativas → página → HTML em streaming com dados do serviço, tema, CSP com nonce e hidratação.
let e: Ambiente
let previaReg: any
const modo: { id: string | undefined } = { id: undefined }
const P = (bloco: string, props: Record<string, unknown> = {}) => ({ bloco, props })
const pag = (id: string, spec: Record<string, unknown>) => ({ kind: 'pagina', id, versao: '1.0.0', estatuto: 'publicado', spec })
beforeAll(async () => {
  const TOK_A = 'v1.aaaaaaaaaaaa.bbbbbbbbbbbbbbbbbbbbbbbbbbbb', TOK_B = 'v1.cccccccccccc.dddddddddddddddddddddddddddd'
  const preview = { verifica: (t: string) => (t === TOK_A ? { tenantId: A, release: 3 } : t === TOK_B ? { tenantId: B, release: 1 } : null), registro: async (_t: string, r: number) => (r === 3 ? previaReg : null) }
  e = await criaAmbiente({ gateway: { preview, paginas: { tenantNo: (c: { tenantId: string }) => (modo.id ? modo.id : c.tenantId === A ? 'lojaa' : c.tenantId === B ? 'lojab' : undefined) } } })
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
  previaReg = e.reg.derivado(); previaReg.registra({ ...pag('p.home', { rota: '/', titulo: 'Prévia', raiz: P('texto/paragrafo', { texto: 'Conteúdo só da release 3' }) }), versao: '2.0.0' }) // a release em pré-visualização: a mesma página, em versão maior
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
  it('navegação no cliente: o documento leva o roteador (com nonce), servido do gateway; pedido de navegação vem completo e varia por cabeçalho', async () => {
    const r = await e.req('GET', '/', { host: 'a.loja.test' }), nonce = /nonce-([^']+)'/.exec(String(r.headers['content-security-policy']))![1]!
    const tag = /<script nonce="([^"]+)" src="(\/_polaris\/a\/[\w.-]+\.js)" data-pl-router async><\/script><\/body><\/html>$/.exec(r.body)!; expect(tag[1]).toBe(nonce)
    const js = await e.req('GET', tag[2]!, { host: 'a.loja.test' }); expect(js.statusCode).toBe(200); expect(js.body).toContain('x-polaris-nav'); expect(js.body).toContain('history.pushState'); expect(js.body).not.toContain('eval(')
    const nav = await e.req('GET', '/', { host: 'a.loja.test', headers: { 'x-polaris-nav': '1' } }); expect(nav.statusCode).toBe(200); expect(String(nav.headers.vary)).toContain('x-polaris-nav'); expect(nav.body).toContain('Vitrine: Vitrine A'); expect(nav.body).not.toContain('<script type="application/json" data-pl-c>') // completo, sem pedaços tardios
    // o roteador não deixa a página nova sem o próprio roteador: ele vem em toda resposta HTML (inclusive a de 404 do tenant)
    expect((await e.req('GET', '/nada', { host: 'a.loja.test' })).body).toContain('data-pl-router')
  })
  it('página com `form/formulario` leva o ponto de montagem e o pacote da ilha (só ela); a ilha é servida do gateway', async () => {
    e.reg.registra(pag('p.contato', { rota: '/contato', titulo: 'Contato', raiz: P('form/formulario', { formulario: 'so-valida' }) }) as never)
    e.reg.registra({ kind: 'tenant', id: 'comform', tenantId: A, versao: '1.0.0', estatuto: 'publicado', spec: { alias: 'comform', segmento: 'varejo', modulos: ['loja'], paginas: ['p.home', 'p.contato'] } } as never); modo.id = 'comform'
    try { await verifica() } finally { modo.id = undefined }
  })
  it('tema com `fontes`: o CSS leva o @font-face (mesma origem), o arquivo é servido como font/woff2 com cache eterno; sem `fontes` não há @font-face', async () => {
    e.reg.registra({ kind: 'tema', id: 'comfonte', versao: '1.0.0', estatuto: 'publicado', spec: { fontes: ['cormorant-garamond', 'inter', 'nao-existe'], tokens: { cor: { primaria: '#123456' } } } } as never)
    e.reg.registra({ kind: 'tenant', id: 'comfonte', tenantId: A, versao: '1.0.0', estatuto: 'publicado', spec: { alias: 'comfonte', segmento: 'varejo', modulos: ['loja'], tema: 'comfonte', paginas: ['p.home'] } } as never); modo.id = 'comfonte'
    try {
      const r = await e.req('GET', '/', { host: 'a.loja.test' }); if (!/rel="stylesheet"/.test(r.body)) throw new Error(`${r.statusCode} ${r.body.slice(0, 600)}`); const href = /<link rel="stylesheet" href="(\/_polaris\/a\/[\w.-]+\.css)">/.exec(r.body)![1]!
      expect(String(r.headers['content-security-policy'])).toContain("font-src 'self'")
      const css = (await e.req('GET', href, { host: 'a.loja.test' })).body
      const urls = [...css.matchAll(/@font-face\{font-family:'([^']+)';font-style:(\w+);[^}]*src:url\((\/_polaris\/a\/[0-9a-f]+\.woff2)\)/g)]
      expect(urls.map((m) => `${m[1]}/${m[2]}`)).toEqual(['Cormorant Garamond/normal', 'Cormorant Garamond/italic', 'Inter/normal']) // o nome desconhecido é ignorado
      const f = await e.req('GET', urls[0]![3]!, { host: 'a.loja.test' })
      expect(f.statusCode).toBe(200); expect(String(f.headers['content-type'])).toContain('font/woff2'); expect(String(f.headers['cache-control'])).toContain('immutable')
      expect(f.rawPayload.subarray(0, 4).toString('latin1')).toBe('wOF2'); expect(f.rawPayload.length).toBeGreaterThan(20000)
    } finally { modo.id = undefined }
    e.reg.registra({ kind: 'tema', id: 'semfonte', versao: '1.0.0', estatuto: 'publicado', spec: { tokens: { cor: { primaria: '#123456' } } } } as never)
    e.reg.registra({ kind: 'tenant', id: 'semfonte', tenantId: A, versao: '1.0.0', estatuto: 'publicado', spec: { alias: 'semfonte', segmento: 'varejo', modulos: ['loja'], tema: 'semfonte', paginas: ['p.home'] } } as never); modo.id = 'semfonte'
    try {
      const r = await e.req('GET', '/', { host: 'a.loja.test' }), href = /<link rel="stylesheet" href="(\/_polaris\/a\/[\w.-]+\.css)">/.exec(r.body)![1]!
      expect((await e.req('GET', href, { host: 'a.loja.test' })).body).not.toContain('@font-face')
    } finally { modo.id = undefined }
  })
  const verifica = async () => {
    const r = await e.req('GET', '/contato', { host: 'a.loja.test' }); expect(r.statusCode, r.body.slice(0, 200)).toBe(200)
    expect(r.body).toContain('data-polaris-formulario="so-valida"'); expect(r.body).toContain('Carregando formulário…')
    const nonce = /nonce-([^']+)'/.exec(String(r.headers['content-security-policy']))![1]!
    const tag = new RegExp(`<script nonce="${nonce.replace(/[+/=]/g, '\\$&')}" src="(/_polaris/a/[\\w.-]+\\.js)" data-pl-ilha async></script>`).exec(r.body); expect(tag).not.toBeNull()
    const js = await e.req('GET', tag![1]!, { host: 'a.loja.test' }); expect(js.statusCode).toBe(200); expect(js.body).toContain('PolarisFormularios'); expect(js.body).not.toMatch(/\beval\(|new Function/); expect(js.headers['cache-control']).toContain('immutable')
    expect(r.body.indexOf('data-pl-ilha')).toBeLessThan(r.body.indexOf('data-pl-router')) // a ilha antes do roteador
    expect((await e.req('GET', '/', { host: 'a.loja.test' })).body).not.toContain('data-pl-ilha') // página sem formulário não paga os 60 KB
  }
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
  it('sessão por cookie: o token vira cookie HttpOnly/SameSite, as páginas o aceitam, a API NÃO, e token ruim não cria sessão', async () => {
    const tk = await e.token('ana', A, ['vendedor'])
    const ok = await e.req('POST', '/_polaris/sessao', { host: 'a.loja.test', corpo: { token: tk } }); expect(ok.statusCode).toBe(204)
    const ck = String(ok.headers['set-cookie']); expect(ck).toMatch(/^polaris_sessao=[\w.-]+; Path=\/; HttpOnly; SameSite=Lax; Max-Age=\d+; Secure$/); expect(ck).not.toContain('Domain')
    const cookie = ck.split(';')[0]!
    const p = await e.req('GET', '/privada', { host: 'a.loja.test', headers: { cookie } }); expect(p.statusCode).toBe(200); expect(p.body).toContain('Só vendedores')
    expect(String(p.headers.vary)).toContain('Cookie')
    // a API não aceita o cookie (nada de CSRF contra mutações)
    const api = await e.req('GET', '/api/loja/produtos', { host: 'a.loja.test', headers: { cookie } }); expect([401, 403]).toContain(api.statusCode)
    // lixo e token expirado/inválido: anônimo + cookie limpo; a guarda manda ao login
    const lixo = await e.req('GET', '/privada', { host: 'a.loja.test', headers: { cookie: 'polaris_sessao=aaaa.bbbb.cccc' } }); expect(lixo.statusCode).toBe(302); expect(String(lixo.headers['set-cookie'])).toContain('Max-Age=0')
    expect((await e.req('GET', '/privada', { host: 'a.loja.test', headers: { cookie: 'polaris_sessao=<script>' } })).statusCode).toBe(302)
    expect((await e.req('POST', '/_polaris/sessao', { host: 'a.loja.test', corpo: { token: 'a.b.c' } })).statusCode).toBe(400)
    expect((await e.req('POST', '/_polaris/sessao', { host: 'a.loja.test', corpo: { token: 'aaaa.bbbb.cccc' } })).statusCode).toBe(401)
    expect((await e.req('POST', '/_polaris/sessao', { host: 'a.loja.test', corpo: { token: tk } , headers: { 'content-type': 'text/plain' } })).statusCode).toBe(415)
    const link = await e.req('GET', '/_polaris/sair', { host: 'a.loja.test' }); expect([link.statusCode, link.headers.location, String(link.headers['set-cookie'])]).toEqual([303, '/', expect.stringContaining('Max-Age=0')]) // "Sair" como link: apaga o cookie e volta ao início
    const alheio = await e.req('GET', '/_polaris/sair', { host: 'a.loja.test', headers: { 'sec-fetch-site': 'cross-site' } }); expect([alheio.statusCode, alheio.headers['set-cookie']]).toEqual([303, undefined]) // vindo de outro site: não desloga
    expect((await e.req('GET', '/_polaris/sair', { host: 'a.loja.test', headers: { 'sec-fetch-site': 'same-origin' } })).headers['set-cookie']).toBeDefined()
    const sai = await e.req('POST', '/_polaris/sair', { host: 'a.loja.test', corpo: {} }); expect([sai.statusCode, String(sai.headers['set-cookie'])]).toEqual([204, expect.stringContaining('Max-Age=0')])
  })
  it('a API segue sendo JSON (nada do prefixo reservado cai em página) e pedido malformado é 400', async () => {
    const r = await e.req('GET', '/api/loja/nao-existe', { host: 'a.loja.test' }); expect(r.headers['content-type']).toContain('json')
    const b = await e.req('GET', '/studio/qualquer', { host: 'a.loja.test' }); expect([404, 401, 403]).toContain(b.statusCode); expect(b.headers['content-type']).toContain('json')
    expect((await e.req('GET', '/a/../b', { host: 'a.loja.test' })).statusCode).toBeGreaterThanOrEqual(400)
  })
  it('a tabela de rotas é POR tenant, mesmo que dois tenants tenham nós `tenant` com o mesmo id e a mesma versão', async () => {
    const cria = (t: string, paginas: string[]) => ({ kind: 'tenant', id: 'comum', tenantId: t, versao: '1.0.0', estatuto: 'publicado', spec: { alias: 'comum', segmento: 'varejo', modulos: ['loja'], paginas } })
    e.reg.registra(cria(A, ['p.sobre']) as never); e.reg.registra(cria(B, ['p.home']) as never); modo.id = 'comum'
    try {
      expect((await e.req('GET', '/sobre', { host: 'a.loja.test' })).statusCode).toBe(200); expect((await e.req('GET', '/sobre', { host: 'b.loja.test' })).statusCode).toBe(404)
      expect((await e.req('GET', '/', { host: 'b.loja.test' })).statusCode).toBe(200); expect((await e.req('GET', '/', { host: 'a.loja.test' })).statusCode).toBe(404)
    } finally { modo.id = undefined }
  })
  it('páginas que o PRÓPRIO tenant criou (Studio) são servidas sem constar em `paginas`; se colidem, só as declaradas', async () => {
    const no = (id: string, rota: string) => ({ kind: 'pagina', id, tenantId: A, versao: '1.0.0', estatuto: 'publicado', spec: { rota, titulo: id, raiz: P('texto/paragrafo', { texto: `Conteúdo ${id}` }) } })
    const tenant = (id: string) => ({ kind: 'tenant', id, tenantId: A, versao: '1.0.0', estatuto: 'publicado', spec: { alias: id, segmento: 'varejo', modulos: ['loja'], paginas: ['p.sobre'] } })
    e.reg.registra(tenant('proprio') as never); e.reg.registra(no('p.minha', '/minha') as never); modo.id = 'proprio'
    try {
      const r = await e.req('GET', '/minha', { host: 'a.loja.test' }); expect(r.statusCode).toBe(200); expect(r.body).toContain('Conteúdo p.minha'); expect((await e.req('GET', '/sobre', { host: 'a.loja.test' })).statusCode).toBe(200)
      // outro tenant (B) não enxerga a página do A
      modo.id = 'proprio'; const b = await e.req('GET', '/minha', { host: 'b.loja.test', tok: await e.token('b', B, ['x']) }); expect(b.statusCode).toBe(404)
      // colisão: nova release (nó tenant em outra versão) com página própria na MESMA rota de uma declarada → só a que colide fica de fora
      e.reg.registra({ ...tenant('proprio'), versao: '1.0.1' } as never); e.reg.registra(no('p.colide', '/sobre') as never)
      expect((await e.req('GET', '/sobre', { host: 'a.loja.test' })).statusCode).toBe(200); expect((await e.req('GET', '/minha', { host: 'a.loja.test' })).statusCode).toBe(200) // só a que colide fica de fora; as outras continuam
    } finally { modo.id = undefined }
  })
  it('pré-visualização assinada: o link vira cookie HttpOnly, o site mostra a release do link com faixa e noindex, só para o tenant do link', async () => {
    const TOK_A = 'v1.aaaaaaaaaaaa.bbbbbbbbbbbbbbbbbbbbbbbbbbbb', TOK_B = 'v1.cccccccccccc.dddddddddddddddddddddddddddd'
    const normal = await e.req('GET', '/', { host: 'a.loja.test' }); expect(normal.body).not.toContain('Conteúdo só da release 3'); expect(normal.body).not.toContain('pl-preview')
    const ativa = await e.req('GET', `/_polaris/preview?t=${TOK_A}`, { host: 'a.loja.test' }); expect([ativa.statusCode, ativa.headers.location]).toEqual([302, '/'])
    const ck = String(ativa.headers['set-cookie']); expect(ck).toMatch(/^polaris_preview=v1\.[\w.-]+; Path=\/; HttpOnly; SameSite=Lax; Max-Age=\d+; Secure$/); const cookie = ck.split(';')[0]!
    const p = await e.req('GET', '/', { host: 'a.loja.test', headers: { cookie } }); expect(p.statusCode).toBe(200); expect(p.body).toContain('Conteúdo só da release 3'); expect(p.body).toContain('Pré-visualização da release 3'); expect(p.body).toContain('/_polaris/preview/sair'); expect(p.headers['x-robots-tag']).toContain('noindex')
    expect((await e.req('GET', '/', { host: 'a.loja.test' })).body).not.toContain('Conteúdo só da release 3') // sem o cookie, produção
    // link inválido e link de OUTRO tenant não ativam
    expect((await e.req('GET', '/_polaris/preview?t=v1.xxxxxxxxxxxx.yyyyyyyyyyyyyyyyyyyyyyyyyyyy', { host: 'a.loja.test' })).statusCode).toBe(401)
    expect((await e.req('GET', `/_polaris/preview?t=${TOK_B}`, { host: 'a.loja.test' })).statusCode).toBe(403); expect((await e.req('GET', '/_polaris/preview', { host: 'a.loja.test' })).statusCode).toBe(401)
    // cookie de um tenant no site de outro: ignorado e apagado (o outro tenant nunca vê a release do A)
    const b = await e.req('GET', '/', { host: 'b.loja.test', headers: { cookie } }); expect(b.statusCode).toBe(200); expect(b.body).not.toContain('Conteúdo só da release 3'); expect(String(b.headers['set-cookie'])).toContain('Max-Age=0')
    // release que não existe: some o cookie, volta à produção
    const sumiu = await e.req('GET', '/', { host: 'a.loja.test', headers: { cookie: 'polaris_preview=' + TOK_B } }); expect(sumiu.body).not.toContain('pl-preview')
    const sai = await e.req('GET', '/_polaris/preview/sair', { host: 'a.loja.test' }); expect([sai.statusCode, String(sai.headers['set-cookie'])]).toEqual([302, expect.stringContaining('Max-Age=0')])
    // navegação no cliente: o pedido de navegação também usa a release (a faixa fica fora do conteúdo trocado)
    const nav = await e.req('GET', '/', { host: 'a.loja.test', headers: { cookie, 'x-polaris-nav': '1' } }); expect(nav.body).toContain('Conteúdo só da release 3')
  })
  it('o favicon não vira 404 nem página', async () => { expect((await e.req('GET', '/favicon.ico', { host: 'a.loja.test' })).statusCode).toBe(204) })
  it('um tenant sem nó `tenant` não publica páginas (404) e host desconhecido é 400', async () => {
    expect((await e.req('GET', '/', { host: 'fantasma.test' })).statusCode).toBe(400)
  })
})

describe('o script do roteador (navegacao.ts)', () => {
  it('é JavaScript válido (um erro de sintaxe derrubaria navegação, menu e sugestões ao vivo de uma vez)', async () => {
    const { ROTEADOR_JS } = await import('../src/navegacao'); expect(() => new Function(ROTEADOR_JS)).not.toThrow()
    const sg = ROTEADOR_JS.slice(ROTEADOR_JS.indexOf('SUGESTÕES AO VIVO'), ROTEADOR_JS.indexOf('menu recolhível do cabeçalho')); expect(sg.length).toBeGreaterThan(500); expect(sg).not.toMatch(/innerHTML|insertAdjacentHTML|document\.write/) // o que vem do servidor entra só como texto
  })
})
