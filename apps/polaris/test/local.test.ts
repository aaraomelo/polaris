process.env.POLARIS_LOG_NIVEL = 'silencio'
import { vi } from 'vitest'
vi.setConfig({ testTimeout: 120_000, hookTimeout: 120_000 })
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { request as httpRequest } from 'node:http'
import { join } from 'node:path'
import { existsSync } from 'node:fs'
import { chromium } from 'playwright-core'
import { afterAll, describe, expect, it } from 'vitest'
import { PAPEIS_LOCAIS, sobeLocal, type Local } from '../src/local'

// O ambiente local de ponta a ponta: Postgres (PGlite com protocolo), serviço migrado, gateway, Studio e o login de desenvolvimento.
const dir = mkdtempSync(join(tmpdir(), 'polaris-local-')); const abertos: Local[] = []
const sobe = async (dados: string | null) => { const l = await sobeLocal({ dados, porta: 0, silencioso: true }); abertos.push(l); return l }
afterAll(async () => { for (const l of abertos) await l.fecha().catch(() => {}); rmSync(dir, { recursive: true, force: true }) })
// `fetch` não deixa trocar o cabeçalho Host; o tenant sai do Host, então as chamadas usam node:http
const req = (l: Local, alias: string, metodo: string, caminho: string, token?: string, corpo?: unknown, extra: Record<string, string> = {}): Promise<{ status: number; headers: { get(k: string): string | null }; text(): Promise<string>; json(): Promise<unknown> }> => new Promise((ok, falha) => {
  const r = httpRequest({ host: '127.0.0.1', port: l.porta, method: metodo, path: caminho, headers: { host: `${alias}.polaris.localhost:${l.porta}`, ...(token ? { authorization: `Bearer ${token}` } : {}), ...(corpo !== undefined ? { 'content-type': 'application/json' } : {}), ...extra } }, (res) => {
    const partes: Buffer[] = []; res.on('data', (c) => partes.push(c)); res.on('end', () => { const t = Buffer.concat(partes).toString('utf8'); ok({ status: res.statusCode!, headers: { get: (k) => { const v = res.headers[k.toLowerCase()]; return Array.isArray(v) ? v[0]! : (v ?? null) } }, text: async () => t, json: async () => JSON.parse(t) }) })
  }); r.on('error', falha); if (corpo !== undefined) r.write(JSON.stringify(corpo)); r.end()
})
const get = (l: Local, alias: string, caminho: string, token?: string) => req(l, alias, 'GET', caminho, token)

describe('ambiente local', () => {
  it('login de desenvolvimento → token → Studio e API da loja pelo gateway, isolados por tenant', async () => {
    const l = await sobe(null)
    const pagina = await (await get(l, 'loja-demo', '/entrar')).text(); expect(pagina).toContain('Loja Demo'); expect(pagina).toContain('studio.editor')
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
  it('o login recusa tenant, papel e usuário inválidos; papel sem permissão no Studio dá 403', async () => {
    const l = await sobe(null)
    for (const q of ['tenant=nao-existe&papel=studio.editor', 'tenant=loja-demo&papel=admin', 'tenant=loja-demo&papel=studio.editor&usuario=A%20B', 'tenant=loja-demo', 'papel=studio.editor', 'tenant=loja-demo&papel=studio.editor&usuario=%3Cscript%3E']) expect((await get(l, 'loja-demo', `/entrar/ir?${q}`)).status, q).toBe(400)
    expect((await get(l, 'loja-demo', '/studio/nos', await l.token('loja-demo', ['gerente']))).status).toBe(403)
    for (const p of PAPEIS_LOCAIS) expect((await get(l, 'loja-demo', `/entrar/ir?tenant=loja-demo&papel=${p}`)).status).toBe(302)
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
  it('no navegador: página protegida → login → volta para ela já logado → sair', async () => {
    const l = await sobe(null), nav = await chromium.launch({ executablePath: CHROME!, args: ['--no-sandbox', '--host-resolver-rules=MAP *.polaris.localhost 127.0.0.1'] })
    try {
      const p = await nav.newPage(), erros: string[] = []; p.on('pageerror', (e) => erros.push(e.message)); p.on('console', (m) => { if (m.type() === 'error') erros.push(`${m.text()} ${m.location().url}`) })
      await p.goto(`http://loja-demo.polaris.localhost:${l.porta}/produtos`) // sem sessão: cai no login com ?volta
      await p.getByRole('heading', { name: /Polaris/ }).waitFor(); expect(p.url()).toContain('volta=%2Fprodutos')
      await p.locator('li', { hasText: 'Loja Demo' }).first() // a página lista os dois tenants
      await p.locator('h2', { hasText: 'Loja Demo' }).locator('xpath=following-sibling::ul[1]').getByRole('link', { name: /site como gerente/ }).click()
      await p.waitForURL(/\/produtos$/); await p.getByRole('heading', { name: 'Produtos' }).waitFor()
      expect(await p.evaluate(() => document.cookie)).not.toContain('polaris_sessao') // HttpOnly: o JavaScript não enxerga
      await p.evaluate(() => fetch('/_polaris/sair', { method: 'POST' })); await p.reload(); await p.waitForURL(/\/entrar\?volta=/)
      expect(erros.filter((x) => !/status of (401|403)/.test(x)).join(' | ')).toBe('')
    } finally { await nav.close() }
  })
  it('clicar em "entrar" abre o Studio do tenant, já autenticado: lista os temas e abre o padrão', async () => {
    const l = await sobe(null), nav = await chromium.launch({ executablePath: CHROME!, args: ['--no-sandbox', '--host-resolver-rules=MAP *.polaris.localhost 127.0.0.1'] })
    try {
      const p = await nav.newPage(), erros: string[] = []; p.on('pageerror', (e) => erros.push(e.message)); p.on('console', (m) => { if (m.type() === 'error') erros.push(m.text()) })
      await p.goto(`http://loja-demo.polaris.localhost:${l.porta}/entrar`); await p.getByRole('link', { name: /studio\.editor/ }).first().click()
      await p.waitForURL(/\/studio$/); expect(p.url()).not.toContain('token') // o token sai da barra de endereço
      await p.getByRole('heading', { name: 'Polaris Studio' }).waitFor(); await p.getByRole('button', { name: 'padrao (padrão)' }).click(); await p.getByText('Tokens do tema padrao').waitFor()
      await p.getByRole('button', { name: 'Salvar' }).click(); await p.getByText('Salvo como versão 1').waitFor()
      expect(erros.join(' | ')).toBe('')
    } finally { await nav.close() }
  })
})
