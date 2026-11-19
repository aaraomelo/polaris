import { DDL_ATIVOS } from './ativos'
import { DDL_IDENTIDADE } from './identidade'
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
CREATE TABLE IF NOT EXISTS plataforma.dominio (
  tenant_id uuid NOT NULL REFERENCES plataforma.tenant (id),
  dominio text NOT NULL,
  token text NOT NULL,
  verificado boolean NOT NULL DEFAULT false,
  verificado_em timestamptz,
  criado_em timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, dominio)
);
-- um domínio só pode estar VERIFICADO em UM tenant; reivindicações não verificadas podem coexistir (e perdem para quem provar a posse)
CREATE UNIQUE INDEX IF NOT EXISTS dominio_verificado_uidx ON plataforma.dominio (dominio) WHERE verificado;
-- as versões dos nós de um tenant (overrides): IMUTÁVEIS. O "rascunho" é a versão mais recente; uma release (publicação) fixa um conjunto de versões.
CREATE TABLE IF NOT EXISTS plataforma.no_versao (
  tenant_id uuid NOT NULL REFERENCES plataforma.tenant (id),
  kind text NOT NULL,
  id text NOT NULL,
  seq integer NOT NULL,
  conteudo jsonb,
  hash text NOT NULL,
  autor text NOT NULL,
  nota text,
  criado_em timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, kind, id, seq)
);
CREATE OR REPLACE FUNCTION plataforma.imutavel() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'versões de nó são imutáveis (%)', TG_OP; END $$;
CREATE TABLE IF NOT EXISTS plataforma.comentario (
  tenant_id uuid NOT NULL REFERENCES plataforma.tenant (id),
  id uuid NOT NULL DEFAULT gen_random_uuid(),
  kind text NOT NULL,
  no_id text NOT NULL,
  ancora text,
  versao integer,
  autor text NOT NULL,
  texto text NOT NULL CHECK (length(texto) BETWEEN 1 AND 4000),
  resp_a uuid,
  resolvido boolean NOT NULL DEFAULT false,
  criado_em timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, id)
);
CREATE INDEX IF NOT EXISTS comentario_no ON plataforma.comentario (tenant_id, kind, no_id, criado_em);
DROP TRIGGER IF EXISTS no_versao_imutavel ON plataforma.no_versao;
CREATE TRIGGER no_versao_imutavel BEFORE UPDATE OR DELETE ON plataforma.no_versao FOR EACH ROW EXECUTE FUNCTION plataforma.imutavel();
-- release = SNAPSHOT imutável: o conjunto exato de versões de nós que vai a produção. release_ponteiro aponta a de produção; release_evento é o diário (promoções e rollbacks).
CREATE TABLE IF NOT EXISTS plataforma.release (
  tenant_id uuid NOT NULL REFERENCES plataforma.tenant (id),
  numero integer NOT NULL,
  manifesto jsonb NOT NULL,
  hash text NOT NULL,
  autor text NOT NULL,
  nota text,
  criado_em timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, numero)
);
DROP TRIGGER IF EXISTS release_imutavel ON plataforma.release;
CREATE TRIGGER release_imutavel BEFORE UPDATE OR DELETE ON plataforma.release FOR EACH ROW EXECUTE FUNCTION plataforma.imutavel();
CREATE TABLE IF NOT EXISTS plataforma.release_ponteiro (
  tenant_id uuid PRIMARY KEY REFERENCES plataforma.tenant (id),
  producao integer,
  anterior integer,
  atualizado_em timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS plataforma.release_evento (
  tenant_id uuid NOT NULL REFERENCES plataforma.tenant (id),
  n integer NOT NULL,
  tipo text NOT NULL CHECK (tipo IN ('promocao', 'rollback')),
  de integer,
  para integer NOT NULL,
  autor text NOT NULL,
  nota text,
  em timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, n)
);
DROP TRIGGER IF EXISTS release_evento_imutavel ON plataforma.release_evento;
CREATE TRIGGER release_evento_imutavel BEFORE UPDATE OR DELETE ON plataforma.release_evento FOR EACH ROW EXECUTE FUNCTION plataforma.imutavel();
CREATE TABLE IF NOT EXISTS plataforma.modulo (
  tenant_id uuid NOT NULL REFERENCES plataforma.tenant (id),
  servico text NOT NULL,
  habilitado_em timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tenant_id, servico)
);` + DDL_IDENTIDADE + DDL_ATIVOS

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
