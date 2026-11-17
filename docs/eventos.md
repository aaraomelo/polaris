# Eventos entre serviços: outbox, barramento, inbox

Código em `packages/eventos`; contratos no schema (`kind: evento`); DDL em `emite(servico, 'sql')`. Testado contra Postgres real (PGlite) com dois papéis: `app` (sujeito à RLS) e `relay` (ignora RLS).

```
operação ──(mesma transação)──▶ dado + outbox ──relay──▶ barramento ──▶ consumidor (inbox) ──▶ efeito
```

## Contrato (nó `evento`)
`id` = `nome` (`pedido.criado`); `versao` semver; `payload` (campos tipados); `idempotencia` = campo que identifica o FATO. O serviço declara `publica: [...]` nas operações e `consome: [...]`; o Registry confere que **todo evento citado existe** (referência quebrada tem o caminho: `/spec/operacoes/criar/publica/1`).

**Versionamento** (`comparaEventos(anterior, atual)`): o payload novo tem de continuar satisfazendo o contrato antigo.
- **Quebra → exige MAJOR novo**: remover campo obrigatório, obrigatório→opcional, mudar tipo, virar/deixar de ser lista, trocar a chave de idempotência, trocar o nome.
- **Minor**: campo novo, opcional→obrigatório, remover campo opcional. **Patch**: nada no contrato.
- O envelope leva a versão; o consumidor declara os **majors** que entende (`versoes: [1]`) e não recebe os outros.

## Publicar: outbox transacional
O serviço com `publica` ganha a tabela `outbox` (com RLS, como as demais). `publica(evento, payload)` numa operação **valida o payload contra o contrato** (sem coerção: dinheiro é texto) e grava na **mesma transação** do dado: commit leva os dois, rollback leva os dois. Não existe "gravou e perdeu o evento" nem "evento de algo que não aconteceu". Evento sem nó `evento`, não declarado na operação ou com payload fora do contrato → erro de programação (500) e nada gravado. Um serviço que declara `publica` **sem** passar os nós `evento` nem sobe.

**Idempotência do produtor**: índice único `(tenant_id, tipo, chave)` onde `chave = payload[idempotencia]`. Publicar o mesmo fato duas vezes (retry da operação) vira **um** evento; outro tenant com a mesma chave é outro fato.

## Relay: outbox → barramento (`criaRelay`)
- **Ao menos uma vez**: publica e só depois marca `publicado_em`. Se cair no meio, publica de novo (mesmo `id`); testado derrubando o processo entre as duas etapas.
- **Barramento fora do ar**: o evento fica; `tentativas++`, `erro` e `proxima_em` com recuo exponencial (1 s × 2ⁿ⁻¹, máx. 5 min). Esgotou (padrão 5) → **morto** (`mortos()`, com o erro; `reenfileira(id)` devolve à fila).
- **Ordem por tenant**: se um evento do tenant A falha, os seguintes do A esperam e o B segue.
- `FOR UPDATE SKIP LOCKED` evita que duas instâncias peguem as mesmas linhas. **A ordem por tenant só é garantida com UMA instância do relay**, e o `SKIP LOCKED` não foi exercitado com concorrência real (o PGlite tem uma conexão só).
- O relay usa um papel que ignora RLS (`DbSistema`): ele lê todos os tenants. Nunca é o papel da aplicação.

## Consumir: inbox (`criaConsumidor`)
O handler roda numa transação **do tenant do evento** (a RLS vale: gravar para outro tenant é barrado e desfeito), e a marca no `inbox` `(consumidor, evento_id)` entra na **mesma transação**: handler falhou → a marca some junto e a próxima entrega tenta de novo; marca já existe → o handler nem roda (`duplicado`). Efeito **uma vez** com entregas repetidas. A deduplicação é **por consumidor**.

## Replay
- `relay.republica({ tipo, tenantId, desde, ate })`: reenvia ao barramento eventos já publicados, com os mesmos ids, sem alterar o outbox; os consumidores existentes não repetem efeito (inbox) e um consumidor **novo** recebe o histórico.
- `barramento.replay(...)`: reentrega do log do barramento (o de memória).

## Barramento
`Barramento { publica, assina }`: aceita o evento e entrega depois (como um broker). A implementação de referência é em memória (`criaBarramentoMemoria`: tentativas, fila de **mortas**, filtro por tipo e major, replay). Trocar por NATS/Kafka/SQS é implementar essas duas funções; o at-least-once e a deduplicação por id são o contrato.

## Observabilidade
O outbox leva o `traceparent` de quem publicou; relay e consumidor (opção `obs`) continuam o trace e expõem métricas (`outbox_pendentes`, `outbox_idade_maxima_segundos`, mortos, falhas, consumidos). O payload nunca vai para o log. Ver `docs/observabilidade.md`.

## Limites
- Sem particionamento nem garantia de ordem global; só ordem por tenant com um relay.
- O barramento de memória não persiste: em produção o broker é quem guarda (o outbox continua sendo a fonte durável e o replay sai dele).
- Sem esquema de migração automática de payload entre majors (upcasting): quem muda de major precisa consumir os dois durante a transição.
- Falta o adaptador `pg` do `DbTenant`/`DbSistema` (só PGlite), como no `@polaris/servico`.
