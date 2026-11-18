# Deploy por ambiente (dev · homologação · produção)

| | **dev** | **homologação** | **produção** |
|---|---|---|---|
| comando | `pnpm dev` (`docker-compose.yml`) | `./scripts/deploy.sh homolog up [--banco-local]` | `./scripts/deploy.sh prod up` |
| imagem | construída na máquina (`polaris:dev`) | do registro, por **tag** imutável | do registro, por **digest** (`@sha256:…`) |
| `NODE_ENV` | `development` | `production` | `production` |
| JWT | HS256 de desenvolvimento | **JWKS** do provedor de identidade | **JWKS** |
| segredos | `docker/dev.env` (valores de exemplo) | **arquivos** em `docker/segredos/` (`X_FILE`) | **arquivos** |
| banco | Postgres no compose | local (perfil `banco-local`) ou externo | **externo/gerenciado** |
| migração | automática (`POLARIS_MIGRAR=1`) | automática ou passo próprio | **passo próprio** (`deploy.sh prod migra`), nunca no boot |
| TLS | não | nginx + certificado | nginx + certificado |

## O que sobe
`nginx` (única porta publicada: 80→8080, 443→8443) → `gateway` → serviços (`loja`…) → Postgres. Redes: **`interna`** (`internal: true`: o banco mora só aqui, sem rota para fora), **`saida`** (egress dos serviços: JWKS do provedor de identidade, provedores de pagamento; **restrinja por destino no firewall do host**) e **`borda`** (nginx). Todos os contêineres: **não-root** (uid de `POLARIS_UID`, padrão 1000), **sistema de arquivos somente leitura** (`tmpfs` em `/tmp`), `cap_drop: ALL`, `no-new-privileges`, limite de CPU/memória/processos, healthcheck, log com rotação.

## `scripts/deploy.sh`: recusa o inseguro antes de subir
`./scripts/deploy.sh <ambiente> verifica` confere, **sem mostrar o conteúdo de nenhum segredo**:
- o arquivo de ambiente existe e **não contém segredo** (variável com `SENHA/TOKEN/SECRET/KEY/JWT_SEGREDO` é recusada);
- a imagem **nunca** é `:latest`/`:dev`/sem tag; em **produção, só por digest**; o valor de exemplo é recusado;
- produção **não migra sozinha** nem expõe **introspecção** do GraphQL;
- cada segredo: existe, é arquivo regular (**link simbólico recusado**), **modo 0400/0600**, **dono = uid do contêiner** (bind mount preserva dono e modo: com outro dono o processo não lê), não vazio, **não é valor de exemplo**, tamanho mínimo (`metricas_token` ≥ 16, `preview_segredo` ≥ 32);
- o certificado existe e **não expira em menos de 7 dias**;
- `docker compose config` aceita o conjunto.
`up` roda a verificação e **não sobe se algo falhar**. Ações: `verifica`, `up`, `migra`, `papeis` (só homologação, cria os papéis do banco local a partir das URLs dos segredos, lidas no host e enviadas por STDIN), `down`, `ps`, `logs`.

## Segredos
Arquivos em `docker/segredos/` (fora do git, modo 0400; ver o `LEIA-ME.md` de lá). O processo lê `X_FILE=/run/secrets/x` (`resolveArquivos`): o **valor não fica no ambiente** (`docker inspect`, `/proc/<pid>/environ`) — verificado: `env` do contêiner da aplicação não contém nenhuma senha nem URL de banco. `X` e `X_FILE` juntos são ambíguos e recusados; arquivo que não é regular, vazio, > 64 KB ou ilegível é recusado, com a mensagem dizendo **qual variável** falhou e nunca o conteúdo.

## nginx (`docker/nginx/`)
TLS **1.2/1.3** só, suítes AEAD, sem tickets, OCSP stapling, `server_tokens off`; HTTP só serve o desafio ACME e **redireciona**; **HSTS**, `nosniff`, anti-frame, `Referrer-Policy`, `Permissions-Policy` e CSP restritiva em toda resposta (`always`); **`/metrics`, `/pronto` e `/saude` nunca saem** (404); corpo ≤ 1 MB, prazos de cabeçalho/corpo de 10 s; limite por IP (30 req/s; **`/publico/cadastro` 2 req/s**); cabeçalhos de encaminhamento **sobrescritos** (nunca se confia no do cliente; `X-Forwarded-For` não acrescenta ao recebido) e `X-Tenant-Id` zerado. Imagem `nginxinc/nginx-unprivileged` (sem root, portas 8080/8443).

## Migrações
`node dist/migra.mjs` (serviço `migra`, perfil `migra`): aplica o esquema **`plataforma`** (diretório de tenants, domínios, versões de nós, releases) com o papel **migrador** e dá ao papel da plataforma só o necessário (`SELECT/INSERT` nas tabelas imutáveis). Idempotente. O esquema de cada serviço é migrado pelo próprio serviço quando `POLARIS_MIGRAR=1` (homologação) ou por passo próprio em produção.

## Verificado de verdade
- **Imagem** construída (`docker build`) com pnpm na versão do repositório; **stack de dev** (Postgres 16 real + serviço + gateway) subido com `docker compose up`: criar/listar/isolar por tenant/401, papéis `polaris_app` (sem BYPASSRLS) e `polaris_migrador`.
- **Stack em modo produção/homologação** (`deploy.sh`-equivalente, sem nginx): Postgres local com papéis, `migra`, `loja` (migração + `_FILE`), `gateway` com **JWKS RS256** e diretório de tenants em Postgres real: criar/listar (200/201), **token de outro tenant na vitrine alheia 403**, **tenant suspenso 403**, host desconhecido 400, token adulterado 401, usuário 1000, fs somente leitura, zero segredo no ambiente.
- **Postgres real em testes** (`packages/pgreal`, ver `docs/qualidade.md`).

## O que NÃO foi verificado (e por quê)
- **nginx** (`nginx -t` e o fluxo TLS): a imagem não existe na máquina e baixar imagem exige confirmação. A configuração tem **testes estáticos** (protocolos, cabeçalhos, 404 das rotas de operação, limites, sobrescrita de cabeçalhos) mas nunca rodou. Para verificar: `docker pull nginxinc/nginx-unprivileged:1.27-alpine` e `docker run --rm -v $PWD/docker/nginx:/etc/nginx/conf.d:ro … nginx -t`.
- **Certificados**: emissão e renovação (certbot/ACME) não estão automatizadas: o compose monta `POLARIS_CERTS` (um `fullchain.pem` + `privkey.pem`). **Domínio próprio de tenant** precisa de certificado **por domínio**: nginx não emite sob demanda; use um certificado SAN/curinga por lote ou troque a borda por um proxy com TLS sob demanda (Caddy) — decisão em aberto.
- **VPS real**: nada foi implantado em servidor; o compose foi validado (`docker compose config`) e rodado localmente.
- **Backup/restauração, réplica, monitoramento e alertas** do banco e dos serviços não estão aqui.
