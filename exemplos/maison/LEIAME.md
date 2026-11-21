# Maison: o template "Homeware store" do Lovable portado para o Polaris

O porte cobre o **tema** (`maison`: paleta terracota, linho e carvão, claro e escuro, títulos em serifa) e três páginas: **início** (`/`), **produtos** (`/produtos`, com filtro por categoria em `?colecao=…`, contagem e selos) **sobre** (`/sobre`, com a seção de contato) e **sacola** (`/sacola`).

```bash
node exemplos/maison/gera.mjs                     # gera nos.json (tema, páginas, tenants) a partir deste script
pnpm local --memoria --site exemplos/maison       # http://loja-demo.polaris.localhost:3000/
```

- `gera.mjs` descreve o tema e a página em JavaScript e escreve `nos.json`; as fotos estão em `img/` (21 JPEGs do Unsplash usados pelas páginas do template, ~1,9 MB).
- Texto em pt-BR; os 13 produtos, categorias e preços seguem o template (em reais), traduzidos. Os dados dos produtos ficam no estado `produtos` da página, filtrados por expressão.
- A auditoria de contraste (AA) passa nos dois modos; por isso o terracota e o cinza do texto suave são um pouco mais escuros que os do template.

## A sacola (estado persistente)
O botão "Adicionar à sacola" dos cartões grava `{id, qtd}` no estado `sacola`, que **persiste no navegador** (`persiste: true`, `docs/paginas.md`): o contador do cabeçalho e a página `/sacola` leem o mesmo valor em qualquer página. A sacola mostra foto, quantidade (− e +), remover e o subtotal em dinheiro exato (`qsoma`/`qmul`); o preço vem do catálogo da página, não do que foi guardado. Não há frete nem pagamento: o fechamento do pedido ainda não existe.

## Primitivas de layout criadas para o porte
`layout/contido` (largura máxima centrada), `texto/sobretitulo`, imagem `fluida` com `proporcao`, `alinha` na grade, `centro` no cabeçalho e a escala tipográfica do tema (`tamanhoH1..H3`, `familiaTitulo`, `layout.largura*`). Estão descritas em `docs/blocos-base.md`; nenhum tema existente muda.

## O que ainda não está igual ao template
O cabeçalho do template é translúcido (desfoque) e a fonte Cormorant Garamond não é carregada (CSP): os títulos usam a serifa do sistema. Detalhe do produto, checkout (frete e pagamento) e ordenação da loja ainda não foram portados; o checkout pede o serviço `carrinho`/`pedidos` no cliente.
