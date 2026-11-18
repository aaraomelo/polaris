# 0010 — Linguagem de expressões própria, da família do CEL

**Contexto.** Páginas em JSON precisam de condicionais (`se`), repetição (`repetir.cada`) e bindings em texto, escritos por quem não programa, sem poder executar código arbitrário. Candidatas: CEL, JSONata ou uma própria.

**Decisão.** Linguagem **própria**, da família do CEL, **total** (sempre termina, sem efeitos), em `packages/engine/src/expr`. Forma canônica em **AST JSON** (o texto é açúcar que compila para ela e volta). Chave ou campo ausente é tolerante (vira vazio), não erro; números têm uma só espécie. Funções por registro único, com combinadores (`mapeia`, `filtra`, `dobra`…).

**Por que não CEL**: é tipado estrito (`preco * 2` falha, inteiros viram `bigint`) e erra em chave ausente, o que quebra a renderização de páginas feitas por não-programadores. **JSONata** não foi avaliado a fundo (o registro de decisão original só comparou o CEL); a escolha foi por controle total do custo e da terminação. A interface é pequena (`parseExpr`, `avalia`, `validaExpr`), então trocar depois é localizado.

**Consequências.** Segurança por construção (sem acesso a protótipo, limites de nós, profundidade e passos); a mesma linguagem serve ao servidor, ao cliente, às restrições de kernels e à ACL (MongoQuery compilado para SQL e JS). Custo: manter parser, AST, biblioteca e documentação próprios; quem vem de CEL encontra diferenças (tolerância a ausente).

**Evidência.** `docs/expressoes.md`, `docs/funcoes.md`, `packages/engine/test` (fuzz: texto ≡ AST ≡ closures ≡ avaliador sobre milhares de expressões), `packages/acesso` (oráculo contra o CASL).
