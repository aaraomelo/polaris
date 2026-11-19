import { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { DDL_DIRETORIO, caminhoDoAtivo, criaAtivos, detectaImagem, diretorioSql } from '../src/index'

const A = '11111111-1111-1111-1111-111111111111', B = '22222222-2222-2222-2222-222222222222'
let pg: PGlite
const q = async (s: string, p: unknown[] = []) => { const r = await pg.query(s, p); return { rows: r.rows as Array<Record<string, unknown>>, rowCount: r.affectedRows ?? r.rows.length } }
beforeAll(async () => {
  pg = new PGlite(); await pg.exec(DDL_DIRETORIO)
  for (const [t, a] of [[A, 'loja-a'], [B, 'loja-b']] as const) await diretorioSql(q).cria({ tenantId: t, alias: a, nome: a, segmento: 'varejo', packs: ['varejo'], donoEmail: `${a}@x.com`, chave: `chave-${a}-12345` })
})
afterAll(async () => { await pg.close() })

const b64 = (b: Uint8Array) => Buffer.from(b).toString('base64')
const bytes = (...p: Array<number | string | number[]>) => Uint8Array.from(p.flatMap((x) => (typeof x === 'string' ? [...Buffer.from(x, 'latin1')] : Array.isArray(x) ? x : [x])))
const be32 = (n: number) => [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]
const png = (w: number, h: number, extra = 0) => bytes(0x89, 'PNG', 0x0d, 0x0a, 0x1a, 0x0a, be32(13), 'IHDR', be32(w), be32(h), 8, 2, 0, 0, 0, [0, 0, 0, 0], new Array(extra).fill(7))
const gif = (w: number, h: number) => bytes('GIF89a', [w & 255, w >> 8, h & 255, h >> 8], [0, 0, 0])
const jpeg = (w: number, h: number) => bytes(0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 'JFIF', 0, [1, 1, 0, 0, 1, 0, 1, 0, 0], 0xff, 0xc0, 0x00, 0x0b, 8, [h >> 8, h & 255, w >> 8, w & 255], 1, [1, 0x11, 0], 0xff, 0xd9)
const webpX = (w: number, h: number) => bytes('RIFF', [30, 0, 0, 0], 'WEBP', 'VP8X', [10, 0, 0, 0], [0, 0, 0, 0], [(w - 1) & 255, ((w - 1) >> 8) & 255, ((w - 1) >> 16) & 255], [(h - 1) & 255, ((h - 1) >> 8) & 255, ((h - 1) >> 16) & 255])

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
    const p = criaAtivos({ q, limites: { arquivosPorTenant: 2, bytesPorTenant: 200 } })
    expect(await p.salva(B, 'bia', { nome: 'a‮b\nc', dados: b64(png(3, 3, 90)) })).toMatchObject({ ok: true, ativo: { nome: 'a b c' } }) // B já tinha 1 ativo (o do teste anterior): este é o 2º
    expect(await p.salva(B, 'bia', { nome: 'terceiro', dados: b64(png(4, 4)) })).toMatchObject({ ok: false, erro: expect.stringMatching(/limite de 2 imagens/) })
    const q2 = criaAtivos({ q, limites: { arquivosPorTenant: 100, bytesPorTenant: 100 } }); expect(await q2.salva(A, 'ana', { nome: 'estoura', dados: b64(png(9, 9, 500)) })).toMatchObject({ ok: false, erro: expect.stringMatching(/MB de imagens|limite/) })
  })
})
