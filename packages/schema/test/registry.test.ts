import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { Registry, RegistryErro } from '../src/index'
import { fonteDiretorio } from '../src/node'

const no = (kind: string, id: string, spec: object, extra: object = {}) => ({
  kind, id, versao: '1.0.0', estatuto: 'publicado', spec, ...extra,
})
const bloco = (iface: string, spec: object = {}, extra: object = {}) =>
  no('bloco', iface.replace('/', '.'), { interface: iface, ...spec }, extra)
const tema = (id: string, cor: string, extra: object = {}) => no('tema', id, { tokens: { cor: { primaria: cor } } }, extra)

describe('registry — registro', () => {
  it('rejeita nó inválido com os caminhos JSON', () => {
    const r = new Registry()
    try {
      r.registra(no('pagina', 'p', { rota: 'sem-barra', raiz: { bloco: 'a/b' } }))
      expect.unreachable()
    } catch (e) {
      expect(e).toBeInstanceOf(RegistryErro)
      expect((e as RegistryErro).detalhes.map((d) => d.caminho)).toContain('/spec/rota')
    }
  })

  it('rejeita duplicata de (kind, id, escopo, versão)', () => {
    const r = new Registry()
    r.registra(tema('t', '#111'))
    expect(() => r.registra(tema('t', '#222'))).toThrow(/duplicado/)
  })

  it('rejeita tenantId e segmento ao mesmo tempo', () => {
    const r = new Registry()
    expect(() => r.registra(tema('t', '#111', { tenantId: 'x', segmento: 'varejo' }))).toThrow(RegistryErro)
  })

  it('registra também os filhos aninhados', () => {
    const r = new Registry()
    r.registra(no('pagina', 'pai', { rota: '/p', raiz: { bloco: 'a/b' } }, { filhos: [no('pagina', 'filha', { rota: '/p/f', raiz: { bloco: 'a/b' } })] }))
    expect(r.resolve('pagina', 'filha')).not.toBeNull()
  })
})

describe('registry — cascata de escopo', () => {
  const monta = () => {
    const r = new Registry()
    r.registra(tema('base', '#core'))
    r.registra(tema('base', '#varejo', { segmento: 'varejo' }))
    r.registra(tema('base', '#loja', { tenantId: 'loja-1' }))
    return r
  }
  const cor = (res: ReturnType<Registry['resolve']>) => (res!.no.spec as any).tokens.cor.primaria

  it('tenant vence segmento, que vence core', () => {
    const r = monta()
    expect(cor(r.resolve('tema', 'base', { tenantId: 'loja-1', segmento: 'varejo' }))).toBe('#loja')
    expect(cor(r.resolve('tema', 'base', { segmento: 'varejo' }))).toBe('#varejo')
    expect(cor(r.resolve('tema', 'base'))).toBe('#core')
  })

  it('outro tenant não enxerga o override alheio', () => {
    const r = monta()
    const res = r.resolve('tema', 'base', { tenantId: 'loja-2', segmento: 'varejo' })
    expect(res!.escopo).toBe('segmento')
  })

  it('segmento diferente cai para core', () => {
    expect(monta().resolve('tema', 'base', { segmento: 'alimentos' })!.escopo).toBe('core')
  })

  it('devolve null quando não existe', () => {
    expect(monta().resolve('tema', 'nada')).toBeNull()
  })
})

describe('registry — versão e estatuto', () => {
  it('escolhe a maior versão publicada e ignora rascunho/obsoleto', () => {
    const r = new Registry()
    r.registra({ ...tema('t', '#1'), versao: '1.2.0' })
    r.registra({ ...tema('t', '#2'), versao: '1.10.0' })
    r.registra({ ...tema('t', '#3'), versao: '2.0.0', estatuto: 'rascunho' })
    r.registra({ ...tema('t', '#4'), versao: '3.0.0', estatuto: 'obsoleto' })
    expect((r.resolve('tema', 't')!.no.spec as any).tokens.cor.primaria).toBe('#2')
    expect(r.resolve('tema', 't')!.no.versao).toBe('1.10.0')
    expect(r.resolve('tema', 't', { incluirRascunho: true })!.no.versao).toBe('2.0.0')
  })

  it('só rascunho → invisível sem incluirRascunho', () => {
    const r = new Registry()
    r.registra({ ...tema('t', '#1'), estatuto: 'rascunho' })
    expect(r.resolve('tema', 't')).toBeNull()
    expect(r.resolve('tema', 't', { incluirRascunho: true })).not.toBeNull()
  })

  it('o cache é invalidado ao registrar', () => {
    const r = new Registry()
    expect(r.resolve('tema', 't')).toBeNull()
    r.registra(tema('t', '#1'))
    expect(r.resolve('tema', 't')).not.toBeNull()
  })
})

describe('registry — extends de blocos', () => {
  const monta = () => {
    const r = new Registry()
    r.registra(bloco('layout/lista', {
      props: { type: 'object', properties: { gap: { type: 'number' }, colecao: { type: 'string' } }, required: ['colecao'] },
      slots: { item: { aceita: ['layout/item'], min: 0 }, rodape: { max: 1 } },
      modelo: { bloco: 'layout/pilha' },
    }))
    r.registra(bloco('commerce/vitrine', {
      extends: 'layout/lista',
      props: { type: 'object', properties: { titulo: { type: 'string' }, gap: { type: 'integer' } }, required: ['titulo'] },
      slots: { item: { aceita: ['commerce/cartao'], min: 1 } },
    }))
    r.registra(bloco('commerce/vitrine-destaque', { extends: 'commerce/vitrine' }))
    return r
  }

  it('herda e mescla props e slots (filho sobrescreve)', () => {
    const b = monta().resolveBloco('commerce/vitrine')
    expect(b.cadeia).toEqual(['commerce/vitrine', 'layout/lista'])
    expect(Object.keys(b.props!.properties!).sort()).toEqual(['colecao', 'gap', 'titulo'])
    expect((b.props!.properties!.gap as any).type).toBe('integer')
    expect([...b.props!.required!].sort()).toEqual(['colecao', 'titulo'])
    expect(b.slots.item).toEqual({ aceita: ['commerce/cartao'], min: 1 })
    expect(b.slots.rodape).toEqual({ max: 1 })
    expect(b.modelo).toEqual({ bloco: 'layout/pilha' })
  })

  it('resolve cadeias de vários níveis', () => {
    expect(monta().resolveBloco('commerce/vitrine-destaque').cadeia).toEqual(['commerce/vitrine-destaque', 'commerce/vitrine', 'layout/lista'])
  })

  it('o override de tenant troca o bloco inteiro (e a herança usa o mesmo contexto)', () => {
    const r = monta()
    r.registra(bloco('layout/lista', { props: { type: 'object', properties: { densidade: { type: 'string' } } } }, { tenantId: 'loja-1' }))
    const global = r.resolveBloco('commerce/vitrine')
    const loja = r.resolveBloco('commerce/vitrine', { tenantId: 'loja-1' })
    expect(Object.keys(global.props!.properties!)).toContain('colecao')
    expect(Object.keys(loja.props!.properties!)).toContain('densidade')
    expect(Object.keys(loja.props!.properties!)).not.toContain('colecao')
  })

  it('detecta ciclo', () => {
    const r = new Registry()
    r.registra(bloco('a/x', { extends: 'a/y' }))
    r.registra(bloco('a/y', { extends: 'a/x' }))
    expect(() => r.resolveBloco('a/x')).toThrow(/ciclo em extends: a\/x → a\/y → a\/x/)
  })

  it('erro claro para bloco ou pai inexistente', () => {
    const r = new Registry()
    r.registra(bloco('a/x', { extends: 'a/fantasma' }))
    expect(() => r.resolveBloco('a/x')).toThrow(/não encontrado: a\/fantasma/)
    expect(() => r.resolveBloco('nada/nada')).toThrow(/não encontrado/)
  })
})

describe('registry — integridade referencial', () => {
  const base = () => {
    const r = new Registry()
    r.registra(no('servico', 'catalogo', { entidades: {}, operacoes: {} }))
    r.registra(no('dados', 'dados.loja', { fonte: { tipo: 'servico', servico: 'catalogo', operacao: 'obter' } }))
    r.registra(bloco('layout/pilha'))
    r.registra(tema('tema.base', '#111'))
    return r
  }

  it('página íntegra não tem erros', () => {
    const r = base()
    const p = r.registra(no('pagina', 'home', { rota: '/', dados: { loja: 'dados.loja' }, raiz: { bloco: 'layout/pilha', slots: { filhos: [{ bloco: 'layout/pilha' }] } } }))
    expect(r.verifica(p)).toEqual([])
  })

  it('aponta cada referência quebrada com o caminho', () => {
    const r = base()
    const p = r.registra(no('pagina', 'home', {
      rota: '/', dados: { x: 'dados.fantasma' },
      raiz: { bloco: 'layout/pilha', slots: { filhos: [{ bloco: 'commerce/inexistente' }] } },
    }))
    const caminhos = r.verifica(p).map((e) => e.caminho)
    expect(caminhos).toEqual(['/spec/dados/x', '/spec/raiz/slots/filhos/0/bloco'])
  })

  it('tenant: tema e páginas inexistentes', () => {
    const r = base()
    const t = r.registra(no('tenant', 'loja-1', { alias: 'loja-1', segmento: 'varejo', tema: 'tema.nada', paginas: ['home'] }))
    expect(r.verifica(t).map((e) => e.caminho)).toEqual(['/spec/tema', '/spec/paginas/0'])
  })

  it('dados → serviço e kernel → backend', () => {
    const r = new Registry()
    const d = r.registra(no('dados', 'd', { fonte: { tipo: 'servico', servico: 'fantasma', operacao: 'x' } }))
    const k = r.registra(no('kernel', 'k', { entradas: {}, saidas: {}, emissoes: [{ alvo: 'glsl', backend: 'glsl' }] }))
    expect(r.verifica(d)).toHaveLength(1)
    expect(r.verifica(k)).toHaveLength(1)
  })

  it('verificaTudo lista só os nós com problema', () => {
    const r = base()
    r.registra(no('pagina', 'ok', { rota: '/ok', raiz: { bloco: 'layout/pilha' } }))
    r.registra(no('pagina', 'ruim', { rota: '/ruim', raiz: { bloco: 'nao/existe' } }))
    const problemas = r.verificaTudo()
    expect(problemas.map((p) => p.no)).toEqual(['pagina:ruim'])
  })

  it('a referência é resolvida no contexto (override do tenant satisfaz a página do tenant)', () => {
    const r = base()
    r.registra(bloco('loja/especial', {}, { tenantId: 'loja-1' }))
    const p = r.registra(no('pagina', 'home', { rota: '/', raiz: { bloco: 'loja/especial' } }, { tenantId: 'loja-1' }))
    expect(r.verifica(p)).toHaveLength(1)
    expect(r.verifica(p, { tenantId: 'loja-1' })).toEqual([])
  })
})

describe('registry — fontes', () => {
  it('carrega os exemplos válidos do disco', async () => {
    const r = new Registry()
    const n = await r.carrega(fonteDiretorio(join(__dirname, 'exemplos', 'validos')))
    expect(n).toBeGreaterThanOrEqual(11)
    expect(r.resolve('tema', 'tema.base', {})).toBeNull() // exemplos estão sem estatuto publicado
    expect(r.resolve('tema', 'tema.base', { incluirRascunho: true })).not.toBeNull()
  })

  it('carrega de uma fonte HTTP (fetch injetado)', async () => {
    const { fonteHttp } = await import('../src/index')
    const r = new Registry()
    const fake = (async () => new Response(JSON.stringify([tema('t', '#1')]), { status: 200 })) as unknown as typeof fetch
    expect(await r.carrega(fonteHttp('http://x/nos.json', fake))).toBe(1)
    const ruim = (async () => new Response('', { status: 500 })) as unknown as typeof fetch
    await expect(r.carrega(fonteHttp('http://x/nos.json', ruim))).rejects.toThrow(/500/)
  })
})

describe('Registry.derivado: cópia isolada', () => {
  const pag = (versao: string, extra: object = {}) => ({ kind: 'pagina', id: 'home', versao, estatuto: 'publicado', spec: { rota: '/', raiz: { bloco: 'texto/paragrafo' } }, ...extra }) as never
  it('registrar no derivado não altera o original (nem o contrário depois da cópia); o derivado enxerga o que o original tinha', () => {
    const base = new Registry(); base.registra(pag('1.0.0')); const d = base.derivado()
    d.registra(pag('1.0.0', { tenantId: 't1' })); d.registra({ kind: 'pagina', id: 'so-no-derivado', versao: '1.0.0', estatuto: 'publicado', spec: { rota: '/x', raiz: { bloco: 'texto/paragrafo' } } } as never)
    expect(base.ids('pagina')).toEqual(['home']); expect(d.ids('pagina')).toEqual(['home', 'so-no-derivado'])
    expect(d.resolve('pagina', 'home', { tenantId: 't1' })!.escopo).toBe('tenant'); expect(base.resolve('pagina', 'home', { tenantId: 't1' })!.escopo).toBe('core') // o override só existe no derivado
    base.registra({ kind: 'pagina', id: 'depois', versao: '1.0.0', estatuto: 'publicado', spec: { rota: '/d', raiz: { bloco: 'texto/paragrafo' } } } as never); expect(d.ids('pagina')).not.toContain('depois')
  })
})
