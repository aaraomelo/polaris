# 0008 — Autorização por papéis declarativos; negar vence; falha fechada

**Contexto.** O `access` do tiffany-erp (CASL) descartava proibições sem condição ao montar o filtro: um "nunca" virava "sempre".

**Decisão.** Papéis são nós (`kind: papel`, com herança e cascata por tenant). A decisão é: linhas = (⋃ grants) ∖ (⋃ proibições), **negar vence em qualquer ordem**; proibição sem condição nega a ação inteira; regra ilegível ou papel desconhecido **nega e reporta**. A condição (MongoQuery) é avaliada em JS e **compilada para SQL** (WHERE), com a prova de equivalência por fuzz contra o Postgres. O CASL é o oráculo dos testes e serve ao front.

**Consequências.** O escopo de linha é aplicado no banco, não depois. Custo: subconjunto de MongoQuery (sem `$regex`: dialetos diferem e há risco de ReDoS).

**Evidência.** `docs/acesso.md`, `packages/acesso/test` (2000 condições × 80 linhas; 800 regras × CASL), `packages/servico/test/acesso.test.ts`.
