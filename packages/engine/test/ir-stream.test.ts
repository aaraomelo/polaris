import { Registry } from '@polaris/schema'
import { describe, expect, it } from 'vitest'
import { compilaPagina, iniciaCargas, registraBase, type IRElemento } from '../src/index'
import { compilaPrograma } from '../src/index'

const no = (kind: string, id: string, spec: object) => ({ kind, id, versao: '1.0.0', estatuto: 'publicado', spec }) as any
const P = (b: string, extra: object = {}) => ({ bloco: b, ...extra })

const monta = () => {
  const r = new Registry()
  registraBase(r)
  r.registra(no('bloco', 'x.cartao', { interface: 'x/cartao', slots: { corpo: {} }, modelo: P('layout/pilha', { slots: { filhos: [P('core/slot', { props: { nome: 'corpo' } })] } }) }))
  r.registra(no('servico', 'catalogo', { entidades: {}, operacoes: {} }))
  for (const id of ['d.a', 'd.b', 'd.loja']) r.registra(no('dados', id, { fonte: { tipo: 'servico', servico: 'catalogo', operacao: id } }))
  r.registra(no('dados', 'd.manual', { fonte: { tipo: 'servico', servico: 'catalogo', operacao: 'm' }, carregar: 'manual' }))
  return r
}
let n = 0
const compila = (spec: object) => { const r = monta(); return compilaPagina(r, r.registra(no('pagina', `p${n++}`, { rota: '/', ...spec }))) }
const ok = (res: ReturnType<typeof compila>) => { if (!res.ok) throw new Error(JSON.stringify(res.erros, null, 1)); return res.ir }
const falha = (res: ReturnType<typeof compila>) => { if (res.ok) throw new Error('esperava erros'); return res.erros }
const dados = { loja: 'd.loja', a: { dados: 'd.a', stream: true }, b: { dados: 'd.b', stream: true } }
const filhos = (ir: { raiz: unknown }) => ((ir.raiz as IRElemento).slots.filhos ?? []) as IRElemento[]
const esq = P('texto/paragrafo', { props: { texto: 'carregando' } })

describe('fronteiras de streaming no IR', () => {
  it('marca o nó que usa o dado (props, se ou repetir.cada); pais e irmãos que não usam ficam de fora', () => {
    const ir = ok(compila({ dados, raiz: P('layout/pilha', { slots: { filhos: [
      P('texto/paragrafo', { props: { texto: 'fixo' } }),
      P('texto/paragrafo', { props: { texto: '{a.x}' }, esqueleto: esq }),
      P('texto/paragrafo', { se: 'a.ativo', props: { texto: 'x' }, esqueleto: esq }),
      P('texto/paragrafo', { repetir: { cada: 'a', como: 'i' }, props: { texto: '{i}' }, esqueleto: esq }),
      P('texto/paragrafo', { props: { texto: '{loja.nome}' } }),
    ] } }) }))
    expect((ir.raiz as IRElemento).aguarda).toBeUndefined()
    const [fixo, props, se, repetir, bloqueante] = filhos(ir)
    expect(fixo!.aguarda).toBeUndefined()
    expect(props!.aguarda).toEqual(['a'])
    expect(se!.aguarda).toEqual(['a'])
    expect(repetir!.aguarda).toEqual(['a'])
    expect(bloqueante!.aguarda).toBeUndefined() // dado bloqueante não cria fronteira
  })

  it('o nó mais externo que usa o dado é a fronteira; os descendentes que usam o MESMO dado não criam outra', () => {
    const ir = ok(compila({ dados, raiz: P('layout/pilha', { props: { gap: '{a.espaco}' }, esqueleto: esq, slots: { filhos: [
      P('texto/paragrafo', { props: { texto: '{a.x}' } }),
    ] } }) }))
    expect((ir.raiz as IRElemento).aguarda).toEqual(['a'])
    expect(filhos(ir)[0]!.aguarda).toBeUndefined()
  })

  it('descendente que usa OUTRO dado em streaming ganha a própria fronteira', () => {
    const ir = ok(compila({ dados, raiz: P('layout/pilha', { props: { gap: '{a.espaco}' }, esqueleto: esq, slots: { filhos: [
      P('texto/paragrafo', { props: { texto: '{a.x}' } }),
      P('texto/paragrafo', { props: { texto: '{b.y}' }, esqueleto: esq }),
    ] } }) }))
    expect((ir.raiz as IRElemento).aguarda).toEqual(['a'])
    expect(filhos(ir)[0]!.aguarda).toBeUndefined()
    expect(filhos(ir)[1]!.aguarda).toEqual(['b'])
  })

  it('um nó que usa dois dados em streaming espera pelos dois, em ordem estável', () => {
    const ir = ok(compila({ dados, raiz: P('texto/paragrafo', { props: { texto: '{b.y}{a.x}' }, esqueleto: esq }) }))
    expect((ir.raiz as IRElemento).aguarda).toEqual(['a', 'b'])
  })

  it('status, erros e eventos NÃO criam fronteira (só leitura direta do valor)', () => {
    const ir = ok(compila({ estado: { t: { tipo: 'texto' } }, dados, raiz: P('layout/pilha', { slots: { filhos: [
      P('texto/paragrafo', { props: { texto: '{status.a} {erros.a}' } }),
      P('nav/botao', { props: { texto: 'x' }, eventos: { aoClicar: [{ acao: 'definir', estado: 't', valor: 'a.nome' }] } }),
    ] } }) }))
    expect(filhos(ir).map((f) => f.aguarda)).toEqual([undefined, undefined])
  })

  it('o esqueleto é compilado no IR; o filho de um slot de bloco composto também pode ser fronteira', () => {
    const ir = ok(compila({ dados, raiz: P('x/cartao', { slots: { corpo: [P('texto/paragrafo', { props: { texto: '{a.x}' }, esqueleto: esq })] } }) }))
    const corpo = ((ir.raiz as IRElemento).slots.corpo as IRElemento[])[0]!
    expect(corpo.aguarda).toEqual(['a'])
    expect(corpo.esqueleto).toMatchObject({ tipo: 'elemento', caminho: '/spec/raiz/slots/corpo/0/esqueleto' })
  })

  it('o IR com fronteiras continua serializável', () => {
    const ir = ok(compila({ dados, raiz: P('texto/paragrafo', { props: { texto: '{a.x}' }, esqueleto: esq }) }))
    expect(JSON.parse(JSON.stringify(ir)).raiz.aguarda).toEqual(['a'])
  })
})

describe('erros de compilação do streaming', () => {
  it('o esqueleto não pode usar o dado que está esperando (nem outro em streaming)', () => {
    const e = falha(compila({ dados, raiz: P('texto/paragrafo', { props: { texto: '{a.x}' }, esqueleto: P('texto/paragrafo', { props: { texto: '{a.nome}{b.x}' } }) }) }))
    expect(e.length).toBeGreaterThanOrEqual(1)
    expect(e.every((x) => x.regra === 'binding' && x.caminho.includes('/esqueleto/props/texto'))).toBe(true)
  })

  it('o esqueleto PODE usar dado bloqueante e estado', () => {
    ok(compila({ dados, estado: { t: { tipo: 'texto', inicial: 'x' } }, raiz: P('texto/paragrafo', { props: { texto: '{a.x}' }, esqueleto: P('texto/paragrafo', { props: { texto: '{loja.nome} {estado.t}' } }) }) }))
  })

  it('esqueleto numa instância que não usa dado em streaming é erro (configuração morta)', () => {
    const e = falha(compila({ dados, raiz: P('texto/paragrafo', { props: { texto: 'fixo' }, esqueleto: esq }) }))
    expect(e[0]).toMatchObject({ regra: 'esqueleto', caminho: '/spec/raiz/esqueleto' })
    expect(e[0]!.dica).toContain('stream: true')
  })

  it('o título não pode depender de dado em streaming', () => {
    const e = falha(compila({ dados, titulo: '{loja.nome} {a.x}', raiz: P('layout/pilha') }))
    expect(e[0]).toMatchObject({ regra: 'titulo', caminho: '/spec/titulo' })
    expect(e[0]!.mensagem).toContain('(a)')
    ok(compila({ dados, titulo: '{loja.nome}', raiz: P('layout/pilha') }))
  })

  it('stream numa fonte manual não faz sentido', () => {
    const e = falha(compila({ dados: { m: { dados: 'd.manual', stream: true } }, raiz: P('layout/pilha') }))
    expect(e[0]).toMatchObject({ regra: 'dados', caminho: '/spec/dados/m' })
    expect(e[0]!.mensagem).toContain('manual')
  })

  it('o esqueleto também é validado como instância (bloco inexistente)', () => {
    const e = falha(compila({ dados, raiz: P('texto/paragrafo', { props: { texto: '{a.x}' }, esqueleto: P('nao/existe') }) }))
    expect(e.some((x) => x.caminho.includes('/esqueleto') && x.regra === 'ref')).toBe(true)
  })
})

describe('iniciaCargas', () => {
  it('inicia tudo já: bloqueantes agregadas, em streaming soltas; manuais não são carregadas', async () => {
    const r = monta()
    const res = compilaPrograma(r, r.registra(no('pagina', 'pc', { rota: '/', dados: { loja: 'd.loja', a: { dados: 'd.a', stream: true }, m: 'd.manual' }, raiz: P('layout/pilha') })))
    if (!res.ok) throw new Error('x')
    const ops: string[] = []
    const c = iniciaCargas(res.programa, { provedores: { servico: async (p) => { ops.push(p.operacao); return p.operacao } } })
    expect(Object.keys(c.stream)).toEqual(['a'])
    expect((await c.bloqueantes).dados).toEqual({ loja: 'd.loja' })
    expect(await c.stream.a).toEqual({ ok: true, valor: 'd.a' })
    expect(ops.sort()).toEqual(['d.a', 'd.loja']) // d.manual nunca foi chamada
  })

  it('a promessa de streaming nunca rejeita (falha vira { ok: false })', async () => {
    const r = monta()
    const res = compilaPrograma(r, r.registra(no('pagina', 'pc2', { rota: '/', dados: { a: { dados: 'd.a', stream: true } }, raiz: P('layout/pilha') })))
    if (!res.ok) throw new Error('x')
    const c = iniciaCargas(res.programa, { provedores: { servico: async () => { throw new Error('x') } } })
    await expect(c.stream.a).resolves.toMatchObject({ ok: false })
  })
})
