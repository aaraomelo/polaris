import type { Registry } from '@polaris/schema'

// ---------------------------------------------------------------------------------------------------------------------------------------------
// Pack Commerce: CONTRATOS de dados (kind `servico`) + blocos de exibição (kind `bloco`, 100% declarativos: `modelo` sobre os blocos base).
//
// Os contratos descrevem o que o front espera dos serviços de catálogo, carrinho e pedidos (E4/E5 os implementam e o gerador emite o OpenAPI);
// os blocos só dependem da FORMA dos dados, não de quem os serve. Origem dos campos: o modelo do tiffany-erp (Product, ProductVariant, Order, OrderItem).
//
// Convenções:
//  - dinheiro é TEXTO decimal exato ("49.90"), nunca float; os blocos formatam com `qbrl` (também aceita número);
//  - o modelo de um bloco não tem estado nem eventos: os blocos EXIBEM e deixam um slot `acoes` para a página pôr botões/campos com os eventos
//    dela (o conteúdo do slot é montado no escopo da página, então enxerga `estado`, `dados` e a variável do `repetir`).
// ---------------------------------------------------------------------------------------------------------------------------------------------

type Inst = { bloco: string; id?: string; props?: Record<string, unknown>; slots?: Record<string, Inst[]>; se?: string; repetir?: { cada: string; como: string; chave?: string } }
const no = (kind: string, id: string, spec: object) => ({ kind, id, versao: '1.0.0', estatuto: 'publicado', spec })

const slotAcoes: Inst = { bloco: 'core/slot', props: { nome: 'acoes' } }
const par = (texto: string, extra: Partial<Inst> = {}): Inst => ({ bloco: 'texto/paragrafo', props: { texto }, ...extra })
const td = (texto: string, props: Record<string, unknown> = {}): Inst => ({ bloco: 'tabela/celula', props: { texto, ...props } })
const linha = (cel: Inst[], extra: Partial<Inst> = {}): Inst => ({ bloco: 'tabela/linha', slots: { filhos: cel }, ...extra })

// ---- contratos de dados -----------------------------------------------------------------------------------------------------------------------

export const SERVICOS = [
  no('servico', 'catalogo', {
    entidades: {
      produto: { campos: {
        id: { tipo: 'uuid', obrigatorio: true }, sku: { tipo: 'texto', obrigatorio: true }, gtin: { tipo: 'texto' },
        nome: { tipo: 'texto', obrigatorio: true }, descricao: { tipo: 'texto' },
        preco: { tipo: 'dinheiro', obrigatorio: true, descricao: 'preço de venda atual (texto decimal exato)' },
        precoDe: { tipo: 'dinheiro', descricao: 'preço anterior; quando maior que `preco`, a vitrine mostra "de … por …"' },
        fotoUrl: { tipo: 'texto' }, disponivel: { tipo: 'booleano', obrigatorio: true, descricao: 'vendável e com estoque' },
        possuiVariantes: { tipo: 'booleano', padrao: false },
      }, indices: [['sku']] },
      variante: { campos: {
        id: { tipo: 'uuid', obrigatorio: true }, produtoId: { tipo: 'uuid', obrigatorio: true }, sku: { tipo: 'texto', obrigatorio: true },
        opcoes: { tipo: 'texto', lista: true, descricao: 'valores das opções na ordem (cor, tamanho…)' },
        preco: { tipo: 'dinheiro', descricao: 'ausente = herda do produto' }, fotoUrl: { tipo: 'texto' }, disponivel: { tipo: 'booleano', obrigatorio: true },
      } },
    },
    operacoes: {
      listarProdutos: { metodo: 'GET', caminho: '/produtos', entrada: { busca: { tipo: 'texto' }, pagina: { tipo: 'inteiro', padrao: 1 }, limite: { tipo: 'inteiro', padrao: 24 } }, saida: 'produto', lista: true, permissao: 'publica' },
      obterProduto: { metodo: 'GET', caminho: '/produtos/:id', entrada: { id: { tipo: 'uuid', obrigatorio: true } }, saida: 'produto', permissao: 'publica' },
      listarVariantes: { metodo: 'GET', caminho: '/produtos/:id/variantes', entrada: { id: { tipo: 'uuid', obrigatorio: true } }, saida: 'variante', lista: true, permissao: 'publica' },
    },
  }),
  no('servico', 'carrinho', {
    entidades: {
      itemCarrinho: { campos: {
        id: { tipo: 'uuid', obrigatorio: true }, produtoId: { tipo: 'uuid', obrigatorio: true }, varianteId: { tipo: 'uuid' },
        nome: { tipo: 'texto', obrigatorio: true }, quantidade: { tipo: 'inteiro', obrigatorio: true },
        precoUnitario: { tipo: 'dinheiro', obrigatorio: true }, total: { tipo: 'dinheiro', obrigatorio: true },
      } },
      carrinho: { campos: {
        id: { tipo: 'uuid', obrigatorio: true }, itens: { tipo: 'json', lista: true, descricao: 'lista de `itemCarrinho`' },
        subtotal: { tipo: 'dinheiro', obrigatorio: true }, desconto: { tipo: 'dinheiro', padrao: '0' }, frete: { tipo: 'dinheiro', padrao: '0' }, total: { tipo: 'dinheiro', obrigatorio: true },
      } },
    },
    operacoes: {
      obterCarrinho: { metodo: 'GET', caminho: '/carrinho', saida: 'carrinho', permissao: 'publica' },
      adicionarItem: { metodo: 'POST', caminho: '/carrinho/itens', entrada: { produtoId: { tipo: 'uuid', obrigatorio: true }, varianteId: { tipo: 'uuid' }, quantidade: { tipo: 'inteiro', padrao: 1 } }, saida: 'carrinho', permissao: 'publica', publica: ['carrinho.alterado'] },
      alterarQuantidade: { metodo: 'PATCH', caminho: '/carrinho/itens/:id', entrada: { id: { tipo: 'uuid', obrigatorio: true }, quantidade: { tipo: 'inteiro', obrigatorio: true } }, saida: 'carrinho', permissao: 'publica', publica: ['carrinho.alterado'] },
      removerItem: { metodo: 'DELETE', caminho: '/carrinho/itens/:id', entrada: { id: { tipo: 'uuid', obrigatorio: true } }, saida: 'carrinho', permissao: 'publica', publica: ['carrinho.alterado'] },
    },
  }),
  no('servico', 'pedidos', {
    entidades: {
      pedido: { campos: {
        id: { tipo: 'uuid', obrigatorio: true }, numero: { tipo: 'inteiro', obrigatorio: true }, situacao: { tipo: 'texto', obrigatorio: true, descricao: 'rascunho | aguardandoPagamento | pago | cancelado' },
        subtotal: { tipo: 'dinheiro', obrigatorio: true }, desconto: { tipo: 'dinheiro', padrao: '0' }, frete: { tipo: 'dinheiro', padrao: '0' }, total: { tipo: 'dinheiro', obrigatorio: true },
        criadoEm: { tipo: 'dataHora', obrigatorio: true },
      } },
      pagamentoPix: { campos: { pedidoId: { tipo: 'uuid', obrigatorio: true }, valor: { tipo: 'dinheiro', obrigatorio: true }, copiaECola: { tipo: 'texto', obrigatorio: true }, expiraEm: { tipo: 'dataHora', obrigatorio: true } } },
    },
    operacoes: {
      criarPedido: { metodo: 'POST', caminho: '/pedidos', entrada: { carrinhoId: { tipo: 'uuid', obrigatorio: true }, observacoes: { tipo: 'texto' } }, saida: 'pedido', permissao: 'cliente', publica: ['pedido.criado'] },
      obterPedido: { metodo: 'GET', caminho: '/pedidos/:id', entrada: { id: { tipo: 'uuid', obrigatorio: true } }, saida: 'pedido', permissao: 'cliente' },
      criarPagamentoPix: { metodo: 'POST', caminho: '/pedidos/:id/pix', entrada: { id: { tipo: 'uuid', obrigatorio: true } }, saida: 'pagamentoPix', permissao: 'cliente', publica: ['pagamento.criado'] },
    },
    consome: ['pagamento.confirmado'],
  }),
]

// ---- eventos (contratos do que os serviços publicam e consomem) -------------------------------------------------------------------------------
// O id do nó é o nome do evento. `idempotencia` é o campo que identifica o FATO: publicar o mesmo fato duas vezes gera um evento só.
export const EVENTOS = [
  no('evento', 'carrinho.alterado', { nome: 'carrinho.alterado', produtor: 'carrinho', payload: { carrinhoId: { tipo: 'uuid', obrigatorio: true }, itens: { tipo: 'inteiro', obrigatorio: true }, total: { tipo: 'dinheiro', obrigatorio: true } } }),
  no('evento', 'pedido.criado', { nome: 'pedido.criado', produtor: 'pedidos', payload: { pedidoId: { tipo: 'uuid', obrigatorio: true }, numero: { tipo: 'inteiro', obrigatorio: true }, total: { tipo: 'dinheiro', obrigatorio: true } }, idempotencia: 'pedidoId' }),
  no('evento', 'pagamento.criado', { nome: 'pagamento.criado', produtor: 'pedidos', payload: { pedidoId: { tipo: 'uuid', obrigatorio: true }, valor: { tipo: 'dinheiro', obrigatorio: true } }, idempotencia: 'pedidoId' }),
  no('evento', 'pagamento.confirmado', { nome: 'pagamento.confirmado', produtor: 'pagamentos', payload: { pedidoId: { tipo: 'uuid', obrigatorio: true }, valor: { tipo: 'dinheiro', obrigatorio: true }, confirmadoEm: { tipo: 'dataHora', obrigatorio: true } }, idempotencia: 'pedidoId' }),
]

// ---- blocos de exibição ---------------------------------------------------------------------------------------------------------------------

const produtoProp = { type: 'object', properties: { id: { type: 'string' }, nome: { type: 'string' }, descricao: { type: 'string' }, preco: { type: ['string', 'number'] }, precoDe: { type: ['string', 'number'] }, fotoUrl: { type: 'string' }, disponivel: { type: 'boolean' } }, required: ['nome', 'preco'] }
const dinheiro = { type: ['string', 'number'], description: 'valor em reais: texto decimal exato ("49.90") ou número' }
const PRODUTO_EX = { id: 'p1', nome: 'Pão de queijo 500 g', descricao: 'Receita tradicional mineira, congelado.', preco: '24.90', precoDe: '29.90', fotoUrl: 'exemplos/produto.svg', disponivel: true }
const ESGOTADO_EX = { ...PRODUTO_EX, id: 'p2', nome: 'Bolo de fubá', preco: '18.00', precoDe: undefined, disponivel: false }
const ITENS_EX = [{ id: 'i1', nome: 'Pão de queijo 500 g', quantidade: 2, precoUnitario: '24.90', total: '49.80' }, { id: 'i2', nome: 'Café 250 g', quantidade: 1, precoUnitario: '18.50', total: '18.50' }]

const instancia = (bloco: string, props: Record<string, unknown>, slots?: Record<string, Inst[]>) => ({ bloco, props, ...(slots ? { slots } : {}) })

export const BLOCOS_COMMERCE = [
  no('bloco', 'commerce.preco', {
    interface: 'commerce/preco', titulo: 'Preço', descricao: 'Preço em reais, com o preço anterior riscado de forma semântica ("de …") quando informado. Aceita texto decimal exato ou número.',
    props: { type: 'object', properties: { valor: dinheiro, de: dinheiro }, required: ['valor'] },
    exemplos: [{ titulo: 'Simples', instancia: instancia('commerce/preco', { valor: '49.90' }) }, { titulo: 'Com preço anterior', instancia: instancia('commerce/preco', { valor: '49.90', de: '59.90' }) }],
    modelo: { bloco: 'layout/linha', props: { gap: 8, alinha: 'centro' }, slots: { filhos: [
      { bloco: 'texto/destaque', props: { texto: '{qbrl(props.valor)}' } },
      { bloco: 'texto/pequeno', se: 'props.de', props: { texto: 'de {qbrl(props.de)}' } },
    ] } },
  }),
  no('bloco', 'commerce.cartao-produto', {
    interface: 'commerce/cartao-produto', titulo: 'Cartão de produto', descricao: 'Foto, nome e preço de um produto. `href` (opcional) liga ao detalhe. O slot `acoes` recebe botões da página (ex.: "Adicionar").',
    props: { type: 'object', properties: { produto: produtoProp, href: { type: 'string' } }, required: ['produto'] }, slots: { acoes: {} },
    exemplos: [
      { titulo: 'Com ação', instancia: instancia('commerce/cartao-produto', { produto: PRODUTO_EX, href: '/produto/p1' }, { acoes: [{ bloco: 'nav/botao', props: { texto: 'Adicionar' } }] }) },
      { titulo: 'Esgotado', instancia: instancia('commerce/cartao-produto', { produto: ESGOTADO_EX }) },
    ],
    modelo: { bloco: 'layout/pilha', props: { gap: 8 }, slots: { filhos: [
      { bloco: 'midia/imagem', se: 'props.produto.fotoUrl', props: { src: '{props.produto.fotoUrl}', alt: '{props.produto.nome}', largura: 240 } },
      { bloco: 'texto/titulo', props: { texto: '{props.produto.nome}', nivel: 3 } },
      { bloco: 'commerce/preco', props: { valor: '{props.produto.preco}', de: '{props.produto.precoDe}' } },
      { bloco: 'feedback/selo', se: 'props.produto.disponivel == false', props: { texto: 'Indisponível', tom: 'erro' } },
      { bloco: 'nav/link', se: 'props.href', props: { href: '{props.href}', texto: 'Ver detalhes' } },
      slotAcoes,
    ] } },
  }),
  no('bloco', 'commerce.vitrine', {
    interface: 'commerce/vitrine', titulo: 'Vitrine', descricao: 'Grade de cartões de produto a partir de uma lista (`produtos`, do contrato `catalogo.listarProdutos`). `hrefBase` + id forma o link de cada cartão. Sem produtos, mostra a mensagem de vazio. Para ações em cada cartão, componha `layout/grade` + `repetir` na página.',
    props: { type: 'object', properties: { produtos: { type: 'array', items: produtoProp }, colunas: { type: 'integer', minimum: 1, maximum: 6, default: 3 }, hrefBase: { type: 'string', description: 'ex.: "/produto/"' } }, required: ['produtos'] },
    exemplos: [
      { titulo: 'Três produtos', instancia: instancia('commerce/vitrine', { produtos: [PRODUTO_EX, ESGOTADO_EX, { ...PRODUTO_EX, id: 'p3', nome: 'Café 250 g', preco: '18.50', precoDe: undefined }], colunas: 3, hrefBase: '/produto/' }) },
      { titulo: 'Vazia', instancia: instancia('commerce/vitrine', { produtos: [] }) },
    ],
    modelo: { bloco: 'layout/pilha', props: { gap: 8 }, slots: { filhos: [
      par('Nenhum produto encontrado.', { se: '!props.produtos' }),
      { bloco: 'layout/grade', se: 'props.produtos', props: { colunas: '{props.colunas ? props.colunas : 3}', gap: 16 }, slots: { filhos: [
        { bloco: 'commerce/cartao-produto', repetir: { cada: 'props.produtos', como: 'p', chave: 'p.id' }, props: { produto: '{p}', href: '{props.hrefBase ? props.hrefBase + p.id : ""}' } },
      ] } },
    ] } },
  }),
  no('bloco', 'commerce.detalhe-produto', {
    interface: 'commerce/detalhe-produto', titulo: 'Detalhe do produto', descricao: 'Página de produto (PDP): foto ao lado do nome, preço, descrição e disponibilidade. O slot `acoes` recebe quantidade e "Adicionar ao carrinho".',
    props: { type: 'object', properties: { produto: produtoProp }, required: ['produto'] }, slots: { acoes: {} },
    exemplos: [{ titulo: 'Com ações', instancia: instancia('commerce/detalhe-produto', { produto: PRODUTO_EX }, { acoes: [{ bloco: 'entrada/numero', props: { valor: 1, min: 1 } }, { bloco: 'nav/botao', props: { texto: 'Adicionar ao carrinho' } }] }) }],
    modelo: { bloco: 'layout/grade', props: { colunas: 2, gap: 24 }, slots: { filhos: [
      { bloco: 'midia/imagem', se: 'props.produto.fotoUrl', props: { src: '{props.produto.fotoUrl}', alt: '{props.produto.nome}' } },
      { bloco: 'layout/pilha', props: { gap: 12 }, slots: { filhos: [
        { bloco: 'texto/titulo', props: { texto: '{props.produto.nome}', nivel: 1 } },
        { bloco: 'commerce/preco', props: { valor: '{props.produto.preco}', de: '{props.produto.precoDe}' } },
        par('{props.produto.descricao}', { se: 'props.produto.descricao' }),
        { bloco: 'feedback/selo', se: 'props.produto.disponivel', props: { texto: 'Em estoque', tom: 'sucesso' } },
        { bloco: 'feedback/selo', se: 'props.produto.disponivel == false', props: { texto: 'Indisponível', tom: 'erro' } },
        slotAcoes,
      ] } },
    ] } },
  }),
  no('bloco', 'commerce.resumo-pedido', {
    interface: 'commerce/resumo-pedido', titulo: 'Resumo do pedido', descricao: 'Subtotal, desconto, frete e total (mesma forma de `carrinho` e `pedido` dos contratos). Desconto e frete só aparecem se forem diferentes de zero.',
    props: { type: 'object', properties: { subtotal: dinheiro, desconto: dinheiro, frete: dinheiro, total: dinheiro }, required: ['subtotal', 'total'] },
    exemplos: [{ titulo: 'Com frete e desconto', instancia: instancia('commerce/resumo-pedido', { subtotal: '68.30', desconto: '5.00', frete: '12.00', total: '75.30' }) }],
    modelo: { bloco: 'tabela/tabela', slots: { filhos: [{ bloco: 'tabela/corpo', slots: { filhos: [
      linha([td('Subtotal'), td('{qbrl(props.subtotal)}')]),
      linha([td('Desconto'), td('-{qbrl(props.desconto)}')], { se: 'props.desconto && qcmp(props.desconto, "0") > 0' }),
      linha([td('Frete'), td('{qbrl(props.frete)}')], { se: 'props.frete && qcmp(props.frete, "0") > 0' }),
      linha([td('Total', { cabecalho: true }), td('{qbrl(props.total)}', { cabecalho: true })]),
    ] } }] } },
  }),
  no('bloco', 'commerce.carrinho', {
    interface: 'commerce/carrinho', titulo: 'Carrinho', descricao: 'Itens do carrinho (do contrato `carrinho.obterCarrinho`) e o resumo. Vazio mostra a mensagem. O slot `acoes` recebe "Finalizar compra".',
    props: { type: 'object', properties: { itens: { type: 'array', items: { type: 'object', properties: { id: { type: 'string' }, nome: { type: 'string' }, quantidade: { type: 'integer' }, precoUnitario: dinheiro, total: dinheiro }, required: ['id', 'nome', 'quantidade', 'precoUnitario', 'total'] } }, subtotal: dinheiro, desconto: dinheiro, frete: dinheiro, total: dinheiro }, required: ['itens'] }, slots: { acoes: {} },
    exemplos: [
      { titulo: 'Com itens', instancia: instancia('commerce/carrinho', { itens: ITENS_EX, subtotal: '68.30', frete: '12.00', total: '80.30' }, { acoes: [{ bloco: 'nav/botao', props: { texto: 'Finalizar compra' } }] }) },
      { titulo: 'Vazio', instancia: instancia('commerce/carrinho', { itens: [] }) },
    ],
    modelo: { bloco: 'layout/pilha', props: { gap: 16 }, slots: { filhos: [
      par('Seu carrinho está vazio.', { se: '!props.itens' }),
      { bloco: 'tabela/tabela', se: 'props.itens', slots: { filhos: [
        { bloco: 'tabela/cabecalho', slots: { filhos: [linha([td('Produto', { cabecalho: true }), td('Qtd', { cabecalho: true }), td('Preço', { cabecalho: true }), td('Total', { cabecalho: true })])] } },
        { bloco: 'tabela/corpo', slots: { filhos: [linha([td('{item.nome}'), td('{item.quantidade}'), td('{qbrl(item.precoUnitario)}'), td('{qbrl(item.total)}')], { repetir: { cada: 'props.itens', como: 'item', chave: 'item.id' } })] } },
      ] } },
      { bloco: 'commerce/resumo-pedido', se: 'props.itens', props: { subtotal: '{props.subtotal}', desconto: '{props.desconto}', frete: '{props.frete}', total: '{props.total}' } },
      slotAcoes,
    ] } },
  }),
]

/** Registra os eventos, os contratos (`servico`) e os blocos de exibição do pack Commerce no core. */
export function registraCommerce(reg: Registry): void {
  for (const n of [...EVENTOS, ...SERVICOS, ...BLOCOS_COMMERCE]) reg.registra(structuredClone(n) as never)
}
