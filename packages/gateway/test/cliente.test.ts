import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { FalhaServico, clienteHttp, montaQuery } from '../src/index'

// O cliente HTTP contra um servidor REAL (porta efêmera em localhost): o que o gateway faz quando o serviço é hostil, lento, enorme ou redireciona.
let srv: Server, base: string
const vistos: Array<{ metodo: string; url: string; headers: IncomingMessage['headers']; corpo: string }> = []
type Resp = (req: IncomingMessage, res: ServerResponse) => void
let resposta: Resp = (_r, res) => { res.setHeader('content-type', 'application/json'); res.end('{"ok":true}') }

beforeAll(async () => {
  srv = createServer((req, res) => { let corpo = ''; req.on('data', (c) => (corpo += c)); req.on('end', () => { vistos.push({ metodo: req.method!, url: req.url!, headers: req.headers, corpo }); resposta(req, res) }) })
  await new Promise<void>((r) => srv.listen(0, '127.0.0.1', r)); base = `http://127.0.0.1:${(srv.address() as AddressInfo).port}`
})
afterAll(async () => { await new Promise((r) => srv.close(r)) })
const usa = (r: Resp) => { resposta = r; vistos.length = 0 }
const falha = async (p: Promise<unknown>) => { try { await p } catch (e) { return e as FalhaServico } throw new Error('deveria falhar') }

describe('clienteHttp', () => {
  it('chama com método, caminho, query codificada, corpo JSON e os cabeçalhos dados; devolve status e JSON', async () => {
    usa((_r, res) => { res.statusCode = 201; res.setHeader('content-type', 'application/json'); res.end('{"id":"1"}') })
    const c = clienteHttp({ baseUrl: base })
    const r = await c.chama({ metodo: 'POST', caminho: '/produtos', query: { a: 'x y&z', lista: ['1', '2'], nulo: null, nada: undefined, b: true }, corpo: { nome: 'x' }, headers: { authorization: 'Bearer t', 'x-request-id': 'r1' } })
    expect(r).toEqual({ status: 201, corpo: { id: '1' } })
    expect(vistos[0]).toMatchObject({ metodo: 'POST', url: '/produtos?a=x+y%26z&lista=1&lista=2&b=true', corpo: '{"nome":"x"}' })
    expect(vistos[0]!.headers.authorization).toBe('Bearer t'); expect(vistos[0]!.headers['content-type']).toBe('application/json'); expect(vistos[0]!.headers.accept).toBe('application/json')
  })
  it('NÃO segue redirecionamento (SSRF / open redirect): 3xx é falha e o destino nunca é buscado', async () => {
    usa((req, res) => { if (req.url === '/interno') { res.end('{"segredo":1}'); return } res.statusCode = 302; res.setHeader('location', '/interno'); res.end() })
    const e = await falha(clienteHttp({ baseUrl: base }).chama({ metodo: 'GET', caminho: '/a', headers: {} }))
    expect(e).toBeInstanceOf(FalhaServico); expect(e.motivo).toContain('redirecionamento'); expect(vistos.map((v) => v.url)).toEqual(['/a']) // só o 1º pedido
  })
  it('resposta GRANDE: pelo content-length e também em stream sem content-length (corta ao passar do limite)', async () => {
    const c = clienteHttp({ baseUrl: base, maxBytes: 1000 })
    usa((_r, res) => { res.setHeader('content-type', 'application/json'); res.setHeader('content-length', '5000'); res.end('x'.repeat(5000)) })
    expect((await falha(c.chama({ metodo: 'GET', caminho: '/g', headers: {} }))).motivo).toMatch(/excede o limite/)
    usa((_r, res) => { res.setHeader('content-type', 'application/json'); res.write('['); const t = setInterval(() => res.write('"' + 'a'.repeat(400) + '",'), 5); setTimeout(() => { clearInterval(t); res.end('0]') }, 200) })
    expect((await falha(c.chama({ metodo: 'GET', caminho: '/g', headers: {} }))).motivo).toMatch(/excede o limite/)
  })
  it('prazo: serviço lento → falha de "tempo esgotado"; cancelamento do chamador também', async () => {
    usa((_r, res) => { setTimeout(() => res.end('{}'), 500) })
    expect((await falha(clienteHttp({ baseUrl: base, timeoutMs: 50 }).chama({ metodo: 'GET', caminho: '/l', headers: {} }))).motivo).toMatch(/tempo esgotado/)
    const ctl = new AbortController(); const p = clienteHttp({ baseUrl: base, timeoutMs: 5000 }).chama({ metodo: 'GET', caminho: '/l', headers: {} }, ctl.signal); setTimeout(() => ctl.abort(), 20)
    expect((await falha(p)).motivo).toMatch(/cancelada/)
  })
  it('resposta que não é JSON → falha; corpo vazio → undefined; erro de rede é opaco', async () => {
    usa((_r, res) => { res.end('<html>erro</html>') }); expect((await falha(clienteHttp({ baseUrl: base }).chama({ metodo: 'GET', caminho: '/h', headers: {} }))).motivo).toContain('não é JSON')
    usa((_r, res) => { res.statusCode = 204; res.end() }); expect(await clienteHttp({ baseUrl: base }).chama({ metodo: 'DELETE', caminho: '/x', headers: {} })).toEqual({ status: 204, corpo: undefined })
    expect((await falha(clienteHttp({ baseUrl: 'http://127.0.0.1:1', timeoutMs: 500 }).chama({ metodo: 'GET', caminho: '/x', headers: {} }))).motivo).toMatch(/falha de rede|tempo esgotado/)
  })
  it('o CAMINHO é validado: nada de .., //, \\, %2e, %2f, nem ? ou # contrabandeados; baseUrl só http(s), sem credenciais, sem query', async () => {
    const c = clienteHttp({ baseUrl: base }); usa((_r, res) => res.end('{}'))
    for (const caminho of ['/a/../b', '//evil.com/x', '/a\\b', '/a/%2e%2e/b', '/a%2Fb', '/a?x=1', '/a#f', 'sem-barra', '/a b', '/a\n']) expect((await falha(c.chama({ metodo: 'GET', caminho, headers: {} }))).motivo, JSON.stringify(caminho)).toMatch(/caminho inseguro/)
    expect(vistos.length).toBe(0)
    expect(() => clienteHttp({ baseUrl: 'file:///etc/passwd' })).toThrow('http(s)'); expect(() => clienteHttp({ baseUrl: 'ftp://x' })).toThrow()
    expect(() => clienteHttp({ baseUrl: 'http://u:p@host' })).toThrow('credenciais'); expect(() => clienteHttp({ baseUrl: 'http://h/?x=1' })).toThrow('query'); expect(() => clienteHttp({ baseUrl: 'http://h/#f' })).toThrow()
  })
  it('query com objeto é recusada (nada de serializar estrutura por engano)', () => {
    expect(() => montaQuery({ a: { b: 1 } })).toThrow('não suportado'); expect(montaQuery({})).toBe(''); expect(montaQuery(undefined)).toBe('')
  })
})
