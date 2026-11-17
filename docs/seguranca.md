# Segurança do runtime

Verificada por `packages/engine/test/seguranca.test.tsx` (hostis em todos os caminhos de render) e por `test/sandbox.test.ts` / `test/vivo-codigo.test.tsx` (código de tenant).

| Ameaça | Defesa | Onde |
|---|---|---|
| String do tenant virando código (`eval`) | Nenhum `eval`/`new Function`/`innerHTML=`/`document.write`/timer com string no `src/`, exceto 4 pontos revisados (o teste varre o código e falha se aparecer outro). Os dados entram só como literal `JSON.stringify` no JS gerado, ou como nó de texto no DOM | `estatico/gera.ts`, `codigo/sintaxe.ts` (dentro do QuickJS), `vivo/stream.ts`, `render/interpreta.tsx` |
| Injeção em HTML/atributo | Escape em todo texto e atributo no servidor (`escHtml`); no cliente, só `createTextNode`/`setAttribute`; JSON embutido passa por `jsonSeguro` (`</script>`, U+2028/9) | `estatico/escape.ts`, `render/json.ts` |
| URLs `javascript:`/`data:`/`vbscript:` em `href`/`src` | `urlSegura`: allowlist de esquemas (`http`, `https`, `mailto`, `tel`) ou relativa; detecta o esquema ignorando controles e espaço (`java\nscript:`) e aparar só o que o navegador apara (NBSP não é aparado: `trim()` seria uma falha) | `render/url.ts` |
| Expressões acessando protótipo, global ou funções arbitrárias | Só chamadas de funções do registro (`funcoes`); acesso a campo por `own property`; `constructor`, `__proto__`, `eval`, `Function`, `globalThis`, `process` não existem para a expressão; chamada fora do registro é recusada na análise (parser/`validaExpr`) | `expr/*` |
| Código customizado do tenant | Sandbox (QuickJS WASM) e/ou iframe sem `allow-same-origin`, saída validada por allowlist, fail-closed | `docs/sandbox.md` |
| Atributos `on*` / handlers inline | Nenhum: eventos são delegados por `addEventListener` no contêiner | `vivo/monta.ts` |

## CSP recomendada
```
default-src 'self';
script-src 'self' 'nonce-<N>';
style-src 'self';
style-src-attr 'unsafe-inline';   /* o layout usa style="display:flex…" em atributo */
img-src 'self' https:;            /* ou a allowlist do tenant */
frame-src 'none';                 /* abra só se houver bloco de código em modo iframe (srcdoc) */
object-src 'none'; base-uri 'none'; form-action 'self'
```
- `streamVivo({ nonce })` põe o nonce nos dois `<script>` executáveis; o resto são `application/json` (não executam) e nenhum atributo `on*` é emitido (testado).
- O script de boot é **estático** (igual para qualquer página): também serve CSP por hash.
- O cliente nunca precisa de `unsafe-eval`: as expressões viram closures, não texto avaliado.
- Bloco de código em iframe: `srcdoc` leva a própria CSP (`script-src 'sha256-…'` ou `'none'`) e `sandbox` sem `allow-same-origin`.

## Limites conhecidos
- `style-src-attr 'unsafe-inline'` é necessário enquanto os blocos de layout usarem `style=""`; migrar para classes geradas elimina isso.
- O CSP do documento hospedeiro é responsabilidade de quem serve a página (o runtime só emite o nonce).
- Texto com `{…}` é interpolação por design: não dá para escrever chaves literais num texto de página sem escape; é recusado/avaliado, nunca executado como JS.
