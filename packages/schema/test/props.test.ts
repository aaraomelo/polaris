import { describe, expect, it } from 'vitest'
import { Registry, confere, validaEstrutura, type No } from '../src/index'

const no = (kind: string, id: string, spec: object, extra: object = {}) => ({ kind, id, versao: '1.0.0', estatuto: 'publicado', spec, ...extra })
const bloco = (iface: string, spec: object = {}) => no('bloco', iface.replace('/', '.'), { interface: iface, ...spec })
let n = 0
const props = (r: Registry, raiz: object) => {
  const p = r.registra({ ...no('pagina', `p${n++}`, { rota: '/', raiz }) }) as No
  return validaEstrutura(r, p).filter((e) => e.regra === 'props')
}

const monta = () => {
  const r = new Registry()
  r.registra(bloco('texto/titulo', {
    props: { type: 'object', properties: { texto: { type: 'string' }, nivel: { type: 'integer', minimum: 1 }, destaque: { type: 'boolean' }, estilo: { enum: ['normal', 'forte'] } }, required: ['texto'] },
  }))
  r.registra(bloco('layout/aberto', { props: { type: 'object', properties: { a: { type: 'string' } }, additionalProperties: true } }))
  r.registra(bloco('layout/sem-props'))
  r.registra(bloco('commerce/base', { props: { type: 'object', properties: { colecao: { type: 'string' } }, required: ['colecao'] } }))
  r.registra(bloco('commerce/vitrine', { extends: 'commerce/base', props: { type: 'object', properties: { colunas: { type: 'integer' } } } }))
  return r
}

describe('validação de props contra o bloco resolvido', () => {
  it('props válidas passam', () => {
    expect(props(monta(), { bloco: 'texto/titulo', props: { texto: 'Olá', nivel: 2, destaque: true, estilo: 'forte' } })).toEqual([])
  })

  it('obrigatória ausente aponta o caminho da instância', () => {
    const [e] = props(monta(), { bloco: 'texto/titulo' })
    expect(e).toMatchObject({ regra: 'props', caminho: '/spec/raiz/props' })
    expect(e!.mensagem).toBe("falta o campo obrigatório 'texto'")
  })

  it('tipo errado e enum com sugestão', () => {
    const es = props(monta(), { bloco: 'texto/titulo', props: { texto: 5, estilo: 'fort' } })
    expect(es.map((e) => e.caminho).sort()).toEqual(['/spec/raiz/props/estilo', '/spec/raiz/props/texto'])
    expect(es.find((e) => e.caminho.endsWith('estilo'))!.dica).toBe("quis dizer 'forte'?")
  })

  it('prop desconhecida é erro com "quis dizer"', () => {
    const [e] = props(monta(), { bloco: 'texto/titulo', props: { texto: 'a', nivell: 1 } })
    expect(e!.caminho).toBe('/spec/raiz/props/nivell')
    expect(e!.dica).toBe("quis dizer 'nivel'?")
  })

  it('bloco pode liberar props extras com additionalProperties: true', () => {
    expect(props(monta(), { bloco: 'layout/aberto', props: { a: 'x', qualquer: 1 } })).toEqual([])
  })

  it('binding é aceito em propriedades não-texto; texto comum não', () => {
    const r = monta()
    expect(props(r, { bloco: 'texto/titulo', props: { texto: 'x', nivel: '{produto.nivel}', destaque: '{loja.destaque | bool}' } })).toEqual([])
    const es = props(r, { bloco: 'texto/titulo', props: { texto: 'x', nivel: 'dois' } })
    expect(es).toHaveLength(1)
    expect(es[0]!.caminho).toBe('/spec/raiz/props/nivel')
  })

  it('limites do schema valem (minimum)', () => {
    expect(props(monta(), { bloco: 'texto/titulo', props: { texto: 'x', nivel: 0 } })).toHaveLength(1)
  })

  it('props herdadas por extends são exigidas e aceitas', () => {
    const r = monta()
    expect(props(r, { bloco: 'commerce/vitrine', props: { colecao: 'destaques', colunas: 3 } })).toEqual([])
    const [e] = props(r, { bloco: 'commerce/vitrine', props: { colunas: 3 } })
    expect(e!.mensagem).toContain("'colecao'")
  })

  it('bloco sem schema de props não valida props', () => {
    expect(props(monta(), { bloco: 'layout/sem-props', props: { x: 1 } })).toEqual([])
  })

  it('valida props em instâncias aninhadas, com o caminho certo', () => {
    const r = new Registry()
    r.registra(bloco('layout/pilha', { slots: { filhos: {} } }))
    r.registra(bloco('texto/titulo', { props: { type: 'object', properties: { texto: { type: 'string' } }, required: ['texto'] } }))
    const [e] = props(r, { bloco: 'layout/pilha', slots: { filhos: [{ bloco: 'texto/titulo', props: {} }] } })
    expect(e!.caminho).toBe('/spec/raiz/slots/filhos/0/props')
  })

  it('confere() inclui as props', () => {
    const r = monta()
    const p = r.registra(no('pagina', 'cp', { rota: '/', raiz: { bloco: 'texto/titulo' } })) as No
    expect(confere(r, p).map((e) => e.regra)).toEqual(['props'])
  })
})
