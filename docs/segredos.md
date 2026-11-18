# Gestão de segredos

**Regra única:** segredo nunca está no git, nunca está no ambiente do processo, nunca aparece em log, resposta de erro, `docker inspect` nem mensagem de configuração. Ele vive num **arquivo** com modo 0400, fora do repositório, e o processo o lê por `X_FILE`.

## Onde cada segredo mora
| Segredo | Dev | Homologação/Produção | Quem lê |
|---|---|---|---|
| chave de verificação do JWT | HS256 de desenvolvimento (`docker/dev.env`) | **chave pública** (JWKS do provedor de identidade): quem verifica **não** emite | gateway, serviços |
| URL do banco (app) | `docker/dev.env` | `docker/segredos/loja_url_app` | serviço |
| URL do banco (migrador, BYPASSRLS) | idem | `docker/segredos/*_migrador` — só no passo de migração | `migra` |
| URL do banco (plataforma) | idem | `docker/segredos/plataforma_url` | gateway |
| token de `/metrics` | `docker/dev.env` | `docker/segredos/metricas_token` | gateway, serviços |
| segredo do preview (HMAC) | — | `docker/segredos/preview_segredo` | gateway |
| token do ClickUp (ferramentas do repositório) | `.env` local (ignorado pelo git) | — | `scripts/clickup.sh` |

O `.env` da raiz é **pessoal** (guarda o token do ClickUp): o compose **não o usa** (usa `docker/dev.env`).

## As quatro barreiras
1. **Hook de pré-commit** (`.githooks/pre-commit`, ativado por `git config core.hooksPath .githooks`): confere o que está em stage.
2. **CI** (job `segredos`): confere **todos os arquivos** e **todo o histórico** (`--historico`: as linhas adicionadas em qualquer commit, de qualquer branch). Segredo que já entrou num commit continua vazado depois de apagado.
3. **`scripts/deploy.sh verifica`**: recusa segredo legível por outros, de dono errado, link simbólico, vazio, curto, com cara de valor de exemplo, ou **dentro do arquivo de ambiente**.
4. **O código**: `resolveArquivos` recusa ambiguidade (`X` e `X_FILE`), arquivo que não é regular/vazio/enorme; as mensagens de erro dizem **qual variável** falhou, nunca o valor; o logger redige campos sensíveis.

## O detector (`tools/ferramentas/src/segredos.ts`)
- **Nomes proibidos:** `.env*`, `docker/*.env`, `docker/segredos/*`, `*.pem/.key/.p12/.pfx/.jks`, `id_rsa/ed25519…`, `.git-credentials`, `.netrc`, `.npmrc`, `credenciais/`, `segredo(s)/` (só `*.exemplo` e o `LEIA-ME` entram).
- **Formatos conhecidos** (valem em **qualquer** arquivo, inclusive teste e linha gigante): chaves privadas (PEM/OpenSSH/PGP), GitHub (`ghp_/gho_/ghu_/ghs_/ghr_/github_pat_`), GitLab, AWS (access key e secret), Google API, Slack (token e webhook), Stripe, npm, Atlassian, ClickUp, Anthropic, OpenAI, **JWT assinado de verdade** (assinatura de alta entropia: JWT de exemplo, com assinatura repetida, passa).
- **Heurísticas** (fora de teste e de linha > 4.000 caracteres): URL com `usuário:senha` (senha que **não** seja marcador óbvio — `senha`, `xxxx`, `${VAR}`, `<…>`, `exemplo`, ou igual ao usuário) e atribuição de nome de segredo a literal de **alta entropia** (≥ 3,9 bits/caractere).
- **Nunca imprime o valor**: só regra, arquivo, linha (e o commit, no histórico). Um log de CI com o segredo seria um vazamento novo.
- **Falso positivo de um valor de exemplo:** marque a **própria linha** com `polaris: permite-segredo` (a marca não vale para a linha seguinte).
- Lockfiles e binários só passam pelo nome (hashes de integridade não são segredo).

## Rotação (sem derrubar o serviço)
| Segredo | Como |
|---|---|
| **JWT** | o provedor publica a chave nova no JWKS **antes** de assinar com ela (`kid` novo); os tokens antigos valem até expirar; depois retire a chave velha. Nada a fazer aqui. |
| **Preview (HMAC)** | 1) coloque o segredo atual em `POLARIS_PREVIEW_SEGREDO_ANTERIOR` e o novo em `POLARIS_PREVIEW_SEGREDO`; 2) reinicie o gateway: links antigos continuam valendo, os novos saem assinados com o novo; 3) quando os links antigos expirarem (≤ 7 dias), remova o anterior. O anterior **nunca assina**. |
| **Senha do banco (app/plataforma)** | `ALTER ROLE polaris_app PASSWORD '…'` → atualize o arquivo do segredo → reinicie o serviço (o pool abre conexões novas com a senha nova). As conexões já abertas seguem até caírem. |
| **Token de métricas** | troque o arquivo e o scraper (Prometheus) e reinicie. |
| **Token do ClickUp** | gere outro no ClickUp, atualize o `.env` local e **revogue o antigo**. |

## Se um segredo vazou (checklist)
1. **Revogue/rotacione AGORA** (antes de qualquer outra coisa): apagar o commit não desfaz o vazamento.
2. Descubra o alcance: `bash scripts/check-no-secrets.sh --historico` diz **em qual commit** entrou; o log de acesso do provedor diz se foi usado.
3. Só depois, se for o caso, limpe o histórico (reescrever o histórico é destrutivo: **peça confirmação** e avise quem tem clone).
4. Registre o incidente e o que mudou na barreira que falhou (acrescente uma regra ou um teste ao detector).

## Limites conhecidos
- O detector acha **formatos conhecidos e alta entropia**; um segredo curto, sem formato (uma senha de 8 letras) **não é achado**. Por isso a regra é "segredo só em arquivo fora do git", não "confie no scanner".
- O histórico foi conferido **agora** (68 commits, limpo); o job do CI repete a cada push, mas só vê o que já chegou ao repositório.
- Não há **cofre de segredos** (Vault/KMS/Secrets Manager): são arquivos com modo 0400. Para vários servidores, o próximo passo é um cofre com rotação automática e auditoria de acesso.
- Os segredos de **provedores de pagamento** ainda não têm lugar definido (o pack Pagamentos recebe o provedor por injeção; as credenciais dele virão do mesmo mecanismo `X_FILE`).
- O arquivo de segredo é legível pelo **root do host** e pelo dono; quem entra no servidor como root lê tudo (defesa: acesso mínimo, auditoria).
