import { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { DDL_DIRETORIO, caminhoDoAtivo, criaAtivos, detectaImagem, diretorioSql, limpaMetadados } from '../src/index'

const A = '11111111-1111-1111-1111-111111111111', B = '22222222-2222-2222-2222-222222222222'
let pg: PGlite
const q = async (s: string, p: unknown[] = []) => { const r = await pg.query(s, p); return { rows: r.rows as Array<Record<string, unknown>>, rowCount: r.affectedRows ?? r.rows.length } }
beforeAll(async () => {
  pg = new PGlite(); await pg.exec(DDL_DIRETORIO)
  for (const [t, a] of [[A, 'loja-a'], [B, 'loja-b']] as const) await diretorioSql(q).cria({ tenantId: t, alias: a, nome: a, segmento: 'varejo', packs: ['varejo'], donoEmail: `${a}@x.com`, chave: `chave-${a}-12345` })
})
afterAll(async () => { await pg.close() })

const b64 = (b: Uint8Array) => Buffer.from(b).toString('base64')
const bytes = (...p: Array<number | string | number[] | Uint8Array>) => Uint8Array.from(p.flatMap((x) => (typeof x === 'string' ? [...Buffer.from(x, 'latin1')] : ArrayBuffer.isView(x) ? [...(x as Uint8Array)] : Array.isArray(x) ? x : [x as number])))
const be32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]
const le32 = (n: number) => [n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255]
const chunkPng = (nome: string, dados: number[] | Uint8Array) => bytes(be32(dados.length), nome, [...dados], [0, 0, 0, 0]) // o CRC não é conferido aqui
/** arquivos MÍNIMOS mas com a estrutura de verdade (png: IHDR…IDAT…IEND; jpeg: …SOS…EOI; gif: …trailer; webp: pedaços RIFF) */
const png = (w: number, h: number, extra = 0, antes: Uint8Array[] = []) => bytes(0x89, 'PNG', 0x0d, 0x0a, 0x1a, 0x0a, chunkPng('IHDR', [...be32(w), ...be32(h), 8, 2, 0, 0, 0]), ...antes, chunkPng('IDAT', new Array(extra + 1).fill(7)), chunkPng('IEND', []))
const gif = (w: number, h: number, meio: Uint8Array = bytes()) => bytes('GIF89a', [w & 255, w >> 8, h & 255, h >> 8], [0, 0, 0], meio, 0x2c, [0, 0, 0, 0, w & 255, w >> 8, h & 255, h >> 8, 0], 2, [2, 0x44, 0x01], 0, 0x3b)
const jpeg = (w: number, h: number, segmentos: Uint8Array[] = []) => bytes(0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 'JFIF', 0, [1, 1, 0, 0, 1, 0, 1, 0, 0], ...segmentos, 0xff, 0xc0, 0x00, 0x0b, 8, [h >> 8, h & 255, w >> 8, w & 255], 1, [1, 0x11, 0], 0xff, 0xda, 0x00, 0x08, [1, 1, 0, 0, 0x3f, 0], [1, 2, 3, 4, 5], 0xff, 0xd9)
const webp = (w: number, h: number, extras: Uint8Array[] = [], flags = 0) => { const vp8x = bytes('VP8X', le32(10), flags, [0, 0, 0], [(w - 1) & 255, ((w - 1) >> 8) & 255, ((w - 1) >> 16) & 255], [(h - 1) & 255, ((h - 1) >> 8) & 255, ((h - 1) >> 16) & 255]), corpo = bytes('WEBP', vp8x, ...extras); return bytes('RIFF', le32(corpo.length), corpo) }
const webpX = (w: number, h: number) => webp(w, h)

describe('detecção pelos bytes', () => {
  it('png, jpeg, gif e webp, com as dimensões do cabeçalho', () => {
    expect(detectaImagem(png(1600, 500))).toEqual({ tipo: 'image/png', largura: 1600, altura: 500 }); expect(detectaImagem(jpeg(800, 600))).toEqual({ tipo: 'image/jpeg', largura: 800, altura: 600 })
    expect(detectaImagem(gif(32, 16))).toEqual({ tipo: 'image/gif', largura: 32, altura: 16 }); expect(detectaImagem(webpX(1200, 630))).toEqual({ tipo: 'image/webp', largura: 1200, altura: 630 })
  })
  it('não é imagem: SVG, HTML, executável, texto, vazio, cabeçalho truncado, JPEG sem SOF', () => {
    for (const ruim of [Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'), Buffer.from('<html><script>alert(1)</script>'), Buffer.from('MZ\x90\x00\x03'), Buffer.from('oi'), new Uint8Array(0), png(1, 1).subarray(0, 12), bytes(0xff, 0xd8, 0xff, 0xe0, 0, 4, 0, 0, 0xff, 0xd9, 0, 0, 0, 0)]) expect(detectaImagem(ruim)).toBeNull()
  })
  it('o nome e o que o cliente diz não importam: só os bytes', async () => {
    const a = criaAtivos({ q }), r = await a.salva(A, 'ana', { nome: 'foto.svg', dados: b64(png(10, 10)) }); expect(r).toMatchObject({ ok: true, ativo: { tipo: 'image/png' } })
    expect((r as { ativo: { caminho: string } }).ativo.caminho).toMatch(/^\/_polaris\/img\/[0-9a-f]{64}\.png$/)
  })
})

describe('ativos do tenant', () => {
  const a = criaAtivos({ q })
  it('salva, lista e lê; o mesmo conteúdo no mesmo tenant é UM ativo só (idempotente); o id é o SHA-256 e a URL leva a extensão do TIPO', async () => {
    const r1 = await a.salva(A, 'ana', { nome: 'banner', dados: b64(png(1600, 500, 40)) }); expect(r1).toMatchObject({ ok: true, novo: true, ativo: { nome: 'banner', largura: 1600, altura: 500, autor: 'ana' } })
    const r2 = await a.salva(A, 'bia', { nome: 'outro nome', dados: b64(png(1600, 500, 40)) }); expect(r2).toMatchObject({ ok: true, novo: false, ativo: { nome: 'banner' } })
    const id = (r1 as { ativo: { id: string } }).ativo.id; expect(id).toMatch(/^[0-9a-f]{64}$/)
    expect((await a.lista(A)).map((x) => x.id)).toContain(id); const lido = await a.le(A, id); expect(lido!.tipo).toBe('image/png'); expect(Buffer.from(lido!.bytes).equals(Buffer.from(png(1600, 500, 40)))).toBe(true)
    expect(caminhoDoAtivo(id, 'image/jpeg')).toBe(`/_polaris/img/${id}.jpg`)
  })
  it('ISOLAMENTO: o outro tenant não lista nem lê; o mesmo arquivo no outro tenant é um ativo dele', async () => {
    const r = await a.salva(A, 'ana', { nome: 'só da A', dados: b64(png(20, 20, 3)) }); const id = (r as { ativo: { id: string } }).ativo.id
    expect(await a.le(B, id)).toBeNull(); expect((await a.lista(B)).map((x) => x.id)).not.toContain(id); expect(await a.remove(B, id)).toBe(false); expect(await a.le(A, id)).not.toBeNull()
    expect(await a.salva(B, 'bia', { nome: 'da B', dados: b64(png(20, 20, 3)) })).toMatchObject({ ok: true, novo: true, ativo: { nome: 'da B' } })
  })
  it('remove só no próprio tenant; hash malformado é recusado sem tocar o banco', async () => {
    const r = await a.salva(A, 'ana', { nome: 'apagar', dados: b64(gif(5, 5)) }); const id = (r as { ativo: { id: string } }).ativo.id
    expect(await a.remove(A, id)).toBe(true); expect(await a.le(A, id)).toBeNull(); expect(await a.remove(A, id)).toBe(false)
    for (const ruim of ['', 'x', "'; DROP TABLE plataforma.ativo; --", '../../etc/passwd', 'A'.repeat(64)]) { expect(await a.le(A, ruim)).toBeNull(); expect(await a.remove(A, ruim)).toBe(false) }
  })
  it('recusa com mensagem clara: não é base64, vazio, sem nome, não é imagem, grande demais, dimensões absurdas (bomba de descompressão)', async () => {
    const e = async (x: { nome: string; dados: string }) => { const r = await a.salva(A, 'ana', x); return r.ok ? 'ok' : r.erro }
    expect(await e({ nome: 'x', dados: 'não é base64!' })).toMatch(/base64/); expect(await e({ nome: 'x', dados: '' })).toMatch(/base64/); expect(await e({ nome: '  ', dados: b64(png(1, 1)) })).toMatch(/nome/)
    expect(await e({ nome: 'x', dados: Buffer.from('<svg onload=alert(1)>').toString('base64') })).toMatch(/png, jpeg, gif ou webp/)
    expect(await e({ nome: 'x', dados: b64(png(1, 1, 2 * 1024 * 1024)) })).toMatch(/passa de|precisa ter/); expect(await e({ nome: 'x', dados: b64(png(20000, 20000)) })).toMatch(/dimensões fora do limite/); expect(await e({ nome: 'x', dados: b64(png(8000, 8000)) })).toMatch(/dimensões/) // 64 MP > 40 MP
    expect(await e({ nome: 'x', dados: b64(png(0, 5)) })).toMatch(/dimensões/)
  })
  it('limites por tenant: arquivos e bytes; o nome perde controles e marcas bidirecionais', async () => {
    const p = criaAtivos({ q, limites: { arquivosPorTenant: 2, bytesPorTenant: 400 } })
    expect(await p.salva(B, 'bia', { nome: 'a‮b\nc', dados: b64(png(3, 3, 90)) })).toMatchObject({ ok: true, ativo: { nome: 'a b c' } }) // B já tinha 1 ativo (o do teste anterior): este é o 2º
    expect(await p.salva(B, 'bia', { nome: 'terceiro', dados: b64(png(4, 4)) })).toMatchObject({ ok: false, erro: expect.stringMatching(/limite de 2 imagens/) })
    const q2 = criaAtivos({ q, limites: { arquivosPorTenant: 100, bytesPorTenant: 100 } }); expect(await q2.salva(A, 'ana', { nome: 'estoura', dados: b64(png(9, 9, 500)) })).toMatchObject({ ok: false, erro: expect.stringMatching(/MB de imagens|limite/) })
  })
})

/** o que NÃO pode sobrar: localização, câmera, comentários, XMP */
const SEGREDOS = ['GPS', 'Canon EOS', 'segredo-do-autor', 'coordenadas']
const tem = (b: Uint8Array) => { const t = Buffer.from(b).toString('latin1'); return SEGREDOS.filter((x) => t.includes(x)) }
const seg = (marca: number, corpo: string) => bytes(0xff, marca, [(corpo.length + 2) >> 8, (corpo.length + 2) & 255], corpo)
describe('metadados que vazam', () => {
  it('jpeg: sai APP1 (EXIF e XMP), APP13 e comentário; ficam JFIF e o ICC; a imagem (SOF e dados) fica igual', () => {
    const j = jpeg(800, 600, [seg(0xe1, 'Exif\0\0GPS coordenadas -23.5,-46.6 Canon EOS'), seg(0xe1, 'http://ns.adobe.com/xap/1.0/\0<x:xmpmeta>segredo-do-autor</x:xmpmeta>'), seg(0xed, 'Photoshop 3.0\0segredo-do-autor'), seg(0xfe, 'comentário segredo-do-autor'), seg(0xe2, 'ICC_PROFILE\0perfil'), seg(0xee, 'Adobe')])
    expect(tem(j)).toHaveLength(4); const l = limpaMetadados(j, 'image/jpeg')!; expect(tem(l)).toEqual([]); expect(Buffer.from(l).includes('ICC_PROFILE')).toBe(true); expect(Buffer.from(l).includes('JFIF')).toBe(true); expect(Buffer.from(l).includes('Adobe')).toBe(true)
    expect(detectaImagem(l)).toEqual({ tipo: 'image/jpeg', largura: 800, altura: 600 }); expect(Buffer.from(l).subarray(-12).equals(Buffer.from(j).subarray(-12))).toBe(true) // os dados da imagem intactos
  })
  it('png: saem tEXt, zTXt, iTXt, eXIf e tIME; ficam IHDR, IDAT e IEND, cada pedaço com seu CRC original', () => {
    const p = png(40, 30, 5, [chunkPng('tEXt', [...Buffer.from('Author\0segredo-do-autor')]), chunkPng('eXIf', [...Buffer.from('GPS coordenadas Canon EOS')]), chunkPng('iTXt', [...Buffer.from('XML:com.adobe.xmp\0segredo-do-autor')]), chunkPng('tIME', [7, 234, 1, 2, 3, 4, 5]), chunkPng('zTXt', [...Buffer.from('x\0segredo-do-autor')])])
    expect(tem(p).length).toBeGreaterThan(0); const l = limpaMetadados(p, 'image/png')!; expect(tem(l)).toEqual([]); expect(detectaImagem(l)).toEqual({ tipo: 'image/png', largura: 40, altura: 30 }); expect(Buffer.from(l).equals(Buffer.from(png(40, 30, 5)))).toBe(true) // exatamente o arquivo sem os extras
  })
  it('gif: saem comentário e texto simples; ficam as extensões gráficas e o NETSCAPE (animação)', () => {
    const com = bytes(0x21, 0xfe, 24, 'segredo-do-autor coorden', 0), netscape = bytes(0x21, 0xff, 11, 'NETSCAPE2.0', 3, [1, 0, 0], 0), gfx = bytes(0x21, 0xf9, 4, [0, 10, 0, 0], 0)
    const g = gif(32, 16, bytes(netscape, com, gfx)); const l = limpaMetadados(g, 'image/gif')!; expect(tem(g)).toContain('segredo-do-autor'); expect(tem(l)).toEqual([]); expect(Buffer.from(l).includes('NETSCAPE2.0')).toBe(true); expect(detectaImagem(l)).toEqual({ tipo: 'image/gif', largura: 32, altura: 16 })
    expect(Buffer.from(l).equals(Buffer.from(gif(32, 16, bytes(netscape, gfx))))).toBe(true)
  })
  it('webp: saem EXIF e XMP, o tamanho RIFF e as flags do VP8X são acertados', () => {
    const w = webp(1200, 630, [bytes('EXIF', le32(26), 'GPS coordenadas Canon EOS', 0), bytes('XMP ', le32(18), 'segredo-do-autor!!')], 0x0c); const l = limpaMetadados(w, 'image/webp')!
    expect(tem(w).length).toBeGreaterThan(0); expect(tem(l)).toEqual([]); expect(detectaImagem(l)).toEqual({ tipo: 'image/webp', largura: 1200, altura: 630 }); expect(Buffer.from(l).readUInt32LE(4)).toBe(l.length - 8); expect(l[20]! & 0x0c).toBe(0)
  })
  it('estrutura quebrada (sem IEND, segmento que passa do fim, RIFF truncado) é recusada, não "limpa pela metade"', () => {
    expect(limpaMetadados(png(5, 5).subarray(0, 40), 'image/png')).toBeNull(); expect(limpaMetadados(bytes(0xff, 0xd8, 0xff, 0xe1, 0xff, 0xff, 1, 2, 3), 'image/jpeg')).toBeNull(); expect(limpaMetadados(webp(5, 5).subarray(0, 25), 'image/webp')).toBeNull(); expect(limpaMetadados(gif(5, 5).subarray(0, 20), 'image/gif')).toBeNull()
  })
  it('salva: o hash é do arquivo LIMPO (com e sem EXIF é a mesma imagem), informa quantos bytes saíram, e o que fica no banco não tem segredo', async () => {
    const a = criaAtivos({ q }), limpo = jpeg(123, 45), sujo = jpeg(123, 45, [seg(0xe1, 'Exif\0\0GPS coordenadas Canon EOS')])
    const r1 = await a.salva(A, 'ana', { nome: 'foto-suja', dados: b64(sujo) }); expect(r1).toMatchObject({ ok: true, novo: true }); expect((r1 as { removidos: number }).removidos).toBeGreaterThan(20)
    const r2 = await a.salva(A, 'ana', { nome: 'foto-limpa', dados: b64(limpo) }); expect(r2).toMatchObject({ ok: true, novo: false, removidos: 0 }); expect((r2 as { ativo: { id: string } }).ativo.id).toBe((r1 as { ativo: { id: string } }).ativo.id)
    const guardado = await a.le(A, (r1 as { ativo: { id: string } }).ativo.id); expect(tem(guardado!.bytes)).toEqual([])
  })
  it('estrutura quebrada no envio vira mensagem clara', async () => {
    const r = await criaAtivos({ q }).salva(A, 'ana', { nome: 'x', dados: b64(png(5, 5).subarray(0, 40)) }); expect(r).toMatchObject({ ok: false, erro: expect.stringMatching(/corrompido/) })
  })
})
