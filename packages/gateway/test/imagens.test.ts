import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { A, B, criaAmbiente, type Ambiente } from './ambiente'

// `/_polaris/img/<sha256>.<ext>`: as imagens do tenant servidas do PRÓPRIO site (o CSP das páginas só carrega imagens da mesma origem). O tenant vem do endereço, nunca da URL.
const H1 = 'a'.repeat(64), H2 = 'b'.repeat(64), PNG = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex')
const base: Record<string, { tipo: string; bytes: Uint8Array }> = { [`${A}|${H1}`]: { tipo: 'image/png', bytes: PNG }, [`${B}|${H2}`]: { tipo: 'image/jpeg', bytes: Buffer.from([0xff, 0xd8, 0xff]) } }
const WEBP = Buffer.from('RIFF....WEBP', 'latin1')
let e: Ambiente, leituras: string[] = []
beforeAll(async () => { e = await criaAmbiente({ gateway: { paginas: { cookieSeguro: false, tenantNo: () => undefined, imagens: { le: async (t: string, h: string, w?: number) => { leituras.push(`${t}|${h}${w ? `|${w}` : ''}`); if (w) return t === A && h === H1 && w === 480 ? { tipo: 'image/webp', bytes: WEBP } : null; return base[`${t}|${h}`] ?? null } } } as never } as never }) })
afterAll(async () => { await e.fim() })
const get = (arq: string, host = 'a.loja.test', headers: Record<string, string> = {}) => e.req('GET', `/_polaris/img/${arq}`, { host, headers })

describe('imagens do tenant', () => {
  it('serve o arquivo do tenant do ENDEREÇO com o tipo certo, cache eterno, nosniff e CSP que não deixa nada executar', async () => {
    const r = await get(`${H1}.png`); expect(r.statusCode).toBe(200); expect(r.headers['content-type']).toBe('image/png'); expect(Buffer.from(r.rawPayload).equals(PNG)).toBe(true)
    expect(r.headers['cache-control']).toBe('public, max-age=31536000, immutable'); expect(r.headers['x-content-type-options']).toBe('nosniff'); expect(r.headers['content-security-policy']).toBe("default-src 'none'; sandbox"); expect(r.headers['cross-origin-resource-policy']).toBeUndefined() // a prévia do Studio (iframe sandbox) precisa carregá-la; expect(r.headers.etag).toBe(`"${H1}"`)
  })
  it('ETag: If-None-Match devolve 304 sem corpo', async () => { const r = await get(`${H1}.png`, 'a.loja.test', { 'if-none-match': `"${H1}"` }); expect(r.statusCode).toBe(304); expect(r.body).toBe('') })
  it('ISOLAMENTO: o hash de um tenant não abre no endereço de outro (mesmo 404 de inexistente)', async () => {
    expect((await get(`${H2}.jpg`, 'a.loja.test')).statusCode).toBe(404); expect((await get(`${H2}.jpg`, 'b.loja.test')).statusCode).toBe(200); expect((await get(`${H1}.png`, 'b.loja.test')).statusCode).toBe(404)
    expect((await get(`${'c'.repeat(64)}.png`)).body).toBe((await get(`${H2}.jpg`, 'a.loja.test')).body) // inexistente e de outro tenant são indistinguíveis
  })
  it('a extensão tem de ser a do TIPO guardado; nome fora do formato nem consulta o banco', async () => {
    leituras = []
    expect((await get(`${H1}.jpg`)).statusCode).toBe(404); expect((await get(`${H1}.gif`)).statusCode).toBe(404)
    for (const ruim of ['x.png', `${H1}`, `${H1}.svg`, `${H1}.png.html`, `${'A'.repeat(64)}.png`, '..%2f..%2fetc%2fpasswd', `${H1}.PNG`]) expect((await get(ruim)).statusCode, ruim).toBe(404)
    expect(leituras).toEqual([`${A}|${H1}`, `${A}|${H1}`]) // só as duas com formato certo chegaram à leitura
  })
  it('versões menores: `<hash>.webp?w=<largura>` serve a versão (webp) com ETag próprio; largura que não existe, ou com outra extensão, é 404', async () => {
    const r = await get(`${H1}.webp?w=480`); expect(r.statusCode).toBe(200); expect(r.headers['content-type']).toBe('image/webp'); expect(r.headers.etag).toBe(`"${H1}-480"`); expect(Buffer.from(r.rawPayload).equals(WEBP)).toBe(true); expect(r.headers['cache-control']).toBe('public, max-age=31536000, immutable')
    expect((await get(`${H1}.webp?w=480`, 'a.loja.test', { 'if-none-match': `"${H1}-480"` })).statusCode).toBe(304)
    for (const ruim of [`${H1}.webp?w=160`, `${H1}.png?w=480`, `${H1}.webp?w=abc`, `${H1}.webp?w=1`, `${H1}.webp?w=99999`, `${H1}.webp?w=480%27`]) expect((await get(ruim)).statusCode, ruim).toBe(404)
    expect((await get(`${H1}.webp?w=480`, 'b.loja.test')).statusCode).toBe(404) // outro tenant
  })
  it('host desconhecido não vaza nada (não é um tenant)', async () => { expect((await get(`${H1}.png`, 'desconhecido.exemplo.com')).statusCode).toBeGreaterThanOrEqual(400) })
})
