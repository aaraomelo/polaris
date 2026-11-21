# Pack Commerce

Contratos de dados (`kind: servico`) e blocos de exibição (`kind: bloco`) para vitrine, produto, carrinho e pedido. Código em `packages/engine/src/commerce/index.ts`; `registraCommerce(registry)` registra tudo no core. Documentação dos blocos: `docs/catalogo/` (gerada).

## Contratos
Origem dos campos: o modelo do tiffany-erp (`Product`, `ProductVariant`, `Order`, `OrderItem`). Os serviços (E4/E5) os implementam e o gerador emite o OpenAPI; o front só depende da **forma**.

| Serviço | Entidades | Operações |
|---|---|---|
| `catalogo` | `produto`, `variante` | `listarProdutos` (busca, pagina, limite), `obterProduto`, `listarVariantes` |
| `carrinho` | `carrinho`, `itemCarrinho` | `obterCarrinho`, `adicionarItem`, `alterarQuantidade`, `removerItem` (publicam `carrinhoAlterado`) |
| `pedidos` | `pedido`, `pagamentoPix` | `criarPedido`, `obterPedido`, `criarPagamentoPix` (consome `pagamentoConfirmado`) |

**Dinheiro é texto decimal exato** (`"49.90"`, tipo `dinheiro`), nunca float: os blocos formatam com `qbrl` (arredondamento comercial exato; 1,005 → R$ 1,01; valores acima de 2^53 saem certos). Número também é aceito. Teste: `test/commerce.test.tsx` confere que os blocos só leem campos que o contrato declara.

## Blocos
| Bloco | Props | Slot |
|---|---|---|
| `commerce/preco` | `valor`, `de` | |
| `commerce/cartao-produto` | `produto`, `href` | `acoes` |
| `commerce/vitrine` | `produtos`, `colunas` (padrão 3), `hrefBase` | |
| `commerce/detalhe-produto` | `produto` | `acoes` |
| `commerce/resumo-pedido` | `subtotal`, `desconto`, `frete`, `total` | |
| `commerce/carrinho` | `itens`, `subtotal`, `desconto`, `frete`, `total` | `acoes` |

São **composições declarativas** sobre os blocos base (`modelo`): nenhum código novo no runtime, então herdam hidratação, streaming, tema e tree-shaking. Paridade React × vivo conferida para todo exemplo.

`commerce/cartao-produto`: com `href`, a **foto** também leva ao detalhe (dentro de uma caixa que recorta, para o zoom do hover do tema); `rotuloLink` troca o texto do link sob o preço (padrão "Ver detalhes") e, vazio (`""`), o esconde.

## Por que o slot `acoes`
O modelo de um bloco não tem estado nem eventos (por desenho: ele é uma função das props). Então os blocos **exibem** e deixam um slot `acoes`; a página põe ali os botões e campos com os eventos dela. O conteúdo do slot é montado no escopo da página: enxerga `estado`, `dados` e a variável do `repetir` (cada "Adicionar" sabe de qual cartão veio: testado).

```json
{ "bloco": "commerce/cartao-produto", "repetir": { "cada": "estado.produtos", "como": "p", "chave": "p.id" },
  "props": { "produto": "{p}" },
  "slots": { "acoes": [ { "bloco": "nav/botao", "props": { "texto": "Adicionar" },
    "eventos": { "aoClicar": [ { "acao": "executar", "dados": "adicionarAoCarrinho", "args": { "produtoId": "{p.id}" } } ] } } ] } }
```

## Fora desta entrega
- Busca, checkout e pagamento como **blocos** dependem de estado de formulário e de eventos que o modelo de bloco não tem; ficam como composição de página (campo + `executar` do contrato) até existir um bloco com estado local. A página de checkout usa `commerce/resumo-pedido` + `pedidos.criarPedido`/`criarPagamentoPix`.
- Variantes: o contrato existe (`listarVariantes`); o seletor de variante é composição de página (lista de botões sobre `estado`).
- Implementação dos serviços: E4/E5 (o contrato aqui é a especificação).
