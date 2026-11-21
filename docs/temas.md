# Temas e design tokens

Um tema é um nó `kind: tema` (`tokens` + `modos`), emitido como CSS por `emite(no, 'css')`. O Polaris acrescenta (`packages/engine/src/tema/`): tokens semânticos, o importador do tema do tiffany-erp, a folha de estilo dos blocos e a auditoria de contraste.

## Tokens (viram variáveis CSS `--grupo-nome`)
| Grupo | Tokens |
|---|---|
| `cor` | `primaria`, `primariaHover`, `primariaClara`, `secundaria`, `destaque`, `fundo`, `superficie`, `superficieAlt`, `borda`, `texto`, `textoSuave`, `sucesso`, `alerta`, `erro`, `textoSobrePrimaria` |
| `raio` | `pequeno`, `grande` (px) |
| `espacamento` | `base` (rem), `borda` (px) |
| `tipografia` | `familia`, `tamanhoBase` |

`modos.escuro` redefine só o que muda (as cores). Sai como `[data-modo="escuro"]` (escolha explícita no `<html>`) e como `@media (prefers-color-scheme: dark)` para `:root:not([data-modo])` (segue o sistema quando não há escolha).

## Do tiffany-erp
`temaDeConfig(id, config, { escuro? })` converte o `ThemeConfig` do Tiffany (`primary`, `bg`, `surface`, `textMuted`, `radius`, `spacingBase`…) em nó `tema`: cores renomeadas para o vocabulário semântico, `spacingBase` (rem×100) vira `espacamento.base`, geometria limitada nas mesmas faixas do DTO. As paletas `patria-blue`, `nco-red` e `graphite` vêm como dado (`PRESETS_TIFFANY`) e são registradas por `registraTemas(registry)`, junto do tema **`padrao`** (claro = patria-blue, mais um modo escuro próprio).

## Como a página recebe o tema
- **Escolha**: `tenant.spec.tema` (o tenant aponta um tema) ou `padrao`. Como é um nó comum, vale a cascata tenant → segmento → core: um tenant pode registrar `tema` com id `padrao` no próprio escopo e trocar tudo.
- **AOT**: `construirAot` escreve `tema.<hash>.css` (variáveis + folha dos blocos) uma vez por tema e contexto, liga com `<link rel="stylesheet">` nas páginas estáticas e vivas e lista no manifesto (`arquivos.tema`). Reconstruir sem mudar o tema não reescreve nada. `semTema: true` desliga.
- **Streaming/estático**: `streamVivo({ estilos: [href], modo })` e `documentoEstatico({ estilos, modo })`; o `<link>` vai no `<head>`, antes do corpo.
- **CSP**: a folha vem de arquivo (`style-src 'self'`), sem `<style>` inline. Os blocos de layout ainda emitem `style=""` para `gap`, `colunas` e `tamanho` (valores livres), por isso `style-src-attr 'unsafe-inline'` continua necessário (ver `seguranca.md`).

## Folha dos blocos (`BASE_CSS`)
Escrita só com variáveis (conferido: nenhuma cor literal, e todo `var(--x)` que ela lê é declarado por todos os temas). Prende-se às tags e atributos semânticos que os blocos emitem dentro de `#polaris` (`button`, `input[type=…]`, `table`, `span[data-tom]`, `div[role=alert]`…), então um bloco novo não precisa de classe.

## Acessibilidade
`auditaTema(no)` confere em cada modo os pares críticos (AA: 4,5 para texto, 3 para UI): texto/fundo, texto/superfície, texto suave, texto sobre primária (também no hover), link primário/superfície, selos de sucesso/alerta/erro. O tema `padrao` passa nos dois modos (teste). **Achado nos presets do Tiffany**: `nco-red` tem link primário sobre superfície escura com contraste 3,06 (mínimo 4,5); fica registrado em teste, e quem usar esse preset deve ajustar `primaria` ou usar `primariaClara` para texto.

## Tokens opcionais de tipografia e de layout
Além de `cor`, `raio`, `espacamento` e `tipografia.familia`/`tamanhoBase`, um tema pode declarar `tipografia.familiaTitulo`, `pesoTitulo`, `tamanhoH1`, `tamanhoH2` e `tamanhoH3` (os títulos usam a fonte do corpo e os tamanhos 2, 1,5 e 1,17 em quando faltam) e o grupo `layout` com `largura`, `larguraEstreita` e `larguraLarga` (o bloco `layout/contido`; recuo no CSS base: 72, 48 e 90 rem). Exemplo completo: `exemplos/maison` (`gera.mjs`).

### Cabeçalho, rodapé, botão e movimento (tokens opcionais)
Cada token vira uma variável CSS lida pelo CSS base **com fallback para o visual de antes**: um tema que não os declara não muda.

| Grupo | Tokens | Efeito |
|---|---|---|
| `cabecalho` | `altura`, `fundo`, `desfoque` (ex.: `blur(4px)`), `borda`, `marcaTamanho`, `marcaPeso`, `marcaEspacamento`, `marcaFamilia`, `marcaHover`, `linkTamanho`, `linkEspacamento`, `linkCaixa`, `linkCor`, `linkHover`, `sublinhaHover` | cabeçalho translúcido com desfoque, marca e links tipográficos; `sublinhaHover: 1` liga o sublinhado que cresce no hover |
| `rodape` | `fundo`, `texto`, `link`, `borda`, `marcaTamanho` | rodapé invertido ou de outra cor |
| `botao` | `caixa`, `espacamento`, `tamanho`, `peso` | botões e links de botão (ex.: caixa alta com espaçamento) |
| `movimento` | `rapido` (cor, fundo e borda), `sublinha`, `zoomDuracao` e `zoomCartao` (escala da foto do cartão no hover), `fotoAlt` (fade da 2ª foto), `rotulo` (rótulo sobre a foto), `zoomFaixa`, `zoomFaixaDuracao`, `faixaVeu`, `faixaVeuDuracao`, `faixaTexto`, `faixaElevacao` (faixa com `zoom`), `entrada` (entrada do texto da capa), `zoomCapa` (zoom lento da capa) | sem eles não há transição |
| `abas` | `gap`, `altura`, `recuoX`, `recuoY`, `tamanho`, `peso`, `espacamento`, `caixa`, `cor`, `corHover`, `fundoHover`, `corAtiva`, `fundoAtiva` | `site/abas`: a fileira de categorias (a ativa preenchida) |
| `barra` | `topo` (padrão: a altura do cabeçalho), `fundo`, `desfoque`, `borda`, `recuoX`, `recuoY`, `gap`, `rotuloTamanho`, `rotuloEspacamento`, `rotuloCaixa`, `rotuloCor` | a barra fixa (`layout/linha` com `marca: "barra-fixa"`) e o rótulo "ordenar por" |
| `selecao` | `largura`, `altura`, `tamanho`, `espacamento`, `fundo` | `entrada/selecao` |
| `layout` | `largura`, `larguraEstreita`, `larguraLarga`, `recuo`, `recuoEstreito` | o contêiner (`layout/contido`): largura máxima e recuo lateral |
| `cartao` | `tituloTamanho`, `tituloAltura`, `tituloEspacamento`, `tituloHover`, `categoriaCor`, `categoriaTamanho`, `categoriaEspacamento`, `descricaoTamanho`, `precoTamanho`, `precoPeso`, `precoEspacamento`, `seloFundo`, `seloTexto`, `seloMargem` | o cartão de produto (`commerce/cartao-produto`) |
| `tipografia` | `tamanhoExibicao`, `alturaExibicao`, `espacamentoExibicao` (o `h1` da capa), `alturaTitulo`, `espacamentoTitulo` (todos os títulos), `alturaCorpo` (parágrafos), `tamanhoSobretitulo`, `espacamentoSobretitulo`, `margemSobretitulo` | escala tipográfica fina |

### Fontes embutidas
`spec.fontes: ["cormorant-garamond", "inter"]` pede fontes **embutidas na plataforma** (lista fixa em `packages/engine/src/fontes`, subconjunto latino, fonte variável, licença OFL: `packages/engine/fontes/LICENCAS.md`). O gateway emite o `@font-face` (`font-display: swap`) e serve cada arquivo como ativo da **própria origem** (`/_polaris/a/<hash>.woff2`, cache eterno), então a CSP não muda (`font-src 'self'`). Nome desconhecido é ignorado e a pilha do sistema vale. Fontes só do tenant (upload) não existem; as builds estáticas (AOT) e o catálogo ainda não embutem o arquivo.

`seguirSistema: false` (no spec do tema) tira o `@media (prefers-color-scheme: dark)`: o escuro só vale com `data-modo="escuro"` no `<html>`. Os valores passam pela mesma validação de CSS dos outros tokens (sem `url(`, `;` ou comentários); use `var(--cor-…)` para derivar das cores do tema (`color-mix(in srgb, var(--cor-fundo) 80%, transparent)`). As animações respeitam `prefers-reduced-motion`.
