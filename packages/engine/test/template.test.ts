import { describe, expect, it } from 'vitest'
import { TemplateErro, parseTemplate } from '../src/index'

const erro = (src: string): TemplateErro => {
  try { parseTemplate(src) } catch (e) { return e as TemplateErro }
  throw new Error(`esperava erro em: ${src}`)
}

describe('parseTemplate', () => {
  it('texto sem binding é literal', () => {
    expect(parseTemplate('Olá mundo')).toEqual({ t: 'lit', v: 'Olá mundo' })
    expect(parseTemplate('')).toEqual({ t: 'lit', v: '' })
  })

  it('um único binding sem texto mantém o tipo (expr)', () => {
    const t = parseTemplate('{produto.preco}')
    expect(t.t).toBe('expr')
    if (t.t === 'expr') expect(t).toMatchObject({ fonte: 'produto.preco', offset: 1 })
  })

  it('texto + binding é template (sempre texto)', () => {
    const t = parseTemplate('Olá {cliente.nome | maiusculas}, bem-vindo!')
    expect(t.t).toBe('tpl')
    if (t.t === 'tpl') {
      expect(t.partes).toHaveLength(3)
      expect(t.partes[0]).toBe('Olá ')
      expect(t.partes[2]).toBe(', bem-vindo!')
      expect(t.partes[1]).toMatchObject({ fonte: 'cliente.nome | maiusculas', offset: 5 })
    }
  })

  it('vários bindings e espaço em volta contam como texto (não é expr puro)', () => {
    expect(parseTemplate('{a}{b}').t).toBe('tpl')
    expect(parseTemplate(' {a}').t).toBe('tpl')
    expect(parseTemplate('{a} ').t).toBe('tpl')
  })

  it('chaves literais com barra', () => {
    expect(parseTemplate('usa \\{chaves\\}')).toEqual({ t: 'lit', v: 'usa {chaves}' })
    expect(parseTemplate('a \\{ {x} \\} b').t).toBe('tpl')
  })

  it('} solta fora de binding é literal; barra antes de outro caractere fica', () => {
    expect(parseTemplate('a } b')).toEqual({ t: 'lit', v: 'a } b' })
    expect(parseTemplate('c:\\x')).toEqual({ t: 'lit', v: 'c:\\x' })
  })

  it('} dentro de texto entre aspas não fecha o binding', () => {
    const t = parseTemplate("{x == '}' ? 'a' : \"}\"}")
    expect(t.t).toBe('expr')
    if (t.t === 'expr') expect(t.fonte).toBe("x == '}' ? 'a' : \"}\"")
  })

  it('aspa com escape dentro do binding', () => {
    expect(parseTemplate("{'it\\'s }'}").t).toBe('expr')
  })

  describe('erros', () => {
    it('binding sem fechar', () => {
      const e = erro('Olá {nome')
      expect(e.message).toMatch(/sem fechar/)
      expect(e.pos).toBe(4)
      expect(e.dica).toContain('\\{')
    })
    it('binding vazio', () => {
      expect(erro('a {} b').message).toMatch(/vazio/)
      expect(erro('{   }').message).toMatch(/vazio/)
    })
    it('erro de expressão aponta a posição dentro do texto original', () => {
      const e = erro('Olá {produto.nome +} fim')
      expect(e.message).toMatch(/esperado um valor/)
      expect(e.pos).toBe('Olá {produto.nome +'.length) // posição do '}' no texto original
    })
    it('é TemplateErro (subclasse de ExprErro)', () => {
      expect(erro('{@}')).toBeInstanceOf(TemplateErro)
    })
  })
})
