import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Registry, emite } from '@polaris/schema'
import { afterAll, describe, expect, it } from 'vitest'
import { construirAot, type Manifesto } from '../src/aot/index'
import { registraBase } from '../src/index'
import { documentoEstatico } from '../src/estatico/index'
import { BASE_CSS, auditaTema, contraste, cssDoTema, ehEscura, PRESETS_TIFFANY, registraTemas, TEMA_PADRAO, temaDeConfig, variaveisDaBase } from '../src/tema/index'
import { compilaPrograma } from '../src/index'
import { streamVivo, textoDoStreamVivo } from '../src/vivo/stream'

const no = (kind: string, id: string, spec: object, extra: object = {}) => ({ kind, id, versao: '1.0.0', estatuto: 'publicado', spec, ...extra }) as any
const P = (b: string, extra: object = {}) => ({ bloco: b, ...extra })
const raiz = mkdtempSync(join(tmpdir(), 'polaris-tema-'))
afterAll(() => rmSync(raiz, { recursive: true, force: true }))
const declaradas = (css: string) => new Set([...css.matchAll(/(--[a-z0-9-]+):/g)].map((m) => m[1]!))

describe('contraste WCAG', () => {
  it('valores de referência', () => {
    expect(contraste('#000000', '#ffffff')).toBeCloseTo(21, 5)
    expect(contraste('#fff', '#fff')).toBeCloseTo(1, 5)
    expect(contraste('#777777', '#ffffff')).toBeCloseTo(4.48, 2) // o clássico cinza que NÃO passa AA
    expect(contraste('#767676', '#ffffff')).toBeGreaterThan(4.5)
    expect(contraste('#123', '#ffffff')).toBe(contraste('#112233', '#ffffff')) // forma curta
  })
  it('cor inválida é recusada (nunca vira NaN silencioso)', () => {
    for (const c of ['red', '#12', '#12345g', 'rgb(0,0,0)', '']) expect(() => contraste(c, '#fff'), c).toThrow(/inválida/)
  })
  it('ehEscura distingue fundos claros e escuros', () => { expect(ehEscura('#0c1019')).toBe(true); expect(ehEscura('#fafbfc')).toBe(false) })
})

describe('tema: do tiffany-erp para o nó `tema` do Polaris', () => {
  it('o nó é válido no Registry e emite CSS com variáveis semânticas e modo escuro', () => {
    const r = new Registry(); registraTemas(r)
    expect(r.ids('tema').sort()).toEqual(['graphite', 'nco-red', 'padrao', 'patria-blue'])
    const css = emite(TEMA_PADRAO, 'css')
    expect(css).toMatch(/--cor-primaria: #2D3A4F;/); expect(css).toMatch(/--espacamento-base: 0\.5rem;/); expect(css).toMatch(/--raio-pequeno: 6px;/); expect(css).toMatch(/--espacamento-borda: 1px;/)
    expect(css).toContain('[data-modo="escuro"]'); expect(css).toContain('@media (prefers-color-scheme: dark)')
    expect(emite(TEMA_PADRAO, 'css')).toBe(css) // determinístico
  })
  it('a geometria é limitada como no DTO do Tiffany', () => {
    const t = temaDeConfig('x', { ...PRESETS_TIFFANY['graphite']!, radius: 999, radiusLg: -5, borderWidth: 50, spacingBase: 1 })
    const css = emite(t, 'css')
    expect(css).toMatch(/--raio-pequeno: 40px/); expect(css).toMatch(/--raio-grande: 0px/); expect(css).toMatch(/--espacamento-borda: 6px/); expect(css).toMatch(/--espacamento-base: 0\.2rem/)
  })
  it('valor de cor com injeção de CSS é recusado na emissão', () => {
    const t = temaDeConfig('x', { ...PRESETS_TIFFANY['graphite']!, primary: 'red; } body { display:none' })
    expect(() => emite(t, 'css')).toThrow(/valor de token inválido/)
  })
})

describe('folha base dos blocos', () => {
  it('gaveta e modal: uma só transição para abrir, fechar e aparecer já aberto (@starting-style), em toda abertura', () => {
    expect(BASE_CSS).toContain('#polaris :is(aside[data-gaveta],div[data-modal]){transition:transform var(--movimento-painel,0s)')
    expect(BASE_CSS).toMatch(/@starting-style\{#polaris aside\[data-gaveta=direita\]\{transform:translateX\(100%\)/); expect(BASE_CSS).toContain('[data-estado=fechada]{visibility:hidden'); expect(BASE_CSS).not.toContain('polaris-gaveta-direita')
  })
  it('só usa variáveis do tema: nenhuma cor literal; e o tema declara TODAS as variáveis que ela lê (em todos os presets)', () => {
    expect(BASE_CSS).not.toMatch(/#[0-9a-fA-F]{3,8}\b|rgba?\(|hsla?\(/)
    const usadas = variaveisDaBase()
    expect(usadas.length).toBeGreaterThan(15)
    for (const t of [TEMA_PADRAO, ...Object.entries(PRESETS_TIFFANY).map(([k, v]) => temaDeConfig(k, v))]) {
      const d = declaradas(emite(t, 'css'))
      expect(usadas.filter((v) => !d.has(v)), t.id).toEqual([])
    }
  })
  it('todo valor de `data-tom` e todo bloco com tom tem regra', () => {
    for (const tom of ['neutro', 'sucesso', 'alerta', 'erro']) expect(BASE_CSS).toContain(`[data-tom=${tom}]`)
    for (const sel of ['button', 'input[type=text]', 'input[type=number]', 'input[type=checkbox]', 'table', 'th', 'hr', 'code', 'small', 'label', 'div[role=alert]']) expect(BASE_CSS, sel).toContain(sel)
  })
})

describe('acessibilidade: auditoria de contraste do tema', () => {
  it('o tema padrão passa AA nos modos claro e escuro', () => { expect(auditaTema(TEMA_PADRAO)).toEqual([]) })
  it('presets do Tiffany: só o achado conhecido (nco-red: link primário sobre a superfície escura, 3,06 < 4,5)', () => {
    const achados = Object.fromEntries(Object.entries(PRESETS_TIFFANY).map(([k, v]) => [k, auditaTema(temaDeConfig(k, v)).map((a) => a.par)]))
    expect(achados).toEqual({ 'patria-blue': [], 'nco-red': ['link (primária)/superfície'], graphite: [] })
  })
  it('a auditoria enxerga o modo escuro (cor ruim só no escuro é pega) e token ausente', () => {
    const ruim = temaDeConfig('r', PRESETS_TIFFANY['patria-blue']!, { escuro: { ...PRESETS_TIFFANY['patria-blue']!, text: '#222233', bg: '#0f1720', surface: '#17212b', surfaceAlt: '#1f2b37' } })
    const a = auditaTema(ruim)
    expect(a.some((x) => x.modo === 'escuro' && x.par.startsWith('texto/'))).toBe(true)
    expect(auditaTema(no('tema', 'v', { tokens: { cor: { texto: '#000' } } })).some((x) => x.par.includes('token ausente'))).toBe(true)
  })
})

describe('integração: o CSS do tema chega à página', () => {
  const NOS = [
    no('pagina', 'inicio', { rota: '/', titulo: 'Início', raiz: P('texto/paragrafo', { props: { texto: 'oi' } }) }),
    no('pagina', 'contador', { rota: '/c', estado: { n: { tipo: 'inteiro', inicial: 0 } }, raiz: P('layout/pilha', { slots: { filhos: [P('texto/paragrafo', { props: { texto: 'n={estado.n}' } }), P('nav/botao', { props: { texto: '+' }, eventos: { aoClicar: [{ acao: 'definir', estado: 'n', valor: 'estado.n + 1' }] } })] } }) }),
  ]
  const registro = () => { const r = new Registry(); registraBase(r); registraTemas(r); for (const n of NOS) r.registra(structuredClone(n)); return r }

  it('AOT: um arquivo de CSS por tema (hash), ligado nas páginas estática e viva, listado no manifesto', async () => {
    const dir = join(raiz, 'a1')
    const [res] = await construirAot(registro(), { destino: dir })
    expect(res!.ok).toBe(true)
    const m = JSON.parse(readFileSync(join(dir, 'core', 'manifesto.json'), 'utf8')) as Manifesto
    const ini = m.paginas.inicio!, cont = m.paginas.contador!
    expect(ini.arquivos.tema!.nome).toMatch(/^tema\.[0-9a-f]{12}\.css$/)
    expect(cont.arquivos.tema!.nome).toBe(ini.arquivos.tema!.nome) // mesmo tema → mesmo arquivo
    expect(readFileSync(join(dir, 'core', ini.arquivos.tema!.nome), 'utf8')).toBe(cssDoTema(TEMA_PADRAO))
    for (const e of [ini, cont]) expect(readFileSync(join(dir, 'core', e.arquivos.html!.nome), 'utf8')).toContain(`<link rel="stylesheet" href="${ini.arquivos.tema!.nome}">`)
  })
  it('o tenant escolhe o tema pelo próprio nó (`tenant.spec.tema`)', async () => {
    const r = registro()
    r.registra(no('tenant', 'acme', { alias: 'acme', segmento: 'varejo', nome: 'Acme', tema: 'nco-red' }))
    const dir = join(raiz, 'a0')
    await construirAot(r, { destino: dir, contextos: [{ tenantId: 'acme' }] })
    const m = JSON.parse(readFileSync(join(dir, 't-acme', 'manifesto.json'), 'utf8')) as Manifesto
    expect(readFileSync(join(dir, 't-acme', m.paginas.inicio!.arquivos.tema!.nome), 'utf8')).toContain('--cor-primaria: #cc1144')
  })
  it('override por tenant: o tema do tenant troca o CSS só para ele', async () => {
    const r = registro()
    r.registra(no('tema', 'padrao', { tokens: { cor: { primaria: '#00AA00' } } }, { tenantId: 'acme' }))
    const dir = join(raiz, 'a2')
    await construirAot(r, { destino: dir, contextos: [{}, { tenantId: 'acme' }] })
    const css = (ctx: string) => { const m = JSON.parse(readFileSync(join(dir, ctx, 'manifesto.json'), 'utf8')) as Manifesto; return readFileSync(join(dir, ctx, m.paginas.inicio!.arquivos.tema!.nome), 'utf8') }
    expect(css('core')).toContain('#2D3A4F'); expect(css('t-acme')).toContain('--cor-primaria: #00AA00'); expect(css('t-acme')).not.toContain('#2D3A4F')
  })
  it('reconstruir sem mudar o tema não reescreve o arquivo (build incremental e determinístico)', async () => {
    const dir = join(raiz, 'a3')
    await construirAot(registro(), { destino: dir })
    const [r2] = await construirAot(registro(), { destino: dir })
    expect(r2!.escritos).toEqual([])
  })
  it('sem tema no registry (ou `semTema`) a página sai como antes, sem <link>', async () => {
    const r = new Registry(); registraBase(r); r.registra(structuredClone(NOS[0]))
    const dir = join(raiz, 'a4')
    await construirAot(r, { destino: dir })
    const m = JSON.parse(readFileSync(join(dir, 'core', 'manifesto.json'), 'utf8')) as Manifesto
    expect(m.paginas.inicio!.arquivos.tema).toBeUndefined()
    expect(readFileSync(join(dir, 'core', m.paginas.inicio!.arquivos.html!.nome), 'utf8')).not.toContain('stylesheet')
  })
  it('streaming e documento estático aceitam estilos e modo; o link vem no <head>, antes do corpo', async () => {
    const r = registro(); const c = compilaPrograma(r, r.resolve('pagina', 'inicio', {})!.no)
    if (!c.ok) throw new Error('x')
    const doc = await textoDoStreamVivo(streamVivo(c.programa, { provedores: { servico: async () => null }, clienteSrc: '/c.js', estilos: ['/t.css?a=1&b="2"'], modo: 'escuro' }))
    expect(doc).toContain('<html lang="pt-BR" data-modo="escuro">')
    expect(doc.indexOf('<link rel="stylesheet"')).toBeGreaterThan(0); expect(doc.indexOf('<link rel="stylesheet"')).toBeLessThan(doc.indexOf('<body>'))
    expect(doc).toContain('href="/t.css?a=1&amp;b=&quot;2&quot;"') // escapado
    expect(documentoEstatico({ corpo: 'x', titulo: 't', estilos: ['/a.css'], modo: 'claro' })).toMatch(/data-modo="claro".*<link rel="stylesheet" href="\/a\.css">/)
  })
})
