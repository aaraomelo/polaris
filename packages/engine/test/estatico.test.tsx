import { Registry } from '@polaris/schema'
import { describe, expect, it } from 'vitest'
import {
  COMPONENTES_BASE, EMISSORES_BASE, compilaEstatico, compilaPrograma, documentoEstatico, registraBase, renderPaginaHtml, type ErroRuntime, type Programa,
} from '../src/index'

const no = (kind: string, id: string, spec: object) => ({ kind, id, versao: '1.0.0', estatuto: 'publicado', spec }) as any
const P = (b: string, extra: object = {}) => ({ bloco: b, ...extra })

function monta(extra?: (r: Registry) => void) {
  const r = new Registry()
  registraBase(r)
  r.registra(no('servico', 'catalogo', { entidades: {}, operacoes: {} }))
  r.registra(no('dados', 'd.loja', { fonte: { tipo: 'servico', servico: 'catalogo', operacao: 'loja' } }))
  r.registra(no('dados', 'd.lento', { fonte: { tipo: 'servico', servico: 'catalogo', operacao: 'lento' } }))
  r.registra(no('bloco', 'x.cartao', {
    interface: 'x/cartao', slots: { rodape: {}, extra: {} }, props: { type: 'object', properties: { titulo: { type: 'string' }, preco: { type: 'number' }, id: { type: 'integer' } } },
    modelo: P('layout/pilha', { props: { gap: 4 }, slots: { filhos: [
      P('texto/titulo', { props: { texto: '{props.titulo}', nivel: 3 } }),
      P('texto/paragrafo', { se: 'props.preco != null', props: { texto: '{props.preco | brl}' } }),
      P('core/slot', { props: { nome: 'rodape' } }),
    ] } }),
  }))
  r.registra(no('bloco', 'x.moldura', { interface: 'x/moldura', slots: { conteudo: {} }, modelo: P('layout/linha', { slots: { filhos: [P('texto/paragrafo', { props: { texto: '[moldura]' } }), P('core/slot', { props: { nome: 'conteudo' } })] } }) }))
  r.registra(no('bloco', 'x.aninhado', { interface: 'x/aninhado', slots: { corpo: {} }, modelo: P('x/moldura', { slots: { conteudo: [P('texto/paragrafo', { props: { texto: 'dentro' } }), P('core/slot', { props: { nome: 'corpo' } })] } }) }))
  r.registra(no('bloco', 'x.lista', { interface: 'x/lista', props: { type: 'object', properties: { itens: { type: 'array' } } }, modelo: P('layout/pilha', { slots: { filhos: [P('texto/paragrafo', { repetir: { cada: 'props.itens', como: 'i' }, props: { texto: '{indice}:{i}' } })] } }) }))
  r.registra(no('bloco', 'layout.site', { interface: 'layout/site', slots: { conteudo: {} }, props: { type: 'object', properties: { nome: { type: 'string' } } }, modelo: P('layout/pilha', { slots: { filhos: [P('texto/titulo', { props: { texto: '{props.nome}' } }), P('core/slot', { props: { nome: 'conteudo' } })] } }) }))
  extra?.(r)
  return r
}
let n = 0
function programa(raiz: object, extra: object = {}, r = monta()): Programa {
  const res = compilaPrograma(r, r.registra(no('pagina', `p${n++}`, { rota: '/', raiz, ...extra })))
  if (!res.ok) throw new Error(JSON.stringify(res.erros, null, 1))
  return res.programa
}
const DADOS = { loja: { nome: "Padaria <Sol> & \"Filhos\" d'Ouro", itens: ['a', 'b&c', "d'e"], url: '/p?a=1&b=2', ext: 'https://exemplo.com/x?y=1&z=2', ruim: 'javascript:alert(1)', vazia: [], zero: 0, str: '', cheia: [0] }, produtos: [{ id: 1, nome: 'pão', preco: 5.5 }, { id: 2, nome: '<b>bolo</b>', preco: 1234.5 }, { id: 3, nome: "x'y", preco: null }] }

/** O mesmo programa e a mesma entrada pelos DOIS caminhos: o HTML precisa ser idêntico, byte a byte. */
function igual(pg: Programa, entrada: Record<string, unknown> = {}) {
  const est = compilaEstatico(pg)
  if (!est.ok) throw new Error('não é estático: ' + JSON.stringify(est.motivos))
  const a = est.pagina.render(entrada)
  const react = renderPaginaHtml({ programa: pg, componentes: COMPONENTES_BASE, ...entrada })
  expect(a.corpo).toBe(react.corpo)
  expect(a.titulo).toBe(react.titulo)
  return a
}
const D = { dados: DADOS }

describe('caminho estático: saída idêntica à do React', () => {
  it('blocos base: pilha/linha (gap 0, fracionário, alinha), título (nível), parágrafo, id com caracteres especiais', () => {
    for (const alinha of [undefined, 'inicio', 'centro', 'fim', 'esticar']) {
      const pg = programa(P('layout/pilha', { id: 'a"b<c', props: { gap: '{params.g}', ...(alinha ? { alinha } : {}) }, slots: { filhos: [P('layout/linha', { props: { gap: '{params.g}' }, slots: { filhos: [P('texto/paragrafo', { props: { texto: 'x' } })] } })] } }))
      for (const g of [undefined, 0, 4, 0.5, 12, 1e3]) igual(pg, { params: { g } })
    }
    const pgn = programa(P('texto/titulo', { id: 't', props: { texto: '{loja.nome}', nivel: '{params.n}' } }), { dados: { loja: 'd.loja' } })
    for (const n of [undefined, 0, 1, 3, 6, 9, 2.7, -1, 1e9]) igual(pgn, { ...D, params: { n } }) // o nível é limitado a 1–6 nos dois caminhos
    igual(programa(P('texto/paragrafo', { id: 'p1', props: { texto: '' } })))
  })

  it('texto com & < > " \' e entidades, NBSP, quebra de linha, unicode e emoji', () => {
    igual(programa(P('texto/paragrafo', { props: { texto: 'a&b<c>d"e\'f g\n\t ç日😀 &amp; &lt;' } })))
    igual(programa(P('texto/paragrafo', { props: { texto: '{loja.nome}' } }), { dados: { loja: 'd.loja' } }), D)
  })

  it('se (verdadeiro, falso, ausente, lista vazia) e repetir (aninhado, indice, não-lista, vazio, objetos)', () => {
    const raiz = P('layout/pilha', { slots: { filhos: [
      P('texto/paragrafo', { se: 'loja.nome', props: { texto: 'tem nome' } }),
      P('texto/paragrafo', { se: 'loja.nada', props: { texto: 'nunca' } }),
      P('texto/paragrafo', { se: 'produtos.length > 5', props: { texto: 'nunca2' } }),
      P('texto/paragrafo', { se: 'loja.vazia', props: { texto: 'lista vazia é falsa' } }),
      P('texto/paragrafo', { se: 'loja.zero', props: { texto: 'zero é falso' } }),
      P('texto/paragrafo', { se: 'loja.str', props: { texto: 'vazio é falso' } }),
      P('texto/paragrafo', { se: 'loja.cheia', props: { texto: 'lista com [0] é verdadeira' } }),
      P('texto/paragrafo', { repetir: { cada: 'loja.itens', como: 'i' }, props: { texto: '{indice}={i}' } }),
      P('layout/pilha', { repetir: { cada: 'produtos', como: 'p' }, slots: { filhos: [P('texto/titulo', { props: { texto: '{p.nome}', nivel: 4 } }), P('texto/paragrafo', { repetir: { cada: 'loja.itens', como: 'j' }, props: { texto: '{p.id}-{j}-{indice}' } })] } }),
      P('texto/paragrafo', { repetir: { cada: 'loja', como: 'x' }, props: { texto: 'não é lista' } }),
      P('texto/paragrafo', { se: 'loja.nome', repetir: { cada: 'produtos', como: 'p' }, props: { texto: '{p.nome}' } }),
    ] } })
    igual(programa(raiz, { dados: { loja: 'd.loja', produtos: 'd.lento' } }), D)
    igual(programa(raiz, { dados: { loja: 'd.loja', produtos: 'd.lento' } }), { dados: {} }) // dados ausentes
  })

  it('blocos compostos: props tipadas, se dentro do modelo, slots, composto dentro de composto, host encadeado, repetir no modelo', () => {
    const raiz = P('layout/pilha', { slots: { filhos: [
      P('x/cartao', { repetir: { cada: 'produtos', como: 'p' }, props: { titulo: '{p.nome}', preco: '{p.preco}', id: '{p.id}' }, slots: { rodape: [P('texto/paragrafo', { props: { texto: 'do host: {loja.nome} #{indice} {p.id}' } })] } }),
      P('x/aninhado', { slots: { corpo: [P('texto/paragrafo', { props: { texto: 'passou pelo host' } })] } }),
      P('x/lista', { props: { itens: '{loja.itens}' } }),
      P('x/cartao', { props: { titulo: 'sem slot' } }),
    ] } })
    igual(programa(raiz, { dados: { loja: 'd.loja', produtos: 'd.lento' } }), D)
  })

  it('layout (com layoutProps), idioma, estado inicial, status e erros no escopo, título com template', () => {
    const pg = programa(P('texto/paragrafo', { props: { texto: 'idioma={idioma} estado={estado.t} status={status.loja} erro={erros.loja} t={tenant.nome} q={consulta.q} id={params.id}' } }),
      { layout: 'layout/site', layoutProps: { nome: '{tenant.nome}' }, titulo: 'T: {loja.nome} ({idioma})', estado: { t: { tipo: 'texto', inicial: "i'n<i>" } }, dados: { loja: 'd.loja' } })
    igual(pg, { ...D, idioma: 'en', tenant: { nome: 'Sol & Cia' }, consulta: { q: 'a&b' }, params: { id: '7' }, status: { loja: 'erro' }, erros: { loja: 'falha <x>' } })
  })

  it('link (relativo, externo com rel, javascript:, texto vs filhos) e imagem (válida, URL insegura, com/sem tamanho)', () => {
    const raiz = P('layout/pilha', { slots: { filhos: [
      P('nav/link', { id: 'l1', props: { href: '{loja.url}', texto: 'rel & "x"' } }),
      P('nav/link', { props: { href: '{loja.ext}', texto: 'ext' } }),
      P('nav/link', { props: { href: '{loja.ruim}', texto: 'perigoso' } }),
      P('nav/link', { props: { href: '/f' }, slots: { filhos: [P('texto/paragrafo', { props: { texto: 'dentro do link' } })] } }),
      P('midia/imagem', { id: 'i1', props: { src: '{loja.ext}', alt: 'a "b" <c>', largura: 10, altura: 5 } }),
      P('midia/imagem', { props: { src: '{loja.ruim}', alt: 'x' } }),
      P('midia/imagem', { props: { src: '/img.png' } }),
    ] } })
    igual(programa(raiz, { dados: { loja: 'd.loja' } }), D)
  })

  it('props de tipos variados vindas de bindings (número que vira nível, objeto em template, ausente)', () => {
    igual(programa(P('texto/titulo', { props: { texto: 'x{loja}y{loja.nada}z', nivel: '{params.n}' } }), { dados: { loja: 'd.loja' } }), { ...D, params: { n: 4 } })
    igual(programa(P('texto/titulo', { props: { texto: '{params.n}', nivel: '{params.n}' } })), { params: { n: '3' } })
  })

  it('FUZZ: texto, atributos e URLs aleatórios e hostis dão a mesma saída nos dois caminhos', () => {
    let s = 17
    const rnd = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff)
    const alfabeto = ['a', 'Z', '0', ' ', '&', '<', '>', '"', "'", ' ', '\n', '\t', 'ç', '日', '😀', ' ', '\\', '/', ':', 'javascript:', 'https://x.com/', '?x=1&y=2', '%20', '#', '{', '}', '`', '${x}', '</script>', '<!--', '&amp;', '\u0000']
    const lixo = () => Array.from({ length: Math.floor(rnd() * 10) }, () => alfabeto[Math.floor(rnd() * alfabeto.length)]).join('')
    const pg = programa(P('layout/pilha', { id: '{params.a}', slots: { filhos: [
      P('texto/titulo', { id: 'tt', props: { texto: '{params.a}', nivel: 2 } }),
      P('texto/paragrafo', { props: { texto: 'pre {params.b} pos' } }),
      P('nav/link', { id: 'ln', props: { href: '{params.c}', texto: '{params.a}' } }),
      P('midia/imagem', { props: { src: '{params.c}', alt: '{params.b}', largura: 3 } }),
      P('x/cartao', { props: { titulo: '{params.a}' }, slots: { rodape: [P('texto/paragrafo', { props: { texto: '{params.b}' } })] } }),
    ] } }), { titulo: '{params.a}' })
    for (let i = 0; i < 400; i++) igual(pg, { params: { a: lixo(), b: lixo(), c: lixo() } })
  })

  it('o limite de 1000 iterações: trunca e avisa, igual ao React', () => {
    const pg = programa(P('layout/pilha', { slots: { filhos: [P('texto/paragrafo', { repetir: { cada: 'produtos', como: 'p' }, props: { texto: '{p.id}' } })] } }), { dados: { produtos: 'd.lento' } })
    const grande = { dados: { produtos: Array.from({ length: 1500 }, (_, i) => ({ id: i })) } }
    const avisosEst: ErroRuntime[] = [], avisosReact: ErroRuntime[] = []
    const est = compilaEstatico(pg)
    if (!est.ok) throw new Error('x')
    const a = est.pagina.render({ ...grande, onErro: (e) => avisosEst.push(e) })
    const react = renderPaginaHtml({ programa: pg, componentes: COMPONENTES_BASE, ...grande, onErro: (e) => avisosReact.push(e) })
    expect(a.corpo).toBe(react.corpo)
    expect(a.corpo.match(/<p>/g)).toHaveLength(1000)
    expect(avisosEst).toEqual(avisosReact)
    expect(avisosEst[0]).toMatchObject({ regra: 'limite', caminho: '/spec/raiz/slots/filhos/0' })
  })
})

describe('caminho estático: quando NÃO se aplica (precisa de JavaScript no cliente)', () => {
  const motivos = (pg: Programa) => { const r = compilaEstatico(pg); if (r.ok) throw new Error('devia recusar'); return r.motivos }

  it('eventos, bloco interativo, streaming, esqueleto, bloco de código e bloco sem emissor', () => {
    expect(motivos(programa(P('nav/botao', { props: { texto: 'x' }, eventos: { aoClicar: [{ acao: 'navegar', para: '/x' }] } }))).map((m) => m.motivo).join(' | ')).toMatch(/interativo|eventos/)
    expect(motivos(programa(P('entrada/texto', { props: { valor: '' } })))[0]!.motivo).toContain('interativo')
    expect(motivos(programa(P('texto/paragrafo', { props: { texto: '{lento.x}' }, esqueleto: P('texto/paragrafo', { props: { texto: 'e' } }) }), { dados: { lento: { dados: 'd.lento', stream: true } } })).some((m) => /streaming/.test(m.motivo))).toBe(true)
    const r = monta((reg) => {
      reg.registra(no('bloco', 'x.cod', { interface: 'x/cod', codigo: { linguagem: 'js', fonte: 'function render(){ return "x" }' } }))
      reg.registra(no('bloco', 'x.novo', { interface: 'x/novo' }))
    })
    expect(motivos(programa(P('x/cod'), {}, r))[0]!.motivo).toContain('código customizado')
    expect(motivos(programa(P('x/novo'), {}, r))[0]!.motivo).toContain('não tem emissor estático')
  })

  it('um bloco interativo ou com evento dentro do modelo de um bloco composto também torna a página não-estática', () => {
    const r = monta((reg) => reg.registra(no('bloco', 'x.com-botao', { interface: 'x/com-botao', modelo: P('layout/pilha', { slots: { filhos: [P('nav/botao', { props: { texto: 'x' } })] } }) })))
    expect(motivos(programa(P('x/com-botao'), {}, r))[0]!.motivo).toContain('interativo')
  })

  it('os motivos trazem o caminho do nó e são todos reportados de uma vez', () => {
    const m = motivos(programa(P('layout/pilha', { slots: { filhos: [P('entrada/texto', { props: { valor: '' } }), P('nav/botao', { props: { texto: 'x' } })] } })))
    expect(m.map((x) => x.caminho)).toEqual(['/spec/raiz/slots/filhos/0', '/spec/raiz/slots/filhos/1'])
  })

  it('um emissor próprio torna o bloco elegível (a extensão do caminho estático)', () => {
    const r = monta((reg) => reg.registra(no('bloco', 'x.selo', { interface: 'x/selo', props: { type: 'object', properties: { t: { type: 'string' } } } })))
    const pg = programa(P('x/selo', { props: { t: 'a<b' } }), {}, r)
    const emissores = { ...EMISSORES_BASE, 'x/selo': ({ props }: { props: Record<string, unknown> }) => `<i>${String(props.t).replace(/</g, '&lt;')}</i>` }
    const est = compilaEstatico(pg, emissores)
    expect(est.ok && est.pagina.render().corpo).toBe('<i>a&lt;b</i>')
  })
})

describe('segurança do código gerado', () => {
  it('texto do usuário (em literais, props e dados) nunca vira código: só aparece dentro de literais JSON', () => {
    const veneno = '"); process.exit(1); //' + ' ' + '`+process.exit(2)+`' + "'" + '</script>'
    const idVeneno = veneno + '${process.exit(3)}' // o id não é template: aceita chaves
    const pg = programa(P('texto/paragrafo', { id: idVeneno, props: { texto: `${veneno} {loja.nome}` } }), { titulo: veneno, dados: { loja: 'd.loja' } })
    const est = compilaEstatico(pg)
    if (!est.ok) throw new Error('x')
    const r = est.pagina.render({ dados: { loja: { nome: veneno } } }) // se virasse código, o processo morreria aqui
    expect(r.corpo).toContain('&quot;); process.exit(1); //')
    const fora = est.pagina.fonte.replace(/"(?:[^"\\]|\\.)*"/g, '""')
    expect(fora).not.toContain('process')
    expect(fora).not.toContain('</script>')
  })

  it('uma chave __proto__ nas props não polui o protótipo (fica como propriedade própria)', () => {
    const r = monta((reg) => reg.registra(no('bloco', 'x.livre', { interface: 'x/livre', props: { type: 'object', additionalProperties: true } })))
    const pg = programa(P('x/livre'), {}, r)
    // IR montada à mão com uma chave perigosa (JSON.parse cria __proto__ como propriedade própria)
    const raiz = pg.pagina.raiz as any
    raiz.props = JSON.parse('{"__proto__":{"t":"lit","v":"pwn"},"normal":{"t":"lit","v":"ok"}}')
    let visto: Record<string, unknown> = {}
    const est = compilaEstatico(pg, { ...EMISSORES_BASE, 'x/livre': ({ props }: { props: Record<string, unknown> }) => { visto = props; return '' } })
    expect(est.ok).toBe(true)
    if (est.ok) est.pagina.render()
    expect(({} as Record<string, unknown>).t).toBeUndefined()
    expect(Object.getPrototypeOf(visto)).toBe(Object.prototype)
    expect(Object.prototype.hasOwnProperty.call(visto, '__proto__')).toBe(true)
    expect(visto.normal).toBe('ok')
  })

  it('o resultado é memoizado por programa e emissores', () => {
    const pg = programa(P('texto/paragrafo', { props: { texto: 'x' } }))
    const a = compilaEstatico(pg), b = compilaEstatico(pg)
    expect(a.ok && b.ok && a.pagina.fonte === b.pagina.fonte).toBe(true)
  })
})

describe('documento estático: zero JavaScript', () => {
  it('sem <script>, sem estado de hidratação, sem contêiner; título e lang escapados', () => {
    const doc = documentoEstatico({ corpo: '<p>oi</p>', titulo: '</title><script>x</script>', lang: 'pt"BR' })
    expect(doc).not.toMatch(/<script/)
    expect(doc).not.toContain('__POLARIS__')
    expect(doc).not.toContain('id="polaris"')
    expect(doc).toContain('<title>&lt;/title&gt;&lt;script&gt;x&lt;/script&gt;</title>')
    expect(doc).toContain('lang="pt&quot;BR"')
    expect(doc.endsWith('<body><p>oi</p></body></html>')).toBe(true)
  })
})
