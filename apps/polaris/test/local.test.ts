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
const req = (l: Local, alias: string, metodo: string, caminho: string, token?: string, corpo?: unknown): Promise<{ status: number; headers: { get(k: string): string | null }; text(): Promise<string>; json(): Promise<unknown> }> => new Promise((ok, falha) => {
  const r = httpRequest({ host: '127.0.0.1', port: l.porta, method: metodo, path: caminho, headers: { host: `${alias}.polaris.localhost:${l.porta}`, ...(token ? { authorization: `Bearer ${token}` } : {}), ...(corpo !== undefined ? { 'content-type': 'application/json' } : {}) } }, (res) => {
    const partes: Buffer[] = []; res.on('data', (c) => partes.push(c)); res.on('end', () => { const t = Buffer.concat(partes).toString('utf8'); ok({ status: res.statusCode!, headers: { get: (k) => { const v = res.headers[k.toLowerCase()]; return Array.isArray(v) ? v[0]! : (v ?? null) } }, text: async () => t, json: async () => JSON.parse(t) }) })
  }); r.on('error', falha); if (corpo !== undefined) r.write(JSON.stringify(corpo)); r.end()
})
const get = (l: Local, alias: string, caminho: string, token?: string) => req(l, alias, 'GET', caminho, token)

describe('ambiente local', () => {
  it('login de desenvolvimento → token → Studio e API da loja pelo gateway, isolados por tenant', async () => {
    const l = await sobe(null)
    const pagina = await (await get(l, 'demo', '/entrar')).text(); expect(pagina).toContain('Loja Demo'); expect(pagina).toContain('studio.editor')
    const ir = await get(l, 'demo', '/entrar/ir?tenant=demo&papel=studio.editor&usuario=ana'); expect(ir.status).toBe(302)
    const loc = ir.headers.get('location')!; expect(loc).toMatch(new RegExp(`^http://demo\\.polaris\\.localhost:${l.porta}/studio#token=[\\w.-]+$`))
    const tk = /#token=(.+)$/.exec(loc)![1]!
    const studio = await get(l, 'demo', '/studio'); expect(studio.status).toBe(200); expect(studio.headers.get('content-security-policy')).toContain("frame-ancestors 'none'")
    const nos = await get(l, 'demo', '/studio/nos', tk); expect(nos.status).toBe(200); expect(((await nos.json()) as any).base.tema).toContain('padrao')
    // a loja: gerente cria, o outro tenant não vê
    const gerente = await l.token('demo', ['gerente']), outro = await l.token('outra', ['gerente'])
    const cria = await req(l, 'demo', 'POST', '/api/loja/produtos', gerente, { nome: 'Café', preco: '49.90' }); expect(cria.status).toBe(201)
    expect(JSON.stringify(await (await get(l, 'demo', '/api/loja/produtos', gerente)).json())).toContain('Café'); expect(JSON.stringify(await (await get(l, 'outra', '/api/loja/produtos', outro)).json())).not.toContain('Café')
    // token do tenant A no host do B é recusado
    expect((await get(l, 'outra', '/studio/nos', tk)).status).toBe(401)
  })
  it('o login recusa tenant, papel e usuário inválidos; papel sem permissão no Studio dá 403', async () => {
    const l = await sobe(null)
    for (const q of ['tenant=nao-existe&papel=studio.editor', 'tenant=demo&papel=admin', 'tenant=demo&papel=studio.editor&usuario=A%20B', 'tenant=demo', 'papel=studio.editor', 'tenant=demo&papel=studio.editor&usuario=%3Cscript%3E']) expect((await get(l, 'demo', `/entrar/ir?${q}`)).status, q).toBe(400)
    expect((await get(l, 'demo', '/studio/nos', await l.token('demo', ['gerente']))).status).toBe(403)
    for (const p of PAPEIS_LOCAIS) expect((await get(l, 'demo', `/entrar/ir?tenant=demo&papel=${p}`)).status).toBe(302)
    await expect(l.token('inexistente', [])).rejects.toThrow(/desconhecido/)
  })
  it('os dados persistem entre execuções (reabrir a mesma pasta traz o que foi gravado) e subir de novo é idempotente', async () => {
    const pasta = join(dir, 'pg'), a = await sobe(pasta)
    const tk = await a.token('demo', ['studio.editor'], 'ana'), no = { kind: 'tema', id: 'persistido', versao: '1.0.0', estatuto: 'publicado', spec: { tokens: { cor: { primaria: '#123456' } } } }
    const r = await req(a, 'demo', 'PUT', '/studio/nos/tema/persistido', tk, { no }); expect(r.status).toBe(201)
    await a.fecha(); abertos.splice(abertos.indexOf(a), 1)
    const b = await sobe(pasta); const lido = await get(b, 'demo', '/studio/nos/tema/persistido', await b.token('demo', ['studio.leitor']))
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
  it('clicar em "entrar" abre o Studio do tenant, já autenticado: lista os temas e abre o padrão', async () => {
    const l = await sobe(null), nav = await chromium.launch({ executablePath: CHROME!, args: ['--no-sandbox', '--host-resolver-rules=MAP *.polaris.localhost 127.0.0.1'] })
    try {
      const p = await nav.newPage(), erros: string[] = []; p.on('pageerror', (e) => erros.push(e.message)); p.on('console', (m) => { if (m.type() === 'error') erros.push(m.text()) })
      await p.goto(`http://demo.polaris.localhost:${l.porta}/entrar`); await p.getByRole('link', { name: /studio\.editor/ }).first().click()
      await p.waitForURL(/\/studio$/); expect(p.url()).not.toContain('token') // o token sai da barra de endereço
      await p.getByRole('heading', { name: 'Polaris Studio' }).waitFor(); await p.getByRole('button', { name: 'padrao (padrão)' }).click(); await p.getByText('Tokens do tema padrao').waitFor()
      await p.getByRole('button', { name: 'Salvar' }).click(); await p.getByText('Salvo como versão 1').waitFor()
      expect(erros.join(' | ')).toBe('')
    } finally { await nav.close() }
  })
})
