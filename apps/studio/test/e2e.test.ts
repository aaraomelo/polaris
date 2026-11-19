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

// O Studio É uma página da plataforma (nós JSON → programa → runtime vivo). Este E2E o usa num Chrome real contra o servidor real.
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
  for (const id of ['home', 'edita', 'estrutura', 'desfaz', 'hist', 'coment', 'conflito', 'xss']) await armazem.salva(A, 'seed', pg1(id), 'seed')
  const autentica = async (req: { headers: Record<string, unknown> }): Promise<Sessao | null> => { const m = /(?:^|;\s*)u=([a-z0-9-]+)\|([a-z]+)/.exec(String(req.headers.cookie ?? '')); return m ? { tenantId: m[2] === 'b' ? B : A, usuario: m[1]!, pode: () => true } : null }
  app = criaServidorStudio({ armazem, baseDe: async () => base, q, autentica: autentica as never }); await app.listen({ port: 0, host: '127.0.0.1' })
  url = `http://127.0.0.1:${(app.server.address() as { port: number }).port}`
  nav = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] })
})
afterAll(async () => { await nav?.close(); await app?.close(); await pg?.close() })
async function entra(usuario: string, tenant: 'a' | 'b' = 'a'): Promise<{ ctx: BrowserContext; p: Page }> {
  const ctx = await nav.newContext({ viewport: { width: 1400, height: 900 } }); await ctx.addCookies([{ name: 'u', value: `${usuario}|${tenant}`, url }])
  const p = await ctx.newPage(); p.on('console', (m) => { if (m.type() === 'error' && !/status of (400|409|422)/.test(m.text())) erros.push(`${usuario}: ${m.text()} (${m.location().url})`) }); p.on('pageerror', (e) => erros.push(`${usuario}: ${e.message}`))
  await p.goto(`${url}/studio`); await p.getByRole('link', { name: 'Polaris Studio' }).waitFor(); return { ctx, p }
}
const previa = (p: Page) => p.frameLocator('iframe[title="Pré-visualização da página"]')
/** a paleta horizontal: abre a categoria (botão "Texto (n)") e escolhe o bloco pelo título */
const adiciona = async (p: Page, categoria: string, titulo: string) => { await p.getByRole('button', { name: new RegExp(`^${categoria}\\s\\(\\d+\\)$`) }).click(); await p.getByRole('button', { name: titulo, exact: true }).click() }
const linhaDe = (p: Page, id: string) => p.getByRole('button', { name: new RegExp(`#${id}$`) })
const quadro = (p: Page) => p.frameLocator('iframe[title="Amostra do tema"]')

describe.skipIf(!CHROME)('Studio: uma página da plataforma', () => {
  it('lista os temas do tenant e os padrões da plataforma (dados `auto` carregados antes de montar)', async () => {
    const { ctx, p } = await entra('ana')
    await expect(p.getByRole('button', { name: 'marca (personalizado)' })).toBeVisible(); await expect(p.getByRole('button', { name: 'padrao (padrão)' })).toBeVisible(); await expect(p.getByText('Tokens do tema')).toHaveCount(0)
    await ctx.close()
  })
  it('abre um tema, edita um token e a amostra muda na hora; "não salvas" aparece; salvar grava uma versão', async () => {
    const { ctx, p } = await entra('ana'); await p.getByRole('button', { name: 'marca (personalizado)' }).click()
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
    const { ctx, p } = await entra('ana'); await p.getByRole('button', { name: 'marca (personalizado)' }).click(); await expect(p.getByText('Tokens do tema marca')).toBeVisible()
    await p.getByRole('textbox', { name: 'cor primaria', exact: true }).fill('#abcdef'); await p.getByRole('textbox', { name: 'espacamento base', exact: true }).fill('{ruim')
    await p.getByRole('button', { name: 'Salvar' }).click(); await expect(p.getByText('valores inválidos')).toBeVisible(); await expect(p.getByText('espacamento.base')).toBeVisible(); await expect(p.getByText('Salvo como versão')).toHaveCount(0); await expect(p.getByText('alterações não salvas')).toBeVisible()
    await ctx.close()
  })
  it('páginas: lista, abre, mostra a árvore com ids e a prévia compilada pelo servidor', async () => {
    const { ctx, p } = await entra('ana'); await p.getByRole('button', { name: 'home (personalizado)' }).click()
    await expect(p.getByText('Página home')).toBeVisible(); await expect(linhaDe(p, 'raiz')).toBeVisible(); await expect(linhaDe(p, 'titulo')).toBeVisible(); await expect(previa(p).locator('h1')).toHaveText('Bem-vindo')
    await ctx.close()
  })
  it('editar prop: o formulário vem do schema do bloco, a prévia muda, desfazer e refazer funcionam (e digitar é um passo só)', async () => {
    const { ctx, p } = await entra('ana'); await p.getByRole('button', { name: 'edita (personalizado)' }).click(); await linhaDe(p, 'titulo').click()
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
    const { ctx, p } = await entra('ana'); await p.getByRole('button', { name: 'estrutura (personalizado)' }).click(); await linhaDe(p, 'raiz').click()
    await adiciona(p, 'Texto', 'Texto pequeno'); await expect(linhaDe(p, 'b1')).toBeVisible(); await expect(previa(p).getByText('Texto', { exact: true })).toBeVisible()
    await linhaDe(p, 'p2').click(); await p.getByRole('button', { name: 'Subir' }).click(); const ids = async () => (await p.getByRole('button', { name: /#/ }).allTextContents()).map((t) => /#(\w+)$/.exec(t)?.[1]).filter(Boolean).join(',')
    expect(await ids()).toBe('raiz,titulo,p2,p1,b1')
    await p.getByRole('button', { name: 'Remover' }).click(); expect(await ids()).toBe('raiz,titulo,p1,b1')
    await p.getByRole('button', { name: 'Salvar' }).click(); await expect(p.getByText('Salvo como versão 2')).toBeVisible()
    const salvo = (await app.inject({ url: '/studio/nos/pagina/estrutura', headers: { cookie: 'u=ana|a' } })).json(); expect(salvo.seq).toBe(2); expect(salvo.no.spec.raiz.slots.filhos.map((f: any) => f.id)).toEqual(['titulo', 'p1', 'b1'])
    await ctx.close()
  })
  it('tema: adicionar e remover token, contraste baixo avisado, e criar tema novo (id inválido recusado pelo servidor)', async () => {
    const { ctx, p } = await entra('ana'); await p.getByRole('button', { name: 'marca (personalizado)' }).click(); await expect(p.getByText('Tokens do tema marca')).toBeVisible()
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
    await expect(p.getByText('Página criada-no-v2')).toBeVisible(); await linhaDe(p, 'raiz').click(); await adiciona(p, 'Texto', 'Título'); await expect(previa(p).locator('h1')).toHaveText('Texto')
    await p.getByRole('button', { name: 'Salvar' }).click(); await expect(p.getByText('Salvo como versão 1')).toBeVisible(); expect((await app.inject({ url: '/studio/nos/pagina/criada-no-v2', headers: { cookie: 'u=ana|a' } })).json()).toMatchObject({ origem: 'tenant', seq: 1 })
    await ctx.close()
  })
  it('histórico: versões, diff semântico entre elas, restaurar no editor e salvar como nova versão', async () => {
    const { ctx, p } = await entra('ana'); await p.getByRole('button', { name: 'hist (personalizado)' }).click(); await linhaDe(p, 'p1').click()
    await p.getByRole('textbox', { name: 'Texto', exact: true }).fill('Primeiro editado'); await p.getByRole('button', { name: 'Salvar' }).click(); await expect(p.getByText('Salvo como versão 2')).toBeVisible()
    await linhaDe(p, 'raiz').click(); await adiciona(p, 'Feedback', 'Selo'); await p.getByRole('button', { name: 'Salvar' }).click(); await expect(p.getByText('Salvo como versão 3')).toBeVisible()
    await p.getByRole('button', { name: 'Histórico e comentários' }).click(); await expect(p.getByText(/^v1 · seed/)).toBeVisible(); await expect(p.getByText(/^v3 · ana/)).toBeVisible()
    await p.getByRole('button', { name: 'De' }).last().click(); await p.getByRole('button', { name: 'Para' }).first().click(); await p.getByRole('button', { name: 'Comparar versões' }).click()
    await expect(p.getByText(/^adicionado .*b1/)).toBeVisible(); await expect(p.getByText(/alterado .*p1/)).toBeVisible(); await expect(p.getByText(/props\.texto: "?Primeiro"? → "?Primeiro editado"?/)).toBeVisible()
    await p.getByRole('button', { name: 'Restaurar no editor' }).last().click(); await expect(p.getByText('alterações não salvas')).toBeVisible(); await p.getByRole('button', { name: 'Editor', exact: true }).click(); await expect(previa(p).getByText('Primeiro', { exact: true })).toBeVisible()
    await p.getByRole('button', { name: 'Salvar' }).click(); await expect(p.getByText('Salvo como versão 4')).toBeVisible(); await ctx.close()
  })
  it('comentários: ancorado no bloco selecionado, resposta de outra pessoa, resolver; texto é sempre texto; bloco removido deixa o fio órfão', async () => {
    const a = await entra('ana'), b = await entra('beto'); await a.p.getByRole('button', { name: 'coment (personalizado)' }).click(); await linhaDe(a.p, 'p1').click(); await a.p.getByRole('button', { name: 'Histórico e comentários' }).click()
    await a.p.getByRole('textbox', { name: 'Comentário' }).fill('<b>trocar</b> a fonte'); await a.p.getByRole('button', { name: 'Comentar', exact: true }).click()
    await expect(a.p.getByText('ana #p1: <b>trocar</b> a fonte')).toBeVisible(); expect(await a.p.locator('b').count()).toBe(0)
    await b.p.getByRole('button', { name: 'coment (personalizado)' }).click(); await b.p.getByRole('button', { name: 'Histórico e comentários' }).click(); await expect(b.p.getByText('ana #p1: <b>trocar</b> a fonte')).toBeVisible()
    await b.p.getByRole('button', { name: 'Responder' }).click(); await b.p.getByRole('textbox', { name: 'Comentário' }).fill('concordo'); await b.p.getByRole('button', { name: 'Comentar', exact: true }).click(); await expect(b.p.getByText('↳ beto: concordo')).toBeVisible()
    await b.p.getByRole('button', { name: 'Resolver' }).click(); await expect(b.p.getByText(/ana #p1 \(resolvido\)/)).toBeVisible()
    await a.p.getByRole('button', { name: 'Editor', exact: true }).click(); await linhaDe(a.p, 'p1').click(); await a.p.getByRole('button', { name: 'Remover' }).click(); await a.p.getByRole('button', { name: 'Salvar' }).click(); await expect(a.p.getByText('Salvo como versão 2')).toBeVisible()
    await a.ctx.close(); await b.ctx.close()
  })
  it('conflito: quem salva depois de outra pessoa é avisado e nada é sobrescrito', async () => {
    const a = await entra('ana'), b = await entra('beto'); await a.p.getByRole('button', { name: 'conflito (personalizado)' }).click(); await b.p.getByRole('button', { name: 'conflito (personalizado)' }).click(); await linhaDe(a.p, 'p2').click(); await linhaDe(b.p, 'p2').click()
    await b.p.getByRole('textbox', { name: 'Texto', exact: true }).fill('do Beto'); await b.p.getByRole('button', { name: 'Salvar' }).click(); await expect(b.p.getByText('Salvo como versão 2')).toBeVisible()
    await a.p.getByRole('textbox', { name: 'Texto', exact: true }).fill('da Ana'); await a.p.getByRole('button', { name: 'Salvar' }).click(); await expect(a.p.getByText(/alterado por outra pessoa/)).toBeVisible(); await expect(a.p.getByText('alterações não salvas')).toBeVisible()
    const atual = (await app.inject({ url: '/studio/nos/pagina/conflito', headers: { cookie: 'u=ana|a' } })).json(); expect(JSON.stringify(atual.no)).toContain('do Beto'); expect(JSON.stringify(atual.no)).not.toContain('da Ana')
    await a.ctx.close(); await b.ctx.close()
  })
  it('segurança: HTML no texto vira texto na prévia; o quadro é sandbox sem scripts; nada executa', async () => {
    const { ctx, p } = await entra('ana'); await p.getByRole('button', { name: 'xss (personalizado)' }).click(); await linhaDe(p, 'p1').click()
    await p.getByRole('textbox', { name: 'Texto', exact: true }).fill('<img src=x onerror="window.top.__xss=1"><script>window.top.__xss=1</script>')
    await expect(previa(p).getByText('<img src=x')).toBeVisible(); await p.waitForTimeout(300); expect(await p.evaluate(() => (window as any).__xss)).toBeUndefined()
    expect(await p.locator('iframe[title="Pré-visualização da página"]').getAttribute('sandbox')).toBe(''); expect(await previa(p).locator('img').count()).toBe(0)
    await ctx.close()
  })
  it('acessibilidade básica: título, campos com nome acessível, quadro com título, foco por teclado nos botões', async () => {
    const { ctx, p } = await entra('ana'); await p.getByRole('button', { name: 'home (personalizado)' }).click(); await linhaDe(p, 'titulo').click()
    expect(await p.title()).toBe('Polaris Studio'); await expect(p.getByRole('heading', { level: 1, name: 'Polaris Studio' })).toBeVisible()
    for (const i of await p.getByRole('textbox').all()) expect(((await i.getAttribute('aria-label')) ?? (await i.getAttribute('id')) ?? '').length, 'campo sem nome acessível').toBeGreaterThan(0)
    for (const f of await p.locator('iframe').all()) expect((await f.getAttribute('title')) ?? '').not.toBe('')
    await p.getByRole('button', { name: 'home (personalizado)' }).focus(); await p.keyboard.press('Enter'); await expect(p.getByText('Página home')).toBeVisible()
    await ctx.close()
  })
  it('paleta de blocos: categorias na horizontal com contagem, lista com título e resumo, busca em todas, entra DENTRO do que aceita filhos e DEPOIS do que não aceita', async () => {
    const { ctx, p } = await entra('ana'); await p.getByRole('button', { name: 'Nova página' }).click(); await p.getByRole('textbox', { name: 'Identificador do novo nó' }).fill('paleta-teste'); await p.getByRole('textbox', { name: 'Rota da nova página' }).fill('/paleta'); await p.getByRole('button', { name: 'Criar', exact: true }).click() // página nova e vazia: o teste não depende do que os outros deixaram nas páginas de exemplo
    await expect(p.getByText('Página paleta-teste')).toBeVisible(); await linhaDe(p, 'raiz').click()
    const cats = await p.getByRole('button', { name: /^(Layout|Texto|Navegação|Formulário|Entrada|Mídia|Dados|Feedback|Site|Outros)\s\(\d+\)$/ }).allInnerTexts(); expect(cats.map((c) => c.replace(/\s\(\d+\)$/, ''))).toEqual(['Layout', 'Texto', 'Navegação', 'Formulário', 'Entrada', 'Mídia', 'Dados', 'Feedback', 'Site', 'Outros'])
    await expect(p.getByText('Adicionar dentro de layout/pilha')).toBeVisible()
    const boxes = await Promise.all(cats.map(async (_, i) => (await p.getByRole('button', { name: /^(Layout|Texto|Navegação|Formulário|Entrada|Mídia|Dados|Feedback|Site|Outros)\s\(\d+\)$/ }).nth(i).boundingBox())!)); expect(new Set(boxes.map((b) => Math.round(b!.y))).size).toBeLessThanOrEqual(2) // lado a lado (uma linha, no máximo quebra uma vez)
    await p.setViewportSize({ width: 1000, height: 800 }); expect(await p.evaluate(() => { const m = document.querySelector('main')!; return m.scrollWidth <= m.clientWidth })).toBe(true); await p.setViewportSize({ width: 1280, height: 720 }) // a paleta quebra em outra linha em vez de rolar o conteúdo para o lado
    await expect(p.getByRole('button', { name: 'Pilha', exact: true })).toHaveCount(0) // nada aberto: a lista longa de antes sumiu
    await p.getByRole('button', { name: /^Layout\s\(/ }).click(); await expect(p.getByRole('button', { name: 'Pilha', exact: true })).toBeVisible(); await expect(p.getByText('Empilha os filhos na vertical')).toBeVisible(); expect(await p.locator('button[data-icone]', { hasText: 'Pilha' }).getAttribute('data-icone')).toBe('layout-pilha') // título, resumo e ícone
    await expect(p.getByRole('button', { name: /^Layout\s\(/ })).toHaveAttribute('aria-current', 'true'); await p.getByRole('button', { name: /^Layout\s\(/ }).click(); await expect(p.getByRole('button', { name: 'Pilha', exact: true })).toHaveCount(0) // abre e fecha
    await p.getByRole('textbox', { name: 'Buscar bloco' }).fill('tabela'); await expect(p.getByRole('button', { name: 'Tabela', exact: true })).toBeVisible(); await expect(p.getByRole('button', { name: 'Pilha', exact: true })).toHaveCount(0)
    await p.getByRole('textbox', { name: 'Buscar bloco' }).fill('zzzqqq'); await expect(p.getByText('Nenhum bloco para "zzzqqq".')).toBeVisible(); await p.getByRole('textbox', { name: 'Buscar bloco' }).fill('')
    const ids = async () => (await p.getByRole('button', { name: /#/ }).allTextContents()).map((t) => /#(\w+)$/.exec(t)?.[1]).filter(Boolean)
    await adiciona(p, 'Texto', 'Parágrafo'); await adiciona(p, 'Texto', 'Título') // dois filhos dentro do raiz (o raiz continua selecionado)
    const [primeiro, segundo] = (await ids()).filter((x) => x !== 'raiz'); expect(await ids()).toEqual(['raiz', primeiro, segundo]); await linhaDe(p, primeiro!).click();  await expect(p.getByText('Adicionar depois de texto/paragrafo')).toBeVisible(); const antes = await ids(); await adiciona(p, 'Texto', 'Texto pequeno'); const depois = await ids()
    const novo = depois.filter((x) => !antes.includes(x)); expect(novo).toHaveLength(1); expect(depois).toEqual(['raiz', primeiro, novo[0], segundo]) // DEPOIS do selecionado, no mesmo pai (entre os dois)
    await linhaDe(p, 'raiz').click(); await adiciona(p, 'Feedback', 'Alerta'); const fim = await ids(); expect(fim.length).toBe(depois.length + 1); expect(fim[fim.length - 1]).toBe(fim.filter((x) => !depois.includes(x))[0]) // no raiz: entra dentro, no fim
    await expect(p.getByRole('button', { name: 'Alerta', exact: true })).toHaveCount(0) // a lista fecha depois de adicionar
    await ctx.close()
  })
  it('redesenho: painel com cabeçalho, menu lateral (o nó aberto fica marcado) e conteúdo; no celular a lateral recolhe atrás do botão', async () => {
    const { ctx, p } = await entra('ana'); await p.setViewportSize({ width: 1280, height: 800 });
    const box = async (sel: string) => (await p.locator(sel).first().boundingBox())!, cab = await box('[data-painel] > header'), lat = await box('[data-painel] > aside'), prin = await box('[data-painel] > main')
    expect(lat.x).toBeLessThan(prin.x); expect(lat.y).toBeGreaterThanOrEqual(cab.y + cab.height - 1); expect(prin.y).toBeGreaterThanOrEqual(cab.y + cab.height - 1); expect(cab.width).toBeGreaterThan(1200) // cabeçalho no topo, lateral à esquerda, conteúdo à direita
    expect(await p.getByRole('complementary', { name: 'Navegação do Studio' }).count()).toBe(1); expect(await p.getByRole('main').count()).toBe(1); expect(await p.getByRole('banner').count()).toBe(1)
    expect(await p.locator('[data-painel] > aside button[aria-current]').count()).toBe(0); await p.getByRole('button', { name: 'home (personalizado)' }).click(); await p.getByText('Página home').waitFor();
    expect(await p.locator('[data-painel] > aside button[aria-current]').allInnerTexts()).toEqual(['home (personalizado)']) // o nó aberto fica marcado
    await p.getByRole('button', { name: 'Diagramas' }).click(); expect(await p.locator('[data-painel] > aside button[aria-current]').allInnerTexts()).toEqual(['Diagramas', 'home (personalizado)']) // ferramenta aberta também (as ferramentas ficam no topo do menu)
    expect(await p.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
    await p.setViewportSize({ width: 390, height: 800 }); const sw = p.getByRole('switch', { name: 'Abrir os nós e as ferramentas' })
    expect(await p.locator('[data-painel] > aside nav').isVisible()).toBe(false); expect(await p.locator('[data-painel] > aside > label').isVisible()).toBe(true) // celular: só o botão
    await p.locator('[data-painel] > aside > label').click(); expect(await sw.isChecked()).toBe(true); expect(await p.locator('[data-painel] > aside nav').isVisible()).toBe(true)
    await p.getByRole('button', { name: 'Diagramas' }).click(); expect(await sw.isChecked()).toBe(false) // escolher um item recolhe a lateral
    await ctx.close()
  })
  it('isolamento: o tenant B não vê o tema do A', async () => {
    const { ctx, p } = await entra('bia', 'b'); await expect(p.getByRole('button', { name: 'padrao (padrão)' })).toBeVisible(); await expect(p.getByRole('button', { name: 'marca (personalizado)' })).toHaveCount(0); await ctx.close()
  })
  it('segurança: CSP sem unsafe-eval, sem violações no console e sem erros de página', async () => {
    const r = await (await entra('ana')).p.request.get(`${url}/studio`); const csp = r.headers()['content-security-policy']!
    expect(csp).toContain("script-src 'self'"); expect(csp).not.toContain('unsafe-eval'); expect(csp).toContain("frame-ancestors 'none'"); expect(erros.join('\n')).toBe('')
  })
  it('alterações não salvas: abrir outro nó pede confirmação; "Continuar editando" mantém, "Descartar e abrir" troca; sem alterações abre direto', async () => {
    const { ctx, p } = await entra('ana'); await p.getByRole('button', { name: 'home (personalizado)' }).click(); await expect(p.getByText('Página home')).toBeVisible()
    await p.getByRole('button', { name: 'edita (personalizado)' }).click(); await expect(p.getByText('Página edita')).toBeVisible() // sem alterações: abre direto, sem pergunta
    await expect(p.getByText(/Descartar e abrir/)).toHaveCount(0)
    await linhaDe(p, 'titulo').click(); await p.getByRole('textbox', { name: 'Texto' }).fill('mudei sem salvar'); await expect(p.getByText('alterações não salvas')).toBeVisible()
    await p.getByRole('button', { name: 'home (personalizado)' }).click()
    await expect(p.getByText('Há alterações não salvas em edita. Descartar e abrir home?')).toBeVisible(); await expect(p.getByText('Página edita')).toBeVisible() // nada mudou ainda
    await p.getByRole('button', { name: 'Continuar editando' }).click(); await expect(p.getByText(/Descartar e abrir/)).toHaveCount(0); await expect(p.getByText('alterações não salvas')).toBeVisible()
    await p.getByRole('button', { name: /^padrao \(/ }).click(); await p.getByRole('button', { name: 'Descartar e abrir' }).click(); await expect(p.getByText('Tokens do tema padrao')).toBeVisible()
    await expect(p.getByText(/Descartar e abrir/)).toHaveCount(0); await ctx.close()
  })
  it('restaurar o padrão: pede confirmação, grava a lápide e fecha o editor; o histórico continua', async () => {
    const { ctx, p } = await entra('ana'); await p.getByRole('button', { name: 'xss (personalizado)' }).click(); await expect(p.getByText('Página xss')).toBeVisible()
    await p.getByRole('button', { name: 'Restaurar o padrão' }).click(); await expect(p.getByText(/Voltar xss ao padrão da plataforma/)).toBeVisible()
    await p.getByRole('button', { name: 'Cancelar' }).click(); await expect(p.getByText(/Voltar xss ao padrão/)).toHaveCount(0); expect((await app.inject({ url: '/studio/nos/pagina/xss', headers: { cookie: 'u=ana|a' } })).json()).toMatchObject({ origem: 'tenant' })
    await p.getByRole('button', { name: 'Restaurar o padrão' }).click(); await p.getByRole('button', { name: 'Sim, restaurar' }).click(); await expect(p.getByText(/Restaurado o padrão de xss/)).toBeVisible()
    expect((await app.inject({ url: '/studio/nos/pagina/xss', headers: { cookie: 'u=ana|a' } })).statusCode).toBe(404) // (xss só existia no tenant: sem padrão, o histórico guarda a lápide)
    await expect(p.getByText('Página xss')).toHaveCount(0) // o editor fecha
    const hist = (await app.inject({ url: '/studio/historico/pagina/xss', headers: { cookie: 'u=ana|a' } })).json().versoes; expect(hist[0].removido).toBe(true) // o histórico continua, com a lápide no topo
    await ctx.close()
  })
  it('prévia: alternar claro/escuro muda o modo do documento da prévia', async () => {
    const { ctx, p } = await entra('ana'); await p.getByRole('button', { name: 'home (personalizado)' }).click(); await expect(p.getByText('Página home')).toBeVisible()
    const modo = async () => (await p.locator('iframe[title="Pré-visualização da página"]').getAttribute('srcdoc')) ?? ''
    await expect.poll(modo).toContain('data-modo="claro"'); await p.getByRole('button', { name: 'escuro', exact: true }).click(); await expect.poll(modo).toContain('data-modo="escuro"')
    await p.getByRole('button', { name: 'claro', exact: true }).click(); await expect.poll(modo).toContain('data-modo="claro"'); await ctx.close()
  })
  it('criar nó com alterações não salvas pede confirmação; sem alterações cria direto', async () => {
    const { ctx, p } = await entra('ana')
    await p.getByRole('button', { name: 'Nova página' }).click(); await p.getByRole('textbox', { name: 'Identificador do novo nó' }).fill('criada-direto'); await p.getByRole('button', { name: 'Criar', exact: true }).click()
    await expect(p.getByText('Página criada-direto')).toBeVisible(); await expect(p.getByText(/criar um novo nó as descarta/)).toHaveCount(0) // nada aberto antes: direto
    await p.getByRole('button', { name: 'Cancelar' }).count() // (o formulário fecha ao criar)
    // agora há um nó novo, não salvo: criar outro descartaria o primeiro
    await p.getByRole('button', { name: 'Nova página' }).click(); await p.getByRole('textbox', { name: 'Identificador do novo nó' }).fill('segunda'); await p.getByRole('button', { name: 'Criar', exact: true }).click()
    await expect(p.getByText('Há alterações não salvas em criada-direto; criar um novo nó as descarta.')).toBeVisible(); await expect(p.getByText('Página criada-direto')).toBeVisible() // ainda no primeiro
    await p.getByRole('button', { name: 'Cancelar' }).click(); await expect(p.getByText(/criar um novo nó as descarta/)).toHaveCount(0); await expect(p.getByText('Página criada-direto')).toBeVisible()
    await p.getByRole('button', { name: 'Nova página' }).click(); await p.getByRole('textbox', { name: 'Identificador do novo nó' }).fill('terceira'); await p.getByRole('button', { name: 'Criar', exact: true }).click()
    await p.getByRole('button', { name: 'Descartar e criar' }).click(); await expect(p.getByText('Página terceira')).toBeVisible(); await expect(p.getByText(/criar um novo nó as descarta/)).toHaveCount(0)
    await ctx.close()
  })
  it('editor de formulários: criar, adicionar e editar campos, prévia, problemas, teste com valores, JSON e salvar', async () => {
    const { ctx, p } = await entra('ana'); const prev = () => p.frameLocator('iframe[title="Pré-visualização do formulário"]')
    await p.getByRole('button', { name: 'Novo formulário' }).click(); await p.getByRole('textbox', { name: 'Identificador do novo nó' }).fill('contato2'); await p.getByRole('button', { name: 'Criar', exact: true }).click()
    await expect(p.getByText('Formulário contato2')).toBeVisible(); await expect(p.getByRole('button', { name: /nome \(texto\) \*/ })).toBeVisible(); await expect(prev().getByText('Nome')).toBeVisible()
    await expect(p.getByText('Definição coerente: sem problemas.')).toBeVisible()
    // adiciona um e-mail, seleciona, edita o rótulo e marca como obrigatório: lista e prévia seguem
    await p.getByRole('button', { name: '+ email', exact: true }).click(); await p.getByRole('button', { name: /campo1 \(email\)/ }).click(); await expect(p.getByText('Campo campo1')).toBeVisible()
    await p.getByRole('textbox', { name: 'Rótulo', exact: true }).fill('E-mail de contato'); await expect(prev().getByText('E-mail de contato')).toBeVisible()
    await p.getByRole('checkbox', { name: 'Obrigatório', exact: true }).check(); await expect(p.getByRole('button', { name: /campo1 \(email\) \*/ })).toBeVisible()
    // CPF: a prévia mostra a dica da máscara padrão do tipo; máscara própria no campo de texto
    await p.getByRole('button', { name: '+ cpf', exact: true }).click(); await expect(prev().locator('input[placeholder="000.000.000-00"]')).toBeVisible()
    // problema: nome repetido aparece na lista e some ao corrigir
    await p.getByRole('textbox', { name: 'Nome (chave do valor)', exact: true }).fill('nome'); await expect(p.getByText(/já existe um campo 'nome'/)).toBeVisible()
    await p.getByRole('textbox', { name: 'Nome (chave do valor)', exact: true }).fill('email'); await expect(p.getByText('Definição coerente: sem problemas.')).toBeVisible()
    // escolha: opções por linha (valor | rótulo) aparecem na prévia
    await p.getByRole('button', { name: '+ escolha', exact: true }).click(); await p.getByRole('button', { name: /campo3 \(escolha\)/ }).click()
    await p.getByRole('textbox', { name: 'Opções', exact: true }).fill('x | Ex\ny | Ypsilon\nz'); await expect(prev().locator('option', { hasText: 'Ypsilon' })).toHaveCount(1); await expect(prev().locator('option', { hasText: 'z' })).toHaveCount(1)
    // máscara do campo de texto: padrão vira {mascara:{padrao}} no JSON
    await p.getByRole('button', { name: /nome \(texto\)/ }).click(); await p.getByRole('textbox', { name: /^Padrão \(0 dígito/ }).fill('AAA-0000'); await expect(prev().locator('input[placeholder="xxx-0000"]')).toBeVisible()
    // teste com valores de exemplo: o validador real
    await p.getByRole('button', { name: 'Testar', exact: true }).click(); await p.getByRole('textbox', { name: 'Valores de exemplo (JSON)' }).fill('{"nome": "ab1", "email": "ruim", "campo2": "111.111.111-11"}')
    await expect(p.getByText('Com erros')).toBeVisible(); await expect(p.getByText(/email: E-mail de contato está em um formato inválido\./)).toBeVisible(); await expect(p.getByText(/campo2: Campo 2 está em um formato inválido\./)).toBeVisible()
    await p.getByRole('textbox', { name: 'Valores de exemplo (JSON)' }).fill('{"nome": "abc1234", "email": " ANA@Exemplo.com ", "campo2": "529.982.247-25"}'); await expect(p.getByText('Válido', { exact: true })).toBeVisible()
    const norm = p.getByRole('textbox', { name: 'Valores normalizados' }); await expect.poll(() => norm.inputValue()).toMatch(/"campo2": "52998224725"/); await expect.poll(() => norm.inputValue()).toMatch(/"email": "ana@exemplo.com"/)
    await p.getByRole('textbox', { name: 'Valores de exemplo (JSON)' }).fill('{ruim'); await expect(p.getByText(/JSON inválido: use um objeto/)).toBeVisible()
    // JSON do nó: mostra a definição, recusa JSON ruim e aplica mudanças válidas
    await p.getByRole('button', { name: 'JSON', exact: true }).click(); const area = p.getByRole('textbox', { name: 'spec do formulário' }); await expect.poll(() => area.inputValue()).toMatch(/"mascara": \{\s*"padrao": "AAA-0000"/)
    await area.fill('{ruim'); await p.getByRole('button', { name: 'Aplicar' }).click(); await expect(p.getByText('JSON inválido (use um objeto).')).toBeVisible()
    await area.fill('{"titulo": "Via JSON", "campos": [{"nome": "so", "tipo": "texto", "obrigatorio": true}], "passos": [{"id": "p1", "titulo": "Um", "campos": ["so"]}]}'); await p.getByRole('button', { name: 'Aplicar' }).click()
    await p.getByRole('button', { name: 'Campos', exact: true }).click(); await expect(p.getByRole('button', { name: /so \(texto\) \*/ })).toBeVisible(); await expect(p.getByText(/pelo menos 2/)).toBeVisible() // 1 passo só: o schema exige 2 (a prévia some, os problemas dizem por quê)
    await p.getByRole('button', { name: 'JSON', exact: true }).click(); await p.getByRole('textbox', { name: 'spec do formulário' }).fill('{"titulo": "Via JSON", "campos": [{"nome": "so", "tipo": "texto", "obrigatorio": true}, {"nome": "dois", "tipo": "texto"}], "passos": [{"id": "p1", "titulo": "Um", "campos": ["so"]}, {"id": "p2", "titulo": "Dois", "campos": ["dois"]}]}'); await p.getByRole('button', { name: 'Aplicar' }).click()
    await p.getByRole('button', { name: 'Campos', exact: true }).click(); await expect(prev().getByText('Via JSON')).toBeVisible(); await expect(prev().locator('[data-campo="so"]')).toHaveCount(1); await expect(prev().locator('[data-campo="dois"]')).toHaveCount(0)
    await p.getByRole('button', { name: /Dois/ }).click(); await expect(prev().locator('[data-campo="dois"]')).toHaveCount(1) // alterna o passo da prévia
    // desfazer: uma aplicação de JSON por vez
    await p.getByRole('button', { name: 'Desfazer' }).click(); await expect(p.getByRole('button', { name: /dois \(texto\)/ })).toHaveCount(0); await p.getByRole('button', { name: 'Desfazer' }).click(); await expect(p.getByRole('button', { name: /nome \(texto\)/ })).toBeVisible()
    // subir/descer/remover
    await p.getByRole('button', { name: /campo3 \(escolha\)/ }).click(); await p.getByRole('button', { name: 'Subir' }).click(); await expect(p.getByRole('button', { name: /▶ campo3 \(escolha\)/ })).toBeVisible(); await p.getByRole('button', { name: 'Remover', exact: true }).click(); await expect(p.getByRole('button', { name: /campo3/ })).toHaveCount(0)
    // salvar: o servidor valida o nó inteiro; reabrir traz o salvo
    await p.getByRole('button', { name: 'Salvar' }).click(); await expect(p.getByText('Salvo como versão 1')).toBeVisible()
    const salvo = (await app.inject({ url: '/studio/nos/formulario/contato2', headers: { cookie: 'u=ana|a' } })).json(); expect(salvo).toMatchObject({ origem: 'tenant', seq: 1 }); expect(salvo.no.spec.campos.map((c: { nome: string }) => c.nome)).toEqual(['nome', 'email', 'campo2']); expect(salvo.no.spec.campos[0].mascara).toEqual({ padrao: 'AAA-0000' })
    await ctx.close()
  })
})
