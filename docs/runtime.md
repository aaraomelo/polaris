# Runtime interpretador (packages/engine)

Pipeline: **nós no Registry → `compilaPrograma` → `Programa` (JSON) → `renderPaginaHtml` (servidor) → `hidrata` (cliente)**.

- `compilaPrograma(registry, páginaNó, ctx)`: compila a página e, transitivamente, o modelo de cada bloco composto que ela usa. Devolve `{ ok, programa }` ou `{ ok: false, erros }`.
  O `Programa` é JSON puro (cacheável, enviável ao cliente); o renderer **não consulta o registry**.
- `renderPaginaHtml({ programa, componentes, dados, params, consulta, tenant })`: documento HTML completo + estado de hidratação (`<script type="application/json" id="__POLARIS__">`, com `<`, `>`, `&` e U+2028/9 escapados).
- `hidrata(componentes)` (import de `@polaris/engine/cliente`): lê o estado embutido e chama `hydrateRoot`. O conjunto de `componentes` do cliente precisa ser o mesmo do servidor.

## Contrato de bloco nativo
`({ props, slots, id, caminho }) => ReactNode`. `props` já vêm avaliadas (tipos preservados); `slots` já vêm renderizados. Registre a implementação em `componentes[interface]`;
um bloco sem componente próprio usa o primeiro da cadeia de `extends` que tiver.

## Semântica
- **Escopo da página**: `params`, `consulta`, `tenant` + só os `spec.dados` declarados (o chamador resolve os valores; nomes reservados e `toString` etc. são tratados).
- **Blocos compostos**: o modelo vê só `props` e `tenant`. Os filhos passados nos slots são avaliados no escopo de **quem os passou** (inclusive o alias do `repetir` de fora) e só quando o modelo chama `core/slot`.
- **Falhas**: componente ausente, modelo ausente e bloco de código geram `onErro` com o caminho do schema e a página segue. No **cliente** a falha de render de um bloco é isolada (`Isola`); no **servidor** o erro propaga ao chamador, para a página não sair pela metade.
- **Limites**: 1000 iterações por `repetir` (trunca e avisa), profundidade de renderização 200.
- **Segurança**: React escapa o texto; `href`/`src` dos blocos base passam por `urlSegura` (só http, https, mailto, tel e relativas; sem `javascript:`/`data:`, mesmo com espaços ou quebras de linha no esquema).

## Biblioteca nativa mínima
`registraBase(registry)` + `COMPONENTES_BASE`: `layout/pilha`, `layout/linha`, `texto/titulo`, `texto/paragrafo`, `midia/imagem`, `nav/link` (e `core/slot`). A biblioteca completa é a E3.

## Dados, estado e ações (declarativos)
**Dados.** `spec.dados`: `nome → "id"` ou `nome → { dados: "id", args: { … } }` (args são templates; veem `params`, `consulta`, `tenant`, `estado`). O nó `dados` declara `parametros` tipados
(tipos de `comum`, `obrigatorio`, `padrao`, `lista`), `cache` (`ttlSegundos`), `timeoutMs` e `carregar: auto | manual` (manual = só por ação, para mutations).
`carregaDados(programa, { provedores, … })` resolve as fontes `auto` **em paralelo** e **nunca lança**: devolve `{ dados, status, erros }`. Argumentos são validados e normalizados (texto numérico vira número);
nome desconhecido, obrigatório ausente e tipo errado impedem a chamada. Provedores `servico` e `http` são injetados (o runtime nunca faz fetch por conta própria; a allowlist é de quem implementa).
O erro entregue ao HTML é **opaco** (`falha ao carregar os dados`); o detalhe vai para `onErro` (log do servidor). **Cache**: TTL, LRU, deduplicação de chamadas em voo, valor clonado na entrada e na saída,
e o **tenant sempre faz parte da chave** (inclusive com `cache.chave` customizada). `renderPaginaCompleta` = carregar + renderizar; `criaCarregador` faz o mesmo no cliente para a ação `executar`.

**Estado.** `spec.estado: { nome: { tipo, inicial, lista? } }` → variável `estado.nome`. `status.<dado>` (`ok | carregando | erro`) e `erros.<dado>` também entram no escopo. O store é imutável
(`reduz` devolve novo objeto e **mantém a referência das fatias intocadas**).

**Eventos e ações.** A instância liga `eventos: { aoClicar: [ações] }` (o bloco declara os eventos que emite; nome errado dá "quis dizer"). Ações, em sequência:
- `definir { estado, valor }`: `valor` é expressão (vê `evento`).
- `executar { dados, args?, depois?, emErro? }`: refaz a fonte com os args (somados aos declarados); `depois` vê `resultado`, `emErro` vê `erro`. Resposta antiga é descartada (vale a última chamada) e nada atualiza depois de desmontar.
- `navegar { para }`: só URLs seguras (`urlSegura`).
Limites: 5 níveis de `depois`/`emErro` e 50 ações por evento. Eventos só em páginas (o modelo de um bloco não tem estado nem dados).

## Streaming SSR (`@polaris/engine/servidor`)
`renderPaginaStream(programa, componentes, opcoes)` devolve `{ status, stream, tudoPronto, abort, preCarga }`; rejeita se o **shell** falhar (ainda dá para responder 500). Falha de dado ou de fronteira nunca derruba a página.
- `spec.dados.<nome>: { dados, args?, stream: true }` marca um dado como **em streaming**: não bloqueia o primeiro byte. Todas as cargas `auto` começam **imediatamente**, em paralelo; só as bloqueantes seguram o shell.
- **Fronteira** = o nó mais externo cujas expressões próprias (`props`, `se`, `repetir.cada`) usam o dado. Fica atrás de `Suspense`; o descendente que usa o mesmo dado não cria outra. `status.x`, `erros.x` e eventos **não** criam fronteira.
- `esqueleto: instância` (na mesma instância) é o que aparece até o dado chegar. Não pode usar o dado em streaming (erro de compilação); esqueleto sem dado em streaming também é erro. O `titulo` não pode depender de dado em streaming.
- O valor do dado viaja **dentro do HTML da fronteira** (`<script type="application/json" data-pl-b="chave">`). O React só hidrata o trecho depois que o HTML dele chegou, então o cliente lê o valor do DOM: **sem segunda chamada**, sem depender da ordem de entrega. O JSON sai escapado (`<`, `>`, `&`, U+2028/9).
- O estado de hidratação (`__POLARIS__`) vai **antes** do conteúdo e traz só o que é bloqueante; o `status` de um dado em streaming começa `carregando` no cliente e passa a `ok` (ou `erro`) na hidratação.
- `esperaTudo: true` (robôs/SEO) espera tudo e envia a página completa, sem esqueletos. `abortaEmMs` (padrão 20 s) entrega ao cliente as fronteiras que não terminaram. `nonce` (CSP) vai nos scripts inline do React e nos `<script type=module>`.
- Limitação: nós `status.x` fora de fronteira só atualizam depois da hidratação (sem JS ficam `carregando`); use esqueleto/fronteira para conteúdo que precisa estar certo sem JS.

## Code splitting por bloco
`lazyBloco(() => import('./grafico'), { chunk: '/assets/grafico.js' })` registra um bloco carregado sob demanda.
- Só os blocos que o **programa usa** (inclusive dentro de modelos compostos e esqueletos) são carregados: `blocosUsados`. Registrar não carrega.
- `preCarregaBlocos` os carrega **antes** de renderizar; depois disso o bloco é chamado de forma síncrona (sem Suspense nem fallback), então servidor e cliente geram a mesma árvore. `renderPaginaStream` faz isso por padrão; no cliente use `hidrataAsync` (de `@polaris/engine/cliente`).
- Sem pré-carga cai em `React.lazy` + `Suspense` (navegação no cliente). Módulo que falha: relatado, o bloco é omitido e o resto da página sai.
- `chunksParaPreload` → `<link rel="modulepreload">` no `<head>` (só dos que informaram `chunk`).

## Ainda não coberto (cards seguintes da E2)
Navegação no cliente do roteamento (ver docs/rotas.md), sandbox de código (33k), JIT/AOT (33e/33f), segurança do runtime (33m), re-render localizado e histórico/diff de estado (58q/58r). Versão web (`renderToReadableStream`) do streaming.