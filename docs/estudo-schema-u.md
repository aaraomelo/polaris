# Estudo: Schema U do Tiffany → contrato Polaris

Card ClickUp E1 / "Estudo e extração do Schema U". Fontes lidas (somente leitura, em `../tiffany`):
`conecthus/schema/u.schema.json` (+ 13 nós de exemplo), `app/src/banco_schema.js`, `banco_pagina_u.js`, `manifesto_loader.js`,
`conecthus/backends/manifesto.json`, `app/src/kernels_campo.json` + `cards_kernel.js`, e o motor de documentos
`plataforma/tiffany-erp/erp-app/src/doc/` (`schema/document.ts`, `engine/interpolate.ts`).

## 1. O que o Schema U é de fato

Um **envelope de nó** autossimilar, JSON canônico, com 69 propriedades e `additionalProperties: false`.
A árvore se forma por `filhos[]` (recursivo via `$ref: "#"`). Campos que servem a qualquer sistema:

| Campo | Papel | Polaris |
|---|---|---|
| `kind` (enum de 11) | tipo do nó | **manter**, com enum próprio (ver §3) |
| `id` | identidade | **manter** |
| `formato` (enum de 14) | forma de serialização/emissão (json, sql, wasm, html, css, js…) | **manter**, vira o alvo de emissão |
| `estatuto` (gramatica/realizado/nao localizada/N-A) | estado de realização do nó | **adaptar**: `rascunho/publicado/obsoleto` + manter o conceito de "realizado" |
| `evidencia`, `proibicao`, `nota`, `fonte` | proveniência e restrições em texto | **manter** como metadados opcionais (`meta`) |
| `filhos[]` | composição | **manter** (base do slot/children) |
| `tenant` | host/subdomínio | **manter**, mas como `tenantId` real (o do ERP) |
| `slots` | endereços do canal | **adaptar**: slots de bloco (VTEX) ≠ endereços S_CANAL |
| `texto` | conteúdo de arquivo | **manter** (corpo de emissões) |

## 2. O que não serve (fica no Tiffany)

- A teoria: `X`, `Xstar`, `Mor`, `Aut`, `star`, `law/object/step/back/measure/invariant/mutate/classify` (claims), `p/q/r`
  (paridade das línguas), `hopfield`, `corpos`, `matriz`, `involucao`, `xi`, `homonimos`, `i/j/posicao`.
- A **cruz de duas metades** (`sentido` -1/0/+1 e `faces.menos/mais`): toda nó completo carrega duas cópias de si mesmo. É
  elegante para a teoria (emite/absorve), mas dobra todo documento e não agrega nada a página/serviço. **Não adotar.**
  O conceito útil (um nó tem uma face de *emissão* e outra de *absorção*) vira, no Polaris, a dupla `emit` / `parse` do backend.
- `modo: solo|remoto` e `tenant` como string vazia para apex: específicos da borda do Tiffany (nginx).

## 3. Lacunas: o que o Schema U **não** tem e o Polaris precisa

1. **Estrutura de página.** O `kind: pagina` do Tiffany é só uma tríade `["html","css","js"]` (arquivos, não árvore). Não existe
   nó para layout, props, slots, bindings, dados, rotas. Isso só existe, de forma embrionária, em
   `erp-app/src/doc/schema/document.ts`: união discriminada por `kind` (`spacer`, `sectionBar`, `paragraph`, `field`, `columns`,
   `table`, `summary`, `signatures`, `image`) com recursão em `columns[].blocks`. **É o modelo a generalizar.**
2. **Bindings.** O doc engine usa `{caminho.a.b | formatador}` com `getNested` e formatadores nomeados (`brl`, `date`). É seguro
   (sem `eval`) mas limitado: sem condicionais, loops, aritmética. Define o piso da linguagem de expressões (decisão E11).
3. **Serviço, evento, tema, tenant-config.** Hoje vivem como código NestJS/Prisma (`erp-api`) e JSON solto (`themeConfig`,
   `landingConfig`). Precisam virar `kind`s.
4. **Kernel de computação.** `kernels_campo.json` guarda GLSL **já emitido** (string) mais parâmetros de pintura
   (`pecas[].f, n, chi, w, stops`) e `cards_kernel.js` os liga ao WebGL2 (um contexto compartilhado, compila 1x por kernel, sem GPU
   cai em fallback). O schema do kernel (entradas/saídas/domínio) **não existe**: só a emissão. Para E6 precisa de um kind
   `kernel` com a descrição abstrata e as emissões GLSL/WASM/PTX como saídas. O manifesto de backends
   (`linguagens[]` com `faz`, `fonte`, `wasm`, `exports`, `cadeia`) e o par `p`/`q` (analisa/compila) são a base do contrato de backend.
5. **Versão.** Não há `schemaVersion` nem `$id` por kind: um único `tiffany://u` para tudo.
6. **Validação rica.** Um `allOf` com um único `if/then` (kind=U). Falta discriminação por `kind` (`oneOf`/`if-then` por tipo) e
   `unevaluatedProperties`.

## 4. Proposta de contrato Polaris (insumo para o card "Meta-schema")

Manter o **envelope** do U, trocar a teoria por um **corpo tipado por `kind`**:

```jsonc
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "$id": "polaris://no/v1",
  "type": "object",
  "required": ["kind", "id", "versao"],
  "properties": {
    "kind":    { "enum": ["pagina","bloco","tema","dados","servico","evento","kernel","documento","tenant","backend"] },
    "id":      { "type": "string", "minLength": 1 },
    "versao":  { "type": "string", "pattern": "^\\d+\\.\\d+\\.\\d+$" },
    "estatuto":{ "enum": ["rascunho","publicado","obsoleto"] },
    "tenantId":{ "type": ["string","null"] },
    "meta":    { "type": "object" },                       // evidencia, proibicao, nota, fonte
    "emit":    { "type": "array", "items": { "enum": ["json","html","css","js","sql","wasm","glsl","ptx","pdf"] } },
    "spec":    { "type": "object" },                       // corpo, validado pelo schema do kind
    "filhos":  { "type": "array", "items": { "$ref": "#" } }
  },
  "allOf": [ { "if": {"properties":{"kind":{"const":"pagina"}}}, "then": {"properties":{"spec":{"$ref":"polaris://pagina/v1"}}} } ],
  "unevaluatedProperties": false
}
```

Mapa `kind` Tiffany → Polaris: `pagina`→`pagina` (agora com árvore de blocos), `lingua`/`realizacao`→`backend`, `claim`→(fica no Tiffany),
`celula`/`orbita`/`metade`/`U`/`sessao`/`ficha`/`ficheiro`→(fora). Novos: `bloco`, `tema`, `dados`, `servico`, `evento`, `kernel`,
`documento` (= `DocumentSpec` portado), `tenant`.

## 5. Decisões que este estudo sugere (para o card E11)

1. **Cruz de duas metades: não adotar.** Mantém só `emit`/`parse` por backend.
2. **Envelope único + `spec` por kind**, em vez de 69 propriedades planas.
3. **Bindings:** começar pelo piso do `interpolate.ts` (`{caminho | fmt}`) e escolher a linguagem de expressões (CEL ou JSONata) no card próprio.
4. **Kernel:** schema abstrato + emissões; reaproveitar o par `kernels` GLSL e o loader de contexto único como primeiro backend.
5. **Teoria do Tiffany fica lá.** O Polaris cita `evidencia`/`proibicao` apenas como `meta` livre.

## 6. Material a reaproveitar quase como está
- `DocBlock` e `DocumentSpec` (→ `kind: documento`) e `interpolate`/`getNested`/formatadores.
- `manifesto.json` de backends (modelo do `kind: backend`).
- `cards_kernel.js`: padrão de um contexto WebGL2, programa compilado uma vez por kernel, fallback sem GPU.
- `erp-api`: `ModulePack` + `landingConfig` (E5/E7).
