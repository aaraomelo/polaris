# Computação declarativa: kernels em js, wasm, glsl e ptx

Um nó `kind: kernel` descreve um **mapa elemento a elemento** (`saida[i] = f(entradas[i], escalares, i, n)`) na linguagem de expressões do Polaris. Do mesmo nó saem quatro alvos.
Pacote `@polaris/computacao`. Decisão e estudo dos backends do Tiffany: `docs/adr/0009-backends-de-computacao.md`.

```
nó kernel ──compilaKernel──▶ IR tipado (i32|f32|bool) ─┬─ js    referência (interpretador oráculo + js compilado)
 (corpo em expressões)        erros de autoria com o     ├─ wasm  binário montado em TS; browser e Node (WebAssembly)
                              ponto exato                ├─ glsl  GLSL ES 3.00, passe de fragmento (WebGL2)
                                                         └─ ptx   texto PTX 7.0 (sm_50), um thread por elemento
```

## O kernel
```json
{ "entradas": { "a": { "tipo": "decimal" }, "x": { "tipo": "decimal", "lista": true } },
  "saidas":   { "r": { "tipo": "decimal", "lista": true } },
  "restricoes": ["a >= 0"], "tolerancia": { "relativa": 1e-5 }, "dominio": { "maxElementos": 1000000, "larguraDe": "w" },
  "corpo": { "locais": [{ "nome": "t", "valor": "a * x" }], "saidas": { "r": "t + 1" } } }
```
- **Tipos**: `decimal` = **f32** em todo lugar, `inteiro` = i32, `booleano`. Entrada `lista` é lida no elemento `i`; as demais são escalares. Toda saída é lista (até 4).
- **Permitido**: `+ - * /`, comparações, `&& || !`, `?:`, `min max abs sqrt floor ceil`, `f32()` e `i32()` (trunca e **satura**; NaN → 0), `i`, `n` e, com `larguraDe`, `x = i mod max(w,1)` e `y = i div max(w,1)`.
  `/`, `min`, `max`, `abs`, `sqrt`, `floor`, `ceil` são sempre f32; `+ - *` ficam em i32 se os dois lados forem i32 (**dá a volta em 32 bits**).
- **Fora de propósito**: transcendentais (`sin`, `exp`…: variam entre alvos), `%`, laços, listas, acesso a campo, reduções e vizinhança. A mensagem de erro diz o que é e onde (`corpo.saidas.r: função "sin" não existe…`).
- Todo erro é de **autoria e antes de executar**: tipo, nome, limite, entrada faltando/sobrando/de tamanho errado, restrição violada, `n` acima de `maxElementos`.

## Paridade (E6)
`js` (interpretador ≡ compilado), `wasm` e `ptx` (mock) são **idênticos bit a bit** ao oráculo (`Object.is`: distingue `-0`), com fuzz de centenas de kernels × tamanhos que cruzam fronteiras de bloco (0, 1, 255, 256, 257…).
`glsl` roda num Chrome real (SwiftShader sem GPU) e difere **dentro da `tolerancia` do kernel** (relativa·max(|a|,|b|,escala) + absoluta); inteiros e booleanos continuam exatos.
`comparaSaidas` é o comparador, e há teste de que ele **reprova** 1 ulp, `-0`, tamanho errado e inteiro trocado. O fuzz já achou um defeito real (o mock deixava `-0` num registrador inteiro).
O teste `paridade.test.ts` **falha no CI** se faltar Chrome (variável `CI`), em vez de pular.

## Roteador (`escolheAlvo`)
Determinístico e explicável: devolve o alvo, o custo e, para cada candidato, o custo **ou o motivo da exclusão**.
1. Elimina: sem capacidade (WebAssembly, WebGL2, driver de GPU); **kernel sem `tolerancia` nunca vai para WebGL** (exige bit a bit); mais de 4 saídas; inteiros em lista/saída no WebGL (float só é exato até 2^24); `n` que não cabe na textura.
2. Escolhe o menor `fixo + n·(porElemento + nós·porNo)`; empate: wasm, js, ptx, webgl. Os custos padrão (`CUSTOS_PADRAO`) são **estimativas**, calibráveis por ambiente; não foram medidos em GPU real.

## Serviço `compute` (`criaCompute`)
Fila **justa entre tenants** (round-robin), concorrência limitada e quotas: elementos por job, pendentes por tenant e total, espera máxima (`QuotaErro` com código). Alvos do servidor: js, wasm e ptx.
O **driver de GPU é uma porta** (`DriverGpu`). O `driverGpuMock` executa o PTX num interpretador independente (semântica documentada do PTX, não a do nosso IR). Um driver CUDA real (`cuModuleLoadData` + `cuLaunchKernel`) implementa a mesma interface.

## Navegador: bloco `computacao/canvas-gl`
`{ bloco: 'computacao/canvas-gl', props: { kernel, largura, altura, alt, entradas } }` emite `<canvas data-polaris-kernel=… data-polaris-entradas=…>` com o texto alternativo dentro (vale sem JS; mesmo DOM no SSR, no React e no runtime vivo, conferido pelo oráculo).
O carregador `montaCanvases` (`@polaris/computacao/cliente`) busca o artefato (`artefatoCliente(id, kernel, emiteGlsl(kernel))` em `/kernels/<id>.json`, mesma origem) e pinta: **WebGL2 → wasm → interpretador**, sem `eval`/`new Function`.
Com CSP sem `'wasm-unsafe-eval'` cai no interpretador (testado). O kernel de canvas precisa das saídas decimais `r`, `g`, `b` (e `a` opcional) de 0 a 1, e de `larguraDe`. Erro num canvas não derruba a página: ele fica com o texto alternativo e ganha `data-polaris-erro`.

## Limites assumidos
- **PTX não foi executado em GPU**: o emissor foi verificado contra um interpretador do subconjunto emitido, não contra `ptxas` nem hardware (não há CUDA aqui). O driver CUDA não existe. Se `ptxas` rejeitar algo, só se descobre em GPU.
- **GLSL**: inteiros em lista/saída trafegam como float (exatos até 2^24); `i32()` fora da faixa é definido pelo shader (satura), mas o SwiftShader já satura sozinho, então o guard não é distinguível aqui; `sqrt` de negativo e `min`/`max` com NaN são indefinidos em GPU (**NaN fora do contrato** de paridade; a geração aleatória evita NaN/Inf e estouro de i32).
- Só kernels de mapa; sem reduções, sem vizinhança, sem transcendentais; no máximo 4 saídas; um kernel de canvas não aceita entradas lista.
- O artefato `/kernels/<id>.json` ainda não é emitido pelo AOT (`artefatoCliente` é a função; ligar ao build é o próximo passo).
- Os custos do roteador não foram calibrados com medição em GPU; a fila é em memória de um processo (sem persistência nem distribuição).
