# Biblioteca base de blocos

26 blocos nativos (mais o `core/slot`). Cada um tem **schema** (`BLOCOS_BASE`, em `render/base.tsx`), **componente React** (oráculo) e **descritor DOM** (`vivo/blocos.ts`, usado pelo servidor e pelo cliente do runtime vivo; o emissor estático deriva dele). `test/blocos-base.test.tsx` confere, por bloco: React × HTML estático × HTML do vivo × montagem no cliente × hidratação (mesmos nós), e as props dinâmicas.

| Grupo | Bloco | Props | Slots | Eventos |
|---|---|---|---|---|
| layout | `layout/pilha`, `layout/linha` | `gap`, `alinha` | `filhos` | |
| layout | `layout/grade` | `colunas` (1–12, padrão 2), `gap` | `filhos` | |
| layout | `layout/divisor` | | | |
| layout | `layout/espacador` | `tamanho` (px, padrão 8) | | |
| texto | `texto/titulo` | `texto`, `nivel` (1–6) | | |
| texto | `texto/paragrafo`, `texto/destaque`, `texto/pequeno`, `texto/codigo` | `texto` | | |
| texto | `texto/rotulo` | `texto`, `para` (id do campo) | | |
| mídia | `midia/imagem` | `src` (só URLs seguras), `alt`, `largura`, `altura` | | |
| lista | `lista/lista` | `ordenada` | `filhos` (só `lista/item`) | |
| lista | `lista/item` | | `filhos` | |
| tabela | `tabela/tabela` | | `filhos` (`cabecalho`, `corpo`) | |
| tabela | `tabela/cabecalho`, `tabela/corpo` | | `filhos` (só `tabela/linha`) | |
| tabela | `tabela/linha` | | `filhos` (só `tabela/celula`) | |
| tabela | `tabela/celula` | `texto` ou filhos, `cabecalho` (th), `colunas`, `linhas` | `filhos` | |
| entrada | `entrada/texto` | `valor`, `placeholder`, `desabilitado` | | `aoMudar` (texto) |
| entrada | `entrada/numero` | `valor`, `min`, `max`, `passo`, `placeholder`, `desabilitado` | | `aoMudar` (número ou `null` se vazio) |
| entrada | `entrada/caixa` | `marcado`, `desabilitado` | | `aoMudar` (booleano) |
| nav | `nav/botao` | `texto`, `desabilitado` | | `aoClicar` |
| nav | `nav/link` | `href` (só URLs seguras), `texto` | `filhos` | |
| feedback | `feedback/selo` | `texto`, `tom` | | |
| feedback | `feedback/alerta` | `tom` | `filhos` | |

`tom` ∈ `neutro | sucesso | alerta | erro`, emitido como `data-tom` (o estilo vem do tema, card de tokens). Por ser enum, `tom` é estático (não aceita binding).

**Tabela** exige `cabecalho`/`corpo` explícitos: o parser HTML insere `<tbody>` sozinho, e o DOM do servidor teria de divergir do DOM construído no cliente.
**`select`/`textarea`** ficam para depois: o conteúdo de `textarea` e o `value` de `select` dependem de filhos criados antes, e a adoção na hidratação precisa de tratamento próprio.
**Acessibilidade**: `espacador` tem `aria-hidden`, `alerta` tem `role="alert"`, `rotulo` liga ao campo por `for`.
**Como acrescentar um bloco**: schema em `BLOCOS_BASE` + componente em `COMPONENTES_BASE` + descritor `d_<interface>` em `DESCRITORES_BASE`; o teste de coerência recusa as três tabelas fora de sincronia.

## Catálogo (docs vivas)
`pnpm catalogo --saida docs/catalogo` gera, do registry, o catálogo em HTML (claro e escuro), Markdown e o CSS do tema: `docs/catalogo/index.html`, `escuro.html`, `catalogo.md`. Nada é escrito à mão:
- **props, slots e eventos** vêm do bloco resolvido (com `extends` e override do tenant), com tipo, limites, padrão e obrigatoriedade;
- **título, descrição e exemplos** moram no nó do bloco (`spec.titulo`, `spec.descricao`, `spec.exemplos[{titulo, instancia}]`; campos opcionais do kind `bloco`). O schema confere os exemplos contra os slots;
- **cada exemplo é renderizado pelo runtime real** (o mesmo HTML do vivo), e um exemplo inválido aparece como erro no catálogo e no código de saída do comando, sem derrubar o resto;
- inclui a seção do tema com as amostras de cor e a auditoria de contraste.
Para documentar um bloco novo (ou de um tenant), basta pôr `titulo`, `descricao` e `exemplos` no nó; `--nos <dir>` inclui nós extras e `--tema <id>` escolhe o tema do preview.
