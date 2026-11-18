# 0002 — Runtime próprio sem React, com AOT por página; React só como oráculo

**Contexto.** O primeiro caminho renderizava com React. Medido em Chrome real, o React custa ~143 KB gz de JS e reavalia a página inteira a cada mudança.

**Decisão.** O padrão é o **runtime vivo** (DOM atualizado por dependências de caminho, hidratação por adoção de nós, listas por LIS, streaming sem Suspense), com **pacote AOT por página** (tree-shaking). O interpretador do `Programa` continua para dev/preview e programas dinâmicos. **React fica como oráculo de teste** e último recurso do build.

**Consequências.** 10,6 KB gz por página (13,5× menor), TTI 2,4× menor com CPU 4× e 4G lenta, INP ≤ 48 ms nas interações pequenas. Custo: manter dois caminhos coerentes (a paridade é garantida por testes diferenciais contra o React).

**Evidência.** `docs/decisao-runtime.md`, `docs/desempenho.md`, `bench/navegador/cdp.mjs`, `orcamento.json` (limites que bloqueiam o PR).
