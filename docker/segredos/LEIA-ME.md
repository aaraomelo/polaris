# Segredos do deploy (arquivos, nunca no git)

Cada arquivo abaixo é **um segredo**, **modo 0400**, **dono = quem sobe o compose**, **sem quebra de linha obrigatória** (a final é ignorada). Esta pasta é ignorada pelo git (só este LEIA-ME entra).

| Arquivo | Conteúdo | Quem usa |
|---|---|---|
| `metricas_token` | token Bearer do `/metrics` (≥ 16 caracteres) | gateway e serviços |
| `plataforma_url` | `postgres://polaris_plataforma:…@host/polaris` (diretório de tenants) | gateway |
| `plataforma_url_migrador` | URL do banco com o papel MIGRADOR (só para `deploy.sh <amb> migra`) | passo de migração |
| `preview_segredo` | segredo HMAC dos links de preview (≥ 32 caracteres) | gateway |
| `loja_url_app` | URL do banco com o papel da APLICAÇÃO (sem BYPASSRLS) | serviço `loja` |
| `loja_url_migrador` | URL do banco com o papel MIGRADOR (só quando `POLARIS_MIGRAR=1`) | serviço `loja` |
| `postgres_senha` | senha do superusuário do Postgres local (só com o perfil `banco-local`) | postgres |

Gerar um valor forte: `head -c 48 /dev/urandom | base64 | tr -d '\n=' > docker/segredos/metricas_token && chmod 0400 docker/segredos/metricas_token`.
`./scripts/deploy.sh <ambiente> verifica` confere existência, modo e tamanho **sem mostrar o conteúdo**.
