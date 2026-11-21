# Servidor de páginas dos tenants

O gateway serve as **páginas** (`kind: pagina`) de cada tenant: `GET` de qualquer caminho que não seja da API. É a peça que liga o roteamento declarativo (`docs/rotas.md`) ao navegador.

```
host/token → tenant → nó `tenant` (paginas, idiomas, login, 404…) → tabela de rotas (compilada 1×/release)
          → resolveRota → página → streamVivo (dados do serviço, tema, CSP com nonce) → HTML + cliente que hidrata
```

## Ligar
`criaGateway({ paginas: { tenantNo(ctx) { … } } })`. `tenantNo` devolve o **id do nó `tenant`** do tenant da requisição (em `apps/polaris` é o alias do diretório); sem nó, o tenant não publica páginas (404 em texto). O nó `tenant` declara as páginas com rota, o 404, o login, os redirecionamentos e os idiomas.

## O que acontece numa requisição
- **Tenant**: vem do host (ou do token). O registro é o do tenant: core + a release de **produção** dele.
- **Rotas**: barra final → 308; redirecionamentos do tenant; idioma; parâmetros tipados; `guarda`; 404/403 com a página própria do tenant (ou texto).
- **Dados**: os mesmos do BFF (serviços, cache escopado, o `Authorization` do visitante repassado). Anônimo só alcança o que o serviço declara `publica`. Falha de dado vira erro daquele dado; a página sai.
- **HTML**: `streamVivo` (dados em streaming entram depois do esqueleto), tema do tenant (`tema` do nó, ou `padrao`) em `<link>`, `lang` do idioma. Cliente e CSS são servidos de `/_polaris/a/<hash>` (endereçados pelo conteúdo, `immutable`).
- **CSP por resposta**, com nonce: `default-src 'none'`, scripts só com o nonce ou `'self'`, `frame-ancestors 'none'`, sem `unsafe-eval`.
- Prefixos reservados (`/api`, `/bff`, `/studio`, `/graphql`, `/_polaris`, `/metricas`, `/saude`) nunca viram página: seguem JSON.

## Navegação no cliente
Clicar num link do próprio site troca a página **sem recarregar o navegador**: o roteador (`packages/gateway/src/navegacao.ts`, ES2017 puro, servido de `/_polaris/a/<hash>.js` e incluído no fim de toda página) intercepta o clique, busca a URL com `x-polaris-nav: 1` (o servidor responde a página inteira, sem pedaços em streaming), troca o conteúdo de `#polaris`, o título, o tema e os dados embutidos, carrega o pacote da página nova só se ainda não estiver carregado e a hidrata de novo (a anterior é destruída). `history.pushState`, voltar/avançar e rolagem funcionam.
É melhoria progressiva: tecla modificadora, `target`, `download`, outra origem, `/api` `/bff` `/studio` `/graphql` `/entrar`, resposta que não é HTML, falha de rede ou cliente ainda não carregado caem na navegação normal do navegador. Só mudou a âncora (`#x`): o navegador resolve. Não há pré-busca (prefetch) nem transição animada.

## Pré-visualização de release
Com `preview` no gateway (`POLARIS_PREVIEW_SEGREDO`, no `pnpm local` já vem um de desenvolvimento), `GET /_polaris/preview?t=<link assinado>` valida o link **neste tenant** e grava o cookie `polaris_preview`; enquanto ele valer, as páginas são as da release do link (registro, tabela de rotas e programas próprios dessa release), com faixa visível e `noindex`. Cookie expirado, de outro tenant ou de release inexistente é descartado e o site volta à produção. O link é de leitura do site, sem login: trate-o como segredo. `GET /_polaris/preview/sair` apaga o cookie.

## Formulários nas páginas
Página com o bloco `form/formulario` leva, antes do roteador, o pacote da ilha (`data-pl-ilha`): um para todas as páginas, endereçado pelo conteúdo, só para quem usa o bloco. Detalhes em `docs/formularios.md`.

## Login
O login do site é `/entrar` (página de sistema, formulário `identidade.entrar`): veja `docs/identidade.md`. A sessão é o cookie abaixo, agora emitido pelo próprio gateway.

## Sessão por cookie
O navegador não manda `Authorization` ao navegar, então a sessão do site é um **cookie com o próprio JWT** do provedor de identidade:
- `POST /_polaris/sessao` com `{"token": "…"}` (só `application/json`, o que um formulário de outro site não consegue enviar) valida o token **no host do tenant** e responde 204 com `Set-Cookie: polaris_sessao=…; Path=/; HttpOnly; SameSite=Lax; Max-Age=28800; Secure`. Sem `Domain`: vale só para aquele host. `POST /_polaris/sair` apaga.
- O cookie vale **só para páginas (GET)**. A API (`/api`, `/bff`, `/graphql`) continua exigindo `Authorization`, então um site de outra origem não age em nome do visitante (nada de CSRF contra mutações).
- Cookie inválido, expirado ou de outro tenant: a página sai como anônima, o cookie é apagado e a `guarda` leva ao login (`rotaLogin?volta=<caminho>`; `voltaSegura` impede redirecionamento aberto). As respostas variam por `Cookie`.
- `Secure` é padrão; só `cookieSeguro: false` (desenvolvimento, http) o tira. No `pnpm local`, `/entrar` tem o botão "site como …", que grava o cookie e volta para a página pedida.
- Quem emite o token em produção é o provedor de identidade; o formulário de login que o chama ainda não existe (o `/entrar` do `pnpm local` é só de desenvolvimento).

## Estado que persiste no navegador
Uma entrada de `spec.estado` com `"persiste": true` é guardada no `localStorage` da origem da loja (chave `polaris:estado:<nome>`) a cada mudança e devolvida ao abrir **qualquer página que declare o mesmo nome**. É como a sacola de compras do exemplo `exemplos/maison` atravessa as páginas e sobrevive ao fechar a aba.

```json
"estado": { "sacola": { "tipo": "json", "lista": true, "inicial": [], "persiste": true } }
```

- O servidor sempre renderiza `inicial` (ele não vê o navegador); o valor guardado entra logo depois da hidratação e a página se atualiza.
- O valor lido é conferido (tipo e, com `lista`, ser lista); texto corrompido ou de outro formato é ignorado e vale o `inicial`. Cota cheia ou armazenamento bloqueado não derrubam a página: ela funciona sem guardar.
- Um estado `persiste` conta como mutável mesmo que nenhuma ação da página o escreva (uma página só de leitura, como a confirmação de pedido, também recebe o valor guardado).
- Cada loja tem uma origem própria, então uma loja não lê o que outra guardou. Mas o valor fica **na máquina de quem visita** e pode ser alterado por ela: guarde só escolhas (ids e quantidades), nunca preço ou permissão, e recalcule do catálogo ao exibir (a sacola do exemplo faz isso).
- Não há sincronização entre aparelhos nem com o servidor; para isso o caminho é o serviço `carrinho` (`docs/commerce.md`), que ainda não tem carregador no cliente das páginas.

## Estado ligado à URL (`daConsulta`)
Um estado `texto` com `"daConsulta": "colecao"` nasce do parâmetro da URL (`?colecao=lighting`, ou `inicial` se ausente), acompanha o botão voltar e **escreve de volta na URL** quando muda por ação (sem criar entrada no histórico). Com links `soConsulta: true` (`nav/link`, e `itens[].soConsulta` em `site/abas`) para a **mesma página**, trocar de categoria ou de filtro **não recarrega a página**: o runtime cancela a navegação, empurra a URL no histórico e muda só o estado; o scroll fica e **só o que depende do estado é reescrito** (o cabeçalho, o rodapé e a barra continuam os mesmos nós). Link para outra página, ou com Ctrl/Cmd, segue a navegação normal. Sem JavaScript o link funciona como link comum (a URL leva a categoria e o servidor renderiza a página certa).

```json
"estado": { "colecao": { "tipo": "texto", "inicial": "", "daConsulta": "colecao" } }
```

### Quanto custa mudar o estado
Medido no navegador (loja de 13 produtos): trocar de categoria reescreve 2 atributos (`aria-current`), o hero e a lista (35 nós saem e 4 entram, de 280 no total), sem nova requisição além da foto do hero, em 2 a 6 ms. Em escala (jsdom, mesma loja com N produtos, 4 expressões que repetem o filtro): 100 itens 2 ms, 1.000 itens 12 ms, 5.000 itens 41 ms. O custo é **linear em N e multiplicado por quantas expressões repetem a mesma derivação**: um valor derivado usado em vários lugares é recalculado em cada um. O próximo passo natural é um valor derivado de página (calculado uma vez por mudança do que ele lê).

## Limites (conhecidos)
- As `guarda` das páginas comparam com os **papéis** do token (não há mapa papel → permissão).
- O serviço só resolve o tenant de uma chamada **anônima** pelo mapa de desenvolvimento `POLARIS_HOSTS`. Em produção, páginas públicas com dados de serviço ainda não têm esse caminho (o serviço atende só com token).
- Páginas que o runtime do navegador não suporta respondem 501; ações que chamam serviços no cliente (`executar`) dependem do carregador do hospedeiro, que o site ainda não tem.
- Sem cache de HTML entre requisições (a tabela de rotas, os programas e o cliente têm cache).
