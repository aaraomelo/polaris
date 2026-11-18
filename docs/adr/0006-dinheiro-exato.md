# 0006 — Dinheiro é texto decimal exato, nunca float

**Contexto.** `0.1 + 0.2` e `1.005` quebram aritmética de ponto flutuante; um preço errado em um centavo é um bug de negócio.

**Decisão.** O tipo `dinheiro` é **texto decimal** (`"49.90"`, até 15 inteiros e 4 casas) em JSON, `numeric(19,4)` no banco, aritmética racional exata (`q*`) no runtime e `qbrl` para exibir. Número no corpo de uma API é **recusado**; os argumentos de página mantêm o texto.

**Consequências.** Exatidão ponta a ponta. Custo: o cliente precisa tratar dinheiro como texto. Já pegou um defeito real: o carregador de dados convertia dinheiro em `Number`.

**Evidência.** `docs/funcoes.md` (torre numérica), `packages/servico/test`, `packages/gateway/test`, `packages/engine/test/args.test.ts`.
