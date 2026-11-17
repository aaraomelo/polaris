#!/usr/bin/env bash
# Barra segredo em texto puro antes de commitar/publicar. Usado pelo hook .githooks/pre-commit e pelo seal.sh.
#   ./scripts/check-no-secrets.sh            confere os arquivos em stage (git diff --cached)
#   ./scripts/check-no-secrets.sh --all      confere TODOS os arquivos versionados (git ls-files)
# Sai com codigo 1 se achar algo. So le arquivos; nunca imprime o valor encontrado, so o arquivo e o motivo.
set -uo pipefail
cd "$(git rev-parse --show-toplevel)"

if [[ "${1:-}" == "--all" ]]; then
  files="$(git ls-files)"
else
  files="$(git diff --cached --name-only --diff-filter=ACM)"
fi

# nomes que nunca podem ser versionados (so o .env.exemplo e permitido)
NAME_RE='(^|/)credenciais/|(^|/)\.env$|(^|/)\.env\.[^/]+$|(^|/)segredo/|\.pem$|(^|/)id_(ed25519|rsa|ecdsa)($|[^.])|\.git-credentials$'
# conteudos que indicam segredo
CONTENT_RE='BEGIN ([A-Z]+ )?PRIVATE KEY|glpat-[A-Za-z0-9_-]{20,}|ghp_[A-Za-z0-9]{30,}|github_pat_[A-Za-z0-9_]{30,}|gho_[A-Za-z0-9]{30,}|ATATT[A-Za-z0-9_=-]{20,}|pk_[0-9]{5,}_[A-Z0-9]{20,}|AKIA[0-9A-Z]{16}'

bad=0
while IFS= read -r f; do
  [[ -z "$f" ]] && continue
  case "$f" in
    .env.exemplo|*/.env.exemplo|scripts/check-no-secrets.sh) continue ;;
  esac
  if [[ "$f" =~ $NAME_RE ]]; then echo "BLOQUEADO (nome de arquivo sensivel): $f"; bad=1; continue; fi
  [[ -f "$f" ]] || continue
  # submodulos aparecem como diretorios/gitlinks: nao tem conteudo para ler
  if grep -IqE "$CONTENT_RE" "$f" 2>/dev/null; then echo "BLOQUEADO (conteudo parece segredo): $f"; bad=1; fi
done <<< "$files"

if [[ $bad -ne 0 ]]; then
  echo
  echo "Segredo em texto puro nao pode ir para o repositorio. Guarde-o no .env local (nao versionado)." >&2
  exit 1
fi
echo "ok: nenhum segredo em texto puro nos arquivos conferidos"
