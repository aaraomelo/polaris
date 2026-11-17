# Runtime vivo (sem React)

`montaVivo({ programa, container, … })` (`packages/engine/src/vivo/`) constrói o DOM direto do IR e o mantém atualizado a
partir do store imutável. Sem React, sem VDOM.

## Como funciona
- **Dependências** (`dep.ts`): cada expressão sabe de quais chaves depende (`estado.nome`, `produtos`, `props.titulo`…).
  `estado`, `status`, `erros` e `props` são granulares; o resto depende do nome inteiro.
- **Diff do store** por referência (compartilhamento estrutural) dá as chaves que mudaram; só nós cuja união de
  dependências cruza com elas são visitados (poda hierárquica). Uma chave sem relação não reavalia nada nem toca o DOM.
- **Regiões**: `se` (marcadores + sub-região), `repetir` (itens com marcadores), bloco composto (escopo próprio
  `{props, tenant}`), slot (conteúdo construído no escopo de FORA, como no React).
- **Listas com chave** (`repetir.chave`, expressão avaliada no escopo do item): `lista.ts`, LIS em O(n log n); só move o
  que está fora da subsequência. Sem `chave`, a posição é a identidade (item atualizado no lugar). Chave repetida é
  desambiguada de forma determinística.
- **Eventos**: um listener por tipo (`click`, `input`) no contêiner; o nó guarda o handler num `WeakMap`. Campos
  controlados voltam ao valor da prop quando a ação não o aceita.
- **Ações**: o mesmo executor do caminho React (`executaAcoes`), incluindo `executar` assíncrono com descarte de resposta antiga.

## Verificação
O React é o **oráculo**: depois de cada ação, o DOM do contêiner tem de ser idêntico ao do SSR do React com o mesmo
estado (`test/vivo.test.tsx`: cenários, fuzz de sequências de ações, identidade dos nós em listas, contagem de avaliações).
`test/vivo-lista.test.ts` prova o mínimo de movimentos por fuzz contra uma referência O(n²).

## Medido
- Bundle: **~10 KB gz** (avaliador com a biblioteca de listas, modelo, ações, blocos base e o runtime), contra ~135 KB gz do `react-dom`. Guarda: `test/bundle.test.ts` (< 12 KB gz, sem React/Ajv/QuickJS). Era 7,5 KB no protótipo; o próximo corte é incluir só as funções que o programa usa.
- `pnpm bench:vivo` (jsdom; números absolutos são pessimistas): mudar chave fora da lista ≈ 0,01–0,03 ms (independe do
  tamanho); alterar 1 item de 1000 ≈ 1,7 ms; inserir 1 no meio de 1000 cria 1 nó.

## Ainda não coberto (cards seguintes)
Streaming/Suspense, blocos de código (sandbox), `Isola` (falha de um bloco não derruba a página), hidratação do HTML do
servidor (hoje o vivo monta no contêiner vazio) e medição em navegador real (INP, tempo de hidratação).
`elegivelVivo` devolve os motivos quando a página usa algo disso e o servidor segue pelo caminho React.

## Modelo × espelho (desacoplamento)
`src/modelo/` não conhece DOM, HTML nem React: store imutável, `AcaoStore` pura, diff por referência (`chavesMudadas`),
histórico (anel de N mudanças com ações, chaves, antes/depois) e assinatura de espelhos. O DOM vivo, o HTML do servidor e o
React do oráculo são espelhos do mesmo modelo. `chavesMutaveis(programa)` é a análise estática de tudo o que a página pode
mudar (ações `definir`/`executar`, inclusive em `depois`/`emErro`, e dados em streaming).

## Hidratação e poda
- **Adotar, não recriar**: o construtor emite nós em ordem de documento por um `Pos`, que ou cria ou adota o nó que o
  servidor já pôs (`hidrata: true`). O mesmo código serve aos dois. O HTML do servidor vem de `compilaHtmlVivo` (emissores
  derivados dos MESMOS descritores DOM + marcadores `<!---->` de `se`/`repetir`/item). Divergência (tag errada, nó
  sobrando/faltando, marcador trocado) é detectada, avisada por `onErro` (`hidratacao`) e a página é reconstruída.
- **Mundo fechado** (`fechado: true`): só as chaves de `chavesMutaveis` aceitam `despacha` externo, e subárvores cujas
  dependências não cruzam com elas **não ganham controlador** (`diagnostico().controladores`). Props constantes de um
  composto tornam seu modelo interno estático; lista constante torna os itens estáticos.
