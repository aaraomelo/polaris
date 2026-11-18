# Ambiente de desenvolvimento

```
cp .env.exemplo .env          # valores de DEV; o .env nunca é versionado
docker compose up --build     # postgres + loja (serviço) + gateway
curl localhost:3000/pronto
```

| Peça | Porta | Observação |
|---|---|---|
| gateway | `127.0.0.1:3000` | única porta publicada, só em loopback |
| loja (serviço) | interna `3001` | migra o esquema na partida (`POLARIS_MIGRAR=1`) |
| postgres 16 | interna | volume `pgdados`; papéis criados em `docker/01-papeis.sh` |

Os nós vêm de `exemplos/loja/` (montado só leitura em `/nos`). Para outro domínio, aponte `POLARIS_NOS` para outra pasta.

## Papéis do banco (por que são dois)
- `polaris_migrador` (`BYPASSRLS`): só a migração do esquema usa (`DATABASE_URL_MIGRADOR`).
- `polaris_app` (sem `BYPASSRLS`, sem superusuário): é o que a aplicação usa (`DATABASE_URL`). A RLS vale para ele.
A config **recusa** subir se as duas URLs forem iguais.

## Variáveis (todas validadas na partida; o processo não sobe com config ruim e lista todos os problemas)
Comuns: `POLARIS_NOS`, `JWT_EMISSOR`, `JWT_AUDIENCIA`, **uma** de `JWT_JWKS_URL` | `JWT_CHAVE_PUBLICA_JWK` | `JWT_SEGREDO` (HS256, só fora de produção, ≥ 32 caracteres), `PORT` (3000), `HOST` (127.0.0.1), `POLARIS_METRICAS_TOKEN` (≥ 16; sem ele `/metrics` não existe), `POLARIS_HOSTS` (`{"host":"<uuid do tenant>"}`).
Serviço: `POLARIS_SERVICO`, `DATABASE_URL`, `POLARIS_DB_PAPEL` (opcional, `SET ROLE` ao conectar), `POLARIS_MIGRAR=1` + `DATABASE_URL_MIGRADOR` + `POLARIS_PAPEL_APP`.
Gateway: `POLARIS_SERVICOS` (`{"loja":"http://loja:3001"}`), `POLARIS_TAXA_CAPACIDADE`/`POLARIS_TAXA_POR_SEGUNDO`, `POLARIS_LIMITE_TAXA=desligado`, `POLARIS_GRAPHQL_INTROSPECCAO=1` (ignorado em produção).

## Segurança do contêiner
Imagem multi-etapa, usuário não-root, sistema de arquivos somente leitura, `cap_drop: ALL`, `no-new-privileges`, nenhuma porta de serviço/banco publicada.

## O que NÃO está aqui (de propósito)
- **Redis e barramento (NATS/Kafka)**: nenhum código usa hoje (cache do gateway é em memória e o barramento é a interface em memória de `@polaris/eventos`). Subir contêiner sem consumidor seria enfeite; entram junto com o adaptador, em E10.
- Relay do outbox como processo próprio: o serviço grava no outbox; o runner do relay vem com o adaptador de barramento.
- HTTPS/TLS: terminação fica no proxy da implantação (E10).

## Sem Docker
`pnpm ci` roda segredos + workflows + tipos + testes (Postgres em memória). Os runners também rodam direto: `pnpm --filter @polaris/apps empacota` e `node apps/polaris/dist/servico.mjs`.
