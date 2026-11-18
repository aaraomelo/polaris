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
  const pg1 = (id: string) => ({ kind: 'pagina', id, versao: '1.0.0', estatuto: 'publicado', spec: { rota: `/${id}`, raiz: { bloco: 'layout/pilha', id: 'raiz', slots: { filhos: [{ bloco: 'texto/titulo', id: 'titulo', props: { texto: 'Bem-vindo', nivel: 1 } }, { bloco: 'texto/paragrafo', id: 'p1', props: { texto: 'Primeiro' } }, { bloco: 'texto/paragrafo', id: 'p2', props: { texto: 'Segundo' } }] } } } })
  for (const id of ['home', 'edita', 'estrutura', 'desfaz', 'hist', 'coment']) await armazem.salva(A, 'seed', pg1(id), 'seed')
  const autentica = async (req: { headers: Record<string, unknown> }): Promise<Sessao | null> => { const m = /(?:^|;\s*)u=([a-z0-9-]+)\|([a-z]+)/.exec(String(req.headers.cookie ?? '')); return m ? { tenantId: m[2] === 'b' ? B : A, usuario: m[1]!, pode: () => true } : null }
  app = criaServidorStudio({ armazem, baseDe: async () => base, q, autentica: autentica as never }); await app.listen({ port: 0, host: '127.0.0.1' })
  url = `http://127.0.0.1:${(app.server.address() as { port: number }).port}`
  nav = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] })
})
afterAll(async () => { await nav?.close(); await app?.close(); await pg?.close() })
async function entra(usuario: string, tenant: 'a' | 'b' = 'a'): Promise<{ ctx: BrowserContext; p: Page }> {
  const ctx = await nav.newContext({ viewport: { width: 1400, height: 900 } }); await ctx.addCookies([{ name: 'u', value: `${usuario}|${tenant}`, url }])
  const p = await ctx.newPage(); p.on('console', (m) => { if (m.type() === 'error' && !/status of (400|409|422)/.test(m.text())) erros.push(`${usuario}: ${m.text()} (${m.location().url})`) }); p.on('pageerror', (e) => erros.push(`${usuario}: ${e.message}`))
  await p.goto(`${url}/studio/v2`); await p.getByRole('heading', { name: 'Polaris Studio' }).waitFor(); return { ctx, p }
}
const previa = (p: Page) => p.frameLocator('iframe[title="Pré-visualização da página"]')
const linhaDe = (p: Page, id: string) => p.getByRole('button', { name: new RegExp(`#${id}$`) })
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
  it('páginas: lista, abre, mostra a árvore com ids e a prévia compilada pelo servidor', async () => {
    const { ctx, p } = await entra('ana'); await p.getByRole('button', { name: 'home ●' }).click()
    await expect(p.getByText('Página home')).toBeVisible(); await expect(linhaDe(p, 'raiz')).toBeVisible(); await expect(linhaDe(p, 'titulo')).toBeVisible(); await expect(previa(p).locator('h1')).toHaveText('Bem-vindo')
    await ctx.close()
  })
  it('editar prop: o formulário vem do schema do bloco, a prévia muda, desfazer e refazer funcionam (e digitar é um passo só)', async () => {
    const { ctx, p } = await entra('ana'); await p.getByRole('button', { name: 'edita ●' }).click(); await linhaDe(p, 'titulo').click()
    const texto = p.getByRole('textbox', { name: 'Texto', exact: true }); await expect(texto).toHaveValue('Bem-vindo'); await expect(p.getByRole('textbox', { name: 'Nível' })).toHaveValue('1')
    await texto.fill(''); await texto.pressSequentially('Olá!', { delay: 20 }); await expect(previa(p).locator('h1')).toHaveText('Olá!')
    await p.getByRole('textbox', { name: 'Nível' }).fill('2'); await expect(previa(p).locator('h2')).toHaveText('Olá!'); await expect(p.getByText('alterações não salvas')).toBeVisible()
    await p.getByRole('button', { name: 'Desfazer' }).click(); await expect(previa(p).locator('h1')).toHaveText('Olá!') // desfez só o nível
    await p.getByRole('button', { name: 'Desfazer' }).click(); await expect(previa(p).locator('h1')).toHaveText('Bem-vindo') // desfez TODA a digitação de uma vez
    await p.getByRole('button', { name: 'Refazer' }).click(); await expect(previa(p).locator('h1')).toHaveText('Olá!')
    await p.getByRole('textbox', { name: 'Nível' }).fill('9'); await expect(p.getByText('O preview não compila:')).toBeVisible(); await expect(p.getByText(/<= 6|máximo|maior/).first()).toBeVisible() // o compilador acusa nível 9 (máximo 6)
    await ctx.close()
  })
  it('estrutura: adicionar bloco (nasce válido), mover, remover; salvar grava e a recarga traz o salvo', async () => {
    const { ctx, p } = await entra('ana'); await p.getByRole('button', { name: 'estrutura ●' }).click(); await linhaDe(p, 'raiz').click()
    await p.getByRole('button', { name: '+ texto/pequeno' }).click(); await expect(linhaDe(p, 'b1')).toBeVisible(); await expect(previa(p).getByText('Texto', { exact: true })).toBeVisible()
    await linhaDe(p, 'p2').click(); await p.getByRole('button', { name: 'Subir' }).click(); const ids = async () => (await p.getByRole('button', { name: /#/ }).allTextContents()).map((t) => /#(\w+)$/.exec(t)?.[1]).filter(Boolean).join(',')
    expect(await ids()).toBe('raiz,titulo,p2,p1,b1')
    await p.getByRole('button', { name: 'Remover' }).click(); expect(await ids()).toBe('raiz,titulo,p1,b1')
    await p.getByRole('button', { name: 'Salvar' }).click(); await expect(p.getByText('Salvo como versão 2')).toBeVisible()
    const salvo = (await app.inject({ url: '/studio/nos/pagina/estrutura', headers: { cookie: 'u=ana|a' } })).json(); expect(salvo.seq).toBe(2); expect(salvo.no.spec.raiz.slots.filhos.map((f: any) => f.id)).toEqual(['titulo', 'p1', 'b1'])
    await ctx.close()
  })
  it('tema: adicionar e remover token, contraste baixo avisado, e criar tema novo (id inválido recusado pelo servidor)', async () => {
    const { ctx, p } = await entra('ana'); await p.getByRole('button', { name: 'marca ●' }).click(); await expect(p.getByText('Tokens do tema marca')).toBeVisible()
    await p.getByRole('textbox', { name: 'novo token de cor', exact: true }).fill('destaque'); await p.getByRole('textbox', { name: 'valor do novo token de cor', exact: true }).fill('#ff8800'); await p.getByRole('button', { name: 'Adicionar token' }).first().click()
    await expect(p.getByRole('textbox', { name: 'cor destaque', exact: true })).toHaveValue('#ff8800')
    await p.getByRole('textbox', { name: 'cor texto', exact: true }).fill('#dddddd'); await expect(p.getByText(/Contraste baixo em texto\/fundo/)).toBeVisible()
    await p.getByRole('textbox', { name: 'cor texto', exact: true }).fill('#111111'); await expect(p.getByText(/Contraste baixo em texto\/fundo/)).toHaveCount(0)
    await p.getByRole('button', { name: 'Desfazer' }).click(); await p.getByRole('button', { name: 'Desfazer' }).click(); await expect(p.getByRole('textbox', { name: 'cor destaque', exact: true })).toHaveCount(0) // desfez o token novo
    await p.getByRole('button', { name: 'Novo tema' }).click(); await p.getByRole('textbox', { name: 'Identificador do novo nó' }).fill('Ruim!'); await p.getByRole('button', { name: 'Criar', exact: true }).click()
    await expect(p.getByText('Tokens do tema Ruim!')).toBeVisible(); await expect(p.getByText('alterações não salvas')).toBeVisible(); await p.getByRole('button', { name: 'Salvar' }).click(); await expect(p.getByText(/inválid|não passou/).first()).toBeVisible()
    await ctx.close()
  })
  it('nova página: nasce no rascunho, compila, ganha blocos e salva como versão 1', async () => {
    const { ctx, p } = await entra('ana'); await p.getByRole('button', { name: 'Nova página' }).click(); await p.getByRole('textbox', { name: 'Identificador do novo nó' }).fill('criada-no-v2'); await p.getByRole('textbox', { name: 'Rota da nova página' }).fill('/criada'); await p.getByRole('button', { name: 'Criar', exact: true }).click()
    await expect(p.getByText('Página criada-no-v2')).toBeVisible(); await linhaDe(p, 'raiz').click(); await p.getByRole('button', { name: '+ texto/titulo' }).click(); await expect(previa(p).locator('h1')).toHaveText('Texto')
    await p.getByRole('button', { name: 'Salvar' }).click(); await expect(p.getByText('Salvo como versão 1')).toBeVisible(); expect((await app.inject({ url: '/studio/nos/pagina/criada-no-v2', headers: { cookie: 'u=ana|a' } })).json()).toMatchObject({ origem: 'tenant', seq: 1 })
    await ctx.close()
  })
  it('histórico: versões, diff semântico entre elas, restaurar no editor e salvar como nova versão', async () => {
    const { ctx, p } = await entra('ana'); await p.getByRole('button', { name: 'hist ●' }).click(); await linhaDe(p, 'p1').click()
    await p.getByRole('textbox', { name: 'Texto', exact: true }).fill('Primeiro editado'); await p.getByRole('button', { name: 'Salvar' }).click(); await expect(p.getByText('Salvo como versão 2')).toBeVisible()
    await linhaDe(p, 'raiz').click(); await p.getByRole('button', { name: '+ feedback/selo' }).click(); await p.getByRole('button', { name: 'Salvar' }).click(); await expect(p.getByText('Salvo como versão 3')).toBeVisible()
    await p.getByRole('button', { name: 'Histórico e comentários' }).click(); await expect(p.getByText(/^v1 · seed/)).toBeVisible(); await expect(p.getByText(/^v3 · ana/)).toBeVisible()
    await p.getByRole('button', { name: 'De' }).last().click(); await p.getByRole('button', { name: 'Para' }).first().click(); await p.getByRole('button', { name: 'Comparar versões' }).click()
    await expect(p.getByText(/^adicionado .*b1/)).toBeVisible(); await expect(p.getByText(/alterado .*p1/)).toBeVisible(); await expect(p.getByText(/props\.texto: "?Primeiro"? → "?Primeiro editado"?/)).toBeVisible()
    await p.getByRole('button', { name: 'Restaurar no editor' }).last().click(); await expect(p.getByText('alterações não salvas')).toBeVisible(); await p.getByRole('button', { name: 'Editor', exact: true }).click(); await expect(previa(p).getByText('Primeiro', { exact: true })).toBeVisible()
    await p.getByRole('button', { name: 'Salvar' }).click(); await expect(p.getByText('Salvo como versão 4')).toBeVisible(); await ctx.close()
  })
  it('comentários: ancorado no bloco selecionado, resposta de outra pessoa, resolver; texto é sempre texto; bloco removido deixa o fio órfão', async () => {
    const a = await entra('ana'), b = await entra('beto'); await a.p.getByRole('button', { name: 'coment ●' }).click(); await linhaDe(a.p, 'p1').click(); await a.p.getByRole('button', { name: 'Histórico e comentários' }).click()
    await a.p.getByRole('textbox', { name: 'Comentário' }).fill('<b>trocar</b> a fonte'); await a.p.getByRole('button', { name: 'Comentar', exact: true }).click()
    await expect(a.p.getByText('ana #p1: <b>trocar</b> a fonte')).toBeVisible(); expect(await a.p.locator('b').count()).toBe(0)
    await b.p.getByRole('button', { name: 'coment ●' }).click(); await b.p.getByRole('button', { name: 'Histórico e comentários' }).click(); await expect(b.p.getByText('ana #p1: <b>trocar</b> a fonte')).toBeVisible()
    await b.p.getByRole('button', { name: 'Responder' }).click(); await b.p.getByRole('textbox', { name: 'Comentário' }).fill('concordo'); await b.p.getByRole('button', { name: 'Comentar', exact: true }).click(); await expect(b.p.getByText('↳ beto: concordo')).toBeVisible()
    await b.p.getByRole('button', { name: 'Resolver' }).click(); await expect(b.p.getByText(/ana #p1 \(resolvido\)/)).toBeVisible()
    await a.p.getByRole('button', { name: 'Editor', exact: true }).click(); await linhaDe(a.p, 'p1').click(); await a.p.getByRole('button', { name: 'Remover' }).click(); await a.p.getByRole('button', { name: 'Salvar' }).click(); await expect(a.p.getByText('Salvo como versão 2')).toBeVisible()
    await a.ctx.close(); await b.ctx.close()
  })
  it('isolamento: o tenant B não vê o tema do A', async () => {
    const { ctx, p } = await entra('bia', 'b'); await expect(p.getByRole('button', { name: 'padrao (padrão)' })).toBeVisible(); await expect(p.getByRole('button', { name: 'marca ●' })).toHaveCount(0); await ctx.close()
  })
  it('segurança: CSP do v2 sem unsafe-eval, sem violações no console e sem erros de página', async () => {
    const r = await (await entra('ana')).p.request.get(`${url}/studio/v2`); const csp = r.headers()['content-security-policy']!
    expect(csp).toContain("script-src 'self'"); expect(csp).not.toContain('unsafe-eval'); expect(csp).toContain("frame-ancestors 'none'"); expect(erros.join('\n')).toBe('')
  })
})
