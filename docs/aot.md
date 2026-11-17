# AOT: dos schemas a arquivos prontos

`pnpm aot --nos <dir> --saida <dir> [--tenant <id>]... [--segmento <s>]...` (em `packages/engine`) lê os nós JSON (`*.json`, cada um um nó ou um array
de nós), aplica a cascata do registry em cada contexto (core, cada tenant, cada segmento) e escreve, por página publicada:

| arquivo | quando | conteúdo |
|---|---|---|
| `<id>.<hash>.programa.json` | sempre | o `Programa` (IR + modelos dos blocos), JSON puro |
| `<id>.<hash>.html` | página sem dados e sem parâmetros de rota | documento completo pré-renderizado |
| `<id>.<hash>.js` | modo `vivo` | cliente da página (IIFE `Polaris.monta`), só com as funções e blocos que ela usa |
| `manifesto.json` | sempre (último a ser escrito) | modo, motivos, nó de origem (versão e escopo), arquivos com tamanho, gz e sha256, uso, hash de CSP |

**Modos** (o mais barato que serve):
- `estatico`: sem eventos, streaming nem blocos interativos → HTML sem nenhum `<script>`. Zero JavaScript no cliente.
- `vivo`: o runtime sem React (`docs/vivo.md`). O HTML já traz os marcadores que o cliente adota na hidratação, o programa embutido
  (`<script type="application/json">` com escape de `<`, `>`, `&`, U+2028/9) e um script de inicialização cujo hash vai no manifesto (`cspScript`) para a CSP.
- `react`: fallback (streaming, blocos de código…); o manifesto diz por quê.

Páginas com dados ou parâmetros na rota não têm HTML pré-feito (`prerenderizada: false`); o servidor renderiza a cada requisição com o mesmo programa.

**Garantias**
- **Determinístico**: mesma entrada → mesmos bytes (sem data/hora; até a ordem de registro dos nós não importa). O nome do arquivo carrega o hash do conteúdo: cache imutável.
- **Incremental**: o que não mudou não é reescrito (nem tem o mtime tocado); mudar uma página reescreve só os arquivos dela.
- **Invalidação por versão do nó**: o manifesto registra `no.versao` e `no.escopo`; arquivos que o manifesto anterior listava e o novo não listam são removidos.
  Arquivos que o build não criou **nunca** são apagados.
- **Não derruba o build por uma página inválida**: as outras saem; os erros vêm com o caminho JSON e o comando termina com código 1 (CI falha). Sem argumentos: uso e código 2.
- Escrita atômica (temporário + rename).

API: `construirAot(registry, { destino, contextos })` e `nosDoDiretorio(dir)` em `@polaris/engine/aot`.
