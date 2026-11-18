import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PGlite } from '@electric-sql/pglite'
import { PGLiteSocketServer } from '@electric-sql/pglite-socket'
import { registraBase, voltaSegura } from '@polaris/engine'
import { cookieDeSessao } from '@polaris/gateway'
import { registraTemas } from '@polaris/engine/tema'
import { SignJWT, exportJWK, generateKeyPair, importJWK } from 'jose'
import { configGateway, configServico } from './config'
import { montaGatewayComChave } from './gateway'
import { migraPlataforma } from './migra'
import { carregaNos } from './nos'
import { criaIdentidade } from '@polaris/packs'
import { montaServico } from './servico'

// AMBIENTE LOCAL: o mesmo gateway, o mesmo serviço e o mesmo Studio da produção, com o Postgres em PGlite (sem Docker), dados persistentes em disco, tenants de demonstração e um LOGIN DE
// DESENVOLVIMENTO que emite o JWT (HS256) que o provedor de identidade emitiria. Só roda em loopback e RECUSA produção: nada daqui é um modelo de segurança de produção.
const RAIZ = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
/** a senha dos usuários de demonstração (SÓ do ambiente local) */
export const SENHA_LOCAL = 'senha-dev-polaris'
export const emailLocal = (alias: string) => `ana@${alias}.test`
export const EMISSOR_LOCAL = 'https://id.polaris.local', AUDIENCIA_LOCAL = 'polaris'
export const TENANTS_LOCAIS = [
  { id: '11111111-1111-1111-1111-111111111111', alias: 'loja-demo', nome: 'Loja Demo', modulos: ['loja'] },
  { id: '22222222-2222-2222-2222-222222222222', alias: 'loja-outra', nome: 'Outra Loja', modulos: ['loja'] },
] as const
/** os papéis que o login de desenvolvimento oferece */
export const PAPEIS_LOCAIS = ['studio.editor', 'studio.comentarista', 'studio.leitor', 'gerente'] as const
const ALIAS = /^[a-z][a-z0-9-]{1,30}$/, USUARIO = /^[a-z][a-z0-9-]{0,30}$/
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)

export type OpcoesLocal = {
  /** pasta dos dados do Postgres (persistem entre execuções); `null` = em memória (testes) */
  dados?: string | null
  /** porta do gateway (padrão 3000; 0 = qualquer) */
  porta?: number
  /** pasta dos nós do serviço (padrão: exemplos/loja) */
  nos?: string
  /** os nós do SITE dos tenants de demonstração: tenants e páginas (padrão: exemplos/loja-site; `null` = sem site) */
  site?: string | null
  /** o Studio empacotado (padrão: apps/studio/dist) */
  studioDir?: string
  /** porta do Postgres para `psql` (padrão: qualquer) */
  pgPorta?: number
  silencioso?: boolean
}
export type Local = {
  porta: number
  /** a URL de um tenant: `http://<alias>.localhost:<porta>` (o navegador resolve *.localhost para o próprio computador) */
  urlTenant(alias: string): string
  pgUrl: string
  token(alias: string, papeis: readonly string[], usuario?: string): Promise<string>
  fecha(): Promise<void>
}

export async function sobeLocal(o: OpcoesLocal = {}): Promise<Local> {
  if (process.env.NODE_ENV === 'production') throw new Error('o ambiente local não roda com NODE_ENV=production (a autenticação aqui é de desenvolvimento)')
  const studioDir = o.studioDir ?? join(RAIZ, 'apps', 'studio', 'dist'), nosDir = o.nos ?? join(RAIZ, 'exemplos', 'loja')
  if (!existsSync(join(studioDir, 'index.html'))) throw new Error(`o Studio não foi empacotado (falta ${join(studioDir, 'index.html')}): rode \`pnpm --filter @polaris/studio-app build\``)
  const fecham: Array<() => Promise<void>> = []
  const fechaTudo = async () => { for (const f of fecham.reverse()) await f().catch(() => {}) }
  try {
    // 1. Postgres: PGlite com servidor de protocolo, para os pools `pg` de verdade se conectarem (papéis separados: migrador com BYPASSRLS e aplicação sem)
    if (o.dados) {
      mkdirSync(dirname(o.dados), { recursive: true }) // o PGlite só cria a última pasta
      // o PGlite é de UM processo só: dois abrindo a mesma pasta se sobrescrevem em silêncio (um perde o que o outro gravou). A trava é um arquivo com o pid de quem está usando.
      const trava = join(dirname(o.dados), 'ambiente.pid')
      if (existsSync(trava)) { const pid = Number(readFileSync(trava, 'utf8')); let vivo = false; try { process.kill(pid, 0); vivo = pid !== process.pid } catch { /* processo morto: trava velha */ } if (vivo) throw new Error(`já há um ambiente local usando estes dados (pid ${pid}); encerre-o antes`) }
      writeFileSync(trava, String(process.pid)); fecham.push(async () => { rmSync(trava, { force: true }) })
    }
    const db = new PGlite(o.dados ?? undefined); await db.waitReady; fecham.push(() => db.close())
    await db.exec(`DO $$ BEGIN
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'polaris_app') THEN CREATE ROLE polaris_app LOGIN; END IF;
      IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'polaris_migrador') THEN CREATE ROLE polaris_migrador LOGIN BYPASSRLS; END IF;
    END $$; GRANT CREATE ON DATABASE postgres TO polaris_migrador;`)
    const srv = new PGLiteSocketServer({ db, port: o.pgPorta ?? 0, host: '127.0.0.1', maxConnections: 20 }); await srv.start(); fecham.push(() => srv.stop())
    const pgPorta = /:(\d+)/.exec(srv.getServerConn())![1]!, pg = (papel: string) => `postgres://${papel}@127.0.0.1:${pgPorta}/postgres`
    // 2. esquema da plataforma (diretório de tenants, versões, releases, comentários) e os tenants de demonstração
    await migraPlataforma({ urlMigrador: pg('polaris_migrador'), papelPlataforma: 'polaris_app' })
    for (const t of TENANTS_LOCAIS) {
      await db.query(`INSERT INTO plataforma.tenant (id, alias, nome, segmento, packs, dono_email, status, chave) VALUES ($1, $2, $3, 'varejo', '{varejo}', $4, 'ativo', $5) ON CONFLICT (id) DO NOTHING`, [t.id, t.alias, t.nome, `${t.alias}@exemplo.local`, `chave-local-${t.alias}-xxxxxxxxxxxx`])
      for (const m of t.modulos) await db.query(`INSERT INTO plataforma.modulo (tenant_id, servico) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [t.id, m])
    }
    // usuários de DEMONSTRAÇÃO (idempotente): o login real do site e do Studio no ambiente local. A senha vale só aqui.
    const ident = criaIdentidade({ q: async (sql, params) => { const r = await db.query(sql, params as unknown[]); return { rows: r.rows as Array<Record<string, unknown>>, rowCount: r.affectedRows ?? r.rows.length } } })
    for (const t of TENANTS_LOCAIS) await ident.criaUsuario({ tenantId: t.id, email: emailLocal(t.alias), nome: 'Ana (demonstração)', papeis: ['studio.editor', 'gerente'], senha: SENHA_LOCAL })
    // 3. o serviço de exemplo (migra o próprio esquema com o papel migrador) e o gateway na frente, com o Studio
    const reg = carregaNos(nosDir)
    // chave de ASSINATURA da sessão: ES256, como em produção (quem verifica só tem a pública). Persiste em .polaris-local/ para os logins sobreviverem a reinícios; em memória, uma nova a cada subida.
    const arquivoChave = o.dados ? join(dirname(o.dados), 'chave-jwt.json') : null
    let privada: Record<string, unknown>
    if (arquivoChave && existsSync(arquivoChave)) privada = JSON.parse(readFileSync(arquivoChave, 'utf8')) as Record<string, unknown>
    else { const kp = await generateKeyPair('ES256', { extractable: true }); privada = { ...(await exportJWK(kp.privateKey)), alg: 'ES256', kid: 'local' }; if (arquivoChave) writeFileSync(arquivoChave, JSON.stringify(privada), { mode: 0o600 }) }
    const { d: _d, ...publica } = privada
    const jwt = { JWT_EMISSOR: EMISSOR_LOCAL, JWT_AUDIENCIA: AUDIENCIA_LOCAL, JWT_CHAVE_PUBLICA_JWK: JSON.stringify(publica), NODE_ENV: 'development' }
    const servico = await montaServico(configServico({ ...jwt, POLARIS_NOS: nosDir, POLARIS_SERVICO: 'loja', POLARIS_HOSTS: JSON.stringify(Object.fromEntries(TENANTS_LOCAIS.map((t) => [`${t.alias}.polaris.localhost`, t.id]))), DATABASE_URL: pg('polaris_app'), POLARIS_DB_PAPEL: 'polaris_app', POLARIS_MIGRAR: '1', DATABASE_URL_MIGRADOR: pg('polaris_migrador') }), reg); fecham.push(async () => { servico.app.server.closeAllConnections(); await servico.fecha() })
    await servico.app.listen({ port: 0, host: '127.0.0.1' }); const urlServico = `http://127.0.0.1:${(servico.app.server.address() as { port: number }).port}`
    if ((await db.query(`SELECT 1 FROM information_schema.tables WHERE table_schema = 'loja' AND table_name = 'destaque'`)).rows.length) {
      await db.exec('RESET ROLE')
      for (const t of TENANTS_LOCAIS) if (!(await db.query(`SELECT 1 FROM loja.destaque WHERE tenant_id = $1`, [t.id])).rows.length)
        await db.query(`INSERT INTO loja.destaque (tenant_id, titulo, descricao) VALUES ($1, $2, $3), ($1, $4, $5)`, [t.id, `Café de ${t.nome}`, 'Torra média, 250 g', `Pão de ${t.nome}`, 'Fermentação natural'])
    }
    const regGw = carregaNos(nosDir); registraBase(regGw); registraTemas(regGw)
    const siteDir = o.site === undefined ? join(RAIZ, 'exemplos', 'loja-site') : o.site; if (siteDir) carregaNos(siteDir, regGw)
    const { gw, verifica } = montaGatewayComChave(configGateway({ ...jwt, POLARIS_PLATAFORMA_POOL_MAX: '1', POLARIS_IDENTIDADE_CHAVE_PRIVADA_JWK: JSON.stringify(privada), POLARIS_NOS: nosDir, POLARIS_SERVICOS: JSON.stringify({ loja: urlServico }), DATABASE_URL_PLATAFORMA: pg('polaris_app'), POLARIS_BASES_DOMINIO: 'polaris.localhost', POLARIS_STUDIO_DIR: resolve(studioDir), POLARIS_PREVIEW_SEGREDO: 'polaris-local-preview-segredo-de-desenvolvimento-0123', POLARIS_GRAPHQL_INTROSPECCAO: '1', POLARIS_LIMITE_TAXA: 'desligado', POLARIS_PORT: undefined } as never), regGw); fecham.push(async () => { gw.server.closeAllConnections(); await gw.close() })
    await verifica() // a privada tem de combinar com a pública que serviço e gateway usam
    const chavePrivada = await importJWK(privada as never, 'ES256')
    const token = async (alias: string, papeis: readonly string[], usuario = 'dev') => {
      const t = TENANTS_LOCAIS.find((x) => x.alias === alias); if (!t) throw new Error(`tenant desconhecido: ${alias}`)
      return new SignJWT({ tid: t.id, papeis: [...papeis] }).setProtectedHeader({ alg: 'ES256', kid: 'local' }).setSubject(usuario).setIssuer(EMISSOR_LOCAL).setAudience(AUDIENCIA_LOCAL).setExpirationTime('12h').sign(chavePrivada)
    }
    // 4. login de DESENVOLVIMENTO: emite o JWT e leva ao Studio do tenant (o token vai no fragmento da URL, que não chega a servidor nenhum)
    let porta = o.porta ?? 3000
    const cab = (reply: { header(k: string, v: string): unknown }) => { reply.header('content-security-policy', "default-src 'none'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'"); reply.header('cache-control', 'no-store') }
    const APEX = /^(localhost|127\.0\.0\.1)(:\d+)?$/, HOST_TENANT = /^([a-z][a-z0-9-]{1,30})\.polaris\.localhost(:\d+)?$/
    // o índice do login só vale no endereço SEM tenant (localhost); no endereço de um tenant, `/entrar` é a PÁGINA de login do site dele (nó `site.entrar`), servida como qualquer outra
    gw.get<{ Querystring: { volta?: string } }>('/entrar', { constraints: { host: APEX } as never }, async (req, reply) => {
      cab(reply); const volta = voltaSegura(req.query.volta)
      const linhas = TENANTS_LOCAIS.map((t) => `<h2>${esc(t.nome)} <small>(${esc(t.alias)}.polaris.localhost)</small></h2><ul>${PAPEIS_LOCAIS.map((p) => `<li><a href="/entrar/ir?tenant=${esc(t.alias)}&amp;papel=${esc(p)}">Studio como <code>${esc(p)}</code></a> · <a href="/entrar/ir?tenant=${esc(t.alias)}&amp;papel=${esc(p)}&amp;para=site&amp;volta=${encodeURIComponent(volta)}">site como <code>${esc(p)}</code></a></li>`).join('')}</ul>`).join('')
      return reply.type('text/html; charset=utf-8').send(`<!doctype html><html lang="pt-BR"><meta charset="utf-8"><title>Polaris local: entrar</title><body><h1>Polaris — ambiente local</h1><p>Login de <strong>desenvolvimento</strong>: emite um JWT de 12 h para o papel escolhido e abre o Studio.</p>${linhas}<p>Usuário: <code>?usuario=ana</code> na URL (padrão <code>dev</code>).</p></body></html>`)
    })
    gw.get<{ Querystring: { tenant?: string; papel?: string; usuario?: string; para?: string; volta?: string } }>('/entrar/ir', async (req, reply) => {
      const { papel, usuario = 'dev', para } = req.query, tenant = req.query.tenant ?? HOST_TENANT.exec(String(req.headers.host ?? ''))?.[1] // sem `tenant`, vale o do endereço
      if (!tenant || !ALIAS.test(tenant) || !TENANTS_LOCAIS.some((t) => t.alias === tenant) || !papel || !(PAPEIS_LOCAIS as readonly string[]).includes(papel) || !USUARIO.test(usuario)) { cab(reply); return reply.status(400).type('text/plain').send('tenant, papel ou usuário inválido') }
      if (para === 'site' && String(req.headers.host ?? '') !== `${tenant}.polaris.localhost:${porta}`) { // o cookie é do ENDEREÇO que o grava: vindo de outro (ex.: localhost), refaz o pedido no endereço do tenant
        const qs = new URLSearchParams({ papel, para, usuario, ...(req.query.volta ? { volta: req.query.volta } : {}) })
        return reply.redirect(`http://${tenant}.polaris.localhost:${porta}/entrar/ir?${qs}`, 302)
      }
      if (para === 'site') { // sessão do SITE: cookie HttpOnly só deste host, e volta para onde a guarda mandou
        const t = await token(tenant, [papel], usuario)
        return reply.header('set-cookie', cookieDeSessao(t, false)).redirect(`http://${tenant}.polaris.localhost:${porta}${voltaSegura(req.query.volta)}`, 302)
      }
      return reply.redirect(`http://${tenant}.polaris.localhost:${porta}/studio#token=${await token(tenant, [papel], usuario)}`, 302)
    })
    // caixa de e-mails de DESENVOLVIMENTO: o que o sistema "enviou" (link de redefinição de senha) aparece aqui, já que não há SMTP no ambiente local
    gw.get<{ Querystring: { tenant?: string } }>('/_dev/emails', async (req, reply) => {
      const alias = req.query.tenant ?? HOST_TENANT.exec(String(req.headers.host ?? ''))?.[1], t = TENANTS_LOCAIS.find((x) => x.alias === alias)
      cab(reply); if (!t) return reply.status(400).type('text/plain').send('use /_dev/emails?tenant=loja-demo (ou abra no endereço de um tenant)')
      const lista = await ident.emails(t.id, 20)
      const linka = (txt: string) => esc(txt).replace(/https?:\/\/[^\s<]+/g, (u) => `<a href="${u}">${u}</a>`)
      return reply.type('text/html; charset=utf-8').send(`<!doctype html><html lang="pt-BR"><meta charset="utf-8"><title>E-mails de desenvolvimento</title><body><h1>E-mails — ${esc(t.nome)}</h1><p>Só o ambiente local: aqui aparece o que o sistema enviaria por e-mail.</p>${lista.length ? lista.map((m) => `<article><h2>${esc(m.assunto)}</h2><p>Para: ${esc(m.para)} · ${esc(m.criadoEm)}</p><pre>${linka(m.corpo)}</pre></article>`).join('') : '<p>Nenhum e-mail ainda.</p>'}</body></html>`)
    })
    await gw.listen({ port: porta, host: '127.0.0.1' }); porta = (gw.server.address() as { port: number }).port
    if (!o.silencioso) console.log(`gateway em http://127.0.0.1:${porta}`)
    return { porta, urlTenant: (alias) => `http://${alias}.polaris.localhost:${porta}`, pgUrl: pg('polaris_app'), token, fecha: fechaTudo }
  } catch (e) { await fechaTudo(); throw e }
}
