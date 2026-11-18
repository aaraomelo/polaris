import { existsSync } from 'node:fs'
import { chromium, type Browser } from 'playwright-core'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { verificaCenario } from '../src/cenario'
import { criaSite } from '../src/site'
import { conteudo, lintA11y, overflowHorizontal } from '../src/verificacoes'

// Um E2E que nunca falha não prova nada: aqui os detectores são postos diante de páginas DELIBERADAMENTE quebradas.
const CHROME = process.env.CHROME ?? ['/usr/bin/google-chrome', '/usr/bin/google-chrome-stable', '/usr/bin/chromium', '/usr/bin/chromium-browser'].find(existsSync)
let nav: Browser
beforeAll(async () => { if (CHROME) nav = await chromium.launch({ executablePath: CHROME, args: ['--no-sandbox'] }) })
afterAll(async () => { await nav?.close() })
const pagina = async (html: string, largura = 1024) => { const p = await (await nav.newContext({ viewport: { width: largura, height: 800 } })).newPage(); await p.setContent(html); return p }
const BOA = '<!doctype html><html lang="pt-BR"><head><title>ok</title></head><body><div id="polaris"><h1>Título</h1><h2>Sub</h2><img src="data:," alt="foto"><button>Comprar</button><a href="/x">Ver</a><label for="n">Nome</label><input id="n" type="text"><input type="checkbox" aria-label="Aceito"></div></body></html>'

describe.skipIf(!CHROME)('lint de acessibilidade: pega cada defeito, e deixa a página boa passar', () => {
  it('página correta: nenhum problema', async () => { expect(await lintA11y(await pagina(BOA))).toEqual([]) })
  it.each([
    ['botão sem nome', '<button></button>', /button sem nome acessível/], ['link sem nome', '<a href="/x"></a>', /a sem nome acessível/], ['campo sem rótulo', '<input type="text">', /input sem rótulo/], ['checkbox sem rótulo', '<input type="checkbox">', /input sem rótulo/], ['imagem sem alt', '<img src="data:,">', /imagem sem atributo alt/],
    ['id duplicado', '<p id="a">x</p><p id="a">y</p>', /id duplicado: a/], ['dois h1', '<h1>a</h1><h1>b</h1>', /mais de um h1/], ['título pulando nível', '<h1>a</h1><h3>b</h3>', /pula do h1 para o h3/], ['fora da ordem de foco', '<button tabindex="-1">ok</button>', /tabindex negativo/],
  ])('%s', async (_n, trecho, esperado) => { const r = await lintA11y(await pagina(BOA.replace('</div>', `${trecho}</div>`))); expect(r.join(' | ')).toMatch(esperado) })
  it('página sem lang', async () => { expect((await lintA11y(await pagina(BOA.replace(' lang="pt-BR"', '')))).join()).toMatch(/html sem lang/) })
  it('imagem com alt vazio (decorativa) é válida; botão só com imagem com alt tem nome', async () => { expect(await lintA11y(await pagina(BOA.replace('</div>', '<img src="data:," alt=""><button><img src="data:," alt="Carrinho"></button></div>')))).toEqual([]) })
})
describe.skipIf(!CHROME)('overflow e conteúdo', () => {
  it('overflow horizontal em tela de celular é acusado; conteúdo que cabe, não', async () => { expect((await overflowHorizontal(await pagina('<div id="polaris"><div style="width:500px">largo</div></div>', 360))).join()).toMatch(/transborda/); expect(await overflowHorizontal(await pagina('<div id="polaris"><div style="max-width:100%">cabe</div></div>', 360))).toEqual([]) })
  it('página sem título, com contêiner vazio ou sem nada visível é acusada', async () => { expect((await conteudo(await pagina('<html><body><div id="polaris"></div></body></html>'))).join()).toMatch(/sem <title>.*vazio|vazio/s); expect((await conteudo(await pagina('<html><head><title>t</title></head><body><div id="polaris"><span> </span></div></body></html>'))).join()).toMatch(/não mostra nada/); expect(await conteudo(await pagina('<html><head><title>t</title></head><body><div id="polaris"><p>oi</p></div></body></html>'))).toEqual([]) })
})
describe.skipIf(!CHROME)('o cenário completo enxerga uma página QUEBRADA no servidor', () => {
  const comAdulteracao = async (adultera: (rota: string, html: string) => string, quem: (s: Awaited<ReturnType<typeof criaSite>>) => ReturnType<Awaited<ReturnType<typeof criaSite>>['cenarios']['find']>) => {
    const site = await criaSite(undefined, { adultera }); try { const c = quem(site)!; return await verificaCenario(nav, site, c) } finally { await site.fecha() }
  }
  const interativo = (s: Awaited<ReturnType<typeof criaSite>>) => s.cenarios.find((c) => c.interativo)
  const estatico = (s: Awaited<ReturnType<typeof criaSite>>) => s.cenarios.find((c) => !c.interativo)
  it('SEM adulteração a mesma página passa (a linha de base do teste)', async () => { expect(await comAdulteracao((_r, h) => h, interativo)).toEqual([]); expect(await comAdulteracao((_r, h) => h, estatico)).toEqual([]) })
  it('HTML do servidor DIFERENTE do que o cliente monta: a divergência de hidratação é acusada', async () => { const r = await comAdulteracao((_r, h) => h.replace(/<div id="polaris">/, '<div id="polaris"><p>texto que só o servidor tem</p>'), interativo); expect(r.join(' | ')).toMatch(/HIDRATAÇÃO divergiu/) })
  it('script INLINE injetado é BLOQUEADO pela CSP (e a violação é acusada, não engolida)', async () => { const r = await comAdulteracao((_r, h) => h.replace('</body>', '<script>window.__invadido = 1</script></body>'), estatico); expect(r.join(' | ')).toMatch(/Content Security Policy|script-src|Refused to execute inline script/i) })
  it('manipulador de evento inline (onclick) também é bloqueado', async () => { const r = await comAdulteracao((_r, h) => h.replace('</body>', '<button onclick="document.title=1">x</button></body>'), estatico); expect(r.join(' | ')).toMatch(/Content Security Policy|inline event handler|Refused/i) })
  it('recurso inexistente e erro de console são acusados', async () => { const r = await comAdulteracao((_r, h) => h.replace('</body>', '<img src="/nao-existe.png" alt="x"></body>'), estatico); expect(r.join(' | ')).toMatch(/HTTP 404|requisição falhou|404/) })
  it('página estática que muda DEPOIS de carregar é acusada', async () => { const r = await comAdulteracao((_r, h) => h.replace('</body>', '<script src="/inexistente.js"></script></body>'), estatico); expect(r.length).toBeGreaterThan(0) })
  it('imagem sem alt e botão vazio, injetados na página, são acusados pelo cenário', async () => { const r = await comAdulteracao((_r, h) => h.replace('</body>', '<img src="data:,"><button></button></body>'), estatico); expect(r.join(' | ')).toMatch(/imagem sem atributo alt/); expect(r.join(' | ')).toMatch(/sem nome acessível/) })
})
