# 0004 — Política de backends de computação e de execução de código de tenant

**Contexto.** Há trabalho que não cabe em JS puro (WebGL/GLSL, PTX, WASM), e tenants precisam de um "escape hatch" de código próprio. Ambos são superfícies de risco.

**Decisão.** (1) Backends de computação são declarados por `kind: kernel` e escolhidos por capacidade e custo; cada backend é verificado por **testes de paridade** contra a referência (E6). (2) Código de tenant roda **isolado e fail-closed**: modo puro (QuickJS WASM, saída = descrição de UI validada por allowlist) ou iframe sem `allow-same-origin` com CSP por hash; permissões e origens por allowlist; orçamento de tempo e memória; determinístico (relógio fixo, fuso UTC). Sem sandbox, o bloco é omitido e reportado. Fonte `http` de página não tem provedor: nenhum `fetch` sai por conta de uma página.

**Consequências.** Segurança por construção, ao custo de capacidade (sem acesso a rede/DOM do host). O sandbox em processo não é preemptivo (use o worker no servidor).

**Evidência.** `docs/sandbox.md`, `docs/seguranca.md`, `packages/engine/test/sandbox*`, `codigo*`.
