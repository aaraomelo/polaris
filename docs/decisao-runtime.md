# Decisão: interpretador × AOT como padrão (e o lugar do React)

**Decisão.** O padrão de produção é **AOT por página, com o runtime vivo (sem React)**. O interpretador (o `Programa` JSON executado em runtime) continua como modo de desenvolvimento, preview e programas que mudam em tempo de execução. **React fica só como oráculo de testes** e como último recurso do build.

**Por que não são opostos.** O vivo já é o interpretador do `Programa`; o AOT só o especializa por página (tree-shaking das funções, blocos e capacidades que a página usa), então os dois executam o mesmo `Programa` e o mesmo modelo. Trocar de um para o outro não muda o comportamento, só o tamanho do pacote.

**Dados (docs/desempenho.md, Chrome real):**
- JS enviado: 143,5 KB gz (React) × 10,6 KB (vivo por página); 16 KB para páginas com bloco de código.
- Com CPU 4×/6× e 4G lenta: 1º clique que funciona em 578/703 ms (vivo) × 1411/1561 ms (React); INP pior caso ≤ 48 ms nas interações pequenas × até 120 ms.
- Empate (limitado por estilo/layout do navegador): filtro e inversão da lista inteira.

**Como o build escolhe** (`aot/construir.ts`, por capacidade, do mais barato ao mais caro): `estatico` (HTML sem JS) → `vivo` → `react` (só se a página usa algo que o vivo ainda não suporta; sempre acompanhado do motivo no manifesto). Páginas com bloco de código agora são `vivo`.

**Paridade (o que garante trocar sem medo):** teste diferencial contra o React (DOM final idêntico) para eventos, listas (fuzz), hidratação, streaming, blocos de código, campo de texto (IME/foco/cursor); mutações manuais; orçamentos de bundle.

**Quando usar o interpretador em produção:** o `Programa` é carregado dinamicamente (preview de editor, tenant com página alterada sem rebuild). Custo: o pacote leva a biblioteca inteira (~22 KB gz) em vez do subconjunto.

**O que falta para aposentar o React do caminho padrão:** nada de comportamento; resta o modo `react` do build e o SSR por `renderPaginaHtml` (usado como oráculo). Reavaliar remover o modo `react` quando nenhuma página real do manifesto cair nele.

**Limites da evidência:** headless, CPU emulada; falta medir em aparelho físico.
