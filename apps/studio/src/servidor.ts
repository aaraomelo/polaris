import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import Fastify, { type FastifyInstance } from 'fastify'
import { rotasStudio, type OpcoesStudio } from '@polaris/packs'

// Servidor do Studio: serve o cliente empacotado (dist/) e a API de autoria. Quem AUTENTICA é injetado (em produção, o JWT do gateway; em dev/teste, um stub): o servidor nunca decide
// identidade sozinho.
const dist = join(dirname(fileURLToPath(import.meta.url)), '..', 'dist')
const arquivos: Record<string, [string, string]> = { 'studio.js': ['application/javascript; charset=utf-8', ''], 'studio.css': ['text/css; charset=utf-8', ''], }
// CSP do Studio. `unsafe-eval`: o Ajv (validação de schema no navegador) compila validadores com `new Function`; é uma ferramenta de autoria autenticada, sem conteúdo de terceiros na origem,
// e a PRÉ-VISUALIZAÇÃO roda num iframe `sandbox=""` (sem scripts, origem opaca). `unsafe-inline` só em estilo (o iframe `srcdoc` herda esta política e precisa do <style> do tema).
export const CSP_STUDIO = "default-src 'none'; script-src 'self' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-src 'self' about:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'"

export function criaServidorStudio(o: OpcoesStudio): FastifyInstance {
  const app = Fastify({ logger: false })
  const html = readFileSync(join(dist, 'index.html'), 'utf8'), conteudo = new Map(Object.keys(arquivos).map((n) => [n, readFileSync(join(dist, n))]))
  const seguranca = (reply: { header(k: string, v: string): unknown }) => { reply.header('content-security-policy', CSP_STUDIO); reply.header('x-content-type-options', 'nosniff'); reply.header('referrer-policy', 'no-referrer'); reply.header('x-frame-options', 'DENY') }
  app.get('/studio', async (_req, reply) => { seguranca(reply); reply.header('cache-control', 'no-store'); return reply.type('text/html; charset=utf-8').send(html) })
  app.get<{ Params: { nome: string } }>('/studio/ativos/:nome', async (req, reply) => {
    const c = conteudo.get(req.params.nome), t = arquivos[req.params.nome]; if (!c || !t) return reply.status(404).send('')
    seguranca(reply); reply.header('cache-control', 'no-cache'); return reply.type(t[0]).send(c)
  })
  rotasStudio(app, o)
  return app
}
