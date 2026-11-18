#!/usr/bin/env bash
# Deploy por ambiente (homolog | prod). Recusa o que é inseguro ANTES de subir, e nunca imprime o conteúdo de um segredo.
#   ./scripts/deploy.sh <ambiente> verifica      confere imagem, segredos, certificados e a sintaxe do compose
#   ./scripts/deploy.sh <ambiente> up [--banco-local]   verifica e sobe (o banco local só na homologação)
#   ./scripts/deploy.sh homolog papeis          cria os papéis do banco LOCAL (perfil banco-local) a partir das URLs dos segredos, lidas aqui no host
#   ./scripts/deploy.sh <ambiente> migra        aplica o esquema `plataforma` (passo isolado, com o papel migrador)
#   ./scripts/deploy.sh <ambiente> down|ps|logs [serviço]
set -uo pipefail
AMB="${1:-}"; ACAO="${2:-}"; shift 2 2>/dev/null || true
RAIZ="$(cd "$(dirname "$0")/.." && pwd)"; DIR="${POLARIS_DOCKER_DIR:-$RAIZ/docker}"
[[ "$AMB" == "homolog" || "$AMB" == "prod" ]] || { echo "uso: $0 <homolog|prod> <verifica|up|down|ps|logs>" >&2; exit 2; }
ENVF="$DIR/$AMB.env"; COMPOSE="$DIR/compose.deploy.yml"; SEG="$DIR/segredos"
erros=0; falha() { echo "✗ $*" >&2; erros=$((erros+1)); }; ok() { echo "✓ $*"; }
dc() { docker compose -f "$COMPOSE" --env-file "$ENVF" "$@"; }

verifica() {
  [[ -f "$ENVF" ]] || { falha "falta $ENVF (copie de docker/$AMB.env.exemplo)"; return 1; }
  # o arquivo de ambiente NÃO é lugar de segredo: recusa nomes de variável que parecem segredo
  if grep -Eiq '^(JWT_SEGREDO|.*(SENHA|PASSWORD|TOKEN|SECRET|KEY)[A-Z_]*)=' "$ENVF"; then falha "$ENVF contém variável que parece SEGREDO: use um arquivo em docker/segredos/ (X_FILE)"; fi
  local img; img="$(grep -E '^POLARIS_IMAGEM=' "$ENVF" | head -1 | cut -d= -f2-)"
  [[ -n "$img" ]] || falha "POLARIS_IMAGEM não definida"
  [[ "$img" =~ :(latest|dev)$ || "$img" != *[:@]* ]] && falha "imagem '$img': use uma tag imutável ou um digest (nunca :latest, :dev nem sem tag)"
  [[ "$AMB" == "prod" && "$img" != *@sha256:* ]] && falha "produção exige a imagem por DIGEST (@sha256:…), recebi '$img'"
  [[ "$img" == *SUBSTITUA* ]] && falha "POLARIS_IMAGEM ainda tem o valor de exemplo"
  [[ "$AMB" == "prod" ]] && grep -Eq '^POLARIS_MIGRAR=1' "$ENVF" && falha "produção não migra automaticamente (POLARIS_MIGRAR=1): migre num passo próprio, antes de subir a versão"
  [[ "$AMB" == "prod" ]] && grep -Eq '^POLARIS_GRAPHQL_INTROSPECCAO=1' "$ENVF" && falha "produção não expõe introspecção do GraphQL"
  # segredos: existem, são arquivos regulares, não legíveis por grupo/outros, não vazios, não são o valor de exemplo
  local s modo
  for s in metricas_token plataforma_url preview_segredo loja_url_app; do
    local f="$SEG/$s"
    [[ -f "$f" && ! -L "$f" ]] || { falha "segredo ausente (ou link simbólico): docker/segredos/$s"; continue; }
    [[ "$(stat -c '%u' "$f")" == "${POLARIS_UID:-1000}" ]] || falha "docker/segredos/$s pertence ao uid $(stat -c '%u' "$f"), mas o contêiner roda como uid ${POLARIS_UID:-1000}: ajuste o dono (chown) ou defina POLARIS_UID/POLARIS_GID"
    modo="$(stat -c '%a' "$f")"; [[ "$modo" =~ ^[0-7]00$ ]] || falha "docker/segredos/$s com modo $modo: deve ser 0400 ou 0600 (ninguém além do dono lê)"
    [[ -s "$f" ]] || falha "docker/segredos/$s está vazio"
    grep -Eiq 'SUBSTITUA|troque|changeme|exemplo' "$f" && falha "docker/segredos/$s parece conter um valor de exemplo"
  done
  [[ "$(wc -c < "$SEG/metricas_token" 2>/dev/null || echo 0)" -ge 16 ]] || falha "metricas_token deve ter ao menos 16 caracteres"
  [[ "$(wc -c < "$SEG/preview_segredo" 2>/dev/null || echo 0)" -ge 32 ]] || falha "preview_segredo deve ter ao menos 32 caracteres"
  # certificados: existem, não expiram nos próximos 7 dias
  local certs; certs="$(grep -E '^POLARIS_CERTS=' "$ENVF" | head -1 | cut -d= -f2-)"
  if [[ -z "$certs" ]]; then falha "POLARIS_CERTS não definida"
  elif [[ ! -r "$certs/fullchain.pem" || ! -r "$certs/privkey.pem" ]]; then falha "faltam (ou não são legíveis) $certs/fullchain.pem e privkey.pem"
  elif command -v openssl >/dev/null; then openssl x509 -in "$certs/fullchain.pem" -noout -checkend $((7*86400)) >/dev/null 2>&1 || falha "o certificado em $certs expira em menos de 7 dias (ou é inválido)"; fi
  # a sintaxe do compose, com o ambiente carregado
  if [[ -z "${POLARIS_SEM_DOCKER:-}" ]]; then dc config -q >/dev/null 2>&1 || falha "docker compose config falhou: rode 'docker compose -f docker/compose.deploy.yml --env-file docker/$AMB.env config' para ver o motivo"; fi
  [[ $erros -eq 0 ]] && ok "ambiente $AMB pronto para subir"
  [[ $erros -eq 0 ]] # status 0 só se NENHUM problema (e 1 — não a contagem — quando há)
}

case "$ACAO" in
  verifica) verifica; exit $? ;;
  up)
    verifica || { echo "não subo com problemas." >&2; exit 1; }
    perfil=(); if [[ "${1:-}" == "--banco-local" ]]; then [[ "$AMB" == "homolog" ]] || { echo "banco local só na homologação" >&2; exit 1; }; perfil=(--profile banco-local); fi
    [[ -n "${POLARIS_DEPLOY_SECO:-}" ]] && { echo "[seco] docker compose ${perfil[*]:-} up -d --remove-orphans"; exit 0; }
    dc "${perfil[@]}" up -d --remove-orphans ;;
  migra)
    [[ -f "$SEG/plataforma_url_migrador" ]] || { echo "falta docker/segredos/plataforma_url_migrador" >&2; exit 1; }
    [[ -n "${POLARIS_DEPLOY_SECO:-}" ]] && { echo "[seco] docker compose --profile migra run --rm migra"; exit 0; }
    dc --profile migra run --rm migra ;;
  papeis)
    [[ "$AMB" == "homolog" ]] || { echo "papéis do banco local só na homologação (em produção o banco é externo e os papéis são da infraestrutura)" >&2; exit 1; }
    for s in loja_url_app loja_url_migrador plataforma_url; do [[ -f "$SEG/$s" ]] || { echo "falta docker/segredos/$s" >&2; exit 1; }; done
    senha() { sed -E 's#^[a-z]+://[^:]+:([^@]+)@.*#\1#' "$1" | tr -d '\n'; }
    APP="$(senha "$SEG/loja_url_app")"; MIG="$(senha "$SEG/loja_url_migrador")"; PLAT="$(senha "$SEG/plataforma_url")"
    [[ -n "$APP" && -n "$MIG" && -n "$PLAT" ]] || { echo "não consegui extrair a senha de uma das URLs (formato postgres://usuario:senha@host/banco)" >&2; exit 1; }
    [[ -n "${POLARIS_DEPLOY_SECO:-}" ]] && { echo "[seco] criaria polaris_migrador, polaris_app, polaris_plataforma"; exit 0; }
    # a senha vai por STDIN (não aparece em argumento de processo nem em log)
    dc exec -T postgres psql -v ON_ERROR_STOP=1 -U postgres -d polaris <<SQL
CREATE ROLE polaris_migrador LOGIN BYPASSRLS PASSWORD '$MIG';
CREATE ROLE polaris_app LOGIN NOBYPASSRLS NOSUPERUSER PASSWORD '$APP';
CREATE ROLE polaris_plataforma LOGIN NOBYPASSRLS NOSUPERUSER PASSWORD '$PLAT';
GRANT CREATE ON DATABASE polaris TO polaris_migrador;
REVOKE ALL ON DATABASE polaris FROM PUBLIC;
GRANT CONNECT ON DATABASE polaris TO polaris_app, polaris_plataforma, polaris_migrador;
SQL
    ;;
  down|ps|logs) dc "$ACAO" "$@" ;;
  *) echo "ação desconhecida: ${ACAO:-}" >&2; exit 2 ;;
esac
