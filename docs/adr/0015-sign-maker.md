# 0015 — Sign Maker: um layout calculado, HTML e PDF só desenham

**Contexto.** O sistema legado de banners (`easysync-banner-app`) tinha dois renderizadores independentes: o preview (React, canvas, ajuste de fonte no navegador) e o PDF (`PdfBanner.ts`, 1755 linhas, pdf-lib com fatores empíricos). Eles divergiam, e corrigir um não corrigia o outro.

**Decisão.** Um kind declarativo `cartaz` (elementos em frações da página, validado por schema) e **um único cálculo de layout** (`layoutCartaz`): interpolação segura, condição `se`, ajuste de fonte com as métricas das TTF, quebra de linha e geometria (incluindo rotação e cantos arredondados). O resultado são operações em pt (`texto`, `ret`, `caminho`, `imagem`) que o HTML e o PDF apenas desenham; o vetor é o **mesmo** `d` SVG nas duas saídas. A paridade é verificada com Chrome headless e poppler, ponto a ponto (palavras ≤ 1 pt e pixels), com teste do detector. Reaproveita a interpolação, os formatos e as fontes de `@polaris/documentos`.

**Consequências.** A semântica é a deste motor (mais limpa que a do legado): a conversão das configurações antigas (curio, goiana, saojorge) é um passo à parte e precisa de conferência visual. Fontes proprietárias do legado (Primary, Secondary) não podem ir ao repositório e viram ativo do tenant. Sem kerning/ligaduras, como em documentos. Elementos complexos (preço, economia, validade, código de barras, QR) entram como regras de layout, nos cards S3, S7 e S8.

**Evidência.** `docs/sign-maker.md`, `packages/signmaker/test/cartaz.test.ts` e `paridade.test.ts`, `packages/schema/test/exemplos/validos/cartaz-oferta.json`.
