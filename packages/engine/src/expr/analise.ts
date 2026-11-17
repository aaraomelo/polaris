import { sugere } from '@polaris/schema/sugere'
import { FUNCOES_PADRAO } from './funcoes'
import type { Expr, Funcoes } from './tipos'

export type ProblemaExpr = { pos: number; mensagem: string; dica?: string; regra: 'variavel' | 'funcao' | 'aridade' }

/** Variáveis livres e chamadas de uma expressão. */
export function analisa(e: Expr): { variaveis: Set<string>; chamadas: Array<{ fn: string; n: number; pos: number }> } {
  const variaveis = new Set<string>()
  const chamadas: Array<{ fn: string; n: number; pos: number }> = []
  const anda = (x: Expr): void => {
    switch (x.t) {
      case 'var': variaveis.add(x.nome); break
      case 'mem': anda(x.obj); break
      case 'idx': anda(x.obj); anda(x.idx); break
      case 'un': anda(x.x); break
      case 'bin': anda(x.a); anda(x.b); break
      case 'cond': anda(x.c); anda(x.a); anda(x.b); break
      case 'lista': x.itens.forEach(anda); break
      case 'call': chamadas.push({ fn: x.fn, n: x.args.length, pos: x.pos }); x.args.forEach(anda); break
      case 'lit': break
    }
  }
  anda(e)
  return { variaveis, chamadas }
}

/** Checagem estática: variável fora do escopo, função desconhecida e número de argumentos. */
export function validaExpr(e: Expr, escopo: readonly string[], funcoes: Funcoes = FUNCOES_PADRAO): ProblemaExpr[] {
  const out: ProblemaExpr[] = []
  const a = analisa(e)
  const posVar = new Map<string, number>()
  const acha = (x: Expr): void => {
    if (x.t === 'var' && !posVar.has(x.nome)) posVar.set(x.nome, x.pos)
    if (x.t === 'mem') acha(x.obj)
    else if (x.t === 'idx') { acha(x.obj); acha(x.idx) }
    else if (x.t === 'un') acha(x.x)
    else if (x.t === 'bin') { acha(x.a); acha(x.b) }
    else if (x.t === 'cond') { acha(x.c); acha(x.a); acha(x.b) }
    else if (x.t === 'lista') x.itens.forEach(acha)
    else if (x.t === 'call') x.args.forEach(acha)
  }
  acha(e)
  for (const v of a.variaveis) {
    if (escopo.includes(v)) continue
    const s = sugere(v, escopo)
    out.push({
      pos: posVar.get(v) ?? 0, regra: 'variavel', mensagem: `a variável '${v}' não existe neste ponto`,
      dica: s ? `quis dizer '${s}'?` : escopo.length ? `variáveis disponíveis: ${escopo.join(', ')}` : 'não há variáveis disponíveis aqui',
    })
  }
  for (const c of a.chamadas) {
    const f = Object.prototype.hasOwnProperty.call(funcoes, c.fn) ? funcoes[c.fn] : undefined
    if (!f) {
      const s = sugere(c.fn, Object.keys(funcoes))
      out.push({ pos: c.pos, regra: 'funcao', mensagem: `a função '${c.fn}' não existe`, dica: s ? `quis dizer '${s}'?` : `funções: ${Object.keys(funcoes).join(', ')}` })
    } else if (c.n < f.min || c.n > f.max) {
      const esp = f.min === f.max ? `${f.min}` : `${f.min} a ${f.max === Infinity ? 'N' : f.max}`
      out.push({ pos: c.pos, regra: 'aridade', mensagem: `'${c.fn}' recebe ${esp} argumento(s), recebeu ${c.n}` })
    }
  }
  return out
}
