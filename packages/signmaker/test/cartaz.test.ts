import { describe, expect, it } from 'vitest'
import { ajusta, caminhoRet, fonteDe, geraCartaz, gira, htmlDe, layoutCartaz, pdfDe, quebraLinhas, validaCartaz } from '../src'
import { modulosBarras, matrizQr } from '../src/codigos'
import { DADOS_ETIQUETA, DADOS_LONGO, DADOS_OFERTA, NO_ETIQUETA, NO_OFERTA, SPEC_VARIADO } from './exemplos'

const f = fonteDe('Montserrat', 'negrito')

describe('ajuste de texto', () => {
  it('devolve o MAIOR tamanho que cabe: com 0,25 pt a mais já não cabe', () => {
    const a = ajusta(f, 'Arroz Tipo 1', 300, 60, 'normal', 6, 300); expect(a.cabe).toBe(true)
    const maior = ajusta(f, 'Arroz Tipo 1', 300, 60, 'normal', a.tamanho + 0.25, 300); expect(maior.cabe).toBe(false)
  })
  it('quebra em palavras e respeita \\n; palavra maior que a caixa não é cortada, o tamanho é que encolhe', () => {
    expect(quebraLinhas(f, 'um dois\ntrês', 20, 1000, 'normal')).toEqual(['um dois', 'três'])
    expect(quebraLinhas(f, 'um dois três', 20, 1000, 'nenhuma')).toEqual(['um dois três'])
    const a = ajusta(f, 'Anticonstitucionalissimamente', 100, 500, 'normal', 1, 100); expect(a.linhas).toEqual(['Anticonstitucionalissimamente'])
  })
  it('nem o mínimo cabe: usa o mínimo e diz que não coube (o layout avisa)', () => {
    const a = ajusta(f, 'um texto grande demais para uma caixa minúscula', 20, 5, 'normal', 8, 100); expect(a).toMatchObject({ cabe: false, tamanho: 8 })
  })
  it('mais texto nunca aumenta a fonte (monotônico)', () => {
    let ant = Infinity; for (const t of ['a', 'ab abc', 'ab abc abcd efgh', 'ab abc abcd efgh ijkl mnop qrst uvwx']) { const a = ajusta(f, t, 200, 80, 'normal', 6, 300); expect(a.tamanho).toBeLessThanOrEqual(ant); ant = a.tamanho }
  })
})

describe('geometria', () => {
  it('gira anti-horário na tela: 90° leva (1,0) para cima; 360° volta', () => {
    const [x, y] = gira(11, 10, 10, 10, 90); expect([+x.toFixed(6), +y.toFixed(6)]).toEqual([10, 9])
    const [a, b] = gira(13, 7, 10, 10, 360); expect([+a.toFixed(6), +b.toFixed(6)]).toEqual([13, 7])
  })
  it('o caminho do retângulo tem 4 vértices sem raio e arcos com raio; raio maior que a metade é limitado', () => {
    expect(caminhoRet(0, 0, 10, 10, 0, 0, 0, 0)).toBe('M0 0L10 0L10 10L0 10Z')
    expect((caminhoRet(0, 0, 10, 10, 3, 0, 0, 0).match(/C/g) ?? []).length).toBe(4)
    expect(caminhoRet(0, 0, 10, 4, 99, 0, 0, 0)).toBe(caminhoRet(0, 0, 10, 4, 2, 0, 0, 0))
  })
})

describe('layout do cartaz', () => {
  const l = layoutCartaz(NO_OFERTA.spec, DADOS_OFERTA)
  it('A5 paisagem em pt; fundo, faixas, textos e a condição `se` (sem "de" some o elemento)', () => {
    expect([l.largura, l.altura]).toEqual([595.276, 419.528]); expect(l.paginas).toHaveLength(1)
    const textos = l.paginas[0]!.ops.filter((o) => o.tipo === 'texto').map((o) => (o as { texto: string }).texto)
    expect(textos).toContain('Arroz Tipo 1 Camil 5kg'); expect(textos).toContain('DE R$ 12,90'); expect(textos).toContain('POR R$ 9,99')
    const sem = layoutCartaz(NO_OFERTA.spec, { ...DADOS_OFERTA, preco: { de: '', por: '9.99' } }).paginas[0]!.ops.filter((o) => o.tipo === 'texto').map((o) => (o as { texto: string }).texto)
    expect(sem.some((t) => t.startsWith('DE '))).toBe(false)
  })
  it('as caixas são frações: o MESMO nó em A4 retrato tem outros pt e o mesmo desenho proporcional', () => {
    const a4 = layoutCartaz({ ...NO_OFERTA.spec, tamanho: 'A4', orientacao: 'retrato' }, DADOS_OFERTA); expect([a4.largura, a4.altura]).toEqual([595.276, 841.89])
    const selo = (x: typeof l) => x.paginas[0]!.ops.find((o) => o.tipo === 'caminho')!; expect(selo(a4)).toBeDefined()
  })
  it('é determinístico: mesma entrada, mesmo layout; e o texto é ajustado (nome longo quebra em mais linhas e fonte menor)', () => {
    expect(JSON.stringify(layoutCartaz(NO_OFERTA.spec, DADOS_OFERTA))).toBe(JSON.stringify(l))
    const longo = layoutCartaz(NO_OFERTA.spec, DADOS_LONGO), nome = (x: typeof l) => x.paginas[0]!.ops.filter((o) => o.tipo === 'texto' && o.cor[0] === 255)
    expect(nome(longo).length).toBeGreaterThan(nome(l).length); expect((nome(longo)[0] as { tamanho: number }).tamanho).toBeLessThan((nome(l)[0] as { tamanho: number }).tamanho)
  })
  it('aviso quando o texto não cabe nem no mínimo', () => {
    const spec = { ...NO_OFERTA.spec, elementos: [{ tipo: 'texto', texto: 'texto enorme que não cabe de jeito nenhum aqui', caixa: { topo: 0, esquerda: 0, largura: 0.05, altura: 0.01 }, tamanho: { min: 20 } }], dados: {} }
    expect(layoutCartaz(spec, {}).avisos[0]).toMatch(/não cabe/)
  })
})

describe('validação (fail-closed)', () => {
  it('ids repetidos, caixa sem lado ou com os dois, fonte e dado desconhecidos, condição ruim, min > max', () => {
    const base = { tamanho: 'A5', dados: { a: { tipo: 'texto' } } }
    const erros = validaCartaz({ ...base, fonte: { familia: 'Comic' }, elementos: [
      { tipo: 'texto', id: 'x', texto: '{b}', caixa: { topo: 0, largura: 1, altura: 1 } },
      { tipo: 'texto', id: 'x', texto: 'ok', caixa: { topo: 0, esquerda: 0, direita: 0, largura: 1, altura: 1 }, se: 'zz', tamanho: { min: 9, max: 3 } },
      { tipo: 'faixa', caixa: { topo: 0, esquerda: 0, largura: 1, altura: 1 }, se: '__proto__.x; drop' },
    ] }).join('\n')
    for (const t of ['fonte desconhecida: Comic', 'id repetido: x', "'esquerda' OU 'direita'", 'não declarado em spec.dados', 'tamanho.min maior', 'condição inválida']) expect(erros).toContain(t)
    expect(() => layoutCartaz({ ...base, elementos: [{ tipo: 'texto', texto: '{b}', caixa: { topo: 0, esquerda: 0, largura: 1, altura: 1 } }] }, { a: 'x' })).toThrow(/cartaz inválido/)
  })
  it('dados ausentes ou de tipo errado são recusados antes de gerar (nunca sai peça com buraco)', () => {
    expect(() => layoutCartaz(NO_OFERTA.spec, {})).toThrow(/dado obrigatório ausente/)
  })
})

describe('saídas', () => {
  it('HTML: texto escapado, sem script, CSP fechada, fonte embutida; o PDF é válido e determinístico', async () => {
    const spec = { ...NO_OFERTA.spec, dados: { nome: { tipo: 'texto' } }, elementos: [{ tipo: 'texto', texto: '{nome}', caixa: { topo: 0, esquerda: 0, largura: 1, altura: 0.3 } }] }
    const r = await geraCartaz({ kind: 'cartaz', spec }, { nome: '<img src=x onerror=alert(1)> & "aspas"' }, { agora: new Date(0) })
    expect(r.html).not.toMatch(/<img src=x|<script/); expect(r.html).toContain('&lt;img'); expect(r.html).toContain("default-src 'none'"); expect(r.html).toContain('@font-face')
    expect(Buffer.from(r.pdf).subarray(0, 5).toString()).toBe('%PDF-')
    const a = await geraCartaz(NO_OFERTA, DADOS_OFERTA, { agora: new Date(0) }), b = await geraCartaz(NO_OFERTA, DADOS_OFERTA, { agora: new Date(0) })
    expect(Buffer.from(a.pdf).equals(Buffer.from(b.pdf))).toBe(true); expect(a.html).toBe(b.html)
  })
  it('recusa kind errado e imagem que não é data URL png/jpeg', async () => {
    await expect(geraCartaz({ kind: 'pagina', spec: {} }, {})).rejects.toThrow(/kind=cartaz/)
    const l = layoutCartaz(SPEC_VARIADO, { nome: 'x' }); l.paginas[0]!.ops.push({ tipo: 'imagem', x: 0, y: 0, l: 1, a: 1, src: 'https://evil/x.png', alt: '' })
    expect(() => htmlDe(l)).toThrow(/imagem inválida/); await expect(pdfDe(l)).rejects.toThrow(/imagem inválida/)
  })
})

/** lê de volta os retângulos de um caminho `M x y L .. Z` (sem giro): [x, y, l, a] */
const retsDe = (d: string) => [...d.matchAll(/M([\d.-]+) ([\d.-]+)L([\d.-]+) [\d.-]+L[\d.-]+ ([\d.-]+)L/g)].map((m) => [+m[1]!, +m[2]!, +m[3]! - +m[1]!, +m[4]! - +m[2]!] as const)

describe('código de barras e QR code', () => {
  const l = layoutCartaz(NO_ETIQUETA.spec, DADOS_ETIQUETA), ops = l.paginas[0]!.ops
  const caminhos = ops.filter((o) => o.tipo === 'caminho') as Array<{ d: string; cor: number[] }>
  it('as barras desenhadas SÃO os módulos do EAN-13 (largura de módulo constante, mesmas corridas)', () => {
    const bits = modulosBarras('7891000100103', 'ean13'); expect(bits).toHaveLength(107) // 95 módulos do EAN-13 + as zonas de silêncio que o gerador inclui
    const barras = retsDe(caminhos[1]!.d), mod = barras.reduce((m, r) => Math.min(m, r[2]), Infinity), origem = barras[0]![0] - bits.indexOf('1') * mod // o menor retângulo = 1 módulo; a origem recua até o primeiro módulo (a zona de silêncio)
    const lido = Array.from({ length: 107 }, (_, i) => (barras.some(([x, , w]) => { const c = (x - origem) / mod; return i >= Math.round(c) && i < Math.round(c + w / mod) }) ? '1' : '0')).join('')
    expect(lido).toBe(bits); expect(new Set(barras.map((r) => r[1])).size).toBe(1) // todas na mesma altura
  })
  it('o número legível aparece (texto) e o EAN com dígito verificador errado é recusado', () => {
    expect(ops.some((o) => o.tipo === 'texto' && o.texto === '7891000100103')).toBe(true)
    expect(() => modulosBarras('7891000100104', 'ean13')).toThrow(/EAN-13/); expect(() => modulosBarras('', 'code128')).toThrow(/sem valor/); expect(() => modulosBarras('é'.repeat(5) + '\u4e2d', 'code128')).toThrow()
    expect(() => layoutCartaz(NO_ETIQUETA.spec, { ...DADOS_ETIQUETA, produto: { nome: 'x', ean: '123' } })).toThrow(/EAN-13/)
  })
  it('o QR desenhado SÃO os módulos do qrcode-generator (cada módulo escuro coberto, nenhum claro)', () => {
    const m = matrizQr(DADOS_ETIQUETA.link, 'M'), rets = retsDe(caminhos[2]!.d), cel = rets.reduce((a, r) => Math.min(a, r[3]), Infinity)
    expect(cel).toBeGreaterThan(1); const x0 = Math.min(...rets.map((r) => r[0])), y0 = Math.min(...rets.map((r) => r[1]))
    for (let r = 0; r < m.length; r++) for (let c = 0; c < m.length; c++) {
      const cx = x0 + (c + 0.5) * cel, cy = y0 + (r + 0.5) * cel
      expect(rets.some(([x, y, w, a]) => cx > x && cx < x + w && cy > y && cy < y + a), `módulo ${r},${c}`).toBe(m[r]![c])
    }
  })
  it('QR e barras ficam dentro da caixa; condição `se` e valor vazio omitem o elemento', () => {
    const area = (d: string) => { const rs = retsDe(d); return { x0: Math.min(...rs.map((r) => r[0])), x1: Math.max(...rs.map((r) => r[0] + r[2])) } }
    const q = area(caminhos[2]!.d); expect(q.x1).toBeLessThanOrEqual(l.largura * 0.95 + 0.01); expect(q.x0).toBeGreaterThanOrEqual(l.largura * 0.65 - 0.01)
    const sem = layoutCartaz({ ...NO_ETIQUETA.spec, elementos: NO_ETIQUETA.spec.elementos.map((e: any) => (e.tipo === 'qrcode' ? { ...e, se: 'link' } : e)) }, { ...DADOS_ETIQUETA, link: '' })
    expect(sem.paginas[0]!.ops.filter((o) => o.tipo === 'caminho').length).toBe(caminhos.length - 1)
  })
  it('valor muito grande para QR é recusado com mensagem clara', () => {
    expect(() => matrizQr('x'.repeat(1001), 'L')).toThrow(/mais de 1000/)
  })
})
