import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { FastifyInstance } from 'fastify'
import Fastify from 'fastify'
import { rotasStudio, type OpcoesStudio } from '@polaris/packs'
import { auditaContraste } from '@polaris/studio'
import { geraPreview } from './preview'

/** a pré-visualização do servidor: o mesmo `geraPreview` do cliente */
export const previsualiza: NonNullable<OpcoesStudio['previsualiza']> = (a) => {
  const r = geraPreview(a.no, a.blocosDoTenant, a.selecionado, a.tema, a.modo, a.dados)
  const tema = (a.tema as { spec?: { tokens?: unknown } } | undefined)?.spec
  return r.ok && !r.problemas && tema?.tokens && typeof tema.tokens === 'object' ? { ...r, avisos: auditaContraste(tema as never) } : r // tema: junto da prévia vão os avisos de contraste (WCAG)
}

// O cliente do Studio (dist/) e a API de autoria. Quem AUTENTICA é injetado: no gateway, o JWT dele; em dev/teste, um stub. O servidor nunca decide identidade sozinho.
export const DIST_PADRAO = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist')
const ARQUIVOS: Record<string, string> = { 'studio.js': 'application/javascript; charset=utf-8', 'studio.css': 'text/css; charset=utf-8', 'tema.css': 'text/css; charset=utf-8', 'studio.programa.json': 'application/json; charset=utf-8' }
// CSP do Studio: scripts só 'self' e SEM `unsafe-eval` (as expressões da plataforma viram closures; não há Ajv no navegador). `unsafe-inline` só em estilo: o runtime usa `style` em atributos
// e o iframe da pré-visualização (`sandbox=""`, sem scripts) herda esta política e precisa do <style> do tema.
export const CSP_STUDIO = "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src data:; connect-src 'self'; frame-src 'self' about:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"

/** `/studio` (a página) e `/studio/ativos/*` (JS e CSS), lidos UMA vez de `dir`. Falha ao subir se o cliente não foi empacotado (melhor que um 404 em produção). */
export function rotasEstaticasStudio(app: FastifyInstance, dir: string = DIST_PADRAO): void {
  const html = readFileSync(join(dir, 'index.html'), 'utf8'), conteudo = new Map(Object.keys(ARQUIVOS).map((n) => [n, readFileSync(join(dir, n))]))
  const seguranca = (reply: { header(k: string, v: string): unknown }) => { reply.header('content-security-policy', CSP_STUDIO); reply.header('x-content-type-options', 'nosniff'); reply.header('referrer-policy', 'no-referrer'); reply.header('x-frame-options', 'DENY') }
  app.get('/studio', async (_req, reply) => { seguranca(reply); reply.header('cache-control', 'no-store'); return reply.type('text/html; charset=utf-8').send(html) })
  app.get<{ Params: { nome: string } }>('/studio/ativos/:nome', async (req, reply) => {
    const c = conteudo.get(req.params.nome), t = ARQUIVOS[req.params.nome]; if (!c || !t) return reply.status(404).send('')
    seguranca(reply); reply.header('cache-control', 'no-cache'); return reply.type(t).send(c)
  })
}

/** o Studio num servidor próprio (dev e testes) */
export function criaServidorStudio(o: OpcoesStudio, dir?: string): FastifyInstance {
  const app = Fastify({ logger: false }); rotasEstaticasStudio(app, dir); rotasStudio(app, { previsualiza, ...o }); return app
}
