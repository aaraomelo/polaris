# ADRs (decisões de arquitetura)

Formato curto: **Contexto**, **Decisão**, **Consequências** (inclusive o que se perde), **Evidência** (onde está provado). Uma decisão por arquivo, numerada. Para mudar uma decisão, escreva um ADR novo que a **substitui** (o antigo fica, marcado "substituído por").

| # | Decisão | Estado |
|---|---|---|
| [0001](0001-schema-canonico.md) | Tudo é declarativo em JSON Schema; o código é gerado | aceito |
| [0002](0002-runtime-vivo-aot.md) | Runtime próprio (sem React) com AOT por página; React só como oráculo | aceito |
| [0003](0003-isomorfismo.md) | Isomorfismo: o mesmo Programa e o mesmo modelo no servidor e no cliente | aceito |
| [0004](0004-backends-e-politica.md) | Política de backends de computação e de execução de código de tenant | aceito |
| [0005](0005-multitenancy-rls.md) | Multi-tenant por RLS no Postgres, com tenant só da autenticação | aceito |
| [0006](0006-dinheiro-exato.md) | Dinheiro é texto decimal exato, nunca float | aceito |
| [0007](0007-eventos-outbox.md) | Eventos entre serviços por outbox transacional, ao menos uma vez e inbox idempotente | aceito |
| [0008](0008-acesso-negar-vence.md) | Autorização por papéis declarativos; negar vence; falha fechada | aceito |
