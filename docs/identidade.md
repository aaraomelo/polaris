# Identidade e login (e-mail e senha)

A plataforma tem **identidade própria**: usuários por tenant, senha com scrypt, sessão em cookie e o JWT que os serviços já verificam. Decisão e alternativas: `docs/adr/0014-identidade-propria.md`.

## O fluxo

```
visitante → /entrar (página de sistema, formulário `identidade.entrar`)
          → POST /bff/formularios/identidade.entrar { email, senha, volta }   (cabeçalho x-polaris-form: 1)
          → o gateway pergunta à identidade; se confere, emite o JWT (ES256) e grava o cookie `polaris_sessao`
          → o formulário navega para `volta` (só caminho do próprio site)
```
O tenant vem **do endereço** (nunca do corpo): a conta da Ana na Loja A não entra no endereço da Loja B. Os papéis do usuário (`studio.editor`, `gerente`…) viram o claim `papeis` do JWT; o `sub` é o id do usuário.

### Páginas e formulários de sistema (`packages/packs/nos/identidade`)
| Página | Formulário | Ação (`envio.sistema`) |
|---|---|---|
| `/entrar` | `identidade.entrar` | `entrar`: e-mail e senha → sessão |
| `/senha/esqueci` | `identidade.esqueci` | `esqueci`: manda o link por e-mail |
| `/senha/redefinir?token=…` | `identidade.redefinir` | `redefinir`: define a nova senha (uso único) |

Todo tenant ganha as três **sem declarar nada** (e `rotaLogin` passa a ser `/entrar` sozinho). Se alguma colide com uma rota do tenant, só ela fica de fora, com um aviso. O tenant pode **trocar** uma página ou formulário de sistema pelo dele (mesmo id, no escopo dele) para mudar o visual ou os textos.

## Regras de segurança (valem como contrato; cada uma tem teste)
- **Senha**: scrypt (N=2¹⁵, r=8, p=1), sal por usuário e os parâmetros dentro do hash (subir o custo refaz o hash no próximo login). Mínimo de 10 e máximo de 128 caracteres; recusa as óbvias, só números, poucos caracteres diferentes e as que contêm o e-mail ou o nome. Normalização Unicode (NFKC). Nunca em log, nunca devolvida.
- **Credenciais**: e-mail desconhecido, senha errada, conta sem senha e conta desativada dão a **mesma** resposta (e gastam o mesmo tempo de scrypt): o login não revela quais contas existem.
- **Bloqueio**: 5 falhas seguidas do mesmo (tenant, e-mail digitado) bloqueiam por 15 min, **existindo a conta ou não**; bloqueado não testa a senha certa (429 com `Retry-After`). Sucesso zera a contagem. Além disso, taxa por IP no gateway (custo 10 por tentativa).
- **"Esqueci a senha"**: responde **sempre igual** e trabalha em segundo plano (o tempo não diz se a conta existe); no máximo um link por minuto por conta.
- **Tokens** (redefinição e convite): 32 bytes aleatórios, só o SHA-256 vai ao banco, **uso único**, expiram (1 h; convite 7 dias), valem **só no tenant** que os emitiu, e um novo invalida os anteriores. Senha fraca não gasta o token. A página leva `Referrer-Policy: no-referrer`.
- **CSRF**: as ações de sistema exigem `x-polaris-form: 1` e JSON; o cookie é `HttpOnly`, `SameSite=Lax`, sem `Domain` e `Secure` por padrão.
- **Chave**: o JWT é assinado com chave **privada** (ES256, EdDSA ou RS256) que só o gateway tem; serviços e gateway **verificam com a pública** (JWK ou JWKS). Na partida o gateway confere que a privada combina com a pública (senão nenhuma sessão valeria). `JWT_SEGREDO` (HS256) continua proibido em produção.

## Configuração (gateway)
| Variável | |
|---|---|
| `POLARIS_IDENTIDADE_CHAVE_PRIVADA_JWK` (ou `_FILE`) | a chave privada em JWK (com `d`); liga o login próprio. Exige `DATABASE_URL_PLATAFORMA` |
| `JWT_CHAVE_PUBLICA_JWK` | a pública correspondente (o gateway verifica com ela) |
| `POLARIS_IDENTIDADE_SESSAO_HORAS` | validade da sessão, 1 a 24 (padrão 8) |
O gateway publica a pública em **`/.well-known/jwks.json`**: os serviços podem usar essa URL como `JWT_JWKS_URL` (rede interna) em vez de copiar a chave.

## Usuários
- **Cadastro do tenant**: o dono vira usuário **convidado** e recebe um e-mail com o link para definir a senha (`criaConviteDoDono`, a porta `identidade.convida` do cadastro); o convite nunca leva senha.
- Por código: `criaIdentidade({ q })` → `criaUsuario`, `convida`, `muda` (status e papéis), `entra`, `pedeRedefinicao`, `redefine`.
- **Papéis da plataforma** (`studio.*`) são registrados em todo serviço: o token traz todos os papéis do usuário e um serviço **nega tudo** se não conhece um deles (falha fechada, por desenho); esses papéis não concedem nada num serviço de domínio.

## No ambiente local (`pnpm local`)
Cada tenant de demonstração tem o usuário `ana@<alias>.test` com a senha `senha-dev-polaris` (só aqui), papéis `studio.editor` e `gerente`. O login real está em `http://loja-demo.polaris.localhost:3000/entrar`; o **Studio usa a sessão** (e manda ao login se não houver). Não há SMTP: o e-mail "enviado" aparece em **`/_dev/emails`**. A chave de assinatura (ES256) fica em `.polaris-local/chave-jwt.json`. O atalho `/entrar/ir` (token de desenvolvimento) continua existindo só no local.

## Limites (conhecidos)
- **Sem envio real de e-mail**: o texto vai para a caixa de saída (`plataforma.email_saida`); falta o trabalhador SMTP que a esvazia. Sem ele, "esqueci a senha" e o convite do dono não chegam à pessoa em produção.
- **Sessão sem revogação**: o JWT vale até expirar (8 h por padrão); trocar a senha ou desativar a conta não derruba sessões já emitidas. A desativação vale no próximo login/renovação.
- **Sem MFA, sem login social, sem "sair de todos os dispositivos"**, e **sem tela de administração de usuários** (hoje por código).
- O compose de deploy ainda pressupõe um provedor externo (`JWT_JWKS_URL`): para o login próprio, ver a seção de configuração.
- A caixa de e-mail de desenvolvimento e o atalho `/entrar/ir` não existem em produção.

## "Entrar" e "Sair" no cabeçalho
- As páginas enxergam a sessão em **`tenant.autenticado`** (`true` com sessão válida; ausente para visitante), no servidor e na hidratação. O exemplo `loja-site` usa `se: "tenant.autenticado != true"` no link "Entrar" e `se: "tenant.autenticado == true"` no link "Sair".
- **`GET /_polaris/sair`** apaga o cookie de sessão e redireciona (303) para `/`; é um link, sem JavaScript. Pedido que o navegador marca como vindo de **outro site** (`sec-fetch-site: cross-site`/`same-site`) **não desloga** (redireciona sem apagar), contra `<img src>` ou link alheio. O `POST /_polaris/sair` (204) segue valendo para clientes com `fetch`.
- **Limites**: a sessão é um JWT sem revogação no servidor (sair só apaga o cookie deste navegador); páginas estáticas (AOT) veem sempre "visitante"; navegador antigo sem `Sec-Fetch-Site` aceita o GET de qualquer origem (só desloga, sem outro efeito).
