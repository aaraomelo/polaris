import { sugere } from '@polaris/schema/sugere'
import { FUNCOES_PADRAO } from './biblioteca'
import type { Expr, Funcoes } from './tipos'

export type ProblemaExpr = { pos: number; mensagem: string; dica?: string; regra: 'variavel' | 'funcao' | 'aridade' | 'funcao-anonima' }

/** Variáveis LIVRES (as ligadas por parâmetros de função anônima não contam) e chamadas de uma expressão. */
export function analisa(e: Expr): { variaveis: Set<string>; chamadas: Array<{ fn: string; n: number; pos: number }> } {
  const variaveis = new Set<string>()
  const chamadas: Array<{ fn: string; n: number; pos: number }> = []
  const anda = (x: Expr, ligadas: readonly string[]): void => {
    switch (x.t) {
      case 'var': if (!ligadas.includes(x.nome)) variaveis.add(x.nome); break
      case 'mem': anda(x.obj, ligadas); break
      case 'idx': anda(x.obj, ligadas); anda(x.idx, ligadas); break
      case 'un': anda(x.x, ligadas); break
      case 'bin': anda(x.a, ligadas); anda(x.b, ligadas); break
      case 'cond': anda(x.c, ligadas); anda(x.a, ligadas); anda(x.b, ligadas); break
      case 'lista': x.itens.forEach((i) => anda(i, ligadas)); break
      case 'fn': anda(x.corpo, [...ligadas, ...x.params]); break
      case 'call': chamadas.push({ fn: x.fn, n: x.args.length, pos: x.pos }); x.args.forEach((a) => anda(a, ligadas)); break
      case 'lit': break
    }
  }
  anda(e, [])
  return { variaveis, chamadas }
}

const PARAMS_PROIBIDOS = new Set(['__proto__', 'constructor', 'prototype', 'true', 'false', 'null'])

/** Checagem estática: variável fora do escopo, função desconhecida, número de argumentos e uso correto de função anônima. */
export function validaExpr(e: Expr, escopo: readonly string[], funcoes: Funcoes = FUNCOES_PADRAO): ProblemaExpr[] {
  const out: ProblemaExpr[] = []
  const nomes = (extra: readonly string[]) => [...escopo, ...extra]
  const combinadores = Object.keys(funcoes).filter((k) => funcoes[k]!.os)
  const anda = (x: Expr, ligadas: readonly string[], emArgFn: boolean): void => {
    switch (x.t) {
      case 'var':
        if (!ligadas.includes(x.nome) && !escopo.includes(x.nome)) {
          const s = sugere(x.nome, nomes(ligadas))
          out.push({
            pos: x.pos, regra: 'variavel', mensagem: `a variável '${x.nome}' não existe neste ponto`,
            dica: s ? `quis dizer '${s}'?` : escopo.length || ligadas.length ? `variáveis disponíveis: ${nomes(ligadas).join(', ')}` : 'não há variáveis disponíveis aqui',
          })
        }
        break
      case 'mem': anda(x.obj, ligadas, false); break
      case 'idx': anda(x.obj, ligadas, false); anda(x.idx, ligadas, false); break
      case 'un': anda(x.x, ligadas, false); break
      case 'bin': anda(x.a, ligadas, false); anda(x.b, ligadas, false); break
      case 'cond': anda(x.c, ligadas, false); anda(x.a, ligadas, false); anda(x.b, ligadas, false); break
      case 'lista': x.itens.forEach((i) => anda(i, ligadas, false)); break
      case 'lit': break
      case 'fn':
        if (!emArgFn) out.push({ pos: x.pos, regra: 'funcao-anonima', mensagem: 'função anônima só pode ser argumento de um combinador', dica: `use dentro de ${combinadores.join(', ')}` })
        for (const p of x.params) if (PARAMS_PROIBIDOS.has(p)) out.push({ pos: x.pos, regra: 'funcao-anonima', mensagem: `nome de parâmetro inválido '${p}'` })
        if (new Set(x.params).size !== x.params.length) out.push({ pos: x.pos, regra: 'funcao-anonima', mensagem: 'parâmetros repetidos' })
        anda(x.corpo, [...ligadas, ...x.params], false)
        break
      case 'call': {
        const f = Object.prototype.hasOwnProperty.call(funcoes, x.fn) ? funcoes[x.fn] : undefined
        if (f?.os) {
          const os = f.os
          if (x.args.length !== os.fnPos + 1) out.push({ pos: x.pos, regra: 'aridade', mensagem: `'${x.fn}' recebe ${os.fnPos + 1} argumentos, recebeu ${x.args.length}` })
          x.args.forEach((a, i) => {
            if (i === os.fnPos) {
              if (a.t !== 'fn') out.push({ pos: a.pos, regra: 'funcao-anonima', mensagem: `o argumento ${i + 1} de '${x.fn}' deve ser uma função anônima`, dica: `ex.: ${x.fn}(lista, x => …)` })
              else if (a.params.length > os.paramsMax) out.push({ pos: a.pos, regra: 'funcao-anonima', mensagem: `a função de '${x.fn}' aceita até ${os.paramsMax} parâmetro(s), declarou ${a.params.length}` })
              else anda(a, ligadas, true)
            } else anda(a, ligadas, false)
          })
          break
        }
        if (!f) {
          const s = sugere(x.fn, Object.keys(funcoes))
          out.push({ pos: x.pos, regra: 'funcao', mensagem: `a função '${x.fn}' não existe`, dica: s ? `quis dizer '${s}'?` : `funções: ${Object.keys(funcoes).join(', ')}` })
        } else if (x.args.length < f.min || x.args.length > f.max) {
          const esp = f.min === f.max ? `${f.min}` : `${f.min} a ${f.max === Infinity ? 'N' : f.max}`
          out.push({ pos: x.pos, regra: 'aridade', mensagem: `'${x.fn}' recebe ${esp} argumento(s), recebeu ${x.args.length}` })
        }
        x.args.forEach((a) => anda(a, ligadas, false))
        break
      }
    }
  }
  anda(e, [], false)
  // ordem por posição, como antes (o autor lê o erro mais à esquerda primeiro)
  return out.sort((a, b) => a.pos - b.pos)
}
