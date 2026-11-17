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
| digitar no filtro (reavalia `filtra` com lambda em 900 itens) | 4,8–6,1 ms | 4,9–8,9 ms | **sem ganho**: o custo é a avaliação da expressão, que os dois pagam |

Com 200 itens as proporções se mantêm (contador 5,5 ms × 0,2 ms; JS 143,5 × 10,5 KB), e o filtro é um pouco pior no vivo (3,2 × 1,3 ms).

**Event Timing com cliques REAIS** (inclui o quadro seguinte; 1 amostra por botão, resolução de 8 ms): contador +1: React 104 ms (handler 39,6) × vivo 32 ms (handler 0,1);
alterar 1: 48 × 88 ms; inverter: 96 × 104 ms. Amostra pequena e a frio: indicativo, não conclusivo; o contador é o único ganho nítido.

**O que isto diz**
- O ganho robusto é **bytes** (13,5× menos JS) e **interações que não tocam a lista** (60×): o vivo só reavalia o que depende da chave que mudou. Em rede lenta os bytes
  dominam (conta, não medida: 143,5 KB ≈ 0,7 s e 10,6 KB ≈ 0,05 s a 1,6 Mbps).
- Operações de lista: ~2× melhores no handler, mas o tempo de pintura de 900 nós domina o INP real e é igual nos dois.
- **Sem ganho** quando o custo é a avaliação de expressões pesadas (o filtro). Próximo corte: compilar as expressões do vivo para closures (o caminho estático já faz) em vez de interpretar a AST.
- Memória (`performance.memory`): inconclusiva (varia de 50 a 146 MB entre cargas da mesma variante); não use para decidir.
- Limites da medição: localhost, sem throttling de CPU/rede, aba de automação (os quadros de pintura nem sempre disparam), INP real com 1 amostra.
  Repetir em dispositivo lento e rede real antes de afirmar números de campo.

A medição apontou e corrigiu um ponto quente real: a reconciliação alocava uma cópia do escopo e um `Set` por item a cada atualização (agora a chave é avaliada no escopo vivo
e o conjunto de chaves de fora é calculado uma vez). Ganho pequeno (≤ 10%) — confirma que o gargalo é a avaliação da expressão.
