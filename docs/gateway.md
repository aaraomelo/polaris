# Gateway/BFF

`packages/gateway`. A borda da plataforma: **compõe os dados de uma página**, expõe o **REST** e o **GraphQL gerados dos schemas** dos serviços e faz o que só a borda faz (autenticar o token, limitar taxa, não deixar o cliente escolher destino, cabeçalho nem tenant). Os serviços continuam decidindo permissão: o gateway repassa o `Authorization` (defesa em profundidade, não substituição).

```ts
const gw = criaGateway({
  registry,                                   // páginas (com seus nós `dados`) e os contratos dos serviços
  servicos: { loja: { no: lojaNode, cliente: clienteHttp({ baseUrl: 'http://loja:3000' }) } },   // destino FIXO na configuração
  autenticador: criaAutenticadorJwt({ … }),   // o token é verificado AQUI
  tenantPorHost: (h) => tenants[h],           // só para requisição anônima (rotas públicas)
  obs, metricasToken,
})
```

## BFF de página
- `GET /bff/paginas/:id?p.<param>=…&q.<busca>=…` → `{ dados, status, erros }`. Usa o carregador do engine (`carregaDados`): argumentos **tipados** pelo `parametros` do nó `dados`, `timeoutMs`, dados independentes **em paralelo**, e **falha parcial**: um dado que falha vira `status: erro` (texto opaco), os outros vêm.
- `p.<nome>` são parâmetros da rota da página, tipados pelo `spec.params` (obrigatório = aparece como `:nome` na rota). `q.<nome>` é consulta (texto livre, ≤ 500 caracteres, ≤ 50 chaves). **Qualquer outra chave é 400**, inclusive `__proto__`/`constructor`.
- `POST /bff/executar` `{ pagina, dados, args, estado }` roda UM dado (mutação) pelo mesmo pipeline. Exige **usuário** autenticado; o 4xx do serviço volta como 4xx (um 403 não vira 502). `estado`+`args` ≤ 50 KB.
- Resposta com `Cache-Control: private, no-store` e `Vary: Authorization`.

## Cache por tenant (e por usuário quando precisa)
O cache do engine guarda por `[tenant, fonte, args]`; no gateway isso **não bastava**: um dado `protegida` varia com o usuário (papéis, escopo de linha), e servir o resultado da Ana ao Bia seria vazamento. Regra do `VisaoDeCache`:
- dado de operação **`publica`** (ou estático) → escopo do **tenant** (todos os usuários do tenant compartilham);
- qualquer outro → escopo **usuário + papéis**: nunca compartilha entre usuários.
- O tenant está **sempre** na chave. Erro nunca é guardado. LRU limitado e **deduplicação** (10 requisições simultâneas = 1 chamada ao serviço). `cache.invalidaTenant(t)` apaga só o desse tenant.
- Liga com `cache.ttlSegundos` no nó `dados` (padrão: sem cache). Métrica `gateway_cache_total{resultado}`.

## REST gerado
`/api/<servico>/<rota>` para cada rota do schema do serviço (`rotasDe`), com a **mesma validação** do serviço (`esquemasHttp`, fonte única no schema): inválido é 400 **na borda e não chega ao serviço**; campo desconhecido é rejeitado (não descartado). Rota não pública sem usuário → 401 aqui. Repassa status e corpo (201, 204…). O 4xx do serviço passa com o **texto do serviço**; 5xx e falha de rede viram **502/504 opacos** (sem host, porta nem mensagem interna), com `requisicaoId`.

## GraphQL gerado
`POST /graphql`, do mesmo schema: cada entidade é um tipo (`LojaProduto`), cada rota uma consulta (GET) ou mutação, prefixadas pelo serviço (`loja_listarProduto`). `Dinheiro`, `Data`, `DataHora`, `Uuid` e `Json` são escalares **validados** (dinheiro como número é recusado). Campo `referencia` vira **relação navegável** (`pedido.cliente`), resolvida pelo `obter` do serviço com **memo por requisição** (3 pedidos do mesmo cliente = 1 chamada). Todos os campos da entidade (menos `id`) são anuláveis: o papel pode ocultar campos.
- **Limites**: profundidade (6), complexidade (2000; listas multiplicam pelo `limite`), aliases (20), campos de raiz (10), tamanho (10 000), prazo (15 s). Recusados **antes de executar** (`consulta_cara`).
- **Introspecção desligada por padrão** (`graphql.introspeccao: true` liga). Sugestões "Did you mean" mascaradas (não vazam o schema). Erro de serviço 4xx traduzido com `extensions {codigo, status}`; 5xx e exceções de resolver, opacos.
- Só POST de JSON; **sem lote** (array), sem campo extra no corpo; mutação exige usuário.

## Segurança da borda
- **Destino fixo**: a base de cada serviço é da configuração e o caminho sai do schema; só rota declarada é chamável, e `args` é conferido contra a **entrada declarada** (argumento desconhecido é erro). Fonte `http` de página **não tem provedor** (nenhum `fetch` sai por conta de uma página; testado).
- **Cliente HTTP**: não segue redirecionamento (SSRF/open redirect), limita o tamanho da resposta (também em stream sem `content-length`), tem prazo, valida o caminho (sem `..`, `//`, `\`, `%2e`, `%2f`, `?`, `#`) e a `baseUrl` (só http/https, sem credenciais).
- **Cabeçalhos que seguem** (lista fechada): `authorization`, `x-request-id`, `traceparent` (de um span filho), `x-forwarded-host` (para o serviço resolver o tenant de rota pública; **só confie nele se o gateway é a única porta de entrada**) e `accept-language`. Cookie, `x-tenant-id`, host e `x-forwarded-for` **nunca** passam.
- **Tenant nunca do cliente**: só do token (ou do host, em requisição anônima). Token presente e inválido é 401 (nunca vira anônimo).
- **Validador estrito em todo o gateway**: o padrão do Fastify (`removeAdditional`) descartaria campo extra em silêncio; achado e corrigido durante os testes.
- **Taxa** (`limiteTaxa`, balde de fichas): por usuário+tenant (ou IP+tenant se anônimo), memória limitada (LRU), 429 com `Retry-After`; no GraphQL a consulta cara custa mais fichas.

## Observabilidade
A mesma instrumentação dos serviços (`instalaObservabilidadeFastify`). **Um trace** do gateway ao serviço: span servidor → `servico.chama` (cliente) → span do serviço, continuado pelo `traceparent` (testado). `gateway_chamadas_servico_total{servico,resultado}`, `gateway_chamada_servico_duracao_segundos`, `gateway_cache_total`, `gateway_limite_taxa_total`, `graphql_operacoes_total`. Sem segredo em log, métrica ou span (token, cookie e query não aparecem; testado).

## Achados desta entrega
1. O `confereValor` do engine normalizava `dinheiro` para **`Number`** (float): um `"49.90"` virava `49.9` e o serviço o recusava. Agora dinheiro é texto decimal exato (≤ 15 inteiros, 4 casas).
2. Cache por tenant vazaria dado entre usuários com papéis diferentes (acima).
3. Validador padrão do Fastify descartava campo extra em silêncio (acima).
4. `dados` com operação ou parâmetro que o serviço não tem só quebrava em execução: agora o schema confere (`validaDados`: operação inexistente com "quis dizer…", parâmetro desconhecido ou de tipo errado).

## Limites
- **Sem streaming** da composição de página (a resposta sai quando todos os dados terminam ou estouram o prazo); o streaming existente é o do `streamVivo` (SSR).
- Cache e taxa **por processo**: com várias instâncias, o limite efetivo é multiplicado e o cache não é compartilhado (use cache externo e um limitador central se precisar).
- Sem *batching* de requisições ao serviço no GraphQL além do memo por requisição (um `obter` por id distinto).
- Invalidação de cache por **evento** não está ligada (só TTL e `invalidaTenant`); o consumidor de eventos pode chamá-la.
- Sem GraphQL *subscriptions*, sem persisted queries.
