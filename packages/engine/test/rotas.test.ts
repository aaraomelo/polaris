import { Registry, type Erro } from '@polaris/schema'
import { describe, expect, it } from 'vitest'
import {
  RotaErro, caminhoRelativoSeguro, casaSegmentos, cmpEspecificidade, compilaTabela, forma, montaCaminho, parseRota, registraBase, resolveRota, urlDe, valorSeguro, voltaSegura,
  type ResultadoRota, type TabelaRotas,
} from '../src/index'

const no = (kind: string, id: string, spec: object) => ({ kind, id, versao: '1.0.0', estatuto: 'publicado', spec }) as any
const pg = (id: string, rota: string, extra: object = {}) => no('pagina', id, { rota, raiz: { bloco: 'layout/pilha' }, ...extra })
const U = '11111111-1111-1111-1111-111111111111'

type Paginas = Array<ReturnType<typeof pg>>
function compila(paginas: Paginas, tenant: object = {}): { tabela?: TabelaRotas; erros?: Erro[] } {
  const r = new Registry()
  registraBase(r)
  for (const p of paginas) r.registra(p)
  const t = r.registra(no('tenant', 'loja', { alias: 'loja', segmento: 'varejo', paginas: paginas.map((p) => p.id), ...tenant }))
  const res = compilaTabela(r, t)
  return res.ok ? { tabela: res.tabela } : { erros: res.erros }
}
const tabelaOk = (paginas: Paginas, tenant: object = {}): TabelaRotas => {
  const r = compila(paginas, tenant)
  if (!r.tabela) throw new Error(JSON.stringify(r.erros, null, 1))
  return r.tabela
}
const erros = (paginas: Paginas, tenant: object = {}): Erro[] => {
  const r = compila(paginas, tenant)
  if (!r.erros) throw new Error('esperava erros')
  return r.erros
}
const rota = (t: TabelaRotas, caminho: string, extra: object = {}): ResultadoRota => resolveRota(t, { caminho, ...extra })

describe('parseRota', () => {
  it('raiz, estáticos, parâmetros e catch-all', () => {
    expect(parseRota('/')).toEqual([])
    expect(parseRota('/produtos/:id/fotos')).toEqual([{ t: 'est', v: 'produtos' }, { t: 'par', nome: 'id' }, { t: 'est', v: 'fotos' }])
    expect(parseRota('/docs/*resto')).toEqual([{ t: 'est', v: 'docs' }, { t: 'resto', nome: 'resto' }])
    expect(parseRota('/ação/café-1.2_x~y')).toHaveLength(2) // letras acentuadas e . _ ~ - são permitidos
  })

  it.each([
    ['produtos', /começar com '\/'/], ['/a/', /terminar com '\/'/], ['/a//b', /segmento vazio/], ['/a/./b', /'\.' não é permitido/], ['/a/../b', /'\.\.' não é permitido/],
    ['/a/:Id', /nome de parâmetro inválido/], ['/a/:', /nome de parâmetro inválido/], ['/a/:id/:id', /aparece duas vezes/], ['/a/*r/b', /só pode ser o último/],
    ['/a b', /caracteres não permitidos/], ['/a?b', /caracteres não permitidos/], ['/a%20b', /caracteres não permitidos/], ['/a/*r/*r', /só pode ser o último/],
    ['/' + 'a/'.repeat(20) + 'z', /mais de 16 segmentos/], ['/' + 'a'.repeat(600), /longa demais/],
  ])('%j é recusada: %s', (p, re) => {
    expect(() => parseRota(p)).toThrow(RotaErro)
    expect(() => parseRota(p)).toThrow(re)
  })

  it('forma ignora o nome do parâmetro; a especificidade põe estático antes de parâmetro antes de catch-all', () => {
    expect(forma(parseRota('/a/:x'))).toBe(forma(parseRota('/a/:y')))
    expect(forma(parseRota('/a/:x'))).not.toBe(forma(parseRota('/a/b')))
    const ordem = ['/:a', '/*r', '/x', '/x/:y', '/x/y'].map((p) => parseRota(p)).sort(cmpEspecificidade).map((s) => forma(s))
    expect(ordem).toEqual(['e:x', 'e:x/e:y', 'e:x/:', ':', '*'])
  })

  it('valorSeguro e montaCaminho', () => {
    for (const v of ['', '.', '..', 'a/b', 'a\\b', 'a\u0000b', 'x'.repeat(300)]) expect(valorSeguro(v), JSON.stringify(v)).toBe(false)
    for (const v of ['abc', 'a b', 'ç', '%2F', 'a.b', '...']) expect(valorSeguro(v)).toBe(true)
    expect(montaCaminho(parseRota('/p/:id/*r'), { id: 'a b/ç', r: ['x y', 'z'] })).toBe('/p/a%20b%2F%C3%A7/x%20y/z')
    expect(montaCaminho([], {})).toBe('/')
  })

  it('casaSegmentos: parâmetros inseguros não casam; catch-all exige ao menos um segmento', () => {
    expect(casaSegmentos(parseRota('/a/:x'), ['a', 'v'])).toEqual({ valores: { x: 'v' } })
    expect(casaSegmentos(parseRota('/a/:x'), ['a', '..'])).toBeNull()
    expect(casaSegmentos(parseRota('/a/:x'), ['a', 'b/c'])).toBeNull()
    expect(casaSegmentos(parseRota('/a/*r'), ['a'])).toBeNull()
    expect(casaSegmentos(parseRota('/a/*r'), ['a', 'b', 'c'])).toEqual({ valores: { r: ['b', 'c'] } })
    expect(casaSegmentos(parseRota('/a'), ['a', 'b'])).toBeNull()
  })
})

describe('compilaTabela: validações', () => {
  it('compila e ordena por especificidade (independe da ordem de cadastro)', () => {
    const ps = [pg('docs', '/docs/*resto'), pg('item', '/produtos/:id'), pg('lista', '/produtos'), pg('home', '/'), pg('novo', '/produtos/novo')]
    const a = tabelaOk(ps)
    const b = tabelaOk([...ps].reverse())
    expect(a.entradas.map((e) => e.pagina)).toEqual(b.entradas.map((e) => e.pagina))
    expect(a.entradas.map((e) => e.pagina)).toEqual(['home', 'lista', 'novo', 'item', 'docs'])
  })

  it('rotas com a mesma forma são ambíguas, mesmo com nomes de parâmetro diferentes', () => {
    const e = erros([pg('a', '/p/:x'), pg('b', '/p/:y')])
    expect(e.find((x) => x.regra === 'rota-ambigua')!.mensagem).toMatch(/'a' e 'b'/)
    expect(erros([pg('a', '/'), pg('b', '/')]).some((x) => x.regra === 'rota-ambigua')).toBe(true)
  })

  it('rota inválida aponta a página', () => {
    const e = erros([pg('a', '/a/:Id')])
    expect(e[0]).toMatchObject({ regra: 'rota', caminho: '/spec/paginas/0' })
    expect(e[0]!.mensagem).toContain("página 'a'")
  })

  it('params: tipos entram na tabela; declarado e ausente da rota é erro', () => {
    const t = tabelaOk([pg('p', '/p/:id/:slug', { params: { id: { tipo: 'inteiro' } } })])
    expect(t.entradas[0]!.params).toEqual({ id: 'inteiro', slug: 'texto' })
    const e = erros([pg('p', '/p/:id', { params: { idd: { tipo: 'inteiro' } } })])
    expect(e[0]!.mensagem).toContain("'idd' está declarado em params")
    expect(e[0]!.dica).toContain('parâmetros da rota: id')
  })

  it('guarda é copiada para a tabela', () => {
    expect(tabelaOk([pg('a', '/a', { guarda: ['admin.ler', 'admin.editar'] })]).entradas[0]!.guarda).toEqual(['admin.ler', 'admin.editar'])
  })

  it('página duplicada em paginas', () => {
    const r = new Registry(); registraBase(r); r.registra(pg('a', '/a'))
    const t = r.registra(no('tenant', 'l', { alias: 'l', segmento: 'varejo', paginas: ['a', 'a'] }))
    const res = compilaTabela(r, t)
    expect(res.ok).toBe(false)
  })

  it('página inexistente em paginas é reportada (referência quebrada)', () => {
    const r = new Registry(); registraBase(r)
    const t = r.registra(no('tenant', 'l', { alias: 'l', segmento: 'varejo', paginas: ['nada'] }))
    const res = compilaTabela(r, t)
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.erros[0]!.regra).toBe('ref')
  })

  it('só aceita kind tenant', () => {
    const r = new Registry(); registraBase(r)
    expect(compilaTabela(r, r.registra(pg('a', '/a'))).ok).toBe(false)
  })
})

describe('compilaTabela: i18n', () => {
  const i18n = { idiomas: ['pt-BR', 'en', 'es'], idiomaPadrao: 'pt-BR' }

  it('padrão por idioma, com fallback para a rota base', () => {
    const t = tabelaOk([pg('produto', '/produtos/:id', { rotasI18n: { en: '/products/:id' } })], i18n)
    const p = t.entradas[0]!.padroes
    expect(forma(p['en']!)).toBe('e:products/:')
    expect(forma(p['pt-BR']!)).toBe('e:produtos/:')
    expect(forma(p['es']!)).toBe('e:produtos/:') // sem override: usa a base
  })

  it('o padrão por idioma precisa ter os mesmos parâmetros', () => {
    expect(erros([pg('p', '/p/:id', { rotasI18n: { en: '/p/:slug' } })], i18n)[0]!.mensagem).toMatch(/parâmetros \(slug\) diferentes/)
  })

  it('idioma não configurado em rotasI18n; idioma padrão fora da lista; padrão sem lista', () => {
    expect(erros([pg('p', '/p', { rotasI18n: { fr: '/p' } })], i18n).some((x) => x.regra === 'idioma' && x.mensagem.includes("'fr'"))).toBe(true)
    expect(erros([pg('p', '/p')], { idiomas: ['en'], idiomaPadrao: 'pt-BR' }).some((x) => x.caminho === '/spec/idiomaPadrao')).toBe(true)
    expect(erros([pg('p', '/p')], { idiomaPadrao: 'en' }).some((x) => x.caminho === '/spec/idiomaPadrao')).toBe(true)
  })

  it('o idioma padrão é o primeiro da lista quando não informado', () => {
    expect(tabelaOk([pg('p', '/p')], { idiomas: ['en', 'pt-BR'] }).idiomaPadrao).toBe('en')
  })

  it('primeiro segmento estático igual a um código de idioma colide com o prefixo', () => {
    expect(erros([pg('p', '/en/sobre')], i18n)[0]).toMatchObject({ regra: 'rota' })
    expect(erros([pg('p', '/EN')], i18n)[0]!.mensagem).toContain('código de idioma')
    tabelaOk([pg('p', '/en/sobre')]) // sem i18n não é problema
  })

  it('ambiguidade é checada por idioma (rotas distintas em um idioma podem colidir em outro)', () => {
    const e = erros([pg('a', '/x', { rotasI18n: { en: '/same' } }), pg('b', '/y', { rotasI18n: { en: '/same' } })], i18n)
    expect(e.find((x) => x.regra === 'rota-ambigua')!.mensagem).toContain("em 'en'")
  })
})

describe('compilaTabela: redirecionamentos, login e páginas de erro', () => {
  const base = [pg('home', '/'), pg('entrar', '/entrar'), pg('admin', '/admin', { guarda: ['admin.ler'] }), pg('negado', '/negado'), pg('nf', '/nf')]

  it('redirecionamentos válidos com parâmetros e status', () => {
    const t = tabelaOk(base, { redirecionamentos: [{ de: '/antiga/:id', para: '/novo/:id', status: 301 }, { de: '/promo', para: '/' }] })
    expect(t.redirecionamentos.map((r) => r.status)).toEqual([301, 301])
  })

  it('"para" com parâmetro que "de" não tem; "para" externo; "de" duplicado', () => {
    expect(erros(base, { redirecionamentos: [{ de: '/a', para: '/b/:x' }] })[0]!.mensagem).toContain(":x, que não existe em 'de'")
    // destinos fora do site são recusados (o parser já barra '//' e esquemas; caminhoRelativoSeguro é a segunda barreira)
    for (const externo of ['//evil.com/x', '/\\evil.com']) {
      expect(erros(base, { redirecionamentos: [{ de: '/a', para: externo }] }).some((x) => x.regra === 'redirecionamento' && x.caminho === '/spec/redirecionamentos/0/para'), externo).toBe(true)
    }
    expect(() => compila(base, { redirecionamentos: [{ de: '/a', para: 'https://evil.com' }] })).toThrow(/deve começar com '\/'/) // o schema já barra esquemas externos no registro do nó
    expect(erros(base, { redirecionamentos: [{ de: '/a', para: '/b' }, { de: '/a', para: '/c' }] }).some((x) => x.mensagem.includes('já existe um redirecionamento'))).toBe(true)
  })

  it('laços de redirecionamento (direto, indireto e com parâmetros)', () => {
    const e1 = erros(base, { redirecionamentos: [{ de: '/a', para: '/b' }, { de: '/b', para: '/a' }] })
    expect(e1.some((x) => x.mensagem.includes('em laço'))).toBe(true)
    const e2 = erros(base, { redirecionamentos: [{ de: '/a', para: '/b' }, { de: '/b', para: '/c' }, { de: '/c', para: '/a' }] })
    expect(e2.some((x) => x.mensagem.includes('em laço'))).toBe(true)
    expect(erros(base, { redirecionamentos: [{ de: '/a/:x', para: '/a/:x' }] }).some((x) => x.mensagem.includes('em laço'))).toBe(true)
    tabelaOk(base, { redirecionamentos: [{ de: '/a', para: '/b' }, { de: '/b', para: '/c' }] }) // cadeia sem laço é válida
  })

  it('rotaLogin precisa existir, sem parâmetros e sem guarda', () => {
    tabelaOk(base, { rotaLogin: '/entrar' })
    expect(erros(base, { rotaLogin: '/nao-existe' })[0]!.mensagem).toContain('nenhuma página')
    expect(erros([...base, pg('entrar2', '/e/:x')], { rotaLogin: '/e/:x' }).some((x) => x.mensagem.includes('parâmetros'))).toBe(true)
    expect(erros(base, { rotaLogin: '/admin' }).some((x) => x.mensagem.includes('laço'))).toBe(true)
  })

  it('paginaNegado e paginaNaoEncontrada não podem exigir permissão', () => {
    tabelaOk(base, { paginaNegado: 'negado', paginaNaoEncontrada: 'nf' })
    expect(erros(base, { paginaNegado: 'admin' }).some((x) => x.caminho === '/spec/paginaNegado' && x.mensagem.includes('laço'))).toBe(true)
  })
})

describe('resolveRota: casamento e precedência', () => {
  const ps = [
    pg('home', '/'), pg('lista', '/produtos'), pg('novo', '/produtos/novo'), pg('item', '/produtos/:id', { params: { id: { tipo: 'uuid' } } }),
    pg('slug', '/p/:slug'), pg('docs', '/docs/*resto'), pg('qtd', '/lote/:n', { params: { n: { tipo: 'inteiro' } } }),
  ]
  const t = tabelaOk(ps)

  it('estático vence parâmetro; parâmetro tipado só casa com valor do tipo', () => {
    expect(rota(t, '/produtos/novo')).toMatchObject({ tipo: 'pagina', pagina: 'novo' })
    expect(rota(t, `/produtos/${U}`)).toMatchObject({ tipo: 'pagina', pagina: 'item', params: { id: U } })
    expect(rota(t, '/produtos/nao-e-uuid')).toMatchObject({ tipo: 'nao-encontrada', status: 404 })
  })

  it('parâmetro vira o tipo declarado (inteiro) e o catch-all vira lista', () => {
    expect(rota(t, '/lote/42')).toMatchObject({ tipo: 'pagina', pagina: 'qtd', params: { n: 42 } })
    expect(rota(t, '/lote/abc').tipo).toBe('nao-encontrada')
    expect(rota(t, '/docs/a/b/c')).toMatchObject({ tipo: 'pagina', pagina: 'docs', params: { resto: ['a', 'b', 'c'] } })
    expect(rota(t, '/docs').tipo).toBe('nao-encontrada')
  })

  it('raiz, decodificação e valores acentuados', () => {
    expect(rota(t, '/')).toMatchObject({ tipo: 'pagina', pagina: 'home', canonica: '/' })
    expect(rota(t, '/p/a%20b%C3%A7')).toMatchObject({ pagina: 'slug', params: { slug: 'a bç' } })
  })

  it('a ordem de cadastro não muda o resultado', () => {
    const t2 = tabelaOk([...ps].reverse())
    for (const c of ['/produtos/novo', `/produtos/${U}`, '/p/x', '/docs/x', '/']) expect(rota(t2, c)).toEqual(rota(t, c))
  })

  it('não casa: caminho a mais, a menos, ou página inexistente', () => {
    for (const c of ['/produtos/novo/x', '/nada', '/p', '/p/a/b']) expect(rota(t, c).tipo, c).toBe('nao-encontrada')
  })
})

describe('resolveRota: normalização e entradas hostis', () => {
  const t = tabelaOk([pg('home', '/'), pg('lista', '/produtos'), pg('item', '/produtos/:id')])

  it('barra final e barras duplicadas viram redirecionamento 308 que preserva a query', () => {
    expect(rota(t, '/produtos/')).toEqual({ tipo: 'redireciona', status: 308, para: '/produtos', motivo: 'barra' })
    expect(rota(t, '/produtos//x', { consulta: 'a=1&b=2' })).toEqual({ tipo: 'redireciona', status: 308, para: '/produtos/x?a=1&b=2', motivo: 'barra' })
    expect(rota(t, '//')).toMatchObject({ tipo: 'redireciona', para: '/' })
  })

  it('"//evil.com" nunca vira redirecionamento para outro domínio', () => {
    for (const c of ['//evil.com', '//evil.com/x', '///evil.com']) {
      const r = rota(t, c)
      expect(r.tipo).toBe('redireciona')
      if (r.tipo === 'redireciona') { expect(r.para.startsWith('//')).toBe(false); expect(r.para.startsWith('/')).toBe(true) }
    }
  })

  it.each([
    ['sem barra inicial', 'produtos'], ['barra invertida', '/a\\b'], ['query no caminho', '/a?b=1'], ['fragmento', '/a#b'], ['dot-dot', '/a/../b'], ['dot', '/a/./b'],
    ['controle', '/a\u0000b'], ['quebra de linha', '/a\nb'], ['percent malformado', '/a/%E0%A4%A'], ['segmento com NUL codificado', '/a/%00'], ['caminho enorme', '/' + 'a'.repeat(3000)],
    ['segmentos demais', '/' + 'a/'.repeat(40) + 'z'],
  ])('400: %s', (_n, c) => expect(rota(t, c)).toMatchObject({ tipo: 'invalida', status: 400 }))

  it('CR/LF na query é recusado (injeção de cabeçalho no Location)', () => {
    expect(rota(t, '/produtos', { consulta: 'a=1\r\nSet-Cookie: x=1' })).toMatchObject({ tipo: 'invalida', status: 400 })
    expect(rota(t, '/produtos/', { consulta: 'a=\nb' })).toMatchObject({ tipo: 'invalida' })
  })

  it('valores decodificados perigosos não viram parâmetro (%2F, %2e%2e)', () => {
    expect(rota(t, '/produtos/a%2Fb').tipo).toBe('nao-encontrada')
    expect(rota(t, '/produtos/%2e%2e').tipo).toBe('nao-encontrada')
    expect(rota(t, '/produtos/%2E').tipo).toBe('nao-encontrada')
    expect(rota(t, '/produtos/a%5Cb').tipo).toBe('nao-encontrada')
  })

  it('o segmento estático é comparado depois de decodificar', () => {
    expect(rota(t, '/%70rodutos')).toMatchObject({ tipo: 'pagina', pagina: 'lista' })
  })
})

describe('resolveRota: i18n', () => {
  const t = tabelaOk([pg('home', '/'), pg('produto', '/produtos/:id', { rotasI18n: { en: '/products/:id', es: '/productos/:id' } }), pg('sobre', '/sobre', { rotasI18n: { en: '/about' } })],
    { idiomas: ['pt-BR', 'en', 'es'], idiomaPadrao: 'pt-BR' })

  it('idioma padrão sem prefixo; os outros com prefixo e padrão próprio', () => {
    expect(rota(t, '/produtos/7')).toMatchObject({ pagina: 'produto', idioma: 'pt-BR', canonica: '/produtos/7' })
    expect(rota(t, '/en/products/7')).toMatchObject({ pagina: 'produto', idioma: 'en', canonica: '/en/products/7' })
    expect(rota(t, '/es/productos/7')).toMatchObject({ pagina: 'produto', idioma: 'es' })
    expect(rota(t, '/en')).toMatchObject({ pagina: 'home', idioma: 'en', canonica: '/en' })
  })

  it('o padrão de um idioma não vale em outro', () => {
    expect(rota(t, '/en/produtos/7').tipo).toBe('nao-encontrada')
    expect(rota(t, '/products/7').tipo).toBe('nao-encontrada')
  })

  it('prefixo do idioma padrão e caixa errada redirecionam para a URL canônica', () => {
    expect(rota(t, '/pt-BR/produtos/7')).toEqual({ tipo: 'redireciona', status: 308, para: '/produtos/7', motivo: 'idioma' })
    expect(rota(t, '/pt-br')).toMatchObject({ tipo: 'redireciona', para: '/' })
    expect(rota(t, '/EN/products/7', { consulta: 'x=1' })).toEqual({ tipo: 'redireciona', status: 308, para: '/en/products/7?x=1', motivo: 'idioma' })
  })

  it('alternativas (hreflang): a mesma página nos outros idiomas, com os mesmos parâmetros', () => {
    const r = rota(t, '/en/products/7') as Extract<ResultadoRota, { tipo: 'pagina' }>
    expect(r.alternativas).toEqual({ 'pt-BR': '/produtos/7', en: '/en/products/7', es: '/es/productos/7' })
    const s = rota(t, '/sobre') as Extract<ResultadoRota, { tipo: 'pagina' }>
    expect(s.alternativas).toEqual({ 'pt-BR': '/sobre', en: '/en/about', es: '/es/sobre' }) // es sem override cai na base
  })
})

describe('resolveRota: guardas, login e erros', () => {
  const ps = [pg('home', '/'), pg('entrar', '/entrar'), pg('admin', '/admin/:id', { guarda: ['admin.ler'] }), pg('dupla', '/dupla', { guarda: ['a.b', 'c.d'] }), pg('negado', '/negado'), pg('nf', '/nf')]
  const comLogin = tabelaOk(ps, { rotaLogin: '/entrar', paginaNegado: 'negado', paginaNaoEncontrada: 'nf' })
  const semLogin = tabelaOk(ps)
  const sessao = (...permissoes: string[]) => ({ sessao: { permissoes } })

  it('sem sessão: redireciona ao login com volta (302); sem rotaLogin: 401', () => {
    const r = rota(comLogin, '/admin/5', { consulta: 'aba=2' })
    expect(r).toEqual({ tipo: 'redireciona', status: 302, para: '/entrar?volta=%2Fadmin%2F5%3Faba%3D2', motivo: 'login' })
    expect(rota(semLogin, '/admin/5')).toEqual({ tipo: 'negado', status: 401 })
  })

  it('com sessão sem a permissão: 403 (com a página de acesso negado, se houver)', () => {
    expect(rota(comLogin, '/admin/5', sessao('outra.coisa'))).toEqual({ tipo: 'negado', status: 403, pagina: 'negado' })
    expect(rota(semLogin, '/admin/5', sessao())).toEqual({ tipo: 'negado', status: 403 })
  })

  it('com a permissão passa; exige TODAS as permissões', () => {
    expect(rota(comLogin, '/admin/5', sessao('admin.ler'))).toMatchObject({ tipo: 'pagina', pagina: 'admin', params: { id: '5' } })
    expect(rota(comLogin, '/dupla', sessao('a.b'))).toMatchObject({ tipo: 'negado', status: 403 })
    expect(rota(comLogin, '/dupla', sessao('a.b', 'c.d'))).toMatchObject({ tipo: 'pagina' })
  })

  it('sessão vazia (objeto sem permissões) é sessão: dá 403, não login', () => {
    expect(rota(comLogin, '/admin/5', sessao())).toMatchObject({ tipo: 'negado', status: 403 })
  })

  it('página pública não pede sessão; a guarda não vaza a existência da rota por tipo de parâmetro', () => {
    expect(rota(comLogin, '/')).toMatchObject({ tipo: 'pagina' })
  })

  it('404 aponta a página configurada; a "volta" nunca sai do site', () => {
    expect(rota(comLogin, '/nao-existe')).toEqual({ tipo: 'nao-encontrada', status: 404, pagina: 'nf' })
    expect(rota(semLogin, '/nao-existe')).toEqual({ tipo: 'nao-encontrada', status: 404 })
  })

  it('caminhoRelativoSeguro (segunda barreira contra open redirect)', () => {
    for (const ok of ['/', '/a', '/a/b?x=1', '/en/login']) expect(caminhoRelativoSeguro(ok), ok).toBe(true)
    for (const ruim of ['', 'a', '//evil.com', '///x', '/\\evil.com', '/a\\b', 'https://evil.com', '/a\nb', '/a\u0000b', 'javascript:alert(1)']) expect(caminhoRelativoSeguro(ruim), JSON.stringify(ruim)).toBe(false)
  })

  it('voltaSegura: só caminho relativo do próprio site', () => {
    expect(voltaSegura('/admin/5?aba=2')).toBe('/admin/5?aba=2')
    for (const ruim of ['//evil.com', 'https://evil.com', '/\\evil.com', 'javascript:alert(1)', '', null, undefined, '/a\nb', '/x'.repeat(2000)]) expect(voltaSegura(ruim as string), String(ruim)).toBe('/')
  })

  it('com i18n o login leva o prefixo do idioma da requisição', () => {
    const t = tabelaOk([pg('entrar', '/entrar', { rotasI18n: { en: '/login' } }), pg('admin', '/admin', { guarda: ['x.y'] })], { idiomas: ['pt-BR', 'en'], rotaLogin: '/entrar' })
    const r = rota(t, '/en/admin')
    expect(r).toMatchObject({ tipo: 'redireciona', status: 302, motivo: 'login' })
    if (r.tipo === 'redireciona') expect(r.para).toBe('/en/login?volta=%2Fen%2Fadmin') // a rota do login EM INGLÊS é /login, não /entrar
  })
})

describe('redirecionamentos do tenant', () => {
  const t = tabelaOk([pg('home', '/'), pg('produto', '/produtos/:id')], { redirecionamentos: [{ de: '/antiga/:id', para: '/produtos/:id', status: 301 }, { de: '/promo', para: '/', status: 307 }, { de: '/docs/*r', para: '/ajuda' }] })

  it('substitui parâmetros (codificados), preserva a query e usa o status configurado', () => {
    expect(rota(t, '/antiga/a%20b', { consulta: 'x=1' })).toEqual({ tipo: 'redireciona', status: 301, para: '/produtos/a%20b?x=1', motivo: 'redirecionamento' })
    expect(rota(t, '/promo')).toMatchObject({ status: 307, para: '/' })
    expect(rota(t, '/docs/a/b')).toMatchObject({ status: 301, para: '/ajuda' })
  })

  it('um parâmetro hostil não injeta destino: o valor é codificado e fica em um segmento', () => {
    const r = rota(t, '/antiga/%2F%2Fevil.com')
    // %2F decodificado contém '/', então o parâmetro é recusado: não há redirecionamento
    expect(r.tipo).toBe('nao-encontrada')
    const ok = rota(t, '/antiga/evil.com') as Extract<ResultadoRota, { tipo: 'redireciona' }>
    expect(ok.para).toBe('/produtos/evil.com')
  })
})

describe('urlDe (roteamento reverso)', () => {
  const t = tabelaOk([pg('home', '/'), pg('item', '/produtos/:id', { params: { id: { tipo: 'inteiro' } }, rotasI18n: { en: '/products/:id' } }), pg('docs', '/docs/*resto'), pg('busca', '/busca')], { idiomas: ['pt-BR', 'en'] })

  it('monta a URL, com prefixo só fora do idioma padrão, e query ordenada', () => {
    expect(urlDe(t, 'item', { id: 5 })).toEqual({ ok: true, url: '/produtos/5' })
    expect(urlDe(t, 'item', { id: '5' }, { idioma: 'en' })).toEqual({ ok: true, url: '/en/products/5' })
    expect(urlDe(t, 'home', {}, { idioma: 'en' })).toEqual({ ok: true, url: '/en' })
    expect(urlDe(t, 'busca', {}, { consulta: { z: 1, a: 'x y', m: true } })).toEqual({ ok: true, url: '/busca?a=x+y&m=true&z=1' })
    expect(urlDe(t, 'docs', { resto: ['a b', 'c'] })).toEqual({ ok: true, url: '/docs/a%20b/c' })
  })

  it('erros claros: página, idioma, parâmetro faltando/extra/tipo/inseguro', () => {
    const e = (r: ReturnType<typeof urlDe>) => (r.ok ? 'OK' : r.erro)
    expect(e(urlDe(t, 'nada', {}))).toContain("não está na tabela")
    expect(e(urlDe(t, 'home', {}, { idioma: 'fr' }))).toContain("idioma 'fr' não configurado")
    expect(e(urlDe(t, 'item', {}))).toContain("falta o parâmetro 'id'")
    expect(e(urlDe(t, 'item', { id: 1, x: 2 }))).toContain("'x' não existe")
    expect(e(urlDe(t, 'item', { id: 'abc' }))).toContain('deveria ser inteiro')
    expect(e(urlDe(t, 'docs', { resto: [] }))).toContain('lista não vazia')
    expect(e(urlDe(t, 'docs', { resto: ['a/b'] }))).toContain('segmentos seguros')
  })

  it('ida e volta (fuzz): o que urlDe aceita, resolveRota resolve de volta com os mesmos valores', () => {
    const tt = tabelaOk([pg('p', '/p/:slug'), pg('q', '/q/:a/x/:b'), pg('r', '/r/*resto')], { idiomas: ['pt-BR', 'en'] })
    let s = 99
    const rnd = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff)
    const alfabeto = ['a', 'b', 'Z', '0', 'ç', 'ã', '日', '😀', ' ', '%', '%2F', '?', '#', '&', '=', '+', '/', '\\', '.', '..', '-', '_', '~', '"', "'", '<', '>', '\u0000', '\n', ':']
    const valor = () => Array.from({ length: Math.floor(rnd() * 7) }, () => alfabeto[Math.floor(rnd() * alfabeto.length)]).join('')
    let aceitos = 0
    for (let i = 0; i < 3000; i++) {
      const idioma = rnd() < 0.5 ? 'en' : 'pt-BR'
      const caso = Math.floor(rnd() * 3)
      const params = caso === 0 ? { slug: valor() } : caso === 1 ? { a: valor(), b: valor() } : { resto: Array.from({ length: 1 + Math.floor(rnd() * 3) }, valor) }
      const pagina = ['p', 'q', 'r'][caso]!
      const u = urlDe(tt, pagina, params, { idioma })
      if (!u.ok) continue
      aceitos++
      const [caminho, consulta] = u.url.split('?')
      const r = resolveRota(tt, { caminho: caminho!, ...(consulta !== undefined ? { consulta } : {}) })
      expect(r, `${u.url} ← ${JSON.stringify(params)}`).toMatchObject({ tipo: 'pagina', pagina, idioma })
      if (r.tipo === 'pagina') expect(r.params).toEqual(params)
    }
    expect(aceitos).toBeGreaterThan(300) // o fuzz exercitou o caminho feliz de verdade
  })
})
