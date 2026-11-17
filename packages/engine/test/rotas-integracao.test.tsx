import { Registry } from '@polaris/schema'
import { describe, expect, it } from 'vitest'
import { COMPONENTES_BASE, compilaPrograma, compilaTabela, registraBase, resolveRota, urlDe, type Programa, type TabelaRotas } from '../src/index'
import { renderPaginaStream, textoDoStream } from '../src/render/stream'

const no = (kind: string, id: string, spec: object, extra: object = {}) => ({ kind, id, versao: '1.0.0', estatuto: 'publicado', spec, ...extra }) as any
const P = (b: string, extra: object = {}) => ({ bloco: b, ...extra })
const U = '11111111-1111-1111-1111-111111111111'

function loja() {
  const r = new Registry()
  registraBase(r)
  r.registra(no('servico', 'catalogo', { entidades: {}, operacoes: {} }))
  r.registra(no('dados', 'd.prod', { fonte: { tipo: 'servico', servico: 'catalogo', operacao: 'obter' }, parametros: { id: { tipo: 'uuid', obrigatorio: true } } }))
  r.registra(no('bloco', 'layout.loja', { interface: 'layout/loja', slots: { conteudo: {} }, props: { type: 'object', properties: { nome: { type: 'string' } } },
    modelo: P('layout/pilha', { slots: { filhos: [P('texto/titulo', { props: { texto: '{props.nome}' } }), P('core/slot', { props: { nome: 'conteudo' } })] } }) }))
  const pagina = (id: string, rota: string, extra: object = {}) => r.registra(no('pagina', id, { rota, layout: 'layout/loja', layoutProps: { nome: '{tenant.nome}' }, raiz: P('texto/paragrafo', { props: { texto: `pág:${id} idioma:{idioma}` } }), ...extra }))
  pagina('home', '/')
  pagina('produto', '/produtos/:id', { rotasI18n: { en: '/products/:id' }, params: { id: { tipo: 'uuid' } }, dados: { produto: { dados: 'd.prod', args: { id: '{params.id}' } } },
    raiz: P('texto/paragrafo', { props: { texto: 'produto:{produto.nome} ({idioma})' } }) })
  pagina('entrar', '/entrar', { rotasI18n: { en: '/login' } })
  pagina('admin', '/admin', { guarda: ['admin.ler'] })
  pagina('negado', '/acesso-negado')
  pagina('nf', '/nao-encontrada')
  const t = r.registra(no('tenant', 'sol', { alias: 'sol', segmento: 'varejo', idiomas: ['pt-BR', 'en'], idiomaPadrao: 'pt-BR', rotaLogin: '/entrar', paginaNegado: 'negado', paginaNaoEncontrada: 'nf',
    redirecionamentos: [{ de: '/p/:id', para: '/produtos/:id' }], paginas: ['home', 'produto', 'entrar', 'admin', 'negado', 'nf'] }))
  const tab = compilaTabela(r, t)
  if (!tab.ok) throw new Error(JSON.stringify(tab.erros, null, 1))
  return { r, tabela: tab.tabela }
}

/** O que um servidor faz com uma requisição: rota → (redireciona | negado | página) → HTML. */
async function atende(ctx: ReturnType<typeof loja>, caminho: string, extra: { sessao?: { permissoes: string[] } | null; consulta?: string } = {}) {
  const res = resolveRota(ctx.tabela, { caminho, ...extra })
  if (res.tipo !== 'pagina') {
    // 404 e 403 renderizam a página configurada (com o status certo)
    const id = (res.tipo === 'nao-encontrada' || res.tipo === 'negado') ? res.pagina : undefined
    if (!id) return { res, html: null as string | null }
    const p = compilaPrograma(ctx.r, ctx.r.resolve('pagina', id)!.no)
    if (!p.ok) throw new Error('x')
    return { res, html: await textoDoStream((await renderPaginaStream(p.programa, COMPONENTES_BASE, { provedores: {}, tenant: { nome: 'Sol' } })).stream) }
  }
  const p = compilaPrograma(ctx.r, ctx.r.resolve('pagina', res.pagina)!.no)
  if (!p.ok) throw new Error(JSON.stringify(p.erros))
  const s = await renderPaginaStream(p.programa as Programa, COMPONENTES_BASE, {
    provedores: { servico: async (x) => ({ nome: `item-${String(x.args.id).slice(0, 4)}` }) }, params: res.params, tenant: { nome: 'Sol' }, idioma: res.idioma,
  })
  return { res, html: await textoDoStream(s.stream) }
}

describe('integração: requisição → rota → programa → HTML', () => {
  const ctx = loja()

  it('página no idioma padrão: layout, tenant e idioma no escopo, lang no documento', async () => {
    const { res, html } = await atende(ctx, '/')
    expect(res).toMatchObject({ tipo: 'pagina', pagina: 'home', idioma: 'pt-BR' })
    expect(html).toContain('<html lang="pt-BR">')
    expect(html).toContain('<h1>Sol</h1>')
    expect(html).toContain('<p>pág:home idioma:pt-BR</p>')
  })

  it('rota com parâmetro tipado, dado carregado com o parâmetro e idioma pelo prefixo', async () => {
    const pt = await atende(ctx, `/produtos/${U}`)
    expect(pt.html).toContain('produto:item-1111 (pt-BR)')
    const en = await atende(ctx, `/en/products/${U}`)
    expect(en.res).toMatchObject({ pagina: 'produto', idioma: 'en', canonica: `/en/products/${U}`, alternativas: { 'pt-BR': `/produtos/${U}`, en: `/en/products/${U}` } })
    expect(en.html).toContain('<html lang="en">')
    expect(en.html).toContain('produto:item-1111 (en)')
  })

  it('id que não é uuid: 404 e a página de 404 configurada é renderizada', async () => {
    const { res, html } = await atende(ctx, '/produtos/nao-e-uuid')
    expect(res).toMatchObject({ tipo: 'nao-encontrada', status: 404, pagina: 'nf' })
    expect(html).toContain('pág:nf')
  })

  it('redirecionamentos: antiga → nova (301), barra final (308) e idioma padrão explícito (308)', async () => {
    expect((await atende(ctx, `/p/${U}`)).res).toEqual({ tipo: 'redireciona', status: 301, para: `/produtos/${U}`, motivo: 'redirecionamento' })
    expect((await atende(ctx, '/produtos/', { consulta: 'a=1' })).res).toMatchObject({ status: 308, para: '/produtos?a=1' })
    expect((await atende(ctx, '/pt-BR/entrar')).res).toMatchObject({ status: 308, para: '/entrar' })
  })

  it('guarda: sem sessão vai ao login (com volta); sem permissão é 403 com página própria; com permissão renderiza', async () => {
    expect((await atende(ctx, '/admin')).res).toEqual({ tipo: 'redireciona', status: 302, para: '/entrar?volta=%2Fadmin', motivo: 'login' })
    expect((await atende(ctx, '/en/admin')).res).toMatchObject({ para: '/en/login?volta=%2Fen%2Fadmin' })
    const neg = await atende(ctx, '/admin', { sessao: { permissoes: [] } })
    expect(neg.res).toMatchObject({ tipo: 'negado', status: 403, pagina: 'negado' })
    expect(neg.html).toContain('pág:negado')
    expect((await atende(ctx, '/admin', { sessao: { permissoes: ['admin.ler'] } })).html).toContain('pág:admin')
  })

  it('o login localizado existe de fato: o redirecionamento leva a uma página que resolve', async () => {
    const r = resolveRota(ctx.tabela, { caminho: '/en/admin' })
    if (r.tipo !== 'redireciona') throw new Error('x')
    const alvo = new URL(r.para, 'http://x')
    expect(resolveRota(ctx.tabela, { caminho: alvo.pathname, consulta: alvo.search.slice(1) })).toMatchObject({ tipo: 'pagina', pagina: 'entrar', idioma: 'en' })
  })

  it('urlDe e resolveRota são inversos para as páginas reais', () => {
    const t: TabelaRotas = ctx.tabela
    for (const [pagina, params] of [['home', {}], ['produto', { id: U }], ['entrar', {}]] as const) {
      for (const idioma of t.idiomas) {
        const u = urlDe(t, pagina, params, { idioma })
        if (!u.ok) throw new Error(u.erro)
        expect(resolveRota(t, { caminho: u.url })).toMatchObject({ tipo: 'pagina', pagina, idioma })
      }
    }
  })
})
