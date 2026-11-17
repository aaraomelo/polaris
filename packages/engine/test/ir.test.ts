import { Registry } from '@polaris/schema'
import { describe, expect, it } from 'vitest'
import { compilaBloco, compilaPagina, registraNativos, type IRElemento, type IRSlot } from '../src/index'

const no = (kind: string, id: string, spec: object, extra: object = {}) => ({ kind, id, versao: '1.0.0', estatuto: 'publicado', spec, ...extra }) as any
const bloco = (iface: string, spec: object = {}) => no('bloco', iface.replace('/', '.'), { interface: iface, ...spec })
const P = (b: string, extra: object = {}) => ({ bloco: b, ...extra })

const monta = () => {
  const r = new Registry()
  registraNativos(r)
  r.registra(bloco('layout/pilha', { slots: { filhos: {} } }))
  r.registra(bloco('texto/titulo', { props: { type: 'object', properties: { texto: { type: 'string' }, nivel: { type: 'integer' }, extra: { type: 'object' }, tags: { type: 'array' } } } }))
  r.registra(bloco('commerce/cartao', {
    props: { type: 'object', properties: { titulo: { type: 'string' } }, required: ['titulo'] },
    slots: { rodape: {}, acoes: {} },
    modelo: P('layout/pilha', { slots: { filhos: [
      P('texto/titulo', { props: { texto: '{props.titulo | maiusculas}' } }),
      P('core/slot', { props: { nome: 'rodape' } }),
    ] } }),
  }))
  r.registra(bloco('x/codigo', { codigo: { linguagem: 'js', fonte: 'export default 1' } }))
  r.registra(no('servico', 'catalogo', { entidades: {}, operacoes: {} }))
  r.registra(no('dados', 'dados.loja', { fonte: { tipo: 'servico', servico: 'catalogo', operacao: 'obter' } }))
  r.registra(no('dados', 'dados.produtos', { fonte: { tipo: 'servico', servico: 'catalogo', operacao: 'listar' } }))
  return r
}
let n = 0
const pagina = (raiz: object, extra: object = {}) => no('pagina', `p${n++}`, { rota: '/', dados: { loja: 'dados.loja', produtos: 'dados.produtos' }, raiz, ...extra })
const compila = (raiz: object, extra: object = {}, r = monta()) => compilaPagina(r, r.registra(pagina(raiz, extra)))
const ok = (res: ReturnType<typeof compila>) => { if (!res.ok) throw new Error(JSON.stringify(res.erros, null, 1)); return res.ir }
const falha = (res: ReturnType<typeof compila>) => { if (res.ok) throw new Error('esperava erros'); return res.erros }

describe('compilaPagina — IR', () => {
  it('estrutura, caminhos e classificação dos blocos', () => {
    const ir = ok(compila(P('layout/pilha', { id: 'topo', slots: { filhos: [P('commerce/cartao', { props: { titulo: 'Oi' } }), P('x/codigo'), P('texto/titulo', { props: { texto: 'a' } })] } })))
    expect(ir).toMatchObject({ tipo: 'pagina', rota: '/', dados: { loja: 'dados.loja', produtos: 'dados.produtos' } })
    const raiz = ir.raiz as IRElemento
    expect(raiz).toMatchObject({ tipo: 'elemento', id: 'topo', caminho: '/spec/raiz', bloco: { interface: 'layout/pilha', impl: 'nativo' } })
    const [cartao, codigo, titulo] = raiz.slots.filhos as IRElemento[]
    expect(cartao).toMatchObject({ caminho: '/spec/raiz/slots/filhos/0', bloco: { impl: 'composto' } })
    expect(codigo!.bloco.impl).toBe('codigo')
    expect(titulo!.bloco.impl).toBe('nativo')
  })

  it('valores: literal, expr tipada, template, objeto e lista', () => {
    const ir = ok(compila(P('texto/titulo', { props: {
      texto: 'Olá {loja.nome}!', nivel: '{params.n}', extra: { a: 1, b: '{loja.x}', c: [true, null, 'x'] }, tags: ['{loja.a}', 'fixo'],
    } })))
    const p = (ir.raiz as IRElemento).props
    expect(p.texto).toMatchObject({ t: 'tpl' })
    expect(p.nivel).toMatchObject({ t: 'expr', fonte: 'params.n' })
    expect(p.extra).toMatchObject({ t: 'obj', campos: { a: { t: 'lit', v: 1 }, b: { t: 'expr' }, c: { t: 'arr', itens: [{ t: 'lit', v: true }, { t: 'lit', v: null }, { t: 'lit', v: 'x' }] } } })
    expect(p.tags).toMatchObject({ t: 'arr', itens: [{ t: 'expr' }, { t: 'lit', v: 'fixo' }] })
  })

  it('título é template; rota e dados vão para o IR', () => {
    const ir = ok(compila(P('layout/pilha'), { titulo: '{loja.nome} · Início' }))
    expect(ir.titulo).toMatchObject({ t: 'tpl' })
  })

  it('se e repetir: expressões puras; como/indice valem para props e filhos, não para se/cada', () => {
    const ir = ok(compila(P('layout/pilha', { slots: { filhos: [
      P('texto/titulo', {
        se: 'produtos.length > 0', repetir: { cada: 'produtos', como: 'produto' },
        props: { texto: '{produto.nome} #{indice}' },
      }),
    ] } })))
    const t = (ir.raiz as IRElemento).slots.filhos![0] as IRElemento
    expect(t.se).toBeDefined()
    expect(t.repetir).toMatchObject({ como: 'produto' })
    expect(t.props.texto).toMatchObject({ t: 'tpl' })
  })

  it('usa: só variáveis do escopo realmente referenciadas, sem repetidos', () => {
    const ir = ok(compila(P('layout/pilha', { slots: { filhos: [
      P('texto/titulo', { props: { texto: '{loja.nome}' }, repetir: { cada: 'produtos', como: 'p' } }),
      P('texto/titulo', { props: { texto: '{loja.slogan} {params.id}' } }),
    ] } })))
    expect(ir.usa).toEqual(['loja', 'params', 'produtos'])
  })

  it('o IR é serializável em JSON (pode ser cacheado/enviado)', () => {
    const ir = ok(compila(P('texto/titulo', { props: { texto: 'Olá {loja.nome | maiusculas}' } })))
    expect(() => JSON.parse(JSON.stringify(ir))).not.toThrow()
  })
})

describe('compilaPagina — erros', () => {
  it('variável desconhecida: caminho, "quis dizer" e posição', () => {
    const e = falha(compila(P('texto/titulo', { props: { texto: 'Olá {lja.nome}' } })))
    expect(e).toHaveLength(1)
    expect(e[0]).toMatchObject({ caminho: '/spec/raiz/props/texto', regra: 'binding', dica: "quis dizer 'loja'?" })
    expect(e[0]!.mensagem).toContain("'lja'")
    expect(e[0]!.mensagem).toContain('posição 5')
  })

  it('função desconhecida e aridade', () => {
    const e = falha(compila(P('layout/pilha', { slots: { filhos: [
      P('texto/titulo', { props: { texto: '{loja.nome | maiuscula}' } }),
      P('texto/titulo', { props: { texto: '{tamanho(loja.a, 1)}' } }),
    ] } })))
    expect(e.map((x) => x.regra)).toEqual(['binding', 'binding'])
    expect(e[0]!.dica).toBe("quis dizer 'maiusculas'?")
    expect(e[1]!.mensagem).toContain('recebe 1 argumento')
  })

  it('template malformado', () => {
    const e = falha(compila(P('texto/titulo', { props: { texto: 'Olá {loja.nome' } })))
    expect(e[0]).toMatchObject({ caminho: '/spec/raiz/props/texto', regra: 'template' })
  })

  it('erro de sintaxe na expressão do binding e em se/cada', () => {
    const e = falha(compila(P('texto/titulo', { se: 'produtos >', repetir: { cada: 'produtos +', como: 'p' }, props: { texto: '{loja.nome *}' } })))
    expect(e.map((x) => x.caminho).sort()).toEqual(['/spec/raiz/props/texto', '/spec/raiz/repetir/cada', '/spec/raiz/se'])
  })

  it('o alias do repetir não vale em se/cada, e some fora do elemento', () => {
    const e = falha(compila(P('layout/pilha', { slots: { filhos: [
      P('texto/titulo', { se: 'produto.ativo', repetir: { cada: 'produtos', como: 'produto' }, props: { texto: '{produto.nome}' } }),
      P('texto/titulo', { props: { texto: '{produto.nome}' } }),
    ] } })))
    expect(e.map((x) => x.caminho)).toEqual(['/spec/raiz/slots/filhos/0/se', '/spec/raiz/slots/filhos/1/props/texto'])
  })

  it('repetir aninhado enxerga o alias de fora; repetir que sobrescreve é erro', () => {
    ok(compila(P('layout/pilha', { slots: { filhos: [
      P('layout/pilha', { repetir: { cada: 'produtos', como: 'produto' }, slots: { filhos: [
        P('texto/titulo', { repetir: { cada: 'produto.tags', como: 'tag' }, props: { texto: '{produto.nome}/{tag}/{indice}' } }),
      ] } }),
    ] } })))
    const e = falha(compila(P('layout/pilha', { repetir: { cada: 'produtos', como: 'loja' }, slots: { filhos: [P('texto/titulo')] } })))
    expect(e[0]).toMatchObject({ regra: 'repetir', caminho: '/spec/raiz/repetir/como' })
    const e2 = falha(compila(P('layout/pilha', { repetir: { cada: 'produtos', como: 'indice' } })))
    expect(e2[0]!.regra).toBe('repetir')
  })

  it('título com variável inexistente', () => {
    const e = falha(compila(P('layout/pilha'), { titulo: '{naoexiste}' }))
    expect(e[0]).toMatchObject({ caminho: '/spec/titulo', regra: 'binding' })
  })

  it('core/slot em página é erro', () => {
    const e = falha(compila(P('core/slot', { props: { nome: 'x' } })))
    expect(e.some((x) => x.regra === 'slot-nativo' && x.mensagem.includes('dentro do modelo'))).toBe(true)
  })

  it('inclui os erros do registry e da estrutura (ref, slot, props, ids)', () => {
    const e = falha(compila(P('layout/pilha', { id: 'a', slots: { filhos: [P('nao/existe'), P('texto/titulo', { id: 'a', props: { nivell: 1 } })], rodape: [] } })))
    const regras = e.map((x) => x.regra)
    expect(regras).toEqual(expect.arrayContaining(['ref', 'id-unico', 'props', 'slot']))
  })

  it('nunca lança por conteúdo inválido, mesmo com tudo errado junto', () => {
    expect(() => compila(P('nao/existe', { se: '@@', repetir: { cada: '(', como: 'x' }, props: { a: '{' } }))).not.toThrow()
  })

  it('kind errado', () => {
    const r = monta()
    const res = compilaPagina(r, r.registra(no('tema', 't', { tokens: {} })))
    expect(res.ok).toBe(false)
  })
})

describe('compilaBloco', () => {
  it('compila o modelo com escopo props/tenant e core/slot', () => {
    const r = monta()
    const res = compilaBloco(r, 'commerce/cartao')
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.ir).toMatchObject({ tipo: 'bloco', interface: 'commerce/cartao', usa: ['props'] })
    const raiz = res.ir.modelo as IRElemento
    const slot = raiz.slots.filhos![1] as IRSlot
    expect(slot).toMatchObject({ tipo: 'slot', nome: 'rodape', caminho: '/spec/modelo/slots/filhos/1' })
  })

  it('no modelo não se enxerga dados da página (encapsulamento)', () => {
    const r = monta()
    r.registra(bloco('x/vaza', { modelo: P('texto/titulo', { props: { texto: '{loja.nome}' } }) }))
    const res = compilaBloco(r, 'x/vaza')
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.erros[0]).toMatchObject({ regra: 'binding', dica: 'variáveis disponíveis: props, tenant' })
  })

  it('core/slot com slot não declarado sugere o nome certo', () => {
    const r = monta()
    r.registra(bloco('x/slot-ruim', { slots: { rodape: {} }, modelo: P('layout/pilha', { slots: { filhos: [P('core/slot', { props: { nome: 'rodpe' } })] } }) }))
    const res = compilaBloco(r, 'x/slot-ruim')
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.erros.find((e) => e.regra === 'slot-nativo')).toMatchObject({ dica: "quis dizer 'rodape'?" })
  })

  it('core/slot sem nome', () => {
    const r = monta()
    r.registra(bloco('x/slot-sem-nome', { modelo: P('layout/pilha', { slots: { filhos: [P('core/slot')] } }) }))
    const res = compilaBloco(r, 'x/slot-sem-nome')
    expect(res.ok).toBe(false)
  })

  it('bloco nativo, de código ou inexistente: erro claro', () => {
    const r = monta()
    const nativo = compilaBloco(r, 'layout/pilha')
    expect(nativo.ok).toBe(false)
    if (!nativo.ok) expect(nativo.erros[0]!.dica).toContain('nativo')
    const cod = compilaBloco(r, 'x/codigo')
    if (!cod.ok) expect(cod.erros[0]!.dica).toContain('sandbox')
    expect(compilaBloco(r, 'nada/nada').ok).toBe(false)
  })

  it('bloco que herda o modelo do pai compila', () => {
    const r = monta()
    r.registra(bloco('commerce/cartao-pro', { extends: 'commerce/cartao' }))
    expect(compilaBloco(r, 'commerce/cartao-pro').ok).toBe(true)
  })
})
