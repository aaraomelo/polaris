-- polaris: servico vitrine-busca@1.0.0
CREATE SCHEMA IF NOT EXISTS "vitrine-busca";

CREATE TABLE IF NOT EXISTS "vitrine-busca"."artigo" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL,
  "titulo" text NOT NULL,
  "resumo" text,
  "publicado" boolean DEFAULT TRUE,
  "criado_em" timestamptz NOT NULL DEFAULT now(),
  "atualizado_em" timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "artigo_tenant_id_uidx" ON "vitrine-busca"."artigo" ("tenant_id", "id");
CREATE INDEX IF NOT EXISTS "artigo_tenant_idx" ON "vitrine-busca"."artigo" ("tenant_id");
ALTER TABLE "vitrine-busca"."artigo" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "vitrine-busca"."artigo" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "artigo_tenant" ON "vitrine-busca"."artigo";
CREATE POLICY "artigo_tenant" ON "vitrine-busca"."artigo"
  USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);
