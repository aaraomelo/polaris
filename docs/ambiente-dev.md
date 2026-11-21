# Ambiente de desenvolvimento

## Local sem Docker (o caminho curto)
```
pnpm install --frozen-lockfile --ignore-scripts
pnpm local                  # dados persistem em .polaris-local/ ; --limpa apaga ; --memoria não grava ; --porta 3100
```
Sobe, **num só processo e sem Docker**: o Postgres (PGlite com servidor de protocolo, papéis `polaris_app` sem BYPASSRLS e `polaris_migrador`), o esquema da plataforma, o serviço `loja` (de `exemplos/loja`, migrado com o papel migrador), o **gateway** de verdade na frente, o **Studio** (empacotado na primeira vez) e dois tenants de demonstração (`demo` e `outra`).

| O quê | Onde |
|---|---|
| **entrar** (login de desenvolvimento) | `http://localhost:3000/entrar`: escolha o tenant e o papel; emite um JWT de 12 h e abre o Studio do tenant |
| **Site do tenant** | `http://loja-demo.polaris.localhost:3000/` (páginas de `exemplos/loja-site`, com os destaques da loja dele) |
| Studio | `http://loja-demo.polaris.localhost:3000/studio` |
| API REST gerada da loja | `http://loja-demo.polaris.localhost:3000/api/loja/produtos` (com `Authorization: Bearer <token>`) |
| GraphQL (com introspecção) | `http://loja-demo.polaris.localhost:3000/graphql` |
| Postgres (`psql`) | a URL é impressa na partida (`POLARIS_LOCAL_PG_PORTA` fixa a porta) |

- O tenant sai do **host**: `*.polaris.localhost` resolve para o próprio computador no Chrome e no Firefox (em outro navegador, ou com `curl`, mande o cabeçalho `Host`). O token de um tenant **não vale** no host de outro (401).
- Papéis do login: `studio.editor`, `studio.comentarista`, `studio.leitor` (o Studio) e `gerente` (a loja). `?usuario=ana` na URL do login muda o nome (vira o autor das versões e comentários).
- Outro domínio de dados: `POLARIS_NOS=/caminho pnpm local` (a pasta com os nós `*.json` do serviço); o padrão é `exemplos/loja`.
- Os dados ficam em `.polaris-local/`; **só uma instância por vez** usa essa pasta (há trava por pid: o PGlite é de um processo só). Log: `POLARIS_LOG_NIVEL=info` mostra cada requisição.
- `/entrar` tem dois papéis: em `localhost` é o índice do login de desenvolvimento (todos os tenants e papéis); no endereço de um tenant é a **página de login do site** (`site.entrar`, em `exemplos/loja-site`), que é uma página como as outras (a troca é sem recarregar). O cookie de sessão é do endereço que o grava: `/entrar/ir?para=site` pedido em `localhost` refaz o pedido no endereço do tenant.
- **Login real**: `ana@loja-demo.test` / `senha-dev-polaris` (e `ana@loja-outra.test`) em `/entrar` de cada tenant; o Studio e o site usam a sessão. O e-mail "enviado" por "esqueci a senha" aparece em `/_dev/emails`. Detalhes em `docs/identidade.md`.
- **Só desenvolvimento**: o login emite o JWT (HS256, segredo fixo conhecido) que o provedor de identidade emitiria, escuta só em `127.0.0.1` e **recusa `NODE_ENV=production`**. Nada daqui é modelo de segurança de produção.
- Testado de ponta a ponta (`apps/polaris/test/local.test.ts`): login → token → Studio e API pelo gateway, isolamento por tenant, persistência entre execuções, recusa de produção, e no Chrome real (clicar em "entrar", abrir o tema padrão, salvar).
- O site dos tenants vem de `exemplos/loja-site` (nós `tenant` e `pagina`; o id do nó `tenant` é o alias). Limites do servidor de páginas (sem login por cookie etc.): `docs/paginas.md`.

## Com Docker (Postgres 16 real, imagem de produção)

```
cp .env.exemplo docker/dev.env   # valores de DEV; fora do git (o .env da raiz NÃO é usado: ele guarda segredos pessoais do projeto)
pnpm dev                          # = docker compose --env-file docker/dev.env up --build   (porta do gateway: POLARIS_PORTA, padrão 3000)
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
- **Verificado**: `docker compose up` de verdade (imagem construída, Postgres 16 real, serviço migrado pelo driver `pg`, gateway), fluxo criar/listar/isolar por tenant/401. Deploy de homologação/produção: `docs/deploy.md`.
- **Redis e barramento (NATS/Kafka)**: nenhum código usa hoje (cache do gateway é em memória e o barramento é a interface em memória de `@polaris/eventos`). Subir contêiner sem consumidor seria enfeite; entram junto com o adaptador, em E10.
- Relay do outbox como processo próprio: o serviço grava no outbox; o runner do relay vem com o adaptador de barramento.
- HTTPS/TLS: terminação fica no proxy da implantação (E10).

## Sem Docker
`pnpm ci` roda segredos + workflows + tipos + testes (Postgres em memória). Os runners também rodam direto: `pnpm --filter @polaris/apps empacota` e `node apps/polaris/dist/servico.mjs`.
- **PGlite é de uma sessão só**: consultas concorrentes de conexões diferentes podem se misturar (resultado de uma consulta chegando noutra: apareceu como `Invalid time value` ao listar nós com a tela fazendo várias chamadas juntas). Por isso o ambiente local usa `POLARIS_PLATAFORMA_POOL_MAX=1` no gateway. Os pools do serviço de exemplo ainda são separados; em Postgres real não há esse problema.

**Banco persistido (PGlite) e índices**: o PGlite atende uma sessão por vez e várias conexões se misturam; num banco persistido por muito tempo um índice pode ficar errado e devolver a linha de OUTRO tenant (visto: a lista de nós de `loja-outra` trazia o nó de `loja-demo` e "Publicar" era recusado com `nó não carrega: tenant:loja-demo@1`). Por isso o `pnpm local` refaz os índices dos esquemas `plataforma` e `loja` ao subir (`REINDEX SCHEMA`). Se o sintoma voltar no meio da sessão, reinicie o ambiente. Em Postgres de verdade isso não acontece (os testes de `pnpm test:pgreal` cobrem a concorrência).

## Outro site de demonstração: `--site`
`pnpm local --site exemplos/maison` sobe o ambiente com **outro site** nos dois tenants de demonstração: os nós `*.json` da pasta (tema, páginas, tenants) e as fotos de `<pasta>/img/` (png, jpg, webp), que viram ativos de cada tenant. Nas páginas, a foto é apontada por **`@img/<nome-do-arquivo-sem-extensão>`**; o ambiente troca pelo endereço do ativo salvo (o identificador é o hash do que fica depois da limpeza de metadados, que só o upload conhece). O caminho é relativo à raiz do repositório. Os blocos de comércio (`commerce/*`) também estão registrados no gateway local. **Com um banco persistido antigo**, páginas que o tenant criou pelo Studio podem colidir com as do site novo (o site dá 404); use `pnpm local --memoria --site …` ou `--limpa` (que apaga os dados locais).

Se a pasta tiver um arquivo `pecas.sementes` (JSON, extensão que o carregador de nós ignora), ele **semeia o catálogo** (`loja.peca`) de cada tenant, idempotente por `slug`; `@img/<nome>` nos campos de foto vira o endereço do ativo. É assim que a Maison lê os produtos da API em vez de tê-los na página.

**Modelos (templates) de site**: com `--site`, os nós da pasta (tema, páginas, dados, traduções, tenants) também ficam **no banco**, como o modelo `<pasta>` de cada tenant (`plataforma.template_versao`, versões imutáveis; ver `docs/modelos.md`). A API é a do Studio (`/studio/templates`, papéis `studio.*`) e o modelo traz as fotos como `@img/<nome>` (portável: ao **aplicar**, troca-se pelos ativos do tenant).
