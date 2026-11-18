import { readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Registry } from '@polaris/schema'
import { PDFDocument } from 'pdf-lib'
import { describe, expect, it } from 'vitest'
import { DocumentoErro, geraDocumento, htmlDe, layout, pdfDe, resolve, validaNoDocumento } from '../src'
import { DADOS_OS, DADOS_PEDIDO, DADOS_RECIBO, NO_OS, NO_PEDIDO, NO_RECIBO } from './dados'

const clona = <T,>(x: T): T => structuredClone(x)
const textos = (l: ReturnType<typeof layout>) => l.paginas.map((p) => p.ops.filter((o) => o.tipo === 'texto').map((o) => (o as { texto: string }).texto).join('\n'))

describe('os nós dos packs', () => {
  it('todo nó kind=documento em packs/nos é válido no schema, sem erro de autoria, e entra no Registry', () => {
    const base = fileURLToPath(new URL('../../packs/nos/', import.meta.url)); let n = 0
    for (const pack of readdirSync(base)) for (const f of readdirSync(join(base, pack)).filter((x) => x.endsWith('.json'))) {
      const j = JSON.parse(readFileSync(join(base, pack, f), 'utf8')) as { kind: string } | Array<{ kind: string }>
      for (const no of (Array.isArray(j) ? j : [j]).filter((x) => x.kind === 'documento')) { new Registry().registra(no); expect(validaNoDocumento(no as never), f).toEqual([]); n++ }
    }
    expect(n).toBeGreaterThanOrEqual(3)
  })
})

describe('templates', () => {
  for (const [nome, no, dados] of [['ordem de serviço', NO_OS, DADOS_OS], ['pedido', NO_PEDIDO, DADOS_PEDIDO], ['recibo', NO_RECIBO, DADOS_RECIBO]] as const) {
    it(`${nome}: sem erro de autoria e gera HTML e PDF`, async () => {
      expect(validaNoDocumento(no)).toEqual([])
      const r = await geraDocumento(no, dados, { agora: new Date('2026-06-08T12:00:00Z') })
      expect(Buffer.from(r.pdf.slice(0, 5)).toString()).toBe('%PDF-')
      expect(r.html).toContain('<!doctype html>')
      expect(r.layout.paginas.length).toBeGreaterThan(0)
    })
  }
  it('ordem de serviço: valores vinculados e formatados em pt-BR', () => {
    const t = textos(layout(resolve(NO_OS.spec, DADOS_OS))).join('\n')
    for (const esperado of ['OS-000123', '08/06/2026', 'EM ANDAMENTO', '123.456.789-09', '12.345.678/0001-95', 'R$ 49,90', 'R$ 254,90', 'R$ 12,50', 'Página 1/1']) expect(t).toContain(esperado)
    expect(t).not.toMatch(/[{}]/)
  })
  it('pedido: instante UTC vira hora de Brasília', () => { expect(textos(layout(resolve(NO_PEDIDO.spec, DADOS_PEDIDO))).join('\n')).toContain('08/06/2026 11:30') })
  it('recibo: seção opcional some sem taxa ("0.00" é falso)', () => {
    const d = clona(DADOS_RECIBO); d.pagamento.taxa = '0.00'
    const t = textos(layout(resolve(NO_RECIBO.spec, d))).join('\n')
    expect(t).not.toContain('Líquido'); expect(textos(layout(resolve(NO_RECIBO.spec, DADOS_RECIBO))).join('\n')).toContain('Líquido')
  })
  it('determinístico: mesma entrada → mesmo PDF e mesmo HTML, byte a byte', async () => {
    const a = await geraDocumento(NO_OS, DADOS_OS, { agora: new Date(0) }), b = await geraDocumento(NO_OS, DADOS_OS, { agora: new Date(0) })
    expect(Buffer.from(a.pdf).equals(Buffer.from(b.pdf))).toBe(true); expect(a.html).toBe(b.html)
  })
})

describe('paginação', () => {
  const muitos = (n: number) => ({ ...clona(DADOS_OS), itens: Array.from({ length: n }, (_, i) => ({ descricao: `Peça número ${i}`, tipo: 'peca', quantidade: '1', precoUnitario: '1.00', total: '1.00' })) })
  it('muitas linhas quebram em páginas e REPETEM o cabeçalho da tabela', () => {
    const l = layout(resolve(NO_OS.spec, muitos(120)))
    expect(l.paginas.length).toBeGreaterThan(2)
    for (const t of textos(l).slice(1, -0 || undefined)) expect(t).toContain('Descrição')
    const todas = textos(l).join('\n'); for (const i of [0, 59, 119]) expect(todas).toContain(`Peça número ${i}`)
    expect(textos(l).at(-1)).toContain(`Página ${l.paginas.length}/${l.paginas.length}`)
  })
  it('nada sai da área de conteúdo (nem à direita, nem embaixo)', () => {
    const l = layout(resolve(NO_OS.spec, muitos(120)))
    for (const p of l.paginas) for (const o of p.ops) { if (o.tipo !== 'texto') continue; expect(o.x).toBeGreaterThanOrEqual(0); expect(o.yTopo + o.alturaLinha).toBeLessThanOrEqual(p.altura) }
  })
  it('parágrafo gigante flui entre páginas, linha a linha, sem perder texto', () => {
    const texto = Array.from({ length: 1500 }, (_, i) => `palavra${i}`).join(' ')
    const l = layout(resolve({ tamanho: 'A5', dados: { x: { tipo: 'texto' } }, blocos: [{ tipo: 'paragrafo', texto: '{x}' }] }, { x: texto })); expect(l.paginas.length).toBeGreaterThan(1)
    const t = textos(l).join(' ').split(/\s+/); expect(t).toHaveLength(1500); expect(t[1499]).toBe('palavra1499')
  })
  it('palavra maior que a coluna é cortada em pedaços que cabem', () => {
    const l = layout(resolve({ tamanho: 'A5', blocos: [{ tipo: 'paragrafo', texto: 'W'.repeat(500) }] }, {}))
    const ops = l.paginas.flatMap((p) => p.ops).filter((o) => o.tipo === 'texto') as Array<{ x: number; texto: string }>
    expect(ops.length).toBeGreaterThan(1); expect(ops.map((o) => o.texto).join('')).toBe('W'.repeat(500))
  })
  it('emoji (sem glifo na fonte) vira "?" e não derruba o PDF', async () => {
    const r = await geraDocumento({ kind: 'documento', spec: { tamanho: 'A5', blocos: [{ tipo: 'paragrafo', texto: 'Olá 🌵 mundo' }] } }, {})
    expect(textos(r.layout)[0]).toBe('Olá ? mundo'); expect(r.pdf.length).toBeGreaterThan(500)
  })
})

describe('segurança da interpolação', () => {
  const doc = (texto: string, _dados: unknown = { x: 'v' }, decl = { x: { tipo: 'texto' } }) => ({ kind: 'documento' as const, spec: { tamanho: 'A5', dados: decl, blocos: [{ tipo: 'paragrafo', texto }] } })
  const gera = (no: ReturnType<typeof doc>, dados: unknown) => textos(layout(resolve(no.spec, dados)))[0]
  it('caminhos de protótipo não vazam', () => {
    for (const t of ['{x.constructor}', '{x.__proto__}', '{x.constructor.name}', '{__proto__.x}']) expect(() => gera(doc(t), { x: 'v' })).toThrow(DocumentoErro)
    const d = Object.create({ herdado: 'SEGREDO' }) as Record<string, unknown>; d.x = Object.create({ y: 'SEGREDO' })
    expect(gera(doc('[{x.y}]', d, { x: { tipo: 'json' } }), d)).toBe('[]')
  })
  it('sem avaliador: nada de chamada, expressão ou template literal', () => {
    for (const t of ['{x()}', '{x + 1}', '{`x`}', '{x | constructor}', '{x | brl:abc}', '{x | upper:2}', '{x | num}', '{ }', '{x', 'x}', '{x{y}}'])
      expect(() => gera(doc(t), { x: 'v' })).toThrow(DocumentoErro)
  })
  it('raiz fora de spec.dados é erro de autoria, não texto em branco', () => {
    expect(validaNoDocumento(doc('{naoExiste}'))[0]).toMatch(/não é um dado declarado/)
    expect(() => gera(doc('{naoExiste}'), { x: 'v' })).toThrow(/inválido/)
  })
  it('chaves literais por escape', () => { expect(gera(doc('a \\{x\\} {x}'), { x: 'v' })).toBe('a {x} v') })
  it('o valor dos dados NUNCA é reinterpretado como template', () => { expect(gera(doc('{x}'), { x: '{x | upper} {constructor}' })).toBe('{x | upper} {constructor}') })
  it('controle e sobreposição bidirecional são removidos do valor, faixa a faixa', () => {
    for (const c of ['\u0000', '\u0008', '\u000b', '\u001f', '\u007f', '\u0085', '\u009f', '\u200b', '\u200f', '\u202a', '\u202e', '\u2066', '\u2069', '\ufeff']) expect(gera(doc('[{x}]'), { x: `a${c}b` }), `U+${c.charCodeAt(0).toString(16)}`).toBe('[ab]')
    expect(gera(doc('[{x}]'), { x: 'a\tb\r\nc' })).toBe('[a\tb\nc]'.replace('\t', ''))
  })
  it('dado ausente ou de tipo errado quebra (fail-closed)', () => {
    expect(() => gera(doc('{x}'), {})).toThrow(/ausente/); expect(() => gera(doc('{x}'), { x: 5 })).toThrow(/tipo texto/); expect(() => gera(doc('{x}'), null)).toThrow(/objeto/)
  })
  it('imagem: só data URL png/jpeg; URL, file: e SVG são recusados', () => {
    const img = (_src: string) => ({ kind: 'documento' as const, spec: { tamanho: 'A5', dados: { u: { tipo: 'texto' } }, blocos: [{ tipo: 'imagem', src: '{u}', largura: 10, altura: 10 }] } })
    for (const u of ['https://exemplo.com/a.png', 'file:///etc/passwd', 'data:image/svg+xml;base64,PHN2Zz4=', 'data:image/png;base64,AAA"onerror="x']) expect(() => resolve(img(u).spec, { u })).toThrow(DocumentoErro)
    expect(() => resolve(img('').spec, { u: 'data:image/png;base64,iVBORw0KGgo=' })).not.toThrow()
  })
  it('HTML escapa o texto (sem injeção)', () => {
    const l = layout(resolve(doc('{x}').spec, { x: '<img src=x onerror=alert(1)>&"\'' })); const h = htmlDe(l)
    expect(h).not.toContain('<img src=x'); expect(h).toContain('&lt;img src=x onerror=alert(1)&gt;&amp;&quot;&#39;'); expect(h).toContain("default-src 'none'")
  })
  it('limites: lista acima do limite e repetição sem lista falham', () => {
    const no = { spec: { tamanho: 'A5', dados: { l: { tipo: 'lista' } }, blocos: [{ tipo: 'paragrafo', texto: '{i}', repetir: { cada: 'l', como: 'i', limite: 3 } }] } }
    expect(() => resolve(no.spec, { l: [1, 2, 3, 4] })).toThrow(/limite/); expect(gera(no as never, { l: ['a', 'b', 'c'] })).toBe('a\nb\nc')
    expect(() => resolve(no.spec, { l: 'x' })).toThrow(/lista/)
  })
  it('alias de repetir não esconde um dado declarado', () => {
    expect(validaNoDocumento({ kind: 'documento', spec: { tamanho: 'A5', dados: { l: { tipo: 'lista' } }, blocos: [{ tipo: 'paragrafo', texto: 'x', repetir: { cada: 'l', como: 'l' } }] } })[0]).toMatch(/esconde/)
  })
})

describe('PDF', () => {
  it('o PDF tem as páginas do layout e o título', async () => {
    const r = await geraDocumento(NO_OS, DADOS_OS); const d = await PDFDocument.load(r.pdf)
    expect(d.getPageCount()).toBe(r.layout.paginas.length); expect(d.getTitle()).toBe('Ordem de Serviço OS-000123')
    const [w, h] = [d.getPage(0).getWidth(), d.getPage(0).getHeight()]; expect(w).toBeCloseTo(595.28, 1); expect(h).toBeCloseTo(841.89, 1)
  })
  it('PDF = layout (pdfDe aceita o mesmo layout e dá o mesmo resultado)', async () => {
    const l = layout(resolve(NO_RECIBO.spec, DADOS_RECIBO)), d = new Date(0); expect(Buffer.from(await pdfDe(l, d)).equals(Buffer.from(await pdfDe(l, d)))).toBe(true)
  })
})
