# Polaris Studio (editor visual por schema)

O Studio edita **nós** (páginas e temas) e a saída é sempre o nó em JSON, validado pelo schema e gravado como **versão imutável** (E7). Nada de código gerado à mão.

```
apps/studio            SPA React (esbuild) + servidor Fastify      ← UI: árvore, formulário, preview, tema, histórico, comentários
packages/studio        núcleo puro, sem UI (testável)             ← formulario, arvore, historico, tema, diff, comentarios
packages/packs         rotasStudio: API de autoria `/studio/*`     ← sessão → tenant/autor, versões, 409, diff, comentários
```

## O que faz
- **Editor de páginas**: árvore de blocos (adicionar, duplicar, remover, subir/descer, recuar/avançar), **formulário gerado do JSON Schema das props** do bloco (o que o schema não descreve com simplicidade vira campo JSON, nunca some; valor pode ser literal, binding `{estado.x}` ou `$expr`), **preview ao vivo** com o mesmo compilador e renderizador da produção sobre o **rascunho**, desfazer/refazer (digitar vira um passo só), atalhos (Ctrl+S, Ctrl+Z, Ctrl+Shift+Z/Y).
- **Editor de tema**: tokens por grupo (cor, tipografia, espaçamento, raio), **modos** (escuro…) como sobrescritas com herança visível, validação de cada valor (cor `#hex`/`rgb()`/`hsl()`; medida `8`, `0.5rem`), **auditoria de contraste WCAG** por modo (4,5:1 texto, 3:1 UI), amostra ao vivo.
- **Histórico e diff**: lista de versões (quem, quando, nota), **diff semântico** entre duas versões ou contra o padrão, restaurar uma versão no editor (vira edição desfazível; só grava ao salvar).
- **Comentários**: do nó ou **ancorados num bloco** (pelo id), fios com respostas e "resolvido", selo na árvore; se o bloco some, o fio fica **órfão** (legível, nunca reancorado por posição).

## Diff semântico
Não é diff de texto. Blocos casam por **id** (sem id: posição e tipo no mesmo pai). Mover um bloco é `movido` (de `A › b` para `A › c`), não remoção + adição; trocar a ordem entre irmãos é `reordenado` (pela maior subsequência comum, então só o mínimo é apontado); subárvore adicionada/removida aparece **uma vez**, com a contagem de blocos dentro; prop alterada mostra **qual** prop, antes e depois. O resto do nó (rota, título…) é diff campo a campo; `versao` é ignorada.

## API de autoria (`rotasStudio`)
Tenant e autor vêm **sempre da sessão** (`autentica` é injetado); corpo com `autor`/`tenantId` é 400. Permissões `studio.ver`, `studio.comentar`, `studio.editar`.
`GET /studio/blocos` · `GET /studio/nos` · `GET|PUT|DELETE /studio/nos/:kind/:id` · `GET /studio/historico/…` · `GET /studio/versao/…?seq=` · `GET /studio/diff/…?de=&para=` (`base` = padrão) · `GET|POST /studio/comentarios` · `POST /studio/comentarios/:id/resolver`.
**Concorrência otimista**: o `PUT` leva `baseSeq` (a versão que o editor abriu); se outra pessoa salvou depois, **409** com quem e qual versão, e nada é sobrescrito. Respostas com `cache-control: no-store`.

## Segurança
- O preview roda num **iframe `sandbox=""`** (sem scripts, origem opaca) com HTML gerado pelo engine (texto escapado); teste de que `<img onerror>` e `<script>` viram texto.
- CSP do Studio: `default-src 'none'`, `frame-ancestors 'none'`, scripts só `'self'` **e `'unsafe-eval'`** (o Ajv compila validadores com `new Function` para validar as props no navegador). É uma ferramenta de autoria autenticada, sem conteúdo de terceiros na origem; o preview, que mostra conteúdo do tenant, fica isolado no sandbox. `style-src 'unsafe-inline'` existe porque o `srcdoc` herda a política e precisa do `<style>` do tema.
- Comentários e textos são guardados como texto e exibidos como texto (React escapa); o `CHECK` do banco limita o tamanho.

## Atrás do gateway (produção)
`POLARIS_STUDIO_DIR` (no compose: `/app/dist/studio`, que o `empacota` preenche) liga `/studio` (página e ativos) e `/studio/*` (API) **no próprio gateway**, que exige `DATABASE_URL_PLATAFORMA`. Sem a variável, `/studio` é 404.
- **Identidade**: o JWT do gateway. Tenant e usuário (o `sub`, que vira o **autor** das versões e comentários) vêm só do token; tenant suspenso ou host de outro tenant = 401. Corpo com `autor`/`tenantId` é 400.
- **Permissão** por papéis do pack `studio`: `studio.leitor` ⊂ `studio.comentarista` ⊂ `studio.editor` (mesma semântica de acesso dos serviços: papel desconhecido não dá nada; papéis de outros domínios, como `gerente`, também não).
- **nginx**: `location /studio` repete os cabeçalhos de transporte e **não** a CSP genérica (que quebraria o Studio); a CSP é a do próprio Studio. Mesmo limite de taxa da API.
- Testado em `apps/polaris/test/e2e.test.ts` (gateway real, JWT, Postgres) e `tools/ferramentas/test/deploy.test.ts`. O nginx continua sem `nginx -t` real (ver `docs/deploy.md`).

## Rodar
`pnpm --filter @polaris/studio-app dev` → http://127.0.0.1:4300/studio (banco em memória, um tenant de demonstração, usuário de desenvolvimento com todas as permissões; **recusa rodar com NODE_ENV=production**).

## Limites assumidos
- **O login não existe aqui**: o gateway valida o JWT, mas quem o emite é o provedor de identidade. O Studio recebe o token no fragmento da URL (`/studio#token=…`), guarda em `sessionStorage` e apaga o fragmento; **falta o fluxo de login do provedor que redireciona para lá**. A autenticação do `bin/dev.ts` (cookie) é um stub e recusa produção.
- Salvar é **rascunho**: o nó vira a "cabeça" do tenant. Publicar (release, promoção, preview assinado) continua pela API de releases do E7; o Studio ainda não tem botão de publicar. Salvar com erro de compilação é permitido e **avisado** (não deve ser publicado).
- O preview não busca `spec.dados`: blocos ligados a dados externos aparecem vazios. Clicar no preview não seleciona o bloco (a seleção é pela árvore; o bloco selecionado, se tem id, é contornado).
- Reordenar é por botões (subir, descer, recuar, avançar); **não há arrastar e soltar**. Só páginas e temas (documentos, blocos compostos e papéis não têm editor).
- Dois editores no mesmo nó **não** se fundem: o segundo a salvar recebe o conflito e recarrega (sem merge de três vias; o diff semântico existe para isso, mas a fusão não foi feita).
- Comentários não podem ser editados nem apagados; só resolvidos. Sem notificações.
- Acessibilidade: roles, rótulos, foco e árvore com níveis são verificados por teste; **não** foi feita auditoria com leitor de tela, e a árvore não tem navegação por setas (só Tab/Enter).
- O bundle tem ~800 KiB (inclui Ajv, React e o engine); não há divisão de código.
