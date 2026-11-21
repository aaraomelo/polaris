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
  'layout/pilha': { titulo: 'Pilha', descricao: 'Empilha os filhos na vertical (flex column). Base de quase toda página. `recorta: true` corta o que passa da caixa (foto que cresce no hover); `marca` dá à caixa um gancho de estilo (`data-marca`) para o CSS do tema.', exemplos: [
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
  'texto/titulo': { titulo: 'Título', descricao: 'Cabeçalho h1 a h6 conforme `nivel` (padrão 1). `tamanho: "grande"` usa o tamanho maior de seção do tema. Sem `texto`, o título é montado com os filhos (`texto/trecho` e `texto/enfase`: a segunda linha em itálico, por exemplo).', exemplos: [
    { titulo: 'Com ênfase em itálico', instancia: { bloco: 'texto/titulo', props: { nivel: 1 }, slots: { filhos: [{ bloco: 'texto/trecho', props: { texto: 'Objetos de' } }, { bloco: 'texto/enfase', props: { texto: 'beleza serena', bloco: true } }] } } },
    { titulo: 'Nível 2', instancia: { bloco: 'texto/titulo', props: { texto: 'Mais vendidos', nivel: 2 } } },
  ] },
  'texto/paragrafo': { titulo: 'Parágrafo', descricao: 'Texto corrido. O conteúdo é sempre escapado (nunca HTML).', exemplos: [
    { titulo: 'Texto simples', instancia: par('Frete grátis acima de R$ 99.') },
    { titulo: 'Com marcação (aparece como texto)', instancia: par('<b>não vira negrito</b> & continua seguro') },
  ] },
  'texto/trecho': { titulo: 'Trecho', descricao: 'Pedaço de texto em linha (`span`), para montar um título ou um parágrafo com partes diferentes.', exemplos: [{ titulo: 'Trecho', instancia: { bloco: 'texto/trecho', props: { texto: 'Objetos de' } } }] },
  'texto/enfase': { titulo: 'Ênfase', descricao: 'Ênfase semântica em itálico (`em`). Com `bloco: true` ocupa a linha inteira.', exemplos: [{ titulo: 'Ênfase', instancia: { bloco: 'texto/enfase', props: { texto: 'beleza serena' } } }] },
  'texto/destaque': { titulo: 'Destaque', descricao: 'Trecho importante em negrito semântico (`strong`).', exemplos: [{ titulo: 'Preço', instancia: { bloco: 'texto/destaque', props: { texto: 'R$ 49,90' } } }] },
  'texto/pequeno': { titulo: 'Texto pequeno', descricao: 'Observações e notas de rodapé, em cor suave.', exemplos: [{ titulo: 'Nota', instancia: { bloco: 'texto/pequeno', props: { texto: 'Preço válido até domingo.' } } }] },
  'texto/codigo': { titulo: 'Código', descricao: 'Trecho de código ou identificador em fonte monoespaçada.', exemplos: [{ titulo: 'SKU', instancia: { bloco: 'texto/codigo', props: { texto: 'SKU-00123' } } }] },
  'texto/rotulo': { titulo: 'Rótulo', descricao: 'Rótulo de campo. `para` liga ao `id` do campo (clicar no rótulo foca o campo).', exemplos: [
    { titulo: 'Rótulo de um campo', instancia: { bloco: 'layout/pilha', props: { gap: 4 }, slots: { filhos: [{ bloco: 'texto/rotulo', props: { texto: 'Nome', para: 'nome' } }, { bloco: 'entrada/texto', id: 'nome', props: { placeholder: 'Seu nome' } }] } } },
  ] },
  'midia/imagem': { titulo: 'Imagem', descricao: 'Imagem carregada sob demanda. Só aceita URLs seguras (http, https ou relativas); outras somem. Se `src` é uma imagem hospedada pela plataforma (`/_polaris/img/<hash>.png|jpg|webp`), e há `tamanhos` ou `largura`, ganha `srcset` automático com as versões de 160, 480, 960 e 1920 px e `sizes` (`tamanhos`, ou "até `largura` px"): o navegador baixa só a versão que cabe na tela. Sem nenhum dos dois, não há como saber o espaço da imagem e ela segue só com `src`.', exemplos: [
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
    { titulo: 'Secundário e fantasma', instancia: { bloco: 'layout/linha', slots: { filhos: [{ bloco: 'nav/botao', props: { texto: 'Cancelar', variante: 'secundario' } }, { bloco: 'nav/botao', props: { texto: 'Mais', variante: 'fantasma' } }] } } },
  ] },
  'layout/cabecalho': { titulo: 'Cabeçalho', descricao: 'Faixa do topo da página (`<header>`): ponto de referência para leitores de tela. `fixo` o mantém visível ao rolar.', exemplos: [
    { titulo: 'Com título e menu', instancia: { bloco: 'layout/cabecalho', slots: { filhos: [{ bloco: 'texto/destaque', props: { texto: 'Minha loja' } }, { bloco: 'nav/menu', slots: { filhos: [{ bloco: 'nav/link', props: { href: '/', texto: 'Início' } }] } }] } } },
  ] },
  'nav/alternador': { titulo: 'Alternador (abre e fecha sem JavaScript)', descricao: 'Caixa de marcar com `role="switch"` e nome acessível (`rotulo`, padrão "Abrir o menu") que o CSS usa para mostrar ou esconder o que vem depois (`input:checked ~ …`): é a base do menu recolhível. Precisa de um `id` na instância e de um `texto/rotulo` com `para` apontando para ele (o clique no rótulo marca a caixa). Sem estado nem evento no runtime.', exemplos: [
    { titulo: 'Com rótulo', instancia: { bloco: 'layout/pilha', slots: { filhos: [{ bloco: 'nav/alternador', id: 'alt-exemplo', props: { rotulo: 'Abrir o menu' } }, { bloco: 'texto/rotulo', props: { texto: 'Menu', para: 'alt-exemplo' } }] } } },
  ] },
  'form/busca': { titulo: 'Formulário de busca', descricao: 'Formulário `GET` (`role="search"`) que leva o termo para uma página do PRÓPRIO site (`acao`, padrão `/busca`): funciona sem JavaScript, o termo vai na URL (`?q=…`) e a página de resultados o lê em `consulta.q`. Destino que não é um caminho do site vale o padrão.', exemplos: [
    { titulo: 'Campo e botão', instancia: { bloco: 'form/busca', slots: { filhos: [{ bloco: 'entrada/busca', props: { placeholder: 'Buscar produtos' } }, { bloco: 'nav/enviar', props: { texto: 'Buscar' } }] } } },
  ] },
  'form/sugestoes-ao-vivo': { titulo: 'Sugestões ao vivo (busca)', descricao: 'Lista de sugestões que aparece sob o campo de busca enquanto se digita, buscadas no servidor (`url`, um caminho do próprio site que devolve JSON, ex.: `/api/loja/destaques`; o cliente acrescenta `busca=<termo>&limite=<n>`). Cada item mostra o `titulo`, a `descricao` e a miniatura (`imagem`, só caminho do próprio site) e leva a `destino?q=<título>`. Vai dentro do `form/busca`, depois do campo. Teclado: setas, Enter e Esc; o campo vira uma caixa de combinação (`combobox`). Precisa de JavaScript; sem ele, a lista fica oculta e a busca normal segue funcionando.', exemplos: [
    { titulo: 'Campo com sugestões ao vivo', instancia: { bloco: 'form/busca', slots: { filhos: [{ bloco: 'entrada/busca', props: { placeholder: 'Buscar' } }, { bloco: 'form/sugestoes-ao-vivo', props: { url: '/api/loja/destaques', imagem: 'imagem' } }, { bloco: 'nav/enviar', props: { texto: 'Buscar' } }] } } },
  ] },
  'form/sugestoes': { titulo: 'Sugestões (lista do campo)', descricao: 'Lista de opções (`<datalist>`) que um campo oferece enquanto se digita, ligada pelo `id` da instância ao `lista` do `entrada/busca`. Sem JavaScript: o navegador filtra pelo que foi digitado. As opções são fixas na página (`form/opcao`); não vêm do servidor a cada tecla.', exemplos: [
    { titulo: 'Campo com sugestões', instancia: { bloco: 'form/busca', slots: { filhos: [{ bloco: 'entrada/busca', props: { lista: 'sugestoes-exemplo' } }, { bloco: 'form/sugestoes', id: 'sugestoes-exemplo', slots: { filhos: [{ bloco: 'form/opcao', props: { valor: 'Café' } }, { bloco: 'form/opcao', props: { valor: 'Chá' } }] } }, { bloco: 'nav/enviar', props: { texto: 'Buscar' } }] } } },
  ] },
  'form/opcao': { titulo: 'Opção de sugestão', descricao: 'Uma opção (`<option value>`) de um `form/sugestoes`; `valor` é o texto sugerido (até 100 caracteres).', exemplos: [
    { titulo: 'Opção dentro da lista', instancia: { bloco: 'form/busca', slots: { filhos: [{ bloco: 'entrada/busca', props: { lista: 'opcoes-exemplo', placeholder: 'Digite c…' } }, { bloco: 'form/sugestoes', id: 'opcoes-exemplo', slots: { filhos: [{ bloco: 'form/opcao', props: { valor: 'Café' } }] } }, { bloco: 'nav/enviar', props: { texto: 'Buscar' } }] } } },
  ] },
  'entrada/busca': { titulo: 'Campo de busca', descricao: 'Campo `type="search"` com nome acessível (`rotulo`, padrão "Buscar"), `nome` do parâmetro (padrão `q`), `placeholder` e `valor` inicial (até 200 caracteres) e `lista` (id de um `form/sugestoes` da página, com as opções que o navegador oferece ao digitar). Vai dentro de um `form/busca`.', exemplos: [
    { titulo: 'Com termo', instancia: { bloco: 'entrada/busca', props: { valor: 'café', placeholder: 'Buscar' } } },
  ] },
  'nav/enviar': { titulo: 'Botão de envio', descricao: 'Botão `type="submit"` para formulários simples (sem JavaScript e sem evento); o texto padrão é "Enviar".', exemplos: [
    { titulo: 'Padrão', instancia: { bloco: 'nav/enviar' } },
  ] },
  'entrada/arquivo': { titulo: 'Arquivo', descricao: 'Seletor de UM arquivo. `aceita` filtra o seletor; `tamanhoMax` (bytes, padrão 2 MB) recusa antes de ler. `aoEscolher` roda só com arquivo que serve e recebe `{ nome, tipo, tamanho, dados }` (bytes em base64); `aoRecusar` roda só quando não serve (nenhum arquivo ou acima de `tamanhoMax`) e recebe `{ erro }`, sem ler o arquivo. O servidor deve revalidar tudo: o tipo declarado aqui não vale nada.', exemplos: [
    { titulo: 'Imagens', instancia: { bloco: 'entrada/arquivo', props: { rotulo: 'Escolha uma imagem', aceita: 'image/png,image/jpeg,image/gif,image/webp' } } },
  ] },
  'layout/destaque': { titulo: 'Destaque', descricao: 'Faixa de destaque (`<section>`): fundo da cor primária do tema (ou `suave`), ou uma `imagem` de fundo com véu escuro (`escurece`) para o texto ler. `alinha`: centro ou esquerda; `altura` mínima em px. O texto e os botões ficam nos filhos; a imagem precisa ser do próprio site (o CSP das páginas só carrega imagens da mesma origem). `capa: true` faz dela uma capa (hero): texto embaixo, sobe por baixo do cabeçalho, foto com zoom lento e entrada do texto (tokens `cabecalho.altura` e `movimento.*`); `zoom: true` faz a foto crescer no hover.', exemplos: [
    { titulo: 'Fundo do tema', instancia: { bloco: 'layout/destaque', props: { altura: 200 }, slots: { filhos: [{ bloco: 'texto/titulo', props: { texto: 'Oferta da semana', nivel: 2 } }] } } },
    { titulo: 'Suave, à esquerda', instancia: { bloco: 'layout/destaque', props: { fundo: 'suave', alinha: 'esquerda', altura: 160 }, slots: { filhos: [{ bloco: 'texto/paragrafo', props: { texto: 'Entrega grátis acima de R$ 99' } }] } } },
  ] },
  'layout/rodape': { titulo: 'Rodapé', descricao: 'Faixa do fim da página (`<footer>`): ponto de referência para leitores de tela, com informações do site (contato, links, aviso legal).', exemplos: [
    { titulo: 'Com aviso', instancia: { bloco: 'layout/rodape', slots: { filhos: [{ bloco: 'texto/pequeno', props: { texto: '© 2026 Minha loja' } }] } } },
  ] },
  'midia/icone': { titulo: 'Ícone', descricao: 'Ícone da família Grafite (60: um por bloco e por ação do Studio; grade de 24 px, traço de 1,75 px). `nome` escolhe o ícone; `tamanho` (8 a 96 px) ou, sem ele, 1,25 em (acompanha o texto); `acento` pinta o detalhe na cor de destaque do tema. Sem `rotulo` o ícone é decorativo (`aria-hidden`); com `rotulo` vira uma imagem com nome acessível. A cor é a do texto ao redor (`currentColor`). É feito por CSS (máscara), sem JavaScript e sem pedido de rede. Botões e links aceitam `icone` e põem o ícone antes do texto.', exemplos: [
    { titulo: 'Ícones em linha', instancia: { bloco: 'layout/linha', props: { gap: 12 }, slots: { filhos: [{ bloco: 'midia/icone', props: { nome: 'salvar', tamanho: 24 } }, { bloco: 'midia/icone', props: { nome: 'publicar', tamanho: 24, acento: true } }, { bloco: 'midia/icone', props: { nome: 'feedback-alerta', tamanho: 24, rotulo: 'Atenção' } }, { bloco: 'texto/paragrafo', props: { texto: 'Ícones de 24 px' } }] } } },
    { titulo: 'No botão e no link', instancia: { bloco: 'layout/linha', props: { gap: 12 }, slots: { filhos: [{ bloco: 'nav/botao', props: { texto: 'Salvar', icone: 'salvar' } }, { bloco: 'nav/botao', props: { texto: 'Desfazer', icone: 'desfazer', variante: 'secundario' } }, { bloco: 'nav/link', props: { href: '/entrar', texto: 'Entrar', icone: 'entrar' } }] } } },
  ] },
  'layout/painel': { titulo: 'Painel (cabeçalho, lateral e conteúdo)', descricao: 'Estrutura de aplicação: uma grade com o cabeçalho (`site/cabecalho`) no topo, o menu lateral (`site/menu-lateral` ou `layout/lateral`) à esquerda e o `layout/principal` à direita; ocupa a altura da janela, a lateral e o conteúdo rolam sozinhos. Até 40 rem de largura vira uma coluna e a lateral fica atrás do botão "Seções".', exemplos: [
    { titulo: 'Cabeçalho, lateral e conteúdo', instancia: { bloco: 'layout/painel', slots: { filhos: [{ bloco: 'layout/cabecalho', slots: { filhos: [{ bloco: 'texto/destaque', props: { texto: 'Painel' } }] } }, { bloco: 'layout/lateral', props: { rotulo: 'Seções' }, slots: { filhos: [{ bloco: 'nav/menu', slots: { filhos: [{ bloco: 'nav/link', props: { href: '/', texto: 'Início', atual: true } }, { bloco: 'nav/link', props: { href: '/a', texto: 'Relatórios' } }] } }] } }, { bloco: 'layout/principal', slots: { filhos: [{ bloco: 'texto/titulo', props: { texto: 'Visão geral', nivel: 1 } }] } }] } } },
  ] },
  'layout/lateral': { titulo: 'Lateral (menu lateral)', descricao: 'Coluna lateral (`<aside>`) do `layout/painel`, com nome acessível em `rotulo` (padrão "Navegação lateral"). Costuma levar um `nav/menu` com links ou botões (`atual` marca o escolhido). Prefira o composto `site/menu-lateral`, que já traz o botão que a recolhe no celular.', exemplos: [
    { titulo: 'Com menu', instancia: { bloco: 'layout/lateral', props: { rotulo: 'Seções' }, slots: { filhos: [{ bloco: 'nav/menu', slots: { filhos: [{ bloco: 'nav/link', props: { href: '/', texto: 'Início', atual: true } }] } }] } } },
  ] },
  'layout/principal': { titulo: 'Principal (conteúdo)', descricao: 'A área de conteúdo (`<main>`) do `layout/painel`: o ponto de referência "principal" para leitores de tela, com rolagem própria.', exemplos: [
    { titulo: 'Com título', instancia: { bloco: 'layout/principal', slots: { filhos: [{ bloco: 'texto/titulo', props: { texto: 'Conteúdo', nivel: 1 } }] } } },
  ] },
  'layout/cartao': { titulo: 'Cartão', descricao: 'Caixa com borda, fundo de superfície e espaçamento interno, para agrupar um item (uma imagem com seus dados, uma versão, um resumo). Em grade ou em lista, vários cartões ficam alinhados. `papel` e `rotulo` dão nome e papel ARIA ao cartão quando ele é um grupo.', exemplos: [
    { titulo: 'Dois cartões', instancia: { bloco: 'layout/grade', props: { colunas: 2, gap: 12 }, slots: { filhos: [{ bloco: 'layout/cartao', slots: { filhos: [{ bloco: 'texto/titulo', props: { texto: 'Release 12', nivel: 4 } }, { bloco: 'feedback/selo', props: { texto: 'Em produção', tom: 'sucesso' } }] } }, { bloco: 'layout/cartao', slots: { filhos: [{ bloco: 'texto/titulo', props: { texto: 'Release 11', nivel: 4 } }, { bloco: 'texto/pequeno', props: { texto: 'Anterior' } }] } }] } } },
  ] },
  'midia/tela': { titulo: 'Tela de edição', descricao: 'Moldura de proporção fixa (`proporcao`, largura ÷ altura) que mostra os filhos (uma prévia) e, por cima, as `caixas` que o usuário **arrasta e redimensiona** com o mouse, o toque ou o teclado (setas movem, Alt e setas redimensionam). Cada caixa é `{ id, rotulo, topo, esquerda, largura, altura, rotacao?, atual? }` em frações da moldura; `passo` é a grade de encaixe. Eventos: `aoMover` (`{ id, topo, esquerda, largura, altura }`, ao soltar), `aoSelecionar` (`{ id }`, ao apertar) e `aoSoltar` (`{ valor, topo, esquerda }`, ao soltar sobre a tela um botão com `arrasta`). O comportamento vem da ilha `@polaris/engine/tela`, que o hospedeiro ativa; sem ela é só a moldura.', exemplos: [
    { titulo: 'Peça com duas caixas', instancia: { bloco: 'midia/tela', props: { proporcao: 0.7071, caixas: [{ id: 'titulo', rotulo: 'Título', topo: 0.08, esquerda: 0.1, largura: 0.8, altura: 0.2, atual: true }, { id: 'preco', rotulo: 'Preço', topo: 0.4, esquerda: 0.1, largura: 0.8, altura: 0.3 }] }, slots: { filhos: [{ bloco: 'texto/pequeno', props: { texto: 'a prévia da peça entra aqui' } }] } } },
  ] },
  'layout/contido': { titulo: 'Contêiner (largura máxima)', descricao: 'Limita e centraliza o conteúdo: largura máxima (`estreita`, `normal` ou `larga`, definidas pelo tema em `layout.largura`, `layout.larguraEstreita` e `layout.larguraLarga`) e margens laterais. Dentro de uma abertura (`layout/destaque`) ou de uma faixa de fundo, mantém o texto alinhado com o resto da página enquanto o fundo vai de ponta a ponta.', exemplos: [
    { titulo: 'Texto no contêiner normal', instancia: { bloco: 'layout/contido', slots: { filhos: [{ bloco: 'texto/titulo', props: { texto: 'Nossa história', nivel: 2 } }, { bloco: 'texto/paragrafo', props: { texto: 'O conteúdo fica centrado, com largura máxima e margens, em telas largas e estreitas.' } }] } } },
    { titulo: 'Contêiner estreito para leitura', instancia: { bloco: 'layout/contido', props: { largura: 'estreita' }, slots: { filhos: [{ bloco: 'texto/paragrafo', props: { texto: 'Linhas curtas leem melhor: use a largura estreita em textos longos.' } }] } } },
  ] },
  'texto/sobretitulo': { titulo: 'Sobretítulo', descricao: 'A linha pequena em caixa alta e letras espaçadas que vem antes de um título ("Coleção em destaque"), na cor primária do tema (ou na do texto, sobre uma foto). É um parágrafo, não um título: o título de verdade continua sendo `texto/titulo`.', exemplos: [
    { titulo: 'Antes de um título', instancia: { bloco: 'layout/pilha', slots: { filhos: [{ bloco: 'texto/sobretitulo', props: { texto: 'Coleção em destaque' } }, { bloco: 'texto/titulo', props: { texto: 'Iluminação', nivel: 2 } }] } } },
  ] },
  'layout/secao': { titulo: 'Seção recolhível', descricao: 'Grupo de conteúdo com título que abre e fecha (um `<details>` nativo, sem JavaScript): o primeiro filho é o `layout/secao-titulo` (o `<summary>`, com ícone) e o resto é o conteúdo. `aberta` faz a seção começar aberta. Boa para painéis de propriedades e formulários longos.', exemplos: [
    { titulo: 'Duas seções', instancia: { bloco: 'layout/pilha', props: { gap: 8 }, slots: { filhos: [{ bloco: 'layout/secao', props: { aberta: true }, slots: { filhos: [{ bloco: 'layout/secao-titulo', props: { texto: 'Identificação', icone: 'editar' } }, { bloco: 'texto/paragrafo', props: { texto: 'Nome e identificador do item.' } }] } }, { bloco: 'layout/secao', slots: { filhos: [{ bloco: 'layout/secao-titulo', props: { texto: 'Avançado', icone: 'releases' } }, { bloco: 'texto/paragrafo', props: { texto: 'Fechada até alguém abrir.' } }] } }] } } },
  ] },
  'layout/secao-titulo': { titulo: 'Título da seção', descricao: 'O `<summary>` de uma `layout/secao`: o texto clicável (`texto`) com um ícone opcional (`icone`) e a seta que gira ao abrir. Deve ser o primeiro filho da seção.', exemplos: [
    { titulo: 'Título com ícone', instancia: { bloco: 'layout/secao', props: { aberta: true }, slots: { filhos: [{ bloco: 'layout/secao-titulo', props: { texto: 'Aparência', icone: 'layout-destaque' } }, { bloco: 'texto/pequeno', props: { texto: 'Conteúdo da seção' } }] } } },
  ] },
  'nav/submenu': { titulo: 'Submenu (recolhível, sem JavaScript)', descricao: 'Grupo recolhível de links dentro de um `nav/menu`: um `<details>` nativo que leva um `nav/submenu-titulo` (o `<summary>`, que abre e fecha) seguido dos links. Funciona por teclado (Tab, Enter e Espaço) sem JavaScript; no computador a lista abre como um painel sob o título (onde o navegador suporta `::details-content`; nos outros, abre em linha), e no celular, em linha. Com o roteador do gateway, Esc e o clique fora o fecham.', exemplos: [
    { titulo: 'Com dois links', instancia: { bloco: 'nav/menu', slots: { filhos: [{ bloco: 'nav/submenu', slots: { filhos: [{ bloco: 'nav/submenu-titulo', props: { texto: 'Produtos' } }, { bloco: 'nav/link', props: { href: '/cafes', texto: 'Cafés' } }, { bloco: 'nav/link', props: { href: '/cha', texto: 'Chás' } }] } }] } } },
  ] },
  'nav/submenu-titulo': { titulo: 'Título do submenu', descricao: 'O `<summary>` de um `nav/submenu`: o texto clicável que abre e fecha o grupo (`texto`). Deve ser o primeiro filho do submenu.', exemplos: [
    { titulo: 'Título', instancia: { bloco: 'nav/submenu', slots: { filhos: [{ bloco: 'nav/submenu-titulo', props: { texto: 'Mais' } }, { bloco: 'nav/link', props: { href: '/sobre', texto: 'Sobre' } }] } } },
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
