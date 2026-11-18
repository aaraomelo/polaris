# 0005 — Multi-tenant por RLS no Postgres, com tenant só da autenticação

**Contexto.** Isolamento por convenção ("lembrar do WHERE tenant_id") falha. Uma chave estrangeira simples também vaza: as checagens de integridade do Postgres ignoram a RLS.

**Decisão.** Toda tabela tem `tenant_id` e **RLS forçada** (`USING` + `WITH CHECK`, dono incluso), com `app.tenant_id` fixado por transação e falha **fechada** sem tenant. Referências entre entidades são **FKs compostas** `(tenant_id, id)`. A conexão da aplicação **não** tem `BYPASSRLS`; só o migrador e o relay do outbox têm. O tenant vem **só da autenticação** (token ou host), nunca do corpo, da query nem de cabeçalho.

**Consequências.** Mesmo um bug de aplicação não cruza tenants. Custo: migrações exigem papel privilegiado; consultas entre tenants são deliberadamente impossíveis.

**Evidência.** `docs/persistencia.md`, `packages/schema/test/postgres.test.ts` e `migracao-sql.test.ts` (Postgres real), `packages/servico/test`.
