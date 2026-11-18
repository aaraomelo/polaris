import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { FastifyInstance } from 'fastify'
import Fastify from 'fastify'
import { rotasStudio, type OpcoesStudio } from '@polaris/packs'
import { geraPreview } from './preview'

/** a pré-visualização do servidor: o mesmo `geraPreview` do cliente */
export const previsualiza: NonNullable<OpcoesStudio['previsualiza']> = (a) => geraPreview(a.no, a.blocosDoTenant, a.selecionado, a.tema)

// O cliente do Studio (dist/) e a API de autoria. Quem AUTENTICA é injetado: no gateway, o JWT dele; em dev/teste, um stub. O servidor nunca decide identidade sozinho.
export const DIST_PADRAO = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist')
const ARQUIVOS: Record<string, string> = { 'studio.js': 'application/javascript; charset=utf-8', 'studio-v2.js': 'application/javascript; charset=utf-8', 'studio.css': 'text/css; charset=utf-8', 'studio.programa.json': 'application/json; charset=utf-8' }
// CSP do Studio. `unsafe-eval`: o Ajv (validação de schema no navegador) compila validadores com `new Function`; é uma ferramenta de autoria autenticada, sem conteúdo de terceiros na origem,
// e a PRÉ-VISUALIZAÇÃO roda num iframe `sandbox=""` (sem scripts, origem opaca). `unsafe-inline` só em estilo (o iframe `srcdoc` herda esta política e precisa do <style> do tema).
export const CSP_STUDIO = "default-src 'none'; script-src 'self' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-src 'self' about:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"

// Studio v2 (a página da plataforma): não precisa de `unsafe-eval` (as expressões viram closures, sem `new Function`; não há Ajv no navegador)
export const CSP_STUDIO_V2 = CSP_STUDIO.replace(" 'unsafe-eval'", '')

/** `/studio` (a página) e `/studio/ativos/*` (JS e CSS), lidos UMA vez de `dir`. Falha ao subir se o cliente não foi empacotado (melhor que um 404 em produção). */
export function rotasEstaticasStudio(app: FastifyInstance, dir: string = DIST_PADRAO): void {
  const html = readFileSync(join(dir, 'index.html'), 'utf8'), htmlV2 = readFileSync(join(dir, 'v2.html'), 'utf8'), conteudo = new Map(Object.keys(ARQUIVOS).map((n) => [n, readFileSync(join(dir, n))]))
  const seguranca = (reply: { header(k: string, v: string): unknown }, csp: string = CSP_STUDIO) => { reply.header('content-security-policy', csp); reply.header('x-content-type-options', 'nosniff'); reply.header('referrer-policy', 'no-referrer'); reply.header('x-frame-options', 'DENY') }
  app.get('/studio', async (_req, reply) => { seguranca(reply); reply.header('cache-control', 'no-store'); return reply.type('text/html; charset=utf-8').send(html) })
  app.get('/studio/v2', async (_req, reply) => { seguranca(reply, CSP_STUDIO_V2); reply.header('cache-control', 'no-store'); return reply.type('text/html; charset=utf-8').send(htmlV2) })
  app.get<{ Params: { nome: string } }>('/studio/ativos/:nome', async (req, reply) => {
    const c = conteudo.get(req.params.nome), t = ARQUIVOS[req.params.nome]; if (!c || !t) return reply.status(404).send('')
    seguranca(reply); reply.header('cache-control', 'no-cache'); return reply.type(t).send(c)
  })
}

/** o Studio num servidor próprio (dev e testes) */
export function criaServidorStudio(o: OpcoesStudio, dir?: string): FastifyInstance {
  const app = Fastify({ logger: false }); rotasEstaticasStudio(app, dir); rotasStudio(app, { previsualiza, ...o }); return app
}
