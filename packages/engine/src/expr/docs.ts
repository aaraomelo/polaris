import { NIVEL, NIVEL_UNARIO } from './ast'
import { REGISTRO, type Def, type Exemplo } from './registro'

// Gera docs/funcoes.md a partir do REGISTRO. Determinístico: um teste confere que o arquivo commitado está em dia.

const visto = (e: Exemplo): string => (e.indefinido ? '_(ausente)_' : `\`${JSON.stringify(e.saida)}\``)
const celula = (s: string) => s.replace(/\|/g, '\\|')
const tabelaExemplos = (d: Def) => [
  '| Expressão | Escopo | Resultado |', '|---|---|---|',
  ...d.exemplos.map((e) => `| \`${celula(e.expr)}\` | ${e.esc && Object.keys(e.esc).length ? `\`${celula(JSON.stringify(e.esc))}\`` : ''} | ${celula(visto(e))} |`),
].join('\n')

function secao(d: Def): string {
  const partes = [`### \`${d.nome}\``, '', `\`${d.assinatura}\``, '', d.descricao, '', tabelaExemplos(d)]
  if (d.leis?.length) partes.push('', '**Leis** (testadas com entradas aleatórias):', ...d.leis.map((l) => `- \`${l.expr}\``))
  if (d.naoLeis?.length) partes.push('', '**Não vale:**', ...d.naoLeis.map((l) => `- ${l}`))
  return partes.join('\n')
}

export function geraDocFuncoes(): string {
  const niveis = new Map<number, string[]>()
  for (const [op, n] of Object.entries(NIVEL)) niveis.set(n, [...(niveis.get(n) ?? []), op])
  const precedencia = [
    '| Precedência | Operadores | Associa |', '|---|---|---|',
    '| 0 (menor) | `c ? a : b` | à direita |',
    ...[...niveis.entries()].sort((x, y) => x[0] - y[0]).map(([n, ops]) => `| ${n} | ${ops.map((o) => `\`${o.replace(/\|/g, '\\|')}\``).join(' ')} | à esquerda |`),
    `| ${NIVEL_UNARIO} | \`!\` \`-\` (prefixos) | — |`,
    '| 9 (maior) | `.campo` `[índice]` `f(args)` | à esquerda |',
  ].join('\n')
  const por = (t: Def['tipo']) => REGISTRO.filter((d) => d.tipo === t).map(secao).join('\n\n')
  return [
    '# Linguagem de expressões do Polaris — referência',
    '',
    '> Gerado por `pnpm docs:funcoes` a partir de `packages/engine/src/expr/registro.ts`. **Não edite à mão.**',
    '> Todo exemplo abaixo é executado nos testes; toda lei é verificada com entradas aleatórias.',
    '',
    'A linguagem é **pura** (sem efeitos), **total** (sempre termina: não há recursão nem laço aberto; a única iteração são os\ncombinadores sobre listas que já existem, sob um orçamento de passos) e **tolerante a ausente**',
    '(valor ausente propaga como ausente; nunca lança erro). Sem `eval`: o texto vira o AST abaixo, e é o AST que se executa.',
    '',
    '## Forma canônica (AST em JSON)',
    '',
    'O texto (`a + b | brl`) é açúcar. A forma de referência é JSON, com oito formas de nó, todas objetos:',
    '',
    '```jsonc',
    '{ "lit": null | true | 1.5 | "texto" }        // número finito e NÃO negativo; negativo é neg',
    '{ "var": "nome" }',
    '{ "campo": "nome", "de": <nó> }               // de.nome',
    '{ "indice": <nó>, "de": <nó> }                // de[indice]',
    '{ "lista": [<nó>, …] }',
    '{ "se": <nó>, "entao": <nó>, "senao": <nó> }  // c ? a : b',
    '{ "chama": "nome", "args": [<nó>, …] }        // função ou operador (+, &&, !, neg, brl, …)',
    '{ "fn": ["x"], "corpo": <nó> }                  // x => corpo: SÓ como argumento de mapeia, filtra, dobra…',
    '```',
    '',
    'Exemplo: `preco * (1 - desconto) | brl`',
    '',
    '```json',
    JSON.stringify({ chama: 'brl', args: [{ chama: '*', args: [{ var: 'preco' }, { chama: '-', args: [{ lit: 1 }, { var: 'desconto' }] }] }] }),
    '```',
    '',
    'O texto canônico (`formata`) não usa `|` e só põe parênteses onde a precedência exige; `parse(formata(e))` devolve a mesma árvore.',
    '',
    '## Precedência',
    '',
    precedencia,
    '',
    '`x | f(a)` é o mesmo que `f(x, a)` (o valor entra como primeiro argumento).',
    '',
    '## Formas',
    '',
    por('forma'),
    '',
    '## Operadores',
    '',
    por('operador'),
    '',
    '## Funções',
    '',
    por('funcao'),
    '',
  ].join('\n')
}
