# Biblioteca base de blocos

47 blocos nativos (mais o `core/slot`). Cada um tem **schema** (`BLOCOS_BASE`, em `render/base.tsx`), **componente React** (oráculo) e **descritor DOM** (`vivo/blocos.ts`, usado pelo servidor e pelo cliente do runtime vivo; o emissor estático deriva dele). `test/blocos-base.test.tsx` confere, por bloco: React × HTML estático × HTML do vivo × montagem no cliente × hidratação (mesmos nós), e as props dinâmicas.

| Grupo | Bloco | Props | Slots | Eventos |
|---|---|---|---|---|
| layout | `layout/pilha`, `layout/linha` | `gap`, `alinha` | `filhos` | |
| layout | `layout/grade` | `colunas` (1–12, padrão 2), `gap` | `filhos` | |
| layout | `layout/cabecalho` | `fixo` (fica no topo ao rolar) | `filhos` | |
| form | `form/busca` | `acao` (caminho do próprio site, padrão `/busca`) | `filhos` | |
| layout | `layout/destaque` | `imagem`, `altura` (120–800), `escurece` (0–0,8), `alinha`, `fundo` | `filhos` | |
| layout | `layout/rodape` | | `filhos` | |
| layout | `layout/divisor` | | | |
| layout | `layout/espacador` | `tamanho` (px, padrão 8) | | |
| texto | `texto/titulo` | `texto`, `nivel` (1–6) | | |
| texto | `texto/paragrafo`, `texto/destaque`, `texto/pequeno`, `texto/codigo` | `texto` | | |
| texto | `texto/rotulo` | `texto`, `para` (id do campo) | | |
| mídia | `midia/imagem` | `src` (só URLs seguras), `alt`, `largura`, `altura` | | |
| lista | `lista/lista` | `ordenada` | `filhos` (só `lista/item`) | |
| lista | `lista/item` | | `filhos` | |
| tabela | `tabela/tabela` | | `filhos` (`cabecalho`, `corpo`) | |
| tabela | `tabela/cabecalho`, `tabela/corpo` | | `filhos` (só `tabela/linha`) | |
| tabela | `tabela/linha` | | `filhos` (só `tabela/celula`) | |
| tabela | `tabela/celula` | `texto` ou filhos, `cabecalho` (th), `colunas`, `linhas` | `filhos` | |
| entrada | `entrada/texto` | `valor`, `placeholder`, `desabilitado` | | `aoMudar` (texto) |
| entrada | `entrada/numero` | `valor`, `min`, `max`, `passo`, `placeholder`, `desabilitado` | | `aoMudar` (número ou `null` se vazio) |
| entrada | `entrada/busca` | `nome` (parâmetro, padrão `q`), `rotulo` (padrão "Buscar"), `placeholder`, `valor` (até 200) | | |
| entrada | `entrada/arquivo` | `rotulo`, `aceita`, `tamanhoMax` (bytes, padrão 2 MB), `desabilitado` | | `aoEscolher` (`{nome, tipo, tamanho, dados base64}`), `aoRecusar` (`{erro}`) |
| entrada | `entrada/caixa` | `marcado`, `desabilitado` | | `aoMudar` (booleano) |
| nav | `nav/botao` | `texto`, `desabilitado` | | `aoClicar` |
| midia | `midia/icone` | `nome`, `tamanho`, `rotulo`, `acento` | | |
| layout | `layout/cartao` | `papel`, `rotulo` | | |
| layout | `layout/secao` | `aberta` | | |
| layout | `layout/secao-titulo` | `texto`, `icone` | | |
| layout | `layout/painel` | (só filhos) | | |
| layout | `layout/lateral` | `rotulo` | | |
| layout | `layout/principal` | (só filhos) | | |
| form | `form/sugestoes-ao-vivo` | `url`, `titulo`, `descricao`, `imagem`, `limite`, `destino`, `nome`, `rotulo` | | |
| form | `form/sugestoes` | (só filhos; `id` liga ao campo) | | |
| form | `form/opcao` | `valor` | | |
| nav | `nav/submenu` | (só filhos) | | |
| nav | `nav/submenu-titulo` | `texto` | | |
| nav | `nav/alternador` | `rotulo` (padrão "Abrir o menu") | | |
| nav | `nav/enviar` | `texto` (padrão "Enviar") | | |
| nav | `nav/menu` | `rotulo` (nome acessível; padrão "Principal") | `filhos` | |
| nav | `nav/link` | `href` (só URLs seguras), `texto`, `atual` (`aria-current="page"`), `botao` (`primario`/`secundario`: aparência de botão) | `filhos` | |
| feedback | `feedback/selo` | `texto`, `tom` | | |
| feedback | `feedback/alerta` | `tom` | `filhos` | |

`tom` ∈ `neutro | sucesso | alerta | erro`, emitido como `data-tom` (o estilo vem do tema, card de tokens). Por ser enum, `tom` é estático (não aceita binding).

**Tabela** exige `cabecalho`/`corpo` explícitos: o parser HTML insere `<tbody>` sozinho, e o DOM do servidor teria de divergir do DOM construído no cliente.
**`select`/`textarea`** ficam para depois: o conteúdo de `textarea` e o `value` de `select` dependem de filhos criados antes, e a adoção na hidratação precisa de tratamento próprio.
**Acessibilidade**: `espacador` tem `aria-hidden`, `alerta` tem `role="alert"`, `rotulo` liga ao campo por `for`.
**Como acrescentar um bloco**: schema em `BLOCOS_BASE` + componente em `COMPONENTES_BASE` + descritor `d_<interface>` em `DESCRITORES_BASE`; o teste de coerência recusa as três tabelas fora de sincronia.

## Catálogo (docs vivas)
`pnpm catalogo --saida docs/catalogo` gera, do registry, o catálogo em HTML (claro e escuro), Markdown e o CSS do tema: `docs/catalogo/index.html`, `escuro.html`, `catalogo.md`. Nada é escrito à mão:
- **props, slots e eventos** vêm do bloco resolvido (com `extends` e override do tenant), com tipo, limites, padrão e obrigatoriedade;
- **título, descrição e exemplos** moram no nó do bloco (`spec.titulo`, `spec.descricao`, `spec.exemplos[{titulo, instancia}]`; campos opcionais do kind `bloco`). O schema confere os exemplos contra os slots;
- **cada exemplo é renderizado pelo runtime real** (o mesmo HTML do vivo), e um exemplo inválido aparece como erro no catálogo e no código de saída do comando, sem derrubar o resto;
- inclui a seção do tema com as amostras de cor e a auditoria de contraste.
Para documentar um bloco novo (ou de um tenant), basta pôr `titulo`, `descricao` e `exemplos` no nó; `--nos <dir>` inclui nós extras e `--tema <id>` escolhe o tema do preview.

## Cabeçalho, rodapé e hero do site
`layout/cabecalho` emite `<header>` e `nav/menu` emite `<nav aria-label>`: pontos de referência para leitores de tela, estilizados pelo tema só com variáveis (`#polaris header`, `header[data-fixo]` sticky, `nav a[aria-current=page]` em negrito sublinhado). Em cima deles, o bloco **composto** `site/cabecalho` (`registraSite`, `@polaris/engine/site`, 100% declarativo: `modelo` sobre os blocos base):
- `titulo` e/ou `logo` (URL segura) formam a **marca**, que leva a `href` (padrão `/`);
- `links` (`[{ texto, href, atual? }]`, até 12) viram o menu; sem links não há `<nav>` vazio; `rotuloMenu` nomeia o menu; `fixo` o mantém no topo;
- o slot `acoes` fica à direita (botão de entrar, carrinho…): o modelo não tem estado nem eventos, então o que depende da página entra por ali.
Texto vem escapado e link inseguro (`javascript:`) perde o `href`. Há paridade React × runtime vivo × HTML estático, exemplos no catálogo e verificação no Chrome (console limpo, CSP, acessibilidade, celular, modo escuro) pelo E2E dos blocos. O site de exemplo (`exemplos/loja-site`) o usa em todas as páginas, marcando `atual` na rota aberta.
**Limites**: `atual` é declarado (a página diz qual é a sua; o bloco não descobre a rota sozinho); sem menu recolhível no celular (os links quebram de linha); sem submenus; sem estado de sessão (o "Entrar"/"Sair" é uma ação que a página escolhe).

**Rodapé**: `layout/rodape` emite `<footer>` (estilizado com variáveis do tema: `#polaris footer`, links em cor suave) e o composto `site/rodape` monta, sobre os blocos base:
- `colunas` (até 6, `[{ titulo, links[{ texto, href }] }]`): cada uma vira um título e um `<nav>` próprio, **com o título como nome acessível** (leitor de tela anuncia "Loja, navegação"); a grade tem uma coluna por grupo; coluna sem links não gera `<nav>` vazio;
- `contato` (uma linha: telefone, e-mail, endereço), um divisor e o aviso legal `copyright` (só aparecem se informados);
- o slot `extra` para o que a página quiser (assinatura de e-mail, selos…).
Mesmas garantias do cabeçalho (texto escapado, link inseguro sem `href`, paridade nas três saídas, exemplos verificados no Chrome). **Limites**: as colunas não se reorganizam por largura de tela (a grade é fixa; no celular ficam estreitas); sem ícones de redes sociais (use o slot `extra`); `contato` é texto simples, sem links automáticos.

**Hero (banner de destaque)**: `layout/destaque` emite `<section data-alinha data-fundo>` e o composto `site/hero` monta, sobre ele:
- `titulo` (o `<h1>`: deve ser o único da página), `subtitulo`, até dois botões (`cta` primário e `cta2` secundário, links com aparência de botão via `nav/link` `botao`) e o slot `extra`;
- fundo: a cor primária do tema (`fundo: primaria`, padrão) ou `suave`; ou uma `imagem` com **véu escuro** (`escurece`, 0 a 0,8, padrão 0,45) para o texto ler; `altura` mínima (120 a 800 px, padrão 320); `alinha`: `centro` (padrão) ou `esquerda`. Valor desconhecido de `alinha`/`fundo` vale o padrão; altura e véu fora do limite nem compilam;
- com **imagem** de fundo (véu sempre escuro) o texto é branco e o botão primário branco, em qualquer tema; sobre o fundo primário o botão primário é **invertido** (claro sobre a cor da marca) para ter contraste, e o secundário usa o texto sobre-primária; tudo por variáveis do tema.
A URL da imagem passa por `urlSegura` e vai para o CSS escapada (`cssUrl`: aspas, parênteses e contrabarra viram escapes: nada fecha o `url()` nem a declaração).
**Limites**: a imagem precisa ser **da mesma origem** (o CSP das páginas só carrega as do próprio site): use as imagens do tenant enviadas pelo Studio (`docs/imagens.md`); sem imagem de fundo responsiva (um só arquivo, `cover`); sem vídeo nem carrossel; `alinha` e `fundo` são texto (não enum) porque enum não aceita binding no modelo do composto.

**Arquivo (`entrada/arquivo`)**: seletor de UM arquivo. O navegador lê o arquivo e entrega `{ nome, tipo, tamanho, dados }` (bytes em base64) a `aoEscolher`; arquivo que não serve (nenhum, ou acima de `tamanhoMax`) **nem é lido** e dispara `aoRecusar` com `{ erro }`, de modo que a página não faz um envio inútil. Os dois eventos usam o mesmo evento do DOM (`change`); o payload de cada um decide se se aplica (valor sentinela `PULA`), e as ações rodam quando a leitura assíncrona termina. **O servidor revalida tudo**: o tipo declarado pelo navegador não vale nada.

**Busca**: `form/busca` (`<form role="search" method="get">`), `entrada/busca` (`<input type="search">`) e `nav/enviar` (`<button type="submit">`) são blocos **sem evento nem estado**: o composto `site/busca` os junta (campo + botão; `acao`, `nome`, `valor`, `placeholder`, `rotulo`, `botao`) e **funciona sem JavaScript**: o termo vai na URL (`/busca?q=café`) e a página de resultados o lê em **`consulta.q`** (o campo é preenchido de volta com `valor: '{consulta.q ?? ""}'`). Cabe no slot `acoes` do `site/cabecalho`.
- **Segurança**: `acao` só vale se for um **caminho do próprio site** (começa com uma barra; `https://…`, `//host`, `javascript:`, barra invertida, espaço e controles caem em `/busca`), e o CSP das páginas (`form-action 'self'`) é a segunda barreira; `nome` do parâmetro é um identificador simples (senão `q`); o termo nunca vira marcação (escapado) e passa de 200 caracteres nem compila.
- **Resultados** são da página. O site de exemplo busca **no servidor**: a entidade `destaque` do serviço declara `busca: { campos: ['titulo', 'descricao'] }` e a listagem gerada ganha o parâmetro `busca` (`docs/servicos.md`); a página (`site.busca`) passa `busca: '{consulta.q ?? ""}'`, `pagina` e `limite: 5` ao dado `site.destaques-busca`, e um segundo dado (`proxima`, `limite: 1`, `pagina: 5p+1`: o primeiro item depois da página) diz se existe "Próxima". Os links de página montam a URL com `urlcodifica(consulta.q)` (`&`, `#` e acentos no termo não quebram nada). Há mensagens para "sem termo" e "nada encontrado".
**Busca aproximada**: o serviço de exemplo declara `modo: aproximada` na entidade `destaque`: `cafetera` acha "Cafeteira italiana" e os resultados vêm por **relevância** ("Café gelado" antes de "Café de Loja Demo"), com índice trigrama (`docs/servicos.md`).
**Limites**: a paginação é por página numerada (a API não devolve o total: "Próxima" aparece se há um item depois, e o número da página é o único contexto); sem sugestões enquanto digita nem destaque do trecho achado; o envio recarrega a página (o roteador do cliente só intercepta links).

**Menu recolhível (celular)**: `nav/alternador` é uma **caixa de marcar** (`role="switch"`, nome acessível em `rotulo`) que o CSS do tema usa como interruptor: `header>input:not(:checked)~*:not(label){display:none}` esconde, até 40 rem de largura, o menu e as ações (inclusive a busca); marcar a caixa (pelo rótulo "Menu" ligado por `para`, ou pelo teclado: Tab e Espaço) mostra tudo em coluna. Acima de 40 rem o botão some e tudo fica à vista. **Sem JavaScript e sem estado no runtime** (o modelo de um bloco não tem eventos), então funciona até com a página estática. O `site/cabecalho` o põe sozinho (`menuRecolhivel`, padrão ligado; `false` mantém tudo à vista; `rotuloAlternador` muda o nome acessível).
**Limites**: o `id` do alternador é fixo (`cabecalho-alternador`): **um `site/cabecalho` por página**; Esc e o clique fora do cabeçalho só fecham **com o roteador do gateway carregado** (JavaScript, em `packages/gateway/src/navegacao.ts`; o foco volta ao interruptor, e clicar numa âncora `#…` do menu também fecha); sem JavaScript, ou em página estática, só fecha ao desmarcar ou navegar (a página nova nasce fechada); a caixa fica visualmente oculta (1 px, transparente) e o foco aparece no botão "Menu"; o ponto de corte (40 rem) é fixo no CSS base, não um token do tema.

**Submenus (`nav/submenu`)**: um `<details>` nativo com o `nav/submenu-titulo` (`<summary>`) e os links. **Sem JavaScript**: abre e fecha pelo título, com mouse, Tab, Enter e Espaço. No computador a lista aparece como um **painel sob o título** (`::details-content`, onde o navegador suporta; nos outros, abre em linha e empurra o conteúdo); no celular, em linha, dentro do menu recolhível. Com o roteador do gateway, **Esc** (foco volta ao título) e o **clique fora** também fecham, e a página nova nasce fechada. O `site/cabecalho` monta os submenus a partir de **`grupos`**: `[{ titulo, links: [{ texto, href }] }]` (até 6 grupos de 12 links).
**Limites**: os grupos vêm **depois** dos `links` (a linguagem não deixa um `se` ver a variável do `repetir`, então o menu não mistura as duas listas em ordem livre; para outra ordem, monte o `nav/menu` à mão); **um nível só** (sem submenu dentro de submenu); abrir um submenu não fecha os outros sem JavaScript (com o roteador, o clique fora do aberto fecha); não abre por passar o mouse (só por clique), de propósito, por acessibilidade em telas de toque.

**Busca com lista de sugestões**: o `site/busca` aceita `sugestoes` (até 20 termos de até 100 caracteres): vira um `<datalist>` nativo (`form/sugestoes` com `form/opcao`) ligado ao campo por `lista` (`entrada/busca`). **Sem JavaScript**: o navegador filtra as opções pelo que foi digitado e oferece a lista; escolher uma preenche o campo (o envio continua sendo do botão ou do Enter). Com a lista, o navegador passa a anunciar o campo como **caixa de combinação** (`combobox`), não mais `searchbox`.
**Limites**: as sugestões são **fixas na página** (declaradas no JSON), **não vêm do servidor a cada tecla** (isso pediria um endpoint de sugestões e JavaScript no cliente); o casamento é do navegador (prefixo/trecho, sem garantia de ignorar acento); a aparência da lista é do navegador (não segue o tema); **uma barra com sugestões por página** (o id da lista é fixo, `busca-sugestoes`).

**Sugestões ao vivo (`form/sugestoes-ao-vivo`)**: lista **do servidor** sob o campo de busca, no estilo do tema, com **título, descrição e miniatura**. No `site/busca`: `sugestoesUrl` (caminho do próprio site que devolve JSON, ex.: `/api/loja/destaques`), `sugestoesTitulo` (padrão `titulo`), `sugestoesDescricao`, `sugestoesImagem` (campo com o caminho da miniatura), `sugestoesLimite` (1 a 10, padrão 6) e `sugestoesDestino` (padrão: a `acao`). Como funciona (script do roteador do gateway, `navegacao.ts`): a partir de **2 letras** e a cada pausa de 180 ms o cliente chama `url?busca=<termo>&limite=<n>` (cancela a chamada anterior e guarda o resultado por termo); com o serviço em `busca.modo: aproximada` (`docs/servicos.md`) a lista **tolera erro de digitação e vem por relevância** ("cafetera" acha "Cafeteira italiana"). Escolher um item abre `destino?q=<título>`.
- **Teclado e leitor de tela**: o campo vira `combobox` (`aria-autocomplete`, `aria-expanded`, `aria-activedescendant`), a lista é `listbox` com itens `option`; **setas** movem, **Enter** abre o item ativo (sem item ativo, é o envio normal da busca), **Esc** fecha, clique fora fecha; um aviso `role=status` diz quantas sugestões há.
- **Segurança**: o que vem do servidor entra **só como texto** (`textContent`, nunca HTML); a miniatura só vale se for **caminho do próprio site** (`/…`, nunca `//` nem URL de fora; o CSP também só carrega imagens do próprio site); `url` precisa ser caminho do próprio site; nomes de campo são identificadores simples.
- **Miniatura**: o campo da entidade guarda o caminho de uma imagem hospedada (`/_polaris/img/<hash>.webp?w=160` é a versão de 160 px, `docs/imagens.md`). O exemplo `loja` ganhou o campo `imagem` na entidade `destaque`.
- **Trecho achado**: as palavras digitadas aparecem **realçadas** (`<mark>`, cor primária, negrito e sublinhado) no título e na descrição, **sem diferenciar acento nem maiúsculas** ("acai" realça "Açaí"; o texto mantém o acento). Montado por pedaços de texto, nunca HTML. Só realça o que casa **por trecho**: quando a sugestão veio por aproximação (erro de digitação, "cafetera"), não há trecho igual e nada é realçado.
- **Limites**: **precisa de JavaScript** (sem ele a lista fica oculta e a busca normal segue funcionando; use `sugestoes`, a lista nativa, se quiser algo sem JS); o termo vai na chamada pública da API (a taxa do gateway vale), então a rota precisa ser **pública** para visitantes; a lista só mostra o que a rota já expõe; uma barra com sugestões ao vivo por página para o teclado (os ids são gerados); campo novo em banco existente exige migração (o DDL gerado só cria tabelas novas; o ambiente local faz o `ALTER` sozinho).

**Menu lateral e painel de aplicação**: `layout/painel` é a estrutura de uma **aplicação**: grade com o cabeçalho (`site/cabecalho`) no topo, a lateral (`site/menu-lateral`) à esquerda e o `layout/principal` à direita, na altura da janela, com **rolagem própria** na lateral e no conteúdo (largura da lateral: variável `--largura-lateral`, padrão 16 rem). O `site/menu-lateral` aceita `grupos` (`titulo` e `links`, `atual` na página aberta) e os slots `topo` e `filhos` (para botões e outros itens: no Studio, `nav/botao` com `atual` marca o item aberto). `<aside>` e `<nav>` com nome acessível, só variáveis do tema.
- **Celular** (até 40 rem): vira uma coluna e a lateral fica atrás de um botão (`textoAlternador`, padrão "Seções"), com a mesma técnica do cabeçalho: caixa de marcar, sem JavaScript; com o roteador do gateway (ou o hospedeiro do Studio), escolher um item a recolhe.
- **`nav/botao`** ganhou `atual` (`aria-current`) e **`variante`** (`primario` cheio, `secundario` contorno, `fantasma` só texto); **`site/cabecalho`** ganhou `tituloNivel` (a marca vira h1…h6, útil quando a aplicação não tem outro h1).
- **Limites**: **um `site/menu-lateral` por página** (o `id` do alternador é fixo); a lateral não é recolhível no computador (largura fixa); o painel ocupa a janela inteira (`100vh`): não use dentro de outra página com rodapé.

**Tema padrão: paleta Grafite**: escolhida num estudo de três direções (Estrela, Floresta, Grafite; protótipo com contraste calculado por par). Neutros quentes (`fundo` #F6F6F5, `superficie` #FFFFFF, `texto` #1C1C1A), primária de cinza-azulado (#2D3A4F), apoio em violeta (#6B4FBB) e **laranja de acento (#D9580B), usado no anel de foco e nas ofertas**; no modo escuro a primária vira #B8C6E0 sobre `fundo` #101011. Os estados (`sucesso`, `alerta`, `erro`) mantêm o mesmo matiz nos dois modos. Todos os pares de texto passam AA (4,5:1) e o foco passa 3:1 (`auditaTema` e o teste de tema). Os presets antigos do Tiffany (`patria-blue`, `nco-red`, `graphite`) continuam registrados e um tenant pode escolher qualquer um.

**Ícones (`midia/icone`)**: família **Grafite** de 60 ícones (grade de 24 px, traço de 1,75 px, pontas arredondadas): um por bloco (`layout-pilha`, `nav-menu`, `form-busca`, `cartaz`…) e por ação do Studio (`salvar`, `desfazer`, `refazer`, `publicar`, `imagens`, `diagramas`, `releases`, `editar`, `apagar`, `previa`, `historico`, `comentarios`, `usuario`, `entrar`, `sair`, `tema-escuro`, `mais`, `fechar`, `chevron`). `nome` é uma lista fechada (validada na compilação); `tamanho` de 8 a 96 px (padrão 1,25 em, acompanha o texto); `rotulo` dá nome acessível (sem ele o ícone é decorativo, `aria-hidden`); `acento` pinta o detalhe na cor de destaque do tema. **Botões e links** aceitam `icone` e põem o ícone antes do texto (uma cor só, a do texto).
- **Como é feito**: cada ícone é um par de imagens SVG usadas como **máscara** (CSS do tema, uma regra por ícone), então a cor é `currentColor`, nada pede rede, funciona sem JavaScript e igual no React, no runtime vivo e no estático. As imagens ficam em `packages/engine/src/icones/dados.ts` (só o CSS do tema as lê); o navegador só carrega a validação do **formato** do nome, para não pesar o pacote do cliente.
- **Limites**: traço fixo (1,75 px na grade de 24: em tamanhos pequenos fica mais fino); só uma cor mais o acento; sem animação; o CSS do tema cresce ~16 KB (cacheado por hash); um nome bem formado que não existe não pinta nada (no `nome` literal, a compilação recusa).

**`quebra` em `layout/linha` e `layout/pilha`**: `true` acrescenta `flex-wrap: wrap` (a linha passa para outra linha quando falta espaço, em vez de estourar a largura). O padrão continua sem quebra.
**`papel` e `rotulo` em `layout/linha` e `layout/pilha`**: `papel` (`toolbar`, `group`, `list` ou `status`, a região viva que o leitor de tela anuncia ao mudar) e `rotulo` (nome acessível) viram `role` e `aria-label` do grupo; sem eles nada muda.

**Seção recolhível (`layout/secao`)**: um `<details>` nativo (sem JavaScript) com borda, o título (`layout/secao-titulo`: texto e `icone`, mais uma seta que gira ao abrir) e o conteúdo; `aberta` faz a seção começar aberta e o leitor pode recolher. Serve a painéis de propriedades e formulários longos. **Limites**: o estado aberto/fechado é do navegador (volta ao inicial se a página for refeita do zero); o título deve ser o primeiro filho; uma seção não lembra o estado entre uma seleção e outra no Studio.

**Cartão (`layout/cartao`)**: caixa com borda, fundo de superfície e espaçamento interno, que empilha os filhos; em `layout/grade` vários cartões ficam alinhados. `papel` e `rotulo` (como em `layout/linha`) dão nome e papel ARIA quando o cartão é um grupo.

**`lista` em `entrada/texto`** liga o campo a um `form/sugestoes` da página (lista de valores do navegador), como `entrada/busca`. **`largura` e `cresce` em `layout/linha` e `layout/pilha`**: `largura` (40 a 2000 px) fixa a largura de uma caixa dentro de uma linha; `cresce` a faz ocupar o espaço que sobra sem estourar (`flex: 1 1 0%` e `min-width: 0`).
**`expandido` em `nav/botao`**: verdadeiro ou falso viram `aria-expanded` (botão que abre e fecha algo, como a seta de uma árvore); sem o prop, o atributo não existe.

**`midia/tela` (tela de edição)**: moldura de proporção fixa (`proporcao`) que mostra os filhos e, por cima, as `caixas` (`{ id, rotulo, topo, esquerda, largura, altura, rotacao?, atual? }`, em frações) que a ilha `@polaris/engine/tela` arrasta e redimensiona; eventos `aoMover`, `aoSelecionar` e `aoSoltar`. **`nav/botao` com `arrasta`**: o botão vira arrastável e leva o valor ao soltar na tela (`aoSoltar`). Os atributos saem de `src/tela/atributos.ts`, os mesmos nos dois renderizadores, validados e limitados (200 caixas, ids seguros).

**`solta` e `aoSoltar` em `layout/pilha` e `layout/linha`**: com `solta`, a caixa vira uma zona de soltar: um botão com `arrasta` arrastado sobre outro botão `arrasta` da mesma zona chega em `aoSoltar` como `{ valor, alvo, zona }` (`zona`: `antes`, `dentro` ou `depois`, pela altura do ponteiro no item), e o item sob o ponteiro leva `data-solta-zona` para o CSS desenhar a indicação. Só funciona com a ilha `@polaris/engine/tela` ativa, e o arrastar nativo não existe em telas de toque.

**Soltar inválido (`polaris-sobre`)**: enquanto um botão `arrasta` passa sobre uma zona `solta`, a ilha dispara no contêiner o evento cancelável `polaris-sobre` com `{ valor, alvo, zona }`; se o hospedeiro chama `preventDefault`, o item sob o ponteiro leva `data-solta-zona="invalida"` e o soltar não é aceito (cursor de proibido). Sem ouvinte, tudo vale.

**Arrastar por toque**: a mesma ilha cobre o toque: pressão longa de 350 ms num botão `arrasta`, fantasma que segue o dedo, autorrolagem nas bordas, e o soltar dispara os mesmos `polaris-sobre` e `polaris-soltar` do mouse. Só em emulação de toque do Chrome foi verificado.

**Rodapé em faixas e grade assimétrica (tema Maison)**: `site/rodape` com `faixas: true` monta três faixas separadas por divisores: marca e frase à esquerda com o slot `topo` à direita (uma assinatura, um contato), as `colunas` (um item sem `href` é uma linha de texto, como e-mail e horário) e a faixa final com `copyright` e `legal` (links). Os campos e o botão do rodapé escuro vêm dos tokens `rodape.campo*`/`botao*`. `layout/destaque` aceita `ocupa` (colunas numa `layout/grade`) e `proporcao` (largura ÷ altura): uma grade de 12 colunas com faixas 7+5, 4+4+4 e 12 reproduz a vitrine assimétrica de coleções.

**Cabeçalho do template (tema Maison)**: em `site/cabecalho`, cada item de `grupos[].links` pode ter `descricao` (vira título + frase), `gruposAntes: true` põe os submenus antes dos links, e o submenu abre **no hover** quando o tema declara `cabecalho.submenuHover` (`grid` ou `block`; sem o token só abre no clique, como antes), em painel de `submenuColunas` colunas. `nav/link` aceita `rotulo` (aria-label) e `icone`: os ícones `sacola` e `coracao` (família Loja) servem aos botões do cabeçalho, com o contador como filho (`texto/pequeno`).

**Seletor e abas (tema Maison)**: `entrada/selecao` é a lista suspensa (`select` nativo, acessível, sem JavaScript próprio) com `entrada/opcao` como filhos; `valor` é o escolhido, `aoMudar` recebe o valor novo e a opção que combina com `valor` leva `selecionada` (é o que o servidor escreve; o runtime sincroniza o resto). `nav/menu` aceita `marca`. `site/abas` (pack de site) é a fileira de categorias: `itens` com `atual`, rola na horizontal sem barra visível. Uma barra fixa sob o cabeçalho é um `layout/linha` com `marca: "barra-fixa"` (tokens `barra.*`), com as abas à esquerda e, por exemplo, `texto/rotulo` + `entrada/selecao` dentro de uma `marca: "ordenar"` à direita.

**Gancho de estilo e zoom (tema Maison)**: `layout/pilha` e `layout/linha` aceitam `marca` (minúsculas, dígitos e hífen), que vira `data-marca` para o CSS do tema (o cartão de produto usa `cartao-produto`, `foto-produto`, `selo-produto` e `rotulo-produto`); `layout/destaque` com `zoom: true` faz a foto de fundo crescer, escurecer e o título subir no hover (tokens `movimento.zoomFaixa*` e `faixa*`).

**Capa e recorte (tema Maison)**: `layout/destaque` com `capa: true` vira a capa (hero) do site: o texto fica embaixo, a faixa sobe por baixo do cabeçalho (`cabecalho.altura`), a foto faz um zoom lento e o texto entra; com `altura: 800` ocupa a tela (`100svh`), com menos, no máximo a tela. `layout/pilha` e `layout/linha` aceitam `recorta: true` (corta o que passa da caixa): é onde a foto do cartão de produto cresce no hover (`movimento.zoomCartao`). Tudo opt-in e guiado por tokens do tema (`docs/temas.md`).

**Primitivas de layout para sites (tema Maison)**: `layout/contido` limita e centraliza o conteúdo (`largura`: estreita, normal ou larga; os valores vêm do tema em `layout.largura`, `layout.larguraEstreita` e `layout.larguraLarga`, com recuo no CSS base: 72, 48 e 90 rem); `texto/sobretitulo` é a linha pequena em caixa alta antes de um título (na cor primária, ou na do texto sobre uma foto); `midia/imagem` ganhou `fluida` (ocupa a largura do contêiner) e `proporcao` (largura ÷ altura, com corte por `object-fit: cover`); `layout/grade` ganhou `alinha` (alinhamento vertical das células); `layout/cabecalho` e `site/cabecalho` ganharam `centro` e `menuCentro` (o menu centralizado entre a marca e as ações); `commerce/cartao-produto` ganhou `fluida` e `proporcao` para a foto. No tema, a **escala tipográfica** é opcional: `tipografia.tamanhoH1`, `tamanhoH2` e `tamanhoH3` (padrão 2, 1,5 e 1,17 em), `tipografia.familiaTitulo` e `tipografia.pesoTitulo`; o grupo `layout` do schema do tema aceita as larguras acima. Nenhum tema existente muda: tudo tem valor padrão.
