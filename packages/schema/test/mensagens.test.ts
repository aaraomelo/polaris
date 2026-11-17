import { describe, expect, it } from 'vitest'
import { criaValidador, formataErros, sugere, type Erro } from '../src/index'

const valida = criaValidador()
const erros = (d: unknown): Erro[] => {
  const r = valida(d)
  if (r.ok) throw new Error('esperava inválido')
  return r.erros
}
const env = (kind: string, spec: object, extra: object = {}) => ({ kind, id: 'x', versao: '1.0.0', spec, ...extra })

describe('sugere (quis dizer)', () => {
  it('acha o mais próximo e ignora o distante', () => {
    expect(sugere('pagna', ['pagina', 'bloco', 'tema'])).toBe('pagina')
    expect(sugere('servco', ['servico', 'evento'])).toBe('servico')
    expect(sugere('banana', ['pagina', 'bloco', 'tema'])).toBeNull()
  })
})

describe('mensagens acionáveis', () => {
  it('campo obrigatório ausente: diz qual e onde adicionar', () => {
    const [e] = erros(env('pagina', { raiz: { bloco: 'a/b' } }))
    expect(e).toMatchObject({ regra: 'required', caminho: '/spec' })
    expect(e!.mensagem).toBe("falta o campo obrigatório 'rota'")
    expect(e!.dica).toContain('"rota"')
  })

  it('enum com typo no kind sugere o valor certo', () => {
    const [e] = erros(env('pagna', {}))
    expect(e).toMatchObject({ regra: 'enum', caminho: '/kind', valor: 'pagna' })
    expect(e!.dica).toBe("quis dizer 'pagina'?")
    expect(e!.mensagem).toContain("aceitos: 'pagina'")
  })

  it('enum sem parecido não inventa sugestão, mas lista as opções', () => {
    const [e] = erros(env('tenant', { alias: 'a', segmento: 'jardinagem' }))
    expect(e!.dica).toBeUndefined()
    expect(e!.mensagem).toContain("'varejo'")
  })

  it('campo desconhecido no envelope: aponta o campo e sugere o nome certo', () => {
    const e = erros(env('tema', { tokens: {} }, { estatuo: 'publicado' })).find((x) => x.regra === 'unevaluatedProperties')!
    expect(e.caminho).toBe('/estatuo')
    expect(e.mensagem).toBe("o campo 'estatuo' não existe aqui")
    expect(e.dica).toBe("quis dizer 'estatuto'?")
  })

  it('campo desconhecido sem parecido lista os válidos (faces do Tiffany)', () => {
    const e = erros(env('tema', { tokens: {} }, { faces: {} }))[0]!
    expect(e.dica).toMatch(/campos válidos: .*kind/)
  })

  it('campo desconhecido dentro da spec do kind', () => {
    const [e] = erros(env('pagina', { rota: '/', raiz: { bloco: 'a/b' }, titulu: 'x' }))
    expect(e).toMatchObject({ caminho: '/spec/titulu' })
    expect(e!.dica).toBe("quis dizer 'titulo'?")
  })

  it('padrões conhecidos explicam o formato esperado', () => {
    const dica = (d: unknown) => erros(d).find((x) => x.regra === 'pattern')!.dica
    expect(dica({ ...env('tema', { tokens: {} }), id: 'Tema Base' })).toMatch(/minúsculas.*tema\.base/)
    expect(dica({ ...env('tema', { tokens: {} }), versao: '1.0' })).toMatch(/MAJOR\.MINOR\.PATCH/)
    expect(dica(env('pagina', { rota: 'home', raiz: { bloco: 'a/b' } }))).toMatch(/começar com '\/'/)
    expect(dica(env('evento', { nome: 'PedidoCriado', payload: {} }))).toMatch(/pedido\.criado/)
    expect(dica(env('tenant', { alias: '-ruim-', segmento: 'varejo' }))).toMatch(/padaria-sol/)
    expect(dica(env('pagina', { rota: '/', raiz: { bloco: 'Layout Pilha' } }))).toMatch(/commerce\/vitrine/)
  })

  it('tipo errado diz esperado e recebido em pt-BR', () => {
    const [e] = erros(env('pagina', { rota: 42, raiz: { bloco: 'a/b' } }))
    expect(e!.mensagem).toBe('esperado texto, recebido número')
  })

  it('tenantId + segmento explica a exclusividade', () => {
    const e = erros(env('tema', { tokens: {} }, { tenantId: 'a', segmento: 'varejo' })).find((x) => x.regra === 'not')!
    expect(e.dica).toContain('OU')
  })

  it('const e minItems/minProperties têm mensagem própria', () => {
    const c = erros(env('bloco', { interface: 'a/b', props: { type: 'string' } })).find((x) => x.regra === 'const')!
    expect(c.mensagem).toBe('deve ser exatamente "object"')
  })

  it('não duplica e não vaza o ruído do "if"', () => {
    const es = erros(env('pagina', { raiz: { bloco: 'a/b' } }))
    expect(es.some((e) => e.regra === 'if')).toBe(false)
    expect(new Set(es.map((e) => `${e.caminho}|${e.regra}|${e.mensagem}`)).size).toBe(es.length)
  })

  it('formataErros gera texto legível com a dica', () => {
    const t = formataErros(erros(env('pagna', {})))
    expect(t).toMatch(/^• \/kind: valor "pagna" não é permitido/)
    expect(t).toContain("→ quis dizer 'pagina'?")
  })
})
