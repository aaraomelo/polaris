import type { Diretorio, Status } from './provisiona'

// O diretório da plataforma (plano de CONTROLE): quais tenants existem, em que estado, e o progresso do cadastro. NÃO tem RLS: não é dado de tenant, é dado DA plataforma;
// só o papel da plataforma o acessa (nunca o papel `app` dos serviços). Alias único, e a `chave` de idempotência do cadastro também.

export const DDL_DIRETORIO = `
CREATE SCHEMA IF NOT EXISTS plataforma;
CREATE TABLE IF NOT EXISTS plataforma.tenant (
  id uuid PRIMARY KEY,
  alias text NOT NULL,
  nome text NOT NULL,
  segmento text NOT NULL,
  packs text[] NOT NULL,
  dono_email text NOT NULL,
  status text NOT NULL CHECK (status IN ('provisionando', 'ativo', 'falhou', 'suspenso', 'cancelado')),
  motivo text,
  chave text NOT NULL,
  criado_em timestamptz NOT NULL DEFAULT now(),
  atualizado_em timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS tenant_alias_uidx ON plataforma.tenant (alias);
CREATE UNIQUE INDEX IF NOT EXISTS tenant_chave_uidx ON plataforma.tenant (chave);
CREATE TABLE IF NOT EXISTS plataforma.etapa (
  tenant_id uuid NOT NULL REFERENCES plataforma.tenant (id),
  nome text NOT NULL,
  valor text,
  feita_em timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, nome)
);
CREATE TABLE IF NOT EXISTS plataforma.modulo (
  tenant_id uuid NOT NULL REFERENCES plataforma.tenant (id),
  servico text NOT NULL,
  habilitado_em timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, servico)
);`

type Q = (sql: string, params?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>>; rowCount: number }>
/** Implementação sobre SQL. `q` deve falar com o banco da plataforma (papel com acesso ao schema `plataforma`). */
export function diretorioSql(q: Q): Diretorio {
  return {
    async cria(t) {
      // a corrida entre dois cadastros do MESMO alias é decidida pelo índice único: quem insere primeiro ganha
      const ins = await q(`INSERT INTO plataforma.tenant (id, alias, nome, segmento, packs, dono_email, status, chave) VALUES ($1, $2, $3, $4, $5, $6, 'provisionando', $7) ON CONFLICT DO NOTHING`, [t.tenantId, t.alias, t.nome, t.segmento, t.packs, t.donoEmail, t.chave])
      if (ins.rowCount) return { resultado: 'criado', tenantId: t.tenantId, status: 'provisionando' as Status }
      const ex = (await q(`SELECT id::text AS id, alias, status, dono_email FROM plataforma.tenant WHERE chave = $1`, [t.chave])).rows[0] as { id: string; alias: string; status: Status; dono_email: string } | undefined
      if (ex && ex.alias === t.alias && ex.dono_email === t.donoEmail) return { resultado: 'existente', tenantId: ex.id, status: ex.status } // a mesma chamada, de novo
      return { resultado: 'ocupado' } // alias de outro, ou chave reaproveitada com outro conteúdo: nunca devolve o tenant alheio
    },
    async existeAlias(alias) { return (await q(`SELECT 1 FROM plataforma.tenant WHERE alias = $1`, [alias])).rows.length > 0 },
    async etapas(id) { return new Map((await q(`SELECT nome, valor FROM plataforma.etapa WHERE tenant_id = $1`, [id])).rows.map((r) => [r.nome as string, (r.valor as string | null) ?? null])) },
    async conclui(id, nome, valor) { await q(`INSERT INTO plataforma.etapa (tenant_id, nome, valor) VALUES ($1, $2, $3) ON CONFLICT (tenant_id, nome) DO UPDATE SET valor = EXCLUDED.valor, feita_em = now()`, [id, nome, valor ?? null]) },
    async marca(id, status, motivo) { await q(`UPDATE plataforma.tenant SET status = $2, motivo = $3, atualizado_em = now() WHERE id = $1 AND status <> 'cancelado'`, [id, status, motivo ?? null]) },
    async habilita(id, servicos) { for (const s of servicos) await q(`INSERT INTO plataforma.modulo (tenant_id, servico) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [id, s]) },
  }
}
