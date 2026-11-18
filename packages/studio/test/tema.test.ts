import { cssDoTema, TEMA_PADRAO } from '@polaris/engine/tema'
import { Registry } from '@polaris/schema'
import { describe, expect, it } from 'vitest'
import { auditaContraste, defineToken, efetivos, ehCor, removeModo, removeToken, validaToken, type Tema } from '../src'

const base = (): Tema => structuredClone(TEMA_PADRAO.spec) as unknown as Tema
describe('editor de tema', () => {
  it('cores: hex curto/longo/alfa e rgb()/hsl(); lixo e injeção de CSS recusados', () => {
    for (const v of ['#fff', '#FFFFFF', '#ffff', '#11223344', 'rgb(1, 2, 3)', 'rgba(0,0,0,.5)', 'hsl(210 50% 40%)', 'hsl(210deg, 50%, 40%)']) expect(ehCor(v), v).toBe(true)
    for (const v of ['red', '#ggg', '#12', 'rgb(1,2,3); } body { display:none', 'url(x)', 'var(--x)', '', 5, null, 'rgb(javascript:alert(1))', '#fff;']) expect(ehCor(v), String(v)).toBe(false)
  })
  it('validaToken por grupo: espaçamento/raio aceitam número e medida; nome inválido recusado', () => {
    expect(validaToken('espacamento', 'm', 8)).toBeUndefined(); expect(validaToken('raio', 'g', '0.5rem')).toBeUndefined(); expect(validaToken('raio', 'g', '12px')).toBeUndefined()
    for (const v of ['abc', -1, 5000, NaN, '1 2', '8px; x']) expect(validaToken('espacamento', 'm', v), String(v)).toBeDefined()
    expect(validaToken('cor', 'a b', '#fff')).toMatch(/nome/); expect(validaToken('cor', '__proto__', '#fff')).toMatch(/nome/); expect(validaToken('cor', 'constructor', '#fff')).toBeUndefined() // casa o padrão; o defineValor é quem barra
    expect(validaToken('tipografia', 'corpo', undefined)).toBeDefined(); expect(validaToken('tipografia', 'corpo', { tamanho: 16 })).toBeUndefined()
  })
  it('defineToken: base e modo; imutável; erro devolve a mensagem; proto recusado', () => {
    const t = base(), antes = JSON.stringify(t)
    const r = defineToken(t, 'cor', 'primaria', '#112233'); expect(r.ok && r.tema.tokens.cor!.primaria).toBe('#112233'); expect(JSON.stringify(t)).toBe(antes)
    const m = defineToken(t, 'cor', 'fundo', '#000000', 'escuro'); expect(m.ok && (m.tema.modos!.escuro as any).cor.fundo).toBe('#000000')
    expect(defineToken(t, 'cor', 'primaria', 'azul')).toMatchObject({ ok: false }); expect(defineToken(t, 'cor', 'x', '#fff', 'Modo Ruim')).toMatchObject({ ok: false })
    expect(defineToken(t, 'cor', '__proto__', '#fff')).toMatchObject({ ok: false }); expect(defineToken(t, 'cor', 'constructor', '#fff')).toMatchObject({ ok: false, erro: 'nome reservado' }); expect(({} as any).polluted).toBeUndefined()
    const novoModo = defineToken({ tokens: {} }, 'cor', 'fundo', '#fff', 'sepia'); expect(novoModo.ok && novoModo.tema.modos).toEqual({ sepia: { cor: { fundo: '#fff' } } })
  })
  it('removeToken/removeModo poda vazios e mantém `tokens` (obrigatório)', () => {
    const t: Tema = { tokens: { cor: { a: '#fff' } }, modos: { escuro: { cor: { a: '#000' } } } }
    expect(removeToken(t, 'cor', 'a')).toEqual({ tokens: {}, modos: { escuro: { cor: { a: '#000' } } } }); expect(removeToken(t, 'cor', 'a', 'escuro')).toEqual({ tokens: { cor: { a: '#fff' } } })
    expect(removeModo(t, 'escuro')).toEqual({ tokens: { cor: { a: '#fff' } } }); expect(removeModo(t, 'nada')).toBe(t)
  })
  it('efetivos: o modo sobrescreve só o que declara', () => {
    const t: Tema = { tokens: { cor: { a: '#111', b: '#222' } }, modos: { escuro: { cor: { a: '#eee' } } } }
    expect(efetivos(t).cor).toEqual({ a: '#111', b: '#222' }); expect(efetivos(t, 'escuro').cor).toEqual({ a: '#eee', b: '#222' }); expect(efetivos(t, 'inexistente').cor).toEqual({ a: '#111', b: '#222' })
  })
  it('contraste: o tema padrão passa; texto cinza claro sobre branco reprova com o valor medido; por modo', () => {
    expect(auditaContraste(base())).toEqual([])
    const ruim = defineToken(base(), 'cor', 'texto', '#cccccc'); const av = ruim.ok ? auditaContraste(ruim.tema) : []
    expect(av.find((a) => a.par === 'texto/fundo' && a.modo === 'base')).toMatchObject({ minimo: 4.5 }); expect(av.find((a) => a.par === 'texto/fundo')!.contraste).toBeLessThan(2)
    const esc = defineToken(base(), 'cor', 'texto', '#222222', 'escuro'); expect(esc.ok && auditaContraste(esc.tema).some((a) => a.modo === 'escuro' && a.par === 'texto/fundo')).toBe(true)
    expect(auditaContraste({ tokens: { cor: { texto: '#abc', fundo: '#abd' } } })[0]).toMatchObject({ par: 'texto/fundo' }) // hex curto também é medido
    expect(auditaContraste({ tokens: { cor: { texto: 'rgb(0,0,0)', fundo: '#fff' } } })).toEqual([]) // formato não medido é ignorado, não inventa erro
  })
  it('o tema editado continua válido no schema e gera CSS com o token novo', () => {
    const r = defineToken(base(), 'cor', 'primaria', '#abcdef'); if (!r.ok) throw new Error(r.erro)
    const reg = new Registry(), no = reg.registra({ kind: 'tema', id: 'meu', versao: '1.0.0', spec: r.tema }); expect(cssDoTema(no).toLowerCase()).toContain('#abcdef')
  })
})
