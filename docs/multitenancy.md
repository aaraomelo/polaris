# Multi-tenant: resolução, status e módulos

## O modelo
Um **tenant** é uma linha no diretório da plataforma (`plataforma.tenant`: alias, segmento, packs, `status`) mais os **módulos** habilitados (`plataforma.modulo`) e os **domínios** (`plataforma.dominio`). O diretório **não tem RLS**: é dado da plataforma, só o papel da plataforma o acessa. O dado de negócio de cada tenant fica nos serviços, isolado por RLS (`docs/persistencia.md`).

## Como um pedido vira um tenant (gateway)
| Pedido | Como o tenant é decidido | Conferências |
|---|---|---|
| **anônimo** | pelo **host**: subdomínio `<alias>.<base>` da plataforma ou domínio próprio **verificado** | host sem dono → 400 `tenant_nao_resolvido` (nunca "todos"); só tenant `ativo` opera |
| **com token** | pelo **token** (nunca pelo host nem por cabeçalho do cliente) | o tenant do token precisa existir e estar `ativo`; **se o host pertence a OUTRO tenant → 403 `tenant_divergente`** (um token não vale na vitrine alheia); host sem dono (API genérica) passa |

Status → resposta: `suspenso` 403 `tenant_suspenso`; `cancelado` 410 `tenant_encerrado`; `provisionando`/`falhou` 503 `tenant_indisponivel` com `retry-after`.

## Módulos habilitados
O gateway leva a lista de módulos do tenant em cada chamada e o **único ponto de chamada aos serviços** (`criaChamador`) recusa o que não está nela: **404 `modulo_nao_habilitado`**, sem chegar ao serviço. Como é o chokepoint de REST, BFF de página e GraphQL, os três ficam cobertos por uma checagem só (provado nos três).

## Resolução de host (`criaResolvedorTenant`)
- `normalizaHost`: minúsculas, sem porta nem ponto final; **recusa** IP, IPv6, `usuario@`, espaço, `_`, unicode, rótulo > 63, nome > 253.
- **Subdomínio**: só **um nível** (`a.b.base` não resolve), alias **reservado** nunca é tenant (defesa em profundidade além do cadastro), o apex da plataforma não é de tenant, sufixo sem ponto (`lojabase.app`) e base alheia (`loja.base.evil.com`) não resolvem.
- **Cache** curto e **limitado**: positivo 30 s (a suspensão tem de valer logo), negativo 5 s (um cadastro novo aparece logo), LRU de 5.000 entradas, **single-flight** (25 pedidos simultâneos ao mesmo host = 1 consulta), host inválido nem toca o banco. `invalida()` zera na hora (para o processo que suspendeu).

## Domínio próprio (verificação por DNS)
1. `adiciona(tenant, dominio)` devolve o registro a publicar: `TXT _polaris-verificacao.<dominio> = polaris-verificacao=<token>` (o token só o dono do tenant recebe).
2. `verifica` confere o TXT. **Só verificado resolve.**
3. **Anti-sequestro**: reivindicar não dá nada; quem **prova a posse** leva o domínio e derruba as reivindicações **não verificadas** dos outros; se outro tenant já o tem **verificado**, é `em_uso`. Um índice único parcial garante um dono verificado por domínio.
4. `revalida` (job): domínio que deixou de provar a posse **perde a verificação** (domínio abandonado ou vendido não serve a um tenant para sempre). **DNS fora do ar não revoga ninguém.**
5. Não se reivindica o que é da plataforma (`*.<base>`), `localhost`/`.local`/`.internal`/`.test`, IP nem nome sem TLD; no máximo 10 por tenant.

## Status do tenant (`mudaStatusTenant`)
`ativo ↔ suspenso`, qualquer um → `cancelado` (terminal). `provisionando`/`falhou` são do cadastro e não se alcançam por aqui (ativar é função do provisionamento, não de um clique).

## Configuração do runner do gateway
`DATABASE_URL_PLATAFORMA` + `POLARIS_BASES_DOMINIO` (ex.: `polaris.app`). **Em produção são obrigatórias** (o mapa estático `POLARIS_HOSTS` é só de desenvolvimento).

## Limites conhecidos
- O **cache é por processo**: depois de suspender, outra instância do gateway demora até o TTL (30 s) para enxergar. Não há barramento de invalidação.
- Os **serviços** ainda resolvem o tenant anônimo pelo `x-forwarded-host` com o próprio mapa (`contextoPorJwt`/`anonimo`); só o gateway usa o diretório. Enquanto o gateway for a única porta de entrada (rede fechada), é consistente; o ideal é o gateway repassar o tenant já resolvido.
- Nenhuma rota de **gestão** ainda (adicionar/verificar domínio, suspender): as funções existem; a API administrativa vem com o Studio/console (E8).
- **TLS/certificado** por domínio próprio (emissão automática) é da camada de entrada, fora daqui (E10).
