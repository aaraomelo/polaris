# Biblioteca base de blocos

34 blocos nativos (mais o `core/slot`). Cada um tem **schema** (`BLOCOS_BASE`, em `render/base.tsx`), **componente React** (oráculo) e **descritor DOM** (`vivo/blocos.ts`, usado pelo servidor e pelo cliente do runtime vivo; o emissor estático deriva dele). `test/blocos-base.test.tsx` confere, por bloco: React × HTML estático × HTML do vivo × montagem no cliente × hidratação (mesmos nós), e as props dinâmicas.

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
