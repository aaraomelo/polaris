// ---------------------------------------------------------------------------
// REGISTRO: a única tabela que descreve a linguagem. De cada função, operador e forma saem, sem repetição:
//   - a documentação (docs/funcoes.md, gerada por `pnpm docs:funcoes`);
//   - os exemplos, que são EXECUTADOS nos testes (documentação que não mente);
//   - as leis algébricas, que são propriedades testadas por geração aleatória (e as NÃO-leis, ditas com franqueza).
// Uma função nova só entra em FUNCOES_PADRAO se tiver entrada aqui (teste de completude).
// ---------------------------------------------------------------------------

export type Gerador = 'texto' | 'numero' | 'inteiro' | 'escalar' | 'lista' | 'qualquer'

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
  { nome: 'tamanho', tipo: 'funcao', assinatura: 'tamanho(x) → número', descricao: 'Comprimento de texto ou lista; número de chaves de objeto; 0 para o resto.', exemplos: [
    { expr: 'tamanho("abc")', saida: 3 }, { expr: 'tamanho([1, 2])', saida: 2 }, { expr: 'tamanho(o)', esc: { o: { a: 1, b: 2 } }, saida: 2 }, { expr: 'tamanho(null)', saida: 0 },
  ], leis: [{ expr: 'tamanho(a + b) == tamanho(a) + tamanho(b)', gera: { a: 'texto', b: 'texto' } }] },
  { nome: 'maiusculas', tipo: 'funcao', assinatura: 'maiusculas(x) → texto', descricao: 'Texto em maiúsculas (ausente vira vazio).', exemplos: [{ expr: 'maiusculas("olá")', saida: 'OLÁ' }, { expr: 'maiusculas(x)', esc: {}, saida: '' }], leis: [{ expr: 'maiusculas(maiusculas(a)) == maiusculas(a)', gera: { a: 'texto' } }] },
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
]

export const defDe = (nome: string): Def | undefined => REGISTRO.find((d) => d.nome === nome)
