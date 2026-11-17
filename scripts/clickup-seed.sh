#!/usr/bin/env bash
# Semeia o ClickUp com backlog/backlog.json: epicas viram tarefas, historias viram subtarefas.
#   ./scripts/clickup-seed.sh                 simulacao (nao cria nada)
#   ./scripts/clickup-seed.sh --apply <list_id>   cria na lista indicada (idempotente por nome da epica)
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"; ROOT="$HERE/.."; CU="$HERE/clickup.sh"
J="$ROOT/backlog/backlog.json"
if [[ "${1:-}" != "--apply" ]]; then
  jq -r '.[] | "\(.epic)", (.stories[] | "    - \(.[0])")' "$J"; echo; echo "simulacao: $(jq '[.[].stories|length]|add' "$J") historias em $(jq length "$J") epicas. Use --apply <list_id>."; exit 0
fi
LIST="${2:?informe o list_id}"
n=$(jq length "$J")
for ((i=0;i<n;i++)); do
  epic=$(jq -r ".[$i].epic" "$J"); desc=$(jq -r ".[$i].desc" "$J")
  out="$("$CU" create "$LIST" "$epic" "$desc")"; id=$(awk '/^criada:/{print $2}' <<<"$out"); echo "$epic -> $id"
  m=$(jq ".[$i].stories|length" "$J")
  for ((k=0;k<m;k++)); do
    t=$(jq -r ".[$i].stories[$k][0]" "$J"); d=$(jq -r ".[$i].stories[$k][1]" "$J")
    "$CU" create "$LIST" "$t" "$d" --parent "$id" >/dev/null; echo "   + $t"
  done
done
