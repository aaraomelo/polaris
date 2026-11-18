// Documentação viva dos blocos base: título, descrição e exemplos moram no PRÓPRIO nó do bloco (spec.titulo/descricao/exemplos).
// O catálogo (src/catalogo) renderiza estes exemplos com o runtime real e lê props/slots/eventos do schema: nada é copiado à mão.

type Inst = { bloco: string; id?: string; props?: Record<string, unknown>; slots?: Record<string, Inst[]>; eventos?: Record<string, unknown> }
export type DocBloco = { titulo: string; descricao: string; exemplos: Array<{ titulo: string; descricao?: string; instancia: Inst }> }

const par = (texto: string): Inst => ({ bloco: 'texto/paragrafo', props: { texto } })
const cx = (...c: string[]): Inst[] => c.map(par)
const item = (...c: string[]): Inst => ({ bloco: 'lista/item', slots: { filhos: cx(...c) } })
const linha = (...cel: Inst[]): Inst => ({ bloco: 'tabela/linha', slots: { filhos: cel } })
const td = (texto: string, props: Record<string, unknown> = {}): Inst => ({ bloco: 'tabela/celula', props: { texto, ...props } })
const th = (texto: string): Inst => td(texto, { cabecalho: true })

export const DOCS_BASE: Record<string, DocBloco> = {
  'layout/pilha': { titulo: 'Pilha', descricao: 'Empilha os filhos na vertical (flex column). Base de quase toda página.', exemplos: [
    { titulo: 'Com espaçamento', instancia: { bloco: 'layout/pilha', props: { gap: 8 }, slots: { filhos: cx('Primeiro', 'Segundo', 'Terceiro') } } },
    { titulo: 'Centralizada', instancia: { bloco: 'layout/pilha', props: { gap: 4, alinha: 'centro' }, slots: { filhos: cx('Curto', 'Um texto bem mais comprido') } } },
  ] },
  'layout/linha': { titulo: 'Linha', descricao: 'Coloca os filhos lado a lado (flex row).', exemplos: [
    { titulo: 'Lado a lado', instancia: { bloco: 'layout/linha', props: { gap: 16, alinha: 'centro' }, slots: { filhos: cx('A', 'B', 'C') } } },
  ] },
  'layout/grade': { titulo: 'Grade', descricao: 'Distribui os filhos em colunas iguais (1 a 12). Padrão: 2 colunas.', exemplos: [
    { titulo: 'Três colunas', instancia: { bloco: 'layout/grade', props: { colunas: 3, gap: 12 }, slots: { filhos: cx('1', '2', '3', '4', '5') } } },
  ] },
  'layout/divisor': { titulo: 'Divisor', descricao: 'Linha horizontal que separa seções (usa a cor de borda do tema).', exemplos: [
    { titulo: 'Entre parágrafos', instancia: { bloco: 'layout/pilha', slots: { filhos: [par('Acima'), { bloco: 'layout/divisor' }, par('Abaixo')] } } },
  ] },
  'layout/espacador': { titulo: 'Espaçador', descricao: 'Espaço vertical em pixels (padrão 8). Não é lido por leitores de tela.', exemplos: [
    { titulo: '32 px', instancia: { bloco: 'layout/pilha', slots: { filhos: [par('Antes'), { bloco: 'layout/espacador', props: { tamanho: 32 } }, par('Depois')] } } },
  ] },
  'texto/titulo': { titulo: 'Título', descricao: 'Cabeçalho h1 a h6 conforme `nivel` (padrão 1).', exemplos: [
    { titulo: 'Nível 2', instancia: { bloco: 'texto/titulo', props: { texto: 'Mais vendidos', nivel: 2 } } },
  ] },
  'texto/paragrafo': { titulo: 'Parágrafo', descricao: 'Texto corrido. O conteúdo é sempre escapado (nunca HTML).', exemplos: [
    { titulo: 'Texto simples', instancia: par('Frete grátis acima de R$ 99.') },
    { titulo: 'Com marcação (aparece como texto)', instancia: par('<b>não vira negrito</b> & continua seguro') },
  ] },
  'texto/destaque': { titulo: 'Destaque', descricao: 'Trecho importante em negrito semântico (`strong`).', exemplos: [{ titulo: 'Preço', instancia: { bloco: 'texto/destaque', props: { texto: 'R$ 49,90' } } }] },
  'texto/pequeno': { titulo: 'Texto pequeno', descricao: 'Observações e notas de rodapé, em cor suave.', exemplos: [{ titulo: 'Nota', instancia: { bloco: 'texto/pequeno', props: { texto: 'Preço válido até domingo.' } } }] },
  'texto/codigo': { titulo: 'Código', descricao: 'Trecho de código ou identificador em fonte monoespaçada.', exemplos: [{ titulo: 'SKU', instancia: { bloco: 'texto/codigo', props: { texto: 'SKU-00123' } } }] },
  'texto/rotulo': { titulo: 'Rótulo', descricao: 'Rótulo de campo. `para` liga ao `id` do campo (clicar no rótulo foca o campo).', exemplos: [
    { titulo: 'Rótulo de um campo', instancia: { bloco: 'layout/pilha', props: { gap: 4 }, slots: { filhos: [{ bloco: 'texto/rotulo', props: { texto: 'Nome', para: 'nome' } }, { bloco: 'entrada/texto', id: 'nome', props: { placeholder: 'Seu nome' } }] } } },
  ] },
  'midia/imagem': { titulo: 'Imagem', descricao: 'Imagem carregada sob demanda. Só aceita URLs seguras (http, https ou relativas); outras somem.', exemplos: [
    { titulo: 'Com tamanho', instancia: { bloco: 'midia/imagem', props: { src: 'exemplos/produto.svg', alt: 'Foto do produto', largura: 120, altura: 80 } } },
  ] },
  'lista/lista': { titulo: 'Lista', descricao: 'Lista de itens; `ordenada` numera. Só aceita `lista/item`.', exemplos: [
    { titulo: 'Com marcadores', instancia: { bloco: 'lista/lista', slots: { filhos: [item('Pão'), item('Café'), item('Suco')] } } },
    { titulo: 'Numerada', instancia: { bloco: 'lista/lista', props: { ordenada: true }, slots: { filhos: [item('Separar'), item('Embalar'), item('Enviar')] } } },
  ] },
  'lista/item': { titulo: 'Item de lista', descricao: 'Um item de `lista/lista`; aceita qualquer bloco dentro.', exemplos: [
    { titulo: 'Dentro de uma lista', instancia: { bloco: 'lista/lista', slots: { filhos: [item('Um item')] } } },
  ] },
  'tabela/tabela': { titulo: 'Tabela', descricao: 'Tabela de dados. Estrutura obrigatória: `cabecalho` e/ou `corpo`, com `linha` e `celula`.', exemplos: [
    { titulo: 'Pedidos', instancia: { bloco: 'tabela/tabela', slots: { filhos: [
      { bloco: 'tabela/cabecalho', slots: { filhos: [linha(th('Item'), th('Qtd'))] } },
      { bloco: 'tabela/corpo', slots: { filhos: [linha(td('Pão'), td('3')), linha(td('Café'), td('1'))] } },
    ] } } },
  ] },
  'tabela/cabecalho': { titulo: 'Cabeçalho de tabela', descricao: 'Grupo `thead`: aceita só `tabela/linha`.', exemplos: [
    { titulo: 'Colunas', instancia: { bloco: 'tabela/tabela', slots: { filhos: [{ bloco: 'tabela/cabecalho', slots: { filhos: [linha(th('A'), th('B'))] } }] } } },
  ] },
  'tabela/corpo': { titulo: 'Corpo de tabela', descricao: 'Grupo `tbody`: aceita só `tabela/linha`.', exemplos: [
    { titulo: 'Linhas', instancia: { bloco: 'tabela/tabela', slots: { filhos: [{ bloco: 'tabela/corpo', slots: { filhos: [linha(td('1'), td('2')), linha(td('3'), td('4'))] } }] } } },
  ] },
  'tabela/linha': { titulo: 'Linha de tabela', descricao: 'Uma `tr`: aceita só `tabela/celula`.', exemplos: [
    { titulo: 'Uma linha', instancia: { bloco: 'tabela/tabela', slots: { filhos: [{ bloco: 'tabela/corpo', slots: { filhos: [linha(td('x'), td('y'), td('z'))] } }] } } },
  ] },
  'tabela/celula': { titulo: 'Célula de tabela', descricao: '`td` (ou `th` com `cabecalho`). Use `texto` para texto simples ou `filhos` para blocos; `colunas` e `linhas` mesclam.', exemplos: [
    { titulo: 'Mesclando colunas', instancia: { bloco: 'tabela/tabela', slots: { filhos: [{ bloco: 'tabela/corpo', slots: { filhos: [linha(td('Total', { colunas: 2 })), linha(td('a'), td('b'))] } }] } } },
  ] },
  'entrada/texto': { titulo: 'Campo de texto', descricao: 'Campo controlado pelo estado: `valor` vem do estado e `aoMudar` recebe o texto digitado (compatível com IME).', exemplos: [
    { titulo: 'Com placeholder', instancia: { bloco: 'entrada/texto', props: { valor: '', rotulo: 'Buscar produtos', placeholder: 'Buscar produtos' } } },
    { titulo: 'Desabilitado', instancia: { bloco: 'entrada/texto', props: { valor: 'somente leitura', rotulo: 'Campo somente leitura', desabilitado: true } } },
  ] },
  'entrada/numero': { titulo: 'Campo numérico', descricao: 'Campo `number` com `min`, `max` e `passo`. `aoMudar` recebe um número, ou `null` se o campo estiver vazio.', exemplos: [
    { titulo: 'Quantidade', instancia: { bloco: 'entrada/numero', props: { valor: 2, rotulo: 'Quantidade', min: 1, max: 10, passo: 1 } } },
  ] },
  'entrada/caixa': { titulo: 'Caixa de seleção', descricao: 'Checkbox controlado: `marcado` vem do estado e `aoMudar` recebe um booleano.', exemplos: [
    { titulo: 'Marcada', instancia: { bloco: 'entrada/caixa', props: { marcado: true, rotulo: 'Aceito os termos' } } },
    { titulo: 'Desabilitada', instancia: { bloco: 'entrada/caixa', props: { marcado: false, rotulo: 'Opção indisponível', desabilitado: true } } },
  ] },
  'entrada/area': { titulo: 'Área de texto', descricao: 'Texto de várias linhas, controlado pelo estado como o campo de texto: `valor` vem do estado e `aoMudar` recebe o texto inteiro.', exemplos: [
    { titulo: 'Comentário', instancia: { bloco: 'entrada/area', props: { valor: '', rotulo: 'Comentário', placeholder: 'Escreva aqui', linhas: 3 } } },
  ] },
  'midia/quadro': { titulo: 'Quadro', descricao: 'Exibe um documento HTML num iframe **sempre** isolado (`sandbox` vazio: sem scripts, sem formulários, sem navegação, origem opaca), e nenhuma prop altera isso. Serve para pré-visualizações.', exemplos: [
    { titulo: 'Documento simples', instancia: { bloco: 'midia/quadro', props: { titulo: 'Pré-visualização', html: '<!doctype html><p>Olá do quadro</p>', altura: 120 } } },
  ] },
  'form/formulario': { titulo: 'Formulário', descricao: 'Monta um formulário declarativo (`kind: formulario`) com máscaras, validação, mensagens e envio (`docs/formularios.md`). O servidor entrega só o ponto de montagem; o carregador do formulário (a "ilha") busca a definição e desenha os campos no navegador, validando com o mesmo motor do servidor. `aoEnviado` recebe `{ resultado, sucesso }` quando o serviço aceita; `aoErro`, `{ erros }`.', exemplos: [
    { titulo: 'Contato', instancia: { bloco: 'form/formulario', props: { formulario: 'contato' } } },
    { titulo: 'Edição com valores iniciais', instancia: { bloco: 'form/formulario', props: { formulario: 'contato', valores: { nome: 'Ana', email: 'ana@exemplo.com' }, idioma: 'pt-BR' } } },
  ] },
  'nav/botao': { titulo: 'Botão', descricao: 'Botão de ação. `aoClicar` executa a lista de ações declarada na instância.', exemplos: [
    { titulo: 'Padrão', instancia: { bloco: 'nav/botao', props: { texto: 'Comprar' } } },
    { titulo: 'Desabilitado', instancia: { bloco: 'nav/botao', props: { texto: 'Esgotado', desabilitado: true } } },
  ] },
  'layout/cabecalho': { titulo: 'Cabeçalho', descricao: 'Faixa do topo da página (`<header>`): ponto de referência para leitores de tela. `fixo` o mantém visível ao rolar.', exemplos: [
    { titulo: 'Com título e menu', instancia: { bloco: 'layout/cabecalho', slots: { filhos: [{ bloco: 'texto/destaque', props: { texto: 'Minha loja' } }, { bloco: 'nav/menu', slots: { filhos: [{ bloco: 'nav/link', props: { href: '/', texto: 'Início' } }] } }] } } },
  ] },
  'layout/destaque': { titulo: 'Destaque', descricao: 'Faixa de destaque (`<section>`): fundo da cor primária do tema (ou `suave`), ou uma `imagem` de fundo com véu escuro (`escurece`) para o texto ler. `alinha`: centro ou esquerda; `altura` mínima em px. O texto e os botões ficam nos filhos; a imagem precisa ser do próprio site (o CSP das páginas só carrega imagens da mesma origem).', exemplos: [
    { titulo: 'Fundo do tema', instancia: { bloco: 'layout/destaque', props: { altura: 200 }, slots: { filhos: [{ bloco: 'texto/titulo', props: { texto: 'Oferta da semana', nivel: 2 } }] } } },
    { titulo: 'Suave, à esquerda', instancia: { bloco: 'layout/destaque', props: { fundo: 'suave', alinha: 'esquerda', altura: 160 }, slots: { filhos: [{ bloco: 'texto/paragrafo', props: { texto: 'Entrega grátis acima de R$ 99' } }] } } },
  ] },
  'layout/rodape': { titulo: 'Rodapé', descricao: 'Faixa do fim da página (`<footer>`): ponto de referência para leitores de tela, com informações do site (contato, links, aviso legal).', exemplos: [
    { titulo: 'Com aviso', instancia: { bloco: 'layout/rodape', slots: { filhos: [{ bloco: 'texto/pequeno', props: { texto: '© 2026 Minha loja' } }] } } },
  ] },
  'nav/menu': { titulo: 'Menu', descricao: 'Grupo de links de navegação (`<nav>`), com nome acessível em `rotulo` (padrão "Principal"). Use `atual` no link da página aberta.', exemplos: [
    { titulo: 'Dois links', instancia: { bloco: 'nav/menu', slots: { filhos: [{ bloco: 'nav/link', props: { href: '/', texto: 'Início', atual: true } }, { bloco: 'nav/link', props: { href: '/sobre', texto: 'Sobre' } }] } } },
  ] },
  'nav/link': { titulo: 'Link', descricao: 'Link para uma URL segura (javascript:, data: e similares são recusados). Links externos levam `rel="noopener noreferrer"`.', exemplos: [
    { titulo: 'Externo', instancia: { bloco: 'nav/link', props: { href: 'https://exemplo.com', texto: 'Site do fabricante' } } },
    { titulo: 'Como botão', instancia: { bloco: 'nav/link', props: { href: '/produtos', texto: 'Ver produtos', botao: 'primario' } } },
    { titulo: 'Com blocos dentro', instancia: { bloco: 'nav/link', props: { href: '/carrinho' }, slots: { filhos: [{ bloco: 'texto/destaque', props: { texto: 'Ver carrinho' } }] } } },
  ] },
  'computacao/canvas-gl': { titulo: 'Canvas de kernel', descricao: 'Pinta, num canvas, o resultado de um kernel de computação (saídas r, g, b e opcional a, de 0 a 1; `x` e `y` pela `larguraDe`). Usa WebGL2 e cai para wasm e depois para o interpretador; sem JavaScript fica o texto alternativo. O artefato do kernel é servido em /kernels/<id>.json e o carregador é `@polaris/computacao/cliente`.', exemplos: [
    { titulo: 'Gradiente', instancia: { bloco: 'computacao/canvas-gl', props: { kernel: 'gradiente', largura: 64, altura: 64, alt: 'Gradiente vermelho e verde', entradas: { w: 64 } } } },
  ] },
  'feedback/selo': { titulo: 'Selo', descricao: 'Etiqueta curta de estado. `tom`: neutro, sucesso, alerta ou erro (a cor vem do tema, e o contraste é auditado).', exemplos: [
    { titulo: 'Sucesso', instancia: { bloco: 'feedback/selo', props: { texto: 'Pago', tom: 'sucesso' } } },
    { titulo: 'Erro', instancia: { bloco: 'feedback/selo', props: { texto: 'Recusado', tom: 'erro' } } },
  ] },
  'feedback/alerta': { titulo: 'Alerta', descricao: 'Mensagem em destaque (`role="alert"`: leitores de tela anunciam). `tom` define a cor da borda.', exemplos: [
    { titulo: 'Aviso', instancia: { bloco: 'feedback/alerta', props: { tom: 'alerta' }, slots: { filhos: cx('Estoque baixo: restam 3 unidades.') } } },
  ] },
}
