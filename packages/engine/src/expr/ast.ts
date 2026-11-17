import { sugere } from '@polaris/schema/sugere'
import { LIMITES_EXPR, type Bin, type Expr } from './tipos'

// ---------------------------------------------------------------------------
// AST CANÔNICO em JSON da linguagem de expressões. É a forma de referência: o texto (`a + b | brl`) é só açúcar que
// compila para ela e pode ser reconstruído dela (`formata`). Oito formas, todas objetos, nenhuma ambígua:
//   { lit: null|boolean|número|texto }      literal (número finito e NÃO negativo: o negativo é `neg`)
//   { var: nome }                           variável do escopo
//   { campo: nome, de: nó }                 acesso a campo (tolerante a ausente)
//   { indice: nó, de: nó }                  acesso por índice/chave (tolerante a ausente)
//   { lista: [nó…] }                        lista literal
//   { se: nó, entao: nó, senao: nó }        condicional (só avalia o ramo escolhido)
//   { chama: nome, args: [nó…] }            função OU operador do registro (`+`, `&&`, `!`, `neg`, `brl`, …)
//   { fn: [param…], corpo: nó }             função anônima: SÓ como argumento de um combinador (mapeia, filtra, dobra…)
// Operadores são chamadas: uma tabela só (registro.ts) documenta e testa tudo.
// ---------------------------------------------------------------------------

export type Ast =
  | { lit: null | boolean | number | string }
  | { var: string }
  | { campo: string; de: Ast }
  | { indice: Ast; de: Ast }
  | { lista: Ast[] }
  | { se: Ast; entao: Ast; senao: Ast }
  | { chama: string; args: Ast[] }
  | { fn: string[]; corpo: Ast }

export type ErroAst = { caminho: string; mensagem: string; dica?: string }

const BINARIOS: readonly Bin[] = ['??', '||', '&&', '==', '!=', '<', '<=', '>', '>=', '+', '-', '*', '/', '%']
const EH_BINARIO = new Set<string>(BINARIOS)
const RESERVADAS = new Set(['true', 'false', 'null'])
const PROIBIDOS = new Set(['__proto__', 'constructor', 'prototype'])
const IDENT = /^[A-Za-z_$][A-Za-z0-9_$]*$/
const FORMAS: Record<string, readonly string[]> = {
  lit: ['lit'], var: ['var'], campo: ['campo', 'de'], indice: ['indice', 'de'], lista: ['lista'], se: ['se', 'entao', 'senao'], chama: ['chama', 'args'], fn: ['fn', 'corpo'],
}
const CHAVES_FORMA = Object.keys(FORMAS)

const esc = (caminho: string, k: string | number) => `${caminho}/${k}`
const ehObjeto = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)

// ---- validação -------------------------------------------------------------

/** Valida a forma canônica e devolve TODOS os problemas, cada um com o caminho JSON do nó. */
export function validaAst(x: unknown): ErroAst[] {
  const erros: ErroAst[] = []
  let nos = 0
  const anda = (n: unknown, caminho: string, prof: number): void => {
    if (++nos > LIMITES_EXPR.nos) { if (nos === LIMITES_EXPR.nos + 1) erros.push({ caminho, mensagem: `expressão grande demais (mais de ${LIMITES_EXPR.nos} nós)` }); return }
    if (prof > LIMITES_EXPR.profundidade) { erros.push({ caminho, mensagem: `expressão aninhada demais (mais de ${LIMITES_EXPR.profundidade} níveis)` }); return }
    if (!ehObjeto(n)) { erros.push({ caminho, mensagem: 'um nó de expressão é um objeto', dica: `use { "lit": … }, { "var": … }, { "chama": …, "args": […] } etc.` }); return }
    const presentes = CHAVES_FORMA.filter((k) => Object.prototype.hasOwnProperty.call(n, k))
    if (presentes.length === 0) {
      const c0 = Object.keys(n)[0]
      const s = c0 ? sugere(c0, CHAVES_FORMA) : undefined
      erros.push({ caminho, mensagem: `nó sem forma conhecida (formas: ${CHAVES_FORMA.join(', ')})`, ...(s ? { dica: `quis dizer '${s}'?` } : {}) })
      return
    }
    if (presentes.length > 1) { erros.push({ caminho, mensagem: `nó ambíguo: tem ${presentes.map((p) => `'${p}'`).join(' e ')}; cada nó tem uma forma só` }); return }
    const forma = presentes[0]!
    const permitidas = FORMAS[forma]!
    for (const k of Object.keys(n)) {
      if (!permitidas.includes(k)) { const s = sugere(k, permitidas); erros.push({ caminho: esc(caminho, k), mensagem: `'${k}' não existe na forma '${forma}' (campos: ${permitidas.join(', ')})`, ...(s ? { dica: `quis dizer '${s}'?` } : {}) }) }
    }
    for (const k of permitidas) if (!Object.prototype.hasOwnProperty.call(n, k)) erros.push({ caminho: esc(caminho, k), mensagem: `a forma '${forma}' precisa de '${k}'` })
    switch (forma) {
      case 'lit': {
        const v = n.lit
        if (v === null || typeof v === 'boolean' || typeof v === 'string') break
        if (typeof v !== 'number' || !Number.isFinite(v)) erros.push({ caminho: esc(caminho, 'lit'), mensagem: 'literal deve ser null, booleano, número finito ou texto', dica: 'listas e objetos se constroem com { "lista": […] }' })
        else if (v < 0 || Object.is(v, -0)) erros.push({ caminho: esc(caminho, 'lit'), mensagem: 'número negativo não é literal canônico', dica: `use { "chama": "neg", "args": [{ "lit": ${Object.is(v, -0) ? 0 : -v} }] }` })
        break
      }
      case 'var':
        if (typeof n.var !== 'string' || !IDENT.test(n.var) || RESERVADAS.has(n.var)) erros.push({ caminho: esc(caminho, 'var'), mensagem: `nome de variável inválido (${JSON.stringify(n.var)})`, dica: 'identificador [A-Za-z_$][A-Za-z0-9_$]*, exceto true, false e null' })
        break
      case 'campo':
        if ('campo' in n && (typeof n.campo !== 'string' || !IDENT.test(n.campo))) erros.push({ caminho: esc(caminho, 'campo'), mensagem: `nome de campo inválido (${JSON.stringify(n.campo)})`, dica: `para chaves arbitrárias use { "indice": { "lit": "chave" }, "de": … }` })
        if ('de' in n) anda(n.de, esc(caminho, 'de'), prof + 1)
        break
      case 'indice':
        anda(n.indice, esc(caminho, 'indice'), prof + 1)
        if ('de' in n) anda(n.de, esc(caminho, 'de'), prof + 1)
        break
      case 'lista':
        if (!('lista' in n)) break
        if (!Array.isArray(n.lista)) erros.push({ caminho: esc(caminho, 'lista'), mensagem: "'lista' é um array de nós" })
        else n.lista.forEach((i, k) => anda(i, esc(esc(caminho, 'lista'), k), prof + 1))
        break
      case 'se':
        for (const k of ['se', 'entao', 'senao']) if (k in n) anda(n[k], esc(caminho, k), prof + 1)
        break
      case 'fn': {
        const ps = n.fn
        if (!Array.isArray(ps) || ps.length < 1 || ps.length > 3) erros.push({ caminho: esc(caminho, 'fn'), mensagem: "'fn' é a lista de 1 a 3 nomes de parâmetros", dica: '{ "fn": ["x"], "corpo": … }' })
        else {
          ps.forEach((p, k) => { if (typeof p !== 'string' || !IDENT.test(p) || RESERVADAS.has(p) || PROIBIDOS.has(p)) erros.push({ caminho: esc(esc(caminho, 'fn'), k), mensagem: `nome de parâmetro inválido (${JSON.stringify(p)})` }) })
          if (new Set(ps).size !== ps.length) erros.push({ caminho: esc(caminho, 'fn'), mensagem: 'parâmetros repetidos' })
        }
        if ('corpo' in n) anda(n.corpo, esc(caminho, 'corpo'), prof + 1)
        break
      }
      case 'chama': {
        const nome = n.chama
        if ('chama' in n && (typeof nome !== 'string' || (!IDENT.test(nome) && !OPERADORES.has(nome)) || RESERVADAS.has(nome))) erros.push({ caminho: esc(caminho, 'chama'), mensagem: `nome de função inválido (${JSON.stringify(nome)})` })
        if (!('args' in n)) break
        if (!Array.isArray(n.args)) erros.push({ caminho: esc(caminho, 'args'), mensagem: "'args' é um array de nós" })
        else {
          if (typeof nome === 'string' && EH_BINARIO.has(nome) && n.args.length !== 2) erros.push({ caminho: esc(caminho, 'args'), mensagem: `o operador '${nome}' recebe exatamente 2 argumentos, recebeu ${n.args.length}` })
          if (typeof nome === 'string' && (nome === '!' || nome === 'neg') && n.args.length !== 1) erros.push({ caminho: esc(caminho, 'args'), mensagem: `'${nome}' recebe exatamente 1 argumento, recebeu ${n.args.length}` })
          n.args.forEach((a, k) => anda(a, esc(esc(caminho, 'args'), k), prof + 1))
        }
        break
      }
    }
  }
  anda(x, '', 0)
  return erros
}

/** Nomes que são operadores (não identificadores): `+`, `&&`, `!`… e `neg` (que é identificador). */
export const OPERADORES: ReadonlySet<string> = new Set([...BINARIOS, '!', 'neg'])

// ---- conversões ------------------------------------------------------------

/** Expr interna (com posições do texto) → AST canônico. */
export function paraAst(e: Expr): Ast {
  switch (e.t) {
    case 'lit': return { lit: e.v }
    case 'var': return { var: e.nome }
    case 'mem': return { campo: e.nome, de: paraAst(e.obj) }
    case 'idx': return { indice: paraAst(e.idx), de: paraAst(e.obj) }
    case 'lista': return { lista: e.itens.map(paraAst) }
    case 'fn': return { fn: [...e.params], corpo: paraAst(e.corpo) }
    case 'cond': return { se: paraAst(e.c), entao: paraAst(e.a), senao: paraAst(e.b) }
    case 'un': return { chama: e.op === '!' ? '!' : 'neg', args: [paraAst(e.x)] }
    case 'bin': return { chama: e.op, args: [paraAst(e.a), paraAst(e.b)] }
    case 'call': return { chama: e.fn, args: e.args.map(paraAst) }
  }
}

/** AST canônico (JÁ validado) → Expr interna. As posições são 0: os erros apontam o caminho JSON, não o texto. */
export function deAstValidado(n: Ast): Expr {
  const pos = 0
  if ('lit' in n) return { t: 'lit', v: n.lit, pos }
  if ('var' in n) return { t: 'var', nome: n.var, pos }
  if ('campo' in n) return { t: 'mem', obj: deAstValidado(n.de), nome: n.campo, pos }
  if ('indice' in n) return { t: 'idx', obj: deAstValidado(n.de), idx: deAstValidado(n.indice), pos }
  if ('lista' in n) return { t: 'lista', itens: n.lista.map(deAstValidado), pos }
  if ('fn' in n) return { t: 'fn', params: [...n.fn], corpo: deAstValidado(n.corpo), pos }
  if ('se' in n) return { t: 'cond', c: deAstValidado(n.se), a: deAstValidado(n.entao), b: deAstValidado(n.senao), pos }
  if (n.chama === '!') return { t: 'un', op: '!', x: deAstValidado(n.args[0]!), pos }
  if (n.chama === 'neg') return { t: 'un', op: '-', x: deAstValidado(n.args[0]!), pos }
  if (EH_BINARIO.has(n.chama)) return { t: 'bin', op: n.chama as Bin, a: deAstValidado(n.args[0]!), b: deAstValidado(n.args[1]!), pos }
  return { t: 'call', fn: n.chama, args: n.args.map(deAstValidado), pos }
}

export function deAst(x: unknown): { ok: true; expr: Expr } | { ok: false; erros: ErroAst[] } {
  const erros = validaAst(x)
  return erros.length ? { ok: false, erros } : { ok: true, expr: deAstValidado(x as Ast) }
}

// ---- texto canônico --------------------------------------------------------

export const NIVEL: Record<string, number> = { '??': 1, '||': 2, '&&': 3, '==': 4, '!=': 4, '<': 5, '<=': 5, '>': 5, '>=': 5, '+': 6, '-': 6, '*': 7, '/': 7, '%': 7 }
export const NIVEL_UNARIO = 8

const texto = (s: string) => `"${s.replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\n/g, '\\n').replace(/\t/g, '\\t')}"`

/** Texto canônico de uma expressão: parênteses só onde a precedência exige; sem pipes. `parseExpr(formata(e))` ≡ `e` (sem posições). */
export function formata(e: Expr, minimo = 0): string {
  const envolve = (nivel: number, s: string) => (nivel < minimo ? `(${s})` : s)
  switch (e.t) {
    case 'lit': return e.v === null ? 'null' : typeof e.v === 'string' ? texto(e.v) : String(e.v)
    case 'var': return e.nome
    case 'mem': return `${formata(e.obj, 9)}.${e.nome}`
    case 'idx': return `${formata(e.obj, 9)}[${formata(e.idx, 0)}]`
    case 'lista': return `[${e.itens.map((i) => formata(i, 0)).join(', ')}]`
    case 'fn': return envolve(0, `${e.params.length === 1 ? e.params[0] : `(${e.params.join(', ')})`} => ${formata(e.corpo, 0)}`)
    case 'call': return `${e.fn}(${e.args.map((a) => formata(a, 0)).join(', ')})`
    case 'un': return envolve(NIVEL_UNARIO, `${e.op}${formata(e.x, NIVEL_UNARIO)}`)
    case 'cond': return envolve(0, `${formata(e.c, 1)} ? ${formata(e.a, 0)} : ${formata(e.b, 0)}`)
    case 'bin': { const n = NIVEL[e.op]!; return envolve(n, `${formata(e.a, n)} ${e.op} ${formata(e.b, n + 1)}`) }
  }
}

/** Quita as posições para comparar duas Expr estruturalmente. */
export function semPos(e: Expr): unknown {
  return JSON.parse(JSON.stringify(e, (k, v) => (k === 'pos' ? undefined : v)))
}
