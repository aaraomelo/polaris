#!/usr/bin/env bash
# Barra segredo em texto puro. Usado pelo hook .githooks/pre-commit, pelo CI e à mão:
#   ./scripts/check-no-secrets.sh              confere os arquivos em stage
#   ./scripts/check-no-secrets.sh --all        confere TODOS os arquivos versionados
#   ./scripts/check-no-secrets.sh --historico  confere as linhas adicionadas em TODOS os commits (segredo que já vazou para o histórico)
# Sai com código 1 se achar algo. Só imprime regra/arquivo/linha: nunca o valor. A lógica está em tools/ferramentas/src/segredos.ts (com testes).
set -uo pipefail
cd "$(git rev-parse --show-toplevel)"
exec node tools/ferramentas/bin/check-segredos.ts "$@"
