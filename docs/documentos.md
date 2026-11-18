# Documentos declarativos (PDF e impressão)

Um nó `kind: documento` descreve um documento em **fluxo** (blocos que empilham e paginam). Do mesmo nó e dos mesmos dados saem **HTML** e **PDF**, a partir de **um só layout**.
Pacote: `@polaris/documentos`. Origem: o engine `doc/` do tiffany-erp (DocumentSpec, layout em fluxo, pdf-lib + fontkit), portado para o contrato Polaris (spec em português, validada por schema, interpolação segura, sem `Date` local nem fonte de rede).

```
nó documento + dados ──resolve──▶ DocumentoResolvido ──layout──▶ Layout (ops em pt) ─┬─▶ pdfDe()  (pdf-lib + fontkit)
   (JSON Schema)       (se/repetir/bindings)           (quebra, paginação, medida)    └─▶ htmlDe() (elementos posicionados)
```

## O nó
`spec`: `tamanho` (A4|A5|Letter), `orientacao`, `margem` (mm), `fonte`, `titulo`, `rodape` (aceita `{pagina}` e `{paginas}`), `dados` (nome → tipo) e `blocos`.
Blocos: `espaco`, `barraSecao`, `paragrafo`, `campo`, `colunas`, `tabela`, `resumo`, `assinaturas`, `imagem`. Qualquer bloco aceita `se` (condição) e `repetir` (`cada`/`como`/`limite`); a tabela aceita `linhasDe` (uma linha por item).
Templates prontos, nos packs: `servicos.doc.ordem-servico`, `vendas.doc.pedido`, `pagamentos.doc.recibo`.

## Interpolação segura
`{caminho.a.0.b | filtro | filtro:2}`. **Não há avaliador**: só caminho em dados e filtros de uma lista fechada (`brl`, `num:N`, `data`, `datahora`, `upper`, `lower`, `cpfcnpj`, `trunc:N`).
- Só propriedades **próprias** (nada de `constructor`, `__proto__`, protótipo herdado); `\{` e `\}` são os literais.
- O **valor** vindo dos dados nunca é reinterpretado como template; controles e sobreposição bidirecional (U+202A–E, U+2066–9, U+200B–F) são removidos.
- **Fail-closed**: template malformado, filtro desconhecido, raiz que não é dado declarado em `spec.dados`, dado ausente ou de tipo errado, lista acima do limite → `DocumentoErro` antes de gerar. Nunca sai papel com binding cru ou em branco por typo.
- Dinheiro e número formatam por **decimal exato sobre o texto** (arredonda meio para cima em módulo; `0.105` → `R$ 0,11`), nunca por `Number`. Data pura não sofre fuso; instante vira **UTC−3**.
- Imagem: só **data URL png/jpeg** (sem busca de URL: sem SSRF, sem arquivo local, sem rede na geração). O HTML sai escapado e com CSP `default-src 'none'`.
- `se` em texto decimal: `"0.00"` conta como falso.

## Paridade HTML × PDF
A fonte (Roboto, TTF, Apache-2.0, em `packages/documentos/fontes`) é a mesma no que mede, no que vai embarcado no PDF e no `@font-face` do HTML; kerning e ligaduras ficam **desligados** nas três (o pdf-lib não os desenha). `test/paridade.test.ts` abre o HTML num Chrome real e rasteriza/lê o PDF com poppler:
(1) mesmas palavras, na mesma página, a **≤ 1 pt**; (2) pixels comparados em blocos (média < 2,5/255; < 0,4% dos blocos com diferença > 60). Há teste do detector: 1,5 pt de deslocamento, cor trocada e texto trocado são reprovados.
Requer Chrome (`CHROME=`) e `poppler-utils` (`pdftoppm`, `pdftotext`, `pdffonts`); sem eles o teste é **pulado localmente** e **falha no CI** (variável `CI`).
`PARIDADE_SALVA=<dir>` grava os PNG lado a lado para olhar.

## Determinismo
`geraDocumento(no, dados, { agora })`: com a mesma entrada e o mesmo `agora`, HTML e PDF saem **byte a byte** iguais.

## Limites assumidos
- Uma só família (Roboto); para outra, acrescente em `src/fontes.ts` (TTF regular+negrito, licença que permita redistribuir). Sem itálico, sem fonte de fallback: glifo ausente (emoji, CJK) vira `?`.
- Sem kerning/ligaduras e sem hifenização; palavra maior que a coluna é cortada em pedaços. Texto bidirecional (árabe/hebraico) não é suportado.
- Um bloco (linha de tabela, campo, resumo) mais alto que a página não é dividido: é desenhado e pode vazar. Parágrafos fluem linha a linha; sem controle de viúva/órfã.
- Tabelas com `flex` por coluna (sem largura mínima por conteúdo); no máximo 12 colunas.
- O HTML é "papel na tela" (posicionamento absoluto em pt): fiel e imprimível, mas não responsivo nem acessível como documento semântico (sem tabela/cabeçalhos HTML; `lang` e `alt` existem). PDF sem tags de acessibilidade (PDF/UA) nem PDF/A.
- Os limites do contrato: 500 blocos no schema, 5000 após `repetir`, 20 000 linhas de tabela, texto de template até 4000 caracteres, valor até 20 000.
- Os templates usam dados já formados (ex.: `totais.total` como texto decimal): quem monta os dados (hoje, o chamador) é responsável por somar com `@polaris/packs` (`dinheiro.ts`), não o documento.
- O kind `documento` esquema 1 era um esboço ("detalhado no E9"): foi detalhado **sem novo major** porque nenhum documento de produção existia; a partir daqui, quebra exige major + migração (`docs/versionamento.md`). O erro de um bloco com cor inválida também lista "campo X não existe" (ruído do `unevaluatedProperties` quando o `then` falha).
