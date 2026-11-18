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

## Limites (conhecidos)
- **Sem sessão por cookie.** O token vai no cabeçalho `Authorization`; um navegador comum não o manda ao navegar, então páginas que dependem de login só funcionam para clientes que mandam o cabeçalho. O fluxo de login (cookie, `?volta=`) ainda não existe.
- As `guarda` das páginas comparam com os **papéis** do token (não há mapa papel → permissão).
- O serviço só resolve o tenant de uma chamada **anônima** pelo mapa de desenvolvimento `POLARIS_HOSTS`. Em produção, páginas públicas com dados de serviço ainda não têm esse caminho (o serviço atende só com token).
- Páginas que o runtime do navegador não suporta respondem 501; ações que chamam serviços no cliente (`executar`) dependem do carregador do hospedeiro, que o site ainda não tem.
- Sem cache de HTML entre requisições (a tabela de rotas, os programas e o cliente têm cache).
