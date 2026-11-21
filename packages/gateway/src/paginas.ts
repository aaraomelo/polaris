import { createHash, randomBytes } from 'node:crypto'
import { Readable } from 'node:stream'
import { compilaTabela, resolveRota, type Programa, type TabelaRotas } from '@polaris/engine'
import { empacotaCliente, empacotaIlhaFormulario, usoDoPrograma } from '@polaris/engine/aot'
import { streamVivo } from '@polaris/engine/servidor-vivo'
import { cssFontFace, bytesDaFonte } from '@polaris/engine/fontes'
import { cssDoTema } from '@polaris/engine/tema'
import type { Registry } from '@polaris/schema'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import type { CtxGw } from './gateway'
import { CABECALHO_NAV, ROTEADOR_JS } from './navegacao'

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
  /** as imagens do tenant (`/_polaris/img/<sha256>.<ext>`): o tenant vem do ENDEREÇO, nunca da URL; sem isto a rota não existe */
  imagens?: { le(tenantId: string, hash: string, largura?: number): Promise<{ tipo: string; bytes: Uint8Array } | null> }
}
export type DepsPaginas = {
  entra(req: FastifyRequest): Promise<CtxGw>
  programaDe(ctx: CtxGw, id: string): { programa: Programa }
  opcoesCarga(ctx: CtxGw, programa: Programa, req: FastifyRequest, extra: { params?: Record<string, unknown>; consulta?: Record<string, unknown> }, falhas?: unknown[]): Record<string, unknown>
  registroDe(ctx: CtxGw, fallback: Registry): Registry
  registro: Registry
  /** links de pré-visualização assinados (o mesmo do `x-polaris-preview` do BFF); sem isto, `/_polaris/preview` não existe */
  preview?: { verifica(token: string): { tenantId: string; release: number } | null; registro(tenantId: string, release: number): Promise<Registry | null> }
  log: { warn(m: string, c?: Record<string, unknown>): void }
}

export const COOKIE_SESSAO = 'polaris_sessao'
export const COOKIE_PREVIEW = 'polaris_preview'
const SESSAO_SEGUNDOS = 8 * 3600
const TOKEN = /^[A-Za-z0-9_-]{4,3000}(\.[A-Za-z0-9_-]{1,3000}){2}$/
/** o cookie é `HttpOnly` (o JavaScript da página não o lê), `SameSite=Lax` (não vai em POST de outro site) e SEM `Domain` (vale só para o host do tenant) */
export const cookieDeSessao = (token: string | null, seguro = true) => `${COOKIE_SESSAO}=${token ?? ''}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${token ? SESSAO_SEGUNDOS : 0}${seguro ? '; Secure' : ''}`
export const lerCookie = (h: string | undefined): string | null => {
  if (!h || h.length > 8192) return null
  for (const par of h.split(';')) { const i = par.indexOf('='); if (i > 0 && par.slice(0, i).trim() === COOKIE_SESSAO) { const v = par.slice(i + 1).trim(); return TOKEN.test(v) ? v : null } }
  return null
}
const PREVIEW_SEGUNDOS = 24 * 3600
const cookiePreview = (token: string | null, seguro = true) => `${COOKIE_PREVIEW}=${token ?? ''}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${token ? PREVIEW_SEGUNDOS : 0}${seguro ? '; Secure' : ''}`
const lerPreview = (h: string | undefined): string | null => {
  if (!h || h.length > 8192) return null
  for (const par of h.split(';')) { const i = par.indexOf('='); if (i > 0 && par.slice(0, i).trim() === COOKIE_PREVIEW) { const v = par.slice(i + 1).trim(); return /^v1\.[A-Za-z0-9_-]{4,1500}\.[A-Za-z0-9_-]{20,200}$/.test(v) ? v : null } }
  return null
}
const faixaPreview = (n: number) => `<div id="pl-preview" style="position:sticky;top:0;z-index:2147483647;background:#f59e0b;color:#111;padding:6px 12px;font:14px system-ui,sans-serif">Pré-visualização da release ${n} (não é o site publicado) · <a href="/_polaris/preview/sair" style="color:#111">sair</a></div>`
const RESERVADO = /^\/(api|bff|studio|graphql|_polaris|_dev|metricas|saude|\.well-known)(\/|$)/
const sha = (s: string | Buffer) => createHash('sha256').update(s).digest('hex').slice(0, 16)
const CSP = (nonce: string) => `default-src 'none'; script-src 'nonce-${nonce}' 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'`
const NEGADO_TXT = (c: number) => (c === 404 ? 'Página não encontrada' : c === 403 ? 'Acesso negado' : c === 401 ? 'Autenticação necessária' : 'Erro')

export function instalaPaginas(app: FastifyInstance, o: OpcoesPaginas, d: DepsPaginas): void {
  const tabelas = new Map<string, TabelaRotas | null>()
  const ativos = new Map<string, { tipo: string; corpo: string | Buffer }>() // JS do cliente e CSS do tema, endereçados pelo conteúdo
  const bundles = new WeakMap<Programa, Promise<string | null>>()
  const guarda = (nome: string, tipo: string, corpo: string | Buffer) => { if (!ativos.has(nome)) { ativos.set(nome, { tipo, corpo }); while (ativos.size > 400) ativos.delete(ativos.keys().next().value as string) } return `/_polaris/a/${nome}` }

  app.get('/_polaris/a/:nome', async (req, reply) => {
    const a = ativos.get((req.params as { nome: string }).nome)
    if (!a) return reply.status(404).type('text/plain').send('não encontrado')
    return reply.header('cache-control', 'public, max-age=31536000, immutable').type(a.tipo).send(a.corpo) // o nome é o hash do conteúdo
  })

  if (o.imagens) {
    const EXT: Record<string, string> = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp' }
    app.get<{ Params: { arq: string }; Querystring: { w?: string } }>('/_polaris/img/:arq', async (req, reply) => {
      const m = /^([0-9a-f]{64})\.(png|jpg|gif|webp)$/.exec(req.params.arq); if (!m) return reply.status(404).type('text/plain').send('não encontrado')
      const w = req.query.w; if (w !== undefined && (!/^[0-9]{2,4}$/.test(w) || m[2] !== 'webp')) return reply.status(404).type('text/plain').send('não encontrado') // as versões menores são sempre `.webp?w=<largura>`
      const ctx = await d.entra(req), a = await o.imagens!.le(ctx.tenantId, m[1]!, w === undefined ? undefined : Number(w))
      if (!a || (w === undefined && EXT[a.tipo] !== m[2])) return reply.status(404).type('text/plain').send('não encontrado') // outro tenant, hash inexistente ou extensão que não é a do tipo: o mesmo 404
      const etag = `"${m[1]}${w === undefined ? '' : `-${w}`}"`
      reply.header('etag', etag).header('cache-control', 'public, max-age=31536000, immutable').header('x-content-type-options', 'nosniff').header('content-security-policy', "default-src 'none'; sandbox") // sem Cross-Origin-Resource-Policy: a prévia do Studio (iframe sandbox, origem opaca) precisa carregar a imagem; ela é pública de qualquer jeito
      if (req.headers['if-none-match'] === etag) return reply.status(304).send()
      return reply.type(a.tipo).send(Buffer.from(a.bytes)) // o conteúdo nunca muda (o nome é o hash): cache eterno
    })
  }

  const roteadorSrc = guarda(`${sha(ROTEADOR_JS)}.js`, 'text/javascript; charset=utf-8', ROTEADOR_JS)
  const clienteDe = (programa: Programa): Promise<string | null> => {
    let p = bundles.get(programa)
    if (!p) { p = empacotaCliente(programa).then((r) => (r.ok ? guarda(`${sha(r.pacote.codigo)}.js`, 'text/javascript; charset=utf-8', r.pacote.codigo) : null)); bundles.set(programa, p) }
    return p
  }
  /** o pacote da ilha de formulário, só para páginas que usam `form/formulario` (um para todas, endereçado pelo conteúdo) */
  let ilhaSrc: Promise<string> | null = null
  const ilhaDe = (programa: Programa): Promise<string | null> => (usoDoPrograma(programa).interfaces.includes('form/formulario') ? (ilhaSrc ??= empacotaIlhaFormulario().then((c) => guarda(`${sha(c)}.js`, 'text/javascript; charset=utf-8', c))) : Promise.resolve(null))
  const temaDe = (reg: Registry, ctx: CtxGw, tenantNo: string): string[] => {
    const id = (reg.resolve('tenant', tenantNo, { tenantId: ctx.tenantId })?.no.spec as { tema?: string } | undefined)?.tema ?? 'padrao'
    const t = reg.resolve('tema', id, { tenantId: ctx.tenantId })
    if (!t) return []
    // fontes embutidas que o tema pede: o arquivo é servido como ativo (endereçado pelo conteúdo, cache eterno) e o @font-face aponta para ele
    const pedidas = (t.no.spec as { fontes?: string[] }).fontes ?? []
    const css = cssDoTema(t.no, pedidas.length ? cssFontFace(pedidas, (arq) => { const b = bytesDaFonte(arq); return guarda(`${sha(b)}.woff2`, 'font/woff2', b) }) : '')
    return [guarda(`${sha(css)}.css`, 'text/css; charset=utf-8', css)]
  }
  const tabelaDe = (reg: Registry, ctx: CtxGw, tenantNo: string, chaveRelease: string): TabelaRotas | null => {
    const no = reg.resolve('tenant', tenantNo, { tenantId: ctx.tenantId })?.no
    if (!no) return null
    const chave = `${ctx.tenantId}|${chaveRelease}|${no.id}|${no.versao}`
    if (tabelas.has(chave)) return tabelas.get(chave)!
    // além das declaradas entram, uma a uma e só se a tabela continua compilando: as páginas de SISTEMA (`identidade.*`: entrar, esqueci, nova senha) e as que o PRÓPRIO tenant criou (Studio) com rota.
    // Uma que colide com as outras (mesma rota) é deixada de fora com um aviso, sem derrubar o site; o tenant pode trocar uma página de sistema pela dele (mesmo id, no escopo dele).
    const spec0 = no.spec as { paginas?: string[]; rotaLogin?: string }, declaradas = spec0.paginas ?? []
    const sistema = reg.ids('pagina').filter((id) => id.startsWith('identidade.') && !declaradas.includes(id))
    const proprias = reg.ids('pagina').filter((id) => !id.startsWith('identidade.') && !declaradas.includes(id) && reg.resolve('pagina', id, { tenantId: ctx.tenantId })?.escopo === 'tenant' && typeof (reg.resolve('pagina', id, { tenantId: ctx.tenantId })?.no.spec as { rota?: unknown }).rota === 'string')
    let lista = declaradas // as páginas declaradas que continuam existindo (uma removida da base não derruba o site inteiro)
    const monta = (extras: string[]) => ({ ...no, spec: { ...(no.spec as object), paginas: [...lista, ...extras], ...(!spec0.rotaLogin && extras.includes('identidade.entrar') ? { rotaLogin: '/entrar' } : {}) } }) as typeof no
    const tenta = (n: typeof no) => compilaTabela(reg, n, { tenantId: ctx.tenantId })
    let r = tenta(no), extras: string[] = []
    if (!r.ok && sistema.length) { const t = tenta(monta(sistema)); if (t.ok) { r = t; extras = [...sistema] } } // o tenant aponta `rotaLogin` para uma página que só as de sistema trazem
    if (!r.ok) {
      const faltam = declaradas.filter((id) => !reg.resolve('pagina', id, { tenantId: ctx.tenantId })), validas = declaradas.filter((id) => !faltam.includes(id))
      if (faltam.length) for (const cand of [[...sistema], []]) { lista = validas; const t = tenta(monta(cand)); if (t.ok) { r = t; extras = cand; d.log.warn('páginas declaradas pelo tenant não existem mais e foram ignoradas', { tenant: ctx.tenantId, paginas: faltam.slice(0, 10) }); break } lista = declaradas }
    }
    if (!r.ok) d.log.warn('as rotas do tenant não compilam', { tenant: ctx.tenantId, erros: r.erros.length })
    else for (const id of [...(extras.length ? [] : sistema), ...proprias]) {
      const t = tenta(monta([...extras, id]))
      if (t.ok) { extras = [...extras, id]; r = t } else d.log.warn('página deixada de fora das rotas (colide com outra)', { tenant: ctx.tenantId, pagina: id })
    }
    tabelas.set(chave, r.ok ? r.tabela : null)
    while (tabelas.size > 200) tabelas.delete(tabelas.keys().next().value as string)
    return r.ok ? r.tabela : null
  }
  const texto = (reply: FastifyReply, status: number, msg = NEGADO_TXT(status)) => reply.status(status).header('content-security-policy', "default-src 'none'; frame-ancestors 'none'").type('text/plain; charset=utf-8').send(msg)

  async function renderiza(reply: FastifyReply, req: FastifyRequest, ctx: CtxGw, tenantNo: string, paginaId: string, status: number, params: Record<string, unknown>, idioma: string | undefined, reg: Registry, previa: number | null = null, alternativas: Record<string, string> = {}) {
    let programa: Programa
    try { programa = d.programaDe(ctx, paginaId).programa } catch { return texto(reply, 500, 'a página tem erros e não pode ser exibida') }
    const clienteSrc = await clienteDe(programa), ilha = await ilhaDe(programa)
    if (!clienteSrc) return texto(reply, 501, 'a página usa recursos que o navegador ainda não suporta')
    const consulta: Record<string, unknown> = Object.create(null)
    for (const [k, v] of new URLSearchParams(String(req.url.split('?')[1] ?? '').slice(0, 4096))) { if (k.length <= 60 && v.length <= 500 && Object.keys(consulta).length < 50 && !['__proto__', 'constructor', 'prototype'].includes(k)) consulta[k] = v }
    const nonce = randomBytes(16).toString('base64')
    const falhas: unknown[] = []
    const navegando = req.headers[CABECALHO_NAV] === '1' // clique num link do site: a página inteira de uma vez (sem pedaços em streaming), para o cliente trocar o conteúdo
    const carga = d.opcoesCarga(ctx, programa, req, { params, consulta }, falhas) as { tenant?: Record<string, unknown> }
    // o seletor de idioma: a mesma página em cada idioma do tenant (`tenant.idiomas` nas expressões; vazio com um idioma só)
    const idiomas = Object.entries(alternativas).map(([l, href]) => ({ idioma: l, href, atual: l === idioma }))
    // o prefixo de URL do idioma da requisição ("" no idioma padrão, "/en" nos demais): os links internos da página o usam (`{tenant.prefixo + "/produtos"}`) e continuam no mesmo idioma
    const padrao = (reg.resolve('tenant', tenantNo, { tenantId: ctx.tenantId })?.no.spec as { idiomaPadrao?: string } | undefined)?.idiomaPadrao
    const prefixo = idioma && padrao && idioma !== padrao ? `/${idioma}` : ''
    const g = streamVivo(programa, { ...carga, ...(idioma ? { idioma } : {}), tenant: { ...carga.tenant, prefixo, ...(idiomas.length > 1 ? { idiomas } : {}) }, ...(idiomas.length > 1 ? { alternativas } : {}), clienteSrc, nonce, ...(navegando ? { esperaTudo: true } : {}), estilos: temaDe(reg, ctx, tenantNo), ...(idioma ? { lang: idioma } : {}) } as never)
    const it = g[Symbol.asyncIterator]()
    let primeiro: IteratorResult<string>
    try { primeiro = await it.next() } catch (e) { d.log.warn('página fora do runtime', { pagina: paginaId, erro: (e as Error).message }); return texto(reply, 501, 'a página usa recursos que o navegador ainda não suporta') }
    async function* resto() {
      const solta = (c0: string) => { const c = previa === null ? c0 : c0.replace('<div id="polaris">', `${faixaPreview(previa)}<div id="polaris">`); return soltaRoteador(c) }
      const soltaRoteador = (c: string) => c.endsWith('</body></html>') ? c.slice(0, -'</body></html>'.length) + `${ilha ? `<script nonce="${nonce}" src="${ilha}" data-pl-ilha async></script>` : ''}<script nonce="${nonce}" src="${roteadorSrc}" data-pl-router async></script></body></html>` : c // a ilha de formulário (se a página usa) e o roteador entram no fim do documento
      if (!primeiro.done) yield solta(primeiro.value)
      for (;;) { const n = await it.next(); if (n.done) return; yield solta(n.value) }
    }
    return reply.status(status).header('referrer-policy', 'no-referrer').header('vary', `Authorization, Cookie, ${CABECALHO_NAV}`).header('content-security-policy', CSP(nonce)).type('text/html; charset=utf-8').send(Readable.from(resto()))
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
  // "Sair" como LINK (GET): só desloga quando o pedido vem do próprio site ou digitado (`sec-fetch-site` same-origin/none, ou ausente em cliente sem o cabeçalho); de outro site, nada acontece (evita deslogar por <img>/link alheio)
  app.get('/_polaris/sair', async (req, reply) => {
    const de = req.headers['sec-fetch-site']
    reply.header('cache-control', 'no-store').header('referrer-policy', 'no-referrer')
    if (de === 'cross-site' || de === 'same-site') return reply.redirect('/', 303)
    return reply.header('set-cookie', cookieDeSessao(null, seguro)).redirect('/', 303)
  })
  app.post('/_polaris/sair', async (_req, reply) => reply.status(204).header('set-cookie', cookieDeSessao(null, seguro)).send())

  // ativar a pré-visualização: o link assinado vira um cookie HttpOnly (as páginas não mandam cabeçalho), só para o tenant do link; `sair` apaga
  app.get<{ Querystring: { t?: string } }>('/_polaris/preview', async (req, reply) => {
    if (!d.preview) return texto(reply, 404)
    const v = typeof req.query.t === 'string' && req.query.t.length <= 2048 ? d.preview.verifica(req.query.t) : null
    if (!v) return texto(reply, 401, 'o link de pré-visualização é inválido ou expirou')
    const ctx = await d.entra(req)
    if (v.tenantId !== ctx.tenantId) return texto(reply, 403, 'este link de pré-visualização é de outra conta')
    return reply.header('set-cookie', cookiePreview(req.query.t!, seguro)).header('x-robots-tag', 'noindex, nofollow').redirect('/', 302)
  })
  app.get('/_polaris/preview/sair', async (_req, reply) => reply.header('set-cookie', cookiePreview(null, seguro)).redirect('/', 302))

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
    // pré-visualização: com o cookie (válido e DESTE tenant) as páginas são as da release do link, não as de produção
    let previa: number | null = null
    const pc = d.preview ? lerPreview(req.headers.cookie) : null
    if (pc && d.preview) {
      const v = d.preview.verifica(pc), regP = v && v.tenantId === ctx.tenantId ? await d.preview.registro(v.tenantId, v.release) : null
      if (v && regP) { ctx = { ...ctx, registro: regP, releaseChave: `v${v.release}` }; previa = v.release; reply.header('x-robots-tag', 'noindex, nofollow') }
      else reply.header('set-cookie', cookiePreview(null, seguro)) // expirou, é de outro tenant ou a release não existe: some
    }
    const reg = d.registroDe(ctx, d.registro)
    const tabela = tabelaDe(reg, ctx, tenantNo, ctx.releaseChave ?? 'unico')
    if (!tabela) return texto(reply, 404)
    const r = resolveRota(tabela, { caminho, ...(consulta ? { consulta } : {}), sessao: ctx.anonimo ? null : { permissoes: o.permissoes?.(ctx) ?? ctx.papeis ?? [] } })
    switch (r.tipo) {
      case 'redireciona': return reply.redirect(r.para, r.status)
      case 'invalida': return texto(reply, 400, 'requisição inválida')
      case 'negado': return r.pagina ? renderiza(reply, req, ctx, tenantNo, r.pagina, r.status, {}, undefined, reg, previa) : texto(reply, r.status)
      case 'nao-encontrada': return r.pagina ? renderiza(reply, req, ctx, tenantNo, r.pagina, 404, {}, undefined, reg, previa) : texto(reply, 404)
      case 'pagina': return renderiza(reply, req, ctx, tenantNo, r.pagina, 200, r.params, r.idioma || undefined, reg, previa, r.alternativas)
    }
  }
  app.get('/favicon.ico', async (_req, reply) => reply.status(204).header('cache-control', 'public, max-age=86400').send()) // sem ícone próprio ainda: 204, não um 404 em todo carregamento
  app.get('/', trata)
  app.get('/*', trata)
}
