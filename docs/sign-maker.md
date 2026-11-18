# Sign Maker (cartazes declarativos)

Um nó `kind: cartaz` descreve uma peça gráfica impressa (cartaz de oferta, etiqueta): elementos posicionados em **frações da página**. Do **mesmo layout calculado** saem **HTML** e **PDF**, e os dois são conferidos ponto a ponto num Chrome de verdade.
Pacote: `@polaris/signmaker`. Origem: a geração de banners do `easysync-banner-app` (preview React/canvas e `PdfBanner.ts` com pdf-lib, que eram **dois renderizadores independentes**). Aqui há **um** cálculo e dois desenhadores.

```
nó cartaz + dados ──layoutCartaz──▶ Layout (ops em pt: texto, ret, caminho, imagem) ─┬─▶ pdfDe()   (pdf-lib + fontkit)
   (JSON Schema)     (se, interpolação,                                              └─▶ htmlDe()  (elementos posicionados em pt)
                      ajuste de fonte, quebra)
```

## O nó
`spec`: `tamanho` (A4 | A5 | A6 | A7), `orientacao`, `titulo`, `fundo` (`cor`, `imagem` em data URL png/jpeg), `fonte` padrão, `dados` (nome → tipo, igual ao documento) e `elementos`.
Elementos (por enquanto): **`texto`**, **`faixa`**, **`preco`**, **`validade`**, **`codigoBarras`** e **`qrcode`**. Todo elemento tem `caixa` (`topo`, `esquerda` **ou** `direita`, `largura`, `altura`, em fração da peça), `se` (condição sobre os dados), `id` e `rotacao` (graus anti-horário, em torno do meio da borda esquerda da caixa).
- `texto`: modelo `{produto.nome}`, `{preco.por | brl}` (a mesma interpolação segura dos documentos), `alinhaH`, `alinhaV`, `cor`, `fundo` (RGBA), `fonte`, `quebra` (`normal` | `nenhuma`) e `tamanho.min/max`. **O tamanho da fonte é sempre ajustado para caber na caixa**: o maior tamanho (passo de 0,25 pt, busca binária) em que as linhas quebradas cabem em largura e altura. Se nem o mínimo cabe, usa o mínimo e o layout devolve um **aviso** (nunca corta em silêncio).
- `faixa`: retângulo com `cor`, `opacidade` e `raio` (fração do menor lado). Com raio ou rotação vira um **caminho vetorial** (o MESMO `d` SVG vai ao HTML e ao PDF).

- `preco`: `valor` (decimal EXATO em texto, ex. `{preco.por}`; vira reais com separador de milhar + `,cc`, sem passar por número de ponto flutuante; meio arredonda para cima; negativo e lixo são recusados), `centavos` (`escala`, padrão 0,6; `posicao`: `alto` alinha o topo dos centavos com o dos algarismos, `base`), `unidade` (texto miúdo sob os centavos, ex. `KG`, `m²`), `riscado` (traço diagonal para o preço antigo: use `centavos.escala: 1`) e o ajuste habitual (o bloco inteiro cresce até caber em largura e altura). As variantes `primary`/`secondary` do legado eram a mesma ideia com constantes empíricas por fonte; aqui são parâmetros e a régua é a altura real dos algarismos da fonte.
- `validade`: "VALIDADE __/__/____": rótulo (padrão `VALIDADE`) e três campos sublinhados (dia, mês, ano) separados por traços inclinados de 15°; com `data` (`dd/mm/aaaa`, ex. `{produto.validade}`) os números ficam centrados sobre os traços, sem ela o campo fica em branco para escrever à mão. O legado desenhava isto em canvas (só no preview) e à parte no PDF; aqui são texto e um caminho vetorial.
- **"Economize"** não é elemento: é uma composição de `faixa` (com `raio`) + `texto` "ECONOMIZE" + `texto` com o valor (o legado fazia assim, com uma imagem `economize.png` na variante primária). O conversor (S2) a expande.
- `codigoBarras`: `valor` (modelo), `formato` (`code128`, o mesmo padrão do jsbarcode do legado, ou `ean13`, com dígito verificador conferido), `numero` (`cima` | `baixo` | `nenhum`: o número legível, ajustado como todo texto), `rotulo`, `cor`, `fundo`, `raio` e `margem`. As barras são **um só caminho vetorial** (corridas de módulos escuros, sem pixel) e o valor inválido para o formato é recusado antes de gerar.
- `qrcode`: `valor`, `nivel` (L/M/Q/H), `cor`, `fundo`, `margem`; a matriz vem do `qrcode-generator` e vira um caminho vetorial por corridas.

## No Studio
O kind `cartaz` é editável como página, tema e formulário (`KINDS_DO_TENANT`). **Cartazes → Novo cartaz** cria uma peça; o editor tem três abas:
- **Elementos**: lista (adicionar `texto`, `faixa`, `preco`, `codigoBarras`, `qrcode`, `validade`; remover, subir, descer, duplicar), peça (tamanho, orientação, cor de fundo, título), propriedades do elemento selecionado (posição em fração, rotação, condição, conteúdo, alinhamento, cor, fonte) e a **prévia ao vivo**: o HTML do MESMO layout que gera o PDF, num `<iframe sandbox="">`, com a lista de **problemas** (dado não declarado, texto que não cabe, schema).
- **Dados de exemplo**: o JSON `exemplo` do nó, que alimenta a prévia (e nunca a geração real).
- **JSON**: a `spec` inteira, para `dados`, `calculos`, `cores`, `tamanhos` e fundo em imagem.
Salvar, histórico, comentários, releases e desfazer valem como nos outros kinds. A prévia é gerada no servidor (`POST /studio/previa` com `dados`); o CSP do Studio ganhou `font-src data:` (a fonte vai embutida no HTML da prévia).

## Lote
`layoutLote(itens)` / `geraLote(itens)`: vários cartazes num só HTML e PDF, **uma página por cópia**, na ordem dos itens. Cada item tem `no`, `dados`, `quantidade` (1 a 200), `tamanho` (sobrescreve o do nó) e `semFundo` (tira a imagem de fundo, a cor fica). Peças de tamanhos diferentes convivem: o PDF dá a cada página o seu tamanho e o HTML usa uma `@page` nomeada por tamanho. Limites: 200 itens, 500 páginas. Fail-closed: um item ruim recusa o lote inteiro e a mensagem diz **qual** (`item 2: dado obrigatório ausente…`); avisos de ajuste de fonte também levam o número do item. `test/lote.test.ts` confere a paridade Chrome × PDF de um lote com três tamanhos.
Ainda não há: várias peças pequenas na MESMA folha (imposição) nem marcas de corte.

## Dados derivados, condições, cores e tamanhos
- `calculos`: valores derivados em **decimal exato** (BigInt, sem `Number`), usados como `{calculo.nome}`: `diferenca(a,b)`, `diferencaPercentual(a,b)` (piso, como o legado), `percentual`, `desconto(preço, %)`, `parcela(preço, n)` (piso em centavos), `arredonda`, `identidade`. Argumento que não é número usa `padrao`; sem `padrao` é erro (nunca sai peça com buraco). Os dados de dinheiro passam a ser **decimais** (`"12.90"`), não centavos inteiros como no legado.
- `se` (e `cores[].se`): gramática fechada, sem avaliador: `caminho`, `!caminho`, `caminho == "x"`, `caminho != "x"`, `caminho em ["a", "b"]`. Protótipo nunca é lido.
- `cores`: cor condicional; a primeira condição verdadeira substitui `cor` (as variantes "monocolor" do legado).
- `tamanhos`: os tamanhos a que o layout serve; como as caixas são frações, o mesmo desenho vale para todos, e `geraCartaz(no, dados, { tamanho })` escolhe um.

## Conversão das configurações do legado
`converteConfiguracao(config, prefixo)` (`src/legado.ts`) lê o que o `easysync-banner-app` guarda por cliente (`globals`, `modifiers`, `complements`, `geometries`) e devolve **um nó `cartaz` por layout** (dinâmica × orientação, com a lista de `tamanhos`) mais um **relatório** do que não traduziu. Segue o MESMO caminho de resolução do legado (globals → complements por tipo → modifiers por nome → propriedades) e traduz: preço (variantes `Old` → `riscado`), código de barras, QR (o `size` em fração da largura vira altura proporcional à orientação), validade, "economize" (faixa + 2 textos), textos com `params`/funções (viram `calculos`), `$pow(M2)` → `m²`, visibilidade → `se`, cor por layout → `cores`. Script: `pnpm --filter @polaris/studio-app exec tsx ../../packages/signmaker/scripts/converte-legado.ts <repo-legado> <saida>`.
Resultado nos três clientes (curio, goiana, saojorge): **29 layouts**, todos válidos no schema, com layout calculável e **HTML ≡ PDF no Chrome em cada tamanho** (`test/legado.test.ts`, que só roda se o repositório do legado estiver ao lado, ou em `LEGADO_BANNER_DIR`). Os nós gerados **não** foram commitados (são layouts de clientes); o teste sintético `legado-sintetico.test.ts` cobre cada tradução sem depender do repositório.
Não convertido, e dito no relatório: layouts só de **EP21** (tamanho que o Sign Maker ainda não tem), fontes **Primary/Secondary** (trocadas por Montserrat), a imagem `economize.png`, mais de uma condição de visibilidade por elemento, `background` dentro de cor condicional, e **os fundos por layout** (vêm do backend). Os dados de dinheiro passam a ser **decimais**, não centavos.

## Por que as saídas coincidem
Quebra de linha, tamanho de fonte e posições são decididos **uma vez**, no layout, com as métricas das mesmas TTF que vão embarcadas no PDF e referenciadas no HTML; kerning e ligaduras ficam **desligados** nas duas. Texto girado: o layout já entrega o canto da linha girado; o HTML gira em torno dele e o PDF gira em torno da linha de base (calculada). **O texto do HTML é SVG** (`<text x y>`): a linha de base é posicionada exatamente, sem a caixa de linha do HTML, cujo ascendente/descendente o Chrome arredonda para pixel inteiro (isso dava 0,5 pt de erro vertical no HTML comum). No teste, o Chrome é medido pelo que ele **posicionou** (`getStartPositionOfChar`), não pela caixa dele, que é arredondada.
`test/paridade.test.ts` abre o HTML no Chrome e rasteriza/lê o PDF com o poppler: palavras nas mesmas posições (≤ 1 pt; o texto **girado** só é conferido por pixel, porque o poppler o fragmenta) e pixels comparados em blocos (média < 3,2/255; < 0,4% dos blocos com diferença > 60). Casos: A4/A5/A6/A7, retrato e paisagem, nome longo, elemento condicional, e um "variado" (girado, translúcido, arredondado, alinhamentos, duas fontes). O teste do **detector** reprova 1,5 pt de deslocamento, cor trocada, texto trocado e 3° de giro. Requer Chrome e `poppler-utils`; localmente é pulado sem eles e no CI falha (`CI`). `PARIDADE_SALVA=<dir>` grava os PNG lado a lado.

## Fontes
Montserrat (OFL) e Roboto (Apache 2.0) estão no repositório. As fontes `Primary` (Helvetica Neue LT 97 Black Condensed, © Adobe) e `Secondary` (CartazistaPRO) que os layouts legados usam são **proprietárias**: não vão ao repositório e precisam ser entregues como ativo do tenant (card S10). Pendência: texto integral da OFL em `fontes/`.

## Limites assumidos (até aqui)
- Faltam sobrescrito (`$pow`), texto justificado e o tamanho EP21: cards S7, S3, S11.
- Código de barras e QR: os testes provam que o desenho **é** a matriz de módulos do gerador (e a paridade Chrome × PDF), mas **nenhum leitor real** (zbar, OpenCV, câmera) foi usado para decodificar: não há decodificador instalado aqui. Antes de imprimir em produção, leia uma amostra com um leitor físico.
- Os fundos do legado (`filename`) vêm do backend e não estão no repositório: o fundo aqui é cor ou data URL.
- A semântica de caixa/rotação/ajuste é a **deste** motor, mais limpa que a do legado (que usava fatores empíricos como 0,93 e 1,045); o conversor das configurações (S2) traduz as geometrias e o resultado será conferido visualmente.
- O editor do Studio não baixa o PDF (a prévia é o HTML, que o teste prova igual ao PDF); o PDF vem da API/biblioteca (`geraCartaz`, `geraLote`). Não há arrastar-e-soltar na prévia.
