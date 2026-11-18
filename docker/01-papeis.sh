#!/bin/sh
# Roda uma vez na criação do volume do Postgres. Papéis: o migrador ignora a RLS (só ele cria o esquema); a aplicação NÃO ignora.
set -eu
psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" <<SQL
CREATE ROLE polaris_migrador LOGIN BYPASSRLS PASSWORD '${POLARIS_MIGRADOR_SENHA}';
CREATE ROLE polaris_app LOGIN NOBYPASSRLS NOSUPERUSER PASSWORD '${POLARIS_APP_SENHA}';
GRANT CREATE ON DATABASE ${POSTGRES_DB} TO polaris_migrador;
SQL
