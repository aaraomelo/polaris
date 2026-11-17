import { describe, expect, it } from 'vitest'
import { Registry, confere, validaEstrutura, type No } from '../src/index'

const no = (kind: string, id: string, spec: object, extra: object = {}) => ({ kind, id, versao: '1.0.0', estatuto: 'publicado', spec, ...extra })
const bloco = (iface: string, spec: object = {}, extra: object = {}) => no('bloco', iface.replace('/', '.'), { interface: iface, ...spec }, extra)
const pagina = (raiz: object, extra: object = {}) => no('pagina', 'p', { rota: '/', raiz }, extra)

const monta = () => {
  const r = new Registry()
  r.registra(bloco('layout/pilha', { slots: { filhos: {} } }))
  r.registra(bloco('layout/linha', { slots: { filhos: { max: 3 } } }))
  r.registra(bloco('layout/lista', { slots: { item: { aceita: ['layout/item'], min: 1, max: 2 } } }))
  r.registra(bloco('layout/item', { slots: {} }))
  r.registra(bloco('commerce/cartao', { extends: 'layout/item' }))
  r.registra(bloco('texto/titulo'))
  return r
}

// registrar a mesma página várias vezes dá duplicata; usa-se um id novo por chamada
let n = 0
const checa = (r: Registry, raiz: object, lim = {}, ctx = {}) => {
  const p = r.registra({ ...pagina(raiz), id: `p${n++}` }) as No
  return validaEstrutura(r, p, ctx, lim)
}

describe('1. composição de blocos é DAG', () => {
  it('bloco que contém a si mesmo → ciclo', () => {
    const r = monta()
    const b = r.registra(bloco('a/x', { modelo: { bloco: 'layout/pilha', slots: { filhos: [{ bloco: 'a/x' }] } } })) as No
    const e = validaEstrutura(r, b).filter((x) => x.regra === 'ciclo')
    expect(e).toHaveLength(1) // uma vez só, sem eco degenerado
    expect(e[0]!.mensagem).toBe('composição circular de blocos: a/x → a/x')
  })

  it('ciclo indireto a → b → c → a é reportado uma vez com o caminho do ciclo', () => {
    const r = monta()
    const mk = (de: string, para: string) => bloco(de, { modelo: { bloco: 'layout/pilha', slots: { filhos: [{ bloco: para }] } } })
    r.registra(mk('c/a', 'c/b'))
    r.registra(mk('c/b', 'c/c'))
    r.registra(mk('c/c', 'c/a'))
    const e = checa(r, { bloco: 'c/a' }).filter((x) => x.regra === 'ciclo')
    expect(e).toHaveLength(1)
    expect(e[0]!.mensagem).toMatch(/c\/a → c\/b → c\/c → c\/a/)
  })

  it('o ciclo vale via herança (modelo herdado de extends)', () => {
    const r = monta()
    r.registra(bloco('d/base', { modelo: { bloco: 'layout/pilha', slots: { filhos: [{ bloco: 'd/filho' }] } } }))
    r.registra(bloco('d/filho', { extends: 'd/base' }))
    expect(checa(r, { bloco: 'd/filho' }).some((x) => x.regra === 'ciclo')).toBe(true)
  })

  it('composição acíclica (diamante) é válida', () => {
    const r = monta()
    const usa = (...alvos: string[]) => ({ modelo: { bloco: 'layout/pilha', slots: { filhos: alvos.map((bloco) => ({ bloco })) } } })
    r.registra(bloco('e/folha', usa()))
    r.registra(bloco('e/esq', usa('e/folha')))
    r.registra(bloco('e/dir', usa('e/folha')))
    r.registra(bloco('e/topo', usa('e/esq', 'e/dir')))
    expect(checa(r, { bloco: 'e/topo' })).toEqual([])
  })

  it('blocos sem modelo (só código) não têm dependências', () => {
    const r = monta()
    r.registra(bloco('f/codigo', { codigo: { linguagem: 'js', fonte: 'export default 1' } }))
    expect(checa(r, { bloco: 'f/codigo' })).toEqual([])
  })
})

describe('2. conformidade com slots', () => {
  it('slot inexistente no bloco', () => {
    const e = checa(monta(), { bloco: 'layout/pilha', slots: { rodape: [{ bloco: 'texto/titulo' }] } })
    expect(e).toHaveLength(1)
    expect(e[0]).toMatchObject({ regra: 'slot', caminho: '/spec/raiz/slots/rodape' })
  })

  it('aceita: bloco não listado é recusado; subtipo por extends é aceito', () => {
    const r = monta()
    const bom = checa(r, { bloco: 'layout/lista', slots: { item: [{ bloco: 'layout/item' }, { bloco: 'commerce/cartao' }] } })
    expect(bom).toEqual([])
    const ruim = checa(r, { bloco: 'layout/lista', slots: { item: [{ bloco: 'texto/titulo' }] } })
    expect(ruim).toHaveLength(1)
    expect(ruim[0]).toMatchObject({ regra: 'slot-aceita', caminho: '/spec/raiz/slots/item/0/bloco' })
  })

  it('min: slot obrigatório vazio ou ausente', () => {
    const r = monta()
    expect(checa(r, { bloco: 'layout/lista' }).map((x) => x.regra)).toEqual(['slot-min'])
    expect(checa(r, { bloco: 'layout/lista', slots: { item: [] } }).map((x) => x.regra)).toEqual(['slot-min'])
  })

  it('max: excesso de filhos', () => {
    const e = checa(monta(), { bloco: 'layout/linha', slots: { filhos: Array.from({ length: 4 }, () => ({ bloco: 'texto/titulo' })) } })
    expect(e.map((x) => x.regra)).toEqual(['slot-max'])
  })

  it('filhos com `se` não contam para o mínimo; com `repetir` dispensam min e max', () => {
    const r = monta()
    const cond = checa(r, { bloco: 'layout/lista', slots: { item: [{ bloco: 'layout/item', se: 'x' }] } })
    expect(cond.map((x) => x.regra)).toEqual(['slot-min'])
    const rep = checa(r, { bloco: 'layout/lista', slots: { item: [{ bloco: 'layout/item', repetir: { cada: 'itens', como: 'i' } }] } })
    expect(rep).toEqual([])
    const muitos = checa(r, { bloco: 'layout/lista', slots: { item: [{ bloco: 'layout/item' }, { bloco: 'layout/item' }, { bloco: 'layout/item', repetir: { cada: 'x', como: 'y' } }] } })
    expect(muitos).toEqual([])
  })

  it('valida em profundidade, com o caminho do nó problemático', () => {
    const e = checa(monta(), { bloco: 'layout/pilha', slots: { filhos: [{ bloco: 'layout/pilha', slots: { filhos: [{ bloco: 'layout/lista' }] } }] } })
    expect(e).toHaveLength(1)
    expect(e[0]).toMatchObject({ regra: 'slot-min', caminho: '/spec/raiz/slots/filhos/0/slots/filhos/0/slots/item' })
  })

  it('bloco inexistente é ignorado aqui (cabe a verifica); confere() acusa', () => {
    const r = monta()
    const raiz = { bloco: 'layout/pilha', slots: { filhos: [{ bloco: 'nao/existe' }] } }
    expect(checa(r, raiz)).toEqual([])
    const p = r.registra({ ...pagina(raiz), id: 'inexistente' }) as No
    expect(confere(r, p).map((x) => x.regra)).toEqual(['ref'])
  })

  it('o override do tenant altera as regras de slot', () => {
    const r = monta()
    r.registra(bloco('layout/linha', { slots: { filhos: { max: 1 } } }, { tenantId: 'loja-1' }))
    const raiz = { bloco: 'layout/linha', slots: { filhos: [{ bloco: 'texto/titulo' }, { bloco: 'texto/titulo' }] } }
    expect(checa(r, raiz)).toEqual([])
    expect(checa(r, raiz, {}, { tenantId: 'loja-1' }).map((x) => x.regra)).toEqual(['slot-max'])
  })

  it('as mesmas regras valem na modelo de um bloco', () => {
    const r = monta()
    const b = r.registra(bloco('g/vitrine', { modelo: { bloco: 'layout/lista' } })) as No
    expect(validaEstrutura(r, b).map((x) => x.caminho)).toEqual(['/spec/modelo/slots/item'])
  })
})

describe('3. ids de instância únicos', () => {
  it('duplicata aponta o primeiro uso', () => {
    const e = checa(monta(), { bloco: 'layout/pilha', id: 'a', slots: { filhos: [{ bloco: 'texto/titulo', id: 'b' }, { bloco: 'texto/titulo', id: 'a' }] } })
    expect(e).toHaveLength(1)
    expect(e[0]).toMatchObject({ regra: 'id-unico', caminho: '/spec/raiz/slots/filhos/1/id' })
    expect(e[0]!.mensagem).toContain('/spec/raiz')
  })

  it('instâncias sem id não colidem entre si', () => {
    expect(checa(monta(), { bloco: 'layout/pilha', slots: { filhos: [{ bloco: 'texto/titulo' }, { bloco: 'texto/titulo' }] } })).toEqual([])
  })
})

describe('4. limites', () => {
  const profunda = (n: number): object => (n === 0 ? { bloco: 'texto/titulo' } : { bloco: 'layout/pilha', slots: { filhos: [profunda(n - 1)] } })

  it('profundidade excedida é reportada uma vez e não gera ruído abaixo', () => {
    const e = checa(monta(), profunda(10), { maxProfundidade: 4 })
    expect(e.filter((x) => x.regra === 'limite')).toHaveLength(1)
  })

  it('profundidade dentro do limite passa; padrão aguenta 30 níveis', () => {
    expect(checa(monta(), profunda(30))).toEqual([])
    expect(checa(monta(), profunda(40)).some((x) => x.regra === 'limite')).toBe(true)
  })

  it('fan-out por slot', () => {
    const e = checa(monta(), { bloco: 'layout/pilha', slots: { filhos: Array.from({ length: 6 }, () => ({ bloco: 'texto/titulo' })) } }, { maxFilhosPorSlot: 5 })
    expect(e.map((x) => x.regra)).toEqual(['limite'])
  })

  it('total de nós', () => {
    const e = checa(monta(), { bloco: 'layout/pilha', slots: { filhos: Array.from({ length: 10 }, () => ({ bloco: 'texto/titulo' })) } }, { maxNos: 5 })
    expect(e.filter((x) => x.regra === 'limite')).toHaveLength(1)
  })
})

describe('outros kinds', () => {
  it('kinds sem árvore não geram erro estrutural', () => {
    const r = monta()
    const t = r.registra(no('tema', 't', { tokens: {} })) as No
    expect(validaEstrutura(r, t)).toEqual([])
  })
})
