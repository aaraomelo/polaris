# Desempenho: o que foi medido e o que decide o próximo passo

Reproduzir: `pnpm --filter @polaris/engine bench` (SSR e expressões; use `NODE_ENV=production`, senão o React carrega o build de desenvolvimento, bem mais lento, e o custo do React fica inflado) e `... perfil` (CPU profile por função). Máquina de desenvolvimento, Node 24; os números valem pelas **proporções**, não em valor absoluto.
Página de teste: lista de cartões (bloco composto com 3 blocos nativos e 2 bindings por cartão). Fica fora desta medição: o custo de hidratação no navegador (precisa de um navegador real; ver "Falta medir").

## 1. Onde o tempo ia (SSR, produção, 1000 cartões, antes das correções)
| Parte | Tempo | Parcela |
|---|---|---|
| SSR completo | 55,0 ms | 100% |
| `renderToString` do React | 2,3 ms | **4%** |
| nosso interpretador (inclui o `brl`) | 54,5 ms | 99% |
| `toLocaleString` dentro do `brl` (1000 chamadas × 33 µs) | ~33 ms | **~60%** |

**O React não era o gargalo. Era `toLocaleString`**, que cria um formatador `Intl` novo a cada chamada (33 µs) quando reaproveitar um custa 0,43 µs.

## 2. Correções feitas
| Correção | Antes | Depois |
|---|---|---|
| Formatadores `Intl` criados uma vez (`brl`, `numero`, `pct`, `data`, `dataHora`) | SSR 1000 cartões: 55,0 ms · 200 cartões: 12,3 ms | **13,5 ms (4,1×)** · **3,7 ms (3,3×)**; `avalia`+`brl` 35 µs → 0,77 µs |
| `sugere` movido para um módulo sem dependências (o navegador importava o Ajv por causa dele) | cliente de hidratação: **182 KB gz**; só o avaliador de expressões: **46 KB gz** (94% era Ajv) | **138 KB gz** (−24%); avaliador: **3,3 KB gz** (47× menor) |

Guardas (para não voltar): `test/bundle.test.ts` (nada de Ajv/schemas/QuickJS no navegador; orçamento em KB gz) e o teste de equivalência dos formatadores com `toLocale*` (saída idêntica).

## 3. O que sobra (SSR, 1000 cartões, 13,5 ms, produção)
| Parte | Tempo |
|---|---|
| interpretador → elementos React | 9,5 ms |
| `renderToString` | 2,4 ms |
| protótipo **IR → string direto, sem React** (mesma saída, conferida byte a byte) | **4,3 ms (3,2×)** |

O perfil está **plano**: nenhuma função passa de ~9% do tempo (a maior é o `um` do interpretador); o React inteiro soma ~14%.

## 4. Cliente (bundle de hidratação, minificado)
| Parte | min | observação |
|---|---|---|
| `react-dom` | **403 KB** (~135 KB gz) | ~90% do JavaScript enviado |
| nosso engine (runtime, ações, streaming, blocos base) | 30 KB (~10 KB gz) | |
| `react` + `scheduler` | 11 KB | |
| QuickJS (só se a página tem código `puro`) | 50 KB + WASM 491 KB (226 KB gz) | subpath separado |

## 5. Sobre "JSON direto para WebAssembly"
Cruzar a fronteira em bloco é barato: `JSON.parse` de 44 KB = 0,22 ms; codificar 127 KB para a memória do WASM = 0,07 ms; decodificar de volta = 0,007 ms.
Mas o que a renderização faz é **montar strings, acessar propriedades e formatar com `Intl`**, e é nisso que o V8 já é bom. WASM não tem strings nem objetos gerenciados e **não tem `Intl`**: o `brl`, as datas e o fuso (o gargalo que achamos) voltariam para o JavaScript a cada chamada, ou exigiriam embarcar os dados do ICU. O ganho possível sobre o que um gerador de JS compilado já entrega (item 3) é pequeno perto do custo de reescrever avaliador, escape e formatadores.
**WASM compensa em cálculo numérico** (kernels da E6: GLSL/PTX/WASM) e já está no sandbox (QuickJS). Para renderização, a alavanca é **gerar código JS especializado a partir do IR** (card JIT/AOT) e **não enviar React quando a página não é interativa**.

## 6. Decisões que isto sugere
1. **Caminho estático**: o IR já sabe, estaticamente, se uma página precisa de JavaScript (`eventos`, `estado`, streaming, blocos de código/lazy). Sem nada disso: renderizar com o gerador de string (3,2×, sem hidratação) e **enviar zero JS**.
2. **Cliente sem React** é uma decisão grande (hoje 135 KB gz de `react-dom` contra ~10 KB do nosso código): exigiria um runtime próprio que atualize o DOM a partir do IR com dependências por nó (a ideia de re-render localizado), e os blocos nativos deixariam de ser componentes React. Só vale decidir depois de medir hidratação/INP **em navegador real**.
3. **WASM** só para cálculo (E6).

## Falta medir
Hidratação e interação (INP) no navegador, TTFB com rede, e o caminho de streaming sob concorrência. Esta suíte mede CPU de servidor e tamanho de bundle.

## Caminho estático (IR → função JS, zero JS no cliente)

`compilaEstatico(programa)` traduz o IR para uma função JS especializada (`src/estatico/`): blocos compostos viram funções,
`repetir` vira laço, `se` vira condicional, blocos nativos viram emissores de string e expressões viram closures
(equivalência com o avaliador conferida por fuzz). `documentoEstatico` entrega HTML sem `<script>` nem estado de hidratação.

Medido (`pnpm bench`, Node 24, lista de cartões, saída idêntica à do React byte a byte):

| cartões | React SSR (hoje) | estático | ganho |
|---|---|---|---|
| 200 | 11,4 ms | 0,63 ms | 18× |
| 1000 | 46,1 ms | 1,98 ms | 23× |

Elegibilidade: só páginas sem eventos, streaming, esqueleto, blocos de código nem blocos interativos (`nav/botao`,
`entrada/texto`) e cujos blocos tenham emissor. Caso contrário `compilaEstatico` devolve `{ ok: false, motivos }` com
caminho e razão por nó, e o servidor segue pelo caminho React. O código gerado só contém literais JSON e referências a
closures: nenhum texto do usuário vira código (teste de veneno). `fonte` pode ser gravado em arquivo (AOT).

Achado de segurança no caminho: `urlSegura` usava `trim()` (remove NBSP, U+2028, BOM), que transformava a URL relativa
inofensiva `" javascript:x"` em `javascript:x`. Agora só se apara o que o navegador apara (U+0000–U+0020); teste de
regressão e fuzz em `test/url.test.ts`.

## Navegador real: React (SSR + hidratação) × runtime vivo (AOT)
Mesma página de loja (`packages/engine/bench/navegador/`: `gera.ts` gera as duas variantes a partir do MESMO programa, `servidor.mjs` serve com gzip nível 9,
`medir.js` é o harness). Chrome real, localhost, sem limitação de CPU nem de rede, 3 cargas por variante; interações medidas como "clique → o DOM já reflete"
(o mesmo critério para os dois: o React atualiza em microtask, o vivo na hora). Lista de 900 itens (o `repetir` corta em 1000), cada um um bloco composto.

| | React | vivo | |
|---|---|---|---|
| JavaScript enviado (gz) | **143,5 KB** | **10,6 KB** | 13,5× menor |
| JavaScript (descomprimido) | 460 KB | 28 KB | 16× menor |
| HTML (gz, 900 itens) | 10,7 KB | 10,7 KB | igual |
| 1º clique que funciona (TTI) | 154–233 ms | 135–206 ms | indistinguível em localhost (variância > diferença) |
| contador +1, fora da lista | 11–35 ms | **0,2 ms** | ~60× (o React reavalia a página inteira) |
| alterar 1 item no meio | 9–13 ms | 4,6–5,8 ms | ~2× |
| inserir / remover 1 | ~9,5 ms | 5,4–6,2 / 2,3–6,1 ms | ~1,6× |
| inverter a lista | 8,7–10,2 ms | 5,1–5,8 ms | ~1,8× |
| digitar no filtro (reavalia `filtra` com lambda em 900 itens e cria/remove ~450 cartões) | 4,8–6,1 ms | 4,9–8,9 ms | **sem ganho** (ver abaixo: o gargalo é o DOM, não a expressão) |

Com 200 itens as proporções se mantêm (contador 5,5 ms × 0,2 ms; JS 143,5 × 10,5 KB), e o filtro é um pouco pior no vivo (3,2 × 1,3 ms).

**Event Timing com cliques REAIS** (inclui o quadro seguinte; 1 amostra por botão, resolução de 8 ms): contador +1: React 104 ms (handler 39,6) × vivo 32 ms (handler 0,1);
alterar 1: 48 × 88 ms; inverter: 96 × 104 ms. Amostra pequena e a frio: indicativo, não conclusivo; o contador é o único ganho nítido.

**O que isto diz**
- O ganho robusto é **bytes** (13,5× menos JS) e **interações que não tocam a lista** (60×): o vivo só reavalia o que depende da chave que mudou. Em rede lenta os bytes
  dominam (conta, não medida: 143,5 KB ≈ 0,7 s e 10,6 KB ≈ 0,05 s a 1,6 Mbps).
- Operações de lista: ~2× melhores no handler, mas o tempo de pintura de 900 nós domina o INP real e é igual nos dois.
- **Sem ganho** no filtro. Primeiro achei que era a avaliação da expressão; **estava errado** (ver a seção seguinte).
- Memória (`performance.memory`): inconclusiva (varia de 50 a 146 MB entre cargas da mesma variante); não use para decidir.
- Limites da medição: localhost, sem throttling de CPU/rede, aba de automação (os quadros de pintura nem sempre disparam), INP real com 1 amostra.
  Repetir em dispositivo lento e rede real antes de afirmar números de campo.

A medição apontou e corrigiu um ponto quente real: a reconciliação alocava uma cópia do escopo e um `Set` por item a cada atualização (agora a chave é avaliada no escopo vivo
e o conjunto de chaves de fora é calculado uma vez). Ganho pequeno (≤ 10%).

## Expressões compiladas em closures (e um diagnóstico corrigido)
O runtime vivo e as ações passaram a avaliar expressões por **closures** (`src/expr/compila.ts`: a AST é percorrida uma vez; função resolvida e aridade checada na compilação;
combinadores com orçamento de passos por invocação), em vez de interpretar a AST a cada chamada. O caminho estático usa o mesmo compilador. Equivalência: teste diferencial
com 6000 expressões aleatórias (combinadores e funções anônimas incluídos) × escopos hostis; o interpretador continua sendo a referência (`avalia`) no servidor e na análise.

Microbenchmark (`bench/expr.ts`, Node, 900 itens): `filtra` com lambda 467 → 159 µs (2,9×); `mapeia` 189 → 109 µs (1,7×); `dobra` 171 → 103 µs (1,7×); expressão simples 0,5 → 0,2 µs;
template com `brl` 1,1 → 0,6 µs.

**Correção:** a hipótese "o filtro de 900 itens custa o que custa por causa da avaliação da expressão" estava ERRADA. A expressão toda custa 0,16–0,47 ms; o filtro no navegador leva ~5–12 ms.
O resto é construir/remover ~450 cartões no DOM (os dois caminhos pagam isso: React 12,1 ms × vivo 11,7 ms, na mesma janela). É uma hipótese coerente com os números, **ainda não perfilada**.

Chrome real depois da mudança (vivo, 900 itens, 2 cargas; React na mesma janela entre parênteses): contador 0,2–0,3 ms (12,8); alterar 1 item 3,6–4,2 ms (13,4; antes da mudança 4,6–5,8);
inserir 5,5–5,9 (19,6); remover 5,2–5,4 (9,6); inverter 4,5 (9,1); filtro ~11,7 (12,1). Ganho de ~20% em "alterar 1"; as demais operações não mudaram de forma distinguível do ruído.
Uma carga isolada deu "alterar 1" = 0,9 ms e outra janela mostrou o dobro em tudo: **só compare números da mesma sessão** (este navegador de automação varia entre janelas).
Custo em tamanho: +0,6 KB gz no cliente (o compilador é maior que o interpretador que ele tirou do bundle).

### Listas: esvaziar/encher em massa e inserção por fragmento (card 1dff4uhedyp)
`repetir` agora (a) esvazia a lista inteira com uma varredura única e (b) enche uma lista vazia em um único fragmento inserido uma vez; itens novos criados no meio entram com UMA inserção (o fragmento do item) em vez de uma por nó. Testado contra o oráculo (`test/vivo-lista-massa.test.tsx`).
**Resultado medido em Chrome real: inconclusivo.** Filtro com 900 itens, 4 rodadas por versão na mesma sessão: antes 3,6–15,5 ms, depois 6,9–13,2 ms (variância dentro da versão maior que a diferença). O filtro parcial ("a"→"ab") mistura remoção e criação, então os caminhos em massa quase não disparam; o custo restante é criar ~8 nós por cartão. 
**Correção do diagnóstico (microbenchmark em Chrome real, 450 cartões de ~5 nós, mediana de 15):** criar nó a nó num fragmento único 3,1 ms; item a item 2,1 ms; `cloneNode` de um modelo 2,5 ms; remover um a um 0,3 ms. Ou seja, o DOM cru custa 2–3 ms e clonar modelo NÃO ajuda (descartado). Os ~7–15 ms do filtro vêm do JavaScript do próprio runtime por item (escopo do item, controladores, dependências, `Pos`), mais estilo/layout depois do handler. Próximo passo: perfil de CPU do `criaItem` (alocações por item), não mais DOM.

**Fechamento do diagnóstico do filtro (card 1dff4uhedyp).** Perfil de CPU (`bench/perfil-lista.ts`, `pnpm perfil:lista`): o tempo próprio do runtime por item é pequeno (`criaItem` ~2%, `depsExpr` ~1%, formatadores já em cache); o resto, em jsdom, é o próprio jsdom. Em Chrome real, para 450 cartões: criar + inserir ≈ 1,5 ms; **estilo + layout forçado ≈ 5,9 ms**. Esse é o piso do navegador para a operação (o React paga o mesmo, por isso o empate), e não está no nosso código. Ganho adicional só reduzindo o que o navegador precisa recalcular (virtualização de lista, `content-visibility: auto`), que é decisão de produto/bloco, não do runtime.

## Com limitação de CPU e rede, cliques reais, INP (card 1dff4uhedun)
`bench/navegador/cdp.mjs` (Chrome headless via CDP direto, sem dependências): `Emulation.setCPUThrottlingRate`, `Network.emulateNetworkConditions` (4G lenta: 1,6 Mbps, 150 ms), cache desligado, cliques de verdade (`Input.dispatchMouseEvent`) e Event Timing (`click`, resolução de 8 ms, só registra eventos ≥ 16 ms). 900 itens, 3 cargas por célula (medianas de carga); INP-like = **pior** duração entre 12–24 cliques por botão (≈ p98).

| | sem limite | CPU 4× + 4G lenta | CPU 6× + 4G lenta |
|---|---|---|---|
| 1º clique que funciona (TTI) — React | 124 ms | 1411 ms | 1561 ms |
| 1º clique que funciona (TTI) — vivo | 76 ms | **578 ms** | **703 ms** |
| long tasks na carga (excesso >50 ms) — React / vivo | 0 / 0 | 140 / 86 ms | 276 / 144 ms |
| FCP (igual: o HTML é o mesmo) | 44 / 40 ms | 432 / 424 ms | 448 / 448 ms |
| INP, contador +1 — React / vivo | 56 / 24 ms | 64 / **24** ms | 96 / **24** ms |
| INP, alterar 1 item — React / vivo | 40 / 24 ms | 56 / 24 ms | 88 / 32 ms |
| INP, inserir 1 — React / vivo | 56 / 16 ms | 80 / 24 ms | 120 / 48 ms |
| INP, remover 1 — React / vivo | 48 / 24 ms | 80 / 24 ms | 112 / 32 ms |
| INP, inverter a lista — React / vivo | 40 / 56 ms | 104 / 96 ms | 144 / **136** ms |

**Leitura honesta.** Com CPU e rede limitadas, o ganho que antes era "indistinguível em localhost" aparece: o vivo fica interativo **2,4× mais cedo** (578 × 1411 ms) e todas as interações pequenas ficam abaixo de 50 ms de INP (limite "bom" é 200 ms) mesmo a 6×. O React já passa de 100 ms a 6× em inserir/remover. **Inverter a lista inteira é empate** (e no sem-limite o vivo é pior: 56 × 40 ms): é a operação limitada por estilo/layout do navegador, como no card do filtro. Limites: headless; throttling de CPU é emulado (não é um telefone); Event Timing só enxerga eventos ≥ 16 ms e tem resolução de 8 ms; sem o quadro de pintura final real. Repetir em aparelho físico continua sendo a medição definitiva.

## Orçamento de performance (card 1dff4uhe35a)
Metas versionadas em `packages/engine/orcamento.json`:
- **Bundle por página** (gz; limite ~5% acima do medido): simples 11,1 KB, contador 11,4, lista com formatos 11,8, dinheiro exato 12,0, com bloco de código 17,3. Verificado por `test/orcamento.test.ts`, que roda com a suíte (CI): estourar = PR bloqueado.
- **SSR do vivo**: HTML de 900 cartões, mediana ≤ 120 ms (mesmo teste).
- **Navegador** (CPU 4× + 4G lenta, 900 itens): TTI ≤ 900 ms, long tasks ≤ 150 ms, INP pior caso por interação (≤ 56–72 ms; inverter ≤ 150). Verificado por `pnpm orcamento:navegador` (precisa de Chrome; fora do CI padrão). Medido em 2026-11-17: TTI 574–578 ms, long tasks 77–86 ms.
Para subir um limite: justificar no PR e atualizar esta seção.
