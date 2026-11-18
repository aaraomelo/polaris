# 0009 — Kernels: um IR, quatro alvos (js, wasm, glsl, ptx)

**Estudo (card E6/1).** Os backends do Tiffany (`conecthus/backends`: `manifesto.json`, `claim/`, `celula.erg`, `glsl/filtrar.c`, `ptx/emitir.c`, `wasm/empilhar.c`) são **realizações de uma ISA própria**: cada pasta é um C minúsculo sobre uma arena de 64 KiB, traduzido para `.wasm` por `tools/traduz` (toolchain própria; não há clang/wasm-ld/nvcc neste ambiente nem no CI). Os "alvos" `glsl` e `ptx` do Tiffany **não geram shader nem PTX**: são o mesmo C com outro rótulo (`ptx/emitir.c` só copia bytes na arena). A ideia aproveitável é a **arena linear com assinatura fixa** e a **paridade como medida**; o código, o claim IR e a ISA ERG-64 não.

**Decisão.**
1. **Reescrever em TS**, sem toolchain externa: o kernel é um **mapa elemento a elemento** (`saida[i] = f(entradas[i], escalares, i, n)`) escrito na **linguagem de expressões do Polaris** (mesmo parser, mesma sintaxe), tipado em `i32 | f32 | bool`.
2. **Um IR, quatro emissores**: `js` (referência, com `Math.fround` em cada operação), `wasm` (binário montado à mão em TS e executado por `WebAssembly` no navegador e no Node), `glsl` (GLSL ES 3.00 em passe de fragmento sobre texturas `R32F`/`RGBA32F`) e `ptx` (texto PTX 7.0, `sm_50`, um thread por elemento).
3. **`decimal` é f32 em todo lugar** (GLSL só tem f32). Operações permitidas: as que têm resultado **bit a bit idêntico** em IEEE-754 f32 (`+ - * /`, `sqrt`, `min`, `max`, `abs`, `floor`, `ceil`, comparações, `se`). **Sem transcendentais** (`sin`, `exp`…): variam entre GPUs e o wasm não as tem; ficam fora até haver decisão (E11).
4. **Paridade**: `js` ≡ `wasm` ≡ `ptx` (interpretador mock) **bit a bit**; `glsl` dentro da `tolerancia` do kernel (GPU pode fundir/flush de denormais), executado num Chrome real. **PTX não roda em GPU aqui**: o emissor é verificado contra um interpretador do subconjunto emitido; o driver CUDA é só uma porta (interface), **não verificada**.
5. **Roteador** escolhe o alvo por capacidade (o kernel cabe? o ambiente tem?) e custo (fixo + por elemento), de forma determinística e explicável.

**Consequências.** Sem dependência de compilador; cada alvo é pequeno e testável. Custo: só kernels de mapa (sem reduções, laços nem acesso a vizinhos) e sem funções transcendentais. Reduções e vizinhança são o próximo passo natural, com a mesma regra de paridade.

**Evidência.** `packages/computacao/test/*`, `docs/computacao.md`.
