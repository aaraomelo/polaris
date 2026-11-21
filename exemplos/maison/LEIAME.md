# Maison: o template "Homeware store" do Lovable portado para o Polaris

O porte cobre o **tema** (`maison`: paleta terracota, linho e carvão, claro e escuro, títulos em serifa) e três páginas: **início** (`/`), **produtos** (`/produtos`, com filtro por categoria em `?colecao=…`, contagem e selos) **detalhe do produto** (`/produtos/:id`, com "Você também pode gostar" da mesma coleção e aviso para id inexistente), **sobre** (`/sobre`, com a seção de contato), **sacola** (`/sacola`), **checkout** (`/checkout`) e **confirmação** (`/pedido`).

```bash
node exemplos/maison/gera.mjs                     # gera nos.json (tema, páginas, tenants) a partir deste script
pnpm local --memoria --site exemplos/maison       # http://loja-demo.polaris.localhost:3000/
```

- `gera.mjs` descreve o tema e a página em JavaScript e escreve `nos.json`; as fotos estão em `img/` (21 JPEGs do Unsplash usados pelas páginas do template, ~1,9 MB).
- Texto em pt-BR; os 13 produtos, categorias e preços seguem o template (em reais), traduzidos. Os dados dos produtos ficam no estado `produtos` da página, filtrados por expressão.
- A auditoria de contraste (AA) passa nos dois modos; por isso o terracota e o cinza do texto suave são um pouco mais escuros que os do template.

## Visual (tokens do tema, não CSS solto)
O tema declara `seguirSistema: false` (sempre claro, como o template), `cabecalho` (translúcido com desfoque, marca serifada, links em caixa alta com sublinhado que cresce), `rodape` invertido, `botao` (caixa alta), `movimento` (300 ms nas cores, 700 ms e 105% no zoom da foto do cartão, entrada de 1,2 s e zoom lento de 20 s a 108% na capa) e `tipografia.tamanhoExibicao` para o título da capa. As capas das páginas usam `layout/destaque` com `capa`. As fontes **Cormorant Garamond e Inter são embutidas** (`fontes` no tema, servidas da própria origem). Os cartões têm categoria, selo, rótulo "Ver detalhes" e 2ª foto no hover; as coleções e as fotos da faixa crescem no hover.

## Idiomas (pt-BR e en)
As páginas **só levam chaves** (`{t("home.titulo")}`); os textos ficam em `idiomas.mjs` e saem como o catálogo `maison.textos` (kind `traducao`, `docs/i18n.md`). O padrão é pt-BR (`/produtos`) e o inglês é o **texto original do template** (`/en/produtos`), o que valida a cópia. Os produtos são dados em vários idiomas (`loc(idioma, …)`), os preços usam `qmoeda(…, idioma)`, o formulário do checkout tem rótulos por idioma e o cabeçalho tem o seletor (`tenant.idiomas`). Para acrescentar um idioma: um bloco novo em `idiomas.mjs` e o código em `IDIOMAS`.

## Tipografia (pesos e tamanhos)
Conferida elemento a elemento contra o template: família, tamanho, peso, espaçamento e caixa de 17 pontos da capa, das coleções e do rodapé batem (por exemplo: marca e h1 da capa em 400, não 500; títulos de coluna do rodapé em Cormorant 600 11 px caixa alta; "Explore" 12/500; botão da assinatura 56×48 só com a seta). Cada diferença virou token (docs/temas.md), não regra da Maison.

## Rodapé
Três faixas (`site/rodape` com `faixas`): marca e frase com a assinatura de e-mail no slot `topo` (o e-mail e o "já assinou" são estado da página, o segundo persistente: não há servidor), as quatro colunas (a última com e-mail e horário como linhas de texto) e o aviso final. O que o rodapé tem de reutilizável está no `docs/blocos-base.md`.

## Cabeçalho
Menu na ordem do template (Coleções, Loja, Sobre): **Coleções** abre no hover num painel de 2 colunas com as 8 categorias, cada uma com o nome e a frase (`grupos[].links[].descricao` e os tokens `cabecalho.submenu*`); à direita ficam o seletor de idioma e a **sacola como ícone** com o contador (`nav/link` com `icone: sacola` e `rotulo`). O coração (lista de desejos) do template não foi portado: a Maison não tem essa função.

## A loja: barra de categorias e ordenação
A barra de categorias é `site/abas` (as categorias) mais `entrada/selecao` ("Ordenar por": destaques, mais recentes, menor preço, maior preço, A–Z), dentro de um `layout/linha` com `marca: "barra-fixa"`: fica fixa sob o cabeçalho, translúcida com desfoque. A ordenação é real (`ordena` sobre o filtro por categoria). A categoria é um **estado ligado à URL** (`estado.colecao`, `daConsulta`) e as abas são links `soConsulta`: trocar de categoria **não recarrega a página** (o scroll fica e só mudam o hero, a lista e o `aria-current`; `docs/paginas.md`). O **hero da loja depende da categoria ativa** (`?colecao=<slug>`): com categoria mostra a foto, o nome e a frase dela (dados em vários idiomas, `loc(idioma, …)`); sem categoria, ou com uma que não existe, o hero "Todas as peças". É um `repetir` sobre 0 ou 1 item e um bloco com `se`, sem nenhum código novo. Estes componentes nasceram de comparar com o template.

## A sacola (estado persistente)
O botão "Adicionar à sacola" dos cartões grava `{id, qtd}` no estado `sacola`, que **persiste no navegador** (`persiste: true`, `docs/paginas.md`): o contador do cabeçalho e a página `/sacola` leem o mesmo valor em qualquer página. A sacola mostra foto, quantidade (− e +), remover e o subtotal em dinheiro exato (`qsoma`/`qmul`); o preço vem do catálogo da página, não do que foi guardado. Não há frete nem pagamento: o fechamento do pedido ainda não existe.

## Checkout de demonstração
`/checkout` mostra o resumo da sacola e o formulário `maison.checkout` (nome, e-mail, telefone e CEP com máscara, endereço e cidade; validação no navegador). Sem `envio`, a ilha do formulário só avisa a página (`aoEnviado` com `evento.valores`) e as ações da página gravam o pedido (número, cliente, itens e total em dinheiro exato) no estado persistente `pedidos`, esvaziam a sacola e vão para `/pedido`. **É de mentira de propósito:** não há frete, pagamento, e-mail nem servidor, e o pedido fica só neste navegador. O serviço `pedidos` exige comprador autenticado e as páginas ainda não têm carregador de serviços (`docs/paginas.md`).

## Primitivas de layout criadas para o porte
`layout/contido` (largura máxima centrada), `texto/sobretitulo`, imagem `fluida` com `proporcao`, `alinha` na grade, `centro` no cabeçalho e a escala tipográfica do tema (`tamanhoH1..H3`, `familiaTitulo`, `layout.largura*`). Estão descritas em `docs/blocos-base.md`; nenhum tema existente muda.

## O que ainda não está igual ao template
Ainda faltam o itálico da segunda linha do título, o indicador de rolagem da capa, a marca grande do rodapé e o tamanho maior (60 px) do título da coleção em destaque. As segundas fotos dos cartões são cenas da casa em ciclo (conteúdo de exemplo). Frete, pagamento e pedido de verdade (serviço) e a ordenação da loja ainda não foram portados; um id de produto que não existe mostra o aviso, mas responde 200 (o parâmetro é `texto`, sem checar o catálogo); o checkout pede o serviço `carrinho`/`pedidos` no cliente.
