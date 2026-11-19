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
- **Metadados que vazam saem no envio** (`limpaMetadados`, sem recodificar: a imagem fica byte a byte igual): png perde `tEXt`, `zTXt`, `iTXt`, `eXIf` e `tIME`; jpeg perde APP1 (EXIF e XMP: localização GPS, modelo da câmera), APP13 (IPTC), comentários e os APPn desconhecidos (ficam JFIF, ICC e Adobe); gif perde comentários e texto simples (ficam a animação e o NETSCAPE); webp perde EXIF e XMP (tamanho RIFF e flags acertados). **O id é o hash do arquivo já limpo**, então o mesmo retrato com e sem EXIF é a mesma imagem. O Studio diz quantos bytes saíram. Arquivo com estrutura quebrada (sem IEND, segmento que passa do fim, RIFF truncado) é **recusado**, nunca "limpo pela metade", e o resultado precisa manter tipo e dimensões.
- **Decodificação de verdade** (`processaImagem`, sharp/libvips): o arquivo precisa **decodificar** (cabeçalho certo com dados quebrados é recusado: "não foi possível ler a imagem"), com o mesmo teto de 40 megapixels na leitura. Só se **recodifica quando precisa**: foto de celular com **orientação EXIF** é **girada** para o lado certo (a limpeza apagaria a informação) e imagem com mais de **2400 px** no maior lado é **reduzida** (proporção mantida); o resultado nasce sem metadados. O que não precisa disso segue **byte a byte** como veio (só com a limpeza acima). **Animações** (gif ou webp com vários quadros) não são tocadas nem ganham versões.
- **Versões menores**: para toda imagem com mais de 160 px de largura o envio gera versões **webp** de 160, 480, 960 e 1920 px (só as menores que a imagem), servidas em `/_polaris/img/<hash>.webp?w=<largura>` (imagens enviadas antes das versões existirem ganham as suas quando o mesmo arquivo é enviado de novo, e o `pnpm local` faz isso na subida; largura fora da lista = 404; cache eterno, ETag próprio; apagar a imagem apaga as versões). A lista do Studio usa a de 160 como miniatura; no hero ou em `midia/imagem` escolha a versão pelo caminho (ex.: `…webp?w=960` num banner que nunca passa de 960 px).
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
No `pnpm local`, o site de exemplo usa um banner no hero e um **logo** no cabeçalho (`exemplos/loja-site/banner.png` e `logo.png`) que o ambiente envia sozinho para cada tenant de demonstração; o logo entra pela prop `logo` do `site/cabecalho`.

## Limites assumidos
- **Versões só nas larguras fixas** (160/480/960/1920) e sempre em webp; o `midia/imagem` gera o `srcset` sozinho (veja abaixo); o `site/hero` (fundo em CSS) e o `layout/destaque` ainda escolhem a versão pelo caminho; o original continua disponível. A recodificação de jpeg usa qualidade 88 (a de webp, 88; as versões, 78): não é "sem perda" quando acontece (só por orientação ou tamanho).
- **sharp é uma dependência nativa** (libvips pré-compilada, baixada por `optionalDependencies` por plataforma; sem script de build). Em imagem Docker, a instalação precisa rodar na MESMA plataforma que vai executar (glibc ou musl).
- **Sem CDN nem armazenamento de objetos**: ficam no Postgres (`bytea`); serve ao porte atual, não a milhares de imagens grandes.
- Remover não confere se alguma página ainda usa a imagem. A decodificação roda no processo do gateway (uma imagem de 40 MP consome memória e CPU por instantes): o limite de taxa da API do Studio e o teto de 2 MB por arquivo são a proteção. Sem pasta, sem renomear, sem substituir mantendo a URL (por desenho: a URL é o hash).
- Só imagens. Outros arquivos (PDF para download, fontes do tenant) precisam de outro contrato.

## `srcset` automático (`midia/imagem`)
Quando `src` é uma imagem hospedada pela plataforma (`/_polaris/img/<hash>.png|jpg|webp`) **e** o bloco tem `tamanhos` ou `largura`, ele emite `srcset` com as versões webp de **160, 480, 960 e 1920 px** (`<hash>.webp?w=N Nw`) e `sizes`: o que a página declarar em **`tamanhos`** (ex.: `(min-width: 800px) 50vw, 100vw`), ou "até `largura` px" se há `largura`; **sem nenhum dos dois não há `srcset`**: o navegador assumiria 100vw e, como a candidata `Nw` pode ser o original menor que N, o tamanho natural da imagem encolheria (medido no logo do cabeçalho: 64 → 42 px). O `src` continua o original (navegador sem `srcset`). **gif** e URLs de fora **não** ganham `srcset` (o gif pode ser animado). As quatro larguras são sempre listadas: a imagem menor que uma largura (ou animada) **não tem essa versão**, e o servidor responde `<hash>.webp?w=N` com o **original** em vez de 404, então nenhuma candidata quebra. Igual no React, no runtime vivo e na emissão estática (teste de paridade).
