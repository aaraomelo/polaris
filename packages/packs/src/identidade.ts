import { createHash, randomBytes, randomUUID } from 'node:crypto'
import { CUSTO_PADRAO, confereSenha, gastaTempoDeSenha, hashSenha, politicaDeSenha, type CustoSenha } from './senha'

// IDENTIDADE da plataforma (plano de controle): usuários POR TENANT (e-mail único dentro do tenant), com papéis que viram o claim do JWT. Quem emite o token é o gateway; aqui só se decide QUEM É.
// Regras que valem como contrato: (1) e-mail desconhecido e senha errada são INDISTINGUÍVEIS (resposta e tempo); (2) o bloqueio por tentativas é por (tenant, e-mail digitado), existam ou não,
// para não revelar quais contas existem; (3) token de redefinição/convite: 32 bytes aleatórios, guarda-se só o SHA-256, uso único, expira, e vale só no tenant que o emitiu; (4) nada de senha ou token em log.

export const DDL_IDENTIDADE = `
CREATE TABLE IF NOT EXISTS plataforma.usuario (
  id uuid PRIMARY KEY,
  tenant_id uuid NOT NULL REFERENCES plataforma.tenant (id),
  email text NOT NULL,
  nome text NOT NULL,
  senha_hash text,
  papeis text[] NOT NULL DEFAULT '{}',
  status text NOT NULL DEFAULT 'ativo' CHECK (status IN ('ativo', 'convidado', 'desativado')),
  ultimo_login timestamptz,
  criado_em timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS usuario_email_uidx ON plataforma.usuario (tenant_id, email);
CREATE TABLE IF NOT EXISTS plataforma.login_tentativa (
  tenant_id uuid NOT NULL,
  email text NOT NULL,
  falhas integer NOT NULL DEFAULT 0,
  bloqueado_ate timestamptz,
  atualizado_em timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, email)
);
CREATE TABLE IF NOT EXISTS plataforma.token_senha (
  token_hash text PRIMARY KEY,
  usuario_id uuid NOT NULL REFERENCES plataforma.usuario (id) ON DELETE CASCADE,
  tenant_id uuid NOT NULL,
  tipo text NOT NULL CHECK (tipo IN ('redefinir', 'convite')),
  criado_em timestamptz NOT NULL DEFAULT now(),
  expira_em timestamptz NOT NULL,
  usado_em timestamptz
);
CREATE INDEX IF NOT EXISTS token_senha_usuario ON plataforma.token_senha (usuario_id, criado_em);
CREATE TABLE IF NOT EXISTS plataforma.email_saida (
  id bigserial PRIMARY KEY,
  tenant_id uuid NOT NULL,
  para text NOT NULL,
  assunto text NOT NULL,
  corpo text NOT NULL,
  criado_em timestamptz NOT NULL DEFAULT now(),
  enviado_em timestamptz
);
`

type Q = (sql: string, params?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>>; rowCount: number }>
export type Usuario = { id: string; tenantId: string; email: string; nome: string; papeis: string[]; status: 'ativo' | 'convidado' | 'desativado' }
const EMAIL = /^[^\s@<>()[\]\\,;:"]{1,64}@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+$/i
const PAPEL = /^[A-Za-z][A-Za-z0-9_.-]{0,63}$/
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const sha = (s: string) => createHash('sha256').update(s).digest('hex')
export const normalizaEmail = (e: unknown): string | null => { if (typeof e !== 'string') return null; const x = e.normalize('NFKC').trim().toLowerCase(); return x.length <= 254 && EMAIL.test(x) ? x : null }
const usuarioDe = (r: Record<string, unknown>): Usuario => ({ id: String(r.id), tenantId: String(r.tenant_id), email: String(r.email), nome: String(r.nome), papeis: (r.papeis as string[]) ?? [], status: r.status as Usuario['status'] })

export type OpcoesIdentidade = {
  q: Q
  custo?: CustoSenha
  agora?: () => Date
  /** falhas seguidas até bloquear (padrão 5) e por quanto tempo (padrão 15 min) */
  tentativasMax?: number
  bloqueioMs?: number
  /** validade do link de redefinição (padrão 1 h) e do convite (padrão 7 dias) */
  redefinicaoMs?: number
  conviteMs?: number
}

export function criaIdentidade(o: OpcoesIdentidade) {
  const { q } = o, custo = o.custo ?? CUSTO_PADRAO, agora = o.agora ?? (() => new Date())
  const max = o.tentativasMax ?? 5, bloqueioMs = o.bloqueioMs ?? 15 * 60_000, redefMs = o.redefinicaoMs ?? 3_600_000, conviteMs = o.conviteMs ?? 7 * 86_400_000

  async function emiteToken(usuarioId: string, tenantId: string, tipo: 'redefinir' | 'convite'): Promise<string> {
    const t = agora(), token = randomBytes(32).toString('base64url')
    await q(`UPDATE plataforma.token_senha SET usado_em = $2 WHERE usuario_id = $1 AND usado_em IS NULL`, [usuarioId, t.toISOString()]) // o novo invalida os antigos
    await q(`INSERT INTO plataforma.token_senha (token_hash, usuario_id, tenant_id, tipo, criado_em, expira_em) VALUES ($1, $2, $3, $4, $5, $6)`, [sha(token), usuarioId, tenantId, tipo, t.toISOString(), new Date(t.getTime() + (tipo === 'convite' ? conviteMs : redefMs)).toISOString()])
    return token
  }

  return {
    /** cria um usuário ATIVO com senha (cadastro por quem administra; testes; semente) */
    async criaUsuario(a: { tenantId: string; email: string; nome: string; papeis?: string[]; senha: string }): Promise<{ ok: true; usuario: Usuario } | { ok: false; motivo: 'dados_invalidos' | 'ja_existe' | 'senha_fraca'; erros?: string[] }> {
      const email = normalizaEmail(a.email), nome = typeof a.nome === 'string' ? a.nome.trim() : ''
      if (!email || !UUID.test(a.tenantId) || nome.length < 1 || nome.length > 120 || (a.papeis ?? []).length > 50 || !(a.papeis ?? []).every((p) => PAPEL.test(p))) return { ok: false, motivo: 'dados_invalidos' }
      const fracas = politicaDeSenha(a.senha, { email, nome }); if (fracas.length) return { ok: false, motivo: 'senha_fraca', erros: fracas }
      const id = randomUUID(), r = await q(`INSERT INTO plataforma.usuario (id, tenant_id, email, nome, senha_hash, papeis, status) VALUES ($1, $2, $3, $4, $5, $6, 'ativo') ON CONFLICT (tenant_id, email) DO NOTHING RETURNING id`, [id, a.tenantId.toLowerCase(), email, nome, await hashSenha(a.senha, custo), a.papeis ?? []])
      return r.rowCount ? { ok: true, usuario: { id, tenantId: a.tenantId.toLowerCase(), email, nome, papeis: a.papeis ?? [], status: 'ativo' } } : { ok: false, motivo: 'ja_existe' }
    },
    /** convida: cria o usuário SEM senha e devolve o token do link "defina sua senha" (quem chama manda por e-mail) */
    async convida(a: { tenantId: string; email: string; nome: string; papeis?: string[] }): Promise<{ ok: true; usuario: Usuario; token: string } | { ok: false; motivo: 'dados_invalidos' | 'ja_existe' }> {
      const email = normalizaEmail(a.email), nome = typeof a.nome === 'string' ? a.nome.trim() : ''
      if (!email || !UUID.test(a.tenantId) || nome.length < 1 || nome.length > 120 || (a.papeis ?? []).length > 50 || !(a.papeis ?? []).every((p) => PAPEL.test(p))) return { ok: false, motivo: 'dados_invalidos' }
      const id = randomUUID(), r = await q(`INSERT INTO plataforma.usuario (id, tenant_id, email, nome, papeis, status) VALUES ($1, $2, $3, $4, $5, 'convidado') ON CONFLICT (tenant_id, email) DO NOTHING RETURNING id`, [id, a.tenantId.toLowerCase(), email, nome, a.papeis ?? []])
      if (!r.rowCount) return { ok: false, motivo: 'ja_existe' }
      return { ok: true, usuario: { id, tenantId: a.tenantId.toLowerCase(), email, nome, papeis: a.papeis ?? [], status: 'convidado' }, token: await emiteToken(id, a.tenantId.toLowerCase(), 'convite') }
    },
    /** e-mail + senha. Falha por e-mail desconhecido, senha errada, conta sem senha ou desativada é a MESMA (`credenciais`); `bloqueado` vale por (tenant, e-mail digitado), exista ou não. */
    async entra(a: { tenantId: string; email: string; senha: string }): Promise<{ ok: true; usuario: Usuario } | { ok: false; motivo: 'credenciais' } | { ok: false; motivo: 'bloqueado'; ate: Date }> {
      const email = normalizaEmail(a.email), t = agora()
      if (!email || typeof a.senha !== 'string' || !UUID.test(a.tenantId)) { await gastaTempoDeSenha(String(a.senha ?? ''), custo); return { ok: false, motivo: 'credenciais' } }
      const tid = a.tenantId.toLowerCase()
      const lim = (await q(`SELECT falhas, bloqueado_ate FROM plataforma.login_tentativa WHERE tenant_id = $1 AND email = $2`, [tid, email])).rows[0] as { falhas: number; bloqueado_ate: string | null } | undefined
      if (lim?.bloqueado_ate && new Date(lim.bloqueado_ate) > t) return { ok: false, motivo: 'bloqueado', ate: new Date(lim.bloqueado_ate) } // sem conferir a senha: bloqueado não serve para testar palpites
      const u = (await q(`SELECT id, tenant_id, email, nome, senha_hash, papeis, status FROM plataforma.usuario WHERE tenant_id = $1 AND email = $2`, [tid, email])).rows[0]
      const c = await confereSenha(a.senha, (u?.senha_hash as string | null | undefined) ?? null, custo)
      if (u && c.ok && u.status === 'ativo') {
        await q(`DELETE FROM plataforma.login_tentativa WHERE tenant_id = $1 AND email = $2`, [tid, email])
        await q(`UPDATE plataforma.usuario SET ultimo_login = $2${c.rehash ? ', senha_hash = $3' : ''} WHERE id = $1`, c.rehash ? [u.id, t.toISOString(), await hashSenha(a.senha, custo)] : [u.id, t.toISOString()])
        return { ok: true, usuario: usuarioDe(u) }
      }
      // uma ÚNICA instrução atômica: conta a falha e, ao chegar no limite, bloqueia e zera a contagem
      const r = (await q(`INSERT INTO plataforma.login_tentativa (tenant_id, email, falhas, bloqueado_ate, atualizado_em) VALUES ($1, $2, 1, CASE WHEN 1 >= $3 THEN $4::timestamptz END, $5)
        ON CONFLICT (tenant_id, email) DO UPDATE SET falhas = CASE WHEN login_tentativa.falhas + 1 >= $3 THEN 0 ELSE login_tentativa.falhas + 1 END,
          bloqueado_ate = CASE WHEN login_tentativa.falhas + 1 >= $3 THEN $4::timestamptz ELSE login_tentativa.bloqueado_ate END, atualizado_em = $5 RETURNING bloqueado_ate`,
        [tid, email, max, new Date(t.getTime() + bloqueioMs).toISOString(), t.toISOString()])).rows[0]
      if (Math.random() < 0.02) await q(`DELETE FROM plataforma.login_tentativa WHERE atualizado_em < $1 AND (bloqueado_ate IS NULL OR bloqueado_ate < $2)`, [new Date(t.getTime() - 86_400_000).toISOString(), t.toISOString()]) // faxina de e-mails digitados à toa
      const ate = r?.bloqueado_ate ? new Date(String(r.bloqueado_ate)) : null
      return ate && ate > t ? { ok: false, motivo: 'bloqueado', ate } : { ok: false, motivo: 'credenciais' }
    },
    /** "esqueci a senha": só devolve token se a conta existe, está ativa/convidada e não pediu há menos de 60 s (quem chama responde SEMPRE igual) */
    async pedeRedefinicao(a: { tenantId: string; email: string }): Promise<{ token: string; usuario: Usuario } | null> {
      const email = normalizaEmail(a.email); if (!email || !UUID.test(a.tenantId)) return null
      const tid = a.tenantId.toLowerCase(), u = (await q(`SELECT id, tenant_id, email, nome, papeis, status FROM plataforma.usuario WHERE tenant_id = $1 AND email = $2`, [tid, email])).rows[0]
      if (!u || u.status === 'desativado') return null
      const recente = (await q(`SELECT 1 FROM plataforma.token_senha WHERE usuario_id = $1 AND criado_em > $2`, [u.id, new Date(agora().getTime() - 60_000).toISOString()])).rows.length
      if (recente) return null
      return { token: await emiteToken(String(u.id), tid, 'redefinir'), usuario: usuarioDe(u) }
    },
    /** define a senha com o token (redefinição ou convite): uso único, no tenant certo; a conta passa a ativa e o bloqueio some */
    async redefine(a: { tenantId: string; token: string; senha: string }): Promise<{ ok: true; usuario: Usuario } | { ok: false; motivo: 'token_invalido' | 'senha_fraca'; erros?: string[] }> {
      if (typeof a.token !== 'string' || !/^[A-Za-z0-9_-]{20,100}$/.test(a.token) || !UUID.test(a.tenantId) || typeof a.senha !== 'string') return { ok: false, motivo: 'token_invalido' }
      const t = agora(), tk = (await q(`SELECT t.usuario_id, u.tenant_id, u.email, u.nome, u.papeis, u.status, u.id FROM plataforma.token_senha t JOIN plataforma.usuario u ON u.id = t.usuario_id
        WHERE t.token_hash = $1 AND t.tenant_id = $2 AND t.usado_em IS NULL AND t.expira_em > $3`, [sha(a.token), a.tenantId.toLowerCase(), t.toISOString()])).rows[0]
      if (!tk || tk.status === 'desativado') return { ok: false, motivo: 'token_invalido' }
      const fracas = politicaDeSenha(a.senha, { email: String(tk.email), nome: String(tk.nome) }); if (fracas.length) return { ok: false, motivo: 'senha_fraca', erros: fracas } // o token continua valendo: dá para tentar outra senha
      const usado = await q(`UPDATE plataforma.token_senha SET usado_em = $2 WHERE token_hash = $1 AND usado_em IS NULL`, [sha(a.token), t.toISOString()]) // marca ANTES de gravar: dois usos simultâneos não passam os dois
      if (!usado.rowCount) return { ok: false, motivo: 'token_invalido' }
      await q(`UPDATE plataforma.usuario SET senha_hash = $2, status = 'ativo' WHERE id = $1`, [tk.id, await hashSenha(a.senha, custo)])
      await q(`UPDATE plataforma.token_senha SET usado_em = $2 WHERE usuario_id = $1 AND usado_em IS NULL`, [tk.id, t.toISOString()])
      await q(`DELETE FROM plataforma.login_tentativa WHERE tenant_id = $1 AND email = $2`, [tk.tenant_id, tk.email])
      return { ok: true, usuario: usuarioDe({ ...tk, id: tk.id, status: 'ativo' }) }
    },
    async usuario(tenantId: string, id: string): Promise<Usuario | null> { if (!UUID.test(tenantId) || !UUID.test(id)) return null; const r = (await q(`SELECT id, tenant_id, email, nome, papeis, status FROM plataforma.usuario WHERE tenant_id = $1 AND id = $2`, [tenantId.toLowerCase(), id])).rows[0]; return r ? usuarioDe(r) : null },
    async muda(tenantId: string, id: string, c: { status?: Usuario['status']; papeis?: string[] }): Promise<boolean> {
      if (!UUID.test(tenantId) || !UUID.test(id) || (c.papeis && (c.papeis.length > 50 || !c.papeis.every((p) => PAPEL.test(p)))) || (c.status && !['ativo', 'convidado', 'desativado'].includes(c.status))) return false
      return (await q(`UPDATE plataforma.usuario SET status = coalesce($3, status), papeis = coalesce($4, papeis) WHERE tenant_id = $1 AND id = $2`, [tenantId.toLowerCase(), id, c.status ?? null, c.papeis ?? null])).rowCount > 0
    },
    /** a caixa de saída: o que o sistema "enviou" por e-mail. Um trabalhador (SMTP) lê e marca `enviado_em`; sem ele, o texto fica aqui (e no `pnpm local` aparece numa página de desenvolvimento) */
    async enfileiraEmail(m: { tenantId: string; para: string; assunto: string; corpo: string }): Promise<void> {
      await q(`INSERT INTO plataforma.email_saida (tenant_id, para, assunto, corpo) VALUES ($1, $2, $3, $4)`, [m.tenantId.toLowerCase(), m.para.slice(0, 254), m.assunto.slice(0, 200), m.corpo.slice(0, 20_000)])
    },
    async emails(tenantId: string, limite = 20): Promise<Array<{ id: number; para: string; assunto: string; corpo: string; criadoEm: string }>> {
      if (!UUID.test(tenantId)) return []
      return (await q(`SELECT id, para, assunto, corpo, criado_em FROM plataforma.email_saida WHERE tenant_id = $1 ORDER BY id DESC LIMIT $2`, [tenantId.toLowerCase(), Math.min(Math.max(1, limite), 200)])).rows.map((r) => ({ id: Number(r.id), para: String(r.para), assunto: String(r.assunto), corpo: String(r.corpo), criadoEm: new Date(String(r.criado_em)).toISOString() }))
    },
  }
}
export type Identidade = ReturnType<typeof criaIdentidade>
