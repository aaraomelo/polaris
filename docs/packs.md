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

---

## Pagamentos e Caixa (`pagamentos`)
Serviço próprio (banco próprio): provedor plugável, ciclo `autorizar → capturar → cancelar | estornar`, **carteira com razão** e **caixa**. Vendas o usa pela porta `portaPagamento(cliente)` (HTTP em produção).

### Provedor
`Provedor { autoriza, captura, cancela, estorna }`, registrado por nome em `criaPagamentos(no, { provedores })`; o tenant liga **método → provedor + taxa %** em `configPagamento` (`pix`, `credito`, `debito`, `dinheiro`, `vale`). O pack não conhece PagBank, Mercado Pago etc.: cada um é um adaptador. `provedorInterno` aprova na hora (dinheiro, vale). **Contrato**: toda chamada leva `pagamentoId` como chave de idempotência.

### Regras (todas testadas)
- **Idempotente por pedido**: repetir `autorizar` devolve o mesmo pagamento (1 chamada ao provedor); outro método/valor para o mesmo pedido é 409. Capturar/cancelar repetidos são no-op.
- **Recusa é resultado, não erro**: o provedor recusou → `200` com `status: falhou` e `motivoFalha`, gravado; a repetição **não recobra**. Provedor **fora do ar** → `502`, a transação desfaz e nada fica gravado (repetir é seguro).
- **Taxa e líquido exatos** (`percentual`, 4 casas). A carteira recebe o **líquido** na captura (dinheiro não passa pela carteira: vai para a gaveta).
- **Estorno** parcial/total com `chaveIdempotencia`; não excede o que resta; a carteira devolve a fatia proporcional do líquido e o **último estorno devolve o restante** (provado com 3,33 + 3,33 + 3,34: nenhum resto de arredondamento). A taxa do provedor não volta.
- **Razão da carteira**: saldo muda por `UPDATE` atômico (a linha serializa concorrentes); cada movimento grava um `lancamento` com `saldoApos`.
- **Caixa**: uma sessão aberta por caixa; dinheiro exige sessão; `esperado = abertura + vendas em dinheiro − estornos em dinheiro + reforços − sangrias`; fechar grava `esperado`, `contado` e `diferenca` (negativa = falta); sangria acima do que há na gaveta é 422; só quem abriu movimenta e fecha.
- **Papéis**: `sistema` (autoriza/captura/cancela, usado pela saga), `caixa` (operador de PDV), `financeiro` (estorna, configura, lê tudo). O sistema não estorna.

### Ligação com Vendas
`carrinho.metodoPagamento` e `parcelas` (escolha do cliente, copiados ao pedido) chegam à saga em `PedidoSaga`. O adaptador traduz: recusa/4xx → `ok:false` (a saga compensa); 5xx/rede → **lança** (a saga não compensa à toa e repete). Provado com os dois serviços em **bancos separados**.

### Limites conhecidos
- **PIX é síncrono aqui** (o provedor responde na hora). O PIX real confirma depois por webhook: exige um passo assíncrono na saga e um endpoint de confirmação — fica para uma entrega própria.
- Um pagamento por pedido (`unicos: [pedidoId]`); divisão de pagamento (parte em dinheiro, parte em cartão) não existe ainda.
- Sem repasse/`payout`, chargeback e conciliação do original; credenciais do provedor ficam fora do banco (variáveis/segredos do ambiente).
- A chamada ao provedor acontece dentro da transação do banco (com idempotência); com provedor lento isso segura uma conexão.
- Venda em dinheiro no PDV usa `autorizar`+`capturar` com `sessaoCaixaId`; não passa pela saga de Vendas (que cobre os métodos eletrônicos).

---

## Estoque e Depósitos (`estoque`)
Serviço próprio. Portado do `stock`/`warehouse` do erp-api, com as regras apertadas.

| Entidade | O que guarda |
|---|---|
| `deposito` | `codigo` único, `padrao` (onde as reservas da saga procuram), `ativo` |
| `saldo` | por `(itemId, depósito)`: `quantidade`, `reservado`, `custoMedio`, `minimo`/`maximo`. `itemId` = a variante, ou o produto se não há variante. **Só as operações movem o saldo** (API não cria nem grava quantidade; o gerente só edita mínimo/máximo) |
| `movimento` | razão **append-only** com `delta` (± sinal), `custoUnitario`, `chave` de idempotência, referência (`pedido`, `inventario`…) |
| `reserva` / `reservaItem` | reserva por pedido: `ativa`, `confirmada`, `liberada`, `recusada`, `divergente` |

### Operações e regras (testadas)
- `entrada` (custo médio **ponderado exato**, 4 casas), `saida` (`perda`, `devolucao_fornecedor`, `consumo`), `ajustar` (inventário: grava a diferença; recusa contagem abaixo do reservado), `transferir` (o custo viaja com a mercadoria). Todas **idempotentes pela `chave`**; a mesma chave com outro conteúdo é 409.
- **Nunca saldo negativo** e **o reservado não se vende**: saída/transferência acima do `disponível = quantidade − reservado` é 422.
- `reservar` é **idempotente por pedido**, **tudo ou nada** (se um item falta, a reserva é `recusada` com o motivo e nenhum item fica preso), soma itens repetidos, trava os saldos em **ordem fixa** e expira (`validadeMinutos`, padrão 30). `liberar` e `expirarReservas` (job) devolvem o reservado.
- **Baixa por evento**: o Estoque consome `pedido.confirmado` (inbox, efeito uma vez) e a reserva vira saída `venda` ao custo médio do momento. Se a reserva expirou antes da confirmação, baixa direta quando há estoque livre; senão (ou sem reserva) marca a reserva como `divergente`, **sem tocar o estoque**, para o time resolver.
- `abaixoDoMinimo` lista os saldos no limite. Papéis: `leitor` < `operador` < `gerente`; `sistema` (saga) só reserva/libera.
- **Invariante testado**: a soma dos deltas do razão é igual ao saldo, e o reservado é a soma das reservas ativas.

### Ligação com Vendas (`portaEstoque`)
Sem estoque = recusa (`ok:false`, a saga compensa e o pagamento nem é tentado); 5xx/rede = lança (a saga repete). Provado com **três serviços em três bancos** (Vendas, Pagamentos, Estoque): compra feliz, sem estoque, pagamento recusado liberando a reserva, dois pedidos disputando o último item (um confirma, o outro falha, nada negativo) e estoque fora do ar.

### Limites conhecidos
- **Um depósito padrão atende as reservas**; alocação entre depósitos (pegar do que tiver) não existe ainda.
- A **ordem de trava** (anti-deadlock) está implementada mas **não pode ser exercitada** no PGlite (uma conexão): o teste de mutação não a pega. Precisa de teste com Postgres real e concorrência.
- Lote/validade/série, endereçamento e inventário cíclico agendado não foram portados.
- A baixa depende do relay entregar `pedido.confirmado`; se o evento se perder, o pedido fica com reserva `ativa` até expirar (o job a libera, e a venda aparece como estoque que nunca baixou). Monitorar o atraso do outbox (métrica do relay).
- Quantidades chegam como número JSON (`decimal` da API); mais de 4 casas é recusado.

---

## Serviços (`servicos`): agenda, orçamento, ordem de serviço e garantia
Portado do `service-order`/`budget`/`warranty-term` do erp-api, **sem acoplar a veículos**: a OS atende um `objeto` (placa, serial, descrição), então serve a oficina, assistência técnica, salão ou qualquer serviço agendado.

| Entidade | Papel |
|---|---|
| `recurso`, `servicoOferecido`, `termoGarantia` | cadastros do tenant (profissional/sala; duração e preço; dias e texto da garantia) |
| `agendamento` | recurso + serviço + início; o **fim vem da duração do serviço** |
| `orcamento` / `itemOrcamento` | rascunho → enviado → aprovado/rejeitado/expirado → convertido |
| `ordemServico` / `itemOrdemServico` | aberta → em andamento ⇄ aguardando peça/cliente → concluída → entregue (ou cancelada) |
| `sequencia` | numeração `orcamento`/`os` por tenant, atômica (`ON CONFLICT … DO UPDATE`) |

### Regras (todas testadas)
- **Agenda sem conflito**: o recurso é **travado** (`FOR UPDATE`) e a sobreposição `inicio < fim' AND fim > inicio'` é recusada (409); encostar (fim = início) pode; cancelado e faltou liberam o horário; remarcar não conflita consigo mesmo; passado, recurso/serviço inativo ou data inválida são recusados. Duas requisições simultâneas pelo mesmo horário: só uma entra.
- **Totais exatos**: linha = `preço × quantidade − desconto` (desconto maior que a linha é 422); subtotal/total do orçamento e `totalPecas`/`totalServicos`/`total` da OS recalculados a cada mudança, nunca negativos.
- **Orçamento**: só se edita em rascunho; vazio não envia; só o enviado se decide; aprovar depois da validade é 422; o job `expirarOrcamentos` expira os vencidos; **converter aprovado em OS é idempotente** (a mesma OS, uma só) e copia itens, desconto e totais.
- **OS**: transições explícitas (inválida é 409, repetir é no-op); sem itens não conclui; cancelar exige motivo; item só enquanto a OS está aberta; **entregar fixa a garantia** (`garantiaAte = hoje + dias` do termo).
- **Papéis**: `tecnico` lê tudo mas só altera a OS em que é o `responsavelId` (as dos outros dão 404); `atendente` agenda, orça, abre e converte; `gerente` cadastra recursos, serviços e termos.

### Ligação com o Estoque
Concluir a OS publica `os.concluida` (mesma transação) com as peças agregadas que têm `produtoId`. O Estoque consome o evento e dá **baixa `consumo`** ao custo médio, tudo ou nada, no depósito padrão, idempotente (também sem o inbox). **Sem estoque suficiente a OS não volta atrás**: vira uma reserva `divergente` com o motivo, para o time resolver.

### Limites conhecidos
- Não há **horários livres** nem expediente do recurso: o cliente escolhe o início e a API só recusa conflito.
- Preço de peça e mão de obra são **digitados no balcão** (não vêm de cotação do Catálogo, como no varejo online).
- OS concluída não reabre (retrabalho = nova OS); concluir exige ao menos um item.
- Sem anexos/fotos, laudo, checklist, comissão do técnico nem cobrança da OS (a cobrança é pelo pack Pagamentos, ainda não ligada à OS).
