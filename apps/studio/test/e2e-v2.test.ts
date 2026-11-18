import { existsSync } from 'node:fs'
import { PGlite } from '@electric-sql/pglite'
import { registraBase } from '@polaris/engine'
import { registraTemas } from '@polaris/engine/tema'
import { DDL_DIRETORIO, criaArmazemDeNos, diretorioSql, registroDaPlataforma, type Sessao } from '@polaris/packs'
import type { FastifyInstance } from 'fastify'
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { criaServidorStudio } from '../src/servidor'
import './matchers'

// O Studio v2 É uma página da plataforma (nós JSON → programa → runtime vivo). Este E2E o usa num Chrome real contra o servidor real.
const CHROME = process.env.CHROME ?? ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find(existsSync)
const A = '11111111-1111-1111-1111-111111111111', B = '22222222-2222-2222-2222-222222222222'
let pg: PGlite, app: FastifyInstance, url = '', nav: Browser
const q = async (s: string, p: unknown[] = []) => { const r = await pg.query(s, p); return { rows: r.rows as Array<Record<string, unknown>>, rowCount: r.affectedRows ?? r.rows.length } }
const erros: string[] = []
beforeAll(async () => {
  if (!CHROME) return
  pg = new PGlite(); await pg.exec(DDL_DIRETORIO)
  for (const [id, alias] of [[A, 'loja-a'], [B, 'loja-b']] as const) await diretorioSql(q).cria({ tenantId: id, alias, nome: alias, segmento: 'varejo', packs: ['varejo'], donoEmail: `${alias}@x.com`, chave: `chave-v2-${alias}-xxxxxxxxxxx` })
  const base = registroDaPlataforma(); registraBase(base); registraTemas(base)
  const armazem = criaArmazemDeNos({ q, base })
  await armazem.salva(A, 'seed', { kind: 'tema', id: 'marca', versao: '1.0.0', estatuto: 'publicado', spec: { tokens: { cor: { fundo: '#ffffff', texto: '#111111', primaria: '#1d4ed8' }, espacamento: { base: 8 } } } }, 'seed')
  const autentica = async (req: { headers: Record<string, unknown> }): Promise<Sessao | null> => { const m = /(?:^|;\s*)u=([a-z0-9-]+)\|([a-z]+)/.exec(String(req.headers.cookie ?? '')); return m ? { tenantId: m[2] === 'b' ? B : A, usuario: m[1]!, pode: () => true } : null }
  app = criaServidorStudio({ armazem, baseDe: async () => base, q, autentica: autentica as never }); await app.listen({ port: 0, host: '127.0.0.1' })
  url = `http://127.0.0.1:${(app.server.address() as { port: number }).port}`
  nav = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] })
})
afterAll(async () => { await nav?.close(); await app?.close(); await pg?.close() })
async function entra(usuario: string, tenant: 'a' | 'b' = 'a'): Promise<{ ctx: BrowserContext; p: Page }> {
  const ctx = await nav.newContext({ viewport: { width: 1400, height: 900 } }); await ctx.addCookies([{ name: 'u', value: `${usuario}|${tenant}`, url }])
  const p = await ctx.newPage(); p.on('console', (m) => { if (m.type() === 'error' && !/status of (409|422)/.test(m.text())) erros.push(`${usuario}: ${m.text()}`) }); p.on('pageerror', (e) => erros.push(`${usuario}: ${e.message}`))
  await p.goto(`${url}/studio/v2`); await p.getByRole('heading', { name: 'Polaris Studio' }).waitFor(); return { ctx, p }
}
const quadro = (p: Page) => p.frameLocator('iframe[title="Amostra do tema"]')

describe.skipIf(!CHROME)('Studio v2: uma página da plataforma', () => {
  it('lista os temas do tenant e os padrões da plataforma (dados `auto` carregados antes de montar)', async () => {
    const { ctx, p } = await entra('ana')
    await expect(p.getByRole('button', { name: 'marca ●' })).toBeVisible(); await expect(p.getByRole('button', { name: 'padrao (padrão)' })).toBeVisible(); await expect(p.getByText('Tokens do tema')).toHaveCount(0)
    await ctx.close()
  })
  it('abre um tema, edita um token e a amostra muda na hora; "não salvas" aparece; salvar grava uma versão', async () => {
    const { ctx, p } = await entra('ana'); await p.getByRole('button', { name: 'marca ●' }).click()
    await expect(p.getByText('Tokens do tema marca')).toBeVisible(); await expect(p.getByText('salvo (v1)')).toBeVisible()
    const prim = p.getByRole('textbox', { name: 'cor primaria', exact: true }); await expect(prim).toHaveValue('#1d4ed8')
    await expect(quadro(p).locator('h1')).toHaveText('Título de exemplo')
    await prim.fill('#abcdef'); await expect(p.getByText('alterações não salvas')).toBeVisible()
    await p.waitForFunction(() => document.querySelector('iframe[title="Amostra do tema"]')?.getAttribute('srcdoc')?.toLowerCase().includes('#abcdef'))
    await p.getByRole('button', { name: 'Salvar' }).click(); await expect(p.getByText('Salvo como versão 2')).toBeVisible(); await expect(p.getByText('salvo (v2)')).toBeVisible()
    const salvo = (await app.inject({ url: '/studio/nos/tema/marca', headers: { cookie: 'u=ana|a' } })).json(); expect(salvo.seq).toBe(2); expect(salvo.no.spec.tokens.cor.primaria).toBe('#abcdef')
    await ctx.close()
  })
  it('abrir o tema padrão (da plataforma): salvar cria o override do tenant', async () => {
    const { ctx, p } = await entra('ana'); await p.getByRole('button', { name: 'padrao (padrão)' }).click(); await expect(p.getByText('padrão da plataforma')).toBeVisible()
    await p.getByRole('textbox', { name: 'cor primaria', exact: true }).fill('#123456'); await p.getByRole('button', { name: 'Salvar' }).click(); await expect(p.getByText('Salvo como versão 1')).toBeVisible()
    expect((await app.inject({ url: '/studio/nos/tema/padrao', headers: { cookie: 'u=ana|a' } })).json()).toMatchObject({ origem: 'tenant', seq: 1 })
    await ctx.close()
  })
  it('valor inválido é recusado pelo servidor e aparece como aviso e o rascunho continua', async () => {
    const { ctx, p } = await entra('ana'); await p.getByRole('button', { name: 'marca ●' }).click(); await expect(p.getByText('Tokens do tema marca')).toBeVisible()
    await p.getByRole('textbox', { name: 'cor primaria', exact: true }).fill('#abcdef'); await p.getByRole('textbox', { name: 'espacamento base', exact: true }).fill('{ruim')
    await p.getByRole('button', { name: 'Salvar' }).click(); await expect(p.getByText('valores inválidos')).toBeVisible(); await expect(p.getByText('espacamento.base')).toBeVisible(); await expect(p.getByText('Salvo como versão')).toHaveCount(0); await expect(p.getByText('alterações não salvas')).toBeVisible()
    await ctx.close()
  })
  it('isolamento: o tenant B não vê o tema do A', async () => {
    const { ctx, p } = await entra('bia', 'b'); await expect(p.getByRole('button', { name: 'padrao (padrão)' })).toBeVisible(); await expect(p.getByRole('button', { name: 'marca ●' })).toHaveCount(0); await ctx.close()
  })
  it('segurança: CSP do v2 sem unsafe-eval, sem violações no console e sem erros de página', async () => {
    const r = await (await entra('ana')).p.request.get(`${url}/studio/v2`); const csp = r.headers()['content-security-policy']!
    expect(csp).toContain("script-src 'self'"); expect(csp).not.toContain('unsafe-eval'); expect(csp).toContain("frame-ancestors 'none'"); expect(erros.join('\n')).toBe('')
  })
})
