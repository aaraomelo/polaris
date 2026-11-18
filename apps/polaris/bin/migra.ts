import { resolveArquivos } from '../src/config'
import { migraPlataforma } from '../src/migra'

// um passo ISOLADO e explícito (nunca no boot da aplicação): `node dist/migra.mjs`. URL do migrador por `DATABASE_URL_MIGRADOR(_FILE)`.
const { env, problemas } = resolveArquivos(process.env)
if (problemas.length) { console.error(`configuração inválida:\n${problemas.map((p) => `  - ${p}`).join('\n')}`); process.exit(1) }
if (!env.DATABASE_URL_MIGRADOR) { console.error('configuração inválida:\n  - DATABASE_URL_MIGRADOR é obrigatória'); process.exit(1) }
try { const r = await migraPlataforma({ urlMigrador: env.DATABASE_URL_MIGRADOR, papelPlataforma: env.POLARIS_PAPEL_PLATAFORMA ?? 'polaris_plataforma' }); console.log(`esquema plataforma pronto (${r.tabelas} tabelas)`) } catch (e) { console.error(`falha na migração: ${(e as Error).message.split('\n')[0]}`); process.exit(1) }
