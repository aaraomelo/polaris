import { describe, expect, it } from 'vitest'
import { desenhaFluxo, diagramaDeBlocos, fluxoDaAplicacao, paginaDoDiagrama, LIMITES_DIAGRAMA, type Inst } from '../src/index'

const raiz: Inst = { bloco: 'layout/pilha', id: 'topo', slots: { filhos: [
  { bloco: 'texto/titulo', props: { texto: 'Bem-vindo' } },
  { bloco: 'nav/link', id: 'l1', props: { href: '/sobre', texto: 'Sobre' }, se: 'x' },
  { bloco: 'layout/linha', slots: { filhos: [{ bloco: 'texto/paragrafo', props: { texto: 'a' }, repetir: { cada: 'xs', como: 'x' } }] } },
] } }

describe('diagrama de blocos', () => {
  it('um retângulo por bloco, ligações pai→filho, o texto principal, `se`/`repetir` e o selecionado em destaque', () => {
    const d = diagramaDeBlocos(raiz, { selecionado: 'l1' })
    expect(d.blocos).toBe(5); expect(d.truncado).toBe(false)
    expect((d.svg.match(/<rect /g) ?? []).length).toBe(5); expect((d.svg.match(/<path class="lig"/g) ?? []).length).toBe(4)
    expect(d.svg).toContain('Bem-vindo'); expect(d.svg).toContain('Sobre'); expect(d.svg).toMatch(/se/); expect(d.svg).toContain('repetir')
    expect((d.svg.match(/class="cx sel"/g) ?? []).length).toBe(1)
    expect(diagramaDeBlocos(raiz).svg).not.toContain('cx sel')
  })
  it('texto do JSON é escapado (nada vira marcação) e quebras de linha não escapam da linha', () => {
    const d = diagramaDeBlocos({ bloco: 'x/<img src=x onerror=alert(1)>', props: { texto: '"><script>alert(1)</script>\nsegunda' } })
    expect(d.svg).not.toMatch(/<script|<img/); expect(d.svg).toContain('&lt;script&gt;'); expect(d.svg).not.toContain('\n')
    const ident = diagramaDeBlocos({ bloco: 'a/b', id: '"><b>' }); expect(ident.svg).not.toContain('<b>')
  })
  it('limita o tamanho: árvore enorme e muito funda é cortada e avisa', () => {
    const larga: Inst = { bloco: 'a/a', slots: { filhos: Array.from({ length: 1000 }, () => ({ bloco: 'a/b' })) } }
    const d = diagramaDeBlocos(larga); expect(d.truncado).toBe(true); expect(d.blocos).toBeLessThanOrEqual(LIMITES_DIAGRAMA.blocos)
    let funda: Inst = { bloco: 'a/f' }; for (let i = 0; i < 100; i++) funda = { bloco: 'a/f', slots: { filhos: [funda] } }
    expect(diagramaDeBlocos(funda).truncado).toBe(true)
  })
  it('entrada torta não quebra (slot que não é lista, filho sem bloco)', () => {
    expect(() => diagramaDeBlocos({ bloco: 'a/a', slots: { filhos: 'x' as never, outros: [null as never, { x: 1 } as never] } })).not.toThrow()
  })
  it('a página embrulha o SVG com estilo e sem script', () => { const h = paginaDoDiagrama(diagramaDeBlocos(raiz).svg); expect(h).toContain('prefers-color-scheme: dark'); expect(h).not.toMatch(/<script/) })
})

const pag = (id: string, rota: string, filhos: unknown[] = [], extra: object = {}) => ({ id, spec: { rota, titulo: id, raiz: { bloco: 'layout/pilha', slots: { filhos } }, ...extra } })
const link = (href: string) => ({ bloco: 'nav/link', props: { href, texto: 't' } })

describe('fluxo da aplicação', () => {
  const e = {
    paginas: [
      pag('home', '/', [link('/produtos'), link('/sobre?x=1'), link('https://externo.com'), link('/nao-existe'), { bloco: 'nav/botao', eventos: { clique: [{ acao: 'navegar', para: '/contato' }] } }]),
      pag('produtos', '/produtos', [link('/produtos/12')], { guarda: ['gerente'], dados: { lista: 'site.produtos' } }),
      pag('detalhe', '/produtos/:id'), pag('sobre', '/sobre'),
      pag('contato', '/contato', [{ bloco: 'form/formulario', props: { formulario: 'contato' } }]),
      pag('entrar', '/entrar'),
    ],
    formularios: [{ id: 'contato', spec: { campos: [{}, {}], envio: { servico: 'loja', operacao: 'criarContato' }, envio2: 1, sucesso: { acoes: [{ acao: 'navegar', para: '/sobre' }] } } }],
    dados: [{ id: 'site.produtos', spec: { fonte: { tipo: 'servico', servico: 'loja', operacao: 'listarProdutos' } } }],
  }
  const f = fluxoDaAplicacao(e), ha = (de: string, para: string) => f.arestas.some((a) => a.de === de && a.para === para)
  it('liga links, navegar, rota com parâmetro, formulário na página, dados e serviço', () => {
    expect(ha('pagina:home', 'pagina:produtos')).toBe(true); expect(ha('pagina:home', 'pagina:sobre')).toBe(true) // com ?query
    expect(ha('pagina:home', 'pagina:contato')).toBe(true) // navegar
    expect(ha('pagina:produtos', 'pagina:detalhe')).toBe(true) // /produtos/:id
    expect(ha('pagina:contato', 'formulario:contato')).toBe(true); expect(ha('formulario:contato', 'servico:loja')).toBe(true); expect(ha('formulario:contato', 'pagina:sobre')).toBe(true)
    expect(ha('pagina:produtos', 'dados:site.produtos')).toBe(true); expect(ha('dados:site.produtos', 'servico:loja')).toBe(true)
  })
  it('guarda de sessão aponta ao login (tracejada); link externo fica fora; destino sem página vira nó "falta" com aviso', () => {
    expect(f.arestas.find((a) => a.de === 'pagina:produtos' && a.para === 'pagina:entrar')).toMatchObject({ rotulo: 'sem sessão', estilo: 'tracejada' })
    expect(f.nos.some((n) => n.titulo.includes('externo'))).toBe(false)
    expect(f.nos.find((n) => n.tipo === 'falta')).toMatchObject({ titulo: '/nao-existe' }); expect(f.avisos.join()).toContain('/nao-existe')
    expect(fluxoDaAplicacao({ ...e, rotaLogin: '/sobre' }).arestas.find((a) => a.rotulo === 'sem sessão')?.para).toBe('pagina:sobre') // `rotaLogin` do tenant manda
  })
  it('destino calculado (`{…}`) e `//host` não viram ligação; sem duplicar ligações iguais', () => {
    const g = fluxoDaAplicacao({ paginas: [pag('a', '/', [link('/{estado.x}'), link('//mal.com/x'), link('/b'), link('/b')]), pag('b', '/b')], formularios: [], dados: [] })
    expect(g.arestas).toHaveLength(1); expect(g.nos.filter((n) => n.tipo === 'falta')).toHaveLength(0)
  })
  it('desenha em colunas, escapando textos; ligações para a própria coluna não quebram', () => {
    const d = desenhaFluxo(f); expect(d.nos).toBe(f.nos.length); expect(d.arestas).toBe(f.arestas.length)
    for (const t of ['Páginas', 'Formulários', 'Dados', 'Serviços']) expect(d.svg).toContain(t)
    const mau = desenhaFluxo(fluxoDaAplicacao({ paginas: [pag('<b>x', '/<b>')], formularios: [], dados: [] })); expect(mau.svg).not.toContain('<b>')
    expect(desenhaFluxo(fluxoDaAplicacao({ paginas: [], formularios: [], dados: [] }))).toMatchObject({ nos: 0, arestas: 0 })
  })
  it('nó hostil não derruba: spec torto, ciclo de links e muitíssimas páginas', () => {
    expect(() => fluxoDaAplicacao({ paginas: [{ id: 'x', spec: { rota: 5, raiz: 'oi', dados: [1], guarda: 'z' } as never }, { id: 'y' }], formularios: [{ id: 'f', spec: { envio: 3 } as never }], dados: [{ id: 'd', spec: { fonte: [] } as never }] })).not.toThrow()
    const ciclo = fluxoDaAplicacao({ paginas: [pag('a', '/a', [link('/b')]), pag('b', '/b', [link('/a')])], formularios: [], dados: [] }); expect(ciclo.arestas).toHaveLength(2)
    const muitas = fluxoDaAplicacao({ paginas: Array.from({ length: 500 }, (_, i) => pag(`p${i}`, `/p${i}`, [link(`/p${(i + 1) % 500}`)])), formularios: [], dados: [] })
    expect(muitas.truncado).toBe(true); expect(muitas.nos.length).toBeLessThanOrEqual(LIMITES_DIAGRAMA.paginas)
  })
})
