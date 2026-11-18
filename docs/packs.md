# Packs de domínio

Um **pack** é um conjunto de nós (`servico`, `papel`, `evento`…) mais, quando precisa, a lógica de operações que o schema não expressa. Mora em `packages/packs/nos/<pack>/*.json` e é carregado com `nosDoPack('<pack>')`; as operações vêm de `operacoes<Pack>(no)`. Como todo nó, o tenant pode estendê-lo ou sobrescrevê-lo pela cascata (tenant → segmento → core).

## Catálogo (`catalogo`)
Portado do `product`/`catalog` do erp-api do tiffany, **simplificado de propósito**: a hierarquia fixa Divisão>Seção>Grupo>Subgrupo virou uma `categoria` em árvore (`paiId`), sem limite de níveis.

| Entidade | O que guarda |
|---|---|
| `marca`, `unidade` | únicas por tenant (`nome`, `codigo`); `unidade.fracionada` |
| `categoria` | árvore por `paiId` (FK composta a si mesma) |
| `produto` | `sku` único, `gtin`, `preco`/`custo` (dinheiro exato), `ativo`, `vendavel`, `controlaEstoque`, `temVariantes` |
| `variante` | `sku` único, `opcao0..2` (cor, tamanho…), `preco`/`custo` **ausentes herdam do produto** |
| `imagem` | `(produtoId, url)` único, `posicao` |
| `tabelaPreco` / `itemTabelaPreco` | vigência (`iniciaEm`/`terminaEm`), `ativo`, `qtdMinima`; item por produto ou por variante |
| `cotacao` | preço **calculado e gravado** (somente leitura por API) |

### Regra de preço (`resolvePreco`, pura)
1. base = preço da variante, ou o do produto se a variante não tem preço;
2. entre as tabelas ativas, vigentes hoje e com `qtdMinima ≤ quantidade`, vence: item da variante > item do produto; maior `qtdMinima`; **menor preço**; menor id (desempate estável, independe da ordem);
3. tabela aplicável **substitui** a base (inclusive se mais cara: a tabela é a decisão).

### `POST /cotar`
Calcula e **grava** uma `cotacao` (o checkout referencia o preço combinado, sem recalcular). Recusa: produto inexistente (404), inativo/não vendável (422), produto com variantes sem informar a variante (422), quantidade ≤ 0 (400).

### Papéis
`catalogo.leitor` (listar/obter) ← `catalogo.vendedor` (+ cotar) ← `catalogo.gerente` (+ criar/atualizar/remover). Tenants podem redefinir qualquer um.

## Mudança no schema que veio com o pack
`entidade.unicos: [[campo, …]]` — chave única **por tenant** (índice `UNIQUE (tenant_id, …)`), emitida em `emite(…,'sql')` e em `migraSql`; violação vira **409**. Provado no Postgres real (mesmo catálogo de índices migrando e criando do zero).

## Limites conhecidos
- A migração que acrescenta `unicos` a uma tabela com duplicados falha no Postgres (a migração é atômica, nada fica pela metade): limpe os dados antes.
- Sem exclusão lógica (`deletedAt`) nem busca vetorial (`embedding`) do original: entram quando houver necessidade real.
- Impostos/NCM do original não foram portados (escopo fiscal próprio).
