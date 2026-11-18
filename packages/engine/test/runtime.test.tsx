import { Registry } from '@polaris/schema'
import { describe, expect, it } from 'vitest'
import {
  COMPONENTES_BASE, compilaPrograma, registraBase, renderPaginaHtml, tituloDaPagina, urlSegura, type ErroRuntime, type Programa,
} from '../src/index'

const no = (kind: string, id: string, spec: object, extra: object = {}) => ({ kind, id, versao: '1.0.0', estatuto: 'publicado', spec, ...extra }) as any
const bloco = (iface: string, spec: object = {}) => no('bloco', iface.replace('/', '.'), { interface: iface, ...spec })
const P = (b: string, extra: object = {}) => ({ bloco: b, ...extra })

const monta = () => {
  const r = new Registry()
  registraBase(r)
  r.registra(bloco('commerce/cartao', {
    props: { type: 'object', properties: { titulo: { type: 'string' }, destaque: { type: 'boolean' } }, required: ['titulo'] },
    slots: { rodape: {} },
    modelo: P('layout/pilha', { props: { gap: 4 }, slots: { filhos: [
      P('texto/titulo', { props: { texto: '{props.titulo | maiusculas}', nivel: 2 } }),
      P('core/slot', { props: { nome: 'rodape' } }),
    ] } }),
  }))
  r.registra(bloco('commerce/cartao-pro', { extends: 'commerce/cartao' }))
  r.registra(bloco('commerce/lista', {
    props: { type: 'object', properties: { itens: { type: 'array' } } },
    modelo: P('layout/pilha', { slots: { filhos: [P('commerce/cartao', { repetir: { cada: 'props.itens', como: 'item' }, props: { titulo: '{item.nome}' } })] } }),
  }))
  r.registra(bloco('x/estende-pilha', { extends: 'layout/pilha' }))
  r.registra(bloco('x/sem-componente', {}))
  r.registra(no('servico', 'catalogo', { entidades: {}, operacoes: {} }))
  r.registra(no('dados', 'dados.loja', { fonte: { tipo: 'servico', servico: 'catalogo', operacao: 'obter' } }))
  r.registra(no('dados', 'dados.produtos', { fonte: { tipo: 'servico', servico: 'catalogo', operacao: 'listar' } }))
  return r
}
let n = 0
const programa = (raiz: object, extra: object = {}, r = monta()): Programa => {
  const p = r.registra(no('pagina', `p${n++}`, { rota: '/', titulo: '{loja.nome} · Início', dados: { loja: 'dados.loja', produtos: 'dados.produtos' }, raiz, ...extra }))
  const res = compilaPrograma(r, p)
  if (!res.ok) throw new Error(JSON.stringify(res.erros, null, 1))
  return res.programa
}
const dados = { loja: { nome: 'Padaria Sol', slogan: 'Pão quente' }, produtos: [{ nome: 'pão' }, { nome: 'bolo' }] }
const ssr = (pg: Programa, extra: object = {}) => renderPaginaHtml({ programa: pg, componentes: COMPONENTES_BASE, dados, ...extra })

describe('SSR: página completa', () => {
  it('documento, título avaliado, corpo e estado de hidratação', () => {
    const s = ssr(programa(P('layout/pilha', { slots: { filhos: [P('texto/titulo', { props: { texto: 'Olá, {loja.nome}!' } })] } })))
    expect(s.titulo).toBe('Padaria Sol · Início')
    expect(s.html).toMatch(/^<!doctype html><html lang="pt-BR"><head><meta charset="utf-8">/)
    expect(s.html).toContain('<title>Padaria Sol · Início</title>')
    expect(s.corpo).toBe('<div style="display:flex;flex-direction:column"><h1>Olá, Padaria Sol!</h1></div>')
    expect(s.html).toContain(`<div id="polaris">${s.corpo}</div>`)
    expect(s.estado.dados).toEqual(dados)
  })

  it('é determinístico', () => {
    const pg = programa(P('layout/pilha', { slots: { filhos: [P('texto/paragrafo', { props: { texto: '{loja.slogan}' } })] } }))
    expect(ssr(pg).html).toBe(ssr(pg).html)
  })

  it('o programa é JSON puro: ida e volta renderiza igual', () => {
    const pg = programa(P('commerce/lista', { props: { itens: '{produtos}' } }))
    const volta = JSON.parse(JSON.stringify(pg)) as Programa
    expect(ssr(volta).html).toBe(ssr(pg).html)
  })
})

describe('tipos, ausência e escopo', () => {
  it('expr mantém o tipo (nivel numérico vira h3) e template vira texto', () => {
    const s = ssr(programa(P('texto/titulo', { props: { texto: 'x', nivel: '{params.nivel}' } })), { params: { nivel: 3 } })
    expect(s.corpo).toBe('<h3>x</h3>')
  })

  it('dado ausente renderiza vazio, sem quebrar', () => {
    const s = ssr(programa(P('texto/titulo', { props: { texto: 'a{loja.inexistente.x}b' } })), { dados: {} })
    expect(s.corpo).toBe('<h1>ab</h1>')
  })

  it('só entram no escopo os dados declarados em spec.dados', () => {
    const s = ssr(programa(P('texto/titulo', { props: { texto: '[{loja.nome}]' } })), { dados: { loja: { nome: 'A' }, segredo: { nome: 'VAZOU' } } })
    expect(s.corpo).toBe('<h1>[A]</h1>')
    expect(JSON.stringify(s.estado.dados)).toContain('VAZOU') // o estado é do chamador; o ESCOPO é que não vê
    expect(s.corpo).not.toContain('VAZOU')
  })

  it('nome de dados que existe em Object.prototype não puxa a função (toString, valueOf, hasOwnProperty)', () => {
    const r = monta()
    r.registra(no('dados', 'dados.x', { fonte: { tipo: 'servico', servico: 'catalogo', operacao: 'x' } }))
    const pg = (() => {
      const p = r.registra(no('pagina', 'pp', { rota: '/', dados: { toString: 'dados.x', valueOf: 'dados.x', hasOwnProperty: 'dados.x' }, raiz: P('texto/paragrafo', { props: { texto: '[{toString}][{valueOf}][{hasOwnProperty}]' } }) }))
      const res = compilaPrograma(r, p)
      if (!res.ok) throw new Error(JSON.stringify(res.erros))
      return res.programa
    })()
    expect(ssr(pg, { dados: {} }).corpo).toBe('<p>[][][]</p>')
  })

  it('objetos em template viram vazio (nunca [object Object])', () => {
    expect(ssr(programa(P('texto/titulo', { props: { texto: 'x{loja}y' } }))).corpo).toBe('<h1>xy</h1>')
  })

  it('tituloDaPagina usa o mesmo escopo', () => {
    const pg = programa(P('layout/pilha'))
    expect(tituloDaPagina({ programa: pg, componentes: COMPONENTES_BASE, dados })).toBe('Padaria Sol · Início')
  })
})

describe('se e repetir', () => {
  it('se falso não renderiza; verdadeiro renderiza', () => {
    const pg = programa(P('layout/pilha', { slots: { filhos: [
      P('texto/paragrafo', { se: 'produtos.length > 5', props: { texto: 'muitos' } }),
      P('texto/paragrafo', { se: 'produtos.length > 1', props: { texto: 'alguns' } }),
    ] } }))
    expect(ssr(pg).corpo).toBe('<div style="display:flex;flex-direction:column"><p>alguns</p></div>')
  })

  it('repetir com alias, indice e se guardando o laço inteiro', () => {
    const pg = programa(P('layout/pilha', { slots: { filhos: [
      P('texto/paragrafo', { repetir: { cada: 'produtos', como: 'p' }, props: { texto: '{indice}:{p.nome}' } }),
      P('texto/paragrafo', { se: 'produtos.length > 9', repetir: { cada: 'produtos', como: 'p' }, props: { texto: 'nunca' } }),
    ] } }))
    expect(ssr(pg).corpo).toBe('<div style="display:flex;flex-direction:column"><p>0:pão</p><p>1:bolo</p></div>')
  })

  it('repetir sobre algo que não é lista rende nada; repetir aninhado enxerga o alias de fora', () => {
    const pg = programa(P('layout/pilha', { slots: { filhos: [
      P('layout/pilha', { repetir: { cada: 'produtos', como: 'a' }, slots: { filhos: [P('texto/paragrafo', { repetir: { cada: 'produtos', como: 'b' }, props: { texto: '{a.nome}/{b.nome}' } })] } }),
      P('texto/paragrafo', { repetir: { cada: 'loja', como: 'x' }, props: { texto: 'não' } }),
    ] } }))
    const corpo = ssr(pg).corpo
    expect(corpo).toContain('<p>pão/pão</p><p>pão/bolo</p>')
    expect(corpo).toContain('<p>bolo/pão</p><p>bolo/bolo</p>')
    expect(corpo).not.toContain('não')
  })

  it('limite de iterações: trunca e avisa', () => {
    const erros: ErroRuntime[] = []
    const muitos = Array.from({ length: 1500 }, (_, i) => ({ nome: String(i) }))
    const pg = programa(P('layout/pilha', { slots: { filhos: [P('texto/paragrafo', { repetir: { cada: 'produtos', como: 'p' }, props: { texto: '{p.nome}' } })] } }))
    const s = ssr(pg, { dados: { produtos: muitos }, onErro: (e: ErroRuntime) => erros.push(e) })
    expect(s.corpo.match(/<p>/g)).toHaveLength(1000)
    expect(erros[0]).toMatchObject({ regra: 'limite' })
  })
})

describe('blocos compostos e slots', () => {
  it('modelo do bloco recebe props e projeta o slot do host', () => {
    const pg = programa(P('commerce/cartao', { props: { titulo: 'pão' }, slots: { rodape: [P('texto/paragrafo', { props: { texto: 'de {loja.nome}' } })] } }))
    expect(ssr(pg).corpo).toBe('<div style="display:flex;flex-direction:column;gap:4px"><h2>PÃO</h2><p>de Padaria Sol</p></div>')
  })

  it('os filhos do slot são avaliados no escopo do HOST, não no do bloco', () => {
    // dentro do modelo só existe `props`; o filho do slot enxerga `loja` e o alias do repetir de fora
    const pg = programa(P('layout/pilha', { slots: { filhos: [
      P('commerce/cartao', { repetir: { cada: 'produtos', como: 'p' }, props: { titulo: '{p.nome}' }, slots: { rodape: [P('texto/paragrafo', { props: { texto: '{p.nome}@{loja.nome}' } })] } }),
    ] } }))
    const c = ssr(pg).corpo
    expect(c).toContain('<h2>PÃO</h2><p>pão@Padaria Sol</p>')
    expect(c).toContain('<h2>BOLO</h2><p>bolo@Padaria Sol</p>')
  })

  it('slot não preenchido renderiza vazio', () => {
    expect(ssr(programa(P('commerce/cartao', { props: { titulo: 'a' } }))).corpo).toBe('<div style="display:flex;flex-direction:column;gap:4px"><h2>A</h2></div>')
  })

  it('bloco composto dentro de bloco composto, com repetir no modelo', () => {
    const pg = programa(P('commerce/lista', { props: { itens: '{produtos}' } }))
    expect(Object.keys(pg.blocos).sort()).toEqual(['commerce/cartao', 'commerce/lista'])
    expect(ssr(pg).corpo).toContain('<h2>PÃO</h2>')
    expect(ssr(pg).corpo).toContain('<h2>BOLO</h2>')
  })

  it('bloco que herda o modelo do pai (extends) renderiza', () => {
    const pg = programa(P('commerce/cartao-pro', { props: { titulo: 'x' } }))
    expect(ssr(pg).corpo).toContain('<h2>X</h2>')
  })

  it('bloco sem implementação própria usa o componente do pai na cadeia', () => {
    expect(ssr(programa(P('x/estende-pilha', { slots: { filhos: [P('texto/paragrafo', { props: { texto: 'z' } })] } }))).corpo).toBe('<div style="display:flex;flex-direction:column"><p>z</p></div>')
  })

  it('props do bloco não vazam para o escopo da página nem o contrário', () => {
    const r = monta()
    r.registra(bloco('x/vaza', { modelo: P('texto/paragrafo', { props: { texto: '{props.titulo}{loja}' } }), props: { type: 'object', properties: { titulo: { type: 'string' } } } }))
    const res = compilaPrograma(r, r.registra(no('pagina', 'pv', { rota: '/', dados: { loja: 'dados.loja' }, raiz: P('x/vaza', { props: { titulo: 'a' } }) })))
    expect(res.ok).toBe(false) // `loja` não existe dentro do modelo
  })
})

describe('resiliência e erros de configuração', () => {
  it('componente ausente: avisa com o caminho e segue renderizando o resto', () => {
    const erros: ErroRuntime[] = []
    const pg = programa(P('layout/pilha', { slots: { filhos: [P('x/sem-componente'), P('texto/paragrafo', { props: { texto: 'resto' } })] } }))
    const s = ssr(pg, { onErro: (e: ErroRuntime) => erros.push(e) })
    expect(s.corpo).toContain('<p>resto</p>')
    expect(erros).toEqual([expect.objectContaining({ regra: 'componente-ausente', caminho: '/spec/raiz/slots/filhos/0' })])
  })

  it('bloco de código: avisa (sandbox ainda não disponível), não executa', () => {
    const r = monta()
    r.registra(bloco('x/codigo', { codigo: { linguagem: 'js', fonte: 'throw new Error("nao deve rodar")' } }))
    const erros: ErroRuntime[] = []
    const s = ssr(programa(P('x/codigo'), {}, r), { onErro: (e: ErroRuntime) => erros.push(e) })
    expect(s.corpo).toBe('')
    expect(erros[0]).toMatchObject({ regra: 'codigo' })
  })

  it('no servidor, componente que lança propaga o erro ao chamador (a página não sai pela metade)', () => {
    const boom = { ...COMPONENTES_BASE, 'texto/paragrafo': () => { throw new Error('quebrou') } }
    const pg = programa(P('texto/paragrafo', { props: { texto: 'x' } }))
    expect(() => renderPaginaHtml({ programa: pg, componentes: boom, dados })).toThrow(/quebrou/)
  })
})

describe('segurança do SSR', () => {
  it('texto vindo de dados é escapado', () => {
    const s = ssr(programa(P('texto/paragrafo', { props: { texto: '{loja.slogan}' } })), { dados: { loja: { slogan: '<img src=x onerror=alert(1)><script>x</script>' } } })
    expect(s.corpo).toBe('<p>&lt;img src=x onerror=alert(1)&gt;&lt;script&gt;x&lt;/script&gt;</p>')
  })

  it('o estado embutido não escapa do <script> (</script>, <!--, U+2028)', () => {
    const s = ssr(programa(P('texto/paragrafo', { props: { texto: 'a' } })), { dados: { loja: { nome: '</script><script>alert(1)</script><!--  ' } } })
    const trecho = s.html.slice(s.html.indexOf('id="__POLARIS__"'))
    expect(trecho.match(/<\/script>/g)).toHaveLength(1) // só o que fecha o próprio bloco de estado
    expect(s.html).not.toContain('<script>alert(1)')
    expect(JSON.parse(trecho.slice(trecho.indexOf('>') + 1, trecho.indexOf('</script>'))).dados.loja.nome).toBe('</script><script>alert(1)</script><!--  ')
  })

  it('título é escapado no <head>', () => {
    const s = ssr(programa(P('layout/pilha'), { titulo: '{loja.nome}' }), { dados: { loja: { nome: '</title><script>x</script>' } } })
    expect(s.html).toContain('<title>&lt;/title&gt;&lt;script&gt;x&lt;/script&gt;</title>')
  })

  it('urlSegura: bloqueia javascript:/data:/vbscript: (com truques de espaço) e aceita relativas e http(s)', () => {
    for (const u of ['javascript:alert(1)', ' JavaScript:alert(1)', 'java\nscript:alert(1)', 'java\tscript:x', 'data:text/html,<script>', 'vbscript:x', 'file:///etc/passwd', '\u0001javascript:x']) expect(urlSegura(u), JSON.stringify(u)).toBeUndefined()
    for (const u of ['/produtos', 'pagina', '#topo', 'https://a.com/x', 'HTTP://a.com', 'mailto:a@b.c', 'tel:+55', '//cdn.x/y.png']) expect(urlSegura(u), u).toBeDefined()
    expect(urlSegura(42)).toBeUndefined()
    expect(urlSegura('')).toBeUndefined()
  })

  it('link e imagem com URL perigosa não saem; link externo ganha rel', () => {
    const pg = programa(P('layout/pilha', { slots: { filhos: [
      P('nav/link', { props: { href: '{params.u}', texto: 'x' } }),
      P('midia/imagem', { props: { src: '{params.u}', alt: 'a' } }),
    ] } }))
    expect(ssr(pg, { params: { u: 'javascript:alert(1)' } }).corpo).toBe('<div style="display:flex;flex-direction:column"><a>x</a></div>')
    const ok = ssr(pg, { params: { u: 'https://a.com/i.png' } }).corpo
    expect(ok).toContain('<a href="https://a.com/i.png" rel="noopener noreferrer">x</a>')
    expect(ok).toContain('<img src="https://a.com/i.png" alt="a" loading="lazy" style="max-width:100%;height:auto"/>')
  })
})

describe('compilaPrograma', () => {
  it('erro de página volta como erros (sem lançar)', () => {
    const r = monta()
    const res = compilaPrograma(r, r.registra(no('pagina', 'pe', { rota: '/', raiz: P('texto/titulo', { props: { texto: '{nada}' } }) })))
    expect(res.ok).toBe(false)
  })
  it('erro em modelo de bloco usado volta com o nome do bloco', () => {
    const r = monta()
    r.registra(bloco('x/quebrado', { modelo: P('texto/paragrafo', { props: { texto: '{vazio}' } }) }))
    const res = compilaPrograma(r, r.registra(no('pagina', 'pq', { rota: '/', raiz: P('x/quebrado') })))
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.erros.some((e) => e.mensagem.startsWith("bloco 'x/quebrado':"))).toBe(true)
  })
})
