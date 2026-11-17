# Linguagem de expressões do Polaris — referência

> Gerado por `pnpm docs:funcoes` a partir de `packages/engine/src/expr/registro.ts`. **Não edite à mão.**
> Todo exemplo abaixo é executado nos testes; toda lei é verificada com entradas aleatórias.

A linguagem é **pura** (sem efeitos), **total** (sempre termina: não há recursão nem laço aberto; a única iteração são os
combinadores sobre listas que já existem, sob um orçamento de passos) e **tolerante a ausente**
(valor ausente propaga como ausente; nunca lança erro). Sem `eval`: o texto vira o AST abaixo, e é o AST que se executa.

## Forma canônica (AST em JSON)

O texto (`a + b | brl`) é açúcar. A forma de referência é JSON, com oito formas de nó, todas objetos:

```jsonc
{ "lit": null | true | 1.5 | "texto" }        // número finito e NÃO negativo; negativo é neg
{ "var": "nome" }
{ "campo": "nome", "de": <nó> }               // de.nome
{ "indice": <nó>, "de": <nó> }                // de[indice]
{ "lista": [<nó>, …] }
{ "se": <nó>, "entao": <nó>, "senao": <nó> }  // c ? a : b
{ "chama": "nome", "args": [<nó>, …] }        // função ou operador (+, &&, !, neg, brl, …)
{ "fn": ["x"], "corpo": <nó> }                  // x => corpo: SÓ como argumento de mapeia, filtra, dobra…
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

### `fn`

`{ fn: [param…], corpo: nó }  ≡  x => corpo  |  (a, b) => corpo`

Função anônima de 1 a 3 parâmetros. SÓ pode ser o argumento de um combinador (mapeia, filtra, dobra, todos, algum, acha, ordena, agrupa); em qualquer outro lugar é erro de compilação. Enxerga as variáveis de fora e os próprios parâmetros. Não há recursão nem função como valor: a linguagem continua total.

| Expressão | Escopo | Resultado |
|---|---|---|
| `mapeia([1, 2, 3], x => x * 2)` |  | `[2,4,6]` |
| `mapeia(l, (x, i) => x + i)` | `{"l":[10,20]}` | `[10,21]` |
| `mapeia(l, x => x + k)` | `{"l":[1,2],"k":10}` | `[11,12]` |

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

### `mapeia`

`mapeia(lista, x => …) → lista   (a função pode receber também o índice: (x, i) => …)`

Aplica a função a cada item, na ordem. Funtor da lista: preserva o tamanho. Não-lista é ausente.

| Expressão | Escopo | Resultado |
|---|---|---|
| `mapeia([1, 2, 3], x => x * x)` |  | `[1,4,9]` |
| `mapeia(["a", "b"], (x, i) => x + i)` |  | `["a0","b1"]` |
| `mapeia(5, x => x)` |  | _(ausente)_ |

**Leis** (testadas com entradas aleatórias):
- `igual(mapeia(l, x => x), l)`
- `tamanho(mapeia(l, x => x * 2)) == tamanho(l)`
- `igual(mapeia(mapeia(l, x => x + 1), x => x * 2), mapeia(l, x => (x + 1) * 2))`
- `igual(mapeia(concat(a, b), x => x + 1), concat(mapeia(a, x => x + 1), mapeia(b, x => x + 1)))`

### `filtra`

`filtra(lista, x => condição) → lista`

Mantém os itens para os quais a função é verdadeira (mesma veracidade de `se`), na ordem original.

| Expressão | Escopo | Resultado |
|---|---|---|
| `filtra([1, 2, 3, 4], x => x % 2 == 0)` |  | `[2,4]` |
| `filtra(l, x => x.ok)` | `{"l":[{"ok":true,"n":1},{"ok":false,"n":2}]}` | `[{"ok":true,"n":1}]` |

**Leis** (testadas com entradas aleatórias):
- `igual(filtra(filtra(l, x => x > 0), x => x > 0), filtra(l, x => x > 0))`
- `tamanho(filtra(l, x => x > 0)) + tamanho(filtra(l, x => !(x > 0))) == tamanho(l)`
- `igual(filtra(concat(a, b), x => x > 1), concat(filtra(a, x => x > 1), filtra(b, x => x > 1)))`

### `dobra`

`dobra(lista, inicial, (acc, x) => …) → valor   (opcional: (acc, x, i))`

Dobra à esquerda: acc₀ = inicial; accₖ₊₁ = f(accₖ, itemₖ). É o catamorfismo da lista: toda função definida por indução na lista é uma dobra. Um laço limitado pelo tamanho da lista, nunca aberto.

| Expressão | Escopo | Resultado |
|---|---|---|
| `dobra([1, 2, 3], 0, (a, x) => a + x)` |  | `6` |
| `dobra(["a", "b"], "", (a, x) => a + x)` |  | `"ab"` |
| `dobra([], 7, (a, x) => a + x)` |  | `7` |

**Leis** (testadas com entradas aleatórias):
- `dobra(l, 0, (a, x) => a + 1) == tamanho(l)`
- `dobra(concat(a, b), 0, (s, x) => s + x) == dobra(b, dobra(a, 0, (s, x) => s + x), (s, x) => s + x)`
- `igual(dobra(l, [], (acc, x) => concat(acc, [x])), l)`
- `igual(dobra(l, [], (acc, x) => concat([x], acc)), inverte(l))`

### `todos`

`todos(lista, x => condição) → booleano`

Verdadeiro se a função é verdadeira para todos os itens (lista vazia: verdadeiro).

| Expressão | Escopo | Resultado |
|---|---|---|
| `todos([1, 2], x => x > 0)` |  | `true` |
| `todos([], x => false)` |  | `true` |

**Leis** (testadas com entradas aleatórias):
- `todos(l, x => x > 0) == !algum(l, x => !(x > 0))`
- `todos(concat(a, b), x => x > 0) == (todos(a, x => x > 0) && todos(b, x => x > 0))`

### `algum`

`algum(lista, x => condição) → booleano`

Verdadeiro se a função é verdadeira para algum item (lista vazia: falso).

| Expressão | Escopo | Resultado |
|---|---|---|
| `algum([1, 2], x => x > 1)` |  | `true` |
| `algum([], x => true)` |  | `false` |

### `acha`

`acha(lista, x => condição) → item`

Primeiro item para o qual a função é verdadeira; ausente se nenhum.

| Expressão | Escopo | Resultado |
|---|---|---|
| `acha([1, 5, 9], x => x > 3)` |  | `5` |
| `acha([1], x => x > 3)` |  | _(ausente)_ |

**Leis** (testadas com entradas aleatórias):
- `(acha(l, x => x > 0) == null) == !algum(l, x => x > 0)`

### `ordena`

`ordena(lista, x => chave) → lista`

Ordena pela chave, de forma ESTÁVEL. Ordem total e determinística das chaves: números < textos < booleanos < o resto (ausente por último); empates mantêm a ordem original.

| Expressão | Escopo | Resultado |
|---|---|---|
| `ordena([3, 1, 2], x => x)` |  | `[1,2,3]` |
| `ordena(["b", "a"], x => x)` |  | `["a","b"]` |
| `ordena(l, x => x.n)` | `{"l":[{"n":2,"k":"a"},{"n":1,"k":"b"},{"n":2,"k":"c"}]}` | `[{"n":1,"k":"b"},{"n":2,"k":"a"},{"n":2,"k":"c"}]` |
| `ordena([2, "a", 1, null], x => x)` |  | `[1,2,"a",null]` |

**Leis** (testadas com entradas aleatórias):
- `igual(ordena(ordena(l, x => x), x => x), ordena(l, x => x))`
- `tamanho(ordena(l, x => x)) == tamanho(l)`
- `igual(ordena(inverte(l), x => x), ordena(l, x => x))`
- `igual(ordena(l, x => x), inverte(ordena(l, x => -x)))`

### `agrupa`

`agrupa(lista, x => chave) → objeto`

Agrupa os itens por chave (a chave vira texto: número e booleano convertem; o resto vira ""). Cada grupo mantém a ordem original.

| Expressão | Escopo | Resultado |
|---|---|---|
| `agrupa([1, 2, 3, 4], x => x % 2)` |  | `{"0":[2,4],"1":[1,3]}` |
| `agrupa(["a", "bb", "c"], x => tamanho(x))` |  | `{"1":["a","c"],"2":["bb"]}` |

**Leis** (testadas com entradas aleatórias):
- `soma(mapeia(valores(agrupa(l, x => x % 2)), g => tamanho(g))) == tamanho(l)`

### `igual`

`igual(a, b) → booleano`

Igualdade ESTRUTURAL (listas e objetos comparam por conteúdo; a ordem das chaves não importa; `null` e ausente são iguais). Diferente de `==`, que nunca iguala listas e objetos.

| Expressão | Escopo | Resultado |
|---|---|---|
| `igual([1, [2]], [1, [2]])` |  | `true` |
| `igual(a, b)` | `{"a":{"x":1,"y":2},"b":{"y":2,"x":1}}` | `true` |
| `igual([1], [1, 2])` |  | `false` |
| `igual(null, x)` |  | `true` |

**Leis** (testadas com entradas aleatórias):
- `igual(a, a)`
- `igual(a, b) == igual(b, a)`

### `concat`

`concat(lista, …) → lista   (1 a 16 listas)`

Concatena listas. É a operação do monoide livre: associativa, com `[]` como unidade. Resultado acima de 100 000 itens é ausente.

| Expressão | Escopo | Resultado |
|---|---|---|
| `concat([1], [2, 3])` |  | `[1,2,3]` |
| `concat([1], 5)` |  | _(ausente)_ |
| `concat([], [])` |  | `[]` |

**Leis** (testadas com entradas aleatórias):
- `igual(concat(concat(a, b), c), concat(a, concat(b, c)))`
- `igual(concat(a, []), a) && igual(concat([], a), a)`
- `tamanho(concat(a, b)) == tamanho(a) + tamanho(b)`

### `achata`

`achata(lista) → lista`

Remove UM nível de aninhamento (itens que não são lista ficam como estão).

| Expressão | Escopo | Resultado |
|---|---|---|
| `achata([[1], [2, 3], 4])` |  | `[1,2,3,4]` |
| `achata([[[1]]])` |  | `[[1]]` |

**Leis** (testadas com entradas aleatórias):
- `igual(achata(mapeia(l, x => [x])), l)`
- `igual(achata(concat(a, b)), concat(achata(a), achata(b)))`

### `fatia`

`fatia(lista|texto, início, fim?) → lista|texto`

Trecho [início, fim); índices negativos contam do fim. Índice não inteiro é ausente.

| Expressão | Escopo | Resultado |
|---|---|---|
| `fatia([1, 2, 3, 4], 1, 3)` |  | `[2,3]` |
| `fatia("banana", -2)` |  | `"na"` |
| `fatia([1], 0.5)` |  | _(ausente)_ |

**Leis** (testadas com entradas aleatórias):
- `igual(concat(fatia(l, 0, k), fatia(l, k)), l)`

### `inverte`

`inverte(lista) → lista`

Lista na ordem contrária.

| Expressão | Escopo | Resultado |
|---|---|---|
| `inverte([1, 2, 3])` |  | `[3,2,1]` |

**Leis** (testadas com entradas aleatórias):
- `igual(inverte(inverte(l)), l)`
- `igual(inverte(concat(a, b)), concat(inverte(b), inverte(a)))`

### `primeiro`

`primeiro(lista) → item`

Primeiro item (ausente se vazia).

| Expressão | Escopo | Resultado |
|---|---|---|
| `primeiro([7, 8])` |  | `7` |
| `primeiro([])` |  | _(ausente)_ |

### `ultimo`

`ultimo(lista) → item`

Último item (ausente se vazia).

| Expressão | Escopo | Resultado |
|---|---|---|
| `ultimo([7, 8])` |  | `8` |

**Leis** (testadas com entradas aleatórias):
- `igual(primeiro(inverte(l)), ultimo(l))`

### `unicos`

`unicos(lista) → lista`

Remove repetidos (igualdade estrutural), mantendo a primeira ocorrência.

| Expressão | Escopo | Resultado |
|---|---|---|
| `unicos([1, 2, 1, 3, 2])` |  | `[1,2,3]` |
| `unicos([[1], [1], [2]])` |  | `[[1],[2]]` |

**Leis** (testadas com entradas aleatórias):
- `igual(unicos(unicos(l)), unicos(l))`
- `tamanho(unicos(l)) <= tamanho(l)`
- `todos(l, x => contem(unicos(l), x))`

### `intervalo`

`intervalo(fim) | intervalo(início, fim) → lista`

Inteiros de início (padrão 0) até fim, exclusive. Vazio se fim ≤ início; acima de 100 000 itens é ausente.

| Expressão | Escopo | Resultado |
|---|---|---|
| `intervalo(4)` |  | `[0,1,2,3]` |
| `intervalo(2, 5)` |  | `[2,3,4]` |
| `intervalo(-3)` |  | `[]` |
| `intervalo(0.5)` |  | _(ausente)_ |

**Leis** (testadas com entradas aleatórias):
- `tamanho(intervalo(n)) == maximo(n, 0)`

### `soma`

`soma(lista) → número`

Soma de uma lista de números (da esquerda para a direita). Qualquer item não numérico torna o resultado ausente; lista vazia dá 0.

| Expressão | Escopo | Resultado |
|---|---|---|
| `soma([1, 2, 3])` |  | `6` |
| `soma([])` |  | `0` |
| `soma([1, "x"])` |  | _(ausente)_ |

**Leis** (testadas com entradas aleatórias):
- `soma(concat(a, b)) == soma(a) + soma(b)`

### `chaves`

`chaves(objeto) → lista de textos`

Chaves próprias em ORDEM ALFABÉTICA (determinística em qualquer plataforma).

| Expressão | Escopo | Resultado |
|---|---|---|
| `chaves(o)` | `{"o":{"b":1,"a":2}}` | `["a","b"]` |
| `chaves([1])` |  | _(ausente)_ |

**Leis** (testadas com entradas aleatórias):
- `tamanho(chaves(o)) == tamanho(o)`

### `valores`

`valores(objeto) → lista`

Valores na ordem alfabética das chaves.

| Expressão | Escopo | Resultado |
|---|---|---|
| `valores(o)` | `{"o":{"b":1,"a":2}}` | `[2,1]` |

### `entradas`

`entradas(objeto) → lista de [chave, valor]`

Pares [chave, valor] na ordem alfabética das chaves.

| Expressão | Escopo | Resultado |
|---|---|---|
| `entradas(o)` | `{"o":{"b":1,"a":2}}` | `[["a",2],["b",1]]` |

**Leis** (testadas com entradas aleatórias):
- `igual(objeto(entradas(o)), o)`

### `objeto`

`objeto(lista de [chave, valor]) → objeto`

Constrói o objeto; chave repetida: vale a última. Par malformado ou chave que não é texto: ausente.

| Expressão | Escopo | Resultado |
|---|---|---|
| `objeto([["a", 1], ["b", 2]])` |  | `{"a":1,"b":2}` |
| `objeto([["a", 1], ["a", 2]])` |  | `{"a":2}` |
| `objeto([[1, 2]])` |  | _(ausente)_ |

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

### `racional`

`racional(x) → texto canônico`

Normaliza para a CLASSE do número: fração reduzida, denominador positivo, inteiro sem "/1". Duas entradas que valem o mesmo número dão o MESMO texto, então `==` compara números exatos. Número JS entra pelo texto mais curto (0.1 vira 1/10).

| Expressão | Escopo | Resultado |
|---|---|---|
| `racional("2/4")` |  | `"1/2"` |
| `racional("0.50")` |  | `"1/2"` |
| `racional("1e3")` |  | `"1000"` |
| `racional(0.1)` |  | `"1/10"` |
| `racional("-0")` |  | `"0"` |
| `racional("6/-4")` |  | _(ausente)_ |
| `racional("1/0")` |  | _(ausente)_ |
| `racional("x")` |  | _(ausente)_ |

**Leis** (testadas com entradas aleatórias):
- `racional(racional(a)) == racional(a)`
- `racional(qneg(qneg(a))) == racional(a)`

### `qsoma`

`qsoma(a, b, …) → racional   (1 a 16 operandos)`

Soma exata (⊕ cruzado: a·d + b·c sobre b·d, reduzido). Qualquer operando inválido torna o resultado ausente.

| Expressão | Escopo | Resultado |
|---|---|---|
| `qsoma("0.1", "0.2")` |  | `"3/10"` |
| `qsoma("1/3", "1/6")` |  | `"1/2"` |
| `qsoma(1, 2, 3)` |  | `"6"` |
| `qsoma("0.1", "x")` |  | _(ausente)_ |

**Leis** (testadas com entradas aleatórias):
- `qsoma(a, b) == qsoma(b, a)`
- `qsoma(qsoma(a, b), c) == qsoma(a, qsoma(b, c))`
- `qsoma(a, 0) == racional(a)`
- `qsoma(a, qneg(a)) == "0"`

**Não vale:**
- Ao contrário de `+` (ponto flutuante), `qsoma` É associativa e exata: 0,1 + 0,2 = 3/10, sempre.

### `qsub`

`qsub(a, b) → racional`

Diferença exata.

| Expressão | Escopo | Resultado |
|---|---|---|
| `qsub("1/2", "1/3")` |  | `"1/6"` |
| `qsub(5, 5)` |  | `"0"` |

**Leis** (testadas com entradas aleatórias):
- `qsub(a, a) == "0"`
- `qsoma(qsub(a, b), b) == racional(a)`

### `qmul`

`qmul(a, b, …) → racional   (1 a 16 operandos)`

Produto exato (⊗ por componentes: a·c sobre b·d, reduzido).

| Expressão | Escopo | Resultado |
|---|---|---|
| `qmul("2/3", "3/4")` |  | `"1/2"` |
| `qmul("0.1", "0.1")` |  | `"1/100"` |
| `qmul(1, 2, 3, 4)` |  | `"24"` |

**Leis** (testadas com entradas aleatórias):
- `qmul(a, b) == qmul(b, a)`
- `qmul(qmul(a, b), c) == qmul(a, qmul(b, c))`
- `qmul(a, 1) == racional(a)`
- `qmul(a, 0) == "0"`
- `qmul(a, qsoma(b, c)) == qsoma(qmul(a, b), qmul(a, c))`

### `qdiv`

`qdiv(a, b) → racional`

Quociente exato. Divisão por zero é ausente: o preço do andar ℚ, que torna a divisão total exceto no zero.

| Expressão | Escopo | Resultado |
|---|---|---|
| `qdiv(1, 3)` |  | `"1/3"` |
| `qdiv(6, -4)` |  | `"-3/2"` |
| `qdiv(1, 0)` |  | _(ausente)_ |

**Leis** (testadas com entradas aleatórias):
- `racional(b) == "0" || qdiv(qmul(a, b), b) == racional(a)`

### `qresto`

`qresto(a, b) → racional`

Resto matemático a − b·⌊a/b⌋: tem o sinal de `b` (diferente de `%`, que tem o do dividendo). Vale para racionais.

| Expressão | Escopo | Resultado |
|---|---|---|
| `qresto(7, 3)` |  | `"1"` |
| `qresto(-7, 3)` |  | `"2"` |
| `qresto(7, -3)` |  | `"-2"` |
| `qresto("5.5", 2)` |  | `"3/2"` |
| `qresto(1, 0)` |  | _(ausente)_ |

**Leis** (testadas com entradas aleatórias):
- `racional(b) == "0" || qcmp(qresto(a, b), 0) == 0 || qcmp(qresto(a, b), 0) == qcmp(b, 0)`

### `qneg`

`qneg(x) → racional`

Oposto exato do número (zero continua zero, sem sinal).

| Expressão | Escopo | Resultado |
|---|---|---|
| `qneg("1/2")` |  | `"-1/2"` |
| `qneg(0)` |  | `"0"` |

### `qabs`

`qabs(x) → racional`

Valor absoluto.

| Expressão | Escopo | Resultado |
|---|---|---|
| `qabs("-3/4")` |  | `"3/4"` |

**Leis** (testadas com entradas aleatórias):
- `qcmp(qabs(a), 0) >= 0`
- `qabs(qmul(a, b)) == qmul(qabs(a), qabs(b))`

### `qcmp`

`qcmp(a, b) → -1 | 0 | 1`

Compara SEM dividir (produto cruzado a·d × c·b). Ordem total.

| Expressão | Escopo | Resultado |
|---|---|---|
| `qcmp("1/3", "0.33")` |  | `1` |
| `qcmp("1/2", "0.5")` |  | `0` |
| `qcmp(1, 2)` |  | `-1` |

**Leis** (testadas com entradas aleatórias):
- `qcmp(a, b) == -qcmp(b, a)`
- `qcmp(a, a) == 0`
- `!(qcmp(a, b) < 0 && qcmp(b, c) < 0) || qcmp(a, c) < 0`
- `!(qcmp(a, b) < 0) || qcmp(qsoma(a, c), qsoma(b, c)) < 0`
- `(qcmp(a, b) == 0) == (racional(a) == racional(b))`

### `qpot`

`qpot(x, k) → racional   (k inteiro, |k| ≤ 1000)`

Potência inteira exata; expoente negativo inverte (base zero é ausente). Resultado acima do teto de 1000 dígitos é ausente (cortado ANTES de calcular).

| Expressão | Escopo | Resultado |
|---|---|---|
| `qpot(2, 10)` |  | `"1024"` |
| `qpot("2/3", 2)` |  | `"4/9"` |
| `qpot(2, -2)` |  | `"1/4"` |
| `qpot(10, 1000)` |  | _(ausente)_ |
| `qpot(0, -1)` |  | _(ausente)_ |

**Leis** (testadas com entradas aleatórias):
- `qpot(a, 0) == "1"`
- `qmul(qpot(a, 2), qpot(a, 3)) == qpot(a, 5)`

### `qpiso`

`qpiso(x) → inteiro (texto)`

Maior inteiro ≤ x, sem passar por double.

| Expressão | Escopo | Resultado |
|---|---|---|
| `qpiso("7/2")` |  | `"3"` |
| `qpiso("-7/2")` |  | `"-4"` |

**Leis** (testadas com entradas aleatórias):
- `qcmp(qpiso(a), a) <= 0 && qcmp(a, qsoma(qpiso(a), 1)) < 0`

### `qnumerador`

`qnumerador(x) → inteiro (texto)`

Numerador da classe reduzida (leva o sinal).

| Expressão | Escopo | Resultado |
|---|---|---|
| `qnumerador("6/4")` |  | `"3"` |
| `qnumerador("-0.5")` |  | `"-1"` |

### `qdenominador`

`qdenominador(x) → inteiro (texto)`

Denominador da classe reduzida (sempre positivo; 1 para inteiros).

| Expressão | Escopo | Resultado |
|---|---|---|
| `qdenominador("6/4")` |  | `"2"` |
| `qdenominador(5)` |  | `"1"` |

**Leis** (testadas com entradas aleatórias):
- `qdiv(qnumerador(a), qdenominador(a)) == racional(a)`

### `qmdc`

`qmdc(a, b) → inteiro (texto)`

Máximo divisor comum de DOIS INTEIROS (racional não inteiro é ausente). mdc(0, 0) = 0.

| Expressão | Escopo | Resultado |
|---|---|---|
| `qmdc(12, 18)` |  | `"6"` |
| `qmdc(0, 0)` |  | `"0"` |
| `qmdc("1/2", 2)` |  | _(ausente)_ |
| `qmdc(-4, 6)` |  | `"2"` |

### `qmmc`

`qmmc(a, b) → inteiro (texto)`

Mínimo múltiplo comum de dois inteiros (zero se algum for zero).

| Expressão | Escopo | Resultado |
|---|---|---|
| `qmmc(4, 6)` |  | `"12"` |
| `qmmc(0, 5)` |  | `"0"` |

**Leis** (testadas com entradas aleatórias):
- `qmul(qmdc(a, b), qmmc(a, b)) == qabs(qmul(a, b))`

### `qmin`

`qmin(a, b, …) → racional`

Menor dos operandos, exato.

| Expressão | Escopo | Resultado |
|---|---|---|
| `qmin("1/2", "1/3")` |  | `"1/3"` |

**Leis** (testadas com entradas aleatórias):
- `qcmp(qmin(a, b), qmax(a, b)) <= 0`

### `qmax`

`qmax(a, b, …) → racional`

Maior dos operandos, exato.

| Expressão | Escopo | Resultado |
|---|---|---|
| `qmax("1/2", "1/3")` |  | `"1/2"` |

### `qdec`

`qdec(x, casas = 2, modo = "longe") → texto decimal`

ÚNICO lugar onde se arredonda: texto decimal com exatamente `casas` (0 a 100) dígitos fracionários. Modos: `longe` (meio para longe do zero: arredondamento comercial), `par` (meio para o par), `zero` (trunca), `baixo` (⌊⌋), `cima` (⌈⌉). Sem passar por double: 2.675 → 2.68 (o toFixed do JavaScript dá 2.67).

| Expressão | Escopo | Resultado |
|---|---|---|
| `qdec("1/3", 4)` |  | `"0.3333"` |
| `qdec("2.675", 2)` |  | `"2.68"` |
| `qdec("2.665", 2, "par")` |  | `"2.66"` |
| `qdec("2.665", 2)` |  | `"2.67"` |
| `qdec("-2.5", 0, "baixo")` |  | `"-3"` |
| `qdec("-2.5", 0, "cima")` |  | `"-2"` |
| `qdec("-2.5", 0, "zero")` |  | `"-2"` |
| `qdec("-2.5", 0)` |  | `"-3"` |
| `qdec("-0.001", 2)` |  | `"0.00"` |
| `qdec(5)` |  | `"5.00"` |
| `qdec(1, 2, "xx")` |  | _(ausente)_ |
| `qdec(1, 101)` |  | _(ausente)_ |

**Leis** (testadas com entradas aleatórias):
- `qcmp(qdec(a, absoluto(k) % 8, "baixo"), a) <= 0`
- `qcmp(qdec(a, absoluto(k) % 8, "cima"), a) >= 0`
- `qcmp(qabs(qsub(qdec(a, absoluto(k) % 8), a)), qdiv(1, qmul(2, qpot(10, absoluto(k) % 8)))) <= 0`
- `qcmp(qabs(qsub(qdec(a, absoluto(k) % 8, "par"), a)), qdiv(1, qmul(2, qpot(10, absoluto(k) % 8)))) <= 0`
- `qcmp(qabs(qsub(qdec(a, absoluto(k) % 8, "zero"), a)), qdiv(1, qpot(10, absoluto(k) % 8))) < 0`
- `qdec(qdec(a, absoluto(k) % 8, "par"), absoluto(k) % 8, "par") == qdec(a, absoluto(k) % 8, "par")`
- `racional(qdec(a, 4)) == racional(a)`

### `qformata`

`qformata(x, casas = 2, modo = "longe") → texto pt-BR`

Como `qdec`, formatado em pt-BR (milhar com ponto, decimal com vírgula), exato e sem Intl.

| Expressão | Escopo | Resultado |
|---|---|---|
| `qformata("1234567.891")` |  | `"1.234.567,89"` |
| `qformata("-1234.5")` |  | `"-1.234,50"` |
| `qformata("0.5", 0, "par")` |  | `"0"` |

### `qbrl`

`qbrl(x) → texto`

Reais com 2 casas, arredondamento comercial (`longe`), exato. Igual a `brl` onde o double é exato; correto onde o double não é.

| Expressão | Escopo | Resultado |
|---|---|---|
| `qbrl("1234.5")` |  | `"R$ 1.234,50"` |
| `qbrl("-0.005")` |  | `"-R$ 0,01"` |
| `qbrl("0.1") == brl(0.1)` |  | `true` |

**Leis** (testadas com entradas aleatórias):
- `qbrl(a) == brl(qnum(qdec(a, 2)))`

### `qnum`

`qnum(x) → número`

Aproximação em double (arredondada corretamente quando numerador e denominador cabem em 53 bits). Use só para exibir ou desenhar; nunca para calcular dinheiro.

| Expressão | Escopo | Resultado |
|---|---|---|
| `qnum("1/4")` |  | `0.25` |
| `qnum("1/3")` |  | `0.3333333333333333` |

### `obter`

`obter(x, caminho, padrão?) → valor`

Valor no caminho; se não existe (ou é null), o padrão (ausente se omitido). Equivale a `x.a[0].b`, mas com caminho calculado.

| Expressão | Escopo | Resultado |
|---|---|---|
| `obter(x, ["a", 1, "b"])` | `{"x":{"a":[0,{"b":7}]}}` | `7` |
| `obter(x, ["z"], "nada")` | `{"x":{}}` | `"nada"` |
| `obter(x, [])` | `{"x":5}` | `5` |
| `obter(x, ["a", "__proto__"])` | `{"x":{"a":{}}}` | _(ausente)_ |

**Leis** (testadas com entradas aleatórias):
- `igual(obter(x, []), x) || x == null`

### `com`

`com(x, caminho, valor) → x'`

Nova árvore com o valor no caminho. Cria o que falta (texto → objeto; índice 0 → lista; índice = tamanho → anexa); índice além disso é ausente. Só o caminho é copiado; se o valor já é o mesmo, devolve a mesma referência. Chaves `__proto__`, `constructor` e `prototype` e caminhos com mais de 64 passos são recusados.

| Expressão | Escopo | Resultado |
|---|---|---|
| `com(x, ["a", "b"], 1)` | `{"x":{"a":{"c":0}}}` | `{"a":{"c":0,"b":1}}` |
| `com(x, [0, "n"], 1)` | `{"x":[]}` | `[{"n":1}]` |
| `com(x, [5], 1)` | `{"x":[]}` | _(ausente)_ |
| `com(x, ["a", "b"], 1)` | `{"x":{"a":1}}` | _(ausente)_ |
| `com(x, ["__proto__", "p"], 1)` | `{"x":{}}` | _(ausente)_ |

**Leis** (testadas com entradas aleatórias):
- `com(x, ["k", "v"], a) == null || igual(obter(com(x, ["k", "v"], a), ["k", "v"]), a) || a == null`
- `com(x, ["k"], a) == null || igual(com(com(x, ["k"], a), ["k"], b), com(x, ["k"], b))`

### `sem`

`sem(x, caminho) → x'`

Remove a chave (objeto) ou a posição (lista, os seguintes sobem). Já ausente: a mesma referência. Caminho vazio é ausente (a raiz não se remove).

| Expressão | Escopo | Resultado |
|---|---|---|
| `sem(x, ["a"])` | `{"x":{"a":1,"b":2}}` | `{"b":2}` |
| `sem(x, ["l", 1])` | `{"x":{"l":[1,2,3]}}` | `{"l":[1,3]}` |
| `sem(x, ["z"])` | `{"x":{"a":1}}` | `{"a":1}` |
| `sem(x, [])` | `{"x":1}` | _(ausente)_ |

**Leis** (testadas com entradas aleatórias):
- `x == null || com(x, ["k"], a) == null || igual(sem(com(x, ["k"], a), ["k"]), sem(x, ["k"]))`

### `atualiza`

`atualiza(x, caminho, v => novo) → x'`

Troca o valor do caminho pelo que a função devolve a partir do valor atual (ausente se não existe). É `com(x, caminho, f(obter(x, caminho)))` numa passada só.

| Expressão | Escopo | Resultado |
|---|---|---|
| `atualiza(x, ["n"], v => v + 1)` | `{"x":{"n":1,"m":2}}` | `{"n":2,"m":2}` |
| `atualiza(x, ["l"], l => concat(l, [9]))` | `{"x":{"l":[1]}}` | `{"l":[1,9]}` |
| `atualiza(x, ["itens", 1, "ok"], v => !v)` | `{"x":{"itens":[{"ok":true},{"ok":false}]}}` | `{"itens":[{"ok":true},{"ok":true}]}` |

**Leis** (testadas com entradas aleatórias):
- `!contem(chaves(o), "a") || igual(atualiza(o, ["a"], v => v), o)`

### `insere`

`insere(lista, i, valor) → lista`

Insere na posição `i` (0 a tamanho), empurrando os seguintes. Fora disso, ausente.

| Expressão | Escopo | Resultado |
|---|---|---|
| `insere([1, 2], 1, 9)` |  | `[1,9,2]` |
| `insere([1, 2], 2, 9)` |  | `[1,2,9]` |
| `insere([1, 2], 3, 9)` |  | _(ausente)_ |

**Leis** (testadas com entradas aleatórias):
- `i > tamanho(l) || igual(sem(insere(l, i, v), [i]), l)`

### `move`

`move(lista, de, para) → lista`

Move o item da posição `de` para a posição `para` (ambas existentes). Mesma posição: a mesma referência.

| Expressão | Escopo | Resultado |
|---|---|---|
| `move([1, 2, 3, 4], 0, 2)` |  | `[2,3,1,4]` |
| `move([1, 2, 3, 4], 3, 0)` |  | `[4,1,2,3]` |
| `move([1], 0, 1)` |  | _(ausente)_ |

**Leis** (testadas com entradas aleatórias):
- `i >= tamanho(l) || j >= tamanho(l) || igual(move(move(l, i, j), j, i), l)`

### `mescla`

`mescla(a, b) → objeto`

Mescla RASA de dois objetos: as chaves de `b` valem sobre as de `a`. Nada muda: a mesma referência. Chaves proibidas em `b` são ausente.

| Expressão | Escopo | Resultado |
|---|---|---|
| `mescla(a, b)` | `{"a":{"x":1,"y":2},"b":{"y":3,"z":4}}` | `{"x":1,"y":3,"z":4}` |
| `mescla(a, 5)` | `{"a":{}}` | _(ausente)_ |

**Leis** (testadas com entradas aleatórias):
- `igual(mescla(mescla(a, b), c), mescla(a, mescla(b, c)))`
- `mescla(a, a) == null || igual(mescla(a, a), a)`

### `difere`

`difere(a, b) → lista de patches`

Patches (estilo JSON Patch, reversíveis) que levam `a` a `b`: `{op: "add"|"remove"|"replace", caminho, valor?, antes?}`. Pula subárvores com a mesma referência: o custo é proporcional ao que mudou. Remoções de lista vêm do fim para o começo. Mais de 100 000 patches é ausente.

| Expressão | Escopo | Resultado |
|---|---|---|
| `difere(a, b)` | `{"a":{"x":1,"y":2},"b":{"x":1,"y":3,"z":4}}` | `[{"op":"replace","caminho":["y"],"valor":3,"antes":2},{"op":"add","caminho":["z"],"valor":4}]` |
| `difere(a, b)` | `{"a":{"l":[1,2,3]},"b":{"l":[1]}}` | `[{"op":"remove","caminho":["l",2],"antes":3},{"op":"remove","caminho":["l",1],"antes":2}]` |

**Leis** (testadas com entradas aleatórias):
- `tamanho(difere(a, a)) == 0`
- `igual(aplica(a, difere(a, b)), b)`

### `aplica`

`aplica(x, patches) → x'`

Aplica os patches em sequência. Atômico: qualquer patch inválido (forma, caminho, tipo) torna o resultado ausente e nada é aplicado.

| Expressão | Escopo | Resultado |
|---|---|---|
| `aplica(a, difere(a, b))` | `{"a":{"x":1},"b":{"x":2,"y":[1]}}` | `{"x":2,"y":[1]}` |
| `aplica(a, ps)` | `{"a":{},"ps":[{"op":1}]}` | _(ausente)_ |

### `inverso`

`inverso(patches) → patches`

Os patches que DESFAZEM: ordem inversa, `add` ↔ `remove`, `replace` troca `valor` e `antes`. Exige o valor antigo nos patches (os de `difere` já o trazem).

| Expressão | Escopo | Resultado |
|---|---|---|
| `inverso(difere(a, b))` | `{"a":{"x":1},"b":{"x":2}}` | `[{"op":"replace","caminho":["x"],"valor":1,"antes":2}]` |

**Leis** (testadas com entradas aleatórias):
- `igual(aplica(b, inverso(difere(a, b))), a)`
