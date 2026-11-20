import { execFileSync } from 'node:child_process'
import { existsSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { SENHA_LOCAL, TENANTS_LOCAIS, emailLocal, sobeLocal } from '../src/local'

// pnpm local            sobe o ambiente (dados persistem em .polaris-local/)
// pnpm local --limpa    apaga os dados antes de subir
// pnpm local --memoria  não grava nada em disco
// pnpm local --porta 3100
// pnpm local --site exemplos/maison   outro site de demonstração (nós *.json + fotos em <pasta>/img/)
process.env.NODE_ENV = 'development'
process.env.POLARIS_LOG_NIVEL ??= 'warn' // sem uma linha de log por requisição no terminal; `POLARIS_LOG_NIVEL=info pnpm local` volta a mostrar
const args = process.argv.slice(2), tem = (f: string) => args.includes(f), valor = (f: string) => { const i = args.indexOf(f); return i >= 0 ? args[i + 1] : undefined }
const raiz = resolve(import.meta.dirname, '..', '..', '..'), dados = tem('--memoria') ? null : join(raiz, '.polaris-local', 'pg')
if (tem('--limpa') && dados) { rmSync(join(raiz, '.polaris-local'), { recursive: true, force: true }); console.log('dados locais apagados') }
const studio = join(raiz, 'apps', 'studio', 'dist', 'index.html')
if (!existsSync(studio)) { console.log('empacotando o Studio…'); execFileSync('pnpm', ['--filter', '@polaris/studio-app', 'build'], { cwd: raiz, stdio: 'inherit' }) }
const porta = valor('--porta') ? Number(valor('--porta')) : Number(process.env.PORT ?? 3000)
if (!Number.isInteger(porta) || porta < 0 || porta > 65535) { console.error('porta inválida'); process.exit(2) }
try {
  const l = await sobeLocal({ dados, porta, ...(process.env.POLARIS_NOS ? { nos: resolve(process.env.POLARIS_NOS) } : {}), ...(valor('--site') ? { site: resolve(raiz, valor('--site')!) } : {}), ...(process.env.POLARIS_LOCAL_PG_PORTA ? { pgPorta: Number(process.env.POLARIS_LOCAL_PG_PORTA) } : {}), silencioso: true })
  console.log(`
Polaris local no ar${dados ? ` (dados em ${dados})` : ' (em memória)'}

  entrar (login de desenvolvimento)   http://localhost:${l.porta}/entrar
  site do tenant                      ${l.urlTenant('loja-demo')}/
  Studio                              ${l.urlTenant('loja-demo')}/studio        (precisa do token: use o /entrar)
  API REST da loja (gerada)           ${l.urlTenant('loja-demo')}/api/loja/produtos
  GraphQL                             ${l.urlTenant('loja-demo')}/graphql
  login real (e-mail e senha)         ${l.urlTenant('loja-demo')}/entrar   →  ${emailLocal('loja-demo')} / ${SENHA_LOCAL}
  Sign Maker (cartazes, HTML ≡ PDF)    ${l.urlTenant('loja-demo')}/_dev/cartazes
  e-mails de desenvolvimento          ${l.urlTenant('loja-demo')}/_dev/emails
  Postgres (psql)                     ${l.pgUrl}

Tenants: ${TENANTS_LOCAIS.map((t) => `${t.alias} (${t.nome})`).join(', ')}.  Ctrl+C para parar.`)
  for (const s of ['SIGTERM', 'SIGINT'] as const) process.once(s, () => { setTimeout(() => { console.error('o encerramento travou; saindo à força'); process.exit(1) }, 10_000).unref(); void l.fecha().finally(() => process.exit(0)) })
} catch (e) { console.error(`falha ao subir o ambiente local: ${(e as Error).message}`); process.exit(1) }
