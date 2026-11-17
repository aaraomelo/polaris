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
