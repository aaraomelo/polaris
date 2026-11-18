import { createHash, randomBytes } from 'node:crypto'
import { Readable } from 'node:stream'
import { compilaTabela, resolveRota, type Programa, type TabelaRotas } from '@polaris/engine'
import { empacotaCliente } from '@polaris/engine/aot'
import { streamVivo } from '@polaris/engine/servidor-vivo'
import { cssDoTema } from '@polaris/engine/tema'
import type { Registry } from '@polaris/schema'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import type { CtxGw } from './gateway'

// ---------------------------------------------------------------------------------------------------------------------------------------------
// SERVIDOR DE PÁGINAS: o que faltava entre o roteamento declarativo e o navegador. `tenant` + `pagina` → tabela de rotas (compilada UMA vez por release) → página →
// HTML em streaming (`streamVivo`), com os dados carregados pelo MESMO caminho do BFF (serviços, cache escopado, o token do visitante) e o cliente hidratando.
// O tenant vem do host/token (nunca da URL); a página é a do registro DESSE tenant (a release de produção dele). Falha de dado vira erro daquele dado, não derruba a página.
// ---------------------------------------------------------------------------------------------------------------------------------------------

export type OpcoesPaginas = {
  /** id do nó `tenant` (que declara `paginas`, idiomas, login, 404…) do tenant da requisição; `undefined` = o tenant não publica páginas */
  tenantNo(ctx: CtxGw): string | undefined | Promise<string | undefined>
  /** o cookie de sessão leva `Secure` (padrão: sim; só desligue em desenvolvimento, em http) */
  cookieSeguro?: boolean
  /** permissões da sessão para as `guarda` das páginas (padrão: os papéis do token) */
  permissoes?(ctx: CtxGw): readonly string[]
}
export type DepsPaginas = {
  entra(req: FastifyRequest): Promise<CtxGw>
  programaDe(ctx: CtxGw, id: string): { programa: Programa }
  opcoesCarga(ctx: CtxGw, programa: Programa, req: FastifyRequest, extra: { params?: Record<string, unknown>; consulta?: Record<string, unknown> }, falhas?: unknown[]): Record<string, unknown>
  registroDe(ctx: CtxGw, fallback: Registry): Registry
  registro: Registry
  log: { warn(m: string, c?: Record<string, unknown>): void }
}

export const COOKIE_SESSAO = 'polaris_sessao'
const SESSAO_SEGUNDOS = 8 * 3600
const TOKEN = /^[A-Za-z0-9_-]{4,3000}(\.[A-Za-z0-9_-]{1,3000}){2}$/
/** o cookie é `HttpOnly` (o JavaScript da página não o lê), `SameSite=Lax` (não vai em POST de outro site) e SEM `Domain` (vale só para o host do tenant) */
export const cookieDeSessao = (token: string | null, seguro = true) => `${COOKIE_SESSAO}=${token ?? ''}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${token ? SESSAO_SEGUNDOS : 0}${seguro ? '; Secure' : ''}`
const lerCookie = (h: string | undefined): string | null => {
  if (!h || h.length > 8192) return null
  for (const par of h.split(';')) { const i = par.indexOf('='); if (i > 0 && par.slice(0, i).trim() === COOKIE_SESSAO) { const v = par.slice(i + 1).trim(); return TOKEN.test(v) ? v : null } }
  return null
}
const RESERVADO = /^\/(api|bff|studio|graphql|_polaris|metricas|saude)(\/|$)/
const sha = (s: string) => createHash('sha256').update(s).digest('hex').slice(0, 16)
const CSP = (nonce: string) => `default-src 'none'; script-src 'nonce-${nonce}' 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'`
const NEGADO_TXT = (c: number) => (c === 404 ? 'Página não encontrada' : c === 403 ? 'Acesso negado' : c === 401 ? 'Autenticação necessária' : 'Erro')

export function instalaPaginas(app: FastifyInstance, o: OpcoesPaginas, d: DepsPaginas): void {
  const tabelas = new Map<string, TabelaRotas | null>()
  const ativos = new Map<string, { tipo: string; corpo: string }>() // JS do cliente e CSS do tema, endereçados pelo conteúdo
  const bundles = new WeakMap<Programa, Promise<string | null>>()
  const guarda = (nome: string, tipo: string, corpo: string) => { if (!ativos.has(nome)) { ativos.set(nome, { tipo, corpo }); while (ativos.size > 400) ativos.delete(ativos.keys().next().value as string) } return `/_polaris/a/${nome}` }

  app.get('/_polaris/a/:nome', async (req, reply) => {
    const a = ativos.get((req.params as { nome: string }).nome)
    if (!a) return reply.status(404).type('text/plain').send('não encontrado')
    return reply.header('cache-control', 'public, max-age=31536000, immutable').type(a.tipo).send(a.corpo) // o nome é o hash do conteúdo
  })

  const clienteDe = (programa: Programa): Promise<string | null> => {
    let p = bundles.get(programa)
    if (!p) { p = empacotaCliente(programa).then((r) => (r.ok ? guarda(`${sha(r.pacote.codigo)}.js`, 'text/javascript; charset=utf-8', r.pacote.codigo) : null)); bundles.set(programa, p) }
    return p
  }
  const temaDe = (reg: Registry, ctx: CtxGw, tenantNo: string): string[] => {
    const id = (reg.resolve('tenant', tenantNo, { tenantId: ctx.tenantId })?.no.spec as { tema?: string } | undefined)?.tema ?? 'padrao'
    const t = reg.resolve('tema', id, { tenantId: ctx.tenantId })
    if (!t) return []
    const css = cssDoTema(t.no)
    return [guarda(`${sha(css)}.css`, 'text/css; charset=utf-8', css)]
  }
  const tabelaDe = (reg: Registry, ctx: CtxGw, tenantNo: string, chaveRelease: string): TabelaRotas | null => {
    const no = reg.resolve('tenant', tenantNo, { tenantId: ctx.tenantId })?.no
    if (!no) return null
    const chave = `${ctx.tenantId}|${chaveRelease}|${no.id}|${no.versao}`
    if (tabelas.has(chave)) return tabelas.get(chave)!
    const r = compilaTabela(reg, no, { tenantId: ctx.tenantId })
    if (!r.ok) d.log.warn('as rotas do tenant não compilam', { tenant: ctx.tenantId, erros: r.erros.length })
    tabelas.set(chave, r.ok ? r.tabela : null)
    while (tabelas.size > 200) tabelas.delete(tabelas.keys().next().value as string)
    return r.ok ? r.tabela : null
  }
  const texto = (reply: FastifyReply, status: number, msg = NEGADO_TXT(status)) => reply.status(status).header('content-security-policy', "default-src 'none'; frame-ancestors 'none'").type('text/plain; charset=utf-8').send(msg)

  async function renderiza(reply: FastifyReply, req: FastifyRequest, ctx: CtxGw, tenantNo: string, paginaId: string, status: number, params: Record<string, unknown>, idioma: string | undefined, reg: Registry) {
    let programa: Programa
    try { programa = d.programaDe(ctx, paginaId).programa } catch { return texto(reply, 500, 'a página tem erros e não pode ser exibida') }
    const clienteSrc = await clienteDe(programa)
    if (!clienteSrc) return texto(reply, 501, 'a página usa recursos que o navegador ainda não suporta')
    const consulta: Record<string, unknown> = Object.create(null)
    for (const [k, v] of new URLSearchParams(String(req.url.split('?')[1] ?? '').slice(0, 4096))) { if (k.length <= 60 && v.length <= 500 && Object.keys(consulta).length < 50 && !['__proto__', 'constructor', 'prototype'].includes(k)) consulta[k] = v }
    const nonce = randomBytes(16).toString('base64')
    const falhas: unknown[] = []
    const g = streamVivo(programa, { ...(d.opcoesCarga(ctx, programa, req, { params, consulta }, falhas) as object), clienteSrc, nonce, estilos: temaDe(reg, ctx, tenantNo), ...(idioma ? { lang: idioma } : {}) } as never)
    const it = g[Symbol.asyncIterator]()
    let primeiro: IteratorResult<string>
    try { primeiro = await it.next() } catch (e) { d.log.warn('página fora do runtime', { pagina: paginaId, erro: (e as Error).message }); return texto(reply, 501, 'a página usa recursos que o navegador ainda não suporta') }
    async function* resto() { if (!primeiro.done) yield primeiro.value; for (;;) { const n = await it.next(); if (n.done) return; yield n.value } }
    return reply.status(status).header('content-security-policy', CSP(nonce)).type('text/html; charset=utf-8').send(Readable.from(resto()))
  }

  const seguro = o.cookieSeguro !== false
  // troca um token válido (emitido pelo provedor de identidade) por uma sessão no navegador. JSON obrigatório: um formulário de outro site não consegue enviar `application/json` sem preflight.
  app.post('/_polaris/sessao', async (req, reply) => {
    if (!String(req.headers['content-type'] ?? '').toLowerCase().startsWith('application/json')) return texto(reply, 415, 'envie application/json')
    const token = (req.body as { token?: unknown } | null)?.token
    if (typeof token !== 'string' || !TOKEN.test(token)) return texto(reply, 400, 'token inválido')
    req.headers.authorization = `Bearer ${token}`
    const ctx = await d.entra(req); if (ctx.anonimo) return texto(reply, 401)
    return reply.status(204).header('set-cookie', cookieDeSessao(token, seguro)).send()
  })
  app.post('/_polaris/sair', async (_req, reply) => reply.status(204).header('set-cookie', cookieDeSessao(null, seguro)).send())

  const trata = async (req: FastifyRequest, reply: FastifyReply) => {
    const [caminho = '/', ...q] = req.url.split('?'), consulta = q.join('?')
    if (RESERVADO.test(caminho)) return reply.status(404).send({ erro: { codigo: 'rota_inexistente', mensagem: 'rota inexistente' } })
    // sessão por cookie: só serve para PÁGINAS (GET). A API continua exigindo o cabeçalho Authorization, então um site de outra origem não consegue agir em nome do visitante.
    const doCookie = req.headers.authorization === undefined ? lerCookie(req.headers.cookie) : null
    if (doCookie) req.headers.authorization = `Bearer ${doCookie}`
    let ctx: CtxGw
    try { ctx = await d.entra(req) } catch (err) {
      if (!doCookie || (err as { status?: number }).status !== 401) throw err
      delete req.headers.authorization; reply.header('set-cookie', cookieDeSessao(null, seguro)) // sessão expirada ou inválida: some o cookie e a página sai como anônima (a guarda leva ao login)
      ctx = await d.entra(req)
    }
    const tenantNo = await o.tenantNo(ctx)
    if (!tenantNo) return texto(reply, 404)
    const reg = d.registroDe(ctx, d.registro)
    const tabela = tabelaDe(reg, ctx, tenantNo, ctx.releaseChave ?? 'unico')
    if (!tabela) return texto(reply, 404)
    const r = resolveRota(tabela, { caminho, ...(consulta ? { consulta } : {}), sessao: ctx.anonimo ? null : { permissoes: o.permissoes?.(ctx) ?? ctx.papeis ?? [] } })
    switch (r.tipo) {
      case 'redireciona': return reply.redirect(r.para, r.status)
      case 'invalida': return texto(reply, 400, 'requisição inválida')
      case 'negado': return r.pagina ? renderiza(reply, req, ctx, tenantNo, r.pagina, r.status, {}, undefined, reg) : texto(reply, r.status)
      case 'nao-encontrada': return r.pagina ? renderiza(reply, req, ctx, tenantNo, r.pagina, 404, {}, undefined, reg) : texto(reply, 404)
      case 'pagina': return renderiza(reply, req, ctx, tenantNo, r.pagina, 200, r.params, r.idioma || undefined, reg)
    }
  }
  app.get('/favicon.ico', async (_req, reply) => reply.status(204).header('cache-control', 'public, max-age=86400').send()) // sem ícone próprio ainda: 204, não um 404 em todo carregamento
  app.get('/', trata)
  app.get('/*', trata)
}
