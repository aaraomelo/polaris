// ---------------------------------------------------------------------------
// REGISTRO: a única tabela que descreve a linguagem. De cada função, operador e forma saem, sem repetição:
//   - a documentação (docs/funcoes.md, gerada por `pnpm docs:funcoes`);
//   - os exemplos, que são EXECUTADOS nos testes (documentação que não mente);
//   - as leis algébricas, que são propriedades testadas por geração aleatória (e as NÃO-leis, ditas com franqueza).
// Uma função nova só entra em FUNCOES_PADRAO se tiver entrada aqui (teste de completude).
// ---------------------------------------------------------------------------

export type Gerador = 'texto' | 'numero' | 'inteiro' | 'escalar' | 'lista' | 'listas' | 'objeto' | 'racional' | 'decimal' | 'json' | 'indice' | 'qualquer'

export type Exemplo = { expr: string; esc?: Record<string, unknown>; saida?: unknown; indefinido?: true }
export type Lei = { expr: string; gera: Record<string, Gerador> }

export type Def = {
  nome: string
  tipo: 'funcao' | 'operador' | 'forma'
  assinatura: string
  descricao: string
  exemplos: Exemplo[]
  /** propriedades que valem sempre: a expressão é avaliada com variáveis aleatórias e tem de dar verdadeiro */
  leis?: Lei[]
  /** o que NÃO vale (e alguém poderia esperar) */
  naoLeis?: string[]
}

const U = true as const

export const REGISTRO: Def[] = [
  // ---- formas ---------------------------------------------------------------
  { nome: 'lit', tipo: 'forma', assinatura: '{ lit: null | booleano | número | texto }', descricao: 'Literal. Número é finito e não negativo (o negativo é `neg`); listas e objetos se constroem com `lista`.', exemplos: [
    { expr: '42', saida: 42 }, { expr: '"oi"', saida: 'oi' }, { expr: 'null', saida: null }, { expr: '1e3', saida: 1000 },
  ] },
  { nome: 'var', tipo: 'forma', assinatura: '{ var: nome }', descricao: 'Lê uma variável do escopo. Nome ausente (ou `__proto__`, `constructor`, `prototype`) dá ausente, nunca erro.', exemplos: [
    { expr: 'x', esc: { x: 7 }, saida: 7 }, { expr: 'y', esc: { x: 7 }, indefinido: U }, { expr: '__proto__', esc: {}, indefinido: U },
  ] },
  { nome: 'campo', tipo: 'forma', assinatura: '{ campo: nome, de: nó }  ≡  de.nome', descricao: 'Campo de um objeto (só próprios). Em texto e lista só `length` existe. Tudo o mais é ausente; ausente propaga.', exemplos: [
    { expr: 'a.b', esc: { a: { b: 1 } }, saida: 1 }, { expr: 'a.nada.x', esc: { a: {} }, indefinido: U }, { expr: 'l.length', esc: { l: [1, 2, 3] }, saida: 3 }, { expr: 'o.toString', esc: { o: {} }, indefinido: U },
  ] },
  { nome: 'indice', tipo: 'forma', assinatura: '{ indice: nó, de: nó }  ≡  de[indice]', descricao: 'Posição de lista/texto (inteiro ≥ 0) ou chave de objeto (texto). Fora do alcance é ausente.', exemplos: [
    { expr: 'l[1]', esc: { l: [10, 20] }, saida: 20 }, { expr: 'l[9]', esc: { l: [10, 20] }, indefinido: U }, { expr: 'l[-1]', esc: { l: [10, 20] }, indefinido: U }, { expr: 'o["a-b"]', esc: { o: { 'a-b': 5 } }, saida: 5 },
  ] },
  { nome: 'lista', tipo: 'forma', assinatura: '{ lista: [nó…] }  ≡  [a, b, …]', descricao: 'Constrói uma lista avaliando cada item.', exemplos: [{ expr: '[1, x, "a"]', esc: { x: 2 }, saida: [1, 2, 'a'] }, { expr: '[]', saida: [] }] },
  { nome: 'se', tipo: 'forma', assinatura: '{ se: nó, entao: nó, senao: nó }  ≡  c ? a : b', descricao: 'Condicional. Só o ramo escolhido é avaliado. Veracidade: são falsos `null`, ausente, `false`, `0`, `NaN`, `""` e lista vazia; o resto é verdadeiro (inclusive objeto vazio).', exemplos: [
    { expr: 'x ? "sim" : "não"', esc: { x: 1 }, saida: 'sim' }, { expr: 'x ? "sim" : "não"', esc: { x: '' }, saida: 'não' }, { expr: 'x ? "sim" : "não"', esc: { x: [] }, saida: 'não' }, { expr: 'x ? "sim" : "não"', esc: { x: {} }, saida: 'sim' },
  ], leis: [{ expr: '(c ? a : b) == (!c ? b : a)', gera: { c: 'qualquer', a: 'escalar', b: 'escalar' } }] },

  { nome: 'fn', tipo: 'forma', assinatura: '{ fn: [param…], corpo: nó }  ≡  x => corpo  |  (a, b) => corpo', descricao: 'Função anônima de 1 a 3 parâmetros. SÓ pode ser o argumento de um combinador (mapeia, filtra, dobra, todos, algum, acha, ordena, agrupa); em qualquer outro lugar é erro de compilação. Enxerga as variáveis de fora e os próprios parâmetros. Não há recursão nem função como valor: a linguagem continua total.', exemplos: [
    { expr: 'mapeia([1, 2, 3], x => x * 2)', saida: [2, 4, 6] }, { expr: 'mapeia(l, (x, i) => x + i)', esc: { l: [10, 20] }, saida: [10, 21] }, { expr: 'mapeia(l, x => x + k)', esc: { l: [1, 2], k: 10 }, saida: [11, 12] },
  ] },

  // ---- operadores -----------------------------------------------------------
  { nome: '+', tipo: 'operador', assinatura: 'a + b', descricao: 'Soma de números; se um dos lados é texto, concatena (ausente/objeto/lista viram vazio); nos demais casos, ausente.', exemplos: [
    { expr: '1 + 2', saida: 3 }, { expr: '"a" + 1', saida: 'a1' }, { expr: '"a" + x', esc: {}, saida: 'a' }, { expr: '1 + x', esc: { x: null }, indefinido: U },
  ], leis: [{ expr: '(a + b) == (b + a)', gera: { a: 'numero', b: 'numero' } }, { expr: '(a + 0) == a', gera: { a: 'numero' } }, { expr: '((a + b) + c) == (a + (b + c))', gera: { a: 'texto', b: 'texto', c: 'texto' } }],
    naoLeis: ['A soma de números NÃO é associativa em ponto flutuante: (0,1 + 0,2) + 0,3 ≠ 0,1 + (0,2 + 0,3). Dinheiro deve usar decimal exato (card da torre numérica).'] },
  { nome: '-', tipo: 'operador', assinatura: 'a - b', descricao: 'Subtração; só números (senão, ausente).', exemplos: [{ expr: '5 - 3', saida: 2 }, { expr: '"5" - 3', indefinido: U }], leis: [{ expr: '(a - a) == 0', gera: { a: 'numero' } }] },
  { nome: '*', tipo: 'operador', assinatura: 'a * b', descricao: 'Produto; só números. Resultado não finito é ausente.', exemplos: [{ expr: '3 * 4', saida: 12 }, { expr: '1e308 * 10', indefinido: U }], leis: [{ expr: '(a * b) == (b * a)', gera: { a: 'numero', b: 'numero' } }, { expr: '(a * 1) == a', gera: { a: 'numero' } }] },
  { nome: '/', tipo: 'operador', assinatura: 'a / b', descricao: 'Divisão; só números. Divisão por zero é ausente (nunca Infinity).', exemplos: [{ expr: '7 / 2', saida: 3.5 }, { expr: '1 / 0', indefinido: U }] },
  { nome: '%', tipo: 'operador', assinatura: 'a % b', descricao: 'Resto da divisão (sinal do dividendo); só números. Módulo por zero é ausente.', exemplos: [{ expr: '7 % 3', saida: 1 }, { expr: '-7 % 3', saida: -1 }, { expr: '1 % 0', indefinido: U }] },
  { nome: '==', tipo: 'operador', assinatura: 'a == b', descricao: 'Igualdade sem coerção: `null` e ausente são iguais entre si; tipos diferentes são diferentes; listas e objetos nunca são iguais (nem a si mesmos).', exemplos: [
    { expr: '1 == 1', saida: true }, { expr: '1 == "1"', saida: false }, { expr: 'x == null', esc: {}, saida: true }, { expr: '[1] == [1]', saida: false },
  ], leis: [{ expr: '(a == b) == (b == a)', gera: { a: 'escalar', b: 'escalar' } }, { expr: 'a == a', gera: { a: 'escalar' } }] },
  { nome: '!=', tipo: 'operador', assinatura: 'a != b', descricao: 'Negação de `==`.', exemplos: [{ expr: '1 != 2', saida: true }], leis: [{ expr: '(a != b) == !(a == b)', gera: { a: 'escalar', b: 'escalar' } }] },
  { nome: '<', tipo: 'operador', assinatura: 'a < b', descricao: 'Comparação de número com número ou de texto com texto (ordem de código); qualquer outra combinação é falsa.', exemplos: [{ expr: '1 < 2', saida: true }, { expr: '"a" < "b"', saida: true }, { expr: '1 < "b"', saida: false }] },
  { nome: '<=', tipo: 'operador', assinatura: 'a <= b', descricao: 'Como `<`, com igualdade.', exemplos: [{ expr: '2 <= 2', saida: true }] },
  { nome: '>', tipo: 'operador', assinatura: 'a > b', descricao: 'Como `<`, invertido.', exemplos: [{ expr: '3 > 2', saida: true }] },
  { nome: '>=', tipo: 'operador', assinatura: 'a >= b', descricao: 'Como `<=`, invertido.', exemplos: [{ expr: '2 >= 3', saida: false }] },
  { nome: '&&', tipo: 'operador', assinatura: 'a && b', descricao: 'Curto-circuito: se `a` é falso devolve `a`, senão `b` (devolve o VALOR, não um booleano).', exemplos: [
    { expr: 'a && b', esc: { a: 0, b: 5 }, saida: 0 }, { expr: 'a && b', esc: { a: 1, b: 5 }, saida: 5 },
  ], leis: [{ expr: '((a && b) && c) == (a && (b && c))', gera: { a: 'escalar', b: 'escalar', c: 'escalar' } }, { expr: '!(a && b) == (!a || !b)', gera: { a: 'qualquer', b: 'qualquer' } }] },
  { nome: '||', tipo: 'operador', assinatura: 'a || b', descricao: 'Curto-circuito: se `a` é verdadeiro devolve `a`, senão `b`.', exemplos: [
    { expr: 'a || "x"', esc: { a: '' }, saida: 'x' }, { expr: 'a || "x"', esc: { a: 'y' }, saida: 'y' },
  ], leis: [{ expr: '((a || b) || c) == (a || (b || c))', gera: { a: 'escalar', b: 'escalar', c: 'escalar' } }, { expr: '!(a || b) == (!a && !b)', gera: { a: 'qualquer', b: 'qualquer' } }] },
  { nome: '??', tipo: 'operador', assinatura: 'a ?? b', descricao: 'Valor padrão só para `null`/ausente: `0`, `""` e `false` são mantidos.', exemplos: [
    { expr: 'a ?? "x"', esc: { a: null }, saida: 'x' }, { expr: 'a ?? "x"', esc: { a: 0 }, saida: 0 }, { expr: 'a ?? "x"', esc: {}, saida: 'x' },
  ], leis: [{ expr: '((a ?? b) ?? c) == (a ?? (b ?? c))', gera: { a: 'escalar', b: 'escalar', c: 'escalar' } }] },
  { nome: '!', tipo: 'operador', assinatura: '!a', descricao: 'Negação da veracidade (sempre booleano).', exemplos: [{ expr: '!x', esc: { x: [] }, saida: true }, { expr: '!x', esc: { x: 1 }, saida: false }], leis: [{ expr: '!!a == !!!!a', gera: { a: 'qualquer' } }] },
  { nome: 'neg', tipo: 'operador', assinatura: '-a  ≡  { chama: "neg", args: [a] }', descricao: 'Negativo de um número; outro tipo é ausente.', exemplos: [{ expr: '-x', esc: { x: 5 }, saida: -5 }, { expr: '-x', esc: { x: '5' }, indefinido: U }], leis: [{ expr: '-(-a) == a', gera: { a: 'numero' } }] },

  // ---- funções --------------------------------------------------------------
  // combinadores (recebem função anônima): a ÚNICA iteração da linguagem, sempre sobre uma lista que já existe
  { nome: 'mapeia', tipo: 'funcao', assinatura: 'mapeia(lista, x => …) → lista   (a função pode receber também o índice: (x, i) => …)', descricao: 'Aplica a função a cada item, na ordem. Funtor da lista: preserva o tamanho. Não-lista é ausente.', exemplos: [
    { expr: 'mapeia([1, 2, 3], x => x * x)', saida: [1, 4, 9] }, { expr: 'mapeia(["a", "b"], (x, i) => x + i)', saida: ['a0', 'b1'] }, { expr: 'mapeia(5, x => x)', indefinido: U },
  ], leis: [
    { expr: 'igual(mapeia(l, x => x), l)', gera: { l: 'lista' } },
    { expr: 'tamanho(mapeia(l, x => x * 2)) == tamanho(l)', gera: { l: 'lista' } },
    { expr: 'igual(mapeia(mapeia(l, x => x + 1), x => x * 2), mapeia(l, x => (x + 1) * 2))', gera: { l: 'lista' } },
    { expr: 'igual(mapeia(concat(a, b), x => x + 1), concat(mapeia(a, x => x + 1), mapeia(b, x => x + 1)))', gera: { a: 'lista', b: 'lista' } },
  ] },
  { nome: 'filtra', tipo: 'funcao', assinatura: 'filtra(lista, x => condição) → lista', descricao: 'Mantém os itens para os quais a função é verdadeira (mesma veracidade de `se`), na ordem original.', exemplos: [
    { expr: 'filtra([1, 2, 3, 4], x => x % 2 == 0)', saida: [2, 4] }, { expr: 'filtra(l, x => x.ok)', esc: { l: [{ ok: true, n: 1 }, { ok: false, n: 2 }] }, saida: [{ ok: true, n: 1 }] },
  ], leis: [
    { expr: 'igual(filtra(filtra(l, x => x > 0), x => x > 0), filtra(l, x => x > 0))', gera: { l: 'lista' } },
    { expr: 'tamanho(filtra(l, x => x > 0)) + tamanho(filtra(l, x => !(x > 0))) == tamanho(l)', gera: { l: 'lista' } },
    { expr: 'igual(filtra(concat(a, b), x => x > 1), concat(filtra(a, x => x > 1), filtra(b, x => x > 1)))', gera: { a: 'lista', b: 'lista' } },
  ] },
  { nome: 'dobra', tipo: 'funcao', assinatura: 'dobra(lista, inicial, (acc, x) => …) → valor   (opcional: (acc, x, i))', descricao: 'Dobra à esquerda: acc₀ = inicial; accₖ₊₁ = f(accₖ, itemₖ). É o catamorfismo da lista: toda função definida por indução na lista é uma dobra. Um laço limitado pelo tamanho da lista, nunca aberto.', exemplos: [
    { expr: 'dobra([1, 2, 3], 0, (a, x) => a + x)', saida: 6 }, { expr: 'dobra(["a", "b"], "", (a, x) => a + x)', saida: 'ab' }, { expr: 'dobra([], 7, (a, x) => a + x)', saida: 7 },
  ], leis: [
    { expr: 'dobra(l, 0, (a, x) => a + 1) == tamanho(l)', gera: { l: 'lista' } },
    { expr: 'dobra(concat(a, b), 0, (s, x) => s + x) == dobra(b, dobra(a, 0, (s, x) => s + x), (s, x) => s + x)', gera: { a: 'lista', b: 'lista' } },
    { expr: 'igual(dobra(l, [], (acc, x) => concat(acc, [x])), l)', gera: { l: 'lista' } },
    { expr: 'igual(dobra(l, [], (acc, x) => concat([x], acc)), inverte(l))', gera: { l: 'lista' } },
  ] },
  { nome: 'todos', tipo: 'funcao', assinatura: 'todos(lista, x => condição) → booleano', descricao: 'Verdadeiro se a função é verdadeira para todos os itens (lista vazia: verdadeiro).', exemplos: [{ expr: 'todos([1, 2], x => x > 0)', saida: true }, { expr: 'todos([], x => false)', saida: true }], leis: [
    { expr: 'todos(l, x => x > 0) == !algum(l, x => !(x > 0))', gera: { l: 'lista' } },
    { expr: 'todos(concat(a, b), x => x > 0) == (todos(a, x => x > 0) && todos(b, x => x > 0))', gera: { a: 'lista', b: 'lista' } },
  ] },
  { nome: 'algum', tipo: 'funcao', assinatura: 'algum(lista, x => condição) → booleano', descricao: 'Verdadeiro se a função é verdadeira para algum item (lista vazia: falso).', exemplos: [{ expr: 'algum([1, 2], x => x > 1)', saida: true }, { expr: 'algum([], x => true)', saida: false }] },
  { nome: 'acha', tipo: 'funcao', assinatura: 'acha(lista, x => condição) → item', descricao: 'Primeiro item para o qual a função é verdadeira; ausente se nenhum.', exemplos: [{ expr: 'acha([1, 5, 9], x => x > 3)', saida: 5 }, { expr: 'acha([1], x => x > 3)', indefinido: U }], leis: [{ expr: '(acha(l, x => x > 0) == null) == !algum(l, x => x > 0)', gera: { l: 'lista' } }] },
  { nome: 'ordena', tipo: 'funcao', assinatura: 'ordena(lista, x => chave) → lista', descricao: 'Ordena pela chave, de forma ESTÁVEL. Ordem total e determinística das chaves: números < textos < booleanos < o resto (ausente por último); empates mantêm a ordem original.', exemplos: [
    { expr: 'ordena([3, 1, 2], x => x)', saida: [1, 2, 3] }, { expr: 'ordena(["b", "a"], x => x)', saida: ['a', 'b'] }, { expr: 'ordena(l, x => x.n)', esc: { l: [{ n: 2, k: "a" }, { n: 1, k: "b" }, { n: 2, k: "c" }] }, saida: [{ n: 1, k: 'b' }, { n: 2, k: 'a' }, { n: 2, k: 'c' }] }, { expr: 'ordena([2, "a", 1, null], x => x)', saida: [1, 2, 'a', null] },
  ], leis: [
    { expr: 'igual(ordena(ordena(l, x => x), x => x), ordena(l, x => x))', gera: { l: 'lista' } },
    { expr: 'tamanho(ordena(l, x => x)) == tamanho(l)', gera: { l: 'lista' } },
    { expr: 'igual(ordena(inverte(l), x => x), ordena(l, x => x))', gera: { l: 'lista' } },
    { expr: 'igual(ordena(l, x => x), inverte(ordena(l, x => -x)))', gera: { l: 'lista' } },
  ] },
  { nome: 'agrupa', tipo: 'funcao', assinatura: 'agrupa(lista, x => chave) → objeto', descricao: 'Agrupa os itens por chave (a chave vira texto: número e booleano convertem; o resto vira ""). Cada grupo mantém a ordem original.', exemplos: [
    { expr: 'agrupa([1, 2, 3, 4], x => x % 2)', saida: { '0': [2, 4], '1': [1, 3] } }, { expr: 'agrupa(["a", "bb", "c"], x => tamanho(x))', saida: { '1': ['a', 'c'], '2': ['bb'] } },
  ], leis: [{ expr: 'soma(mapeia(valores(agrupa(l, x => x % 2)), g => tamanho(g))) == tamanho(l)', gera: { l: 'lista' } }] },

  // listas e objetos (a lista é o monoide livre: `concat` é a operação e `[]` a unidade)
  { nome: 'igual', tipo: 'funcao', assinatura: 'igual(a, b) → booleano', descricao: 'Igualdade ESTRUTURAL (listas e objetos comparam por conteúdo; a ordem das chaves não importa; `null` e ausente são iguais). Diferente de `==`, que nunca iguala listas e objetos.', exemplos: [
    { expr: 'igual([1, [2]], [1, [2]])', saida: true }, { expr: 'igual(a, b)', esc: { a: { x: 1, y: 2 }, b: { y: 2, x: 1 } }, saida: true }, { expr: 'igual([1], [1, 2])', saida: false }, { expr: 'igual(null, x)', esc: {}, saida: true },
  ], leis: [{ expr: 'igual(a, a)', gera: { a: 'qualquer' } }, { expr: 'igual(a, b) == igual(b, a)', gera: { a: 'qualquer', b: 'qualquer' } }] },
  { nome: 'concat', tipo: 'funcao', assinatura: 'concat(lista, …) → lista   (1 a 16 listas)', descricao: 'Concatena listas. É a operação do monoide livre: associativa, com `[]` como unidade. Resultado acima de 100 000 itens é ausente.', exemplos: [
    { expr: 'concat([1], [2, 3])', saida: [1, 2, 3] }, { expr: 'concat([1], 5)', indefinido: U }, { expr: 'concat([], [])', saida: [] },
  ], leis: [
    { expr: 'igual(concat(concat(a, b), c), concat(a, concat(b, c)))', gera: { a: 'lista', b: 'lista', c: 'lista' } },
    { expr: 'igual(concat(a, []), a) && igual(concat([], a), a)', gera: { a: 'lista' } },
    { expr: 'tamanho(concat(a, b)) == tamanho(a) + tamanho(b)', gera: { a: 'lista', b: 'lista' } },
  ] },
  { nome: 'achata', tipo: 'funcao', assinatura: 'achata(lista) → lista', descricao: 'Remove UM nível de aninhamento (itens que não são lista ficam como estão).', exemplos: [{ expr: 'achata([[1], [2, 3], 4])', saida: [1, 2, 3, 4] }, { expr: 'achata([[[1]]])', saida: [[1]] }], leis: [
    { expr: 'igual(achata(mapeia(l, x => [x])), l)', gera: { l: 'lista' } },
    { expr: 'igual(achata(concat(a, b)), concat(achata(a), achata(b)))', gera: { a: 'listas', b: 'listas' } },
  ] },
  { nome: 'fatia', tipo: 'funcao', assinatura: 'fatia(lista|texto, início, fim?) → lista|texto', descricao: 'Trecho [início, fim); índices negativos contam do fim. Índice não inteiro é ausente.', exemplos: [{ expr: 'fatia([1, 2, 3, 4], 1, 3)', saida: [2, 3] }, { expr: 'fatia("banana", -2)', saida: 'na' }, { expr: 'fatia([1], 0.5)', indefinido: U }], leis: [{ expr: 'igual(concat(fatia(l, 0, k), fatia(l, k)), l)', gera: { l: 'lista', k: 'inteiro' } }] },
  { nome: 'inverte', tipo: 'funcao', assinatura: 'inverte(lista) → lista', descricao: 'Lista na ordem contrária.', exemplos: [{ expr: 'inverte([1, 2, 3])', saida: [3, 2, 1] }], leis: [
    { expr: 'igual(inverte(inverte(l)), l)', gera: { l: 'lista' } }, { expr: 'igual(inverte(concat(a, b)), concat(inverte(b), inverte(a)))', gera: { a: 'lista', b: 'lista' } },
  ] },
  { nome: 'primeiro', tipo: 'funcao', assinatura: 'primeiro(lista) → item', descricao: 'Primeiro item (ausente se vazia).', exemplos: [{ expr: 'primeiro([7, 8])', saida: 7 }, { expr: 'primeiro([])', indefinido: U }] },
  { nome: 'ultimo', tipo: 'funcao', assinatura: 'ultimo(lista) → item', descricao: 'Último item (ausente se vazia).', exemplos: [{ expr: 'ultimo([7, 8])', saida: 8 }], leis: [{ expr: 'igual(primeiro(inverte(l)), ultimo(l))', gera: { l: 'lista' } }] },
  { nome: 'unicos', tipo: 'funcao', assinatura: 'unicos(lista) → lista', descricao: 'Remove repetidos (igualdade estrutural), mantendo a primeira ocorrência.', exemplos: [{ expr: 'unicos([1, 2, 1, 3, 2])', saida: [1, 2, 3] }, { expr: 'unicos([[1], [1], [2]])', saida: [[1], [2]] }], leis: [
    { expr: 'igual(unicos(unicos(l)), unicos(l))', gera: { l: 'lista' } }, { expr: 'tamanho(unicos(l)) <= tamanho(l)', gera: { l: 'lista' } }, { expr: 'todos(l, x => contem(unicos(l), x))', gera: { l: 'lista' } },
  ] },
  { nome: 'intervalo', tipo: 'funcao', assinatura: 'intervalo(fim) | intervalo(início, fim) → lista', descricao: 'Inteiros de início (padrão 0) até fim, exclusive. Vazio se fim ≤ início; acima de 100 000 itens é ausente.', exemplos: [{ expr: 'intervalo(4)', saida: [0, 1, 2, 3] }, { expr: 'intervalo(2, 5)', saida: [2, 3, 4] }, { expr: 'intervalo(-3)', saida: [] }, { expr: 'intervalo(0.5)', indefinido: U }], leis: [{ expr: 'tamanho(intervalo(n)) == maximo(n, 0)', gera: { n: 'inteiro' } }] },
  { nome: 'soma', tipo: 'funcao', assinatura: 'soma(lista) → número', descricao: 'Soma de uma lista de números (da esquerda para a direita). Qualquer item não numérico torna o resultado ausente; lista vazia dá 0.', exemplos: [{ expr: 'soma([1, 2, 3])', saida: 6 }, { expr: 'soma([])', saida: 0 }, { expr: 'soma([1, "x"])', indefinido: U }], leis: [{ expr: 'soma(concat(a, b)) == soma(a) + soma(b)', gera: { a: 'lista', b: 'lista' } }] },
  { nome: 'chaves', tipo: 'funcao', assinatura: 'chaves(objeto) → lista de textos', descricao: 'Chaves próprias em ORDEM ALFABÉTICA (determinística em qualquer plataforma).', exemplos: [{ expr: 'chaves(o)', esc: { o: { b: 1, a: 2 } }, saida: ['a', 'b'] }, { expr: 'chaves([1])', indefinido: U }], leis: [{ expr: 'tamanho(chaves(o)) == tamanho(o)', gera: { o: 'objeto' } }] },
  { nome: 'valores', tipo: 'funcao', assinatura: 'valores(objeto) → lista', descricao: 'Valores na ordem alfabética das chaves.', exemplos: [{ expr: 'valores(o)', esc: { o: { b: 1, a: 2 } }, saida: [2, 1] }] },
  { nome: 'entradas', tipo: 'funcao', assinatura: 'entradas(objeto) → lista de [chave, valor]', descricao: 'Pares [chave, valor] na ordem alfabética das chaves.', exemplos: [{ expr: 'entradas(o)', esc: { o: { b: 1, a: 2 } }, saida: [['a', 2], ['b', 1]] }], leis: [{ expr: 'igual(objeto(entradas(o)), o)', gera: { o: 'objeto' } }] },
  { nome: 'objeto', tipo: 'funcao', assinatura: 'objeto(lista de [chave, valor]) → objeto', descricao: 'Constrói o objeto; chave repetida: vale a última. Par malformado ou chave que não é texto: ausente.', exemplos: [{ expr: 'objeto([["a", 1], ["b", 2]])', saida: { a: 1, b: 2 } }, { expr: 'objeto([["a", 1], ["a", 2]])', saida: { a: 2 } }, { expr: 'objeto([[1, 2]])', indefinido: U }] },
  { nome: 'tamanho', tipo: 'funcao', assinatura: 'tamanho(x) → número', descricao: 'Comprimento de texto ou lista; número de chaves de objeto; 0 para o resto.', exemplos: [
    { expr: 'tamanho("abc")', saida: 3 }, { expr: 'tamanho([1, 2])', saida: 2 }, { expr: 'tamanho(o)', esc: { o: { a: 1, b: 2 } }, saida: 2 }, { expr: 'tamanho(null)', saida: 0 },
  ], leis: [{ expr: 'tamanho(a + b) == tamanho(a) + tamanho(b)', gera: { a: 'texto', b: 'texto' } }] },
  { nome: 'maiusculas', tipo: 'funcao', assinatura: 'maiusculas(x) → texto', descricao: 'Texto em maiúsculas (ausente vira vazio).', exemplos: [{ expr: 'maiusculas("olá")', saida: 'OLÁ' }, { expr: 'maiusculas(x)', esc: {}, saida: '' }], leis: [{ expr: 'maiusculas(maiusculas(a)) == maiusculas(a)', gera: { a: 'texto' } }] },
  { nome: 'urlcodifica', tipo: 'funcao', assinatura: 'urlcodifica(x) → texto', descricao: 'Codifica o texto para uso numa URL (UTF-8; `&`, `#`, `=`, espaço e acentos viram `%XX`). Use para montar `?q=` num link; texto acima de 2000 caracteres vira vazio.', exemplos: [{ expr: 'urlcodifica("café & chá")', saida: 'caf%C3%A9%20%26%20ch%C3%A1' }, { expr: 'urlcodifica("a/b?c=1#d")', saida: 'a%2Fb%3Fc%3D1%23d' }], leis: [{ expr: 'tamanho(urlcodifica(a)) >= tamanho(a)', gera: { a: 'texto' } }] },
  { nome: 'semAcentos', tipo: 'funcao', assinatura: 'semAcentos(x) → texto', descricao: 'Tira os acentos (Unicode decomposto sem as marcas): "Café" → "Cafe". Mantém maiúsculas e minúsculas; combine com `minusculas` para comparar.', exemplos: [{ expr: 'semAcentos("Ação, café, ÀÉ")', saida: 'Acao, cafe, AE' }, { expr: 'semAcentos("abc")', saida: 'abc' }], leis: [{ expr: 'semAcentos(semAcentos(a)) == semAcentos(a)', gera: { a: 'texto' } }] },
  { nome: 'minusculas', tipo: 'funcao', assinatura: 'minusculas(x) → texto', descricao: 'Texto em minúsculas.', exemplos: [{ expr: 'minusculas("ÀB")', saida: 'àb' }], leis: [{ expr: 'minusculas(minusculas(a)) == minusculas(a)', gera: { a: 'texto' } }] },
  { nome: 'aparar', tipo: 'funcao', assinatura: 'aparar(x) → texto', descricao: 'Remove espaços das pontas.', exemplos: [{ expr: 'aparar("  x y  ")', saida: 'x y' }], leis: [{ expr: 'aparar(aparar(a)) == aparar(a)', gera: { a: 'texto' } }, { expr: 'tamanho(aparar(a)) <= tamanho(a)', gera: { a: 'texto' } }] },
  { nome: 'contem', tipo: 'funcao', assinatura: 'contem(texto|lista, x) → booleano', descricao: 'Texto contém o trecho; lista contém o elemento (igualdade estrita). Outros tipos: falso.', exemplos: [
    { expr: 'contem("banana", "nan")', saida: true }, { expr: 'contem([1, 2, 3], 2)', saida: true }, { expr: 'contem(5, 1)', saida: false },
  ], leis: [{ expr: 'contem(a, "")', gera: { a: 'texto' } }, { expr: 'contem(a + b, b)', gera: { a: 'texto', b: 'texto' } }] },
  { nome: 'comeca', tipo: 'funcao', assinatura: 'comeca(texto, prefixo) → booleano', descricao: 'Começa com o prefixo.', exemplos: [{ expr: 'comeca("banana", "ba")', saida: true }], leis: [{ expr: 'comeca(a + b, a)', gera: { a: 'texto', b: 'texto' } }] },
  { nome: 'termina', tipo: 'funcao', assinatura: 'termina(texto, sufixo) → booleano', descricao: 'Termina com o sufixo.', exemplos: [{ expr: 'termina("banana", "na")', saida: true }], leis: [{ expr: 'termina(a + b, b)', gera: { a: 'texto', b: 'texto' } }] },
  { nome: 'junta', tipo: 'funcao', assinatura: 'junta(lista, separador = ", ") → texto', descricao: 'Une os itens (como texto) com o separador. Não-lista dá vazio.', exemplos: [
    { expr: 'junta(["a", "b"])', saida: 'a, b' }, { expr: 'junta(["a", "b"], "-")', saida: 'a-b' }, { expr: 'junta(5)', saida: '' },
  ] },
  { nome: 'texto', tipo: 'funcao', assinatura: 'texto(x) → texto', descricao: 'Converte em texto; ausente, lista e objeto viram vazio (nunca "[object Object]").', exemplos: [
    { expr: 'texto(12)', saida: '12' }, { expr: 'texto(null)', saida: '' }, { expr: 'texto([1])', saida: '' }, { expr: 'texto(true)', saida: 'true' },
  ], leis: [{ expr: 'texto(texto(a)) == texto(a)', gera: { a: 'escalar' } }] },
  { nome: 'numero', tipo: 'funcao', assinatura: 'numero(x, casas = 0) → texto', descricao: 'Formata em pt-BR (milhar com ponto, decimal com vírgula), com até `casas` decimais (0 a 10). Não numérico dá vazio.', exemplos: [
    { expr: 'numero(1234.567)', saida: '1.235' }, { expr: 'numero(1234.5, 1)', saida: '1.234,5' }, { expr: 'numero("x")', saida: '' },
  ] },
  { nome: 'arredonda', tipo: 'funcao', assinatura: 'arredonda(x, casas = 0) → número', descricao: 'Arredonda para `casas` decimais (0 a 10); aceita número em texto. Não numérico é ausente.', exemplos: [
    { expr: 'arredonda(2.456, 2)', saida: 2.46 }, { expr: 'arredonda("3.7")', saida: 4 }, { expr: 'arredonda("x")', indefinido: U },
  ], leis: [{ expr: 'arredonda(arredonda(a, 2), 2) == arredonda(a, 2)', gera: { a: 'numero' } }] },
  { nome: 'piso', tipo: 'funcao', assinatura: 'piso(x) → número', descricao: 'Maior inteiro ≤ x.', exemplos: [{ expr: 'piso(-1.5)', saida: -2 }, { expr: 'piso(2.9)', saida: 2 }], leis: [{ expr: 'piso(a) <= a', gera: { a: 'numero' } }, { expr: 'piso(piso(a)) == piso(a)', gera: { a: 'numero' } }] },
  { nome: 'teto', tipo: 'funcao', assinatura: 'teto(x) → número', descricao: 'Menor inteiro ≥ x.', exemplos: [{ expr: 'teto(1.2)', saida: 2 }], leis: [{ expr: 'a <= teto(a)', gera: { a: 'numero' } }, { expr: 'teto(a) - piso(a) <= 1', gera: { a: 'numero' } }] },
  { nome: 'absoluto', tipo: 'funcao', assinatura: 'absoluto(x) → número', descricao: 'Valor absoluto.', exemplos: [{ expr: 'absoluto(-3)', saida: 3 }], leis: [{ expr: 'absoluto(a) >= 0', gera: { a: 'numero' } }, { expr: 'absoluto(absoluto(a)) == absoluto(a)', gera: { a: 'numero' } }] },
  { nome: 'minimo', tipo: 'funcao', assinatura: 'minimo(x, …) → número', descricao: 'Menor de 1 a 16 números; se algum não é numérico, ausente.', exemplos: [{ expr: 'minimo(3, 1, 2)', saida: 1 }, { expr: 'minimo(1, "x")', indefinido: U }], leis: [
    { expr: 'minimo(a, b) == minimo(b, a)', gera: { a: 'numero', b: 'numero' } }, { expr: 'minimo(minimo(a, b), c) == minimo(a, minimo(b, c))', gera: { a: 'numero', b: 'numero', c: 'numero' } },
    { expr: 'minimo(a, a) == a', gera: { a: 'numero' } }, { expr: 'minimo(a, b) <= maximo(a, b)', gera: { a: 'numero', b: 'numero' } },
  ] },
  { nome: 'maximo', tipo: 'funcao', assinatura: 'maximo(x, …) → número', descricao: 'Maior de 1 a 16 números.', exemplos: [{ expr: 'maximo(3, 1, 2)', saida: 3 }], leis: [
    { expr: 'maximo(a, b) == maximo(b, a)', gera: { a: 'numero', b: 'numero' } }, { expr: 'maximo(maximo(a, b), c) == maximo(a, maximo(b, c))', gera: { a: 'numero', b: 'numero', c: 'numero' } },
  ] },
  { nome: 'padrao', tipo: 'funcao', assinatura: 'padrao(x, d) → qualquer', descricao: 'Troca por `d` apenas `null`, ausente e `""` (diferente de `??`, que mantém o `""`); `0` e `false` ficam.', exemplos: [
    { expr: 'padrao(null, "x")', saida: 'x' }, { expr: 'padrao("", "x")', saida: 'x' }, { expr: 'padrao(0, 5)', saida: 0 },
  ], leis: [{ expr: 'padrao(padrao(a, b), c) == padrao(a, padrao(b, c))', gera: { a: 'escalar', b: 'escalar', c: 'escalar' } }] },
  { nome: 'brl', tipo: 'funcao', assinatura: 'brl(x) → texto', descricao: 'Moeda em reais (pt-BR), sempre 2 casas. Só para EXIBIR: o cálculo de dinheiro não usa ponto flutuante.', exemplos: [{ expr: 'brl(1234.5)', saida: 'R$ 1.234,50' }, { expr: 'brl("x")', saida: '' }] },
  { nome: 'pct', tipo: 'funcao', assinatura: 'pct(x, casas = 0) → texto', descricao: 'Fração como porcentagem (0,256 → 25,6%).', exemplos: [{ expr: 'pct(0.256, 1)', saida: '25,6%' }, { expr: 'pct(0.5)', saida: '50%' }] },
  { nome: 'data', tipo: 'funcao', assinatura: 'data(x) → texto', descricao: 'Data em dd/mm/aaaa. "AAAA-MM-DD" puro não escorrega de dia; instantes usam o fuso de São Paulo.', exemplos: [{ expr: 'data("2026-06-08")', saida: '08/06/2026' }, { expr: 'data("lixo")', saida: '' }] },
  { nome: 'dataHora', tipo: 'funcao', assinatura: 'dataHora(x) → texto', descricao: 'Data e hora curtas no fuso de São Paulo (idêntico no servidor e no cliente).', exemplos: [{ expr: 'dataHora("2026-06-08T15:30:00Z")', saida: '08/06/2026, 12:30' }] },

  // ---- aritmética exata (ℚ) -----------------------------------------------------
  // Valores = TEXTO canônico: "12", "-3/4" (reduzido, denominador > 1). Entradas: inteiro, decimal ("12.34", "1e3"), fração ou número JS.
  // Nada arredonda sozinho; ausente = entrada inválida, divisão por zero ou resultado acima de 1000 dígitos.
  { nome: 'racional', tipo: 'funcao', assinatura: 'racional(x) → texto canônico', descricao: 'Normaliza para a CLASSE do número: fração reduzida, denominador positivo, inteiro sem "/1". Duas entradas que valem o mesmo número dão o MESMO texto, então `==` compara números exatos. Número JS entra pelo texto mais curto (0.1 vira 1/10).', exemplos: [
    { expr: 'racional("2/4")', saida: '1/2' }, { expr: 'racional("0.50")', saida: '1/2' }, { expr: 'racional("1e3")', saida: '1000' }, { expr: 'racional(0.1)', saida: '1/10' }, { expr: 'racional("-0")', saida: '0' }, { expr: 'racional("6/-4")', indefinido: U }, { expr: 'racional("1/0")', indefinido: U }, { expr: 'racional("x")', indefinido: U },
  ], leis: [{ expr: 'racional(racional(a)) == racional(a)', gera: { a: 'racional' } }, { expr: 'racional(qneg(qneg(a))) == racional(a)', gera: { a: 'racional' } }] },
  { nome: 'qsoma', tipo: 'funcao', assinatura: 'qsoma(a, b, …) → racional   (1 a 16 operandos)', descricao: 'Soma exata (⊕ cruzado: a·d + b·c sobre b·d, reduzido). Qualquer operando inválido torna o resultado ausente.', exemplos: [
    { expr: 'qsoma("0.1", "0.2")', saida: '3/10' }, { expr: 'qsoma("1/3", "1/6")', saida: '1/2' }, { expr: 'qsoma(1, 2, 3)', saida: '6' }, { expr: 'qsoma("0.1", "x")', indefinido: U },
  ], leis: [
    { expr: 'qsoma(a, b) == qsoma(b, a)', gera: { a: 'racional', b: 'racional' } }, { expr: 'qsoma(qsoma(a, b), c) == qsoma(a, qsoma(b, c))', gera: { a: 'racional', b: 'racional', c: 'racional' } },
    { expr: 'qsoma(a, 0) == racional(a)', gera: { a: 'racional' } }, { expr: 'qsoma(a, qneg(a)) == "0"', gera: { a: 'racional' } },
  ], naoLeis: ['Ao contrário de `+` (ponto flutuante), `qsoma` É associativa e exata: 0,1 + 0,2 = 3/10, sempre.'] },
  { nome: 'qsub', tipo: 'funcao', assinatura: 'qsub(a, b) → racional', descricao: 'Diferença exata.', exemplos: [{ expr: 'qsub("1/2", "1/3")', saida: '1/6' }, { expr: 'qsub(5, 5)', saida: '0' }], leis: [{ expr: 'qsub(a, a) == "0"', gera: { a: 'racional' } }, { expr: 'qsoma(qsub(a, b), b) == racional(a)', gera: { a: 'racional', b: 'racional' } }] },
  { nome: 'qmul', tipo: 'funcao', assinatura: 'qmul(a, b, …) → racional   (1 a 16 operandos)', descricao: 'Produto exato (⊗ por componentes: a·c sobre b·d, reduzido).', exemplos: [{ expr: 'qmul("2/3", "3/4")', saida: '1/2' }, { expr: 'qmul("0.1", "0.1")', saida: '1/100' }, { expr: 'qmul(1, 2, 3, 4)', saida: '24' }], leis: [
    { expr: 'qmul(a, b) == qmul(b, a)', gera: { a: 'racional', b: 'racional' } }, { expr: 'qmul(qmul(a, b), c) == qmul(a, qmul(b, c))', gera: { a: 'racional', b: 'racional', c: 'racional' } },
    { expr: 'qmul(a, 1) == racional(a)', gera: { a: 'racional' } }, { expr: 'qmul(a, 0) == "0"', gera: { a: 'racional' } },
    { expr: 'qmul(a, qsoma(b, c)) == qsoma(qmul(a, b), qmul(a, c))', gera: { a: 'racional', b: 'racional', c: 'racional' } },
  ] },
  { nome: 'qdiv', tipo: 'funcao', assinatura: 'qdiv(a, b) → racional', descricao: 'Quociente exato. Divisão por zero é ausente: o preço do andar ℚ, que torna a divisão total exceto no zero.', exemplos: [{ expr: 'qdiv(1, 3)', saida: '1/3' }, { expr: 'qdiv(6, -4)', saida: '-3/2' }, { expr: 'qdiv(1, 0)', indefinido: U }], leis: [{ expr: 'racional(b) == "0" || qdiv(qmul(a, b), b) == racional(a)', gera: { a: 'racional', b: 'racional' } }] },
  { nome: 'qresto', tipo: 'funcao', assinatura: 'qresto(a, b) → racional', descricao: 'Resto matemático a − b·⌊a/b⌋: tem o sinal de `b` (diferente de `%`, que tem o do dividendo). Vale para racionais.', exemplos: [{ expr: 'qresto(7, 3)', saida: '1' }, { expr: 'qresto(-7, 3)', saida: '2' }, { expr: 'qresto(7, -3)', saida: '-2' }, { expr: 'qresto("5.5", 2)', saida: '3/2' }, { expr: 'qresto(1, 0)', indefinido: U }], leis: [{ expr: 'racional(b) == "0" || qcmp(qresto(a, b), 0) == 0 || qcmp(qresto(a, b), 0) == qcmp(b, 0)', gera: { a: 'racional', b: 'racional' } }] },
  { nome: 'qneg', tipo: 'funcao', assinatura: 'qneg(x) → racional', descricao: 'Oposto exato do número (zero continua zero, sem sinal).', exemplos: [{ expr: 'qneg("1/2")', saida: '-1/2' }, { expr: 'qneg(0)', saida: '0' }] },
  { nome: 'qabs', tipo: 'funcao', assinatura: 'qabs(x) → racional', descricao: 'Valor absoluto.', exemplos: [{ expr: 'qabs("-3/4")', saida: '3/4' }], leis: [{ expr: 'qcmp(qabs(a), 0) >= 0', gera: { a: 'racional' } }, { expr: 'qabs(qmul(a, b)) == qmul(qabs(a), qabs(b))', gera: { a: 'racional', b: 'racional' } }] },
  { nome: 'qcmp', tipo: 'funcao', assinatura: 'qcmp(a, b) → -1 | 0 | 1', descricao: 'Compara SEM dividir (produto cruzado a·d × c·b). Ordem total.', exemplos: [{ expr: 'qcmp("1/3", "0.33")', saida: 1 }, { expr: 'qcmp("1/2", "0.5")', saida: 0 }, { expr: 'qcmp(1, 2)', saida: -1 }], leis: [
    { expr: 'qcmp(a, b) == -qcmp(b, a)', gera: { a: 'racional', b: 'racional' } }, { expr: 'qcmp(a, a) == 0', gera: { a: 'racional' } },
    { expr: '!(qcmp(a, b) < 0 && qcmp(b, c) < 0) || qcmp(a, c) < 0', gera: { a: 'racional', b: 'racional', c: 'racional' } },
    { expr: '!(qcmp(a, b) < 0) || qcmp(qsoma(a, c), qsoma(b, c)) < 0', gera: { a: 'racional', b: 'racional', c: 'racional' } },
    { expr: '(qcmp(a, b) == 0) == (racional(a) == racional(b))', gera: { a: 'racional', b: 'racional' } },
  ] },
  { nome: 'qpot', tipo: 'funcao', assinatura: 'qpot(x, k) → racional   (k inteiro, |k| ≤ 1000)', descricao: 'Potência inteira exata; expoente negativo inverte (base zero é ausente). Resultado acima do teto de 1000 dígitos é ausente (cortado ANTES de calcular).', exemplos: [{ expr: 'qpot(2, 10)', saida: '1024' }, { expr: 'qpot("2/3", 2)', saida: '4/9' }, { expr: 'qpot(2, -2)', saida: '1/4' }, { expr: 'qpot(10, 1000)', indefinido: U }, { expr: 'qpot(0, -1)', indefinido: U }], leis: [{ expr: 'qpot(a, 0) == "1"', gera: { a: 'racional' } }, { expr: 'qmul(qpot(a, 2), qpot(a, 3)) == qpot(a, 5)', gera: { a: 'racional' } }] },
  { nome: 'qpiso', tipo: 'funcao', assinatura: 'qpiso(x) → inteiro (texto)', descricao: 'Maior inteiro ≤ x, sem passar por double.', exemplos: [{ expr: 'qpiso("7/2")', saida: '3' }, { expr: 'qpiso("-7/2")', saida: '-4' }], leis: [{ expr: 'qcmp(qpiso(a), a) <= 0 && qcmp(a, qsoma(qpiso(a), 1)) < 0', gera: { a: 'racional' } }] },
  { nome: 'qnumerador', tipo: 'funcao', assinatura: 'qnumerador(x) → inteiro (texto)', descricao: 'Numerador da classe reduzida (leva o sinal).', exemplos: [{ expr: 'qnumerador("6/4")', saida: '3' }, { expr: 'qnumerador("-0.5")', saida: '-1' }] },
  { nome: 'qdenominador', tipo: 'funcao', assinatura: 'qdenominador(x) → inteiro (texto)', descricao: 'Denominador da classe reduzida (sempre positivo; 1 para inteiros).', exemplos: [{ expr: 'qdenominador("6/4")', saida: '2' }, { expr: 'qdenominador(5)', saida: '1' }], leis: [{ expr: 'qdiv(qnumerador(a), qdenominador(a)) == racional(a)', gera: { a: 'racional' } }] },
  { nome: 'qmdc', tipo: 'funcao', assinatura: 'qmdc(a, b) → inteiro (texto)', descricao: 'Máximo divisor comum de DOIS INTEIROS (racional não inteiro é ausente). mdc(0, 0) = 0.', exemplos: [{ expr: 'qmdc(12, 18)', saida: '6' }, { expr: 'qmdc(0, 0)', saida: '0' }, { expr: 'qmdc("1/2", 2)', indefinido: U }, { expr: 'qmdc(-4, 6)', saida: '2' }] },
  { nome: 'qmmc', tipo: 'funcao', assinatura: 'qmmc(a, b) → inteiro (texto)', descricao: 'Mínimo múltiplo comum de dois inteiros (zero se algum for zero).', exemplos: [{ expr: 'qmmc(4, 6)', saida: '12' }, { expr: 'qmmc(0, 5)', saida: '0' }], leis: [{ expr: 'qmul(qmdc(a, b), qmmc(a, b)) == qabs(qmul(a, b))', gera: { a: 'inteiro', b: 'inteiro' } }] },
  { nome: 'qmin', tipo: 'funcao', assinatura: 'qmin(a, b, …) → racional', descricao: 'Menor dos operandos, exato.', exemplos: [{ expr: 'qmin("1/2", "1/3")', saida: '1/3' }], leis: [{ expr: 'qcmp(qmin(a, b), qmax(a, b)) <= 0', gera: { a: 'racional', b: 'racional' } }] },
  { nome: 'qmax', tipo: 'funcao', assinatura: 'qmax(a, b, …) → racional', descricao: 'Maior dos operandos, exato.', exemplos: [{ expr: 'qmax("1/2", "1/3")', saida: '1/2' }] },
  { nome: 'qdec', tipo: 'funcao', assinatura: 'qdec(x, casas = 2, modo = "longe") → texto decimal', descricao: 'ÚNICO lugar onde se arredonda: texto decimal com exatamente `casas` (0 a 100) dígitos fracionários. Modos: `longe` (meio para longe do zero: arredondamento comercial), `par` (meio para o par), `zero` (trunca), `baixo` (⌊⌋), `cima` (⌈⌉). Sem passar por double: 2.675 → 2.68 (o toFixed do JavaScript dá 2.67).', exemplos: [
    { expr: 'qdec("1/3", 4)', saida: '0.3333' }, { expr: 'qdec("2.675", 2)', saida: '2.68' }, { expr: 'qdec("2.665", 2, "par")', saida: '2.66' }, { expr: 'qdec("2.665", 2)', saida: '2.67' },
    { expr: 'qdec("-2.5", 0, "baixo")', saida: '-3' }, { expr: 'qdec("-2.5", 0, "cima")', saida: '-2' }, { expr: 'qdec("-2.5", 0, "zero")', saida: '-2' }, { expr: 'qdec("-2.5", 0)', saida: '-3' },
    { expr: 'qdec("-0.001", 2)', saida: '0.00' }, { expr: 'qdec(5)', saida: '5.00' }, { expr: 'qdec(1, 2, "xx")', indefinido: U }, { expr: 'qdec(1, 101)', indefinido: U },
  ], leis: [
    { expr: 'qcmp(qdec(a, absoluto(k) % 8, "baixo"), a) <= 0', gera: { a: 'racional', k: 'inteiro' } }, { expr: 'qcmp(qdec(a, absoluto(k) % 8, "cima"), a) >= 0', gera: { a: 'racional', k: 'inteiro' } },
    { expr: 'qcmp(qabs(qsub(qdec(a, absoluto(k) % 8), a)), qdiv(1, qmul(2, qpot(10, absoluto(k) % 8)))) <= 0', gera: { a: 'racional', k: 'inteiro' } },
    { expr: 'qcmp(qabs(qsub(qdec(a, absoluto(k) % 8, "par"), a)), qdiv(1, qmul(2, qpot(10, absoluto(k) % 8)))) <= 0', gera: { a: 'racional', k: 'inteiro' } },
    { expr: 'qcmp(qabs(qsub(qdec(a, absoluto(k) % 8, "zero"), a)), qdiv(1, qpot(10, absoluto(k) % 8))) < 0', gera: { a: 'racional', k: 'inteiro' } },
    { expr: 'qdec(qdec(a, absoluto(k) % 8, "par"), absoluto(k) % 8, "par") == qdec(a, absoluto(k) % 8, "par")', gera: { a: 'racional', k: 'inteiro' } },
    { expr: 'racional(qdec(a, 4)) == racional(a)', gera: { a: 'decimal' } },
  ] },
  { nome: 'qformata', tipo: 'funcao', assinatura: 'qformata(x, casas = 2, modo = "longe") → texto pt-BR', descricao: 'Como `qdec`, formatado em pt-BR (milhar com ponto, decimal com vírgula), exato e sem Intl.', exemplos: [{ expr: 'qformata("1234567.891")', saida: '1.234.567,89' }, { expr: 'qformata("-1234.5")', saida: '-1.234,50' }, { expr: 'qformata("0.5", 0, "par")', saida: '0' }] },
  { nome: 'qbrl', tipo: 'funcao', assinatura: 'qbrl(x) → texto', descricao: 'Reais com 2 casas, arredondamento comercial (`longe`), exato. Igual a `brl` onde o double é exato; correto onde o double não é.', exemplos: [{ expr: 'qbrl("1234.5")', saida: 'R$ 1.234,50' }, { expr: 'qbrl("-0.005")', saida: '-R$ 0,01' }, { expr: 'qbrl("0.1") == brl(0.1)', saida: true }], leis: [{ expr: 'qbrl(a) == brl(qnum(qdec(a, 2)))', gera: { a: 'decimal' } }] },
  { nome: 'qnum', tipo: 'funcao', assinatura: 'qnum(x) → número', descricao: 'Aproximação em double (arredondada corretamente quando numerador e denominador cabem em 53 bits). Use só para exibir ou desenhar; nunca para calcular dinheiro.', exemplos: [{ expr: 'qnum("1/4")', saida: 0.25 }, { expr: 'qnum("1/3")', saida: 1 / 3 }] },

  // ---- árvore de estado imutável, por caminho ------------------------------------
  // Caminho = lista de chaves (texto) e índices (inteiro ≥ 0): ["itens", 0, "nome"]. Nada muta a entrada; só o caminho é copiado, o resto é a MESMA
  // referência; se nada muda, volta a MESMA referência. Caminho inválido, tipo errado e índice fora do alcance são ausentes.
  { nome: 'obter', tipo: 'funcao', assinatura: 'obter(x, caminho, padrão?) → valor', descricao: 'Valor no caminho; se não existe (ou é null), o padrão (ausente se omitido). Equivale a `x.a[0].b`, mas com caminho calculado.', exemplos: [
    { expr: 'obter(x, ["a", 1, "b"])', esc: { x: { a: [0, { b: 7 }] } }, saida: 7 }, { expr: 'obter(x, ["z"], "nada")', esc: { x: {} }, saida: 'nada' }, { expr: 'obter(x, [])', esc: { x: 5 }, saida: 5 }, { expr: 'obter(x, ["a", "__proto__"])', esc: { x: { a: {} } }, indefinido: U },
  ], leis: [{ expr: 'igual(obter(x, []), x) || x == null', gera: { x: 'json' } }] },
  { nome: 'com', tipo: 'funcao', assinatura: "com(x, caminho, valor) → x'", descricao: 'Nova árvore com o valor no caminho. Cria o que falta (texto → objeto; índice 0 → lista; índice = tamanho → anexa); índice além disso é ausente. Só o caminho é copiado; se o valor já é o mesmo, devolve a mesma referência. Chaves `__proto__`, `constructor` e `prototype` e caminhos com mais de 64 passos são recusados.', exemplos: [
    { expr: 'com(x, ["a", "b"], 1)', esc: { x: { a: { c: 0 } } }, saida: { a: { c: 0, b: 1 } } }, { expr: 'com(x, [0, "n"], 1)', esc: { x: [] }, saida: [{ n: 1 }] }, { expr: 'com(x, [5], 1)', esc: { x: [] }, indefinido: U },
    { expr: 'com(x, ["a", "b"], 1)', esc: { x: { a: 1 } }, indefinido: U }, { expr: 'com(x, ["__proto__", "p"], 1)', esc: { x: {} }, indefinido: U },
  ], leis: [
    { expr: 'com(x, ["k", "v"], a) == null || igual(obter(com(x, ["k", "v"], a), ["k", "v"]), a) || a == null', gera: { x: 'json', a: 'json' } },
    { expr: 'com(x, ["k"], a) == null || igual(com(com(x, ["k"], a), ["k"], b), com(x, ["k"], b))', gera: { x: 'json', a: 'json', b: 'json' } },
  ] },
  { nome: 'sem', tipo: 'funcao', assinatura: "sem(x, caminho) → x'", descricao: 'Remove a chave (objeto) ou a posição (lista, os seguintes sobem). Já ausente: a mesma referência. Caminho vazio é ausente (a raiz não se remove).', exemplos: [
    { expr: 'sem(x, ["a"])', esc: { x: { a: 1, b: 2 } }, saida: { b: 2 } }, { expr: 'sem(x, ["l", 1])', esc: { x: { l: [1, 2, 3] } }, saida: { l: [1, 3] } }, { expr: 'sem(x, ["z"])', esc: { x: { a: 1 } }, saida: { a: 1 } }, { expr: 'sem(x, [])', esc: { x: 1 }, indefinido: U },
  ], leis: [{ expr: 'x == null || com(x, ["k"], a) == null || igual(sem(com(x, ["k"], a), ["k"]), sem(x, ["k"]))', gera: { x: 'json', a: 'json' } }] },
  { nome: 'atualiza', tipo: 'funcao', assinatura: "atualiza(x, caminho, v => novo) → x'", descricao: 'Troca o valor do caminho pelo que a função devolve a partir do valor atual (ausente se não existe). É `com(x, caminho, f(obter(x, caminho)))` numa passada só.', exemplos: [
    { expr: 'atualiza(x, ["n"], v => v + 1)', esc: { x: { n: 1, m: 2 } }, saida: { n: 2, m: 2 } }, { expr: 'atualiza(x, ["l"], l => concat(l, [9]))', esc: { x: { l: [1] } }, saida: { l: [1, 9] } }, { expr: 'atualiza(x, ["itens", 1, "ok"], v => !v)', esc: { x: { itens: [{ ok: true }, { ok: false }] } }, saida: { itens: [{ ok: true }, { ok: true }] } },
  ], leis: [{ expr: '!contem(chaves(o), "a") || igual(atualiza(o, ["a"], v => v), o)', gera: { o: 'objeto' } }] },
  { nome: 'insere', tipo: 'funcao', assinatura: 'insere(lista, i, valor) → lista', descricao: 'Insere na posição `i` (0 a tamanho), empurrando os seguintes. Fora disso, ausente.', exemplos: [{ expr: 'insere([1, 2], 1, 9)', saida: [1, 9, 2] }, { expr: 'insere([1, 2], 2, 9)', saida: [1, 2, 9] }, { expr: 'insere([1, 2], 3, 9)', indefinido: U }], leis: [{ expr: 'i > tamanho(l) || igual(sem(insere(l, i, v), [i]), l)', gera: { l: 'lista', i: 'indice', v: 'escalar' } }] },
  { nome: 'move', tipo: 'funcao', assinatura: 'move(lista, de, para) → lista', descricao: 'Move o item da posição `de` para a posição `para` (ambas existentes). Mesma posição: a mesma referência.', exemplos: [{ expr: 'move([1, 2, 3, 4], 0, 2)', saida: [2, 3, 1, 4] }, { expr: 'move([1, 2, 3, 4], 3, 0)', saida: [4, 1, 2, 3] }, { expr: 'move([1], 0, 1)', indefinido: U }], leis: [{ expr: 'i >= tamanho(l) || j >= tamanho(l) || igual(move(move(l, i, j), j, i), l)', gera: { l: 'lista', i: 'indice', j: 'indice' } }] },
  { nome: 'mescla', tipo: 'funcao', assinatura: 'mescla(a, b) → objeto', descricao: 'Mescla RASA de dois objetos: as chaves de `b` valem sobre as de `a`. Nada muda: a mesma referência. Chaves proibidas em `b` são ausente.', exemplos: [{ expr: 'mescla(a, b)', esc: { a: { x: 1, y: 2 }, b: { y: 3, z: 4 } }, saida: { x: 1, y: 3, z: 4 } }, { expr: 'mescla(a, 5)', esc: { a: {} }, indefinido: U }], leis: [
    { expr: 'igual(mescla(mescla(a, b), c), mescla(a, mescla(b, c)))', gera: { a: 'objeto', b: 'objeto', c: 'objeto' } }, { expr: 'mescla(a, a) == null || igual(mescla(a, a), a)', gera: { a: 'objeto' } },
  ] },
  { nome: 'difere', tipo: 'funcao', assinatura: 'difere(a, b) → lista de patches', descricao: 'Patches (estilo JSON Patch, reversíveis) que levam `a` a `b`: `{op: "add"|"remove"|"replace", caminho, valor?, antes?}`. Pula subárvores com a mesma referência: o custo é proporcional ao que mudou. Remoções de lista vêm do fim para o começo. Mais de 100 000 patches é ausente.', exemplos: [
    { expr: 'difere(a, b)', esc: { a: { x: 1, y: 2 }, b: { x: 1, y: 3, z: 4 } }, saida: [{ op: 'replace', caminho: ['y'], valor: 3, antes: 2 }, { op: 'add', caminho: ['z'], valor: 4 }] },
    { expr: 'difere(a, b)', esc: { a: { l: [1, 2, 3] }, b: { l: [1] } }, saida: [{ op: 'remove', caminho: ['l', 2], antes: 3 }, { op: 'remove', caminho: ['l', 1], antes: 2 }] },
  ], leis: [{ expr: 'tamanho(difere(a, a)) == 0', gera: { a: 'json' } }, { expr: 'igual(aplica(a, difere(a, b)), b)', gera: { a: 'json', b: 'json' } }] },
  { nome: 'aplica', tipo: 'funcao', assinatura: "aplica(x, patches) → x'", descricao: 'Aplica os patches em sequência. Atômico: qualquer patch inválido (forma, caminho, tipo) torna o resultado ausente e nada é aplicado.', exemplos: [
    { expr: 'aplica(a, difere(a, b))', esc: { a: { x: 1 }, b: { x: 2, y: [1] } }, saida: { x: 2, y: [1] } }, { expr: 'aplica(a, ps)', esc: { a: {}, ps: [{ op: 1 }] }, indefinido: U },
  ] },
  { nome: 'paraNumero', tipo: 'funcao', assinatura: 'paraNumero(x) → número', descricao: 'Texto → número (o inverso de `numero`/`texto`): decimal com ponto, ou com vírgula pt-BR (que vale como ponto), com sinal e expoente opcionais. Número finito passa. Vazio, espaço solto, hexadecimal, `Infinity`, ponto e vírgula juntos, ou mais de 64 caracteres: ausente.', exemplos: [
    { expr: 'paraNumero("12")', saida: 12 }, { expr: 'paraNumero(" 2,5 ")', saida: 2.5 }, { expr: 'paraNumero("-1e3")', saida: -1000 }, { expr: 'paraNumero(".5")', saida: 0.5 }, { expr: 'paraNumero(7)', saida: 7 },
    { expr: 'paraNumero("")', indefinido: U }, { expr: 'paraNumero("0x10")', indefinido: U }, { expr: 'paraNumero("1,234.5")', indefinido: U }, { expr: 'paraNumero("abc")', indefinido: U }, { expr: 'paraNumero(true)', indefinido: U },
  ], leis: [{ expr: 'paraNumero(x) == null || paraNumero(texto(paraNumero(x))) == paraNumero(x)', gera: { x: 'numero' } }] },
  { nome: 'analisaJson', tipo: 'funcao', assinatura: 'analisaJson(texto) → valor', descricao: 'JSON em texto → valor (o inverso de `paraJson`). Até 200 KB; as chaves `__proto__`, `constructor` e `prototype` somem; texto vazio ou JSON ruim é ausente.', exemplos: [
    { expr: 'analisaJson("{\\"a\\":[1,2]}")', saida: { a: [1, 2] } }, { expr: 'analisaJson("[1, \\"x\\", true, null]")', saida: [1, 'x', true, null] }, { expr: 'analisaJson("3")', saida: 3 },
    { expr: 'analisaJson("{ruim")', indefinido: U }, { expr: 'analisaJson("")', indefinido: U }, { expr: 'analisaJson(1)', indefinido: U }, { expr: 'analisaJson("{\\"__proto__\\":{\\"x\\":1},\\"ok\\":1}")', saida: { ok: 1 } },
  ], leis: [{ expr: 'igual(analisaJson(paraJson(x, 0)), x)', gera: { x: 'json' } }] },
  { nome: 'paraJson', tipo: 'funcao', assinatura: 'paraJson(valor, indentacao?) → texto', descricao: 'Valor → JSON em texto, com `indentacao` espaços (0 a 8; padrão 2). Até 200 KB; fora disso é ausente.', exemplos: [
    { expr: 'paraJson(x, 0)', esc: { x: { a: [1, 2], b: 'z' } }, saida: '{"a":[1,2],"b":"z"}' }, { expr: 'paraJson(x)', esc: { x: { a: 1 } }, saida: '{\n  "a": 1\n}' }, { expr: 'paraJson(x, 9)', esc: { x: 1 }, indefinido: U },
  ] },
  { nome: 'divide', tipo: 'funcao', assinatura: 'divide(texto, separador) → lista de textos', descricao: 'Divide pelo separador (não vazio): o inverso de `junta`. Até 1000 pedaços e 100 KB; fora disso é ausente.', exemplos: [
    { expr: 'divide("a|b|c", "|")', saida: ['a', 'b', 'c'] }, { expr: 'divide("sem", "|")', saida: ['sem'] }, { expr: 'divide("a||b", "|")', saida: ['a', '', 'b'] }, { expr: 'divide("a", "")', indefinido: U }, { expr: 'divide(1, ",")', indefinido: U },
  ], leis: [{ expr: 'junta(divide(x, ","), ",") == x', gera: { x: 'texto' } }] },
  { nome: 'validaFormulario', tipo: 'funcao', assinatura: 'validaFormulario(definicao, valores, idioma?) → { ok, erros, valores }', descricao: 'O validador do `kind: formulario` (o mesmo do servidor): normaliza os `valores` crus e devolve os erros por campo (`{ campo, regra, mensagem }`) na língua pedida. Definição sem `campos` ou valores que não são objeto: ausente.', exemplos: [
    { expr: 'validaFormulario(f, v).ok', esc: { f: { campos: [{ nome: 'a', tipo: 'texto', obrigatorio: true }] }, v: { a: 'oi' } }, saida: true },
    { expr: 'validaFormulario(f, v).erros[0].mensagem', esc: { f: { campos: [{ nome: 'a', tipo: 'texto', obrigatorio: true }] }, v: {} }, saida: 'A é obrigatório.' },
    { expr: 'validaFormulario(f, v, "en").erros[0].mensagem', esc: { f: { campos: [{ nome: 'a', tipo: 'texto', obrigatorio: true }] }, v: {} }, saida: 'A is required.' },
    { expr: 'validaFormulario(f, v).valores.cpf', esc: { f: { campos: [{ nome: 'cpf', tipo: 'cpf', mascara: { padrao: '000.000.000-00' } }] }, v: { cpf: '529.982.247-25' } }, saida: '52998224725' },
    { expr: 'validaFormulario(1, v)', esc: { v: {} }, indefinido: U }, { expr: 'validaFormulario(f, 1)', esc: { f: { campos: [] } }, indefinido: U },
  ] },
  { nome: 'percorre', tipo: 'funcao', assinatura: 'percorre(raiz, chave) → lista de { caminho, no, nivel }', descricao: 'Todos os nós de uma árvore em pré-ordem. Os filhos de um nó estão em `no[chave]`: uma lista de nós, ou um objeto cujas chaves levam a listas de nós (slots). `caminho` é o do nó DENTRO do documento, pronto para `obter`, `com`, `sem` e `insere`. Entrada que não é objeto, ou árvore grande demais, é ausente.', exemplos: [
    { expr: 'mapeia(percorre(r, "filhos"), n => n.no.id)', esc: { r: { id: "a", filhos: [{ id: "b" }, { id: "c", filhos: [{ id: "d" }] }] } }, saida: ['a', 'b', 'c', 'd'] },
    { expr: 'mapeia(percorre(r, "slots"), n => n.caminho)', esc: { r: { id: 'a', slots: { x: [{ id: 'b' }] } } }, saida: [[], ['slots', 'x', 0]] },
    { expr: 'mapeia(percorre(r, "filhos"), n => n.nivel)', esc: { r: { filhos: [{ filhos: [{}] }, {}] } }, saida: [0, 1, 2, 1] },
    { expr: 'percorre(5, "filhos")', indefinido: U }, { expr: 'percorre(r, "__proto__")', esc: { r: {} }, indefinido: U },
  ], leis: [{ expr: 'igual(percorre(r, "filhos")[0].no, r)', gera: { r: 'objeto' } }, { expr: 'percorre(r, "filhos")[0].nivel == 0', gera: { r: 'objeto' } }] },
  { nome: 'camposDoSchema', tipo: 'funcao', assinatura: 'camposDoSchema(schema) → lista de campos', descricao: 'Os campos de um JSON Schema de objeto, na ordem de declaração, com objetos aninhados achatados (caminho completo; rótulo `Pai › Filho`): `{ nome, caminho, rotulo, tipo, obrigatorio, descricao?, padrao?, opcoes?, min?, max?, regex? }`. `tipo` é texto, numero, inteiro, booleano, escolha ou json (o que o schema não descreve com simplicidade vira json: nunca some). O `title` do schema vale como rótulo. Serve para gerar formulários.', exemplos: [
    { expr: 'mapeia(camposDoSchema(s), c => c.tipo)', esc: { s: { type: 'object', properties: { a: { type: 'string' }, n: { type: 'integer', minimum: 1 }, b: { type: 'boolean' }, e: { enum: ['x', 'y'] }, z: { oneOf: [{ type: 'string' }, { type: 'number' }] } } } }, saida: ['texto', 'inteiro', 'booleano', 'escolha', 'json'] },
    { expr: 'mapeia(camposDoSchema(s), c => c.caminho)', esc: { s: { type: 'object', properties: { o: { type: 'object', properties: { x: { type: 'number' } } } } } }, saida: [['o', 'x']] },
    { expr: 'camposDoSchema(s)[0].rotulo', esc: { s: { type: 'object', properties: { nivel: { type: 'integer' } } } }, saida: 'Nível' },
    { expr: 'camposDoSchema(s)[0].obrigatorio', esc: { s: { type: 'object', required: ['t'], properties: { t: { type: 'string', title: 'Texto' } } } }, saida: true },
    { expr: 'camposDoSchema(5)', indefinido: U },
  ] },
  { nome: 'inverso', tipo: 'funcao', assinatura: 'inverso(patches) → patches', descricao: 'Os patches que DESFAZEM: ordem inversa, `add` ↔ `remove`, `replace` troca `valor` e `antes`. Exige o valor antigo nos patches (os de `difere` já o trazem).', exemplos: [
    { expr: 'inverso(difere(a, b))', esc: { a: { x: 1 }, b: { x: 2 } }, saida: [{ op: 'replace', caminho: ['x'], valor: 1, antes: 2 }] },
  ], leis: [{ expr: 'igual(aplica(b, inverso(difere(a, b))), a)', gera: { a: 'json', b: 'json' } }] },
]

export const defDe = (nome: string): Def | undefined => REGISTRO.find((d) => d.nome === nome)
