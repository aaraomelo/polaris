# Polaris

Plataforma **composable e isomórfica** para varejo, serviços e alimentos, onde **tudo é declarado em JSON Schema** (páginas, blocos, temas, serviços, documentos e kernels de computação) e o código JS, HTML, SQL, OpenAPI e PDF é **gerado** do schema. Arquitetura inspirada na VTEX (blocos, interfaces, composição por tenant), mas 100% por schema e multi-tenant desde o desenho.

> Projeto pessoal em desenvolvimento ativo. O que funciona e o que **não** funciona está descrito abaixo e nos limites de cada documento em `docs/`.

## A ideia em um exemplo

Um nó é um JSON com `kind`, `id`, `versao` e um `spec` validado pelo schema do `kind`:

```json
{ "kind": "pagina", "id": "home", "versao": "1.0.0",
  "spec": { "rota": "/", "titulo": "Início",
    "raiz": { "bloco": "layout/pilha", "slots": { "filhos": [
      { "bloco": "texto/titulo", "props": { "texto": "Bem-vindo", "nivel": 1 } } ] } } } }
```

O mesmo vale para um serviço (entidades, CRUD, operações → API HTTP, tabelas com RLS, OpenAPI e GraphQL), um tema (tokens → CSS), um documento (→ HTML e PDF) ou um kernel (→ JS, WebAssembly, GLSL e PTX). Um tenant sobrescreve qualquer nó do core ou do segmento (cascata tenant → segmento → core), com versões imutáveis, releases e preview assinado.

## O que existe

| Área | Onde | Estado |
|---|---|---|
| Contrato e validação (12 kinds, migração por major) | `packages/schema` | pronto |
| Runtime próprio sem React, AOT por página, SSR com streaming | `packages/engine` | pronto (React só como oráculo de teste) |
| Serviços gerados do schema (Fastify, Postgres com RLS, outbox/inbox) | `packages/servico` | pronto |
| Gateway/BFF (JWT, tenant só do token, REST + GraphQL, cache, taxa) | `packages/gateway` | pronto |
| Packs de domínio: catálogo, vendas, pagamentos, estoque, serviços, alimentos, cadastro self-service | `packages/packs` | pronto, com limites (veja `docs/packs.md`) |
| Multi-tenant: domínio próprio, módulos, overrides, releases, preview | `packages/packs`, `packages/gateway` | pronto |
| Documentos declarativos (HTML e PDF com paridade testada) | `packages/documentos` | pronto |
| Kernels (JS, WebAssembly, GLSL, PTX) com paridade entre backends | `packages/computacao` | pronto; **PTX nunca rodou em GPU real** |
| Studio: editor de páginas e temas, histórico, diff semântico, comentários | `apps/studio`, `packages/studio` | funcional; **falta o fluxo de login** (veja `docs/studio.md`) |
| Deploy (compose por ambiente, nginx/TLS, segredos por arquivo) | `docker/`, `scripts/deploy.sh` | escrito e testado em análise estática; **sem VPS real** e sem `nginx -t` real |

O exemplo mínimo de ponta a ponta está em `exemplos/loja`.

## Começando

Requisitos: Node 24 e pnpm (a versão está em `packageManager`). Docker só para `pnpm dev`.

```bash
pnpm install --frozen-lockfile --ignore-scripts
pnpm tipos          # TypeScript estrito em todos os pacotes
pnpm test           # toda a suíte (Postgres em memória; sem credenciais)
```

- **Ambiente de desenvolvimento** (gateway + serviço + Postgres): `docs/ambiente-dev.md`
- **Studio local**: `pnpm --filter @polaris/studio-app dev` e abra http://127.0.0.1:4300/studio
- **Postgres real** (concorrência, locks, timeouts): `pnpm test:pgreal` (exige uma imagem `postgres:16` local)

Os testes de paridade (documentos e kernels) usam Chrome e `poppler-utils` quando disponíveis; no CI a falta deles é falha.

## Documentação

Por tema em [`docs/`](docs/): [fluxo de trabalho](docs/fluxo.md), [serviços](docs/servicos.md), [gateway](docs/gateway.md), [multi-tenant](docs/multitenancy.md), [packs](docs/packs.md), [documentos](docs/documentos.md), [computação](docs/computacao.md), [Studio](docs/studio.md), [deploy](docs/deploy.md), [segurança](docs/seguranca.md), [qualidade](docs/qualidade.md).
As decisões de arquitetura estão em [`docs/adr/`](docs/adr/README.md) (formato curto: contexto, decisão, consequências, evidência).

## Segurança e qualidade

Sem `eval` livre; código de tenant só em sandbox isolado e fail-closed; segredos nunca no repositório (detector próprio rodando em hook, no CI e no histórico); RLS no Postgres com o tenant vindo só da autenticação; dinheiro como texto decimal exato; mutações manuais, fuzz contra oráculos e E2E em Chrome real fazem parte da suíte. O que **não** foi verificado fica registrado como limite em cada documento.

## Licença

Ainda não definida: sem um arquivo `LICENSE`, todos os direitos ficam reservados ao autor, mesmo com o código público.
