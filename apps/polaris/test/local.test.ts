process.env.POLARIS_LOG_NIVEL = 'silencio'
import { vi } from 'vitest'
vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 })
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { request as httpRequest } from 'node:http'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { existsSync } from 'node:fs'
import { chromium } from 'playwright-core'
import { afterAll, describe, expect, it } from 'vitest'
import { PAPEIS_LOCAIS, SENHA_LOCAL, emailLocal, sobeLocal, type Local } from '../src/local'

// O ambiente local de ponta a ponta: Postgres (PGlite com protocolo), serviço migrado, gateway, Studio e o login de desenvolvimento.
const dir = mkdtempSync(join(tmpdir(), 'polaris-local-')); const abertos: Local[] = []
const sobe = async (dados: string | null) => { const l = await sobeLocal({ dados, porta: 0, silencioso: true }); abertos.push(l); return l }
afterAll(async () => { for (const l of abertos) await l.fecha().catch(() => {}); rmSync(dir, { recursive: true, force: true }) })
// `fetch` não deixa trocar o cabeçalho Host; o tenant sai do Host, então as chamadas usam node:http
const req = (l: Local, alias: string, metodo: string, caminho: string, token?: string, corpo?: unknown, extra: Record<string, string> = {}): Promise<{ status: number; headers: { get(k: string): string | null }; text(): Promise<string>; json(): Promise<unknown> }> => new Promise((ok, falha) => {
  const r = httpRequest({ host: '127.0.0.1', port: l.porta, method: metodo, path: caminho, headers: { host: alias === 'apex' ? `localhost:${l.porta}` : `${alias}.polaris.localhost:${l.porta}`, ...(token ? { authorization: `Bearer ${token}` } : {}), ...(corpo !== undefined ? { 'content-type': 'application/json' } : {}), ...extra } }, (res) => {
    const partes: Buffer[] = []; res.on('data', (c) => partes.push(c)); res.on('end', () => { const t = Buffer.concat(partes).toString('utf8'); ok({ status: res.statusCode!, headers: { get: (k) => { const v = res.headers[k.toLowerCase()]; return Array.isArray(v) ? v[0]! : (v ?? null) } }, text: async () => t, json: async () => JSON.parse(t) }) })
  }); r.on('error', falha); if (corpo !== undefined) r.write(JSON.stringify(corpo)); r.end()
})
const get = (l: Local, alias: string, caminho: string, token?: string) => req(l, alias, 'GET', caminho, token)

describe('ambiente local', () => {
  it('login de desenvolvimento → token → Studio e API da loja pelo gateway, isolados por tenant', async () => {
    const l = await sobe(null)
    const jwks = await get(l, 'loja-demo', '/.well-known/jwks.json'); expect(jwks.status).toBe(200); const ks = ((await jwks.json()) as { keys: Array<Record<string, unknown>> }).keys; expect(ks).toHaveLength(1); expect(ks[0]).toMatchObject({ kty: 'EC', alg: 'ES256' }); expect(ks[0]).not.toHaveProperty('d') // só a pública
    const pagina = await (await get(l, 'apex', '/entrar')).text(); expect(pagina).toContain('Loja Demo'); expect(pagina).toContain('studio.editor') // o índice só no endereço SEM tenant
    const doSite = await (await get(l, 'loja-demo', '/entrar?volta=%2Fprodutos')).text(); expect(doSite).toContain('data-polaris-formulario="identidade.entrar"'); expect(doSite).not.toContain('Outra Loja') // no endereço do tenant, é a PÁGINA de login do sistema (o formulário)
    const ir = await get(l, 'loja-demo', '/entrar/ir?tenant=loja-demo&papel=studio.editor&usuario=ana'); expect(ir.status).toBe(302)
    const loc = ir.headers.get('location')!; expect(loc).toMatch(new RegExp(`^http://loja-demo\\.polaris\\.localhost:${l.porta}/studio#token=[\\w.-]+$`))
    const tk = /#token=(.+)$/.exec(loc)![1]!
    const studio = await get(l, 'loja-demo', '/studio'); expect(studio.status).toBe(200); expect(studio.headers.get('content-security-policy')).toContain("frame-ancestors 'none'")
    const nos = await get(l, 'loja-demo', '/studio/nos', tk); expect(nos.status).toBe(200); expect(((await nos.json()) as any).base.tema).toContain('padrao')
    // a loja: gerente cria, o outro tenant não vê
    const gerente = await l.token('loja-demo', ['gerente']), outro = await l.token('loja-outra', ['gerente'])
    const cria = await req(l, 'loja-demo', 'POST', '/api/loja/produtos', gerente, { nome: 'Café', preco: '49.90' }); expect(cria.status).toBe(201)
    expect(JSON.stringify(await (await get(l, 'loja-demo', '/api/loja/produtos', gerente)).json())).toContain('Café'); expect(JSON.stringify(await (await get(l, 'loja-outra', '/api/loja/produtos', outro)).json())).not.toContain('Café')
    // token do tenant A no host do B é recusado
    expect((await get(l, 'loja-outra', '/studio/nos', tk)).status).toBe(401)
  })
  it('serve o SITE de cada tenant: página declarada em JSON, dados da loja DELE, 404 próprio e rotas da API intactas', async () => {
    const l = await sobe(null)
    const demo = await get(l, 'loja-demo', '/'); expect(demo.status).toBe(200); expect(demo.headers.get('content-type')).toContain('text/html')
    const h = await demo.text(); expect(h).toContain('Bem-vindo à loja'); expect(h).toContain('Café de Loja Demo'); expect(h).not.toContain('Outra Loja')
    expect(h).toMatch(/<link rel="stylesheet" href="\/_polaris\/a\/[\w.-]+\.css">/) // o tema padrão
    const outra = await (await get(l, 'loja-outra', '/')).text(); expect(outra).toContain('Café de Outra Loja'); expect(outra).not.toContain('Loja Demo')
    expect((await get(l, 'loja-demo', '/sobre')).status).toBe(200)
    const nao = await get(l, 'loja-demo', '/nao-existe'); expect(nao.status).toBe(404); expect(await nao.text()).toContain('Página não encontrada')
    expect((await get(l, 'loja-demo', '/api/loja/destaques')).status).toBe(200) // a API pública continua JSON
  })
  it('login do SITE por cookie: a página protegida manda ao login, o login grava o cookie e volta para ela; a API não aceita o cookie', async () => {
    const l = await sobe(null), gerente = await l.token('loja-demo', ['gerente'])
    await req(l, 'loja-demo', 'POST', '/api/loja/produtos', gerente, { nome: 'Café', preco: '49.90' })
    const anon = await get(l, 'loja-demo', '/produtos'); expect([anon.status, anon.headers.get('location')]).toEqual([302, '/entrar?volta=%2Fprodutos'])
    const ir = await get(l, 'loja-demo', '/entrar/ir?tenant=loja-demo&papel=gerente&para=site&volta=%2Fprodutos'); expect(ir.status).toBe(302)
    const ck = ir.headers.get('set-cookie')!; expect(ck).toMatch(/^polaris_sessao=[\w.-]+; Path=\/; HttpOnly; SameSite=Lax/); expect(ir.headers.get('location')).toMatch(/\/produtos$/)
    const cookie = ck.split(';')[0]!
    const pagina = await req(l, 'loja-demo', 'GET', '/produtos', undefined, undefined, { cookie }); expect(pagina.status).toBe(200); expect(await pagina.text()).toContain('Café')
    expect((await req(l, 'loja-demo', 'GET', '/api/loja/produtos', undefined, undefined, { cookie })).status).toBeGreaterThanOrEqual(401) // o cookie só vale para páginas
    const outro = await ir.headers.get('location')!; expect(outro).not.toContain('token') // nada de token na URL
    expect((await get(l, 'loja-demo', '/entrar/ir?tenant=loja-demo&papel=gerente&para=site&volta=%2F%2Fmal.com')).headers.get('location')).toMatch(/polaris\.localhost:\d+\/$/) // volta externa vira /
  })
  it('a Maison lê os produtos da API do catálogo (loja.peca): páginas por idioma, preço e ordem vindos do serviço, e isolado por tenant', async () => {
    const l = await sobeLocal({ dados: null, porta: 0, silencioso: true, site: join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', 'exemplos', 'maison') }); abertos.push(l)
    const api = await get(l, 'loja-demo', '/api/loja/pecas?limite=100') // a listagem é pública (o site a chama sem login)
    expect(api.status).toBe(200); const itens = (await api.json()) as Array<{ slug: string; preco: string; nome: Record<string, string>; fotoUrl: string }>
    expect(itens).toHaveLength(13); expect(itens.find((i) => i.slug === 'arco')).toMatchObject({ preco: '485.0000', nome: { 'pt-BR': 'Luminária Pendente Arco', en: 'Arc Pendant Light' } }); expect(itens[0]!.fotoUrl).toMatch(/^\/_polaris\/img\//) // a foto virou o ativo do tenant
    const pt = await (await get(l, 'loja-demo', '/produtos')).text(), en = await (await get(l, 'loja-demo', '/en/produtos')).text()
    expect(pt).toContain('Luminária Pendente Arco'); expect(en).toContain('Arc Pendant Light'); expect(pt.match(/data-marca="cartao-produto"/g)).toHaveLength(13)
    const detalhe = await get(l, 'loja-demo', '/produtos/mesa'); expect(detalhe.status).toBe(200); expect(await detalhe.text()).toContain('2850')
    // o catálogo é do tenant: a outra loja tem o seu
    const outra = await (await get(l, 'loja-outra', '/api/loja/pecas?limite=100')).json() as unknown[]; expect(outra).toHaveLength(13)
  })

  it('Studio → Publicar → site: a edição salva só aparece depois de publicada, no tenant certo; página nova ganha rota sozinha', async () => {
    const l = await sobe(null), ed = await l.token('loja-demo', ['studio.editor'], 'ana')
    const home = ((await (await req(l, 'loja-demo', 'GET', '/studio/nos/pagina/site.home', ed)).json()) as any).no
    home.spec.raiz.slots.filhos[1].props.titulo = 'Título vindo do Studio'
    const put = await req(l, 'loja-demo', 'PUT', '/studio/nos/pagina/site.home', ed, { no: home }); expect(put.status, await put.text()).toBe(201)
    const nova = { kind: 'pagina', id: 'site.novidades', versao: '1.0.0', estatuto: 'publicado', spec: { rota: '/novidades', titulo: 'Contato', raiz: { bloco: 'texto/titulo', props: { texto: 'Novidades da loja', nivel: 1 } } } }
    expect((await req(l, 'loja-demo', 'PUT', '/studio/nos/pagina/site.novidades', ed, { no: nova })).status).toBe(201)
    expect(await (await get(l, 'loja-demo', '/')).text()).not.toContain('Título vindo do Studio') // salvo, mas ainda não publicado
    expect((await get(l, 'loja-demo', '/novidades')).status).toBe(404)
    const pub = await req(l, 'loja-demo', 'POST', '/studio/publicar', ed, {}); expect(pub.status).toBe(200); expect(((await pub.json()) as any).release).toBe(1)
    expect(await (await get(l, 'loja-demo', '/')).text()).toContain('Título vindo do Studio')
    const c = await get(l, 'loja-demo', '/novidades'); expect(c.status).toBe(200); expect(await c.text()).toContain('Novidades da loja')
    expect(await (await get(l, 'loja-outra', '/')).text()).not.toContain('Título vindo do Studio'); expect((await get(l, 'loja-outra', '/novidades')).status).toBe(404) // o outro tenant não muda
    const leitor = await l.token('loja-demo', ['studio.leitor']); expect((await req(l, 'loja-demo', 'POST', '/studio/publicar', leitor, {})).status).toBe(403)
  })
  it('releases: lista, diferença e rollback; o site volta para a versão anterior e só neste tenant', async () => {
    const l = await sobe(null), ed = await l.token('loja-demo', ['studio.editor'], 'ana')
    const titulo = async (v: string) => { const home = ((await (await req(l, 'loja-demo', 'GET', '/studio/nos/pagina/site.home', ed)).json()) as any).no; home.spec.raiz.slots.filhos[1].props.titulo = v; expect((await req(l, 'loja-demo', 'PUT', '/studio/nos/pagina/site.home', ed, { no: home })).status).toBe(201); expect((await req(l, 'loja-demo', 'POST', '/studio/publicar', ed, {})).status).toBe(200) }
    const lista = async () => (await (await req(l, 'loja-demo', 'GET', '/studio/releases', ed)).json()) as { producao: number | null; anterior: number | null; releases: Array<{ numero: number }> }
    expect(await lista()).toMatchObject({ producao: null, releases: [] })
    await titulo('Primeira'); await titulo('Segunda')
    const a = await lista(); expect([a.producao, a.anterior, a.releases.map((r) => r.numero)]).toEqual([2, 1, [2, 1]])
    expect(await (await get(l, 'loja-demo', '/')).text()).toContain('Segunda')
    const d = (await (await req(l, 'loja-demo', 'GET', '/studio/releases/diff?de=2&para=1', ed)).json()) as { alterados: string[] }; expect(d.alterados.some((k) => k.includes('site.home'))).toBe(true)
    const v = await req(l, 'loja-demo', 'POST', '/studio/releases/voltar', ed, {}); expect(v.status).toBe(200); expect(await v.json()).toMatchObject({ ok: true, producao: 1, anterior: 2 })
    expect(await (await get(l, 'loja-demo', '/')).text()).toContain('Primeira') // o site voltou
    expect((await req(l, 'loja-demo', 'POST', '/studio/releases/voltar', ed, { para: 2 })).status).toBe(200); expect(await (await get(l, 'loja-demo', '/')).text()).toContain('Segunda') // e avança de novo para uma release específica
    expect((await req(l, 'loja-demo', 'POST', '/studio/releases/voltar', ed, { para: 99 })).status).toBe(422)
    expect((await req(l, 'loja-demo', 'POST', '/studio/releases/voltar', await l.token('loja-demo', ['studio.leitor']), {})).status).toBe(403)
    expect(await (await get(l, 'loja-outra', '/')).text()).not.toContain('Segunda')
  })
  it('preview assinado: o link de uma release antiga mostra aquele site (faixa, noindex) sem mexer na produção, só neste tenant', async () => {
    const l = await sobe(null), ed = await l.token('loja-demo', ['studio.editor'], 'ana'), com = await l.token('loja-demo', ['studio.comentarista'], 'bia')
    const publica = async (v: string) => { const home = ((await (await req(l, 'loja-demo', 'GET', '/studio/nos/pagina/site.home', ed)).json()) as any).no; home.spec.raiz.slots.filhos[1].props.titulo = v; await req(l, 'loja-demo', 'PUT', '/studio/nos/pagina/site.home', ed, { no: home }); await req(l, 'loja-demo', 'POST', '/studio/publicar', ed, {}) }
    await publica('Versão antiga'); await publica('Versão nova')
    const r = await req(l, 'loja-demo', 'POST', '/studio/releases/preview', com, { release: 1 }); expect(r.status).toBe(200) // quem comenta emite o link
    const { caminho } = (await r.json()) as { caminho: string }; expect(caminho).toMatch(/^\/_polaris\/preview\?t=v1\./)
    expect((await req(l, 'loja-demo', 'POST', '/studio/releases/preview', await l.token('loja-demo', ['studio.leitor']), { release: 1 })).status).toBe(403)
    const nav = await chromium.launch({ executablePath: CHROME!, args: ['--no-sandbox', '--host-resolver-rules=MAP *.polaris.localhost 127.0.0.1'] })
    try {
      const ctx = await nav.newContext(), p = await ctx.newPage(), erros: string[] = []; p.on('pageerror', (e) => erros.push(e.message)); p.on('console', (m) => { if (m.type() === 'error') erros.push(`${m.text()} ${m.location().url}`) })
      await p.goto(`http://loja-demo.polaris.localhost:${l.porta}/`); await p.getByRole('heading', { name: 'Versão nova' }).waitFor() // produção
      await p.goto(`http://loja-demo.polaris.localhost:${l.porta}${caminho}`); await p.getByRole('heading', { name: 'Versão antiga' }).waitFor(); await p.getByText(/Pré-visualização da release 1/).waitFor()
      expect(p.url()).toBe(`http://loja-demo.polaris.localhost:${l.porta}/`); expect(await p.evaluate(() => document.cookie)).not.toContain('polaris_preview') // HttpOnly
      await p.getByRole('link', { name: 'Sobre' }).click(); await p.getByRole('heading', { name: 'Sobre' }).waitFor(); await p.getByText(/Pré-visualização da release 1/).waitFor() // a navegação no cliente mantém a faixa
      await p.getByRole('link', { name: 'sair' }).click(); await p.getByRole('heading', { name: 'Versão nova' }).waitFor(); await expect.poll(() => p.locator('#pl-preview').count()).toBe(0)
      // sem o cookie, outro visitante vê a produção
      const outro = await (await ctx.browser()!.newContext()).newPage(); await outro.goto(`http://loja-demo.polaris.localhost:${l.porta}/`); await outro.getByRole('heading', { name: 'Versão nova' }).waitFor()
      // o link no site de OUTRO tenant é recusado
      expect((await get(l, 'loja-outra', caminho)).status).toBe(403)
      expect(erros.join(' | ')).toBe('')
    } finally { await nav.close() }
  })
  it('tema do site: escolher no Studio, publicar e o site passa a usar o CSS do tema (só neste tenant)', async () => {
    const l = await sobe(null), ed = await l.token('loja-demo', ['studio.editor'], 'ana')
    const css = async (alias: string) => { const h = await (await get(l, alias, '/')).text(); const href = /href="(\/_polaris\/a\/[\w.-]+\.css)"/.exec(h)![1]!; return (await get(l, alias, href)).text() }
    const site = (await (await req(l, 'loja-demo', 'GET', '/studio/site', ed)).json()) as { tema: string | null; temas: string[] }; expect(site.tema).toBeNull(); expect(site.temas).toContain('graphite')
    const antes = await css('loja-demo'); const pu = await req(l, 'loja-demo', 'PUT', '/studio/site', ed, { tema: 'graphite' }); expect(pu.status, await pu.text()).toBe(200)
    expect(await css('loja-demo')).toBe(antes) // escolhido, mas ainda não publicado
    expect((await req(l, 'loja-demo', 'POST', '/studio/publicar', ed, {})).status).toBe(200)
    const depois = await css('loja-demo'); expect(depois).not.toBe(antes); expect(await css('loja-outra')).toBe(antes)
    expect(((await (await req(l, 'loja-demo', 'GET', '/studio/site', ed)).json()) as { tema: string }).tema).toBe('graphite')
    expect((await req(l, 'loja-demo', 'PUT', '/studio/site', ed, { tema: 'inexistente' })).status).toBe(422)
  })
  it('o login recusa tenant, papel e usuário inválidos; papel sem permissão no Studio dá 403', async () => {
    const l = await sobe(null)
    for (const q of ['tenant=nao-existe&papel=studio.editor', 'tenant=loja-demo&papel=admin', 'tenant=loja-demo&papel=studio.editor&usuario=A%20B', 'tenant=loja-demo', 'tenant=loja-demo&papel=studio.editor&usuario=%3Cscript%3E']) expect((await get(l, 'loja-demo', `/entrar/ir?${q}`)).status, q).toBe(400)
    expect((await get(l, 'loja-demo', '/studio/nos', await l.token('loja-demo', ['gerente']))).status).toBe(403)
    for (const p of PAPEIS_LOCAIS) expect((await get(l, 'loja-demo', `/entrar/ir?tenant=loja-demo&papel=${p}`)).status).toBe(302)
    expect((await get(l, 'apex', '/entrar/ir?papel=studio.editor')).status).toBe(400) // sem tenant no endereço nem no pedido
    expect((await get(l, 'loja-demo', '/entrar/ir?papel=studio.editor')).status).toBe(302) // o tenant vem do endereço
    const outro = await get(l, 'apex', '/entrar/ir?tenant=loja-demo&papel=gerente&para=site&volta=%2Fprodutos') // cookie é do endereço: do apex, refaz no do tenant
    expect([outro.status, outro.headers.get('set-cookie')]).toEqual([302, null]); expect(outro.headers.get('location')).toMatch(/^http:\/\/loja-demo\.polaris\.localhost:\d+\/entrar\/ir\?/)
    await expect(l.token('inexistente', [])).rejects.toThrow(/desconhecido/)
  })
  it('os dados persistem entre execuções (reabrir a mesma pasta traz o que foi gravado) e subir de novo é idempotente', async () => {
    const pasta = join(dir, 'pg'), a = await sobe(pasta)
    const tk = await a.token('loja-demo', ['studio.editor'], 'ana'), no = { kind: 'tema', id: 'persistido', versao: '1.0.0', estatuto: 'publicado', spec: { tokens: { cor: { primaria: '#123456' } } } }
    const r = await req(a, 'loja-demo', 'PUT', '/studio/nos/tema/persistido', tk, { no }); expect(r.status).toBe(201)
    await a.fecha(); abertos.splice(abertos.indexOf(a), 1)
    const b = await sobe(pasta); const lido = await get(b, 'loja-demo', '/studio/nos/tema/persistido', await b.token('loja-demo', ['studio.leitor']))
    expect(lido.status).toBe(200); expect(((await lido.json()) as any)).toMatchObject({ origem: 'tenant', seq: 1 })
  })
  it('duas instâncias na MESMA pasta de dados é erro (o PGlite é de um processo só); encerra mesmo com conexão keep-alive aberta', async () => {
    const pasta = join(dir, 'pg-trava'); mkdirSync(dir, { recursive: true }); writeFileSync(join(dir, 'ambiente.pid'), String(process.ppid)) // outro processo vivo usando a pasta
    await expect(sobeLocal({ dados: pasta, porta: 0, silencioso: true })).rejects.toThrow(/já há um ambiente local usando estes dados/)
    writeFileSync(join(dir, 'ambiente.pid'), '999999999') // trava velha (processo morto): é ignorada
    const a = await sobe(pasta)
    const { Agent, request } = await import('node:http'), agente = new Agent({ keepAlive: true })
    await new Promise<void>((ok, falha) => { const r = request({ host: '127.0.0.1', port: a.porta, path: '/entrar', agent: agente, headers: { host: `x.polaris.localhost:${a.porta}` } }, (res) => { res.resume(); res.on('end', ok) }); r.on('error', falha); r.end() })
    const t0 = Date.now(); await a.fecha(); abertos.splice(abertos.indexOf(a), 1); agente.destroy()
    expect(Date.now() - t0).toBeLessThan(5000) // com uma conexão ociosa aberta, o fechamento não pode ficar esperando por ela
    const b = await sobe(pasta); expect(b.porta).toBeGreaterThan(0) // e a trava foi liberada
  })
  it('recusa produção e recusa subir sem o Studio empacotado', async () => {
    await expect(sobeLocal({ dados: null, studioDir: join(dir, 'nao-existe'), silencioso: true })).rejects.toThrow(/Studio não foi empacotado/)
    const antes = process.env.NODE_ENV; process.env.NODE_ENV = 'production'
    try { await expect(sobeLocal({ dados: null, silencioso: true })).rejects.toThrow(/não roda com NODE_ENV=production/) } finally { if (antes === undefined) delete process.env.NODE_ENV; else process.env.NODE_ENV = antes }
  })
})

const CHROME = process.env.CHROME ?? ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find(existsSync)
describe.skipIf(!CHROME)('ambiente local no navegador', () => {
  it('abre o site do tenant no navegador: HTML renderizado no servidor, hidratado sem erros, navegando para /sobre', async () => {
    const l = await sobe(null), nav = await chromium.launch({ executablePath: CHROME!, args: ['--no-sandbox', '--host-resolver-rules=MAP *.polaris.localhost 127.0.0.1'] })
    try {
      const p = await nav.newPage(), erros: string[] = []; p.on('pageerror', (e) => erros.push(e.message)); p.on('console', (m) => { if (m.type() === 'error') erros.push(`${m.text()} ${m.location().url}`) })
      await p.goto(`http://loja-demo.polaris.localhost:${l.porta}/`); await p.getByRole('heading', { name: 'Bem-vindo à loja' }).waitFor(); await p.getByText('Café de Loja Demo').waitFor()
      await p.getByRole('link', { name: 'Sobre' }).click(); await p.waitForURL(/\/sobre$/); await p.getByRole('heading', { name: 'Sobre' }).waitFor()
      expect(erros.join(' | ')).toBe('')
    } finally { await nav.close() }
  })
  it('no navegador: Produtos (protegida) leva ao login SEM recarregar → entrar → volta para ela já logada → sair', async () => {
    const l = await sobe(null), nav = await chromium.launch({ executablePath: CHROME!, args: ['--no-sandbox', '--host-resolver-rules=MAP *.polaris.localhost 127.0.0.1'] })
    try {
      const p = await nav.newPage(), erros: string[] = [], docs: string[] = []; p.on('pageerror', (e) => erros.push(e.message)); p.on('console', (m) => { if (m.type() === 'error') erros.push(`${m.text()} ${m.location().url}`) }); p.on('request', (r) => { if (r.resourceType() === 'document') docs.push(r.url()) })
      await p.goto(`http://loja-demo.polaris.localhost:${l.porta}/`); await p.waitForFunction(() => (window as any).Polaris?.inicia); await p.evaluate(() => { (window as any).__marca = 'mesma' }); const n0 = docs.length
      await p.getByRole('link', { name: /Produtos/ }).click() // visitante: a guarda manda ao login, que é uma PÁGINA do site: troca no cliente, sem recarregar
      await p.getByRole('heading', { name: 'Entrar' }).waitFor(); expect(p.url()).toContain('/entrar?volta=%2Fprodutos'); expect(await p.evaluate(() => (window as any).__marca)).toBe('mesma'); expect(docs.length).toBe(n0)
      await p.getByLabel('E-mail').fill(emailLocal('loja-demo')); await p.getByLabel('Senha').fill(SENHA_LOCAL); await p.getByRole('button', { name: 'Entrar' }).click() // login REAL: grava o cookie e volta para onde a guarda mandou (navegação normal: muda a sessão)
      await p.waitForURL(/\/produtos$/); await p.getByRole('heading', { name: 'Produtos' }).waitFor()
      expect(await p.evaluate(() => document.cookie)).not.toContain('polaris_sessao') // HttpOnly: o JavaScript não enxerga
      await p.evaluate(() => fetch('/_polaris/sair', { method: 'POST' })); await p.reload(); await p.waitForURL(/\/entrar\?volta=/)
      expect(erros.filter((x) => !/status of (401|403)/.test(x)).join(' | ')).toBe('')
    } finally { await nav.close() }
  })
  it('navegação no cliente: clicar num link troca a página SEM recarregar; voltar/avançar funcionam; clique com Ctrl e link externo seguem o normal', async () => {
    const l = await sobe(null), nav = await chromium.launch({ executablePath: CHROME!, args: ['--no-sandbox', '--host-resolver-rules=MAP *.polaris.localhost 127.0.0.1'] })
    try {
      const p = await nav.newPage(), erros: string[] = [], pedidos: string[] = []
      p.on('pageerror', (e) => erros.push(e.message)); p.on('console', (m) => { if (m.type() === 'error') erros.push(`${m.text()} ${m.location().url}`) }); p.on('request', (r) => { if (r.resourceType() === 'document') pedidos.push(r.url()) })
      await p.goto(`http://loja-demo.polaris.localhost:${l.porta}/`); await p.getByRole('heading', { name: 'Bem-vindo à loja' }).waitFor()
      await p.waitForFunction(() => (window as any).Polaris?.inicia) // o cliente carregou
      await p.evaluate(() => { (window as any).__marca = 'mesma-pagina' }); const docs0 = pedidos.length
      await p.getByRole('link', { name: 'Sobre' }).click(); await p.getByRole('heading', { name: 'Sobre' }).waitFor(); await p.waitForURL(/\/sobre$/)
      expect(await p.evaluate(() => (window as any).__marca)).toBe('mesma-pagina') // o documento NÃO foi recarregado
      expect(pedidos.length).toBe(docs0); expect(await p.title()).toBe('Sobre')
      await p.getByRole('link', { name: 'Início' }).click(); await p.getByText('Café de Loja Demo').waitFor() // a página com dados volta hidratada
      expect(await p.evaluate(() => (window as any).__marca)).toBe('mesma-pagina'); expect(pedidos.length).toBe(docs0)
      await p.goBack(); await p.getByRole('heading', { name: 'Sobre' }).waitFor(); expect(p.url()).toMatch(/\/sobre$/)
      await p.goForward(); await p.getByText('Café de Loja Demo').waitFor(); expect(await p.evaluate(() => (window as any).__marca)).toBe('mesma-pagina')
      // a página nova continua interativa (hidratada): o link do menu segue funcionando depois de várias trocas
      await p.getByRole('link', { name: 'Sobre' }).click(); await p.getByRole('heading', { name: 'Sobre' }).waitFor()
      // tecla modificadora: navegação normal (o handler não intercepta)
      const href = await p.getByRole('link', { name: 'Início' }).evaluate((a: HTMLAnchorElement) => { let desviou = false; a.addEventListener('click', (e) => { desviou = e.defaultPrevented }, { once: true }); a.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, ctrlKey: true })); return desviou })
      expect(href).toBe(false)
      expect(erros.join(' | ')).toBe('')
    } finally { await nav.close() }
  })
  it('no navegador: painel Releases mostra a produção, as diferenças e volta para a release escolhida', async () => {
    const l = await sobe(null), ed = await l.token('loja-demo', ['studio.editor'], 'ana')
    const publica = async (v: string) => { const home = ((await (await req(l, 'loja-demo', 'GET', '/studio/nos/pagina/site.home', ed)).json()) as any).no; home.spec.raiz.slots.filhos[1].props.titulo = v; await req(l, 'loja-demo', 'PUT', '/studio/nos/pagina/site.home', ed, { no: home }); await req(l, 'loja-demo', 'POST', '/studio/publicar', ed, {}) }
    await publica('Versão um'); await publica('Versão dois')
    const nav = await chromium.launch({ executablePath: CHROME!, args: ['--no-sandbox', '--host-resolver-rules=MAP *.polaris.localhost 127.0.0.1'] })
    try {
      const p = await nav.newPage(), erros: string[] = []; p.on('pageerror', (e) => erros.push(e.message)); p.on('console', (m) => { if (m.type() === 'error') erros.push(`${m.text()} ${m.location().url}`) })
      await p.goto(`http://loja-demo.polaris.localhost:${l.porta}/studio#token=${ed}`); await p.getByRole('button', { name: 'Releases' }).click()
      await p.getByText('Em produção: release 2').first().waitFor(); await p.getByText(/release 1 · ana/).waitFor()
      expect(await p.locator('main [data-cartao]').count()).toBeGreaterThanOrEqual(3); expect(await p.locator('main [data-cartao] span[data-tom=sucesso]', { hasText: 'Em produção' }).count()).toBeGreaterThanOrEqual(2) // a produção e a release atual em cartões, com o selo
      expect(await p.locator('button[data-icone=desfazer]', { hasText: 'Voltar para esta' }).count()).toBeGreaterThan(0); expect(await p.locator('button[data-icone=nav-link]', { hasText: 'Link de pré-visualização' }).count()).toBeGreaterThan(0)
      await p.getByRole('button', { name: 'Diferenças com a produção' }).click(); await p.getByText(/~ pagina:site\.home/).waitFor() // a diferença entre a produção e a release 1
      await p.getByRole('button', { name: 'Link de pré-visualização' }).last().click(); await p.getByRole('link', { name: /Abrir a pré-visualização da release 1/ }).waitFor(); expect(await p.getByRole('link', { name: /Abrir a pré-visualização/ }).getAttribute('href')).toMatch(/^\/_polaris\/preview\?t=v1\./) // o link do Studio
      await p.getByRole('button', { name: 'Voltar para a anterior (release 1)' }).click(); await p.getByText(/Em produção: release 1\. O site já usa/).first().waitFor()
      expect(await (await get(l, 'loja-demo', '/')).text()).toContain('Versão um') // o site voltou
      await p.getByRole('button', { name: 'Voltar para esta' }).first().click(); await p.getByText('Em produção: release 2').first().waitFor()
      expect(await (await get(l, 'loja-demo', '/')).text()).toContain('Versão dois')
      expect(erros.join(' | ')).toBe('')
    } finally { await nav.close() }
  })
  it('formulário de contato no site: abre sem recarregar, máscara ao digitar, erros por campo, envio, e grava no tenant certo', async () => {
    const l = await sobe(null), nav = await chromium.launch({ executablePath: CHROME!, args: ['--no-sandbox', '--host-resolver-rules=MAP *.polaris.localhost 127.0.0.1'] })
    try {
      const p = await nav.newPage(), erros: string[] = [], docs: string[] = []
      p.on('pageerror', (e) => erros.push(e.message)); p.on('console', (m) => { if (m.type() === 'error' && !/status of 422/.test(m.text())) erros.push(`${m.text()} ${m.location().url}`) }); p.on('request', (r) => { if (r.resourceType() === 'document') docs.push(r.url()) })
      await p.goto(`http://loja-demo.polaris.localhost:${l.porta}/`); await p.waitForFunction(() => (window as any).Polaris?.inicia); await p.evaluate(() => { (window as any).__marca = 'mesma' }); const n0 = docs.length
      await p.getByRole('link', { name: 'Contato' }).click() // navegação no cliente + a ilha carrega e monta o formulário
      await p.getByRole('heading', { name: 'Fale conosco' }).waitFor(); expect(await p.evaluate(() => (window as any).__marca)).toBe('mesma'); expect(docs.length).toBe(n0)
      const nome = p.getByLabel('Nome completo'), email = p.getByLabel('E-mail'), tel = p.getByLabel('Telefone'), msg = p.getByLabel('Mensagem'), aceite = p.getByLabel('Concordo com o uso dos dados')
      // acessível: rótulos ligados; máscara ao digitar (telefone troca de 10 para 11 dígitos)
      await tel.pressSequentially('11922223333'); expect(await tel.inputValue()).toBe('(11) 92222-3333')
      // enviar vazio: erros por campo, na mensagem do autor, foco no primeiro; nada vai ao servidor
      const envios: string[] = []; p.on('request', (r) => { if (r.method() === 'POST' && r.url().includes('/bff/formularios')) envios.push(r.url()) })
      await p.getByRole('button', { name: 'Enviar mensagem' }).click(); await p.getByText('Diga como podemos chamar você.').waitFor(); await p.getByText('Precisamos do seu aceite para responder.').waitFor()
      expect(envios.length).toBe(0); await expect.poll(() => p.evaluate(() => document.activeElement?.getAttribute('name'))).toBe('nome'); expect(await nome.getAttribute('aria-invalid')).toBe('true')
      await nome.fill('Ana Maria'); await email.fill('ana@exemplo.com'); await msg.fill('Gostaria de saber o prazo de entrega.'); await aceite.check()
      await p.getByRole('button', { name: 'Enviar mensagem' }).click(); await p.getByText('Mensagem enviada! Obrigado.').waitFor(); expect(envios.length).toBe(1)
      expect(await nome.inputValue()).toBe('') // limpar: true
      // gravou no tenant CERTO, normalizado (telefone só com dígitos)
      const gerente = await l.token('loja-demo', ['gerente']), lista = (await (await req(l, 'loja-demo', 'GET', '/api/loja/contatos', gerente)).json()) as Array<{ nome: string; email: string; telefone: string }>
      expect(lista).toHaveLength(1); expect(lista[0]).toMatchObject({ nome: 'Ana Maria', email: 'ana@exemplo.com', telefone: '11922223333' })
      expect(((await (await req(l, 'loja-outra', 'GET', '/api/loja/contatos', await l.token('loja-outra', ['gerente']))).json()) as unknown[]).length).toBe(0)
      expect(erros.join(' | ')).toBe('')
    } finally { await nav.close() }
  })
  it('formulário aberto direto pela URL (sem navegação no cliente): monta depois da hidratação, sem erro e sem refazer a página', async () => {
    const l = await sobe(null), nav = await chromium.launch({ executablePath: CHROME!, args: ['--no-sandbox', '--host-resolver-rules=MAP *.polaris.localhost 127.0.0.1'] })
    try {
      const p = await nav.newPage(), erros: string[] = []; p.on('pageerror', (e) => erros.push(e.message)); p.on('console', (m) => { if (m.type() === 'error') erros.push(`${m.text()} ${m.location().url}`) })
      await p.goto(`http://loja-demo.polaris.localhost:${l.porta}/contato`); await p.getByLabel('Nome completo').waitFor()
      expect(await p.locator('[data-polaris-formulario]').getAttribute('aria-busy')).toBe('false'); expect(await p.locator('[data-polaris-formulario] form').count()).toBe(1) // montado UMA vez
      await p.getByLabel('Nome completo').fill('Al'); await p.getByLabel('Nome completo').blur(); await p.getByText('O nome precisa de pelo menos 3 letras.').waitFor()
      await p.getByRole('link', { name: 'Sobre' }).click(); await p.getByRole('heading', { name: 'Sobre' }).waitFor(); await p.goBack(); await p.getByLabel('Nome completo').waitFor() // voltar: monta de novo
      expect(await p.locator('[data-polaris-formulario] form').count()).toBe(1); expect(erros.join(' | ')).toBe('')
    } finally { await nav.close() }
  })
  it('login real no Chrome: senha errada diz a mesma coisa para qualquer e-mail; 5 erros bloqueiam; a sessão emitida (ES256) é aceita pelos SERVIÇOS', async () => {
    const l = await sobe(null), nav = await chromium.launch({ executablePath: CHROME!, args: ['--no-sandbox', '--host-resolver-rules=MAP *.polaris.localhost 127.0.0.1'] })
    try {
      const ctx = await nav.newContext(), p = await ctx.newPage(), erros: string[] = []; p.on('pageerror', (e) => erros.push(e.message)); p.on('console', (m) => { if (m.type() === 'error' && !/status of (401|429)/.test(m.text())) erros.push(`${m.text()} ${m.location().url}`) })
      await p.goto(`http://loja-demo.polaris.localhost:${l.porta}/entrar`); const email = p.getByLabel('E-mail'), senha = p.getByLabel('Senha'), entrar = p.getByRole('button', { name: 'Entrar' })
      await email.fill(emailLocal('loja-demo')); await senha.fill('senha-errada-12'); await entrar.click(); await p.getByText('E-mail ou senha incorretos.').waitFor()
      await email.fill('quem-e-esse@loja-demo.test'); await entrar.click(); await p.getByText('E-mail ou senha incorretos.').waitFor() // e-mail que não existe: a MESMA mensagem
      expect((await ctx.cookies()).filter((c) => c.name === 'polaris_sessao')).toHaveLength(0) // nada de sessão em falha
      await email.fill(emailLocal('loja-demo')); for (let i = 0; i < 4; i++) await entrar.click(); await p.getByText(/Muitas tentativas\. Tente de novo em \d+ minuto/).waitFor() // 1 antes + 4 aqui = 5 do MESMO e-mail: bloqueia (o e-mail inexistente contou à parte)
      await senha.fill(SENHA_LOCAL); await entrar.click(); await p.getByText(/Muitas tentativas/).waitFor() // bloqueado até a senha certa é recusada
      expect((await ctx.cookies()).filter((c) => c.name === 'polaris_sessao')).toHaveLength(0)
      // outro e-mail do mesmo tenant não é afetado; o login certo grava o cookie HttpOnly e a sessão vale nos serviços
      await p.goto(`http://loja-outra.polaris.localhost:${l.porta}/entrar`); await p.getByLabel('E-mail').fill(emailLocal('loja-outra')); await p.getByLabel('Senha').fill(SENHA_LOCAL); await p.getByRole('button', { name: 'Entrar' }).click(); await p.waitForURL(/loja-outra\.polaris\.localhost:\d+\/$/)
      const ck = (await ctx.cookies()).find((c) => c.name === 'polaris_sessao')!; expect(ck).toMatchObject({ httpOnly: true, sameSite: 'Lax' }); expect(ck.value.split('.').length).toBe(3)
      const api = await req(l, 'loja-outra', 'GET', '/api/loja/produtos', ck.value); expect(api.status, await api.text()).toBe(200) // o serviço verificou o JWT com a chave PÚBLICA
      expect((await req(l, 'loja-demo', 'GET', '/api/loja/produtos', ck.value)).status).toBeGreaterThanOrEqual(401) // o token da Outra Loja não vale no host da Demo
      expect(erros.join(' | ')).toBe('')
    } finally { await nav.close() }
  })
  it('esqueci a senha: o link vai para a caixa de e-mails, define a nova senha (uma vez só) e a antiga deixa de valer', async () => {
    const l = await sobe(null), nav = await chromium.launch({ executablePath: CHROME!, args: ['--no-sandbox', '--host-resolver-rules=MAP *.polaris.localhost 127.0.0.1'] })
    try {
      const p = await nav.newPage(), base = `http://loja-demo.polaris.localhost:${l.porta}`, erros: string[] = []; p.on('pageerror', (e) => erros.push(e.message)); p.on('console', (m) => { if (m.type() === 'error' && !/status of (401|422)/.test(m.text())) erros.push(`${m.text()} ${m.location().url}`) })
      await p.goto(`${base}/entrar`); await p.getByRole('link', { name: 'Esqueci minha senha' }).click(); await p.getByRole('heading', { name: 'Esqueci minha senha' }).first().waitFor()
      const aviso = /Se o e-mail estiver cadastrado/; await p.getByLabel('E-mail').fill('ninguem@loja-demo.test'); await p.getByRole('button', { name: 'Enviar o link' }).click(); await p.getByText(aviso).waitFor()
      await p.getByLabel('E-mail').fill(emailLocal('loja-demo')); await p.getByRole('button', { name: 'Enviar o link' }).click(); await p.getByText(aviso).first().waitFor() // a MESMA resposta para conta que existe e que não existe
      await expect.poll(async () => (await (await get(l, 'loja-demo', '/_dev/emails')).text()).includes('/senha/redefinir?token=')).toBe(true)
      const caixa = await (await get(l, 'loja-demo', '/_dev/emails')).text(); expect(caixa).toContain(emailLocal('loja-demo')); expect(caixa).not.toContain('ninguem@') // só quem tem conta recebe
      const link = /href="(http:\/\/loja-demo\.polaris\.localhost:\d+\/senha\/redefinir\?token=[\w-]+)"/.exec(caixa)![1]!
      await p.goto(link); await p.locator('input[name=senha]').fill('cavalo-bateria-novo'); await p.locator('input[name=confirma]').fill('diferente-do-outro'); await p.getByRole('button', { name: 'Salvar a nova senha' }).click(); await p.getByText('As senhas não conferem.').waitFor()
      await p.locator('input[name=confirma]').fill('cavalo-bateria-novo'); await p.getByRole('button', { name: 'Salvar a nova senha' }).click(); await p.waitForURL(/\/entrar$/) // a ação `navegar` leva ao login
      await p.goto(link); await p.locator('input[name=senha]').fill('cavalo-bateria-novo'); await p.locator('input[name=confirma]').fill('cavalo-bateria-novo'); await p.getByRole('button', { name: 'Salvar a nova senha' }).click(); await p.getByText(/não vale mais/).waitFor() // uso único
      await p.goto(`${base}/entrar`); await p.getByLabel('E-mail').fill(emailLocal('loja-demo')); await p.getByLabel('Senha').fill(SENHA_LOCAL); await p.getByRole('button', { name: 'Entrar' }).click(); await p.getByText('E-mail ou senha incorretos.').waitFor() // a antiga morreu
      await p.getByLabel('Senha').fill('cavalo-bateria-novo'); await p.getByRole('button', { name: 'Entrar' }).click(); await p.waitForURL(`${base}/`)
      expect(erros.join(' | ')).toBe('')
    } finally { await nav.close() }
  })
  it('Studio: diagramas — o fluxo do site (páginas, links, formulário, dados) e os blocos da página aberta, no quadro isolado', async () => {
    const l = await sobe(null), nav = await chromium.launch({ executablePath: CHROME!, args: ['--no-sandbox', '--host-resolver-rules=MAP *.polaris.localhost 127.0.0.1'] })
    try {
      const p = await nav.newPage(), erros: string[] = []; p.on('pageerror', (e) => erros.push(e.message)); p.on('console', (m) => { if (m.type() === 'error') erros.push(m.text()) })
      await p.goto(`http://loja-demo.polaris.localhost:${l.porta}/entrar?volta=%2Fstudio`); await p.getByLabel('E-mail').fill(emailLocal('loja-demo')); await p.getByLabel('Senha').fill(SENHA_LOCAL); await p.getByRole('button', { name: 'Entrar' }).click()
      await p.getByRole('link', { name: 'Polaris Studio' }).waitFor(); await p.getByRole('button', { name: 'Diagramas' }).click()
      const quadro = p.frameLocator('iframe[title="Diagrama"]'); await quadro.locator('svg').waitFor()
      for (const t of ['Páginas', 'Formulários', 'Dados', 'Serviços', '/produtos', '/contato']) await quadro.getByText(t, { exact: true }).first().waitFor() // o fluxo do site de exemplo
      expect(await quadro.locator('path.lig').count()).toBeGreaterThan(5)
      await p.getByText(/Fluxo: \d+ nó\(s\) e \d+ ligação/).waitFor(); expect(await p.getByRole('toolbar', { name: 'Tipo de diagrama' }).getByRole('button', { name: 'Fluxo da aplicação' }).getAttribute('aria-current')).toBe('true'); expect(await p.locator('main [data-cartao] iframe').count()).toBe(1) // o botão do tipo aberto fica marcado e o desenho vem num cartão
      await p.getByRole('button', { name: 'site.home (padrão)' }).click(); await p.getByRole('button', { name: 'Salvar' }).waitFor(); await p.getByRole('button', { name: 'Blocos da página aberta' }).click()
      await p.getByText(/Blocos: \d+ bloco\(s\) da página aberta/).waitFor(); await quadro.getByText('layout/pilha').first().waitFor(); await quadro.getByText('nav/link').first().waitFor()
      expect(await p.locator('iframe[title="Diagrama"]').getAttribute('sandbox')).toBe('') // sem scripts, sem formulários, origem opaca
      expect(erros.filter((x) => !/status of (401|403)/.test(x)).join(' | ')).toBe('')
    } finally { await nav.close() }
  })
  it('Studio: editor de cartazes — criar, adicionar elemento, prévia (HTML do mesmo layout do PDF), problemas, dados de exemplo, salvar e reabrir', async () => {
    const l = await sobe(null), nav = await chromium.launch({ executablePath: CHROME!, args: ['--no-sandbox', '--host-resolver-rules=MAP *.polaris.localhost 127.0.0.1'] })
    try {
      const p = await nav.newPage(), erros: string[] = []; p.on('pageerror', (e) => erros.push(e.message)); p.on('console', (m) => { if (m.type() === 'error') erros.push(m.text()) })
      const srcdoc = () => p.evaluate(() => document.querySelector('iframe[title="Pré-visualização do cartaz"]')?.getAttribute('srcdoc') ?? '')
      await p.goto(`http://loja-demo.polaris.localhost:${l.porta}/entrar?volta=%2Fstudio`); await p.getByLabel('E-mail').fill(emailLocal('loja-demo')); await p.getByLabel('Senha').fill(SENHA_LOCAL); await p.getByRole('button', { name: 'Entrar' }).click()
      await p.getByRole('link', { name: 'Polaris Studio' }).waitFor(); await p.getByRole('button', { name: 'Novo cartaz' }).click(); await p.getByLabel('Identificador do novo nó').fill('cartaz-teste'); await p.getByRole('button', { name: 'Criar' }).click()
      await p.getByRole('heading', { name: 'Cartaz cartaz-teste' }).waitFor(); await p.waitForFunction(() => (document.querySelector('iframe[title="Pré-visualização do cartaz"]')?.getAttribute('srcdoc') ?? '').includes('Novo cartaz'))
      expect(await srcdoc()).toContain('<svg'); expect(await p.locator('iframe[title="Pré-visualização do cartaz"]').getAttribute('sandbox')).toBe('') // isolado, sem scripts
      await p.getByRole('button', { name: 'Preço', exact: true }).click(); await p.waitForFunction(() => (document.querySelector('iframe[title="Pré-visualização do cartaz"]')?.getAttribute('srcdoc') ?? '').includes(',99'))
      await p.getByLabel('Escala dos centavos (0,2 a 1)').fill('1'); await p.waitForFunction(() => /font-size="([\d.]+)"[^>]*>,99/.test(document.querySelector('iframe[title="Pré-visualização do cartaz"]')?.getAttribute('srcdoc') ?? ''))
      await p.getByRole('button', { name: '1. texto titulo' }).click(); await p.getByLabel('Texto (dado entre chaves: produto.nome)').fill('Oferta {produto.nome}')
      await p.getByText(/o texto usa o dado "produto", não declarado em spec\.dados/).waitFor() // problema mostrado, sem quebrar a prévia
      await p.getByRole('button', { name: 'JSON', exact: true }).click()
      const spec = JSON.parse(await p.getByLabel('spec do cartaz').inputValue()); spec.dados = { produto: { tipo: 'json' } }; spec.exemplo = { produto: { nome: 'Feijão Carioca' } }
      await p.getByLabel('spec do cartaz').fill(JSON.stringify(spec)); await p.getByRole('button', { name: 'Aplicar' }).click(); await p.getByRole('button', { name: 'Elementos', exact: true }).click()
      await p.waitForFunction(() => (document.querySelector('iframe[title="Pré-visualização do cartaz"]')?.getAttribute('srcdoc') ?? '').includes('Feijão'))
      await p.getByRole('button', { name: 'A6' }).click(); await p.waitForFunction(() => (document.querySelector('iframe[title="Pré-visualização do cartaz"]')?.getAttribute('srcdoc') ?? '').includes('size:419.528pt'))
      await p.getByRole('button', { name: 'Salvar' }).click(); await p.getByText('Salvo como versão 1').waitFor()
      await p.reload(); await p.getByRole('link', { name: 'Polaris Studio' }).waitFor(); await p.getByRole('button', { name: 'cartaz-teste (personalizado)' }).click()
      await p.getByRole('heading', { name: 'Cartaz cartaz-teste' }).waitFor(); await p.waitForFunction(() => (document.querySelector('iframe[title="Pré-visualização do cartaz"]')?.getAttribute('srcdoc') ?? '').includes('Feijão'))
      expect(erros.filter((x) => !/status of (401|403)/.test(x)).join(' | ')).toBe('')
    } finally { await nav.close() }
  })
  it('cabeçalho do site (site/cabecalho): <header> com marca, menu com a página atual marcada e a ação de entrar; navegar troca o atual sem recarregar', async () => {
    const l = await sobe(null), nav = await chromium.launch({ executablePath: CHROME!, args: ['--no-sandbox', '--host-resolver-rules=MAP *.polaris.localhost 127.0.0.1'] })
    try {
      const p = await nav.newPage(), erros: string[] = []; p.on('pageerror', (e) => erros.push(e.message)); p.on('console', (m) => { if (m.type() === 'error') erros.push(m.text()) })
      await p.goto(`http://loja-demo.polaris.localhost:${l.porta}/`); await p.waitForFunction(() => (window as any).Polaris?.inicia)
      const h = p.locator('header'); expect(await h.count()).toBe(1); expect(await h.locator(':scope > a').first().innerText()).toBe('Minha loja')
      expect(await p.locator('header nav').getAttribute('aria-label')).toBe('Principal'); expect(await p.locator('header nav').evaluate((n) => [...n.children].filter((c) => c.tagName === 'A').map((c) => c.textContent))).toEqual(['Início', 'Sobre', 'Contato', 'Produtos (gerente)'])
      expect(await p.locator('header nav a[aria-current=page]').allInnerTexts()).toEqual(['Início']); expect(await h.locator(':scope > a').last().getAttribute('href')).toBe('/entrar')
      const hero = p.locator('section[data-alinha]'); expect(await hero.count()).toBe(1); expect(await hero.locator('h1').innerText()).toBe('Bem-vindo à loja'); expect(await hero.locator('a[data-botao]').allInnerTexts()).toEqual(['Conheça a loja', 'Fale com a gente'])
      expect(await hero.evaluate((e) => { const c = getComputedStyle(e); return c.display === 'flex' && c.textAlign === 'center' && e.getBoundingClientRect().height >= 240 && c.backgroundColor !== 'rgba(0, 0, 0, 0)' })).toBe(true) // o tema pinta o destaque; a altura mínima vale
      expect(await hero.locator('a[data-botao=primario]').evaluate((e) => getComputedStyle(e).fontWeight)).toBe('600')
      await p.evaluate(() => { (window as any).__marca = 'mesma' }); await p.getByRole('link', { name: 'Sobre' }).click(); await p.waitForURL(/\/sobre$/)
      await p.waitForFunction(() => document.querySelector('header nav a[aria-current=page]')?.textContent === 'Sobre'); expect(await p.evaluate(() => (window as any).__marca)).toBe('mesma') // trocou no cliente, o atual acompanhou
      expect(await p.locator('footer nav').evaluateAll((ns) => ns.map((n) => n.getAttribute('aria-label')))).toEqual(['Loja', 'Ajuda']); expect(await p.locator('footer small').innerText()).toBe('© 2026 Minha loja')
      expect(await p.evaluate(() => { const f = document.querySelector('footer')!, r = f.getBoundingClientRect(); return r.top > document.querySelector('header')!.getBoundingClientRect().bottom && !f.nextElementSibling && getComputedStyle(f).borderTopWidth === '1px' })).toBe(true) // o rodapé vem depois do conteúdo, por último, estilizado pelo tema
      const css = await p.evaluate(() => { const e = document.querySelector('header')!, c = getComputedStyle(e); return { display: c.display, borda: c.borderBottomWidth } }); expect(css).toEqual({ display: 'flex', borda: '1px' }) // o tema estiliza o cabeçalho
      expect(erros.filter((x) => !/status of (401|403)/.test(x)).join(' | ')).toBe('')
    } finally { await nav.close() }
  })
  it('imagens: o banner do hero é servido do próprio site (CSP ok) e, no Studio, enviar, listar, usar e remover uma imagem funciona', async () => {
    const l = await sobe(null), nav = await chromium.launch({ executablePath: CHROME!, args: ['--no-sandbox', '--host-resolver-rules=MAP *.polaris.localhost 127.0.0.1'] })
    try {
      const p = await nav.newPage(), erros: string[] = [], imagens: Array<[number, string]> = []; p.on('pageerror', (e) => erros.push(e.message)); p.on('console', (m) => { if (m.type() === 'error') erros.push(m.text()) })
      p.on('response', (r) => { if (r.url().includes('/_polaris/img/')) imagens.push([r.status(), r.headers()['content-type'] ?? '']) })
      const base = `http://loja-demo.polaris.localhost:${l.porta}`
      await p.goto(`${base}/`); await p.getByRole('heading', { name: 'Bem-vindo à loja' }).waitFor()
      expect(await p.locator('header img').evaluate((i: HTMLImageElement) => i.complete && i.naturalWidth === 64)).toBe(true) // o logo do cabeçalho (imagem do tenant) carregou
      const fundo = await p.locator('section[data-alinha]').evaluate((e) => getComputedStyle(e).backgroundImage); expect(fundo).toMatch(/linear-gradient\(rgba\(0, 0, 0, 0\.35\).*url\("[^"]*\/_polaris\/img\/[0-9a-f]{64}\.png"\)/)
      await p.waitForFunction(() => performance.getEntriesByType('resource').some((r) => r.name.includes('/_polaris/img/'))); expect(imagens).toContainEqual([200, 'image/png'])
      expect(await p.locator('section[data-imagem]').evaluate((e) => { const c = getComputedStyle(e), b = getComputedStyle(e.querySelector('a[data-botao=primario]')!), s = getComputedStyle(e.querySelector('a[data-botao=secundario]')!); return [c.color, b.backgroundColor, b.color, s.color] })).toEqual(['rgb(255, 255, 255)', 'rgb(255, 255, 255)', 'rgb(0, 0, 0)', 'rgb(255, 255, 255)']) // sobre a foto: texto e botões legíveis em qualquer tema
      expect((await get(l, 'loja-outra', new URL(fundo.match(/url\("([^"]*)"\)/)![1]!).pathname)).status).toBe(200) // o seed põe a imagem em cada tenant (conteúdo igual, ativos separados)
      await p.goto(`${base}/entrar?volta=%2Fstudio`); await p.getByLabel('E-mail').fill(emailLocal('loja-demo')); await p.getByLabel('Senha').fill(SENHA_LOCAL); await p.getByRole('button', { name: 'Entrar' }).click()
      await p.getByRole('link', { name: 'Polaris Studio' }).waitFor(); await p.getByRole('button', { name: 'Imagens' }).click(); await p.getByText('banner-de-exemplo · 1600×500').waitFor()
      const PIXEL = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')
      await p.locator('input[type=file]').setInputFiles({ name: 'meu-pixel.png', mimeType: 'image/png', buffer: PIXEL }); await p.getByText('Imagem enviada.').waitFor(); await p.getByText('meu-pixel.png · 1×1 · 70 bytes').waitFor()
      expect(await p.locator('main [data-cartao]', { hasText: 'meu-pixel.png' }).locator('img').count()).toBe(1); expect(await p.locator('main [data-cartao] button[data-icone=apagar]', { hasText: 'Remover' }).count()).toBeGreaterThan(0) // cada imagem num cartão (miniatura, dados e o botão de remover com ícone)
      const caminho = await p.locator('code', { hasText: '/_polaris/img/' }).first().innerText(); expect((await get(l, 'loja-demo', caminho)).status).toBe(200)
      // foto de celular de verdade: 300×200 com EXIF (orientação "gire 90°", câmera, GPS): o servidor gira, tira os metadados e conta
      const foto = readFileSync(join(import.meta.dirname, '../../../packages/packs/test/fixtures/foto-celular.jpg')); expect(foto.toString('latin1')).toContain('Canon')
      await p.locator('input[type=file]').setInputFiles({ name: 'foto.jpg', mimeType: 'image/jpeg', buffer: foto }); await p.getByText(/foi girada e\/ou reduzida a 2400 px/).waitFor(); await p.getByText('foto.jpg · 200×300').waitFor()
      const caminhoFoto = await p.locator('code', { hasText: /\.jpg$/ }).first().innerText(); const servida = await get(l, 'loja-demo', caminhoFoto); expect(servida.status).toBe(200); expect(await servida.text()).not.toMatch(/GPS|Canon/) // o que está no banco e é servido já não tem a localização
      const mini = await p.locator('img[alt="foto.jpg"]').getAttribute('src'); expect(mini).toMatch(/\.webp\?w=160$/); expect((await get(l, 'loja-demo', mini!)).headers.get('content-type')).toBe('image/webp') // a lista usa a miniatura
      await p.locator('input[type=file]').setInputFiles({ name: 'mal.png', mimeType: 'image/png', buffer: Buffer.from('<svg onload=alert(1)>') }); await p.getByText(/png, jpeg, gif ou webp/).waitFor() // o servidor lê o tipo dos bytes: o nome e o tipo declarado não valem
      await p.locator('input[type=file]').setInputFiles({ name: 'grande.png', mimeType: 'image/png', buffer: Buffer.alloc(2 * 1024 * 1024 + 10, 1) }); await p.getByText(/o arquivo passa de 2048 KB/).waitFor() // o navegador nem lê
      await p.getByRole('button', { name: 'Remover' }).first().click(); /* a mais nova (a foto) vem primeiro */ await p.getByText('Imagem removida.').waitFor(); await expect.poll(async () => (await get(l, 'loja-demo', caminhoFoto)).status).toBe(404)
      await p.getByRole('button', { name: 'Remover' }).first().click(); await expect.poll(async () => (await get(l, 'loja-demo', caminho)).status).toBe(404) // e depois o pixel
      expect(erros.filter((x) => !/status of (401|403|404|422)/.test(x)).join(' | ')).toBe('')
    } finally { await nav.close() }
  })
  it('srcset automático: as quatro larguras do logo (menor que todas) respondem 200 com o ORIGINAL; largura fora da lista é 404', async () => {
    const l = await sobe(null), H = 'c38943ee25435ff89d04ab37d73a7a1ef42e7c9b77985059cb368ea709dfd385'
    for (const w of [160, 480, 960, 1920]) { const r = await get(l, 'loja-outra', `/_polaris/img/${H}.webp?w=${w}`); expect(r.status, String(w)).toBe(200); expect(r.headers.get('content-type')).toMatch(/^image\//); expect((await r.text()).length).toBeGreaterThan(100) }
    expect((await get(l, 'loja-outra', `/_polaris/img/${H}.webp?w=123`)).status).toBe(404)
  })
  it('submenu do cabeçalho: abre e fecha pelo título (mouse e teclado), painel sob o título no computador, Esc e clique fora fecham', async () => {
    const l = await sobe(null), nav = await chromium.launch({ executablePath: CHROME!, args: ['--no-sandbox', '--host-resolver-rules=MAP *.polaris.localhost 127.0.0.1'] })
    try {
      const p = await nav.newPage(), erros: string[] = []; p.on('pageerror', (e) => erros.push(e.message)); p.on('console', (m) => { if (m.type() === 'error') erros.push(m.text()) })
      await p.setViewportSize({ width: 1200, height: 800 }); await p.goto(`http://loja-outra.polaris.localhost:${l.porta}/sobre`); await p.waitForFunction(() => (window as any).Polaris?.inicia)
      const sm = p.locator('header nav details[data-submenu]'), sumario = sm.locator('summary'), item = sm.getByRole('link', { name: 'Fale conosco' })
      expect(await sumario.innerText()).toBe('Ajuda'); expect(await sm.getAttribute('open')).toBeNull(); expect(await item.isVisible()).toBe(false) // fechado: os links não aparecem
      expect(await sm.evaluate((e) => { const c = getComputedStyle(e, '::details-content'); return [c.display, c.borderTopWidth] })).toEqual(['none', '0px']) // fechado: nenhum painel vazio (borda ou fundo) sob o título
      await sumario.click(); expect(await sm.getAttribute('open')).not.toBeNull(); expect(await item.isVisible()).toBe(true)
      const [bs, bi] = await Promise.all([sumario.boundingBox(), item.boundingBox()]); expect(bi!.y).toBeGreaterThanOrEqual(bs!.y + bs!.height - 1) // o painel abre ABAIXO do título
      expect(await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
      await p.keyboard.press('Escape'); expect(await sm.getAttribute('open')).toBeNull(); expect(await p.evaluate(() => document.activeElement?.tagName)).toBe('SUMMARY') // Esc fecha e o foco fica no título
      await p.keyboard.press('Enter'); expect(await sm.getAttribute('open')).not.toBeNull() // teclado: Enter abre
      await p.mouse.click(1100, 600); expect(await sm.getAttribute('open')).toBeNull() // clique fora fecha (o painel cobre o meio do título, por isso o clique vai à direita)
      await sumario.click(); await item.click(); await p.waitForURL(/\/contato$/); await p.getByRole('heading', { name: 'Contato' }).waitFor(); expect(await p.locator('header nav details[data-submenu]').getAttribute('open')).toBeNull() // o link do submenu navega, e a página nova nasce fechada
      await p.setViewportSize({ width: 390, height: 800 }); await p.getByText('Menu', { exact: true }).click(); await p.locator('header nav details summary').click()
      const sub = p.locator('header nav details').getByRole('link', { name: 'Quem somos' }); expect(await sub.isVisible()).toBe(true); expect((await sub.boundingBox())!.x + (await sub.boundingBox())!.width).toBeLessThanOrEqual(390) // no celular: em linha, dentro da tela
      expect(erros.filter((x) => !/status of (401|403)/.test(x)).join(' | ')).toBe('')
    } finally { await nav.close() }
  })
  it('cabeçalho: visitante vê "Entrar"; depois do login vê "Sair", que encerra a sessão (link, sem JavaScript)', async () => {
    const l = await sobe(null), nav = await chromium.launch({ executablePath: CHROME!, args: ['--no-sandbox', '--host-resolver-rules=MAP *.polaris.localhost 127.0.0.1'] })
    try {
      const p = await nav.newPage(), base = `http://loja-outra.polaris.localhost:${l.porta}`
      await p.goto(`${base}/sobre`);       expect(await p.locator('header a', { hasText: 'Entrar' }).count()).toBe(1); expect(await p.locator('header a', { hasText: 'Sair' }).count()).toBe(0)
      await p.locator('header a', { hasText: 'Entrar' }).click(); await p.getByRole('heading', { name: 'Entrar' }).waitFor()
      await p.getByLabel('E-mail').fill(emailLocal('loja-outra')); await p.getByLabel('Senha').fill(SENHA_LOCAL); await p.getByRole('button', { name: 'Entrar' }).click(); await p.waitForURL((u) => !u.pathname.startsWith('/entrar'))
      await p.goto(`${base}/sobre`); expect(await p.locator('header a', { hasText: 'Sair' }).count()).toBe(1); expect(await p.locator('header a', { hasText: 'Entrar' }).count()).toBe(0)
      await p.locator('header a', { hasText: 'Sair' }).click(); await p.waitForURL(`${base}/`)
      await p.goto(`${base}/sobre`); expect(await p.locator('header a', { hasText: 'Entrar' }).count()).toBe(1); expect(await p.locator('header a', { hasText: 'Sair' }).count()).toBe(0) // a sessão acabou
    } finally { await nav.close() }
  })
  it('menu recolhível do cabeçalho: no celular o menu e as ações ficam atrás do botão "Menu" (sem JavaScript), no computador tudo à vista', async () => {
    const l = await sobe(null), nav = await chromium.launch({ executablePath: CHROME!, args: ['--no-sandbox', '--host-resolver-rules=MAP *.polaris.localhost 127.0.0.1'] })
    try {
      const p = await nav.newPage(), erros: string[] = []; p.on('pageerror', (e) => erros.push(e.message)); p.on('console', (m) => { if (m.type() === 'error') erros.push(m.text()) })
      const visivel = (sel: string) => p.locator(sel).first().evaluate((e) => { const c = getComputedStyle(e), r = e.getBoundingClientRect(); return c.display !== 'none' && c.visibility !== 'hidden' && r.width > 0 && r.height > 0 })
      await p.setViewportSize({ width: 1200, height: 800 }); await p.goto(`http://loja-outra.polaris.localhost:${l.porta}/sobre`)
      expect(await visivel('header nav')).toBe(true); expect(await visivel('header form[role=search]')).toBe(true); expect(await visivel('header > label[for]')).toBe(false) // computador: tudo à vista, sem botão
      await p.setViewportSize({ width: 390, height: 800 })
      expect(await visivel('header > label[for]')).toBe(true); expect(await visivel('header nav')).toBe(false); expect(await visivel('header form[role=search]')).toBe(false); expect(await visivel('header > a')).toBe(true) // celular: só a marca e o botão
      expect(await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true) // sem rolagem horizontal
      await p.getByText('Menu', { exact: true }).click(); expect(await p.getByRole('switch', { name: 'Abrir o menu' }).isChecked()).toBe(true)
      expect(await visivel('header nav')).toBe(true); expect(await visivel('header form[role=search]')).toBe(true); expect(await p.locator('header nav').evaluate((n) => [...n.children].filter((c) => c.tagName === 'A').map((c) => c.textContent))).toEqual(['Início', 'Sobre', 'Contato', 'Produtos (gerente)'])
      await p.getByRole('link', { name: 'Contato' }).first().click(); await p.waitForURL(/\/contato$/); expect(await visivel('header nav')).toBe(false) // a página nova começa com o menu fechado
      await p.keyboard.press('Tab'); await p.getByRole('switch', { name: 'Abrir o menu' }).focus(); await p.keyboard.press('Space'); expect(await visivel('header nav')).toBe(true) // pelo teclado (o campo recebe o foco; Espaço abre)
      // com o roteador carregado (JavaScript): Esc e o clique fora fecham; clicar DENTRO (no campo de busca) não fecha
      await p.goto(`http://loja-outra.polaris.localhost:${l.porta}/sobre`); await p.waitForFunction(() => (window as any).Polaris?.inicia); const alt = p.getByRole('switch', { name: 'Abrir o menu' })
      await p.getByText('Menu', { exact: true }).click(); expect(await alt.isChecked()).toBe(true); await p.keyboard.press('Escape'); expect(await alt.isChecked()).toBe(false); expect(await visivel('header nav')).toBe(false)
      expect(await p.evaluate(() => document.activeElement?.getAttribute('role'))).toBe('switch') // o foco voltou para o interruptor
      await p.getByText('Menu', { exact: true }).click(); await p.locator('header input[type=search]').click(); expect(await alt.isChecked()).toBe(true) // dentro do cabeçalho: continua aberto
      await p.getByRole('heading', { name: 'Sobre' }).click(); expect(await alt.isChecked()).toBe(false); expect(await visivel('header nav')).toBe(false) // fora: fecha
      await p.getByText('Menu', { exact: true }).click(); await p.evaluate(() => { const a = document.createElement('a'); a.href = '#fim'; a.id = 'ancora-teste'; a.textContent = 'ancora'; document.querySelector('header nav')!.appendChild(a) }); await p.locator('#ancora-teste').click(); expect(await alt.isChecked()).toBe(false) // âncora do próprio menu: fecha
      expect(erros.filter((x) => !/status of (401|403)/.test(x)).join(' | ')).toBe('')
    } finally { await nav.close() }
  })
  it('sugestões ao vivo na busca: lista do servidor (com erro de digitação), título, descrição e miniatura; teclado, Esc e clique fora', async () => {
    const l = await sobe(null), nav = await chromium.launch({ executablePath: CHROME!, args: ['--no-sandbox', '--host-resolver-rules=MAP *.polaris.localhost 127.0.0.1'] })
    try {
      const p = await nav.newPage(), erros: string[] = []; p.on('pageerror', (e) => erros.push(e.message)); p.on('console', (m) => { if (m.type() === 'error') erros.push(`${m.text()} ${m.location().url}`) })
      await p.setViewportSize({ width: 1200, height: 800 }); const base = `http://loja-outra.polaris.localhost:${l.porta}`; await p.goto(`${base}/sobre`); await p.waitForFunction(() => (window as any).Polaris?.inicia)
      const ul = p.locator('header form[role=search] ul[data-sugestoes-url]'), campo = p.locator('header form[role=search] input[type=search]')
      expect(await ul.isVisible()).toBe(false); expect(await campo.getAttribute('list')).toBeNull() // sem digitar: nada aparece
      await campo.click(); await p.keyboard.type('c'); await p.waitForTimeout(500); expect(await ul.isVisible()).toBe(false) // uma letra não busca
      await p.keyboard.type('afetera'); await ul.waitFor({ state: 'visible' }) // "cafetera": erro de digitação, achado pela busca aproximada
      expect(await ul.locator('li[role=option]').allInnerTexts()).toEqual([expect.stringContaining('Cafeteira italiana')]); expect(await ul.locator('li a [data-s-desc]').innerText()).toBe('Alumínio, serve 6 xícaras'); expect(await ul.locator('mark').count()).toBe(0) // erro de digitação: acha, mas não há trecho igual a realçar
      expect(await campo.getAttribute('role')).toBe('combobox'); expect(await campo.getAttribute('aria-expanded')).toBe('true')
      await p.waitForFunction(() => { const i = document.querySelector('header ul[data-sugestoes-url] img') as HTMLImageElement | null; return !!i && i.complete && i.naturalWidth > 0 }); // a miniatura carregou
      const b = await ul.boundingBox(), bc = await campo.boundingBox(); expect(b!.y).toBeGreaterThanOrEqual(bc!.y + bc!.height - 1) // a lista abre sob o campo
      expect(await ul.evaluate((e) => getComputedStyle(e).backgroundColor !== 'rgba(0, 0, 0, 0)')).toBe(true) // com o fundo do tema (não a lista do navegador)
      await campo.fill(''); await campo.pressSequentially('cafe'); await p.waitForFunction(() => document.querySelectorAll('header ul[data-sugestoes-url] li[role=option]').length === 5) // limite 5 de 6 que casam
      const sem = (t: string) => t.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase(); const marcas = await ul.locator('[data-s-titulo] mark').allInnerTexts(); expect(marcas.length).toBeGreaterThanOrEqual(5); expect(marcas.every((m) => sem(m) === 'cafe')).toBe(true) // o trecho achado vem realçado, sem acento nem maiúsculas ('Café', 'Cafe' em 'Cafeteira')
      await p.keyboard.press('ArrowDown'); expect(await ul.locator('li[aria-selected=true]').count()).toBe(1); const ativo = await ul.locator('li[aria-selected=true] [data-s-titulo]').innerText(); expect(await campo.getAttribute('aria-activedescendant')).toBeTruthy()
      await p.keyboard.press('Escape'); expect(await ul.isVisible()).toBe(false); expect(p.url()).toBe(`${base}/sobre`) // Esc fecha sem navegar
      await campo.fill(''); await campo.pressSequentially('cafe'); await ul.waitFor({ state: 'visible' }); await p.keyboard.press('ArrowDown'); const escolhido = await ul.locator('li[aria-selected=true] [data-s-titulo]').innerText(); await p.keyboard.press('Enter')
      await p.waitForURL((u) => u.pathname === '/busca'); expect(new URL(p.url()).searchParams.get('q')).toBe(escolhido); expect(escolhido.length).toBeGreaterThan(2); void ativo // Enter no item ativo abre a busca pelo título
      await campo.fill(''); await campo.pressSequentially('acai'); await p.waitForFunction(() => document.querySelector('header ul[data-sugestoes-url] [data-s-titulo] mark')?.textContent === 'Açaí'); expect(await ul.locator('[data-s-titulo]').first().innerText()).toBe('Açaí na tigela') // 'acai' realça 'Açaí' (o acento do texto fica)
      await campo.fill(''); await campo.pressSequentially('zzzqq'); await p.getByText('Nenhuma sugestão para "zzzqq"').waitFor() // sem resultado: mensagem
      await campo.fill('<img src=x onerror=alert(1)>'); await p.getByText('Nenhuma sugestão para').waitFor(); expect(await p.locator('header ul img').count()).toBe(0) // o termo aparece como texto
      await p.mouse.click(1100, 600); expect(await ul.isVisible()).toBe(false) // clique fora fecha
      expect(erros.filter((x) => !/status of (401|403)/.test(x)).join(' | ')).toBe('')
    } finally { await nav.close() }
  })
  it('barra de busca: o formulário GET leva o termo à /busca, que busca NO SERVIDOR (sem acento nem maiúsculas, por palavras), pagina, mantém o termo e isola por tenant; sem termo e sem resultado têm mensagens', async () => {
    const l = await sobe(null), nav = await chromium.launch({ executablePath: CHROME!, args: ['--no-sandbox', '--host-resolver-rules=MAP *.polaris.localhost 127.0.0.1'] })
    try {
      const p = await nav.newPage(), erros: string[] = []; p.on('pageerror', (e) => erros.push(e.message)); p.on('console', (m) => { if (m.type() === 'error') erros.push(m.text()) })
      const base = `http://loja-demo.polaris.localhost:${l.porta}`, titulos = () => p.locator('main strong, #polaris > div > div > strong').allInnerTexts()
      await p.goto(`${base}/sobre`); const campo = p.locator('header input[type=search]'); expect(await p.locator('form[role=search]').getAttribute('action')).toBe('/busca'); expect(await campo.inputValue()).toBe('')
      await campo.fill('cafe'); await campo.press('Enter'); await p.waitForURL(/\/busca\?q=cafe$/); await p.getByRole('heading', { name: 'Resultados para "cafe"' }).waitFor() // "cafe" sem acento acha "Café" (o servidor ignora acentos)
      await p.getByText('Página 1').waitFor(); const doCafe = async () => (await p.locator('strong').allInnerTexts()).filter((t) => /caf/i.test(t)); const pag1 = await doCafe(); expect(pag1).toHaveLength(5); expect(await p.getByText('Pão de Loja Demo').count()).toBe(0); expect(await p.locator('header input[type=search]').inputValue()).toBe('cafe') // o termo continua no campo
      expect(await p.getByRole('link', { name: 'Anterior' }).count()).toBe(0); expect(pag1[0]).toBe('Café gelado') // RELEVÂNCIA: entre os que contêm "café" no título, o mais curto e focado vem primeiro
      await p.getByRole('link', { name: 'Próxima' }).click(); await p.waitForURL(/\/busca\?q=cafe&pagina=2$/); await p.getByText('Página 2').waitFor(); const pag2 = await doCafe(); expect(pag2).toHaveLength(1); expect(pag1.includes(pag2[0]!)).toBe(false) // outra página, sem repetir
      expect(new Set([...pag1, ...pag2])).toEqual(new Set(['Café coado', 'Café de Loja Demo', 'Café especial', 'Café gelado', 'Cafeteira italiana', 'Cafezinho de coador']))
      expect(await p.getByRole('link', { name: 'Próxima' }).count()).toBe(0); await p.getByRole('link', { name: 'Anterior' }).click(); await p.waitForURL(/\/busca\?q=cafe&pagina=1$/)
      await p.goto(`${base}/busca?q=cafetera`); await p.getByText('Cafeteira italiana').waitFor(); await p.goto(`${base}/busca?q=capucino`); await p.getByText('Nada encontrado para este termo.').waitFor() // erro de digitação: "cafetera" acha "Cafeteira"; o que não existe no catálogo, nada
      await p.goto(`${base}/busca?q=${encodeURIComponent('Pão QUEIJO')}`); await p.getByText('Pão de queijo').waitFor(); expect(await p.locator('strong').allInnerTexts()).not.toContain('Café coado') // palavras em qualquer ordem, acento e caixa à vontade
      await p.goto(`${base}/busca?q=${encodeURIComponent('açai')}`); await p.getByText('Açaí na tigela').waitFor()
      await p.goto(`${base}/busca?q=${encodeURIComponent('café & chá #1')}`); await p.getByText('Nada encontrado para este termo.').waitFor() // & e # no termo não quebram a URL nem a busca
      await p.goto(`${base}/busca?q=xyzzy`); await p.getByText('Nada encontrado para este termo.').waitFor(); await p.goto(`${base}/busca`); await p.getByText('Digite um termo no campo de busca.').waitFor()
      await p.goto(`${base}/busca?q=${encodeURIComponent('<img src=x onerror=alert(1)>')}`); await p.getByText('Nada encontrado para este termo.').waitFor(); expect(await p.locator('img[src=x]').count()).toBe(0)
      const outra = await nav.newPage(); await outra.goto(`http://loja-outra.polaris.localhost:${l.porta}/busca?q=pao`); await outra.getByText('Pão de Outra Loja').waitFor(); expect(await outra.getByText('Pão de Loja Demo').count()).toBe(0) // os dados são do tenant do endereço
      void titulos
      expect(erros.filter((x) => !/status of (401|403)/.test(x)).join(' | ')).toBe('')
    } finally { await nav.close() }
  })
  it('o Studio sem sessão manda ao login e volta para ele depois de entrar', async () => {
    const l = await sobe(null), nav = await chromium.launch({ executablePath: CHROME!, args: ['--no-sandbox', '--host-resolver-rules=MAP *.polaris.localhost 127.0.0.1'] })
    try {
      const p = await nav.newPage(); await p.goto(`http://loja-demo.polaris.localhost:${l.porta}/studio`); await p.waitForURL(/\/entrar\?volta=%2Fstudio$/)
      await p.getByLabel('E-mail').fill(emailLocal('loja-demo')); await p.getByLabel('Senha').fill(SENHA_LOCAL); await p.getByRole('button', { name: 'Entrar' }).click(); await p.waitForURL(/\/studio$/); await p.getByRole('link', { name: 'Polaris Studio' }).waitFor(); await p.getByText('site.home (padrão)').waitFor()
    } finally { await nav.close() }
  })
  it('login real no site abre o Studio do tenant pela sessão (cookie): lista os temas e abre o padrão', async () => {
    const l = await sobe(null), nav = await chromium.launch({ executablePath: CHROME!, args: ['--no-sandbox', '--host-resolver-rules=MAP *.polaris.localhost 127.0.0.1'] })
    try {
      const p = await nav.newPage(), erros: string[] = []; p.on('pageerror', (e) => erros.push(e.message)); p.on('console', (m) => { if (m.type() === 'error') erros.push(m.text()) })
      await p.goto(`http://loja-demo.polaris.localhost:${l.porta}/entrar?volta=%2Fstudio`); await p.getByLabel('E-mail').fill(emailLocal('loja-demo')); await p.getByLabel('Senha').fill(SENHA_LOCAL); await p.getByRole('button', { name: 'Entrar' }).click()
      await p.waitForURL(/\/studio$/); expect(p.url()).not.toContain('token') // o Studio usa a sessão do cookie: sem token na barra de endereço
      await p.getByRole('link', { name: 'Polaris Studio' }).waitFor(); await p.getByRole('button', { name: 'padrao (padrão)' }).click(); await p.getByText('Tokens do tema padrao').waitFor()
      await p.getByRole('button', { name: 'Salvar' }).click(); await p.getByText('Salvo como versão 1').waitFor()
      await p.getByRole('button', { name: 'Publicar' }).click(); await p.getByText(/Publicado: release 1/).waitFor() // o botão do Studio põe os rascunhos em produção
      await p.getByRole('button', { name: 'site.home (padrão)' }).click(); await p.locator('iframe').waitFor(); await p.waitForFunction(() => (document.querySelector('iframe')?.getAttribute('srcdoc') ?? '').includes('Bem-vindo à loja')) // a prévia de página com dados (sem isso ficava em branco)
      expect(erros.join(' | ')).toBe('')
    } finally { await nav.close() }
  })
})
