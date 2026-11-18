# 0011 — Do "Schema U" do Tiffany entra o canônico; a teoria fica lá

**Contexto.** O Tiffany tem um Schema U (≈69 propriedades planas, "cruz de duas metades", órbitas, claims, ISA própria) que mistura o modelo prático com teoria de pesquisa.

**Decisão.** Entra o **canônico**: envelope único `{ kind, id, versao, esquema, estatuto, tenantId, spec, … }` com o corpo validado pelo schema do `kind`. **Fica de fora** a cruz de duas metades, `claim`, `celula`/`orbita`/`metade`/`ficha` e a ISA ERG-64; `evidencia`/`proibicao` existem só como `meta` livre. O que se reaproveita é prático: `DocumentSpec` (→ `kind: documento`), `interpolate`/formatadores, o modelo de `manifesto.json` (→ `kind: backend`), o padrão de contexto WebGL único com fallback (→ kernels) e o `ModulePack` (→ packs e cadastro).

**Consequências.** O Polaris é auditável sem conhecer a teoria; nenhum nó do Polaris depende de `../tiffany` em tempo de execução (o Tiffany é só leitura, referência). Custo: o que a teoria do Tiffany explicaria (por exemplo, as claims como fonte de verdade de backends) não tem equivalente aqui; os backends de computação foram **reescritos em TS** (ADR 0009), não portados.

**Evidência.** `docs/estudo-schema-u.md`, `packages/schema/schemas/no.schema.json`, `packages/documentos`, `packages/computacao`.
