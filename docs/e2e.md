# E2E a partir dos schemas

`packages/e2e` (Playwright-core + o Chrome do sistema; **sem baixar navegador**). Os cenários **nascem dos schemas**: cada exemplo declarado num bloco (`spec.exemplos`) vira uma **página**, construída pelo **mesmo AOT da produção** e servida com **CSP estrita**. Bloco novo com exemplo = cenário novo, sem escrever teste (hoje: **44 cenários, 33 blocos**: 33 estáticos e 11 interativos).

## O que cada cenário exige (`verificaCenario`)
1. **O servidor entrega a página** (HTTP 200) mesmo **sem JavaScript**; esse HTML é guardado.
2. **Navegador limpo**: nenhum `console.error/warning`, exceção, requisição que falhou, resposta ≥ 400 nem **violação de CSP**. CSP do teste: `default-src 'none'; script-src 'self' 'sha256-<init>'; style-src 'self'; style-src-attr 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'` — **sem `<style>` nem script/handler inline** (só o script de inicialização, por hash).
3. **Conteúdo**: `<title>`, contêiner não vazio, algo visível.
4. **Acessibilidade** calculada na própria página: botão/link/campo **com nome acessível**, imagem com `alt`, ids únicos, no máximo um `h1` e **sem pular nível de título**, `html[lang]`, nada fora da ordem de foco.
5. **Hidratação**: a página que o JavaScript montou é **idêntica** ao HTML do servidor (divergência = bug); a **estática não muda** sozinha; a **interativa** é clicada (botões) e digitada (campos) sem quebrar, e o campo guarda o que foi digitado.
6. **Celular (360 px)**: sem rolagem horizontal. **Modo escuro** (`prefers-color-scheme`): a página recarrega e continua com conteúdo.

## Os detectores também são testados
Um E2E que nunca falha não prova nada: `detectores.test.ts` põe cada verificação diante de páginas **deliberadamente quebradas** (botão/link vazio, campo e checkbox sem rótulo, imagem sem `alt`, id duplicado, dois `h1`, título pulando nível, `tabindex` negativo, sem `lang`, overflow, página vazia) e do cenário completo com o **HTML do servidor adulterado**: divergência de hidratação, **script inline bloqueado pela CSP**, `onclick` inline bloqueado, recurso 404, imagem sem `alt`. A mesma página, sem adulteração, passa.

## Defeitos que o E2E achou no produto (corrigidos)
1. **Campos sem nome acessível**: `entrada/texto`, `entrada/numero` e `entrada/caixa` não tinham como receber um nome (só por `texto/rotulo` ligado por `id`). Ganharam a prop **`rotulo` → `aria-label`** (nos 3 renderizadores: vivo, React e o schema), e os exemplos do catálogo passaram a usá-la.
2. **`vitrine` estourava a tela no celular** (491 px em 360 px): a imagem do cartão tem `width` fixo e a coluna é estreita. `midia/imagem` agora leva `max-width:100%;height:auto` (mantém `width`/`height` para reservar espaço): nos três renderizadores (estático, vivo, React).
3. **Todo documento pedia o favicon** e levava 404 no console: o servidor passa a responder `204` (não é do HTML).
Os blocos emitem **`style=""` inline**: a CSP precisa de `style-src-attr 'unsafe-inline'` (ou os estilos viram classes). É decisão registrada, não esquecida.

## Rodar
`pnpm --filter @polaris/e2e test` (precisa de `google-chrome`/`chromium`; sem ele os testes são **pulados**). No CI roda dentro de `pnpm test` (os runners do GitHub já têm Chrome). Escolher outro binário: `CHROME=/caminho/chrome`.

## Limites
- **Só os exemplos dos blocos**: páginas inteiras de tenants (dados, rotas, sessões) e os **fluxos de negócio** (carrinho → checkout → pagamento) **não** têm E2E de navegador (estão nos testes de integração de API).
- A acessibilidade é um **lint próprio** (nome, alt, ids, títulos, foco), **não** o axe-core completo: **contraste de cor** e leitor de tela não são verificados aqui (o contraste dos temas tem auditoria própria no engine).
- **Só Chrome** (Chromium); Firefox e WebKit não.
- O modo escuro só confere que a página **funciona**; não compara pixel a pixel (sem captura de regressão visual).
- A interação é **genérica** (clicar e digitar): ela não sabe o que "deveria" acontecer; só pega exceções e quebras. A semântica de cada evento está nos testes do engine.
