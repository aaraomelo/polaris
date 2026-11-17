# Roteamento declarativo (packages/engine/src/rotas)

Pipeline: **nós `pagina` + `tenant` → `compilaTabela` → `TabelaRotas` (JSON) → `resolveRota(tabela, pedido)` → página | redirecionamento | negado | 404 | 400**.
`urlDe` é o inverso (roteamento reverso). Tudo é puro e síncrono; a tabela é validada **na compilação**, nunca na requisição.

## Onde se declara
| Nó | Campo | O que faz |
|---|---|---|
| `tenant` | `paginas` | páginas que têm rota (ids) |
| | `idiomas`, `idiomaPadrao` | ligam o i18n (sem `idiomas`: sem prefixo de idioma) |
| | `rotaLogin` | destino de quem não tem sessão e abre página protegida |
| | `paginaNegado`, `paginaNaoEncontrada` | páginas renderizadas com 403 e 404 |
| | `redirecionamentos` | `{ de, para, status }` (301, 302, 307, 308) |
| `pagina` | `rota` | padrão: `/produtos/:id`, `/docs/*resto`, `/` |
| | `rotasI18n` | idioma → padrão (mesmos parâmetros da rota base) |
| | `params` | tipo de cada parâmetro (`uuid`, `inteiro`…); valor inválido não casa (404 cedo) |
| | `guarda` | permissões exigidas (todas) |
| | `layout`, `layoutProps` | bloco de layout que envolve a página |
| `bloco` | `layout` | layout-pai (layouts aninhados) |

## Padrões
Segmentos estáticos (`[\p{L}\p{N}._~-]`), `:param` (camelCase) e `*resto` (último, casa **um ou mais** segmentos, vira lista). Sem barra final, sem `//`, `.` ou `..`, no máximo 16 segmentos.
**Precedência por especificidade**, da esquerda para a direita: estático antes de parâmetro antes de catch-all. A ordem de cadastro não importa. Duas rotas com a **mesma forma** (mesmo com nomes de parâmetro diferentes), no mesmo idioma, são **erro de compilação**.

## Resolução
1. **Normaliza**: barra final e `//` viram redirecionamento **308** (a query é preservada). Pedido inválido é **400**: sem `/` inicial, `\`, `?`/`#` no caminho, controles, `.`/`..`, codificação malformada, segmentos demais, ou CR/LF na query (injeção de cabeçalho no `Location`).
2. **Redirecionamentos do tenant** (caminho completo, com prefixo de idioma). Parâmetros são codificados e só vão para destinos **relativos**; laços e destinos externos são erro de compilação.
3. **Idioma**: `/en/...` seleciona o idioma; o padrão **não** tem prefixo (`/pt-BR/x` e `/EN/x` redirecionam 308 para a URL canônica). O primeiro segmento estático de uma rota não pode ser um código de idioma.
4. **Página**: parâmetros são decodificados e recusados se contiverem `/`, `\`, controle, ou forem `.`/`..`; depois tipados (`uuid`, `inteiro`…). Valor fora do tipo = a rota não casa.
5. **Guarda**: sem sessão → **302** para o login com `?volta=<caminho+query>` (a URL do login vem do roteamento reverso da página de login, no idioma da requisição) ou **401** sem `rotaLogin`; com sessão sem **todas** as permissões → **403** (com `paginaNegado`, se houver).
6. **Resultado**: `pagina`, `params` tipados, `idioma`, URL `canonica` e `alternativas` por idioma (para `hreflang`).

`voltaSegura(valor)` valida o `?volta=` depois do login: só caminho relativo do próprio site; qualquer outra coisa vira `/` (open redirect).
`login`, `paginaNegado` e `paginaNaoEncontrada` **não podem ter `guarda`** (laço), e a `rotaLogin` precisa existir e não ter parâmetros.

## Layouts
Um bloco de layout declara o slot **`conteudo`** (obrigatório) e o projeta com `core/slot`. A página é envolvida pela cadeia: `pagina.layout` → `bloco.layout` do layout → … (máx. 5 níveis; ciclo é erro).
O conteúdo da página continua sendo avaliado no escopo **da página**. Só o layout direto recebe `layoutProps` (templates no escopo da página); elas não podem depender de dado em streaming. O `caminho` de origem do conteúdo (`/spec/raiz`) não muda.

## Idioma no escopo
`{idioma}` está disponível em props, título, args de dados e `layoutProps`, e vira o `lang` do documento. É nome reservado.

## Fora do escopo (por ora)
Navegação no cliente (history API / transições sem recarregar), `servidor` que cola tabela + programa + render com cache de programas por rota, e a autenticação em si (a sessão e as permissões chegam prontas em `Pedido.sessao`).
