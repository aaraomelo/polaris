# 0003 — Isomorfismo: o mesmo Programa e o mesmo modelo no servidor e no cliente

**Contexto.** SSR + hidratação só funcionam se servidor e cliente produzem a mesma coisa; divergência vira bug visual ou de segurança.

**Decisão.** Um `Programa` JSON puro alimenta o HTML do servidor, o runtime do cliente e o AOT. O estado é um **modelo imutável** com diff por referência e patches reversíveis, desacoplado do DOM (o DOM é um espelho). Expressões viram closures; o `agora` do código de tenant é fixado no servidor e enviado ao cliente. Hidratação **adota** os nós e, se divergir, reconstrói e avisa.

**Consequências.** Testes de hidratação sem divergência, com detector que prova que sabe falhar. Limite conhecido: UI de tenant com aninhamento que o parser HTML reescreve (`p>div`) pode divergir.

**Evidência.** `docs/vivo.md`, `docs/expressoes.md`, `packages/engine/test/hidratacao*`, `vivo-codigo*`.
