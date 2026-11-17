import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { KINDS, criaAjv, criaValidador } from '../src/index'

const raiz = join(__dirname, 'exemplos')
const le = (pasta: string) =>
  readdirSync(join(raiz, pasta)).filter((f) => f.endsWith('.json')).map((f) => ({
    arquivo: f,
    dado: JSON.parse(readFileSync(join(raiz, pasta, f), 'utf8')),
  }))

const valida = criaValidador()

describe('meta-schema Polaris', () => {
  it('todos os schemas compilam em modo estrito (2020-12)', () => {
    expect(() => criaAjv()).not.toThrow()
  })

  it('cada kind tem pelo menos um exemplo válido', () => {
    const cobertos = new Set(le('validos').map((e) => e.dado.kind))
    for (const k of KINDS) expect(cobertos.has(k), `sem exemplo válido para ${k}`).toBe(true)
  })

  describe('exemplos válidos', () => {
    for (const { arquivo, dado } of le('validos')) {
      it(arquivo, () => {
        const r = valida(dado)
        expect(r.ok, JSON.stringify(r)).toBe(true)
      })
    }
  })

  describe('exemplos inválidos', () => {
    for (const { arquivo, dado } of le('invalidos')) {
      it(arquivo, () => {
        const r = valida(dado)
        expect(r.ok).toBe(false)
        if (!r.ok) expect(r.erros.length).toBeGreaterThan(0)
      })
    }
  })

  it('erros trazem o caminho JSON do campo problemático', () => {
    const r = valida({ kind: 'pagina', id: 'p', versao: '1.0.0', spec: { rota: 'home', raiz: { bloco: 'layout/pilha' } } })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.erros.map((e) => e.caminho)).toContain('/spec/rota')
  })

  it('valida a spec do kind dentro de filhos aninhados', () => {
    const r = valida({
      kind: 'pagina', id: 'pai', versao: '1.0.0',
      spec: { rota: '/pai', raiz: { bloco: 'layout/pilha' } },
      filhos: [{ kind: 'pagina', id: 'f', versao: '1.0.0', spec: { rota: 'x', raiz: { bloco: 'a/b' } } }],
    })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.erros.some((e) => e.caminho.startsWith('/filhos/0/spec'))).toBe(true)
  })
})
