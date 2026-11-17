import { Registry } from '@polaris/schema'
import { describe, expect, it } from 'vitest'
import { compilaPagina, registraBase, type IRElemento } from '../src/index'

const no = (kind: string, id: string, spec: object, extra: object = {}) => ({ kind, id, versao: '1.0.0', estatuto: 'publicado', spec, ...extra }) as any
const P = (b: string, extra: object = {}) => ({ bloco: b, ...extra })
const U = '11111111-1111-1111-1111-111111111111'

const monta = () => {
  const r = new Registry()
  registraBase(r)
  r.registra(no('bloco', 'x.sem-eventos', { interface: 'x/sem-eventos' }))
  r.registra(no('bloco', 'x.cartao', { interface: 'x/cartao', modelo: P('layout/pilha') }))
  r.registra(no('servico', 'catalogo', { entidades: {}, operacoes: {} }))
  r.registra(no('dados', 'd.prod', { fonte: { tipo: 'servico', servico: 'catalogo', operacao: 'listar' }, parametros: { q: { tipo: 'texto' }, pagina: { tipo: 'inteiro' }, id: { tipo: 'uuid', obrigatorio: true } } }))
  r.registra(no('dados', 'd.loja', { fonte: { tipo: 'servico', servico: 'catalogo', operacao: 'obter' } }))
  r.registra(no('dados', 'd.salvar', { fonte: { tipo: 'servico', servico: 'catalogo', operacao: 'salvar' }, carregar: 'manual', parametros: { nome: { tipo: 'texto', obrigatorio: true } } }))
  return r
}
let n = 0
const compila = (spec: object) => {
  const r = monta()
  return compilaPagina(r, r.registra(no('pagina', `p${n++}`, { rota: '/', ...spec })))
}
const ok = (res: ReturnType<typeof compila>) => { if (!res.ok) throw new Error(JSON.stringify(res.erros, null, 1)); return res.ir }
const falha = (res: ReturnType<typeof compila>) => { if (res.ok) throw new Error('esperava erros'); return res.erros }
const botao = (eventos: object, extra: object = {}) => P('nav/botao', { props: { texto: 'ok' }, eventos, ...extra })
const raizCom = (...filhos: object[]) => P('layout/pilha', { slots: { filhos } })

describe('estado', () => {
  it('declara estado com valor inicial; vai para o IR e para o escopo', () => {
    const ir = ok(compila({
      estado: { termo: { tipo: 'texto', inicial: 'pão' }, pagina: { tipo: 'inteiro', inicial: 1 }, vazio: { tipo: 'texto' }, tags: { tipo: 'texto', lista: true, inicial: ['a'] } },
      raiz: P('texto/paragrafo', { props: { texto: '{estado.termo} {estado.pagina}' } }),
    }))
    expect(ir.estado).toEqual({ termo: { tipo: 'texto', inicial: 'pão' }, pagina: { tipo: 'inteiro', inicial: 1 }, vazio: { tipo: 'texto', inicial: null }, tags: { tipo: 'texto', inicial: ['a'], lista: true } })
    expect(ir.usa).toContain('estado')
  })

  it('valor inicial do tipo errado e nome reservado são erros', () => {
    const e = falha(compila({ estado: { n: { tipo: 'inteiro', inicial: 'x' }, params: { tipo: 'texto' } }, raiz: P('layout/pilha') }))
    expect(e.map((x) => x.caminho).sort()).toEqual(['/spec/estado/n/inicial', '/spec/estado/params'])
  })

  it('variável de estado inexistente em binding sugere o escopo', () => {
    const e = falha(compila({ raiz: P('texto/paragrafo', { props: { texto: '{estdo.x}' } }) }))
    expect(e[0]).toMatchObject({ regra: 'binding', dica: "quis dizer 'estado'?" })
  })
})

describe('dados com argumentos', () => {
  it('forma curta e forma com args; fontes embutidas no IR', () => {
    const ir = ok(compila({
      dados: { loja: 'd.loja', prods: { dados: 'd.prod', args: { id: '{params.id}', q: 'fixo', pagina: 2 } } },
      raiz: P('layout/pilha'),
    }))
    expect(ir.dados.loja).toEqual({ id: 'd.loja', args: {}, stream: false })
    expect(ir.dados.prods!.args.q).toEqual({ t: 'lit', v: 'fixo' })
    expect(ir.dados.prods!.args.id).toMatchObject({ t: 'expr', fonte: 'params.id' })
    expect(ir.fontes['d.prod']).toMatchObject({ id: 'd.prod', carregar: 'auto', fonte: { tipo: 'servico', operacao: 'listar' } })
    expect(Object.keys(ir.fontes['d.prod']!.parametros)).toEqual(['q', 'pagina', 'id'])
  })

  it('arg desconhecido sugere o nome; literal do tipo errado é erro', () => {
    const e = falha(compila({ dados: { p: { dados: 'd.prod', args: { id: U, pagna: 1, q: 5 } } }, raiz: P('layout/pilha') }))
    expect(e).toHaveLength(2)
    expect(e.find((x) => x.caminho.endsWith('/pagna'))).toMatchObject({ regra: 'dados-arg', dica: "quis dizer 'pagina'?" })
    expect(e.find((x) => x.caminho.endsWith('/q'))!.mensagem).toContain('deveria ser texto')
  })

  it('obrigatório ausente numa fonte automática é erro de compilação; em fonte manual não', () => {
    const e = falha(compila({ dados: { p: 'd.prod' }, raiz: P('layout/pilha') }))
    expect(e[0]!.mensagem).toContain("falta o argumento obrigatório 'id'")
    ok(compila({ dados: { salvar: 'd.salvar' }, raiz: P('layout/pilha') }))
  })

  it('os args de dados veem params/consulta/tenant/estado, mas NÃO outros dados nem status', () => {
    ok(compila({ estado: { t: { tipo: 'texto' } }, dados: { p: { dados: 'd.prod', args: { id: U, q: '{estado.t}{consulta.x}{tenant.id}{params.y}' } } }, raiz: P('layout/pilha') }))
    const e = falha(compila({ dados: { loja: 'd.loja', p: { dados: 'd.prod', args: { id: U, q: '{loja.nome}' } } }, raiz: P('layout/pilha') }))
    expect(e[0]).toMatchObject({ regra: 'binding' })
    expect(falha(compila({ dados: { p: { dados: 'd.prod', args: { id: U, q: '{status.p}' } } }, raiz: P('layout/pilha') }))[0]!.regra).toBe('binding')
  })

  it('referência a dados inexistente (forma objeto) aponta o caminho do campo dados', () => {
    const e = falha(compila({ dados: { p: { dados: 'd.nada' } }, raiz: P('layout/pilha') }))
    expect(e[0]).toMatchObject({ regra: 'ref', caminho: '/spec/dados/p/dados' })
  })

  it('status e erros entram no escopo (carregando/erro na UI)', () => {
    const ir = ok(compila({ dados: { loja: 'd.loja' }, raiz: P('layout/pilha', { slots: { filhos: [P('texto/paragrafo', { se: "status.loja == 'carregando'", props: { texto: '{erros.loja}' } })] } }) }))
    expect(ir.usa).toEqual(expect.arrayContaining(['erros', 'status']))
  })

  it('nomes reservados (inclui estado, status, erros) não podem ser variável de dados', () => {
    for (const nome of ['estado', 'status', 'erros', 'params', 'evento']) {
      const e = falha(compila({ dados: { [nome]: 'd.loja' }, raiz: P('layout/pilha') }))
      expect(e.some((x) => x.regra === 'dados' && x.caminho === `/spec/dados/${nome}`), nome).toBe(true)
    }
  })
})

describe('eventos e ações', () => {
  const base = { estado: { termo: { tipo: 'texto', inicial: '' }, pagina: { tipo: 'inteiro', inicial: 1 } }, dados: { prods: { dados: 'd.prod', args: { id: U } }, salvar: 'd.salvar' } }

  it('compila definir/executar/navegar com o escopo certo (evento, resultado, erro)', () => {
    const ir = ok(compila({ ...base, raiz: raizCom(botao({ aoClicar: [
      { acao: 'definir', estado: 'pagina', valor: 'estado.pagina + 1' },
      { acao: 'executar', dados: 'prods', args: { q: '{estado.termo}' }, depois: [{ acao: 'definir', estado: 'termo', valor: 'resultado.length' }, { acao: 'navegar', para: '/p/{estado.pagina}' }], emErro: [{ acao: 'definir', estado: 'termo', valor: 'erro' }] },
    ] })) }))
    const b = (ir.raiz as IRElemento).slots.filhos![0] as IRElemento
    const [def, exe] = b.eventos!.aoClicar!
    expect(def).toMatchObject({ acao: 'definir', estado: 'pagina', caminho: '/spec/raiz/slots/filhos/0/eventos/aoClicar/0' })
    expect(exe).toMatchObject({ acao: 'executar', dados: 'prods' })
    if (exe!.acao === 'executar') { expect(exe.depois).toHaveLength(2); expect(exe.emErro).toHaveLength(1) }
  })

  it('evento aceito sem estado nem dados declarados só vale se as ações não os referenciarem', () => {
    ok(compila({ raiz: raizCom(botao({ aoClicar: [{ acao: 'navegar', para: '/x' }] })) }))
  })

  it('definir: estado inexistente sugere; expressão tem que existir no escopo', () => {
    const e = falha(compila({ ...base, raiz: raizCom(botao({ aoClicar: [{ acao: 'definir', estado: 'termos', valor: 'nada' }] })) }))
    expect(e.find((x) => x.regra === 'acao')).toMatchObject({ dica: "quis dizer 'termo'?" })
    expect(e.find((x) => x.regra === 'binding')!.mensagem).toContain("'nada'")
  })

  it('executar: dados inexistente sugere; arg desconhecido; obrigatório faltando (união declarado + evento)', () => {
    const e = falha(compila({ ...base, raiz: raizCom(botao({ aoClicar: [
      { acao: 'executar', dados: 'prod', args: {} },
      { acao: 'executar', dados: 'prods', args: { zzz: 1 } },
      { acao: 'executar', dados: 'salvar', args: {} },
    ] })) }))
    expect(e.find((x) => x.caminho.endsWith('/0/dados'))).toMatchObject({ regra: 'acao', dica: "quis dizer 'prods'?" })
    expect(e.find((x) => x.caminho.endsWith('/1/args/zzz'))).toMatchObject({ regra: 'dados-arg' })
    expect(e.find((x) => x.caminho.endsWith('/2'))!.mensagem).toContain("obrigatório 'nome'")
    // o id obrigatório de 'prods' já vem declarado na página: não é cobrado de novo no evento
    expect(e.filter((x) => x.mensagem.includes("'id'"))).toHaveLength(0)
  })

  it('executar manual com o argumento informado no evento passa', () => {
    ok(compila({ ...base, raiz: raizCom(botao({ aoClicar: [{ acao: 'executar', dados: 'salvar', args: { nome: '{estado.termo}' } }] })) }))
  })

  it('evento que o bloco não emite: sugere; bloco sem eventos lista nenhum', () => {
    const e1 = falha(compila({ ...base, raiz: raizCom(botao({ aoClick: [{ acao: 'navegar', para: '/x' }] })) }))
    expect(e1[0]).toMatchObject({ regra: 'evento', caminho: '/spec/raiz/slots/filhos/0/eventos/aoClick', dica: "quis dizer 'aoClicar'?" })
    const e2 = falha(compila({ ...base, raiz: raizCom(P('x/sem-eventos', { eventos: { aoClicar: [{ acao: 'navegar', para: '/x' }] } })) }))
    expect(e2[0]!.dica).toContain('eventos do bloco: nenhum')
  })

  it('o evento da entrada de texto enxerga `evento` (payload) e o alias do repetir', () => {
    ok(compila({
      ...base,
      dados: { ...base.dados, lista: 'd.loja' },
      raiz: raizCom(P('entrada/texto', { repetir: { cada: 'lista', como: 'item' }, eventos: { aoMudar: [{ acao: 'definir', estado: 'termo', valor: 'evento + item.nome' }] } })),
    }))
  })

  it('`resultado` só existe em depois; `erro` só em emErro; `evento` vale nos dois', () => {
    const e = falha(compila({ ...base, raiz: raizCom(botao({ aoClicar: [
      { acao: 'definir', estado: 'termo', valor: 'resultado' },
      { acao: 'executar', dados: 'prods', depois: [{ acao: 'definir', estado: 'termo', valor: 'erro' }], emErro: [{ acao: 'definir', estado: 'termo', valor: 'resultado' }] },
    ] })) }))
    expect(e.map((x) => x.caminho.replace('/spec/raiz/slots/filhos/0/eventos/aoClicar', '').replace('/valor', ''))).toEqual(['/0', '/1/depois/0', '/1/emErro/0'])
    ok(compila({ ...base, raiz: raizCom(botao({ aoClicar: [{ acao: 'executar', dados: 'prods', depois: [{ acao: 'definir', estado: 'termo', valor: 'evento + resultado.x' }], emErro: [{ acao: 'definir', estado: 'termo', valor: 'evento + erro' }] }] })) }))
  })

  it('limite de aninhamento e de quantidade de ações', () => {
    const fundo = (n: number): object => (n === 0 ? { acao: 'navegar', para: '/x' } : { acao: 'executar', dados: 'prods', depois: [fundo(n - 1)] })
    expect(falha(compila({ ...base, raiz: raizCom(botao({ aoClicar: [fundo(8)] })) })).some((x) => x.regra === 'acao-limite')).toBe(true)
    ok(compila({ ...base, raiz: raizCom(botao({ aoClicar: [fundo(3)] })) }))
    // 3 executar × (1 + 20 depois) = 63 ações num único evento, cada lista dentro do limite do schema (20)
    const vinte = Array.from({ length: 20 }, () => ({ acao: 'navegar', para: '/x' }))
    const exe = { acao: 'executar', dados: 'prods', depois: vinte }
    const e = falha(compila({ ...base, raiz: raizCom(botao({ aoClicar: [exe, exe, exe] })) }))
    expect(e.filter((x) => x.regra === 'acao-limite')).toHaveLength(1) // reportado uma vez
    expect(e.find((x) => x.regra === 'acao-limite')!.mensagem).toContain('mais de 50 ações')
  })

  it('eventos no modelo de um bloco são recusados (sem estado nem dados lá)', async () => {
    const { compilaBloco } = await import('../src/index')
    const r = monta()
    r.registra(no('bloco', 'x.com-evento', { interface: 'x/com-evento', modelo: P('nav/botao', { props: { texto: 'x' }, eventos: { aoClicar: [{ acao: 'navegar', para: '/x' }] } }) }))
    const res = compilaBloco(r, 'x/com-evento')
    expect(res.ok).toBe(false)
    if (!res.ok) expect(res.erros[0]).toMatchObject({ regra: 'evento', caminho: '/spec/modelo/eventos' })
  })
})
