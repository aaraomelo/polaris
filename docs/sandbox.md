# Código customizado isolado (escape hatch)

Um bloco pode trazer código do tenant (`bloco.spec.codigo`). Esse código **não é confiável**: ele roda no servidor (SSR) e no navegador.
Este documento é o modelo de ameaça: o que é bloqueado, como, e o que **não** é garantido.

## Duas rotas de execução
| `modo` | Linguagem | Como roda | Saída | SSR |
|---|---|---|---|---|
| `puro` (padrão do js) | `js` | QuickJS (WASM), contexto novo a cada execução | **descrição de UI** validada (allowlist) e renderizada pelo host | sim, e hidrata igual |
| `iframe` (padrão do html) | `html` ou `js` | `<iframe sandbox>` sem `allow-same-origin`, CSP por hash | o que o documento do iframe desenhar, dentro da caixa dele | o `<iframe srcdoc>` sai no HTML |

`html` nunca é `puro`. `permissoes` e `altura` só existem no `iframe`.

## Modo puro: o código só CALCULA
```js
function render(props, ctx) {            // props: JSON; ctx: { agora, idioma, tenant }
  return { tag: 'ul', attrs: { class: 'itens' }, children: props.itens.map(function (i) { return { tag: 'li', children: [String(i)] } }) }
}
```
Sem `process`, `require`, `fetch`, timers, DOM, módulos, relógio real nem aleatoriedade real. Cada execução usa um **contexto novo** (nada vaza entre blocos nem entre tenants).
A saída é **dado**: o host valida (`sanitizaUI`) e renderiza com `createElement`. Nunca há `innerHTML`.
- Tags: allowlist de ~40 (texto, listas, tabelas, `a`, `img`…). **Fora**: `script`, `iframe`, `style`, `form`, `input`, `svg`, `object`, `link`, `meta`, `base`, `video`…
- Atributos: allowlist por tag, com valor validado. **Fora**: `on*`, `style`, `id`, `name` (DOM clobbering), `srcdoc`, `formaction`, `target`. `href` passa por `urlSegura` (sem `javascript:`/`data:`/`vbscript:`, mesmo com espaço ou quebra de linha); link externo ganha `rel="noopener noreferrer"`.
- **Imagens**: só do próprio site (`/caminho`) ou de origem que a plataforma liberou (`origensPermitidas`). Imagem externa seria um **canal de exfiltração** (`<img src="https://x/?dado=...">`): o código recebe props que podem ter dados do usuário. Toda `<img>` leva `referrerPolicy="no-referrer"` e `loading="lazy"`; `<img>` sem `src` válido é descartada.
- Limites: 2000 nós, 32 níveis, 10 000 caracteres por texto, 256 KB de saída, 64 KB de props, 20 linhas de `console`.
- O que foge da allowlist é **removido e reportado** (`onErro`), a página segue.

## Determinismo (SSR = hidratação)
O código roda no servidor E no navegador e a saída precisa ser idêntica. O prelude fixa:
`Date.now()`/`new Date()` = `ctx.agora` (decidido uma vez por requisição e enviado no estado de hidratação); **fuso UTC** (getters/setters locais, `toString`, `toLocale*`, `getTimezoneOffset`, parse de ISO sem fuso e construtor por partes); `Math.random` com semente derivada do código e das props.
Fora do prelude: use datas em ISO. Verificado em 5 fusos diferentes (inclusive UTC+14 e UTC−11) com um controle mostrando que o `Date` nativo mudaria.

## Duas implementações do executor
| | `@polaris/engine/sandbox` (local) | `@polaris/engine/sandbox-node` (worker) |
|---|---|---|
| Onde | navegador e Node, mesmo processo | **só Node**, `worker_thread` |
| Isolamento de realm e memória | sim (limite de 8 MB) | sim, **e** o worker tem heap próprio (128 MB) |
| Prazo | **cooperativo**: o interpretador confere entre instruções | **duro**: se estoura, o worker é **morto** (`terminate`) e um novo sobe |
| Uso | cliente (o código é do mesmo site que o usuário já abriu) | **servidor (SSR): use este** |

### Por que o prazo cooperativo não basta (medido)
O `interrupt` do QuickJS é conferido entre instruções, não dentro de uma chamada nativa. Medimos: `Array(1e5).join('x')` em laço leva **~5 s** mesmo com prazo de 50 ms e 192 KB de memória, e uma bomba de strings grandes leva **~7 s** para falhar por memória. Um tenant com um bloco assim travaria o SSR para todos os outros (vizinho barulhento).
O backend em worker usa uma ponte síncrona (`Atomics.wait` + `receiveMessageOnPort`; o SSR é síncrono) e mata o worker no prazo duro: o caso de 5 s é cortado em < 1 s. Custo medido: ~0,4 ms por execução + 46 ms para subir o worker (uma vez, e de novo após uma morte).
- **Atenção operacional**: enquanto a ponte espera, a thread principal está bloqueada (no pior caso `ms + margemDuraMs` = 400 ms por execução). `orcamentoMs` (padrão 2 s) e `maxExecucoes` (padrão 100) limitam o total **por passagem de render**, e o cache evita reexecutar o mesmo `(código, props)`; **falhas também são cacheadas** (um bloco que estourou o prazo não é tentado de novo). Para isolar de verdade um tenant do outro, rode o SSR em processos/workers por tenant (card E10).

## Modo iframe
- `sandbox`: nunca `allow-same-origin`, `allow-top-navigation*`, `allow-popups*`, `allow-modals`, `allow-downloads`. `html` = `sandbox=""` (nenhum script). `js` = `allow-scripts`. `formularios` acrescenta `allow-forms`. `allow=""`, `referrerPolicy="no-referrer"`.
- CSP no documento (primeira coisa do `<head>`): `default-src 'none'`; `script-src` **só o hash** do script inline (nunca `unsafe-eval`; `'none'` no html); `connect-src`/`img-src`/`form-action` só nas origens declaradas; `frame-src`, `object-src`, `worker-src`, `base-uri` = `'none'`.
- O hash (SHA-256) é determinístico: o `srcdoc` do servidor e o do cliente são iguais (um nonce aleatório quebraria a hidratação).
- `permissoes`: `formularios`, `rede:https://origem`, `imagens:https://origem`. Origem = `https://dominio[:porta]` com TLD alfabético; **recusados**: `http`, curinga, caminho, credenciais, IP, `localhost`, nomes de uma só palavra, `.local`/`.internal`/`.lan`/`.corp`/`.home`. A origem também precisa estar em `origensPermitidas` da plataforma (comparação exata; nada é liberado por padrão). Sem isso, o navegador do usuário poderia sondar a rede interna dele.
- html: `{{ expressão }}` com `props` e `tenant`, valor **sempre escapado**. O `<script>` que o autor escrever no html está lá, mas a CSP e o sandbox impedem a execução.
- js: o código vê `props` (congelado) e `polaris.altura(n)`. O host só aceita a mensagem de altura vinda do **próprio iframe** (`event.source`), valida o número e limita a 1–4000 px.

## O que NÃO é garantido (leia antes de usar)
1. **Sem sandbox configurado, nenhum bloco de código executa** (falha fechada: o bloco é omitido e reportado). A configuração (`EntradaPagina.codigo`, `renderPaginaStream({ codigo })`) é o interruptor da plataforma.
2. **Prazo duro só com o backend em worker (Node).** No navegador o prazo é cooperativo: um código malicioso pode travar a aba do próprio usuário (não o servidor).
3. O código **vê as props** que recebe: não passe segredo. O **código-fonte vai para o navegador** dentro do `programa`/estado (é necessário para executar no cliente): não coloque segredo no código.
4. Um iframe pode desenhar **qualquer UI dentro da caixa dele** (phishing visual). `allow-forms` + `rede:` permitem enviar o que o usuário digitar para a origem declarada: só libere para origens em que você confia.
5. Canais laterais de hardware (Spectre etc.) não são tratados aqui: dependem de isolamento de site/processo no deploy (`Cross-Origin-*`, processos por tenant).
6. `<a href>` em UI do modo puro pode levar o usuário a uma URL qualquer (com `rel="noopener noreferrer"`): exige um clique e não é exfiltração silenciosa, mas pode ser enganoso.
7. Um bug no QuickJS ou no WASM do Node é um risco aceito (superfície pequena, sem acesso a APIs do host). Mantenha `quickjs-emscripten` atualizado.

## Onde está
`packages/engine/src/codigo/` (núcleo puro: `ui`, `permissoes`, `iframe`, `html`, `script`, `sessao`, `def`) e `src/sandbox/` (`local.ts`, `worker.ts`).
Subpaths: `@polaris/engine/sandbox` (`criaSandboxLocal`), `@polaris/engine/sandbox-node` (`criaSandboxWorker`).
```ts
const sandbox = await criaSandboxWorker()                       // servidor, uma vez
await renderPaginaStream(programa, componentes, { codigo: { sandbox, origensPermitidas: ['https://tiles.exemplo.com'] }, … })
// cliente: const local = await criaSandboxLocal(); await hidrataAsync(componentes, { codigo: { sandbox: local } })
```
