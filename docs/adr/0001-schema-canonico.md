# 0001 — Tudo é declarativo em JSON Schema; o código é gerado

**Contexto.** A plataforma serve varejo, serviços e alimentos para muitos tenants, cada um com páginas, temas e regras próprias. Código escrito à mão por tenant não escala, não é auditável e não se valida.

**Decisão.** Páginas, blocos, temas, serviços, eventos, papéis, documentos e kernels são **nós JSON** (kind + id + versao + spec) validados por JSON Schema. O JS/HTML/SQL/OpenAPI/CSS é **gerado** do nó (em runtime ou AOT). Cascata de escopo: página → tenant → segmento → core, com `extends` e override por tenant. Mudança incompatível de um kind sobe o major do schema e exige migração declarativa (`docs/versionamento.md`).

**Consequências.** Validação e documentação saem do mesmo schema; o catálogo, o OpenAPI e o SQL nunca divergem do contrato. Custo: a expressividade é a do schema (lógica fora dele entra por expressões da linguagem funcional total ou por código isolado em sandbox).

**Evidência.** `packages/schema` (394 testes, golden e fixtures congeladas por major), `docs/versionamento.md`, `docs/servicos.md`, `docs/catalogo`.
