import { Registry } from '@polaris/schema'
import { describe, expect, it } from 'vitest'
import { COMPONENTES_BASE, compilaPrograma, registraBase, renderPaginaHtml, type Programa } from '../src/index'

const no = (kind: string, id: string, spec: object) => ({ kind, id, versao: '1.0.0', estatuto: 'publicado', spec }) as any
const P = (b: string, extra: object = {}) => ({ bloco: b, ...extra })
let n = 0
const compila = (spec: object) => {
  const r = new Registry(); registraBase(r)
  return compilaPrograma(r, r.registra(no('pagina', `a${n++}`, { rota: '/', ...spec })))
}
const ok = (spec: object): Programa => { const r = compila(spec); if (!r.ok) throw new Error(JSON.stringify(r.erros, null, 1)); return r.programa }
const html = (pg: Programa, estado: Record<string, unknown>) => renderPaginaHtml({ programa: pg, componentes: COMPONENTES_BASE, estado }).corpo

const estado = { n: { tipo: 'inteiro', inicial: 0 }, itens: { tipo: 'json', inicial: [] }, nome: { tipo: 'texto', inicial: '' } }
const v = (nome: string) => ({ var: nome })
const campo = (de: object, nome: string) => ({ campo: nome, de })
const chama = (c: string, ...args: object[]) => ({ chama: c, args })
const lit = (x: unknown) => ({ lit: x })

describe('AST canônico no lugar do texto: mesma página, mesmo IR, mesma saída', () => {
  const texto = () => ok({ estado, raiz: P('layout/pilha', { slots: { filhos: [
    P('texto/paragrafo', { se: 'estado.n > 1', props: { texto: 'maior' } }),
    P('texto/paragrafo', { repetir: { cada: 'estado.itens', como: 'p', chave: 'p.id' }, props: { texto: '{p.nome | maiusculas}-{indice}' } }),
  ] } }) })
  const ast = () => ok({ estado, raiz: P('layout/pilha', { slots: { filhos: [
    P('texto/paragrafo', { se: chama('>', campo(v('estado'), 'n'), lit(1)), props: { texto: 'maior' } }),
    P('texto/paragrafo', { repetir: { cada: campo(v('estado'), 'itens'), como: 'p', chave: campo(v('p'), 'id') }, props: { texto: { $expr: chama('+', chama('+', chama('maiusculas', campo(v('p'), 'nome')), lit('-')), chama('texto', v('indice'))) } } }),
  ] } }) })

  it('o IR das expressões é idêntico (sem posições) e a renderização também', () => {
    const a = texto(), b = ast()
    const e = (x: Programa) => JSON.parse(JSON.stringify(x.pagina.raiz, (k, val) => (k === 'pos' || k === 'fonte' || k === 'caminho' ? undefined : val)))
    const ra = e(a), rb = e(b)
    expect(rb.slots.filhos[0].se).toEqual(ra.slots.filhos[0].se)
    expect(rb.slots.filhos[1].repetir).toEqual(ra.slots.filhos[1].repetir)
    for (const est of [{}, { n: 5, itens: [{ id: 1, nome: 'a' }, { id: 2, nome: 'b<' }] }]) expect(html(b, est)).toBe(html(a, est))
  })

  it('definir com AST em ação de evento', () => {
    const pg = ok({ estado, raiz: P('nav/botao', { props: { texto: 'x' }, eventos: { aoClicar: [{ acao: 'definir', estado: 'n', valor: chama('+', campo(v('estado'), 'n'), lit(1)) }] } }) })
    const acao = (pg.pagina.raiz as any).eventos.aoClicar[0]
    expect(acao.fonte).toBe('estado.n + 1') // o texto canônico vai para depuração
    expect(acao.valor.t).toBe('bin')
  })

  it('erros: apontam o caminho JSON DENTRO do AST, com dica; escopo e funções são checados como no texto', () => {
    const r = compila({ estado, raiz: P('texto/paragrafo', { se: chama('>', { var: 'a-b' }, lit(1)), props: { texto: 'x' } }) })
    expect(!r.ok && r.erros.map((e) => `${e.caminho} ${e.regra}`)).toEqual(['/spec/raiz/se/args/0/var expressao'])
    expect(!r.ok && r.erros[0]!.mensagem).toContain('nome de variável inválido')

    const r2 = compila({ estado, raiz: P('texto/paragrafo', { se: chama('>', campo(v('estdo'), 'n'), lit(1)), props: { texto: 'x' } }) })
    expect(!r2.ok && r2.erros[0]).toMatchObject({ caminho: '/spec/raiz/se', regra: 'binding' })
    expect(!r2.ok && r2.erros[0]!.dica).toContain("quis dizer 'estado'")
    expect(!r2.ok && r2.erros[0]!.mensagem).not.toContain('posição')

    const r3 = compila({ estado, raiz: P('texto/paragrafo', { se: chama('naoexiste', lit(1)), props: { texto: 'x' } }) })
    expect(!r3.ok && r3.erros[0]!.mensagem).toContain("a função 'naoexiste' não existe")

    const r4 = compila({ estado, raiz: P('texto/paragrafo', { props: { texto: { $expr: lit(-5) } } }) })
    expect(!r4.ok && r4.erros[0]).toMatchObject({ caminho: '/spec/raiz/props/texto/$expr/lit', regra: 'expressao' })
  })

  it('o schema do registro aceita texto OU AST em `se` e recusa o resto com mensagem útil', () => {
    const r = new Registry(); registraBase(r)
    expect(() => r.registra(no('pagina', 'ok1', { rota: '/', raiz: P('texto/paragrafo', { se: { var: 'x' } }) }))).not.toThrow()
    expect(() => r.registra(no('pagina', 'ruim', { rota: '/', raiz: P('texto/paragrafo', { se: 5 }) }))).toThrow()
    expect(() => r.registra(no('pagina', 'ruim2', { rota: '/', raiz: P('texto/paragrafo', { se: { vr: 'x' } }) }))).toThrow(/quis dizer 'var'|não existe/)
    expect(() => r.registra(no('pagina', 'ruim3', { rota: '/', raiz: P('texto/paragrafo', { se: 5 }) }))).toThrow(/texto|objeto/)
  })
})
