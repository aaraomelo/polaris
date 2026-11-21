# Modelos (templates) de site

Um **modelo** é um pacote de nós (tema, páginas, blocos de composição, dados, traduções, formulários e, opcionalmente, o nó `tenant` do site) com `nome`, `versao` e `idiomas`, guardado **no banco, por tenant**. Serve para guardar um site inteiro e aplicá-lo a um tenant sem copiar arquivos.

## Guardar (versões imutáveis)
`PUT /studio/templates/:slug` (`studio.editar`) com `{ nome, versao (1.2.3), idiomas, nos, descricao?, segmento?, miniatura?, nota? }`.
- O pacote é validado **inteiro** antes de gravar: schema de cada nó, referências entre eles e estrutura, como o armazém validaria nó a nó. Só entram os `kind` que um tenant pode ter (`pagina`, `tema`, `dados`, `papel`, `documento`, `bloco` por composição, `formulario`, `cartaz`, `traducao`) e `tenant`.
- Cada gravação é uma versão `seq` (1, 2, 3…); conteúdo idêntico à cabeça não cria outra (200 em vez de 201). Nada se altera ou apaga (gatilho no banco); remover grava uma lápide e o histórico fica.
- Limites: 4 MB e 500 nós por modelo, 100 modelos e 1000 versões por slug.

## Ler
- `GET /studio/templates`: `{ modelos }`, a lista **leve** (cabeças, sem os nós; traz `nNos`).
- `GET /studio/templates/:slug[?seq=N]`: o modelo inteiro (a cabeça ou a versão N).
- **Leitura fragmentada** (para o Studio abrir um modelo grande sem baixar tudo): `GET /studio/templates/:slug/manifesto[?seq=N]` devolve os metadados e, de cada nó, `{kind, id, hash, bytes}` (o hash é o SHA-256 do JSON do nó), tudo calculado no banco; `GET /studio/templates/:slug/nos/:kind/<id>[?seq=N]` devolve **um** nó, com `ETag` igual ao hash do manifesto e `Cache-Control: private, no-cache`: quem já tem o nó manda `If-None-Match` e recebe 304 sem corpo. O manifesto de 14 nós tem poucos KB, e o cliente traz a página ou o tema só quando precisa.
- `GET /studio/templates/:slug/historico` (`{ versoes }`) e `DELETE /studio/templates/:slug`.
- `studio.ver` basta para ler; o tenant vem só da sessão (um tenant nunca vê o modelo de outro).

## Aplicar
`POST /studio/templates/:slug/aplicar` (`studio.editar`) com `{ seq?, publicar?, nota? }`:
1. `@img/<nome>` nos nós vira o endereço do **ativo do tenant** com esse nome; faltando alguma imagem, **nada é gravado** e o erro lista os nomes.
2. O pacote é revalidado e gravado no armazém do tenant, como rascunhos, na ordem das dependências (traduções e temas, formulários, blocos, dados, papéis, documentos, cartazes e por fim as páginas).
3. O nó `tenant` do modelo **não** substitui o do tenant: o tenant continua dono do alias, do nome e dos módulos; o modelo só dá `tema`, `paginas`, `paginaNaoEncontrada`, `idiomas` e `idiomaPadrao` (usa o nó de mesmo alias, senão o primeiro).
4. Com `publicar: true`, cria e promove uma release; sem ele, o site só muda quando alguém publicar.

Limites: os nós ainda são guardados juntos num único JSON por versão (a leitura fragmentada extrai no banco, mas não deduplica entre versões; guardar cada nó por conteúdo é o passo seguinte, só vale com muitas versões de modelos grandes); aplicar não é atômico (se um nó falhar no meio, os anteriores ficam como rascunho, que não vai ao ar sem release; a validação do pacote antes de gravar torna isso raro); aplicar não remove nós que o tenant já tinha e o modelo não traz; o modelo não carrega as fotos, só os nomes (os ativos precisam existir no tenant).

## No Studio
A ferramenta **Modelos** (menu lateral) lista os modelos, abre o **manifesto** de um (só `kind`, `id` e tamanho de cada nó: ~2 KB para a Maison) e baixa o JSON de **um** nó só quando se clica nele (~12 KB a página Sobre), com os botões *Aplicar ao site (rascunho)* e *Aplicar e publicar*. Medido no Chrome: abrir o painel baixa a lista, "Ver os nós" baixa o manifesto e cada nó é uma requisição própria. O contrato está no serviço `studio` (`listarModelos`, `manifestoDoModelo`, `abrirNoDoModelo`, `aplicarModelo`).
