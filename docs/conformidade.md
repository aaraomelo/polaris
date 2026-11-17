# Suíte de conformidade

`packages/schema/test/conformidade.test.ts` compara a saída real com **golden files versionados**:

| Casos de entrada | Golden | O que protege |
|---|---|---|
| `test/exemplos/validos/*.json` × cada alvo do kind | `test/golden/emissoes/<caso>.<alvo>` | formato das emissões (json, js, tex, css, sql, html) |
| `test/exemplos/invalidos/*.json` | `test/golden/erros/<caso>.json` | caminho, regra, mensagem e dica de cada erro de validação |
| `test/conformidade/estrutura/*.json` (contra `conformidade/base/`) | `test/golden/estrutura/<caso>.json` | refs, slots, ids, props, ciclos e limites |

## Fluxo
- `pnpm conformidade` roda só esta suíte; `pnpm test` roda tudo.
- Mudança **intencional** de formato ou mensagem: `pnpm golden:atualiza`, depois **revise o `git diff` dos golden** antes de commitar. Nunca aceite sem ler.
- Golden sem caso, caso sem golden e kind sem exemplo válido ou inválido fazem a suíte falhar.
- Novo caso: crie o JSON de entrada, rode `golden:atualiza` e confira o golden gerado.
