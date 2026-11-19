# Imagens do tenant (ativos)

Cada tenant guarda suas **imagens** na plataforma e o gateway as serve **do próprio site** (`/_polaris/img/<sha256>.<ext>`), que é o que o CSP das páginas permite (`img-src 'self' data:`). É o que faz o hero com foto e o logo do cabeçalho funcionarem.

```
Studio (Imagens) ──lê no navegador──▶ POST /studio/ativos {nome, dados base64}
                                        │  tipo pelos BYTES, dimensões do cabeçalho, limites
                                        ▼
                                plataforma.ativo (tenant_id, sha256, …, conteudo bytea)
                                        │
 página do tenant ──▶ GET /_polaris/img/<sha256>.png  (tenant do ENDEREÇO) ──▶ bytes, cache eterno
```

## Regras que valem como contrato (cada uma tem teste)
- **O tipo vem dos bytes**, nunca do nome nem do `Content-Type` do cliente: só **png, jpeg, gif e webp** (assinatura do arquivo). **SVG fica de fora** (carrega script).
- **Dimensões** lidas do cabeçalho (png, gif, jpeg pelo primeiro SOF, webp VP8/VP8L/VP8X) e limitadas: até 8000 px de lado e 40 megapixels (bomba de descompressão). Cabeçalho truncado ou inconsistente = recusa.
- **Limites**: 2 MB por arquivo, 200 arquivos e 50 MB por tenant. No navegador, o bloco `entrada/arquivo` recusa o que passa de `tamanhoMax` **antes de ler**.
- **Endereçado pelo conteúdo**: o id é o SHA-256; enviar o mesmo arquivo de novo no mesmo tenant devolve o que já existe (idempotente). O conteúdo de uma URL nunca muda, então o cache é eterno (`immutable`, `ETag`, 304).
- **Isolamento**: o tenant vem do **endereço** da requisição, nunca da URL. O hash de um tenant no endereço de outro dá o **mesmo 404** de um hash que não existe. O outro tenant não lista, não lê e não apaga.
- **Servido sem poder executar nada**: `Content-Type` do tipo guardado, a extensão da URL precisa ser a desse tipo, `X-Content-Type-Options: nosniff`, `Content-Security-Policy: default-src 'none'; sandbox`. Sem `Cross-Origin-Resource-Policy` de propósito: a prévia do Studio roda num iframe `sandbox` (origem opaca) e precisa carregar a imagem; ela é pública de qualquer jeito.
- **Nome** do arquivo perde controles e marcas bidirecionais (U+202A–E, U+2066–9); o conteúdo nunca é interpretado.
- Permissões do Studio: listar = `studio.ver`; enviar e remover = `studio.editar`. Hash malformado nem consulta o banco.

## Como usar
1. No Studio, **Imagens**: escolha o arquivo; a lista mostra miniatura, nome, dimensões, tamanho e o **caminho** (`/_polaris/img/…`).
2. Cole o caminho no campo `imagem` do `site/hero` (ou `layout/destaque`), ou em `src` de `midia/imagem`.
3. **Remover** apaga a imagem; páginas que ainda a usam passam a mostrar o fundo do tema (hero) ou nada (imagem).
No `pnpm local`, a home do site de exemplo usa um banner (`exemplos/loja-site/banner.png`) que o ambiente envia sozinho para cada tenant de demonstração.

## Limites assumidos
- **Sem miniaturas nem redimensionamento**: o arquivo vai como foi enviado (uma foto de 2 MB é entregue com 2 MB). Os metadados (EXIF, inclusive localização) **não são removidos**.
- **Sem CDN nem armazenamento de objetos**: ficam no Postgres (`bytea`); serve ao porte atual, não a milhares de imagens grandes.
- Remover não confere se alguma página ainda usa a imagem. Sem pasta, sem renomear, sem substituir mantendo a URL (por desenho: a URL é o hash).
- Só imagens. Outros arquivos (PDF para download, fontes do tenant) precisam de outro contrato.
