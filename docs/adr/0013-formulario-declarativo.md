# 0013 — Formulários declarativos, com o mesmo motor no navegador e no servidor

**Contexto.** Formulário é onde a maior parte dos erros de negócio acontece: campos, máscaras, formatos brasileiros, validação, mensagens e o envio a um serviço. Escrever isso à mão em cada página repete código e deixa o servidor e o navegador discordarem.

**Decisão.** Um novo `kind: formulario` (JSON Schema), com um **único motor** (`packages/engine/src/formulario`: máscaras, formatos, validador) usado nos dois lados, e o envio por `POST /bff/formularios/:id`, onde o servidor **valida de novo** e só então chama a operação do serviço. Pontos que valem como regra: dinheiro e percentual em **decimal exato** (sem ponto flutuante); o servidor **ignora** o que o navegador manda em campos somente leitura, desabilitados ou calculados; só os campos **declarados** voltam; expressão que falha **reprova** a regra (nunca aprova); expressão regular só no subconjunto seguro (sem repetição aninhada); `envio` é conferido contra a operação REAL do serviço quando o nó é validado; tenant e usuário vêm do token/host, nunca do corpo; chave de idempotência contra o envio duplo.

**Consequências.** A definição é dado: o Studio, a documentação e as páginas podem gerá-la e conferi-la. Custo: um tipo de nó a mais (schema, migração, fixtures congeladas, goldens) e um motor próprio de máscaras e validação em vez de uma biblioteca de formulários.

**Evidência.** `docs/formularios.md`, `packages/schema/test/formulario.test.ts`, `packages/engine/test/formulario.test.ts` (incluindo propriedades das máscaras e entradas hostis), `packages/gateway/test/formularios.test.ts`.
