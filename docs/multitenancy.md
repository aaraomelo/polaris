# Multi-tenant: resolução, status e módulos

## O modelo
Um **tenant** é uma linha no diretório da plataforma (`plataforma.tenant`: alias, segmento, packs, `status`) mais os **módulos** habilitados (`plataforma.modulo`) e os **domínios** (`plataforma.dominio`). O diretório **não tem RLS**: é dado da plataforma, só o papel da plataforma o acessa. O dado de negócio de cada tenant fica nos serviços, isolado por RLS (`docs/persistencia.md`).

## Como um pedido vira um tenant (gateway)
| Pedido | Como o tenant é decidido | Conferências |
|---|---|---|
| **anônimo** | pelo **host**: subdomínio `<alias>.<base>` da plataforma ou domínio próprio **verificado** | host sem dono → 400 `tenant_nao_resolvido` (nunca "todos"); só tenant `ativo` opera |
| **com token** | pelo **token** (nunca pelo host nem por cabeçalho do cliente) | o tenant do token precisa existir e estar `ativo`; **se o host pertence a OUTRO tenant → 403 `tenant_divergente`** (um token não vale na vitrine alheia); host sem dono (API genérica) passa |

Status → resposta: `suspenso` 403 `tenant_suspenso`; `cancelado` 410 `tenant_encerrado`; `provisionando`/`falhou` 503 `tenant_indisponivel` com `retry-after`.

## Módulos habilitados
O gateway leva a lista de módulos do tenant em cada chamada e o **único ponto de chamada aos serviços** (`criaChamador`) recusa o que não está nela: **404 `modulo_nao_habilitado`**, sem chegar ao serviço. Como é o chokepoint de REST, BFF de página e GraphQL, os três ficam cobertos por uma checagem só (provado nos três).

## Resolução de host (`criaResolvedorTenant`)
- `normalizaHost`: minúsculas, sem porta nem ponto final; **recusa** IP, IPv6, `usuario@`, espaço, `_`, unicode, rótulo > 63, nome > 253.
- **Subdomínio**: só **um nível** (`a.b.base` não resolve), alias **reservado** nunca é tenant (defesa em profundidade além do cadastro), o apex da plataforma não é de tenant, sufixo sem ponto (`lojabase.app`) e base alheia (`loja.base.evil.com`) não resolvem.
- **Cache** curto e **limitado**: positivo 30 s (a suspensão tem de valer logo), negativo 5 s (um cadastro novo aparece logo), LRU de 5.000 entradas, **single-flight** (25 pedidos simultâneos ao mesmo host = 1 consulta), host inválido nem toca o banco. `invalida()` zera na hora (para o processo que suspendeu).

## Domínio próprio (verificação por DNS)
1. `adiciona(tenant, dominio)` devolve o registro a publicar: `TXT _polaris-verificacao.<dominio> = polaris-verificacao=<token>` (o token só o dono do tenant recebe).
2. `verifica` confere o TXT. **Só verificado resolve.**
3. **Anti-sequestro**: reivindicar não dá nada; quem **prova a posse** leva o domínio e derruba as reivindicações **não verificadas** dos outros; se outro tenant já o tem **verificado**, é `em_uso`. Um índice único parcial garante um dono verificado por domínio.
4. `revalida` (job): domínio que deixou de provar a posse **perde a verificação** (domínio abandonado ou vendido não serve a um tenant para sempre). **DNS fora do ar não revoga ninguém.**
5. Não se reivindica o que é da plataforma (`*.<base>`), `localhost`/`.local`/`.internal`/`.test`, IP nem nome sem TLD; no máximo 10 por tenant.

## Status do tenant (`mudaStatusTenant`)
`ativo ↔ suspenso`, qualquer um → `cancelado` (terminal). `provisionando`/`falhou` são do cadastro e não se alcançam por aqui (ativar é função do provisionamento, não de um clique).

## Configuração do runner do gateway
`DATABASE_URL_PLATAFORMA` + `POLARIS_BASES_DOMINIO` (ex.: `polaris.app`). **Em produção são obrigatórias** (o mapa estático `POLARIS_HOSTS` é só de desenvolvimento).

## Limites conhecidos
- O **cache é por processo**: depois de suspender, outra instância do gateway demora até o TTL (30 s) para enxergar. Não há barramento de invalidação.
- Os **serviços** ainda resolvem o tenant anônimo pelo `x-forwarded-host` com o próprio mapa (`contextoPorJwt`/`anonimo`); só o gateway usa o diretório. Enquanto o gateway for a única porta de entrada (rede fechada), é consistente; o ideal é o gateway repassar o tenant já resolvido.
- Nenhuma rota de **gestão** ainda (adicionar/verificar domínio, suspender): as funções existem; a API administrativa vem com o Studio/console (E8).
- **TLS/certificado** por domínio próprio (emissão automática) é da camada de entrada, fora daqui (E10).

---

# Overrides por tenant (armazém versionado)

O tenant redefine **páginas, temas, dados, papéis, documentos e blocos de composição** pela cascata `tenant → segmento → core`, sem tocar nos outros tenants. O armazém é `plataforma.no_versao` (`criaArmazemDeNos`).

## Versões imutáveis
Cada gravação é uma **versão nova** `(tenant, kind, id, seq)` com `hash` canônico, autor e nota. **Um gatilho no banco recusa `UPDATE` e `DELETE`**: a imutabilidade não depende do código. O "rascunho" é a **versão mais recente**; o mesmo conteúdo não cria versão nova (idempotente); gravações simultâneas do mesmo nó ganham `seq` distintos (`ON CONFLICT` + nova tentativa). Remover grava uma **lápide** (o nó volta a ser o do segmento/core; o histórico fica).

## O que um tenant pode (e não pode) gravar
| Regra | Por quê |
|---|---|
| só `pagina`, `tema`, `dados`, `papel`, `documento`, `bloco` | `servico` muda banco; `evento` é contrato entre serviços; `kernel`/`backend` executam código; `pack`/`tenant` são da plataforma |
| **sem `segmento`** | um tenant não publica no escopo de um segmento (valeria para todos os tenants dele) |
| **sem `tenantId` de outro**; o `tenantId` gravado é **sempre o do dono** | o conteúdo armazenado nunca manda no escopo |
| **sem `filhos`** | nós aninhados seriam registrados com os próprios escopos, furando as regras acima |
| bloco **sem `codigo`** | blocos que executam são da plataforma; o tenant compõe (`modelo`/`extends`) |
| ≤ 256 KB por nó, ≤ 500 overrides por tenant, ≤ 1.000 versões por nó | memória e abuso |
| tenant `cancelado` não grava | |

## Validação na gravação (não depois)
O nó entra num **registro derivado** (`Registry.derivado()`: cópia isolada de core + segmento + as cabeças do próprio tenant) e passa por: schema, **integridade referencial** (bloco, dados, papéis…) e **validação estrutural** (props contra o contrato do bloco; sujeitos, ações e campos do papel contra os serviços; operação do `dados` contra o serviço). Um `dados` só pode apontar para **serviço habilitado** para o tenant. O que foi gravado já foi conferido.

## O registro do tenant
`registroDoTenant(tenantId, escolha?)` monta o registro: as **cabeças** (rascunho) ou as **versões fixadas** por uma release (`escolha`). Nó corrompido no banco **não derruba o tenant**: é pulado e reportado em `ignorados`. O registro base nunca é alterado e dois tenants nunca compartilham override (provado).

## Limites conhecidos
- **Publicar** (release, preview, rollback) é o card seguinte: aqui o "rascunho" já existe, mas ainda não há o conjunto imutável que vai para produção.
- O diretório de versões **só cresce** (imutável); a poda/arquivo de versões antigas não existe.
- O `bloco` de composição só é validado pelo schema e pelas referências; o **comportamento visual** (CSS/acessibilidade) de um override não é auditado (o tema tem auditoria de contraste própria no engine, que o armazém ainda não chama).
- Um `papel` do tenant pode ser **mais permissivo** que o do core, de propósito (a cascata é do tenant sobre os dados dele); não há "teto" imposto pela plataforma.

---

# Publicação: rascunho → release → preview → produção, com rollback

```
salva (versão imutável)  →  cria release (snapshot)  →  preview (link assinado)  →  promove  →  rollback
      rascunho                  conjunto exato              só leitura, 1 release      ponteiro      ponteiro
```

## Release
`criaReleases` (`cria`, `promove`, `rollback`, `producao`, `lista`, `diario`, `diferenca`, `registroDe`). Uma **release** é o conjunto EXATO de versões de nós que o tenant serve (`{ "pagina:home": 7, … }`), numerada por tenant, **imutável** (gatilho no banco) e com `hash`.
- **Só nasce se o conjunto fecha**: o registro montado com aquelas versões passa por integridade referencial e validação estrutural **como um todo** (apagar um `dados` de que uma página depende impede a release; nada é criado pela metade).
- Idêntica à última (mesmo `hash`): devolve a mesma, não cria outra. Criações simultâneas viram uma só.
- Editar o rascunho **depois** de criar a release não a altera; cada release reconstrói o tenant exatamente como estava.

## Produção e rollback
A produção é **um ponteiro** (`release_ponteiro`) trocado numa transação com o tenant travado. `promove(n)` e `rollback()` são a mesma troca; o **diário** (`release_evento`, também imutável) registra de quê, para quê, quem e por quê.
- `rollback()` volta à release que estava em produção **antes** da atual; de novo, desfaz o rollback. `rollback(para=n)` vai a uma específica. Número inexistente, de outro tenant ou não inteiro é recusado.
- **Promover e voltar reconferem contra o core de HOJE**: se o core mudou e a release deixou de fechar (um bloco sumiu), a troca é recusada e a produção segue como estava.
- Tenant que nunca publicou serve só core/segmento: **o rascunho nunca vai ao ar**.

## O gateway
`registros.producao(tenant, release)` dá o registro do tenant; páginas, dados e temas saem **da release de produção**. O cache de programas compilados inclui a release (duas releases com a MESMA `versao` de página e conteúdo diferente não se confundem). O registro de uma release é imutável: fica em cache (LRU) para sempre.

## Preview
Link assinado `v1.<payload>.<HMAC-SHA256>` com **tenant + release + expiração** (mínimo 60 s, máximo 7 dias). Enviado em `x-polaris-preview` na rota de **página** (BFF GET): mostra aquela release e só ela; a produção segue intacta.
- assinatura conferida em tempo constante; adulterado, expirado, de outro segredo, malformado ou longo → **401 `preview_invalido`**;
- link de **outro tenant** → **403 `preview_de_outra_conta`**; release inexistente → 404;
- não vale para REST nem ações (que seguem em produção); sem a opção ligada o cabeçalho é **recusado** (400), nunca ignorado em silêncio;
- configuração: `POLARIS_PREVIEW_SEGREDO` (≥ 32 caracteres, só com a plataforma).

## Limites conhecidos
- **A troca de produção demora até o TTL do resolvedor (30 s) para chegar às instâncias do gateway.** No mesmo processo, `invalida()` é imediato; não há barramento de invalidação entre instâncias. Um rollback de emergência leva até 30 s.
- A **trava do tenant** (`FOR UPDATE`) que serializa `cria`/`promove` está no desenho, mas o PGlite (uma sessão) **não consegue provar** seu efeito: falta um teste com Postgres real e conexões concorrentes.
- Releases e versões **só crescem**; não há poda nem arquivamento.
- O preview mostra **páginas**; dados vêm dos serviços de produção (um preview de página nova que depende de um serviço novo mostra o dado real).
- Não há **agendamento** de publicação nem **aprovação** em duas etapas (quem pode promover é decisão da API administrativa, do Studio/E8).
- Não há **console/API** de publicação ainda (as funções existem; E8).
