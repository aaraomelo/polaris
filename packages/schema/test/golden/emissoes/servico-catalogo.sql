-- polaris: servico catalogo@1.0.0
CREATE SCHEMA IF NOT EXISTS "catalogo";

CREATE TABLE IF NOT EXISTS "catalogo"."produto" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" uuid NOT NULL,
  "nome" text NOT NULL,
  "preco" numeric(19,4) NOT NULL,
  "criado_em" timestamptz NOT NULL DEFAULT now(),
  "atualizado_em" timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "produto_tenant_id_uidx" ON "catalogo"."produto" ("tenant_id", "id");
CREATE INDEX IF NOT EXISTS "produto_tenant_idx" ON "catalogo"."produto" ("tenant_id");
ALTER TABLE "catalogo"."produto" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "catalogo"."produto" FORCE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "produto_tenant" ON "catalogo"."produto";
CREATE POLICY "produto_tenant" ON "catalogo"."produto"
  USING ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid)
  WITH CHECK ("tenant_id" = nullif(current_setting('app.tenant_id', true), '')::uuid);
