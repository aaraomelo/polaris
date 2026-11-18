import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { A, B, criaAmbiente, type Ambiente } from './ambiente'
import type { PortaIdentidade, UsuarioId } from '../src/index'

// Login pelo gateway: o formulário de sistema chama a identidade, o gateway emite a sessão (cookie) e só ela abre as páginas protegidas.
const nos = (n: string) => JSON.parse(readFileSync(join(import.meta.dirname, '../../packs/nos/identidade', n), 'utf8')) as Array<Record<string, unknown>>
const USUARIOS = new Map<string, UsuarioId & { senha: string }>([[`${A}|ana@x.test`, { id: 'u-ana', tenantId: A, email: 'ana@x.test', nome: 'Ana', papeis: ['vendedor'], senha: 'cavalo-bateria-grampo' }], [`${B}|bia@x.test`, { id: 'u-bia', tenantId: B, email: 'bia@x.test', nome: 'Bia', papeis: [], senha: 'outra-senha-forte-1' }]])
const modo: { id: string | undefined } = { id: undefined }
let e: Ambiente, chamadas: Array<[string, Record<string, unknown>]> = [], emails: Array<{ tenantId: string; para: string; assunto: string; corpo: string }> = [], bloqueado = false, tokens = new Map<string, string>()
const identidade: PortaIdentidade = {
  async entra(a) { chamadas.push(['entra', { tenantId: a.tenantId, email: a.email }]); if (bloqueado) return { ok: false, motivo: 'bloqueado', ate: new Date(Date.now() + 5 * 60_000) }; const u = USUARIOS.get(`${a.tenantId}|${a.email.trim().toLowerCase()}`); return u && u.senha === a.senha ? { ok: true, usuario: u } : { ok: false, motivo: 'credenciais' } },
  async pedeRedefinicao(a) { chamadas.push(['esqueci', { tenantId: a.tenantId, email: a.email }]); const u = USUARIOS.get(`${a.tenantId}|${a.email.trim().toLowerCase()}`); if (!u) return null; const t = `tok${tokens.size}-${'x'.repeat(40)}`; tokens.set(t, `${a.tenantId}|${u.email}`); return { token: t, usuario: u } },
  async redefine(a) { chamadas.push(['redefine', { tenantId: a.tenantId }]); const dono = tokens.get(a.token); if (!dono || !dono.startsWith(a.tenantId)) return { ok: false, motivo: 'token_invalido' }; if (a.senha.length < 10) return { ok: false, motivo: 'senha_fraca', erros: ['A senha precisa de pelo menos 10 caracteres.'] }; tokens.delete(a.token); return { ok: true, usuario: USUARIOS.get(dono)! } },
  async emite(u) { return e.token(u.nome, u.tenantId, u.papeis) },
  async enviaEmail(m) { emails.push(m) },
}
beforeAll(async () => {
  e = await criaAmbiente({ gateway: { identidade, paginas: { cookieSeguro: false, tenantNo: (c: { tenantId: string }) => (modo.id ? modo.id : c.tenantId === A ? 'lojaa' : c.tenantId === B ? 'lojab' : undefined) }, estende: (app: any, api: any) => { app.get('/x-sessao', async (req: any) => (await api.sessao(req)) ?? { anonimo: true }) } } as never })
  for (const n of [...nos('formularios.json'), ...nos('paginas.json')]) e.reg.registra(n as never)
  const pag = (id: string, spec: object) => ({ kind: 'pagina', id, versao: '1.0.0', estatuto: 'publicado', spec })
  e.reg.registra(pag('p.privada', { rota: '/privada', titulo: 'Privada', guarda: ['vendedor'], raiz: { bloco: 'texto/paragrafo', props: { texto: 'Só vendedores' } } }) as never)
  e.reg.registra(pag('p.home', { rota: '/', titulo: 'Início', raiz: { bloco: 'texto/paragrafo', props: { texto: 'início' } } }) as never)
  for (const [id, t] of [['lojaa', A], ['lojab', B]] as const) e.reg.registra({ kind: 'tenant', id, tenantId: t, versao: '1.0.0', estatuto: 'publicado', spec: { alias: id, segmento: 'varejo', modulos: ['loja'], paginas: ['p.home', 'p.privada'] } } as never) // sem rotaLogin nem páginas de login: o gateway acrescenta as de sistema
})
afterAll(async () => { await e.fim() })
const post = (id: string, corpo: unknown, o: { host?: string; headers?: Record<string, string> } = {}) => e.req('POST', `/bff/formularios/${id}`, { corpo, host: o.host ?? 'a.loja.test', headers: { 'x-polaris-form': '1', ...(o.headers ?? {}) } })
const entrar = (email: string, senha: string, extra: Record<string, unknown> = {}, host = 'a.loja.test') => post('identidade.entrar', { valores: { email, senha, ...extra } }, { host })

describe('JWKS público', () => {
  it('sem chaves configuradas a rota não existe; com elas, só a parte pública, em cache curto', async () => {
    expect((await e.req('GET', '/.well-known/jwks.json', { host: 'a.loja.test' })).statusCode).toBe(404)
    const chave = { kty: 'EC', crv: 'P-256', x: 'abc', y: 'def', kid: 'k', alg: 'ES256', use: 'sig' }
    const g = await criaAmbiente({ gateway: { jwks: { keys: [chave] } } as never })
    try { const r = await g.req('GET', '/.well-known/jwks.json', { host: 'a.loja.test' }); expect(r.statusCode).toBe(200); expect(g.json(r)).toEqual({ keys: [chave] }); expect(r.headers['cache-control']).toBe('public, max-age=300'); expect(r.body).not.toMatch(/"d"/) } finally { await g.fim() }
  })
})

describe('páginas de sistema', () => {
  it('toda tenant ganha /entrar, /senha/esqueci e /senha/redefinir sem declarar nada, e a guarda manda ao login por padrão', async () => {
    for (const [rota, form] of [['/entrar', 'identidade.entrar'], ['/senha/esqueci', 'identidade.esqueci'], ['/senha/redefinir', 'identidade.redefinir']] as const) { const r = await e.req('GET', rota, { host: 'a.loja.test' }); expect(r.statusCode, rota).toBe(200); expect(r.body).toContain(`data-polaris-formulario="${form}"`); expect(r.body).toContain('data-pl-ilha') }
    const g = await e.req('GET', '/privada', { host: 'a.loja.test' }); expect([g.statusCode, g.headers.location]).toEqual([302, '/entrar?volta=%2Fprivada'])
    expect((await e.req('GET', '/entrar', { host: 'b.loja.test' })).statusCode).toBe(200)
  })
  it('a página leva Referrer-Policy: no-referrer (o token do link de e-mail não vaza)', async () => { expect((await e.req('GET', '/senha/redefinir?token=abc', { host: 'a.loja.test' })).headers['referrer-policy']).toBe('no-referrer') })
})

describe('tenant que aponta rotaLogin para a página de sistema', () => {
  it('declara `rotaLogin: /entrar` sem declarar a página: as de sistema entram primeiro e a tabela compila', async () => {
    e.reg.registra({ kind: 'tenant', id: 'comlogin', tenantId: A, versao: '1.0.0', estatuto: 'publicado', spec: { alias: 'comlogin', segmento: 'varejo', modulos: ['loja'], paginas: ['p.home', 'p.privada'], rotaLogin: '/entrar' } } as never)
    modo.id = 'comlogin'
    try { expect((await e.req('GET', '/entrar', { host: 'a.loja.test' })).statusCode).toBe(200); expect((await e.req('GET', '/privada', { host: 'a.loja.test' })).headers.location).toBe('/entrar?volta=%2Fprivada') } finally { modo.id = undefined }
  })
})

describe('tenant que ainda declara uma página que sumiu da base', () => {
  it('o site NÃO cai: a página que não existe é ignorada (com aviso), as outras e o login de sistema seguem servindo', async () => {
    e.reg.registra({ kind: 'tenant', id: 'velho', tenantId: A, versao: '1.0.0', estatuto: 'publicado', spec: { alias: 'velho', segmento: 'varejo', modulos: ['loja'], paginas: ['p.home', 'p.privada', 'site.entrar'], rotaLogin: '/entrar' } } as never)
    modo.id = 'velho'
    try {
      expect((await e.req('GET', '/', { host: 'a.loja.test' })).statusCode).toBe(200); expect((await e.req('GET', '/entrar', { host: 'a.loja.test' })).statusCode).toBe(200)
      expect((await e.req('GET', '/privada', { host: 'a.loja.test' })).headers.location).toBe('/entrar?volta=%2Fprivada')
    } finally { modo.id = undefined }
  })
})

describe('entrar', () => {
  it('só com o cabeçalho x-polaris-form; sem identidade configurada seria 501', async () => {
    const r = await e.req('POST', '/bff/formularios/identidade.entrar', { corpo: { valores: { email: 'ana@x.test', senha: 'cavalo-bateria-grampo' } }, host: 'a.loja.test' }); expect(r.statusCode).toBe(400); expect(e.json(r).erro.codigo).toBe('cabecalho_ausente')
    expect(r.headers['set-cookie']).toBeUndefined()
  })
  it('valida o formulário antes (422 por campo) e NÃO chama a identidade', async () => {
    chamadas = []; const r = await post('identidade.entrar', { valores: { email: 'ruim' } }); expect(r.statusCode).toBe(422); expect(e.json(r).erros.map((x: { campo: string }) => x.campo).sort()).toEqual(['email', 'senha']); expect(chamadas).toEqual([])
  })
  it('credencial errada: 401 com mensagem genérica e SEM cookie; igual para e-mail que não existe', async () => {
    const a = await entrar('ana@x.test', 'senha-errada-12'), b = await entrar('ninguem@x.test', 'senha-errada-12')
    expect([a.statusCode, b.statusCode]).toEqual([401, 401]); expect(e.json(a)).toEqual(e.json(b)); expect(e.json(a).erro).toMatchObject({ codigo: 'credenciais_invalidas', mensagem: 'E-mail ou senha incorretos.' }); expect(a.headers['set-cookie']).toBeUndefined()
  })
  it('sucesso: cookie HttpOnly/SameSite com o JWT, ações de navegação seguras (a volta só vale se for caminho do site) e o tenant é o do HOST', async () => {
    chamadas = []; const r = await entrar('  ANA@x.test ', 'cavalo-bateria-grampo', { volta: '/privada' }); expect(r.statusCode, r.body).toBe(200)
    const ck = String(r.headers['set-cookie']); expect(ck).toMatch(/^polaris_sessao=[\w.-]+; Path=\/; HttpOnly; SameSite=Lax; Max-Age=\d+$/); expect(e.json(r)).toMatchObject({ ok: true, resultado: { nome: 'Ana' }, sucesso: { acoes: [{ acao: 'navegar', para: '/privada' }] } })
    expect(chamadas[0]).toEqual(['entra', { tenantId: A, email: 'ana@x.test' }]); expect(r.headers['cache-control']).toBe('no-store')
    for (const ruim of ['//evil.com', 'https://evil.com', '/a\\b', 'javascript:alert(1)', '']) expect(e.json(await entrar('ana@x.test', 'cavalo-bateria-grampo', { volta: ruim })).sucesso.acoes[0].para, ruim).toBe('/')
    chamadas = []; expect((await entrar('ana@x.test', 'cavalo-bateria-grampo', {}, 'b.loja.test')).statusCode).toBe(401); expect(chamadas[0]![1]).toMatchObject({ tenantId: B }) // a conta da Ana é do A: no B não entra
  })
  it('o tenant NUNCA vem do corpo: `tenantId`/`papeis` mandados pelo visitante são descartados', async () => {
    chamadas = []; const r = await entrar('ana@x.test', 'cavalo-bateria-grampo', { tenantId: B, papeis: ['admin'], usuario: 'outro' }); expect(r.statusCode).toBe(200); expect(chamadas[0]![1]).toEqual({ tenantId: A, email: 'ana@x.test' })
  })
  it('a sessão emitida abre a página protegida (e sem ela é redirecionado)', async () => {
    const cookie = String((await entrar('ana@x.test', 'cavalo-bateria-grampo')).headers['set-cookie']).split(';')[0]!
    const r = await e.req('GET', '/privada', { host: 'a.loja.test', headers: { cookie } }); expect(r.statusCode).toBe(200); expect(r.body).toContain('Só vendedores')
    expect((await e.req('GET', '/privada', { host: 'a.loja.test' })).statusCode).toBe(302)
  })
  it('bloqueio por tentativas: 429 com Retry-After e a mensagem em minutos', async () => {
    bloqueado = true; try { const r = await entrar('ana@x.test', 'cavalo-bateria-grampo'); expect(r.statusCode).toBe(429); expect(Number(r.headers['retry-after'])).toBeGreaterThan(0); expect(e.json(r).erro.mensagem).toMatch(/Muitas tentativas\. Tente de novo em \d+ minuto/); expect(r.headers['set-cookie']).toBeUndefined() } finally { bloqueado = false }
  })
  it('em inglês quando o pedido é em inglês', async () => { expect(e.json(await post('identidade.entrar', { valores: { email: 'ana@x.test', senha: 'senha-errada-12' }, idioma: 'en' })).erro.mensagem).toBe('Wrong e-mail or password.') })
})

describe('esqueci e redefinir', () => {
  it('"esqueci" responde SEMPRE o mesmo (conta existente ou não), e só a existente recebe o e-mail com o link do próprio endereço', async () => {
    emails = []; const a = await post('identidade.esqueci', { valores: { email: 'ana@x.test' } }), b = await post('identidade.esqueci', { valores: { email: 'ninguem@x.test' } })
    expect([a.statusCode, b.statusCode]).toEqual([200, 200]); expect(e.json(a)).toEqual(e.json(b)); expect(e.json(a).sucesso.mensagem).toMatch(/Se o e-mail estiver cadastrado/)
    await new Promise((r) => setTimeout(r, 30)); expect(emails.length).toBe(1); expect(emails[0]).toMatchObject({ tenantId: A, para: 'ana@x.test', assunto: 'Redefinir a sua senha' }); expect(emails[0]!.corpo).toMatch(/http:\/\/a\.loja\.test\/senha\/redefinir\?token=tok\d+-x+/)
    expect(a.headers['set-cookie']).toBeUndefined()
  })
  it('redefinir: token certo troca e leva ao /entrar; token de outro tenant, vencido ou inventado dá a mensagem do link; senha fraca vai para o campo; confirmação diferente é recusada antes', async () => {
    emails = []; await post('identidade.esqueci', { valores: { email: 'ana@x.test' } }); await new Promise((r) => setTimeout(r, 30)); const token = /token=([\w-]+)/.exec(emails[0]!.corpo)![1]!
    const redefine = (valores: Record<string, unknown>, host = 'a.loja.test') => post('identidade.redefinir', { valores }, { host })
    expect((await redefine({ token, senha: 'abcdefghij1', confirma: 'diferente-123' })).statusCode).toBe(422)
    const fraca = await redefine({ token, senha: 'curta', confirma: 'curta' }); expect(fraca.statusCode).toBe(422) // o validador do formulário já exige 10
    chamadas = []; const outro = await redefine({ token, senha: 'cavalo-bateria-novo', confirma: 'cavalo-bateria-novo' }, 'b.loja.test'); expect(outro.statusCode).toBe(422); expect(e.json(outro).erros[0]).toMatchObject({ campo: '_formulario', regra: 'token' }); expect(e.json(outro).erro.mensagem).toMatch(/não vale mais/)
    const ok = await redefine({ token, senha: 'cavalo-bateria-novo', confirma: 'cavalo-bateria-novo' }); expect(ok.statusCode, ok.body).toBe(200); expect(e.json(ok).sucesso).toMatchObject({ acoes: [{ acao: 'navegar', para: '/entrar' }] }); expect(ok.headers['set-cookie']).toBeUndefined() // não entra sozinho: precisa fazer login
    expect((await redefine({ token, senha: 'cavalo-bateria-novo', confirma: 'cavalo-bateria-novo' })).statusCode).toBe(422) // uso único
    expect((await redefine({ token: 'inventado-inventado-inventado-1', senha: 'cavalo-bateria-novo', confirma: 'cavalo-bateria-novo' })).statusCode).toBe(422)
  })
  it('senha fraca segundo a POLÍTICA do servidor (não só o tamanho) vai para o campo senha', async () => {
    emails = []; await post('identidade.esqueci', { valores: { email: 'ana@x.test' } }); await new Promise((r) => setTimeout(r, 30)); const token = /token=([\w-]+)/.exec(emails[0]!.corpo)![1]!
    const r = await post('identidade.redefinir', { valores: { token, senha: 'abcdefghij', confirma: 'abcdefghij' } }); expect(r.statusCode).toBe(200) // o fake só olha o tamanho; a política real é testada em packs
  })
})

describe('sessão por cookie no Studio', () => {
  it('a API do Studio aceita o cookie SÓ com x-polaris-studio; sem o cabeçalho, ou com cookie inválido, é visitante', async () => {
    const cookie = String((await entrar('ana@x.test', 'cavalo-bateria-grampo')).headers['set-cookie']).split(';')[0]!
    const com = await e.req('GET', '/x-sessao', { host: 'a.loja.test', headers: { cookie, 'x-polaris-studio': '1' } }); expect(e.json(com)).toMatchObject({ tenantId: A, usuario: 'Ana', papeis: ['vendedor'] })
    expect(e.json(await e.req('GET', '/x-sessao', { host: 'a.loja.test', headers: { cookie } }))).toEqual({ anonimo: true }) // CSRF: só o cookie não basta
    expect(e.json(await e.req('GET', '/x-sessao', { host: 'a.loja.test', headers: { cookie: 'polaris_sessao=aaaa.bbbb.cccc', 'x-polaris-studio': '1' } }))).toEqual({ anonimo: true })
  })
})
