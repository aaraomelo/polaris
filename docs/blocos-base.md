# Biblioteca base de blocos

27 blocos nativos. Cada um tem **schema** (`BLOCOS_BASE`, em `render/base.tsx`), **componente React** (oráculo) e **descritor DOM** (`vivo/blocos.ts`, usado pelo servidor e pelo cliente do runtime vivo; o emissor estático deriva dele). `test/blocos-base.test.tsx` confere, por bloco: React × HTML estático × HTML do vivo × montagem no cliente × hidratação (mesmos nós), e as props dinâmicas.

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
