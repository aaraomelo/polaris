# Linguagem de expressões e templates

Decisão (card E11): linguagem **própria**, da família do CEL, em `packages/engine/src/expr`. Motivo: o CEL é tipado estrito (`preco * 2` falha, inteiros viram `bigint`)
e erra em chave ausente, o que quebra a renderização de páginas escritas em JSON por não-programadores. A interface é pequena (`parseExpr`, `avalia`, `validaExpr`),
então trocar por CEL depois é localizado.

## Onde se usa
| Lugar | Forma |
|---|---|
| `se`, `repetir.cada` | **expressão pura**: `produtos.length > 0` |
| props de instância, `titulo` da página, `rodape` de documento | **template** de texto com bindings `{expressão \| formatador}` |

Template: `Olá {cliente.nome | maiusculas}!`. Se o texto é **só** um binding (`"{produto.preco}"`) o valor mantém o tipo (número, booleano, lista); se mistura texto, é sempre texto.
Chaves literais: `\{` e `\}`.

## Linguagem
Literais `1`, `2.5`, `'x'`, `"x"`, `true`, `false`, `null`, listas `[1, a]`. Acesso `a.b`, `a['b']`, `a[0]`, `.length` (texto e lista).
Operadores por precedência (menor → maior): `|` (formatador) · `? :` · `??` · `||` · `&&` · `== !=` · `< <= > >=` · `+ -` · `* / %` · `! -` unários.

- **Ausente nunca é erro**: `produto.imagem.url` sem `imagem` dá `undefined` e renderiza vazio. Aritmética inválida (`"a" - 1`, `x / 0`) também dá `undefined`, nunca `NaN`.
- `&&` e `||` devolvem o operando (`nome || 'sem nome'`); `??` só troca `null`/`undefined`.
- Verdade: falsos são `false`, `null`, `0`, `""`, `NaN` e lista vazia.
- `==` compara primitivos do mesmo tipo (`3 == '3'` é falso); `null == ausente` é verdadeiro; objetos e listas nunca são iguais.
- `+` soma números; com texto concatena (ausente vira vazio).
- Pipe: `x | f(a)` é `f(x, a)`; tem a menor precedência e formata o resultado inteiro.

## Funções (todas puras e totais)
`tamanho maiusculas minusculas aparar contem comeca termina junta texto numero arredonda piso teto absoluto minimo maximo padrao` e formatadores
`brl pct data dataHora` (pt-BR, fuso fixo America/Sao_Paulo: saída idêntica no SSR e no cliente).

## Garantias
Sem `eval`/`Function`; só lê campos **próprios** do escopo e nunca `__proto__`, `constructor` ou `prototype` (inclusive chaves perigosas vindas de `JSON.parse`).
Sem laços nem recursão: sempre termina. Limites: 2000 caracteres, 500 nós, 32 níveis de aninhamento. Erros de sintaxe trazem a posição e dica.

## Escopo (checado na compilação)
- **Página**: `params`, `consulta`, `tenant` + um nome por entrada de `spec.dados`.
- **`repetir`**: dentro do elemento, `{como}` e `indice`. `se` e `cada` enxergam só o escopo de fora (o `se` guarda o elemento inteiro, antes do laço). Sobrescrever um nome existente é erro.
- **Bloco (modelo)**: só `props` e `tenant` (encapsulamento). `core/slot` com `props.nome` projeta os filhos que a instância recebeu naquele slot.

## AST canônico e referência gerada
A forma de referência da linguagem é o AST em JSON (oito formas: `lit`, `var`, `campo`, `indice`, `lista`, `se`, `chama`, `fn`);
o texto é açúcar e `formata` o reconstrói de forma canônica. Onde o schema pede uma expressão (`se`, `repetir.cada`,
`repetir.chave`, `definir.valor`) vale texto OU AST; em props, `{ "$expr": <AST> }` avalia no lugar. Os erros do AST
apontam o caminho JSON dentro do próprio nó. A referência completa (formas, operadores, funções, exemplos executáveis e
leis testadas) é gerada por `pnpm docs:funcoes` em [funcoes.md](funcoes.md).
