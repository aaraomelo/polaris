// `t("chave", params?)` nas expressões da página: o template carrega só a CHAVE; o texto de cada idioma vive nos catálogos (`kind: traducao`) que a página
// lista em `spec.traducoes`. O compilador troca a chamada por `traduz(idioma, {pt-BR: …, en: …, "*": <padrão>}, params)` com as mensagens daquela chave:
// a página fica autossuficiente (SSR, cliente, estático e AOT iguais), sem consulta em tempo de execução e sem carregar mensagem que ela não usa.
import type { Expr } from '../expr/tipos'
import { erroDeMensagem } from '../expr/icu'

export type Catalogo = { id: string; padrao: string; mensagens: Record<string, Record<string, string>> }

/** troca todo `t("chave"[, params])` por `traduz(idioma, {…}[, params])`; chave ausente, dinâmica ou com ICU inválido vira erro (via `erro`) */
export function reescreveT(expr: Expr, catalogos: readonly Catalogo[], erro: (mensagem: string, dica?: string) => void): Expr {
  const anda = (n: Expr): Expr => {
    switch (n.t) {
      case 'lit': case 'var': return n
      case 'mem': return { ...n, obj: anda(n.obj) }
      case 'idx': return { ...n, obj: anda(n.obj), idx: anda(n.idx) }
      case 'un': return { ...n, x: anda(n.x) }
      case 'bin': return { ...n, a: anda(n.a), b: anda(n.b) }
      case 'cond': return { ...n, c: anda(n.c), a: anda(n.a), b: anda(n.b) }
      case 'lista': return { ...n, itens: n.itens.map(anda) }
      case 'fn': return { ...n, corpo: anda(n.corpo) }
      case 'call': break
    }
    if (n.fn !== 't') return { ...n, args: n.args.map(anda) }
    const pos = n.pos, lit = (v: string): Expr => ({ t: 'lit', v, pos })
    const [k, params, ...resto] = n.args
    if (!k || k.t !== 'lit' || typeof k.v !== 'string' || resto.length > 0) { erro('t() recebe a chave como texto literal e, opcionalmente, os parâmetros: t("home.titulo") ou t("itens", objeto([["n", 3]]))', 'a chave não pode ser calculada: o compilador precisa saber quais mensagens a página usa'); return lit('') }
    const chave = k.v
    if (!catalogos.length) { erro(`t("${chave}"): a página não declara catálogos de tradução`, 'liste os catálogos em spec.traducoes (nós kind: traducao)'); return lit('') }
    const cat = catalogos.find((c) => chave in (c.mensagens[c.padrao] ?? {}))
    if (!cat) {
      const todas = catalogos.flatMap((c) => Object.keys(c.mensagens[c.padrao] ?? {})), parecida = todas.find((x) => x.toLowerCase() === chave.toLowerCase())
      erro(`a chave de tradução '${chave}' não existe em ${catalogos.map((c) => `'${c.id}'`).join(', ')}`, parecida ? `quis dizer '${parecida}'?` : 'acrescente a chave no idioma padrão do catálogo'); return lit('')
    }
    const pares: Expr[] = []
    for (const [idioma, msgs] of Object.entries(cat.mensagens)) {
      const m = msgs[chave]; if (m === undefined) continue
      const e = erroDeMensagem(m); if (e) erro(`a mensagem '${chave}' em '${idioma}' (catálogo '${cat.id}'): ${e}`, m.slice(0, 80))
      pares.push({ t: 'lista', itens: [lit(idioma), lit(m)], pos })
    }
    pares.push({ t: 'lista', itens: [lit('*'), lit(cat.mensagens[cat.padrao]![chave]!)], pos }) // o idioma padrão vale quando o pedido não tem tradução
    const entrada: Expr = { t: 'call', fn: 'objeto', args: [{ t: 'lista', itens: pares, pos }], pos }
    return { t: 'call', fn: 'traduz', args: [{ t: 'var', nome: 'idioma', pos }, entrada, ...(params ? [anda(params)] : [])], pos }
  }
  return anda(expr)
}
