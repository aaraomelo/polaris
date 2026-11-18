#!/usr/bin/env bash
# Postgres REAL para os testes que o PGlite não prova (locks, deadlock, concorrência, timeouts, RLS com login de verdade).
#   ./scripts/pg-real.sh up      sobe um contêiner descartável (imagem postgres:16 LOCAL; nunca baixa nada) e imprime a URL de superusuário
#   ./scripts/pg-real.sh down    remove o contêiner
#   ./scripts/pg-real.sh url     imprime a URL se o contêiner estiver de pé
# Uso:  export POLARIS_PG_REAL_URL=$(./scripts/pg-real.sh up) && pnpm test:pgreal
set -euo pipefail
NOME=polaris-pg-test; IMG="${POLARIS_PG_IMAGEM:-postgres:16}"
url() { local p; p="$(docker port "$NOME" 5432/tcp 2>/dev/null | head -1 | sed 's/.*://')"; [[ -n "$p" ]] && echo "postgres://postgres:postgres@127.0.0.1:${p}/postgres"; }
case "${1:-}" in
  up)
    docker image inspect "$IMG" >/dev/null 2>&1 || { echo "imagem $IMG não está disponível localmente (este script não baixa: peça confirmação antes de 'docker pull')" >&2; exit 1; }
    if ! docker ps --format '{{.Names}}' | grep -qx "$NOME"; then
      docker rm -f "$NOME" >/dev/null 2>&1 || true
      # sem fsync: é um banco de TESTE descartável. max_connections folgado para os testes de concorrência.
      docker run -d --name "$NOME" -e POSTGRES_PASSWORD=postgres -p 127.0.0.1::5432 --tmpfs /var/lib/postgresql/data "$IMG" -c fsync=off -c synchronous_commit=off -c max_connections=200 -c deadlock_timeout=200ms >/dev/null
    fi
    for _ in $(seq 1 60); do docker exec "$NOME" pg_isready -U postgres -q 2>/dev/null && break; sleep 0.5; done
    docker exec "$NOME" pg_isready -U postgres -q || { echo "o Postgres não subiu" >&2; exit 1; }
    sleep 1; url ;;
  down) docker rm -f "$NOME" >/dev/null 2>&1 || true ;;
  url) url || { echo "contêiner $NOME não está de pé" >&2; exit 1; } ;;
  *) echo "uso: $0 up|down|url" >&2; exit 2 ;;
esac
