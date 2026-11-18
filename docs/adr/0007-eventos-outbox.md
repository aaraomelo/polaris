# 0007 — Eventos entre serviços por outbox transacional, ao menos uma vez, com inbox idempotente

**Contexto.** "Gravou o dado e perdeu o evento" (ou o inverso) quebra a consistência entre serviços.

**Decisão.** O evento é gravado no **outbox na mesma transação** do dado; um relay o publica no barramento (**ao menos uma vez**, com recuo, mortos e ordem por tenant); o consumidor grava uma marca no **inbox na mesma transação** do efeito (efeito **uma vez**). Contratos de evento são nós versionados (quebra exige major). O barramento é uma interface (`publica`, `assina`): trocar por NATS/Kafka não muda o contrato. O `traceparent` viaja no outbox.

**Consequências.** Sem 2PC. Custo: ordem só por tenant e com um relay; consumidores precisam ser idempotentes por construção (o inbox cuida disso).

**Evidência.** `docs/eventos.md`, `packages/eventos/test` (Postgres real, queda entre publicar e marcar).
