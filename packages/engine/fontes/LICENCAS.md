# Fontes embutidas

Os arquivos vivem em `src/fontes/dados.ts` (base64, gerado). São fontes **variáveis** do Google Fonts, subconjunto **latino** (cobre o português), baixadas em 2026-11-21:

| Fonte | Arquivo de origem | Licença |
|---|---|---|
| Cormorant Garamond (normal e itálico, peso 300–700) | `fonts.gstatic.com/s/cormorantgaramond/v21/…` | SIL Open Font License 1.1 |
| Inter (normal, peso 300–700) | `fonts.gstatic.com/s/inter/v20/…` | SIL Open Font License 1.1 |

A OFL permite uso, cópia e redistribuição (inclusive embutida) desde que o texto da licença acompanhe e o nome reservado não seja usado em versão modificada. Texto: https://openfontlicense.org (copyright dos autores: Christian Thalmann/Catharsis Fonts e Rasmus Andersson).

Para atualizar: pegar o CSS em `https://fonts.googleapis.com/css2?family=Cormorant+Garamond:ital,wght@0,300..700;1,300..700&family=Inter:wght@300..700`, baixar o bloco `/* latin */` de cada família e regerar `dados.ts`.
