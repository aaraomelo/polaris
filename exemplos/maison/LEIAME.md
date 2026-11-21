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
O tema declara `seguirSistema: false` (sempre claro, como o template), `cabecalho` (translúcido com desfoque, marca serifada, links em caixa alta com sublinhado que cresce), `rodape` invertido, `botao` (caixa alta), `movimento` (300 ms nas cores, 700 ms e 105% no zoom da foto do cartão, entrada de 1,2 s e zoom lento de 20 s a 108% na capa) e `tipografia.tamanhoExibicao` para o título da capa. As capas das páginas usam `layout/destaque` com `capa`. Fica de fora a fonte Cormorant Garamond (a política de segurança só aceita fontes da mesma origem).

## A sacola (estado persistente)
O botão "Adicionar à sacola" dos cartões grava `{id, qtd}` no estado `sacola`, que **persiste no navegador** (`persiste: true`, `docs/paginas.md`): o contador do cabeçalho e a página `/sacola` leem o mesmo valor em qualquer página. A sacola mostra foto, quantidade (− e +), remover e o subtotal em dinheiro exato (`qsoma`/`qmul`); o preço vem do catálogo da página, não do que foi guardado. Não há frete nem pagamento: o fechamento do pedido ainda não existe.

## Checkout de demonstração
`/checkout` mostra o resumo da sacola e o formulário `maison.checkout` (nome, e-mail, telefone e CEP com máscara, endereço e cidade; validação no navegador). Sem `envio`, a ilha do formulário só avisa a página (`aoEnviado` com `evento.valores`) e as ações da página gravam o pedido (número, cliente, itens e total em dinheiro exato) no estado persistente `pedidos`, esvaziam a sacola e vão para `/pedido`. **É de mentira de propósito:** não há frete, pagamento, e-mail nem servidor, e o pedido fica só neste navegador. O serviço `pedidos` exige comprador autenticado e as páginas ainda não têm carregador de serviços (`docs/paginas.md`).

## Primitivas de layout criadas para o porte
`layout/contido` (largura máxima centrada), `texto/sobretitulo`, imagem `fluida` com `proporcao`, `alinha` na grade, `centro` no cabeçalho e a escala tipográfica do tema (`tamanhoH1..H3`, `familiaTitulo`, `layout.largura*`). Estão descritas em `docs/blocos-base.md`; nenhum tema existente muda.

## O que ainda não está igual ao template
A fonte Cormorant Garamond não é carregada (CSP): os títulos usam a serifa do sistema. Ainda faltam o itálico da segunda linha do título, o indicador de rolagem da capa e o rótulo "Ver detalhes" que aparece no hover da foto. Frete, pagamento e pedido de verdade (serviço) e a ordenação da loja ainda não foram portados; um id de produto que não existe mostra o aviso, mas responde 200 (o parâmetro é `texto`, sem checar o catálogo); o checkout pede o serviço `carrinho`/`pedidos` no cliente.
