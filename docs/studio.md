# Polaris Studio (editor visual por schema)

O Studio edita **nós** (páginas e temas) e a saída é sempre o nó em JSON, validado pelo schema e gravado como **versão imutável** (E7). E **o próprio Studio é uma página da plataforma**: nós JSON (`kind: pagina`, `dados`, `servico`) compilados pelo mesmo compilador e executados pelo mesmo runtime vivo que renderizam as páginas dos tenants (E12). Não há SPA escrita à mão.

```
packages/packs/nos/studio/
  servico.json         o CONTRATO da API de autoria, declarado como `servico studio` (operações, entradas, saídas)
  pagina-studio.json   os nós `dados` (uma fonte por operação) e a página `studio.app` (estado, ações, blocos)  ← GERADO
  papeis.json          studio.leitor ⊂ studio.comentarista ⊂ studio.editor
apps/studio/paginas/   o DSL em TypeScript que ENCURTA a escrita do JSON (pnpm --filter @polaris/studio-app paginas); um teste garante que o JSON é exatamente o gerado
apps/studio/src/host/  o hospedeiro: carrega o programa compilado, resolve os dados `auto` e monta a página; traduz `servico studio` → REST com o token
packages/packs        rotasStudio: API de autoria `/studio/*` (sessão → tenant/autor, versões, 409, diff, comentários, prévia)
packages/studio       diff semântico, auditoria/validação de tema, âncoras de comentário (núcleo puro, sem UI)
```

**O que a plataforma ganhou para isso** (tudo genérico, não específico do Studio): blocos `entrada/area` (texto de várias linhas) e `midia/quadro` (iframe **sempre** com `sandbox=""`), e as funções `percorre` (percorre uma árvore de instâncias, com caminhos prontos para `com`/`sem`/`insere`), `camposDoSchema` (campos de um JSON Schema, base de formulários gerados) e `paraNumero` (texto → número). As demais funções de edição (`com`, `sem`, `insere`, `move`, `difere`, `aplica`, `inverso`) já existiam.

## O que faz
- **Editor de páginas**: árvore de blocos (adicionar, remover, subir/descer), **formulário gerado do JSON Schema das props** do bloco (`camposDoSchema`; campo texto, número, caixa e escolha), **prévia** gerada no **servidor** com o mesmo compilador e renderizador da produção sobre o **rascunho** (num quadro `sandbox=""`; erros do compilador aparecem listados), desfazer/refazer (digitar num campo é um passo só).
- **Editor de tema**: tokens de cor, espaçamento e raio (adicionar, editar, remover), amostra ao vivo, **auditoria de contraste WCAG** (4,5:1 texto, 3:1 UI) junto da prévia, e **validação dos valores no servidor** antes de gravar (cor `#hex`/`rgb()`/`hsl()`, medida `8`/`0.5rem`: um valor que o schema aceita mas o CSS não vira 422).
- **Histórico e diff**: lista de versões (quem, quando, nota), **diff semântico** entre duas versões ou contra o padrão, restaurar uma versão no editor (vira edição desfazível; só grava ao salvar). Criar página ou tema novo (rascunho que só existe no servidor depois de salvar).
- **Comentários**: do nó ou **ancorados no bloco selecionado** (pelo id), com respostas e "resolvido". Se o bloco some, o comentário continua legível (nunca é reancorado por posição).

## Imagens
O botão **Imagens** abre o envio e a lista das imagens do tenant (miniatura, dimensões, caminho para usar no hero, remover): veja `docs/imagens.md`.

## Cartazes (Sign Maker)
O Studio edita o kind `cartaz` com prévia ao vivo: veja a seção "No Studio" de `docs/sign-maker.md`.

## Diagramas
O botão **Diagramas** abre um painel (abaixo dos seletores) com dois desenhos gerados do JSON **no servidor** (`POST /studio/diagrama`, permissão `studio.ver`) e mostrados no mesmo quadro isolado da prévia (`<iframe sandbox="">`, sem script):
- **Fluxo da aplicação**: colunas *Páginas → Formulários → Dados → Serviços*. As ligações vêm do que os nós declaram: `href` dos links e ações `navegar` (a rota com parâmetro, como `/produtos/:id`, casa), o bloco `form/formulario` da página, os `dados` da página, o `envio` do formulário (serviço e operação), as ações `navegar` do formulário, a `fonte` dos dados e a `guarda` da página (tracejada, para a rota de login do tenant). Link para rota que **nenhuma página tem** vira um nó vermelho tracejado "sem página" e um aviso. Link externo e destino calculado (`{…}`) ficam fora. Vale o que o tenant tem (cabeças sobre a base); o de outro tenant nunca aparece.
- **Blocos da página aberta**: a árvore `spec.raiz` do **rascunho** (não do salvo), da esquerda para a direita, com o slot (quando não é `filhos`), o texto principal, `se`/`repetir` e o bloco selecionado em destaque.
Código em `packages/studio/src/diagrama.ts` (núcleo puro, todo texto escapado, limites: 300 blocos, 80 páginas, 600 ligações; acima disso o desenho é cortado e avisa). **Limites**: sem arrastar, sem clicar no diagrama para selecionar, sem exportar imagem; o fluxo mostra o que está **declarado** (links montados por expressão não aparecem); o desenho não é atualizado sozinho ao editar (clique de novo no botão).

## Diff semântico
Não é diff de texto. Blocos casam por **id** (sem id: posição e tipo no mesmo pai). Mover um bloco é `movido` (de `A › b` para `A › c`), não remoção + adição; trocar a ordem entre irmãos é `reordenado` (pela maior subsequência comum, então só o mínimo é apontado); subárvore adicionada/removida aparece **uma vez**, com a contagem de blocos dentro; prop alterada mostra **qual** prop, antes e depois. O resto do nó (rota, título…) é diff campo a campo; `versao` é ignorada.

## API de autoria (`rotasStudio`)
Tenant e autor vêm **sempre da sessão** (`autentica` é injetado); corpo com `autor`/`tenantId` é 400. Permissões `studio.ver`, `studio.comentar`, `studio.editar`.
`GET /studio/blocos` · `GET /studio/nos` · `GET|PUT|DELETE /studio/nos/:kind/:id` · `GET /studio/historico/…` · `GET /studio/versao/…?seq=` · `GET /studio/diff/…?de=&para=` (`base` = padrão) · `GET|POST /studio/comentarios` · `POST /studio/comentarios/:id/resolver`.
**Concorrência otimista**: o `PUT` leva `baseSeq` (a versão que o editor abriu); se outra pessoa salvou depois, **409** com quem e qual versão, e nada é sobrescrito. Respostas com `cache-control: no-store`.

## Segurança
- A **prévia** roda num `<iframe sandbox="">` (sem scripts, formulários nem navegação; origem opaca) com HTML gerado no servidor pelo engine (texto escapado); o bloco `midia/quadro` nunca deixa uma prop abrir o sandbox (o schema nem aceita a prop). Teste: `<img onerror>` e `<script>` viram texto.
- **CSP** do Studio: `default-src 'none'`, `frame-ancestors 'none'`, scripts só `'self'` e **sem `unsafe-eval`** (as expressões da plataforma viram closures; não há Ajv no navegador). `unsafe-inline` só em **estilo** (o runtime usa `style` em atributos e o `srcdoc` da prévia herda a política e precisa do `<style>` do tema).
- A prévia é gerada **no servidor** (`/studio/previa`): o id do bloco selecionado é validado na borda antes de virar CSS, e os blocos do tenant vêm do armazém dele (nunca de outro).
- Comentários e textos são guardados e exibidos como texto; o `CHECK` do banco limita o tamanho.
- O tema é validado no servidor **antes de gravar**: cor ou medida que o schema aceita (texto livre) mas o CSS não, inclusive injeção como `#fff; } body {…`, vira 422.

## Atrás do gateway (produção)
`POLARIS_STUDIO_DIR` (no compose: `/app/dist/studio`, que o `empacota` preenche) liga `/studio` (página e ativos) e `/studio/*` (API) **no próprio gateway**, que exige `DATABASE_URL_PLATAFORMA`. Sem a variável, `/studio` é 404.
- **Identidade**: o JWT do gateway. Tenant e usuário (o `sub`, que vira o **autor** das versões e comentários) vêm só do token; tenant suspenso ou host de outro tenant = 401. Corpo com `autor`/`tenantId` é 400.
- **Permissão** por papéis do pack `studio`: `studio.leitor` ⊂ `studio.comentarista` ⊂ `studio.editor` (mesma semântica de acesso dos serviços: papel desconhecido não dá nada; papéis de outros domínios, como `gerente`, também não).
- **nginx**: `location /studio` repete os cabeçalhos de transporte e **não** a CSP genérica (que quebraria o Studio); a CSP é a do próprio Studio. Mesmo limite de taxa da API.
- Testado em `apps/polaris/test/e2e.test.ts` (gateway real, JWT, Postgres) e `tools/ferramentas/test/deploy.test.ts`. O nginx continua sem `nginx -t` real (ver `docs/deploy.md`).

## Rodar
`pnpm local` e abra http://localhost:3000/entrar (veja `docs/ambiente-dev.md`): sobe o gateway com o Studio, tenants de demonstração e um login de desenvolvimento.

## Limites assumidos
- **O login não existe aqui**: o gateway valida o JWT, mas quem o emite é o provedor de identidade. O Studio recebe o token no fragmento da URL (`/studio#token=…`), guarda em `sessionStorage` e apaga o fragmento; **falta o fluxo de login do provedor que redireciona para lá**. O login de desenvolvimento (`pnpm local`) emite o JWT localmente e recusa produção; os testes usam um stub por cookie.
- **Menos recursos que a SPA React que ele substituiu**: sem duplicar bloco, sem recuar/avançar (mover para dentro/fora de outro bloco), sem **modos** de tema (escuro…), sem editar props de tipo estruturado (objeto/lista: aparece "edite no JSON do nó"), sem atalhos de teclado (Ctrl+S/Z), sem selo de comentários na árvore, comentários em lista plana (respostas com `↳`, sem fios agrupados), e sem validação de slot no cliente (aceita/máx/mín só aparecem como erro de compilação na prévia).
- Desfazer guarda **snapshots** do nó (até 60); a linguagem tem `difere`/`inverso` para patches, mas o Studio ainda não os usa.
- Salvar é **rascunho**: o nó vira a "cabeça" do tenant. O botão **Publicar** (`POST /studio/publicar`, permissão de editor) cria uma release com as cabeças de hoje e a promove: é só então que o site do tenant muda. Páginas criadas pelo tenant e com rota são servidas sozinhas, sem constar em `paginas` do nó `tenant` (se colidirem com uma rota declarada, vale só o declarado). O botão **Releases** abre o painel: a release em produção, as anteriores, as **diferenças** entre a produção e cada uma (`+` nó adicionado, `−` removido, `~` com versão diferente) e **Voltar** para a anterior ou para uma release escolhida (`GET /studio/releases`, `GET /studio/releases/diff`, `POST /studio/releases/voltar`; voltar é trocar o ponteiro, nada se apaga, e exige editor). Em cada release, **Link de pré-visualização** (`POST /studio/releases/preview { release, horas? }`, 24 h por padrão, até 168 h; quem comenta pode emitir) gera um link assinado: abri-lo no site do tenant grava um cookie `polaris_preview` (HttpOnly) e o site passa a mostrar **aquela release**, com uma faixa "Pré-visualização da release N · sair" e `x-robots-tag: noindex`; `/_polaris/preview/sair` encerra. O link só vale no tenant que o emitiu e nunca altera a produção; o Studio não tem botão de publicar. Salvar com erro de compilação é permitido (a prévia lista os erros).
- A prévia não busca `spec.dados`: blocos ligados a dados externos aparecem vazios. Clicar na prévia não seleciona o bloco (a seleção é pela árvore).
- Só páginas e temas (documentos, blocos compostos e papéis não têm editor). Sem arrastar e soltar.
- Dois editores no mesmo nó **não** se fundem: o segundo a salvar recebe o conflito (sem merge de três vias).
- Comentários não podem ser editados nem apagados; só resolvidos. Sem notificações.
- Acessibilidade: nome acessível dos campos e do quadro e foco por teclado são verificados por teste; **não** houve auditoria com leitor de tela, e a árvore de blocos é uma lista de botões (sem navegação por setas).
- O hospedeiro carrega o runtime inteiro (~450 KiB, sem divisão de código) e o **programa** compilado da página (~190 KiB). Cada edição chama o servidor para a prévia (sem debounce).

## Tema do site
Ao abrir um tema salvo (ou da plataforma), o botão **Usar este tema no site** chama `PUT /studio/site { tema }`: grava um override do nó `tenant` do tenant (copiando o que ele já declara e trocando só `tema`, com a versão incrementada) e o site muda **na próxima publicação**. `GET /studio/site` devolve o tema atual e os temas disponíveis. O armazém só aceita o nó `tenant` por esse caminho (a rota genérica de nós continua recusando). Sem escolha, vale o tema `padrao` (e editar o `padrao` do tenant também vale).

## Restaurar o padrão e alterações não salvas
- **Restaurar o padrão** (nó personalizado): pede confirmação, grava uma lápide (`DELETE /studio/nos/:kind/:id`; o histórico continua) e fecha o editor; o site só muda depois de **Publicar**.
- Com alterações não salvas, clicar em outro nó **não descarta em silêncio**: aparece "Há alterações não salvas… Descartar e abrir?" (ou "Continuar editando"). Criar um nó novo ("Nova página"/"Novo tema" → Criar) também pede confirmação ("Descartar e criar").

## Prévia
A prévia tem seletor **claro/escuro** (`modo` em `POST /studio/previa`); o padrão é o claro, para que o que você edita nos tokens apareça. Os nós `dados` que a página referencia vão junto, mas os dados em si não são buscados no editor.

## Formulários
O Studio também edita `kind: formulario` (campos, máscaras, validação, mensagens, prévia, problemas e teste com valores): veja `docs/formularios.md#editor-no-studio`.

## Login
O Studio usa a **sessão do cookie** do site (o cabeçalho `x-polaris-studio: 1` autoriza o cookie na API do Studio, que continua aceitando o token no fragmento em desenvolvimento). Sem sessão, manda ao `/entrar` e volta. As permissões vêm dos papéis `studio.*` do usuário (`docs/identidade.md`).

## Redesenho (painel com menu lateral)
O Studio agora é montado com os blocos do site: `layout/painel` com o **cabeçalho** (`site/cabecalho`: marca e as ações do rascunho aberto: Desfazer, Refazer, Salvar, Publicar e o estado) e o **menu lateral** (`site/menu-lateral`) com as **ferramentas** (Releases, Imagens, Diagramas) e uma seção por tipo de nó (páginas, temas, formulários, cartazes): os nós do tenant e os padrões, o **aberto marcado** (`aria-current`) e o botão de criar. O conteúdo fica no `layout/principal`. Os botões usam as **variantes** do tema (cheio só em Salvar, Publicar e Criar). O hospedeiro carrega o **CSS do tema** (`dist/tema.css`, gerado no build) e monta a página em `#polaris`, como o site do tenant. No celular a lateral recolhe atrás do botão "Nós e ferramentas".
O Studio usa os **ícones Grafite** nos botões do cabeçalho (desfazer, refazer, salvar, publicar), nas ferramentas e nos nós do menu lateral (um ícone por tipo: página, tema, formulário, cartaz) e nas abas do editor.

## Paleta de blocos (editor de páginas)
No lugar da lista de botões "+ bloco" do painel direito, o editor tem uma **paleta horizontal** acima da árvore: uma linha de **categorias com ícone e contagem** (Layout, Texto, Navegação, Formulário, Entrada, Mídia, Dados, Feedback, Site e **Outros**, que junta o que nenhuma cobre: `core`, `commerce` e blocos do tenant) e um campo **Buscar bloco** (em todas as categorias, sem acento, por id, título e resumo). Escolher uma categoria abre a lista com o **ícone, o título e o resumo** (a primeira frase da descrição do bloco, calculada pela API `/studio/blocos`, junto do nome do `icone`); clicar de novo na categoria fecha. O texto à esquerda diz o destino: o bloco entra **dentro** do selecionado quando ele declara slots, e **logo depois dele, no mesmo pai** quando não declara. Depois de adicionar, a lista fecha; o Desfazer volta um passo.
- **Limites**: o agrupamento é por prefixo do id (um bloco novo de um tenant cai em "Outros" até ganhar categoria no DSL do Studio); o teclado da paleta é do hospedeiro do Studio (`apps/studio/src/host/main.ts`), não do JSON da página: ele reconhece a barra e a lista pelos papéis ARIA (`toolbar` "Paleta de blocos" e `group` "Blocos da categoria"); o destino "dentro" usa o slot `filhos` ou o primeiro que o bloco declara; a ordem dentro de cada categoria é a do registro.
- **Teclado da paleta**: na barra, **←/→** andam entre as categorias (com volta), **↓** abre a categoria e entra no primeiro item (ou só entra, se já está aberta) e **Esc** fecha a lista; na lista, **←/→/↓/↑** andam entre os itens (com volta; **↑** no primeiro volta à categoria), **Home/End** vão ao primeiro e ao último, **Enter** ou **Espaço** adicionam e **Esc** fecha e devolve o foco à categoria; no campo de busca, **↓** entra nos resultados e **Esc** limpa o termo. Os blocos `layout/linha` e `layout/pilha` ganharam `papel` (`toolbar`, `group`, `list`) e `rotulo` para dar nome e papel a esses grupos.

## Paletas dos editores de formulário e de cartaz
O mesmo padrão da paleta de blocos vale nos outros editores. **Formulário**: "Paleta de campos" com seis categorias de ícone e contagem (Texto 5, Documentos 3, Números 2, Data 1, Escolha 3, Estrutura 2), lista da categoria aberta com título e resumo e o destino escrito à esquerda ("ao fim do formulário" ou "dentro de" do grupo ou lista selecionado). **Cartaz**: "Paleta de elementos", uma barra de seis botões com ícone (Texto, Faixa, Preço, Código de barras, QR code, Validade) que adiciona direto, sem lista. O teclado é o da paleta de blocos (o hospedeiro reconhece as paletas por `toolbar` "Paleta de…" e `group` "… da categoria"); na de cartaz só as setas andam, e ↓ não adiciona nada. Os botões "+ tipo" antigos saíram; os tipos de campo ganharam nomes em português ("E-mail", "Sim ou não", "Múltipla escolha").
- **Limites**: as categorias e os resumos dos campos são fixos no DSL do Studio (um tipo de campo novo precisa entrar lá); a posição inicial de cada elemento novo do cartaz segue os padrões de antes.

## Painéis de propriedades em seções
Os painéis do lado direito dos três editores agora são **seções recolhíveis com ícone** (`layout/secao`), cada uma com um tema: **página** (Identificação, Propriedades do bloco), **campo do formulário** (Geral, Máscara, Validação, Opções, Mensagens de erro, esta última começa **fechada**) e **elemento do cartaz** (Identificação, Posição e tamanho, Conteúdo, Aparência). As seções que só valem para certos tipos (máscara, validação numérica ou de texto, opções) continuam aparecendo só quando fazem sentido. O estado aberto ou fechado é do navegador: ao trocar a seleção a seção volta ao padrão.

## Releases, Imagens, Diagramas e Histórico
As telas de ferramentas usam **cartões** (`layout/cartao`), **selos** de estado e botões com **ícone**: **Releases** (um cartão para a produção, com o selo "Em produção" ou "Sem release" e o botão de voltar à anterior; um cartão por release, com o selo na atual e os botões de diferenças, link de pré-visualização e voltar; o link e as diferenças em cartões); **Imagens** (um cartão para enviar e uma **grade de três colunas** com um cartão por imagem: miniatura de 96 px, nome, dimensões, caminho, versões e Remover com o ícone de lixeira); **Diagramas** (a barra "Tipo de diagrama" com o tipo aberto marcado, o desenho num cartão e os avisos como alertas); **Histórico** (um cartão por versão com De, Para e Restaurar no editor; a versão escolhida em De e Para fica marcada; a comparação em cartão com um selo por tipo de mudança: verde para adicionado, vermelho para removido, âmbar para o resto; um cartão por comentário). Os textos e os nomes dos botões não mudaram.
