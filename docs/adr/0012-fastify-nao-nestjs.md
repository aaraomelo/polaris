# 0012 — Serviços gerados em Fastify, sem NestJS

**Contexto.** Cada serviço (microsserviço) é **gerado do schema** (`kind: servico`): CRUD, operações, OpenAPI, SQL, RLS. A pergunta era gerar para NestJS (módulos, decoradores, DI) ou para Fastify.

**Decisão.** **Fastify**, por uma função (`criaServico(no, opcoes)`) em `packages/servico`. Rotas, esquemas de validação e OpenAPI saem do mesmo nó; autenticação, autorização (CASL), RLS, outbox/inbox e observabilidade são plugins e portas explícitos. O gateway/BFF também é Fastify.

**Por que não NestJS**: decoradores e DI são código escrito à mão que o schema já substitui; geraríamos classes para depois configurá-las por metadados, uma camada a mais sem ganho. Fastify já tem validação por JSON Schema nativa, que é exatamente o contrato do nó.

**Consequências.** Menos código gerado e menos magia; testes sobem o Fastify real com Postgres real. Custo: sem o ecossistema de módulos do Nest (guards, pipes), tudo isso é feito com hooks e portas nossas; e o validador padrão do Fastify descartava campo extra em silêncio, então o gateway usa validação estrita (achado e corrigido nos testes).

**Evidência.** `docs/servicos.md`, `docs/gateway.md`, `packages/servico/test/servico.test.ts`, `packages/gateway`.
