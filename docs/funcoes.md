# Linguagem de expressões do Polaris — referência

> Gerado por `pnpm docs:funcoes` a partir de `packages/engine/src/expr/registro.ts`. **Não edite à mão.**
> Todo exemplo abaixo é executado nos testes; toda lei é verificada com entradas aleatórias.

A linguagem é **pura** (sem efeitos), **total** (sempre termina, sem recursão nem laços) e **tolerante a ausente**
(valor ausente propaga como ausente; nunca lança erro). Sem `eval`: o texto vira o AST abaixo, e é o AST que se executa.

## Forma canônica (AST em JSON)

O texto (`a + b | brl`) é açúcar. A forma de referência é JSON, com sete formas de nó, todas objetos:

```jsonc
{ "lit": null | true | 1.5 | "texto" }        // número finito e NÃO negativo; negativo é neg
{ "var": "nome" }
{ "campo": "nome", "de": <nó> }               // de.nome
{ "indice": <nó>, "de": <nó> }                // de[indice]
{ "lista": [<nó>, …] }
{ "se": <nó>, "entao": <nó>, "senao": <nó> }  // c ? a : b
{ "chama": "nome", "args": [<nó>, …] }        // função ou operador (+, &&, !, neg, brl, …)
```

Exemplo: `preco * (1 - desconto) | brl`

```json
{"chama":"brl","args":[{"chama":"*","args":[{"var":"preco"},{"chama":"-","args":[{"lit":1},{"var":"desconto"}]}]}]}
```

O texto canônico (`formata`) não usa `|` e só põe parênteses onde a precedência exige; `parse(formata(e))` devolve a mesma árvore.

## Precedência

| Precedência | Operadores | Associa |
|---|---|---|
| 0 (menor) | `c ? a : b` | à direita |
| 1 | `??` | à esquerda |
| 2 | `\|\|` | à esquerda |
| 3 | `&&` | à esquerda |
| 4 | `==` `!=` | à esquerda |
| 5 | `<` `<=` `>` `>=` | à esquerda |
| 6 | `+` `-` | à esquerda |
| 7 | `*` `/` `%` | à esquerda |
| 8 | `!` `-` (prefixos) | — |
| 9 (maior) | `.campo` `[índice]` `f(args)` | à esquerda |

`x | f(a)` é o mesmo que `f(x, a)` (o valor entra como primeiro argumento).

## Formas

### `lit`

`{ lit: null | booleano | número | texto }`

Literal. Número é finito e não negativo (o negativo é `neg`); listas e objetos se constroem com `lista`.

| Expressão | Escopo | Resultado |
|---|---|---|
| `42` |  | `42` |
| `"oi"` |  | `"oi"` |
| `null` |  | `null` |
| `1e3` |  | `1000` |

### `var`

`{ var: nome }`

Lê uma variável do escopo. Nome ausente (ou `__proto__`, `constructor`, `prototype`) dá ausente, nunca erro.

| Expressão | Escopo | Resultado |
|---|---|---|
| `x` | `{"x":7}` | `7` |
| `y` | `{"x":7}` | _(ausente)_ |
| `__proto__` |  | _(ausente)_ |

### `campo`

`{ campo: nome, de: nó }  ≡  de.nome`

Campo de um objeto (só próprios). Em texto e lista só `length` existe. Tudo o mais é ausente; ausente propaga.

| Expressão | Escopo | Resultado |
|---|---|---|
| `a.b` | `{"a":{"b":1}}` | `1` |
| `a.nada.x` | `{"a":{}}` | _(ausente)_ |
| `l.length` | `{"l":[1,2,3]}` | `3` |
| `o.toString` | `{"o":{}}` | _(ausente)_ |

### `indice`

`{ indice: nó, de: nó }  ≡  de[indice]`

Posição de lista/texto (inteiro ≥ 0) ou chave de objeto (texto). Fora do alcance é ausente.

| Expressão | Escopo | Resultado |
|---|---|---|
| `l[1]` | `{"l":[10,20]}` | `20` |
| `l[9]` | `{"l":[10,20]}` | _(ausente)_ |
| `l[-1]` | `{"l":[10,20]}` | _(ausente)_ |
| `o["a-b"]` | `{"o":{"a-b":5}}` | `5` |

### `lista`

`{ lista: [nó…] }  ≡  [a, b, …]`

Constrói uma lista avaliando cada item.

| Expressão | Escopo | Resultado |
|---|---|---|
| `[1, x, "a"]` | `{"x":2}` | `[1,2,"a"]` |
| `[]` |  | `[]` |

### `se`

`{ se: nó, entao: nó, senao: nó }  ≡  c ? a : b`

Condicional. Só o ramo escolhido é avaliado. Veracidade: são falsos `null`, ausente, `false`, `0`, `NaN`, `""` e lista vazia; o resto é verdadeiro (inclusive objeto vazio).

| Expressão | Escopo | Resultado |
|---|---|---|
| `x ? "sim" : "não"` | `{"x":1}` | `"sim"` |
| `x ? "sim" : "não"` | `{"x":""}` | `"não"` |
| `x ? "sim" : "não"` | `{"x":[]}` | `"não"` |
| `x ? "sim" : "não"` | `{"x":{}}` | `"sim"` |

**Leis** (testadas com entradas aleatórias):
- `(c ? a : b) == (!c ? b : a)`

## Operadores

### `+`

`a + b`

Soma de números; se um dos lados é texto, concatena (ausente/objeto/lista viram vazio); nos demais casos, ausente.

| Expressão | Escopo | Resultado |
|---|---|---|
| `1 + 2` |  | `3` |
| `"a" + 1` |  | `"a1"` |
| `"a" + x` |  | `"a"` |
| `1 + x` | `{"x":null}` | _(ausente)_ |

**Leis** (testadas com entradas aleatórias):
- `(a + b) == (b + a)`
- `(a + 0) == a`
- `((a + b) + c) == (a + (b + c))`

**Não vale:**
- A soma de números NÃO é associativa em ponto flutuante: (0,1 + 0,2) + 0,3 ≠ 0,1 + (0,2 + 0,3). Dinheiro deve usar decimal exato (card da torre numérica).

### `-`

`a - b`

Subtração; só números (senão, ausente).

| Expressão | Escopo | Resultado |
|---|---|---|
| `5 - 3` |  | `2` |
| `"5" - 3` |  | _(ausente)_ |

**Leis** (testadas com entradas aleatórias):
- `(a - a) == 0`

### `*`

`a * b`

Produto; só números. Resultado não finito é ausente.

| Expressão | Escopo | Resultado |
|---|---|---|
| `3 * 4` |  | `12` |
| `1e308 * 10` |  | _(ausente)_ |

**Leis** (testadas com entradas aleatórias):
- `(a * b) == (b * a)`
- `(a * 1) == a`

### `/`

`a / b`

Divisão; só números. Divisão por zero é ausente (nunca Infinity).

| Expressão | Escopo | Resultado |
|---|---|---|
| `7 / 2` |  | `3.5` |
| `1 / 0` |  | _(ausente)_ |

### `%`

`a % b`

Resto da divisão (sinal do dividendo); só números. Módulo por zero é ausente.

| Expressão | Escopo | Resultado |
|---|---|---|
| `7 % 3` |  | `1` |
| `-7 % 3` |  | `-1` |
| `1 % 0` |  | _(ausente)_ |

### `==`

`a == b`

Igualdade sem coerção: `null` e ausente são iguais entre si; tipos diferentes são diferentes; listas e objetos nunca são iguais (nem a si mesmos).

| Expressão | Escopo | Resultado |
|---|---|---|
| `1 == 1` |  | `true` |
| `1 == "1"` |  | `false` |
| `x == null` |  | `true` |
| `[1] == [1]` |  | `false` |

**Leis** (testadas com entradas aleatórias):
- `(a == b) == (b == a)`
- `a == a`

### `!=`

`a != b`

Negação de `==`.

| Expressão | Escopo | Resultado |
|---|---|---|
| `1 != 2` |  | `true` |

**Leis** (testadas com entradas aleatórias):
- `(a != b) == !(a == b)`

### `<`

`a < b`

Comparação de número com número ou de texto com texto (ordem de código); qualquer outra combinação é falsa.

| Expressão | Escopo | Resultado |
|---|---|---|
| `1 < 2` |  | `true` |
| `"a" < "b"` |  | `true` |
| `1 < "b"` |  | `false` |

### `<=`

`a <= b`

Como `<`, com igualdade.

| Expressão | Escopo | Resultado |
|---|---|---|
| `2 <= 2` |  | `true` |

### `>`

`a > b`

Como `<`, invertido.

| Expressão | Escopo | Resultado |
|---|---|---|
| `3 > 2` |  | `true` |

### `>=`

`a >= b`

Como `<=`, invertido.

| Expressão | Escopo | Resultado |
|---|---|---|
| `2 >= 3` |  | `false` |

### `&&`

`a && b`

Curto-circuito: se `a` é falso devolve `a`, senão `b` (devolve o VALOR, não um booleano).

| Expressão | Escopo | Resultado |
|---|---|---|
| `a && b` | `{"a":0,"b":5}` | `0` |
| `a && b` | `{"a":1,"b":5}` | `5` |

**Leis** (testadas com entradas aleatórias):
- `((a && b) && c) == (a && (b && c))`
- `!(a && b) == (!a || !b)`

### `||`

`a || b`

Curto-circuito: se `a` é verdadeiro devolve `a`, senão `b`.

| Expressão | Escopo | Resultado |
|---|---|---|
| `a \|\| "x"` | `{"a":""}` | `"x"` |
| `a \|\| "x"` | `{"a":"y"}` | `"y"` |

**Leis** (testadas com entradas aleatórias):
- `((a || b) || c) == (a || (b || c))`
- `!(a || b) == (!a && !b)`

### `??`

`a ?? b`

Valor padrão só para `null`/ausente: `0`, `""` e `false` são mantidos.

| Expressão | Escopo | Resultado |
|---|---|---|
| `a ?? "x"` | `{"a":null}` | `"x"` |
| `a ?? "x"` | `{"a":0}` | `0` |
| `a ?? "x"` |  | `"x"` |

**Leis** (testadas com entradas aleatórias):
- `((a ?? b) ?? c) == (a ?? (b ?? c))`

### `!`

`!a`

Negação da veracidade (sempre booleano).

| Expressão | Escopo | Resultado |
|---|---|---|
| `!x` | `{"x":[]}` | `true` |
| `!x` | `{"x":1}` | `false` |

**Leis** (testadas com entradas aleatórias):
- `!!a == !!!!a`

### `neg`

`-a  ≡  { chama: "neg", args: [a] }`

Negativo de um número; outro tipo é ausente.

| Expressão | Escopo | Resultado |
|---|---|---|
| `-x` | `{"x":5}` | `-5` |
| `-x` | `{"x":"5"}` | _(ausente)_ |

**Leis** (testadas com entradas aleatórias):
- `-(-a) == a`

## Funções

### `tamanho`

`tamanho(x) → número`

Comprimento de texto ou lista; número de chaves de objeto; 0 para o resto.

| Expressão | Escopo | Resultado |
|---|---|---|
| `tamanho("abc")` |  | `3` |
| `tamanho([1, 2])` |  | `2` |
| `tamanho(o)` | `{"o":{"a":1,"b":2}}` | `2` |
| `tamanho(null)` |  | `0` |

**Leis** (testadas com entradas aleatórias):
- `tamanho(a + b) == tamanho(a) + tamanho(b)`

### `maiusculas`

`maiusculas(x) → texto`

Texto em maiúsculas (ausente vira vazio).

| Expressão | Escopo | Resultado |
|---|---|---|
| `maiusculas("olá")` |  | `"OLÁ"` |
| `maiusculas(x)` |  | `""` |

**Leis** (testadas com entradas aleatórias):
- `maiusculas(maiusculas(a)) == maiusculas(a)`

### `minusculas`

`minusculas(x) → texto`

Texto em minúsculas.

| Expressão | Escopo | Resultado |
|---|---|---|
| `minusculas("ÀB")` |  | `"àb"` |

**Leis** (testadas com entradas aleatórias):
- `minusculas(minusculas(a)) == minusculas(a)`

### `aparar`

`aparar(x) → texto`

Remove espaços das pontas.

| Expressão | Escopo | Resultado |
|---|---|---|
| `aparar("  x y  ")` |  | `"x y"` |

**Leis** (testadas com entradas aleatórias):
- `aparar(aparar(a)) == aparar(a)`
- `tamanho(aparar(a)) <= tamanho(a)`

### `contem`

`contem(texto|lista, x) → booleano`

Texto contém o trecho; lista contém o elemento (igualdade estrita). Outros tipos: falso.

| Expressão | Escopo | Resultado |
|---|---|---|
| `contem("banana", "nan")` |  | `true` |
| `contem([1, 2, 3], 2)` |  | `true` |
| `contem(5, 1)` |  | `false` |

**Leis** (testadas com entradas aleatórias):
- `contem(a, "")`
- `contem(a + b, b)`

### `comeca`

`comeca(texto, prefixo) → booleano`

Começa com o prefixo.

| Expressão | Escopo | Resultado |
|---|---|---|
| `comeca("banana", "ba")` |  | `true` |

**Leis** (testadas com entradas aleatórias):
- `comeca(a + b, a)`

### `termina`

`termina(texto, sufixo) → booleano`

Termina com o sufixo.

| Expressão | Escopo | Resultado |
|---|---|---|
| `termina("banana", "na")` |  | `true` |

**Leis** (testadas com entradas aleatórias):
- `termina(a + b, b)`

### `junta`

`junta(lista, separador = ", ") → texto`

Une os itens (como texto) com o separador. Não-lista dá vazio.

| Expressão | Escopo | Resultado |
|---|---|---|
| `junta(["a", "b"])` |  | `"a, b"` |
| `junta(["a", "b"], "-")` |  | `"a-b"` |
| `junta(5)` |  | `""` |

### `texto`

`texto(x) → texto`

Converte em texto; ausente, lista e objeto viram vazio (nunca "[object Object]").

| Expressão | Escopo | Resultado |
|---|---|---|
| `texto(12)` |  | `"12"` |
| `texto(null)` |  | `""` |
| `texto([1])` |  | `""` |
| `texto(true)` |  | `"true"` |

**Leis** (testadas com entradas aleatórias):
- `texto(texto(a)) == texto(a)`

### `numero`

`numero(x, casas = 0) → texto`

Formata em pt-BR (milhar com ponto, decimal com vírgula), com até `casas` decimais (0 a 10). Não numérico dá vazio.

| Expressão | Escopo | Resultado |
|---|---|---|
| `numero(1234.567)` |  | `"1.235"` |
| `numero(1234.5, 1)` |  | `"1.234,5"` |
| `numero("x")` |  | `""` |

### `arredonda`

`arredonda(x, casas = 0) → número`

Arredonda para `casas` decimais (0 a 10); aceita número em texto. Não numérico é ausente.

| Expressão | Escopo | Resultado |
|---|---|---|
| `arredonda(2.456, 2)` |  | `2.46` |
| `arredonda("3.7")` |  | `4` |
| `arredonda("x")` |  | _(ausente)_ |

**Leis** (testadas com entradas aleatórias):
- `arredonda(arredonda(a, 2), 2) == arredonda(a, 2)`

### `piso`

`piso(x) → número`

Maior inteiro ≤ x.

| Expressão | Escopo | Resultado |
|---|---|---|
| `piso(-1.5)` |  | `-2` |
| `piso(2.9)` |  | `2` |

**Leis** (testadas com entradas aleatórias):
- `piso(a) <= a`
- `piso(piso(a)) == piso(a)`

### `teto`

`teto(x) → número`

Menor inteiro ≥ x.

| Expressão | Escopo | Resultado |
|---|---|---|
| `teto(1.2)` |  | `2` |

**Leis** (testadas com entradas aleatórias):
- `a <= teto(a)`
- `teto(a) - piso(a) <= 1`

### `absoluto`

`absoluto(x) → número`

Valor absoluto.

| Expressão | Escopo | Resultado |
|---|---|---|
| `absoluto(-3)` |  | `3` |

**Leis** (testadas com entradas aleatórias):
- `absoluto(a) >= 0`
- `absoluto(absoluto(a)) == absoluto(a)`

### `minimo`

`minimo(x, …) → número`

Menor de 1 a 16 números; se algum não é numérico, ausente.

| Expressão | Escopo | Resultado |
|---|---|---|
| `minimo(3, 1, 2)` |  | `1` |
| `minimo(1, "x")` |  | _(ausente)_ |

**Leis** (testadas com entradas aleatórias):
- `minimo(a, b) == minimo(b, a)`
- `minimo(minimo(a, b), c) == minimo(a, minimo(b, c))`
- `minimo(a, a) == a`
- `minimo(a, b) <= maximo(a, b)`

### `maximo`

`maximo(x, …) → número`

Maior de 1 a 16 números.

| Expressão | Escopo | Resultado |
|---|---|---|
| `maximo(3, 1, 2)` |  | `3` |

**Leis** (testadas com entradas aleatórias):
- `maximo(a, b) == maximo(b, a)`
- `maximo(maximo(a, b), c) == maximo(a, maximo(b, c))`

### `padrao`

`padrao(x, d) → qualquer`

Troca por `d` apenas `null`, ausente e `""` (diferente de `??`, que mantém o `""`); `0` e `false` ficam.

| Expressão | Escopo | Resultado |
|---|---|---|
| `padrao(null, "x")` |  | `"x"` |
| `padrao("", "x")` |  | `"x"` |
| `padrao(0, 5)` |  | `0` |

**Leis** (testadas com entradas aleatórias):
- `padrao(padrao(a, b), c) == padrao(a, padrao(b, c))`

### `brl`

`brl(x) → texto`

Moeda em reais (pt-BR), sempre 2 casas. Só para EXIBIR: o cálculo de dinheiro não usa ponto flutuante.

| Expressão | Escopo | Resultado |
|---|---|---|
| `brl(1234.5)` |  | `"R$ 1.234,50"` |
| `brl("x")` |  | `""` |

### `pct`

`pct(x, casas = 0) → texto`

Fração como porcentagem (0,256 → 25,6%).

| Expressão | Escopo | Resultado |
|---|---|---|
| `pct(0.256, 1)` |  | `"25,6%"` |
| `pct(0.5)` |  | `"50%"` |

### `data`

`data(x) → texto`

Data em dd/mm/aaaa. "AAAA-MM-DD" puro não escorrega de dia; instantes usam o fuso de São Paulo.

| Expressão | Escopo | Resultado |
|---|---|---|
| `data("2026-06-08")` |  | `"08/06/2026"` |
| `data("lixo")` |  | `""` |

### `dataHora`

`dataHora(x) → texto`

Data e hora curtas no fuso de São Paulo (idêntico no servidor e no cliente).

| Expressão | Escopo | Resultado |
|---|---|---|
| `dataHora("2026-06-08T15:30:00Z")` |  | `"08/06/2026, 12:30"` |
