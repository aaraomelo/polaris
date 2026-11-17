# Observabilidade (injetada pelo gerador)

`criaServico` liga **logs estruturados, métricas e traces** sem o autor do serviço escrever nada. Código: `packages/observabilidade` (sem dependências externas) e a integração em `@polaris/servico` e `@polaris/eventos`. Testado ponta a ponta (`packages/servico/test/observabilidade.test.ts`).

```ts
const app = criaServico(no, { db, acesso, contexto })            // já loga, mede e rastreia
const app = criaServico(no, { …, obs: criaObservabilidade({ servico, exportador: meuOtlp }), metricasToken })  // para exportar spans e ligar /metrics
```

## Logs
Uma linha JSON por evento. `POLARIS_LOG_NIVEL` = `debug|info|warn|error|silencio` (padrão info). Por requisição:
`{ts, nivel, msg:"requisicao", servico, versao, metodo, rota, status, duracaoMs, requisicaoId, traceId, spanId, tenantId, usuario}`. Nível: 5xx error, 4xx warn, o resto info; `/saude`, `/pronto` e `/metrics` em debug.
- **Nunca** são registrados corpo, cabeçalhos nem query string (podem ter dado pessoal e segredo). A **rota é o template** (`/pedidos/:id`), nunca a URL real.
- **Rede de segurança de redação** em tudo que sai (log e atributos de span): chaves sensíveis (`senha, token, authorization, cookie, api_key, chave, cartão, cvv…`) → `[REDIGIDO]`; dentro de texto, JWT → `[JWT]`, `Bearer/Basic …` e `usuário:senha@` em URL são mascarados; sem ciclos, funções, tamanho e profundidade limitados.
- **Não se forja linha de log**: é `JSON.stringify`, então quebra de linha e aspas em qualquer valor viram escape; campos do chamador não sobrescrevem `ts/nivel/msg` (viram `campo_*`).
- O log nunca derruba quem o chama (saída que lança é engolida). O usuário é o `sub` do token (pseudônimo; é dado pessoal sob a LGPD: trate o log como tal).

## Métricas (Prometheus, `GET /metrics`)
Toda série leva `servico`. `http_requests_total{metodo,rota,status}`, `http_request_duration_seconds` (histograma), `http_requests_in_flight`, `http_recusadas_total{status,codigo}` (401/403), `db_transacoes_total{resultado=confirmada|desfeita}` + `db_transacao_duracao_segundos`, `eventos_publicados_total{evento}`; no relay: `outbox_publicados_total`, `outbox_falhas_total`, `outbox_mortos_total`, **`outbox_pendentes`** e **`outbox_idade_maxima_segundos`** (o atraso do relay, o que se alerta); no consumidor: `eventos_consumidos_total{consumidor,resultado}`.
- **Cardinalidade fixa**: rótulo de rota é o template (300 rotas inexistentes e 50 ids aleatórios não criam série: tudo cai em `desconhecida` ou na série do template); além disso, cada métrica tem **teto de séries (1000)** e o excedente vai para `_outros` e é contado em `metricas_series_descartadas_total`.
- Exposição com escape de rótulo e ajuda (valor com aspas, barra ou quebra de linha não injeta série).
- **`/metrics` é fechado por padrão**: sem `metricasToken` a rota **não existe** (404); com ele exige `Authorization: Bearer <token>` (mín. 16 caracteres), comparado em tempo constante.

## Traces (W3C Trace Context)
- Um **span servidor** por requisição (`GET /pedidos/:id`), com filho `db.transacao` (cliente, `db.sistema=postgresql`) e `evento.publica` (produtor). O contexto atravessa `await` (AsyncLocalStorage), e o log leva o mesmo `traceId`.
- `traceparent` recebido é **validado** (formato exato; id zerado, versão `ff`, maiúsculas, tamanho errado, injeção de cabeçalho ⇒ **recusado e começa trace novo**, nunca confiado). A decisão de amostragem do pai é seguida; na raiz vale a fração configurada. Span não amostrado não é exportado mas o contexto segue.
- **O trace atravessa serviços pelos eventos**: o outbox guarda o `traceparent` de quem publicou (coluna nova), o relay publica num span `outbox.publica` filho dele, e o consumidor abre `evento.consome` filho do relay. Testado: do POST ao efeito do consumidor, **um único trace**. (Outbox criado antes da coluna: reaplicar `emite(servico,'sql')` a acrescenta; é idempotente.)
- Atributos passam pela redação. Exportação: `Exportador { exporta(span) }`; o padrão escreve no log (debug); troque por um exportador OTLP/Jaeger.

## Requisição
`x-request-id` do cliente só é aceito se for `[A-Za-z0-9._-]{1,64}`; senão é substituído por um uuid. Vai no cabeçalho da resposta, no log, no span e no corpo de **todo erro** (`erro.requisicaoId`): o suporte acha a requisição pelo id que o cliente viu. 5xx: o log traz o erro redigido, o cliente só o id.

## Saúde
`/saude` (o processo está de pé) e `/pronto` (fala com o banco; 200 ou **503 sem detalhe**, o erro redigido vai para o log).

## Limites
- Sem exportador OTLP embutido (só a interface e o log); sem logs de auditoria assinados (o que o usuário fez é o log de requisição, não um registro imutável).
- Métricas em memória por processo: agregue no Prometheus. O gauge de pendentes do relay só atualiza a cada rodada.
- Sem alertas prontos (sugestão: `outbox_idade_maxima_segundos`, `outbox_mortos_total`, taxa de 5xx, `http_recusadas_total`).
