import { DDL_DIRETORIO } from '@polaris/packs'
import pg from 'pg'

const IDENT = /^[a-z_][a-z0-9_]{0,62}$/

/**
 * Aplica o esquema `plataforma` (diretório de tenants, domínios, versões de nós, releases) com o papel MIGRADOR e dá ao papel da plataforma só o que ele precisa.
 * Idempotente (`IF NOT EXISTS`/`OR REPLACE`): pode rodar a cada versão. Os dados de versões e releases são imutáveis POR GATILHO: nem o migrador os apaga sem recriar o gatilho.
 */
export async function migraPlataforma(o: { urlMigrador: string; papelPlataforma: string }): Promise<{ tabelas: number }> {
  if (!IDENT.test(o.papelPlataforma)) throw new Error('papel da plataforma inválido')
  const u = new URL(o.urlMigrador); if (u.protocol !== 'postgres:' && u.protocol !== 'postgresql:') throw new Error('a URL do migrador deve ser postgres://…')
  const c = new pg.Client({ connectionString: o.urlMigrador, connectionTimeoutMillis: 10_000 })
  await c.connect()
  try {
    await c.query('BEGIN')
    await c.query(DDL_DIRETORIO)
    await c.query(`GRANT USAGE ON SCHEMA plataforma TO ${o.papelPlataforma}`)
    // leitura e escrita nas tabelas de estado; as imutáveis (no_versao, release, release_evento) só ganham SELECT e INSERT (o gatilho já recusa o resto)
    await c.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON plataforma.tenant, plataforma.etapa, plataforma.modulo, plataforma.dominio, plataforma.release_ponteiro TO ${o.papelPlataforma}`)
    await c.query(`GRANT SELECT, INSERT ON plataforma.no_versao, plataforma.release, plataforma.release_evento TO ${o.papelPlataforma}`)
    // comentários do Studio: criar e resolver (UPDATE); ninguém apaga
    await c.query(`GRANT SELECT, INSERT, UPDATE ON plataforma.comentario TO ${o.papelPlataforma}`)
    // identidade: usuários e tokens (atualizados e apagados: uso único, expiração, bloqueio por tentativas) e a caixa de saída de e-mail (um trabalhador marca `enviado_em`)
    await c.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON plataforma.usuario, plataforma.login_tentativa, plataforma.token_senha, plataforma.email_saida TO ${o.papelPlataforma}`)
    await c.query(`GRANT USAGE ON SEQUENCE plataforma.email_saida_id_seq TO ${o.papelPlataforma}`)
    const n = Number((await c.query(`SELECT count(*)::int AS n FROM information_schema.tables WHERE table_schema = 'plataforma'`)).rows[0]!.n)
    await c.query('COMMIT'); return { tabelas: n }
  } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e } finally { await c.end() }
}
