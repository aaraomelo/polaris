# Fluxo de trabalho: ClickUp ↔ git

Um card do ClickUp é a unidade de trabalho. O que o ciclo exige, e **o que está automatizado**:

| Etapa | O que fazer | Enforcement |
|---|---|---|
| Começar | `./scripts/clickup.sh status <id> "em progresso"` e `assign-me` | — (convenção) |
| Branch | `PL-<id>-<resumo-curto>` (ex.: `PL-1dff4uhe342-gateway-bff`), a partir de `main` | — |
| Commits | `PL-<id> tipo(escopo): mensagem` em português, **sem** trailer de IA | **hook `commit-msg`** (local) + job `commits` do CI (todo commit do PR) |
| Segredos | nunca digitar nem versionar; `.env` só local | **hook `pre-commit`** + job `segredos` do CI (`--all`) |
| PR | título igual ao commit principal; corpo com o que mudou e como foi verificado | CI: tipos, testes, auditoria |
| Entregar | `./scripts/clickup.sh comment <id> "<o que foi feito e como foi verificado>"` | — |
| Concluir | **por último**: `./scripts/clickup.sh status <id> "concluído"` (nome exato do status: rode `statuses`) | — |

Tipos de commit: `feat fix perf test docs refactor chore build ci style revert`. Assunto até 100 caracteres, linha em branco antes do corpo. Merge e revert gerados pelo git passam.

## Ativação (uma vez por clone)
```
git config core.hooksPath .githooks      # pre-commit (segredos) + commit-msg (formato)
```

## Validar antes de abrir o PR
```
pnpm ci                                   # segredos + workflows + tipos + testes (o mesmo do CI)
pnpm commits origin/main..HEAD            # as mensagens do que você vai enviar
pnpm afetados                             # só o que mudou em relação a origin/main (com cache do Turborepo)
```

## Ações destrutivas ou públicas
Force push, apagar branch/artefato e publicar pedem confirmação explícita (regra permanente do projeto). O CI não usa nenhum segredo (`secrets.*` é recusado pelo validador de workflow): testes rodam contra Postgres em memória (PGlite).

## Backlog
`backlog/backlog.json` é a fonte; `./scripts/clickup-seed.sh` simula e `--apply <list_id>` cria os cards no ClickUp.
