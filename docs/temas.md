# Temas e design tokens

Um tema é um nó `kind: tema` (`tokens` + `modos`), emitido como CSS por `emite(no, 'css')`. O Polaris acrescenta (`packages/engine/src/tema/`): tokens semânticos, o importador do tema do tiffany-erp, a folha de estilo dos blocos e a auditoria de contraste.

## Tokens (viram variáveis CSS `--grupo-nome`)
| Grupo | Tokens |
|---|---|
| `cor` | `primaria`, `primariaHover`, `primariaClara`, `secundaria`, `destaque`, `fundo`, `superficie`, `superficieAlt`, `borda`, `texto`, `textoSuave`, `sucesso`, `alerta`, `erro`, `textoSobrePrimaria` |
| `raio` | `pequeno`, `grande` (px) |
| `espacamento` | `base` (rem), `borda` (px) |
| `tipografia` | `familia`, `tamanhoBase` |

`modos.escuro` redefine só o que muda (as cores). Sai como `[data-modo="escuro"]` (escolha explícita no `<html>`) e como `@media (prefers-color-scheme: dark)` para `:root:not([data-modo])` (segue o sistema quando não há escolha).

## Do tiffany-erp
`temaDeConfig(id, config, { escuro? })` converte o `ThemeConfig` do Tiffany (`primary`, `bg`, `surface`, `textMuted`, `radius`, `spacingBase`…) em nó `tema`: cores renomeadas para o vocabulário semântico, `spacingBase` (rem×100) vira `espacamento.base`, geometria limitada nas mesmas faixas do DTO. As paletas `patria-blue`, `nco-red` e `graphite` vêm como dado (`PRESETS_TIFFANY`) e são registradas por `registraTemas(registry)`, junto do tema **`padrao`** (claro = patria-blue, mais um modo escuro próprio).

## Como a página recebe o tema
- **Escolha**: `tenant.spec.tema` (o tenant aponta um tema) ou `padrao`. Como é um nó comum, vale a cascata tenant → segmento → core: um tenant pode registrar `tema` com id `padrao` no próprio escopo e trocar tudo.
- **AOT**: `construirAot` escreve `tema.<hash>.css` (variáveis + folha dos blocos) uma vez por tema e contexto, liga com `<link rel="stylesheet">` nas páginas estáticas e vivas e lista no manifesto (`arquivos.tema`). Reconstruir sem mudar o tema não reescreve nada. `semTema: true` desliga.
- **Streaming/estático**: `streamVivo({ estilos: [href], modo })` e `documentoEstatico({ estilos, modo })`; o `<link>` vai no `<head>`, antes do corpo.
- **CSP**: a folha vem de arquivo (`style-src 'self'`), sem `<style>` inline. Os blocos de layout ainda emitem `style=""` para `gap`, `colunas` e `tamanho` (valores livres), por isso `style-src-attr 'unsafe-inline'` continua necessário (ver `seguranca.md`).

## Folha dos blocos (`BASE_CSS`)
Escrita só com variáveis (conferido: nenhuma cor literal, e todo `var(--x)` que ela lê é declarado por todos os temas). Prende-se às tags e atributos semânticos que os blocos emitem dentro de `#polaris` (`button`, `input[type=…]`, `table`, `span[data-tom]`, `div[role=alert]`…), então um bloco novo não precisa de classe.

## Acessibilidade
`auditaTema(no)` confere em cada modo os pares críticos (AA: 4,5 para texto, 3 para UI): texto/fundo, texto/superfície, texto suave, texto sobre primária (também no hover), link primário/superfície, selos de sucesso/alerta/erro. O tema `padrao` passa nos dois modos (teste). **Achado nos presets do Tiffany**: `nco-red` tem link primário sobre superfície escura com contraste 3,06 (mínimo 4,5); fica registrado em teste, e quem usar esse preset deve ajustar `primaria` ou usar `primariaClara` para texto.

## Tokens opcionais de tipografia e de layout
Além de `cor`, `raio`, `espacamento` e `tipografia.familia`/`tamanhoBase`, um tema pode declarar `tipografia.familiaTitulo`, `pesoTitulo`, `tamanhoH1`, `tamanhoH2` e `tamanhoH3` (os títulos usam a fonte do corpo e os tamanhos 2, 1,5 e 1,17 em quando faltam) e o grupo `layout` com `largura`, `larguraEstreita` e `larguraLarga` (o bloco `layout/contido`; recuo no CSS base: 72, 48 e 90 rem). Exemplo completo: `exemplos/maison` (`gera.mjs`).
