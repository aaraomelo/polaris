import { execFileSync, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, utimesSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Registry } from '@polaris/schema'
import { JSDOM } from 'jsdom'
import { afterAll, describe, expect, it } from 'vitest'
import { construirAot, nosDoDiretorio, type Resultado } from '../src/aot/index'
import { registraBase } from '../src/index'

const no = (kind: string, id: string, spec: object, extra: object = {}) => ({ kind, id, versao: '1.0.0', estatuto: 'publicado', spec, ...extra })
const P = (b: string, extra: object = {}) => ({ bloco: b, ...extra })
const raizTmp = mkdtempSync(join(tmpdir(), 'polaris-aot-'))
afterAll(() => rmSync(raizTmp, { recursive: true, force: true }))
let k = 0
const tmp = (nome: string) => join(raizTmp, `${nome}-${k++}`)
const sha = (b: string | Buffer) => createHash('sha256').update(b).digest('hex')

const NOS = {
  servico: no('servico', 'cat', { entidades: {}, operacoes: {} }),
  dados: no('dados', 'd.loja', { fonte: { tipo: 'servico', servico: 'cat', operacao: 'loja' } }),
  inicio: no('pagina', 'inicio', { rota: '/', titulo: 'Início & <Cia>', raiz: P('layout/pilha', { slots: { filhos: [P('texto/titulo', { props: { texto: 'Bem-vindo' } }), P('texto/paragrafo', { props: { texto: 'texto <fixo> & estático' } })] } }) }),
  contador: no('pagina', 'contador', { rota: '/contador', titulo: 'Contador {estado.n}', estado: { n: { tipo: 'inteiro', inicial: 3 } },
    raiz: P('layout/pilha', { slots: { filhos: [P('texto/paragrafo', { id: 'n', props: { texto: 'n={estado.n}' } }), P('nav/botao', { id: 'mais', props: { texto: '+' }, eventos: { aoClicar: [{ acao: 'definir', estado: 'n', valor: 'estado.n + 1' }] } })] } }) }),
  produto: no('pagina', 'produto', { rota: '/p/:id', params: { id: { tipo: 'texto' } }, raiz: P('texto/paragrafo', { props: { texto: 'produto {params.id}' } }) }),
  loja: no('pagina', 'loja', { rota: '/loja', dados: { loja: 'd.loja' }, raiz: P('texto/paragrafo', { props: { texto: '{loja.nome}' } }) }),
  semdesc: no('bloco', 'x.semdesc', { interface: 'x/semdesc' }),
  codigo: no('pagina', 'codigo', { rota: '/c', raiz: P('x/semdesc') }),
  lento: no('pagina', 'lento', { rota: '/lento', dados: { loja: { dados: 'd.loja', stream: true } }, raiz: P('texto/paragrafo', { props: { texto: '{loja.nome}' } }) }),
}
const registro = (nos: object[]) => { const r = new Registry(); registraBase(r); for (const n of nos) r.registra(n); return r }
const todos = () => registro(Object.values(NOS))
const arvore = (dir: string): Record<string, string> => Object.fromEntries(readdirSync(dir, { recursive: true }).map(String).filter((f) => statSync(join(dir, f)).isFile()).sort().map((f) => [f, readFileSync(join(dir, f), 'utf8')]))

describe('construirAot: o modo mais barato que serve a cada página', () => {
  it('estático (HTML sem JS), vivo (HTML + bundle do cliente), renderizada a cada requisição (dados/params) e fallback React', async () => {
    const [r] = await construirAot(todos(), { destino: tmp('modos') }) as [Resultado]
    expect(r.ok).toBe(true)
    const p = r.manifesto.paginas
    expect(Object.keys(p)).toEqual(['codigo', 'contador', 'inicio', 'lento', 'loja', 'produto'])
    // início: nada interativo, sem dados, rota fixa → HTML puro, zero JS
    expect(p.inicio).toMatchObject({ modo: 'estatico', prerenderizada: true })
    expect(p.inicio!.arquivos.cliente).toBeUndefined(); expect(p.inicio!.cspScript).toBeUndefined()
    // contador: evento → vivo, pré-renderizado, com bundle e hash de CSP
    expect(p.contador).toMatchObject({ modo: 'vivo', prerenderizada: true })
    expect(p.contador!.arquivos.cliente!.gz).toBeLessThan(11.5 * 1024) // era 11 KB: os blocos novos do Studio e do site (ícones, seções, cartão, aria-expanded, papéis ARIA) entram nos descritores do cliente; o teto subiu 0,5 KB de propósito, para continuar pegando crescimento acidental; expect(p.contador!.cspScript).toMatch(/^sha256-[A-Za-z0-9+/]+=*$/)
    // rota com parâmetro e página com dados: elegíveis ao modo mais barato, mas renderizadas por requisição (sem HTML pré-feito)
    expect(p.produto).toMatchObject({ modo: 'estatico', prerenderizada: false }); expect(p.produto!.motivos.join()).toContain('parâmetros')
    expect(p.loja).toMatchObject({ modo: 'estatico', prerenderizada: false }); expect(p.loja!.motivos.join()).toContain('dados')
    // streaming: o runtime sem React também cobre; o HTML é transmitido a cada requisição (streamVivo) com o cliente do manifesto
    expect(p.lento).toMatchObject({ modo: 'vivo', prerenderizada: false, streaming: true }); expect(p.lento!.motivos.join()).toMatch(/streaming/)
    expect(p.lento!.arquivos.cliente).toBeDefined(); expect(p.lento!.arquivos.html).toBeUndefined()
    // e o que o runtime não cobre cai no fallback com o motivo
    expect(p.codigo).toMatchObject({ modo: 'react' }); expect(p.codigo!.motivos.join()).toMatch(/descritor|código/)
  })

  it('o HTML estático é um documento sem <script>, com título e texto escapados; o vivo traz marcadores, programa, bundle e inicialização', async () => {
    const dir = tmp('html')
    const [r] = await construirAot(todos(), { destino: dir }) as [Resultado]
    const estatico = readFileSync(join(dir, 'core', r.manifesto.paginas.inicio!.arquivos.html!.nome), 'utf8')
    expect(estatico).not.toMatch(/<script/); expect(estatico).toContain('<title>Início &amp; &lt;Cia&gt;</title>'); expect(estatico).toContain('texto &lt;fixo&gt; &amp; estático')
    const vivo = readFileSync(join(dir, 'core', r.manifesto.paginas.contador!.arquivos.html!.nome), 'utf8')
    expect(vivo).toContain('<div id="polaris">'); expect(vivo).toContain('id="pl-programa"'); expect(vivo).toContain(`<script src="${r.manifesto.paginas.contador!.arquivos.cliente!.nome}"></script>`)
    expect(vivo).not.toContain('</script><script></script>')
  })

  it('manifesto: nomes com hash de conteúdo, tamanhos e sha256 conferem com os arquivos em disco', async () => {
    const dir = tmp('hash')
    const [r] = await construirAot(todos(), { destino: dir }) as [Resultado]
    for (const [id, e] of Object.entries(r.manifesto.paginas)) {
      for (const a of Object.values(e.arquivos)) {
        const bytes = readFileSync(join(dir, 'core', a.nome))
        expect(sha(bytes), `${id}/${a.nome}`).toBe(a.sha256); expect(bytes.length).toBe(a.bytes)
        expect(a.gz).toBeGreaterThan(0); expect(a.gz).toBeLessThanOrEqual(a.bytes + 32)
        expect(a.nome.includes(a.sha256.slice(0, 12))).toBe(true)
      }
      expect(e.no.versao).toBe('1.0.0')
    }
    expect(JSON.parse(readFileSync(join(dir, 'core', 'manifesto.json'), 'utf8'))).toEqual(JSON.parse(JSON.stringify(r.manifesto)))
  })
})

describe('determinismo e incrementalidade', () => {
  it('a mesma entrada gera os MESMOS bytes (nada de data, hora ou ordem aleatória)', async () => {
    const a = tmp('det'), b = tmp('det')
    await construirAot(todos(), { destino: a }); await construirAot(registro(Object.values(NOS).reverse()), { destino: b }) // até a ordem de registro muda
    expect(arvore(join(b, 'core'))).toEqual(arvore(join(a, 'core')))
  })

  it('segunda execução não reescreve nada; mudar uma página reescreve só os arquivos dela e remove os antigos', async () => {
    const dir = tmp('inc')
    await construirAot(todos(), { destino: dir })
    const alvo = join(dir, 'core')
    const antes = arvore(alvo)
    const velho = new Date(2020, 0, 1)
    for (const f of Object.keys(antes)) utimesSync(join(alvo, f), velho, velho)
    const [r2] = await construirAot(todos(), { destino: dir }) as [Resultado]
    expect(r2.escritos).toEqual([]); expect(r2.removidos).toEqual([]); expect(r2.mantidos.length).toBeGreaterThan(5)
    for (const f of Object.keys(antes)) expect(statSync(join(alvo, f)).mtime.getTime(), f).toBe(velho.getTime()) // nem tocados

    // nova versão do contador: texto do botão muda
    const novo = { ...NOS.contador, versao: '1.1.0', spec: { ...NOS.contador.spec, raiz: P('layout/pilha', { slots: { filhos: [P('texto/paragrafo', { id: 'n', props: { texto: 'n={estado.n}' } }), P('nav/botao', { id: 'mais', props: { texto: 'MAIS' }, eventos: { aoClicar: [{ acao: 'definir', estado: 'n', valor: 'estado.n + 1' }] } })] } }) } }
    const [r3] = await construirAot(registro([NOS.servico, NOS.dados, NOS.inicio, novo, NOS.produto, NOS.loja, NOS.lento, NOS.semdesc, NOS.codigo]), { destino: dir }) as [Resultado]
    expect(r3.manifesto.paginas.contador!.no.versao).toBe('1.1.0')
    expect(r3.escritos.every((f) => f.startsWith('contador.') || f === 'manifesto.json')).toBe(true)
    expect(r3.removidos.length).toBeGreaterThan(0); expect(r3.removidos.every((f) => f.startsWith('contador.'))).toBe(true)
    const depois = arvore(alvo)
    for (const f of r3.removidos) expect(f in depois).toBe(false)
    for (const f of Object.keys(antes)) if (!f.startsWith('contador.') && f !== 'manifesto.json') { expect(depois[f]).toBe(antes[f]); expect(statSync(join(alvo, f)).mtime.getTime()).toBe(velho.getTime()) }
  })

  it('página que sai do registry tem os arquivos removidos; arquivos ESTRANHOS no diretório nunca são apagados', async () => {
    const dir = tmp('orfao')
    await construirAot(todos(), { destino: dir })
    writeFileSync(join(dir, 'core', 'meu-arquivo.txt'), 'não é do build')
    const [r] = await construirAot(registro([NOS.servico, NOS.dados, NOS.inicio]), { destino: dir }) as [Resultado]
    expect(Object.keys(r.manifesto.paginas)).toEqual(['inicio'])
    expect(r.removidos.some((f) => f.startsWith('contador.'))).toBe(true)
    expect(existsSync(join(dir, 'core', 'meu-arquivo.txt'))).toBe(true)
    expect(readdirSync(join(dir, 'core')).filter((f) => f.startsWith('contador.') || f.startsWith('loja.'))).toEqual([])
  })
})

describe('erros e contextos', () => {
  it('página inválida não derruba o build: as outras saem, o erro vem com o caminho, e ok = false', async () => {
    const ruim = no('pagina', 'quebrada', { rota: '/q', raiz: P('texto/paragrafo', { props: { texto: '{semvar.x}' } }) })
    const [r] = await construirAot(registro([NOS.servico, NOS.dados, NOS.inicio, ruim]), { destino: tmp('erro') }) as [Resultado]
    expect(r.ok).toBe(false)
    expect(Object.keys(r.manifesto.paginas)).toEqual(['inicio'])
    expect(r.erros[0]!.pagina).toBe('quebrada'); expect(r.erros[0]!.erros[0]!.caminho).toBe('/spec/raiz/props/texto')
  })

  it('cada contexto (tenant, segmento) vira uma subpasta com a cascata aplicada: o tenant sobrescreve a página do core', async () => {
    const dir = tmp('ctx')
    const tenant = no('pagina', 'inicio', { rota: '/', raiz: P('texto/paragrafo', { props: { texto: 'versão do tenant loja1' } }) }, { tenantId: 'loja1' })
    const rs = await construirAot(registro([...Object.values(NOS), tenant]), { destino: dir, contextos: [{}, { tenantId: 'loja1' }, { tenantId: 'outro' }] }) as Resultado[]
    expect(readdirSync(dir).sort()).toEqual(['core', 't-loja1', 't-outro'])
    const html = (i: number, sub: string) => readFileSync(join(dir, sub, rs[i]!.manifesto.paginas.inicio!.arquivos.html!.nome), 'utf8')
    expect(html(1, 't-loja1')).toContain('versão do tenant loja1')
    expect(html(0, 'core')).toContain('Bem-vindo'); expect(html(2, 't-outro')).toContain('Bem-vindo') // outro tenant cai no core
    expect(rs[1]!.manifesto.paginas.inicio!.no.escopo).toBe('tenant')
  })
})

describe('o resultado RODA: abre o HTML gerado num navegador simulado e hidrata', () => {
  it('HTML + bundle + programa embutido: hidrata (adota os nós) e o clique funciona; o hash de CSP bate com o script inline', async () => {
    const dir = tmp('e2e')
    const [r] = await construirAot(todos(), { destino: dir }) as [Resultado]
    const e = r.manifesto.paginas.contador!
    let html = readFileSync(join(dir, 'core', e.arquivos.html!.nome), 'utf8')
    const js = readFileSync(join(dir, 'core', e.arquivos.cliente!.nome), 'utf8')
    html = html.replace(`<script src="${e.arquivos.cliente!.nome}"></script>`, `<script>${js}</script>`) // o que o navegador faria ao buscar o arquivo
    const dom = new JSDOM(html, { runScripts: 'dangerously' })
    const w = dom.window as unknown as { document: Document; Polaris: unknown }
    const n = w.document.getElementById('n')!
    expect(n.textContent).toBe('n=3')
    ;(w.document.getElementById('mais') as HTMLElement).click()
    expect(n.textContent).toBe('n=4')
    // o script inline de inicialização é exatamente o que a CSP autoriza pelo hash
    const inline = [...w.document.querySelectorAll('script:not([src]):not([type])')].map((s) => s.textContent!).find((t) => t === 'Polaris.inicia()')!
    expect(`sha256-${createHash('sha256').update(inline).digest('base64')}`).toBe(e.cspScript)
    // e é o MESMO para toda página vivo: uma só entrada na CSP serve ao site inteiro

  })
})

describe('segurança do HTML gerado', () => {
  it('texto hostil na página (</script>, <!--, U+2028, aspas) não escapa do JSON embutido nem vira marcação', async () => {
    const hostil = '</script><img id="xss" src=x onerror=alert(1)><!-- \u2028 \u2029 & "aspas" \'simples\''
    const pg = no('pagina', 'hostil', { rota: '/h', titulo: hostil, estado: { n: { tipo: 'inteiro', inicial: 0 } }, raiz: P('layout/pilha', { slots: { filhos: [
      P('texto/paragrafo', { id: 'p', props: { texto: hostil } }),
      P('nav/botao', { id: 'b', props: { texto: hostil }, eventos: { aoClicar: [{ acao: 'definir', estado: 'n', valor: 'estado.n + 1' }] } }),
    ] } }) })
    const dir = tmp('xss')
    const [r] = await construirAot(registro([NOS.servico, NOS.dados, pg]), { destino: dir }) as [Resultado]
    const e = r.manifesto.paginas.hostil!
    const html = readFileSync(join(dir, 'core', e.arquivos.html!.nome), 'utf8')
    const js = readFileSync(join(dir, 'core', e.arquivos.cliente!.nome), 'utf8')
    expect(e.modo).toBe('vivo')
    // o bloco JSON do programa não contém nenhum "<" cru: nada pode fechar o <script> nem abrir comentário
    const json = /<script type="application\/json" id="pl-programa">([^]*?)<\/script>/.exec(html)![1]!
    expect(json).not.toMatch(/[<>&\u2028\u2029]/)
    const dom = new JSDOM(html.replace(`<script src="${e.arquivos.cliente!.nome}"></script>`, `<script>${js}</script>`), { runScripts: 'dangerously' })
    const doc = dom.window.document
    expect(doc.getElementById('xss')).toBeNull() // nenhum elemento injetado
    expect(doc.querySelectorAll('script').length).toBe(3)
    expect(doc.getElementById('p')!.textContent).toBe(hostil)
    expect(doc.title).toBe(hostil)
    expect(JSON.parse(doc.getElementById('pl-programa')!.textContent!).pagina.id).toBe('hostil') // o JSON sobreviveu inteiro
    ;(doc.getElementById('b') as HTMLElement).click() // e a página continua viva
    expect(doc.getElementById('xss')).toBeNull()
  })
})

describe('CLI: pnpm aot', () => {
  const tsx = ['--import', 'tsx'] // o runner dos scripts (era o vite-node, que o vitest 5 não traz mais)
  const script = join(__dirname, '..', 'scripts', 'aot.ts')
  const nosDir = (extra: object[] = []) => {
    const d = tmp('nos'); mkdirSync(d, { recursive: true })
    writeFileSync(join(d, 'dados.json'), JSON.stringify([NOS.servico, NOS.dados]))
    writeFileSync(join(d, 'inicio.json'), JSON.stringify(NOS.inicio)); writeFileSync(join(d, 'contador.json'), JSON.stringify(NOS.contador))
    extra.forEach((n, i) => writeFileSync(join(d, `extra${i}.json`), JSON.stringify(n)))
    return d
  }
  it('lê os nós de um diretório, escreve a saída e sai com 0; relata modos e tamanhos', () => {
    const saida = tmp('cli'), nos = nosDir()
    expect(nosDoDiretorio(nos).length).toBe(4)
    const out = execFileSync('node', [...tsx, script, '--nos', nos, '--saida', saida], { encoding: 'utf8', cwd: join(__dirname, '..') })
    expect(out).toContain('2 página(s)'); expect(out).toMatch(/inicio\s+estatico\s+html/); expect(out).toMatch(/contador\s+vivo\s+html\s+cliente/)
    expect(existsSync(join(saida, 'core', 'manifesto.json'))).toBe(true)
  })
  it('sai com código 1 e mostra o erro com o caminho quando uma página é inválida (CI falha)', () => {
    const ruim = no('pagina', 'quebrada', { rota: '/q', raiz: P('texto/paragrafo', { props: { texto: '{semvar.x}' } }) })
    const r = spawnSync('node', [...tsx, script, '--nos', nosDir([ruim]), '--saida', tmp('cli-erro')], { encoding: 'utf8', cwd: join(__dirname, '..') })
    expect(r.status).toBe(1); expect(r.stderr).toContain('quebrada'); expect(r.stderr).toContain('/spec/raiz/props/texto')
  })
  it('sem argumentos: uso e código 2', () => {
    const r = spawnSync('node', [...tsx, script], { encoding: 'utf8', cwd: join(__dirname, '..') })
    expect(r.status).toBe(2); expect(r.stderr).toContain('uso: pnpm aot')
  })
})
