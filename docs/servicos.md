# Serviços gerados do schema (kind `servico`)

Um serviço é um nó `servico` (entidades, operações, eventos). Dele saem **três artefatos coerentes**, todos a partir da mesma tabela de rotas (`rotasDe`, em `packages/schema/src/servico-api.ts`):

| Artefato | Como | Onde |
|---|---|---|
| SQL (DDL, RLS, FKs compostas, migrações) | `emite(no, 'sql')`, `migraSql` | `docs/persistencia.md` |
| OpenAPI 3.1 | `emite(no, 'openapi')` | golden em `packages/schema/test/golden/emissoes` |
| Servidor HTTP (Fastify) | `criaServico(no, opcoes)` | `packages/servico` |

## Declarar
```json
{ "kind": "servico", "id": "loja", "spec": {
  "entidades": { "produto": {
      "campos": { "sku": { "tipo": "texto", "obrigatorio": true }, "preco": { "tipo": "dinheiro", "obrigatorio": true } },
      "crud": { "caminho": "/produtos", "operacoes": ["listar", "obter", "criar"], "permissao": "catalogo" } } },
  "operacoes": { "cancelar": { "metodo": "POST", "caminho": "/pedidos/:id/cancelar", "entrada": { "id": { "tipo": "uuid", "obrigatorio": true } },
                 "saida": "pedido", "permissao": "vendas", "publica": ["pedidoCancelado"] } } } }
```
- `crud` gera `listar` (filtros por campo + `pagina`/`limite` ≤ 100), `obter`, `criar` (201), `atualizar` (PATCH parcial), `remover` (204). Ids: `listarProduto`, `criarProduto`…
- `operacoes` são as demais; `lista: true` marca saída em lista. Parâmetros `:x` do caminho precisam estar em `entrada`.
- `permissao`: `publica` (sem autenticação) | `autenticada` (qualquer usuário autenticado) | qualquer outro valor, inclusive o padrão = `protegida`: os papéis decidem (ver `docs/acesso.md`).
- Esquemas dos campos: `dinheiro` = **texto** decimal exato (`"49.90"`, até 4 casas; número é recusado), `inteiro` limitado aos inteiros seguros, `uuid`/`data`/`dataHora` com formato, `json` livre.

## Rodar
```ts
import { criaServico, dbDePglite } from '@polaris/servico'
const app = criaServico(no, {
  db,                                   // { transacao(tenantId, fn) } — abre transação e fixa app.tenant_id
  contexto: contextoPorJwt(autenticadorJwt, (req) => /* rotas públicas: tenant pelo host */ null),
  acesso: regrasDoRegistry(registry),   // regras dos papéis do chamador (obrigatório se houver rota protegida)
  operacoes: { cancelar: async ({ params, entrada, ctx, q, publica }) => { … await publica('pedido.cancelado', {…}); return pedido } },
  eventos: { "pedido.cancelado": nodeEvento },  // contratos do que as operações publicam (obrigatório se houver `publica`)
})
await app.listen({ port: 3000 })
```
Sem implementação, uma operação declarada responde **501**. `dbDePglite` é o adaptador de dev/teste; para `pg` basta `Pool.connect()` + `BEGIN` + `set_config('app.tenant_id', $1, true)` + `COMMIT`. A conexão **não** pode ter `BYPASSRLS`.

## Garantias (todas testadas, `packages/servico/test/servico.test.ts`: Fastify real + Postgres real com RLS)
- **Tenant só da autenticação.** Corpo/query com `tenantId`/`tenant_id` → 400; cabeçalho `x-tenant-id` é ignorado. Rota pública resolve o tenant pelo host; host desconhecido → 400, nunca "todos".
- **Autenticar antes de validar**: um anônimo recebe 401 mesmo com corpo inválido (não aprende o contrato por mensagens de validação). Sem permissão: 403. Escopo de linha, campos e JWT: `docs/acesso.md`.
- **Corpo sem coerção de tipo** (`49.9` em dinheiro é recusado); **campo desconhecido é rejeitado**, não descartado; query é coagida (tudo chega como texto).
- **RLS como barreira final**: id de outro tenant → **404** (não revela existência); FK composta recusa referência cruzada (409); 20 requisições concorrentes de dois tenants não vazam entre si.
- **Resposta filtrada** pelo esquema de saída: o que a API não promete (`tenant_id`, campos extras de um handler) nunca sai.
- **Erros**: 400 com `detalhes[{caminho, mensagem}]` em português; 409 (duplicado, referência), 404, 413, 415, 501; o 500 é genérico (a mensagem interna não vaza, vai para `aoErro`) e a **transação desfaz** o que já tinha feito. Formato único `{ "erro": { codigo, mensagem, detalhes? } }`.
- **SQL só com identificadores do schema** e valores por parâmetro. Só `application/json`. Cabeçalhos `nosniff` e `no-store`. O serviço serve exatamente as rotas do OpenAPI.

## Fora desta entrega
O gateway/BFF é um card seguinte; GraphQL; geração do serviço como **arquivos** de código (aqui o servidor é montado do schema em runtime, o equivalente do interpretador; o AOT do serviço seria emitir esse mesmo código especializado).

## Busca por texto (`busca`)
Uma entidade com `crud` pode declarar `busca: { campos: ["titulo", "descricao"], modo?: "exata" | "aproximada" }` (1 a 5 campos de **texto**, não lista): a listagem gerada ganha o parâmetro **`busca`** (até 100 caracteres), que vale na REST, no GraphQL e no OpenAPI.
- **Como casa**: o termo vira palavras (até 5, separadas por qualquer pontuação); **todas** precisam casar com o texto dos campos juntos; **maiúsculas e acentos não importam** (`cafe` acha "Café"). Termo sem palavra alguma (só pontuação) não filtra. Combina com `pagina`, `limite` e com os filtros por campo.
- **`modo: exata`** (padrão): a palavra precisa ser um **trecho** do texto; a ordem é a de criação. Postgres puro, sem extensão.
- **`modo: aproximada`**: a palavra também pode ser **parecida** (erro de digitação: `cafetera` acha "Cafeteira", `capucino` acha "Capuccino"; limiar do `pg_trgm`, 0,6) e o resultado sai por **relevância**: `word_similarity` + 1 se contém + ½ de `similarity` (o texto curto e focado ganha) + ½ se achou no **primeiro campo** (o título); empate: ordem de criação. Cria um **índice GIN trigrama** sobre a MESMA expressão da consulta (verificado com `EXPLAIN`), que também acelera o `LIKE '%palavra%'`: a busca deixa de varrer a tabela.
- **Extensão `pg_trgm`**: o SQL gerado faz `CREATE SCHEMA IF NOT EXISTS ext; CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA ext; GRANT USAGE ON SCHEMA ext TO PUBLIC` (schema próprio: `public` pode estar fechado ao papel de migração). Desde o Postgres 13 ela é **confiável**: o papel de migração só precisa de `CREATE` no banco; em serviços gerenciados confira que a extensão está liberada. No PGlite (testes e `pnpm local`) ela é carregada com `extensions: { pg_trgm }`. **Só quem declara `aproximada` exige a extensão.**
- **Como é feito**: a normalização do termo (JS) e da coluna (SQL `lower(translate(…))`, tabela de acentos Latin-1 e Latino Estendido A/B) é a mesma, e a expressão da coluna é uma só (`exprDeBusca`), usada na consulta e no índice. O termo vai sempre como **parâmetro**, com os curingas do `LIKE` escapados: `%`, `_`, aspas e `;` são só texto.
- **Validação** (ao gerar as rotas): campo inexistente, que não seja texto, lista, ou entidade com um campo real chamado `busca` são recusados com mensagem clara.
- **Limites**: a API **não devolve o total** (quem pagina decide "Próxima" olhando se há um item depois); sem destaque do trecho, sem sinônimos nem radicalização ("cafés" não acha "café" no modo exato; no aproximado costuma achar); trigrama não ajuda em palavras de 1 ou 2 letras (a aproximação nelas é só por trecho); alterar `modo` de uma entidade que já tem dados exige rodar a migração para criar o índice (o `CREATE INDEX` é idempotente).
