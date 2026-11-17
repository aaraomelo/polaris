#!/usr/bin/env bash
# Le e atualiza o ClickUp da Axion (API v2) com o token pessoal do usuario. Nunca imprime o token.
#   ./scripts/clickup.sh whoami                              confere o token (usuario dono)
#   ./scripts/clickup.sh workspaces                          lista workspaces (id  nome); use o id em CLICKUP_TEAM_ID
#   ./scripts/clickup.sh spaces                              spaces do workspace
#   ./scripts/clickup.sh mkspace "<nome>"                    cria space no workspace
#   ./scripts/clickup.sh folders <space_id>                  folders (e suas listas) de um space
#   ./scripts/clickup.sh lists <space_id|folder_id> [--folder]   listas sem folder do space (ou de um folder com --folder)
#   ./scripts/clickup.sh tasks <list_id> [--all]             tarefas da lista (--all inclui fechadas)
#   ./scripts/clickup.sh task <task_id>                      detalhes: status, responsaveis, descricao, subtarefas
#   ./scripts/clickup.sh create <list_id> "<titulo>" ["<descricao>"] [--status S] [--priority 1-4] [--me] [--parent <task_id>]
#   ./scripts/clickup.sh mkfolder <space_id> "<nome>"        cria folder
#   ./scripts/clickup.sh mklist <folder_id> "<nome>"         cria lista dentro do folder
#   ./scripts/clickup.sh comment <task_id> "<texto>"         comenta na tarefa (como o dono do token)
#   ./scripts/clickup.sh comments <task_id>                  lista os comentarios
#   ./scripts/clickup.sh status <task_id> "<status>"         muda o status (nome exato do status da lista)
#   ./scripts/clickup.sh statuses <list_id>                  statuses validos da lista
#   ./scripts/clickup.sh assign-me <task_id>                 atribui a tarefa ao dono do token
#   ./scripts/clickup.sh search "<texto>"                    busca tarefas no workspace por nome
# Credenciais: CLICKUP_API_TOKEN (pk_...) do ambiente ou do .env; CLICKUP_TEAM_ID opcional (id do workspace).
# Token pessoal: ClickUp > avatar > Settings > Apps > API Token.
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"

envget() { local v; v="${!1:-}"; [[ -n "$v" ]] && { printf '%s' "$v"; return; }
  { grep -E "^$1=.+" "$ROOT/.env" 2>/dev/null || true; } | tail -1 | cut -d= -f2- | tr -d "\"'\015"; }
TOKEN="$(envget CLICKUP_API_TOKEN)"
TEAM="$(envget CLICKUP_TEAM_ID)"
[[ -n "$TOKEN" ]] || { echo "ERRO: falta CLICKUP_API_TOKEN (ambiente ou .env; ver .env.exemplo)" >&2; exit 1; }
command -v jq >/dev/null || { echo "ERRO: jq nao encontrado" >&2; exit 1; }

# o token vai por arquivo de config do curl (-K), nunca na linha de comando (nao aparece no ps)
api() { local m="$1" p="$2"; shift 2
  curl -fsS -X "$m" -K <(printf 'header = "Authorization: %s"\n' "$TOKEN") \
    -H 'Content-Type: application/json' "https://api.clickup.com/api/v2/$p" "$@"; }
need_team() { [[ -n "$TEAM" ]] || { echo "ERRO: defina CLICKUP_TEAM_ID (rode: $0 workspaces)" >&2; exit 1; }; }
usage() { sed -n 2,22p "$0" | sed 's/^# \{0,1\}//' >&2; exit 1; }

ACT="${1:-}"; [[ -n "$ACT" ]] || usage; shift || true

case "$ACT" in
  whoami)
    api GET user | jq -r '.user | "\(.id)  \(.username)  \(.email)"' ;;
  workspaces)
    api GET team | jq -r '.teams[] | "\(.id)  \(.name)  (\(.members|length) membros)"' ;;
  spaces)
    need_team; api GET "team/$TEAM/space?archived=false" | jq -r '.spaces[] | "\(.id)  \(.name)"' ;;
  mkspace)
    need_team; [[ -n "${1:-}" ]] || usage
    api POST "team/$TEAM/space" -d "$(jq -n --arg n "$1" '{name:$n,multiple_assignees:true,features:{due_dates:{enabled:true},tags:{enabled:true},priorities:{enabled:true},checklists:{enabled:true}}}')" | jq -r '"space criado: \(.id)  \(.name)"' ;;
  folders)
    [[ -n "${1:-}" ]] || usage
    api GET "space/$1/folder?archived=false" | jq -r '.folders[] | "\(.id)  \(.name)", (.lists[] | "    list \(.id)  \(.name)")' ;;
  lists)
    [[ -n "${1:-}" ]] || usage
    if [[ "${2:-}" == "--folder" ]]; then api GET "folder/$1/list?archived=false"; else api GET "space/$1/list?archived=false"; fi \
      | jq -r '.lists[] | "\(.id)  \(.name)  (\(.task_count // "?") tarefas)"' ;;
  tasks)
    [[ -n "${1:-}" ]] || usage
    q="subtasks=true"; [[ "${2:-}" == "--all" ]] && q="$q&include_closed=true"
    api GET "list/$1/task?$q" | jq -r '.tasks[] | "\(.id)  [\(.status.status)]  \(.name)  — \([.assignees[].username]|join(","))"' ;;
  task)
    [[ -n "${1:-}" ]] || usage
    api GET "task/$1?include_subtasks=true" | jq -r '
      "\(.id)  \(.name)", "status: \(.status.status)", "lista: \(.list.name)  space: \(.space.id)",
      "responsaveis: \([.assignees[].username]|join(", "))", "url: \(.url)", "",
      (.description // "(sem descricao)"),
      (if (.subtasks // []) | length > 0 then "", "subtarefas:", (.subtasks[] | "  \(.id)  [\(.status.status)]  \(.name)") else empty end)' ;;
  create)
    LIST="${1:-}"; NAME="${2:-}"; [[ -n "$LIST" && -n "$NAME" && "$NAME" != --* ]] || usage; shift 2
    DESC=""; STATUS=""; PRIO=""; ME=0; PARENT=""
    [[ -n "${1:-}" && "${1:-}" != --* ]] && { DESC="$1"; shift; }
    while [[ $# -gt 0 ]]; do case "$1" in
      --status) STATUS="$2"; shift 2 ;; --parent) PARENT="$2"; shift 2 ;; --priority) PRIO="$2"; shift 2 ;; --me) ME=1; shift ;;
      *) echo "opcao desconhecida: $1" >&2; exit 1 ;; esac; done
    me=""; (( ME )) && me="$(api GET user | jq -r .user.id)"
    body="$(jq -n --arg n "$NAME" --arg d "$DESC" --arg s "$STATUS" --arg p "$PRIO" --arg me "$me" --arg par "$PARENT" '
      {name:$n}
      + (if $par != "" then {parent:$par} else {} end)
      + (if $d != "" then {markdown_description:$d} else {} end)
      + (if $s != "" then {status:$s} else {} end)
      + (if $p != "" then {priority:($p|tonumber)} else {} end)
      + (if $me != "" then {assignees:[($me|tonumber)]} else {} end)')"
    api POST "list/$LIST/task" -d "$body" | jq -r '"criada: \(.id)  \(.name)\n\(.url)"' ;;
  mkfolder)
    [[ -n "${1:-}" && -n "${2:-}" ]] || usage
    api POST "space/$1/folder" -d "$(jq -n --arg n "$2" '{name:$n}')" | jq -r '"folder criado: \(.id)  \(.name)"' ;;
  mklist)
    [[ -n "${1:-}" && -n "${2:-}" ]] || usage
    api POST "folder/$1/list" -d "$(jq -n --arg n "$2" '{name:$n}')" | jq -r '"lista criada: \(.id)  \(.name)"' ;;
  comment)
    [[ -n "${1:-}" && -n "${2:-}" ]] || usage
    api POST "task/$1/comment" -d "$(jq -n --arg t "$2" '{comment_text:$t, notify_all:false}')" | jq -r '"comentario \(.id) publicado"' ;;
  comments)
    [[ -n "${1:-}" ]] || usage
    api GET "task/$1/comment" | jq -r '.comments[] | "\(.id)  \(.user.username)  \(.date|tonumber/1000|strftime("%Y-%m-%d %H:%M"))  \(.comment_text[0:100]|gsub("\n";" "))"' ;;
  statuses)
    [[ -n "${1:-}" ]] || usage
    api GET "list/$1" | jq -r '.statuses[] | "\(.orderindex)  \(.status)  (\(.type))"' ;;
  status)
    [[ -n "${1:-}" && -n "${2:-}" ]] || usage
    api PUT "task/$1" -d "$(jq -n --arg s "$2" '{status:$s}')" | jq -r '"\(.id) agora em: \(.status.status)"' ;;
  assign-me)
    [[ -n "${1:-}" ]] || usage
    me="$(api GET user | jq -r .user.id)"
    api PUT "task/$1" -d "{\"assignees\":{\"add\":[$me]}}" | jq -r '"\(.id) atribuida a \([.assignees[].username]|join(", "))"' ;;
  search)
    need_team; [[ -n "${1:-}" ]] || usage
    api GET "team/$TEAM/task?include_closed=true&page=0" -G --data-urlencode "name=$1" 2>/dev/null \
      | jq -r --arg q "$1" '.tasks[] | select(.name|ascii_downcase|contains($q|ascii_downcase)) | "\(.id)  [\(.status.status)]  \(.name)"' ;;
  *) usage ;;
esac
