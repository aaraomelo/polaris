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

// E2E do Studio: servidor real (Fastify + PGlite) e Chrome real. Cada teste é um fluxo de uso; a sessão é um cookie `u=<usuario>` (só neste teste: em produção é o JWT do gateway).
const CHROME = process.env.CHROME ?? ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find(existsSync)
const A = '11111111-1111-1111-1111-111111111111', B = '22222222-2222-2222-2222-222222222222'
let pg: PGlite, app: FastifyInstance, url = '', nav: Browser
const q = async (s: string, p: unknown[] = []) => { const r = await pg.query(s, p); return { rows: r.rows as Array<Record<string, unknown>>, rowCount: r.affectedRows ?? r.rows.length } }
const pagina = (id: string, filhos: any[]) => ({ kind: 'pagina', id, versao: '1.0.0', estatuto: 'publicado', spec: { rota: `/${id}`, titulo: id, raiz: { bloco: 'layout/pilha', id: 'raiz', slots: { filhos } } } })
const par = (id: string, texto: string) => ({ bloco: 'texto/paragrafo', id, props: { texto } })
const erros: string[] = []

beforeAll(async () => {
  if (!CHROME) return
  pg = new PGlite(); await pg.exec(DDL_DIRETORIO)
  for (const [id, alias] of [[A, 'loja-a'], [B, 'loja-b']] as const) await diretorioSql(q).cria({ tenantId: id, alias, nome: alias, segmento: 'varejo', packs: ['varejo'], donoEmail: `${alias}@x.com`, chave: `chave-e2e-studio-${alias}-xxxx` })
  const base = registroDaPlataforma(); registraBase(base); registraTemas(base)
  const armazem = criaArmazemDeNos({ q, base })
  await armazem.salva(A, 'seed', pagina('home', [{ bloco: 'texto/titulo', id: 'titulo', props: { texto: 'Bem-vindo', nivel: 1 } }, par('p1', 'Primeiro'), par('p2', 'Segundo')]), 'seed')
  for (const id of ['salva', 'conflito', 'quebrada', 'hist', 'comenta']) await armazem.salva(A, 'seed', pagina(id, [{ bloco: 'texto/titulo', id: 'titulo', props: { texto: 'Bem-vindo', nivel: 1 } }, par('p1', 'Primeiro'), par('p2', 'Segundo')]), 'seed')
  await armazem.salva(B, 'seed', pagina('segredo-b', [par('x', 'só da loja B')]))
  const autentica = async (req: { headers: Record<string, unknown> }): Promise<Sessao | null> => { const m = /(?:^|;\s*)u=([a-z0-9-]+)\|([a-z]+)/.exec(String(req.headers.cookie ?? '')); if (!m) return null; return { tenantId: m[2] === 'b' ? B : A, usuario: m[1]!, pode: () => true } }
  app = criaServidorStudio({ armazem, baseDe: async () => base, q, autentica: autentica as never }); await app.listen({ port: 0, host: '127.0.0.1' })
  url = `http://127.0.0.1:${(app.server.address() as { port: number }).port}`
  nav = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] })
})
afterAll(async () => { await nav?.close(); await app?.close(); await pg?.close() })

async function entra(usuario: string, tenant: 'a' | 'b' = 'a'): Promise<{ ctx: BrowserContext; p: Page }> {
  const ctx = await nav.newContext({ viewport: { width: 1400, height: 900 } }); await ctx.addCookies([{ name: 'u', value: `${usuario}|${tenant}`, url }])
  const p = await ctx.newPage(); p.on('console', (m) => { if (m.type() === 'error' && !/status of 409/.test(m.text())) erros.push(`${usuario}: ${m.text()}`) }); p.on('pageerror', (e) => erros.push(`${usuario}: ${e.message}`))
  p.on('dialog', (d) => { void d.accept() }); await p.goto(`${url}/studio`); await p.getByTestId('abrir').waitFor(); return { ctx, p }
}
const abre = async (p: Page, v: string) => { await p.getByTestId('abrir').selectOption(v); await p.getByRole('tree').waitFor() }
const abre0 = async (p: Page, v: string) => { await p.getByTestId('abrir').selectOption(v); await expect(p.getByTestId('estado-salvo')).toContainText(/padrão|salvo/) }
const quadro = (p: Page) => p.frameLocator('[data-testid=preview]')
const no = (p: Page, id: string) => p.getByTestId(`no-${id}`)
const campo = (p: Page, rotulo: string | RegExp) => p.getByLabel(rotulo, { exact: typeof rotulo === 'string' })

describe.skipIf(!CHROME)('Studio no navegador', () => {
  it('abre uma página, mostra a árvore e o preview ao vivo; selecionar destaca e mostra o formulário gerado do schema', async () => {
    const { ctx, p } = await entra('ana'); await abre(p, 'pagina:home')
    await expect(quadro(p).locator('h1')).toHaveText('Bem-vindo'); await expect(p.getByRole('treeitem')).toHaveCount(4)
    await no(p, 'titulo').click(); await expect(no(p, 'titulo')).toHaveAttribute('aria-selected', 'true'); await expect(p.getByRole('heading', { name: /Título/ })).toBeVisible()
    await expect(campo(p, 'Texto *')).toHaveValue('Bem-vindo'); await expect(campo(p, 'Nível')).toHaveValue('1'); await expect(p.getByTestId('estado-salvo')).toHaveText('salvo (v1)')
    await ctx.close()
  })
  it('editar prop atualiza o preview na hora; valor inválido mostra o erro e NÃO muda nada; desfazer/refazer por botão e por teclado', async () => {
    const { ctx, p } = await entra('ana'); await abre(p, 'pagina:home'); await no(p, 'titulo').click()
    await campo(p, 'Texto *').fill('Olá, Studio'); await expect(quadro(p).locator('h1')).toHaveText('Olá, Studio'); await expect(p.getByTestId('estado-salvo')).toContainText('não salvas')
    await campo(p, 'Nível').fill('9'); await expect(p.getByText('o máximo é 6')).toBeVisible(); await expect(quadro(p).locator('h1')).toBeVisible()
    await campo(p, 'Nível').fill('2'); await expect(quadro(p).locator('h2')).toHaveText('Olá, Studio')
    await p.getByRole('button', { name: /^Desfazer/ }).click(); await expect(quadro(p).locator('h1')).toHaveText('Olá, Studio') // desfez só o nível
    await p.evaluate(() => (document.activeElement as HTMLElement).blur()); await p.keyboard.press('Control+Z'); await expect(quadro(p).locator('h1')).toHaveText('Bem-vindo')
    await p.getByRole('button', { name: 'Refazer' }).click(); await expect(quadro(p).locator('h1')).toHaveText('Olá, Studio'); await expect(p.getByTestId('estado-salvo')).toContainText('não salvas')
    await ctx.close()
  })
  it('digitar vários caracteres seguidos é UM passo de desfazer (agrupado)', async () => {
    const { ctx, p } = await entra('ana'); await abre(p, 'pagina:home'); await no(p, 'p1').click()
    await campo(p, 'Texto *').fill(''); await campo(p, 'Texto *').pressSequentially('rápido', { delay: 20 }); await expect(quadro(p).getByText('rápido')).toBeVisible()
    await p.getByRole('button', { name: /^Desfazer/ }).click(); await expect(quadro(p).getByText('Primeiro')).toBeVisible()
    await ctx.close()
  })
  it('estrutura: adicionar (nasce válido, com id), subir, descer, recuar, avançar, duplicar e remover', async () => {
    const { ctx, p } = await entra('ana'); await abre(p, 'pagina:home'); await no(p, 'raiz').click()
    await p.getByLabel('Bloco a adicionar').selectOption('texto/pequeno'); await p.getByRole('button', { name: 'Adicionar' }).click()
    await expect(no(p, 'pequeno-1')).toHaveAttribute('aria-selected', 'true'); await expect(quadro(p).getByText('Texto', { exact: true })).toBeVisible(); await expect(p.getByTestId('erros-props')).toHaveCount(0)
    const ordem = async () => (await p.getByRole('treeitem').locator('.no-id').allTextContents()).join(' ')
    expect(await ordem()).toBe('#raiz #titulo #p1 #p2 #pequeno-1')
    await p.getByRole('button', { name: 'Subir' }).click(); expect(await ordem()).toBe('#raiz #titulo #p1 #pequeno-1 #p2')
    await p.getByRole('button', { name: 'Descer' }).click(); expect(await ordem()).toBe('#raiz #titulo #p1 #p2 #pequeno-1')
    await no(p, 'p2').click(); await p.getByRole('button', { name: 'Duplicar' }).click(); expect(await ordem()).toBe('#raiz #titulo #p1 #p2 #p2-2 #pequeno-1')
    await p.getByRole('button', { name: 'Remover' }).click(); expect(await ordem()).toBe('#raiz #titulo #p1 #p2 #pequeno-1')
    await no(p, 'p2').click(); await p.getByRole('button', { name: 'Recuar' }).click() // p1 é texto/paragrafo: não aceita filhos
    await expect(p.getByTestId('aviso')).toContainText('não aceita filhos'); expect(await ordem()).toBe('#raiz #titulo #p1 #p2 #pequeno-1')
    await ctx.close()
  })
  it('salvar grava no servidor (v2), a recarga traz o salvo, e "sem alterações" não cria versão', async () => {
    const { ctx, p } = await entra('ana'); await abre(p, 'pagina:salva'); await no(p, 'p1').click(); await campo(p, 'Texto *').fill('Salvo pelo Studio')
    await p.keyboard.press('Control+S'); await expect(p.getByTestId('aviso')).toContainText('Salvo como versão 2'); await expect(p.getByTestId('estado-salvo')).toHaveText('salvo (v2)'); await expect(p.getByTestId('salvar')).toBeDisabled()
    await p.reload(); await abre(p, 'pagina:salva'); await expect(quadro(p).getByText('Salvo pelo Studio')).toBeVisible()
    await p.getByTestId('aba-historico').click(); await expect(p.getByTestId('versoes').locator('tbody tr')).toHaveCount(2)
    await ctx.close()
  })
  it('conflito: quem salva depois de outra pessoa é avisado, e nada é sobrescrito', async () => {
    const a = await entra('ana'), b = await entra('beto'); await abre(a.p, 'pagina:conflito'); await abre(b.p, 'pagina:conflito')
    await no(b.p, 'p2').click(); await campo(b.p, 'Texto *').fill('do Beto'); await b.p.getByTestId('salvar').click(); await expect(b.p.getByTestId('aviso')).toContainText('Salvo como versão')
    await no(a.p, 'p2').click(); await campo(a.p, 'Texto *').fill('da Ana'); await a.p.getByTestId('salvar').click()
    await expect(a.p.getByTestId('aviso')).toContainText('beto salvou a versão'); await expect(a.p.getByTestId('estado-salvo')).toContainText('não salvas')
    const atual = (await app.inject({ url: '/studio/nos/pagina/conflito', headers: { cookie: 'u=ana|a' } })).json(); expect(JSON.stringify(atual.no)).toContain('do Beto'); expect(JSON.stringify(atual.no)).not.toContain('da Ana')
    await a.ctx.close(); await b.ctx.close()
  })
  it('isolamento: o tenant B não vê as páginas do A (nem o contrário)', async () => {
    const { ctx, p } = await entra('bia', 'b'); const opcoes = await p.getByTestId('abrir').locator('option').allTextContents()
    expect(opcoes.some((o) => o.includes('segredo-b'))).toBe(true); expect(opcoes.some((o) => /home ●/.test(o))).toBe(false); await ctx.close()
  })
  it('página com erro de compilação: o preview diz quais, e salvar avisa que não deve ser publicada', async () => {
    const { ctx, p } = await entra('ana'); await abre(p, 'pagina:quebrada'); await no(p, 'raiz').click()
    await p.getByRole('textbox', { name: 'Exibir se (expressão)' }).fill('estado.que.nao.existe +'); await p.getByTestId('salvar').click()
    await expect(p.getByTestId('aviso')).toContainText('erros de compilação'); await expect(p.getByTestId('preview-erros')).toBeVisible()
    await ctx.close()
  })
  it('nova página: nasce no rascunho, preview compila, salva e aparece na lista', async () => {
    const { ctx, p } = await entra('ana'); await p.getByRole('button', { name: 'Nova página' }).click()
    await p.getByLabel('Identificador', { exact: true }).fill('Ruim!'); await expect(p.getByRole('button', { name: 'Criar' })).toBeDisabled()
    await p.getByLabel('Identificador', { exact: true }).fill('nova'); await p.getByLabel('Rota').fill('/nova'); await p.getByRole('button', { name: 'Criar' }).click()
    await no(p, 'raiz').click(); await p.getByLabel('Bloco a adicionar').selectOption('texto/titulo'); await p.getByRole('button', { name: 'Adicionar' }).click(); await expect(quadro(p).locator('h1')).toHaveText('Texto')
    await p.getByTestId('salvar').click(); await expect(p.getByTestId('aviso')).toContainText('versão 1'); expect(await p.getByTestId('abrir').locator('option').allTextContents()).toContain('Página nova ●')
    await ctx.close()
  })
  it('preview: expressão ligada a dado que não existe mostra os erros do compilador, em vez de quebrar', async () => {
    const { ctx, p } = await entra('ana'); await abre(p, 'pagina:home'); await no(p, 'p1').click(); await campo(p, 'Texto *').fill('{naoExiste.valor}')
    await expect(p.getByTestId('preview-erros')).toContainText('O preview não compila'); await campo(p, 'Texto *').fill('Volta ao normal'); await expect(quadro(p).getByText('Volta ao normal')).toBeVisible()
    await ctx.close()
  })
  it('segurança: HTML no texto vira texto no preview; o iframe é sandbox sem scripts; a CSP do Studio é a esperada', async () => {
    const { ctx, p } = await entra('ana'); await abre(p, 'pagina:home'); await no(p, 'p1').click(); await campo(p, 'Texto *').fill('<img src=x onerror="window.top.__xss=1"><script>window.top.__xss=1</script>')
    await expect(quadro(p).getByText('<img src=x')).toBeVisible(); await p.waitForTimeout(300); expect(await p.evaluate(() => (window as any).__xss)).toBeUndefined()
    expect(await p.getByTestId('preview').getAttribute('sandbox')).toBe(''); expect(await quadro(p).locator('img').count()).toBe(0)
    const r = await p.request.get(`${url}/studio`); expect(r.headers()['content-security-policy']).toContain("frame-ancestors 'none'"); expect(r.headers()['content-security-policy']).toContain("default-src 'none'")
    await ctx.close()
  })
  it('acessibilidade básica: landmarks, árvore com níveis, campos rotulados, status vivo e foco visível por teclado', async () => {
    const { ctx, p } = await entra('ana'); await abre(p, 'pagina:home'); await no(p, 'p1').click()
    await expect(p.getByRole('tree', { name: 'Blocos da página' })).toBeVisible(); await expect(p.getByRole('treeitem').first()).toHaveAttribute('aria-level', '1'); await expect(p.getByRole('toolbar')).toBeVisible()
    await expect(p.getByRole('tablist', { name: 'Seções' })).toBeVisible(); await expect(p.locator('[role=status][aria-live=polite]')).toHaveCount(1)
    for (const i of await p.locator('input[type=text], textarea, select').all()) { const id = await i.getAttribute('id'); if (id) expect(await p.locator(`label[for="${id}"]`).count(), `campo ${id} sem rótulo`).toBeGreaterThan(0) }
    await no(p, 'p1').focus(); await p.keyboard.press('Enter'); await expect(no(p, 'p1')).toHaveAttribute('aria-selected', 'true')
    await ctx.close()
  })


  it('tema: abre o padrão da plataforma, edita cores com preview na hora, recusa valor inválido, avisa contraste e salva como override do tenant', async () => {
    const { ctx, p } = await entra('ana'); await abre0(p, 'tema:padrao'); await p.getByTestId('aba-tema').click()
    const srcdoc = async () => (await p.getByTestId('preview-tema').getAttribute('srcdoc')) ?? ''
    await expect(p.getByTestId('estado-salvo')).toHaveText('padrão da plataforma'); expect(await srcdoc()).toContain('--cor-primaria: #1F4E79')
    const primaria = p.getByTestId('grupo-cor').getByLabel('primaria', { exact: true })
    await primaria.fill('#abcdef'); await expect(p.getByTestId('estado-salvo')).toContainText('não salvas'); await p.waitForTimeout(150); expect(await srcdoc()).toContain('--cor-primaria: #abcdef')
    await primaria.fill('azul'); await expect(p.getByText('cor inválida')).toBeVisible(); expect(await srcdoc()).toContain('--cor-primaria: #abcdef') // não aplicou
    await p.getByTestId('grupo-cor').getByLabel('texto', { exact: true }).fill('#dddddd'); await expect(p.getByTestId('avisos-contraste')).toContainText('texto/fundo')
    await p.getByTestId('grupo-cor').getByLabel('texto', { exact: true }).fill('#111111'); await expect(p.getByTestId('avisos-contraste')).toContainText('primaria/fundo'); expect(await p.getByTestId('avisos-contraste').textContent()).not.toContain('texto/fundo') // só sobrou o aviso da primaria clara escolhida
    await p.getByTestId('salvar').click(); await expect(p.getByTestId('aviso')).toContainText('Salvo como versão 1'); expect(await p.getByTestId('abrir').locator('option').allTextContents()).toContain('Tema padrao ●')
    await ctx.close()
  })
  it('tema: novo token (nome e valor validados), remover token, e modo escuro com herança', async () => {
    const { ctx, p } = await entra('ana'); await p.getByRole('button', { name: 'Novo tema' }).click(); await p.getByLabel('Identificador', { exact: true }).fill('marca'); await p.getByRole('button', { name: 'Criar' }).click()
    const cor = p.getByTestId('grupo-cor'), srcdoc = async () => (await p.getByTestId('preview-tema').getAttribute('srcdoc')) ?? ''
    await cor.getByLabel('Nome do novo token de cor').fill('destaque'); await cor.getByLabel('Valor do novo token de cor').fill('red'); await expect(p.getByRole('button', { name: 'Adicionar' }).first()).toBeDisabled()
    await cor.getByLabel('Valor do novo token de cor').fill('#ff8800'); await cor.getByRole('button', { name: 'Adicionar' }).click(); await expect(cor.getByLabel('destaque', { exact: true })).toHaveValue('#ff8800')
    await p.getByPlaceholder('novo modo (ex.: escuro)').fill('escuro'); await p.getByRole('button', { name: 'Criar modo' }).click(); await expect(p.getByRole('tab', { name: 'escuro' })).toHaveAttribute('aria-selected', 'true')
    await expect(cor.getByLabel('texto (herdado)')).toHaveValue('#111111'); await cor.getByLabel('fundo', { exact: true }).fill('#101010'); await p.waitForTimeout(150); expect(await srcdoc()).toContain('#101010')
    await expect(p.getByTestId('avisos-contraste')).toContainText('(escuro)') // texto #111 sobre fundo #101010
    await p.getByRole('button', { name: 'Remover modo' }).click(); await expect(p.getByRole('tab', { name: 'escuro' })).toHaveCount(0)
    await cor.getByRole('button', { name: 'Remover destaque' }).click(); await expect(cor.getByLabel('destaque', { exact: true })).toHaveCount(0)
    await ctx.close()
  })
  it('histórico: versões, diff semântico (adicionado, movido, alterado), restaurar no editor e salvar como nova versão', async () => {
    const { ctx, p } = await entra('ana'); await abre(p, 'pagina:hist')
    await no(p, 'p1').click(); await campo(p, 'Texto *').fill('Primeiro editado'); await p.getByTestId('salvar').click(); await expect(p.getByTestId('aviso')).toContainText('versão 2')
    await no(p, 'raiz').click(); await p.getByLabel('Bloco a adicionar').selectOption('feedback/selo'); await p.getByRole('button', { name: 'Adicionar' }).click()
    await no(p, 'p2').click(); await p.getByRole('button', { name: 'Subir' }).click(); await p.getByRole('button', { name: 'Subir' }).click(); await p.getByTestId('salvar').click(); await expect(p.getByTestId('aviso')).toContainText('versão 3')
    await p.getByTestId('aba-historico').click(); await expect(p.getByTestId('versoes').locator('tbody tr')).toHaveCount(3)
    await p.getByLabel('Comparar a partir da v1').check(); await p.getByLabel('Comparar até a v3').check(); await p.getByRole('button', { name: 'Comparar versões' }).click()
    const d = p.getByTestId('diff'); await expect(d).toContainText('Adicionado'); await expect(d).toContainText('selo-1'); await expect(d).toContainText('Alterado'); await expect(d).toContainText('props.texto'); await expect(d).toContainText('Primeiro editado')
    await expect(d).toContainText(/(Movido|Reordenado)/); await p.getByLabel('Comparar até a v1').check(); await p.getByRole('button', { name: 'Comparar versões' }).click(); await expect(p.getByTestId('diff-igual')).toBeVisible()
    await p.getByTestId('versoes').locator('tbody tr').nth(2).getByRole('button', { name: 'Restaurar no editor' }).click(); await expect(p.getByTestId('estado-salvo')).toContainText('não salvas')
    await p.getByTestId('aba-pagina').click(); await expect(quadro(p).getByText('Primeiro', { exact: true })).toBeVisible(); await expect(no(p, 'selo-1')).toHaveCount(0)
    await p.getByTestId('salvar').click(); await expect(p.getByTestId('aviso')).toContainText('versão 4'); await ctx.close()
  })
  it('comentários: ancorados no bloco, com selo na árvore, resposta de outra pessoa, resolver; texto é sempre texto; bloco removido deixa o fio órfão', async () => {
    const a = await entra('ana'), b = await entra('beto'); await abre(a.p, 'pagina:comenta'); await no(a.p, 'p1').click()
    await a.p.getByRole('textbox', { name: 'Comentário' }).fill('<b>trocar</b> a fonte'); await a.p.getByRole('button', { name: 'Comentar' }).click()
    await expect(a.p.getByTestId('fio')).toContainText('<b>trocar</b> a fonte'); expect(await a.p.getByTestId('fio').locator('b').count()).toBe(0); await expect(no(a.p, 'p1')).toContainText('💬 1')
    await abre(b.p, 'pagina:comenta'); await no(b.p, 'p1').click(); await expect(b.p.getByTestId('fio')).toContainText('ana'); await b.p.getByRole('button', { name: 'Responder' }).click(); await b.p.getByRole('textbox', { name: 'Comentário' }).fill('concordo'); await b.p.getByRole('button', { name: 'Comentar' }).click()
    await expect(b.p.getByTestId('fio')).toContainText('concordo'); await expect(b.p.getByTestId('fio')).toContainText('beto')
    await b.p.getByRole('button', { name: 'Resolver' }).click(); await expect(no(b.p, 'p1')).toHaveCount(1); await expect(b.p.getByTestId('fio')).toContainText('resolvido'); await expect(no(b.p, 'p1').getByLabel(/comentários em aberto/)).toHaveCount(0)
    await no(a.p, 'p1').click(); await a.p.getByRole('button', { name: 'Remover' }).click(); await a.p.getByTestId('salvar').click(); await expect(a.p.getByTestId('aviso')).toContainText('versão 2')
    await a.p.getByTestId('aba-historico').click(); await expect(a.p.getByTestId('comentarios').first()).toContainText('órfão'); await expect(a.p.getByTestId('comentarios').first()).toContainText('concordo')
    await a.ctx.close(); await b.ctx.close()
  })
  it('sem erros de console durante todos os fluxos (CSP, React, rede)', () => { expect(erros.join('\n')).toBe('') })
})
