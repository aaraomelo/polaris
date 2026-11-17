# Polaris — guia para o Claude

Idioma: **português (pt-BR)** em respostas, commits e comentários.

## Projeto
Plataforma composable e isomórfica para varejo, serviços e alimentos. **Tudo é declarativo em JSON Schema**: páginas, blocos, temas,
serviços (microsserviços), documentos e kernels de computação (WebGL/GLSL, PTX, WASM). O código JS/HTML/React é **gerado** do schema
(em runtime ou AOT). Arquitetura inspirada na VTEX (blocos, interfaces, composição por tenant), mas 100% por schema.
Base de origem em `../tiffany`: Schema U (`app/src/banco_schema.js`, `banco_pagina_u.js`), backends (`conecthus/backends`), engine de
documentos (`plataforma/tiffany-erp/erp-app/src/doc`) e `erp-api` (domínios). Projeto pessoal do Aarão, separado dos demais.

## Regras permanentes
- **Commits e PRs sem trailer do Claude** (nada de `Co-Authored-By` nem "Generated with Claude Code"). Formato: `PL-<id> tipo(escopo): mensagem`.
- **Nunca exibir nem digitar segredos.** Não ler o `.env` com cat/Read; use os scripts. Nunca `bash -x` em script com token.
- Ações destrutivas ou públicas (force push, apagar, publicar) pedem confirmação.
- Hook de segredos: `git config core.hooksPath .githooks`.
- Não alterar `../tiffany`, `../axion`, `../conecthus`: só leitura para referência.

## ClickUp
`./scripts/clickup.sh` (token pessoal em `.env`). Backlog em `backlog/backlog.json`; `./scripts/clickup-seed.sh` simula e `--apply <list_id>` cria.
Ciclo do card: `em progresso` ao começar → branch/PR → comentário no card → `concluído` por último (nome exato do status: rode `statuses`).
