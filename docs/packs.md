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

---

## Vendas (`vendas`): carrinho, checkout e pedidos
Carrinho → pedido → **saga** (estoque → autorização → captura) com compensação. Estoque e Pagamentos entram por **portas** (interfaces) e são implementados pelos packs 348/349; o pack Vendas não os conhece.

| Entidade | Papel |
|---|---|
| `carrinho` / `itemCarrinho` | `status` só o servidor muda (o papel não deixa o cliente informá-lo); itens nascem **só** por `POST /carrinhos/:id/itens` |
| `pedido` / `itemPedido` | nascem **só** por `finalizar`; `chaveIdempotencia` única por tenant |
| `passoSaga` | trilha auditável: `ok`, `falhou`, `compensado` por passo |

### Regras (todas testadas)
- **O preço nunca vem do cliente.** Item = `cotacaoId` do Catálogo; a porta `catalogo.cotacao(ctx, id)` devolve a cotação **do tenant do chamador** (a de outro tenant não existe). Campo de preço no corpo é 400. Cotação com mais de 30 min (`validadeCotacaoMs`) é 422 `cotacao_expirada`. A mesma cotação duas vezes no carrinho é 409.
- **`finalizar` é idempotente** (`chaveIdempotencia`, 8–120 caracteres): repetir devolve o **mesmo** pedido, sem segundo pedido nem segundo evento; a chave de outro carrinho é 409. Cria pedido + itens, fecha o carrinho e grava `pedido.criado` no outbox **na mesma transação**.
- **Total exato**: soma de `preço × quantidade` em bigint, 4 casas, meio-para-cima.
- **Escopo por usuário**: o operador só enxerga o que criou (`$usuario`), e o que não é dele dá **404** (não revela existência). O gerente enxerga tudo e é o único que `processa`.

### A saga (`processaPedido`)
Disparada por `pedido.criado` (relay → barramento → consumidor com inbox) ou por `POST /pedidos/:id/processar` (gerente). Corre numa **transação do tenant** com `SELECT … FOR UPDATE` no pedido.
- passo recusado (`ok: false`) → **compensa em ordem inversa** o que deu certo (libera estoque, cancela autorização), pedido `falhou` com motivo, evento `pedido.falhou`;
- porta que **lança** (rede, timeout) não é recusa: a transação desfaz tudo, nada fica pela metade, e a entrega repetida tenta de novo;
- retomável: passos já `ok` não se repetem; pedido `confirmado`/`falhou`/`cancelado` não reprocessa (no-op);
- **contrato das portas**: todo efeito externo PRECISA ser idempotente por `pedidoId` (a saga pode repetir um passo após uma queda).

### Limites conhecidos
- `cancelar` só vale antes do processamento (`criado`/`falhou`); estornar pedido pago é do pack Pagamentos.
- As portas de Estoque e Pagamento ainda não têm implementação real (cards 348/349); o runner de dev não sobe o pack Vendas até lá.
- Cancelar durante a saga em andamento depende do `FOR UPDATE`; em PGlite (1 conexão) a concorrência real não é exercitada.
- A porta do Catálogo, em produção, é uma chamada HTTP ao serviço Catálogo; o teste usa as cotações reais da API, guardadas por tenant, porque o PGlite não permite duas transações ao mesmo tempo.

### Defeito achado e corrigido pelo teste de integração
`cotar` (Catálogo) devolvia a linha crua do banco e `null` saía como `""` (`varianteId: ""`). As operações dos packs agora passam por `linhaParaApi`, o mesmo caminho do CRUD.
