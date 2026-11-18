import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { aplicaMigracao, ESQUEMA_ATUAL, KINDS, Migrador, MigracaoErro, Registry, criaValidador, type Migracao } from '../src/index'

const base = () => ({
  kind: 'pagina', id: 'p', versao: '1.0.0', estatuto: 'publicado',
  spec: { rota: '/', titulo: 'x', raiz: { bloco: 'a/b' }, antigo: 'v' },
})

const m12: Migracao = {
  kind: 'pagina', de: 1, para: 2,
  ops: [
    { op: 'renomeia', de: '/spec/titulo', para: '/spec/tituloPagina' },
    { op: 'define', caminho: '/spec/guarda', valor: [] },
    { op: 'remove', caminho: '/spec/antigo' },
  ],
}
const m23: Migracao = {
  kind: 'pagina', de: 2, para: 3,
  ops: [{ op: 'mapeia', caminho: '/spec/modo', tabela: { claro: 'light', escuro: 'dark' } }],
}

describe('aplicaMigracao', () => {
  it('renomeia, define e remove; carimba o esquema; não muta a entrada', () => {
    const e = base()
    const s = structuredClone(e)
    const r = aplicaMigracao(e, m12) as any
    expect(r.esquema).toBe(2)
    expect(r.spec.tituloPagina).toBe('x')
    expect('titulo' in r.spec).toBe(false)
    expect(r.spec.guarda).toEqual([])
    expect('antigo' in r.spec).toBe(false)
    expect(e).toEqual(s)
  })

  it('renomeia para caminho novo aninhado e ignora origem ausente', () => {
    const r = aplicaMigracao({ kind: 'tema', spec: {} }, { kind: 'tema', de: 1, para: 2, ops: [{ op: 'renomeia', de: '/spec/x', para: '/spec/a/b/c' }] }) as any
    expect(r.spec).toEqual({})
    const r2 = aplicaMigracao({ kind: 'tema', spec: { x: 1 } }, { kind: 'tema', de: 1, para: 2, ops: [{ op: 'renomeia', de: '/spec/x', para: '/spec/a/b/c' }] }) as any
    expect(r2.spec).toEqual({ a: { b: { c: 1 } } })
  })

  it('define não sobrescreve por padrão, mas sobrescreve quando pedido', () => {
    const mk = (sobrescreve?: boolean): Migracao => ({ kind: 'tema', de: 1, para: 2, ops: [{ op: 'define', caminho: '/spec/k', valor: 'novo', ...(sobrescreve !== undefined ? { sobrescreve } : {}) }] })
    expect((aplicaMigracao({ spec: { k: 'velho' } }, mk()) as any).spec.k).toBe('velho')
    expect((aplicaMigracao({ spec: { k: 'velho' } }, mk(true)) as any).spec.k).toBe('novo')
    expect((aplicaMigracao({ spec: {} }, mk()) as any).spec.k).toBe('novo')
  })

  it('mapeia valores conhecidos e deixa os demais', () => {
    const r1 = aplicaMigracao({ spec: { modo: 'claro' } }, m23) as any
    const r2 = aplicaMigracao({ spec: { modo: 'outro' } }, m23) as any
    expect(r1.spec.modo).toBe('light')
    expect(r2.spec.modo).toBe('outro')
  })

  it('ponteiro com ~1 e ~0 é decodificado', () => {
    const r = aplicaMigracao({ spec: { 'a/b': 1 } }, { kind: 'tema', de: 1, para: 2, ops: [{ op: 'renomeia', de: '/spec/a~1b', para: '/spec/c~0d' }] }) as any
    expect(r.spec).toEqual({ 'c~d': 1 })
  })
})

describe('Migrador', () => {
  const monta = () => {
    const m = new Migrador({ pagina: 3 })
    m.registra(m12)
    m.registra(m23)
    return m
  }

  it('encadeia 1→2→3 e lista o que foi aplicado', () => {
    const { no, aplicadas } = monta().migra({ ...base(), spec: { ...base().spec, modo: 'escuro' } })
    expect((no as any).esquema).toBe(3)
    expect((no as any).spec.modo).toBe('dark')
    expect(aplicadas).toEqual([{ kind: 'pagina', de: 1, para: 2 }, { kind: 'pagina', de: 2, para: 3 }])
  })

  it('migra a partir do major em que o nó está', () => {
    const { aplicadas } = monta().migra({ ...base(), esquema: 2 })
    expect(aplicadas).toEqual([{ kind: 'pagina', de: 2, para: 3 }])
  })

  it('nó já no major atual passa intacto', () => {
    const n = { ...base(), esquema: 3 }
    const r = monta().migra(n)
    expect(r.aplicadas).toEqual([])
    expect(r.no).toBe(n)
  })

  it('recusa nó de major futuro', () => {
    expect(() => monta().migra({ ...base(), esquema: 4 })).toThrow(/mais novo que o suportado/)
  })

  it('falta de migração é erro e aparece em lacunas()', () => {
    const m = new Migrador({ pagina: 3 })
    m.registra(m12)
    expect(m.lacunas()).toEqual(['pagina 2→3'])
    expect(() => m.migra(base())).toThrow(/sem migração pagina 2→3/)
  })

  it('lacunas() acusa migração além do major atual', () => {
    const m = new Migrador({ pagina: 1 })
    m.registra(m12)
    expect(m.lacunas()[0]).toMatch(/além do major atual/)
  })

  it('valida a própria migração (schema, N→N+1, duplicata)', () => {
    const m = new Migrador({ pagina: 5 })
    expect(() => m.registra({ kind: 'pagina', de: 1, para: 2, ops: [] })).toThrow(MigracaoErro)
    expect(() => m.registra({ kind: 'pagina', de: 1, para: 2, ops: [{ op: 'explode' }] })).toThrow(MigracaoErro)
    expect(() => m.registra({ kind: 'pagina', de: 1, para: 2, ops: [{ op: 'remove', caminho: 'sem-barra' }] })).toThrow(MigracaoErro)
    expect(() => m.registra({ kind: 'pagina', de: 1, para: 3, ops: [{ op: 'remove', caminho: '/a' }] })).toThrow(MigracaoErro)
    m.registra(m12)
    expect(() => m.registra(m12)).toThrow(/duplicada/)
  })
})

describe('compatibilidade para trás (fixtures congeladas)', () => {
  const valida = criaValidador()
  const migrador = new Migrador() // produção: ESQUEMA_ATUAL; migrações reais entram aqui quando existirem
  const dir = join(__dirname, 'congelados')
  const majors = readdirSync(dir).filter((d) => /^v\d+$/.test(d)).sort()

  it('a cadeia de migrações do código está completa', () => {
    expect(migrador.lacunas()).toEqual([])
  })

  it('há fixtures de todos os kinds no major 1', () => {
    const kinds = new Set(readdirSync(join(dir, 'v1')).map((f) => JSON.parse(readFileSync(join(dir, 'v1', f), 'utf8')).kind))
    for (const k of KINDS) expect(kinds.has(k), k).toBe(true)
  })

  for (const v of majors) {
    for (const f of readdirSync(join(dir, v)).filter((x) => x.endsWith('.json'))) {
      it(`${v}/${f} migra até o major atual e valida`, () => {
        const dado = JSON.parse(readFileSync(join(dir, v, f), 'utf8'))
        const { no } = migrador.migra(dado)
        const r = valida(no)
        expect(r.ok, JSON.stringify(r)).toBe(true)
        expect((no.esquema as number | undefined) ?? 1).toBe(ESQUEMA_ATUAL[dado.kind as keyof typeof ESQUEMA_ATUAL])
      })
    }
  }
})

describe('Registry com migrador', () => {
  it('aceita nós sem esquema (=1) e rejeita major futuro', () => {
    const r = new Registry({ migrador: new Migrador() })
    r.registra({ kind: 'tema', id: 't', versao: '1.0.0', estatuto: 'publicado', spec: { tokens: {} } })
    expect(() => r.registra({ kind: 'tema', id: 't2', versao: '1.0.0', esquema: 2, spec: { tokens: {} } })).toThrow(/mais novo/)
  })

  it('sem migrador, esquema desconhecido falha na validação do envelope', () => {
    const r = new Registry()
    expect(() => r.registra({ kind: 'tema', id: 't', versao: '1.0.0', esquema: 2, spec: { tokens: {} } })).toThrow(/inválido/)
  })
})
