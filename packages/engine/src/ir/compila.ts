import { confere, sugere, type Contexto, type Erro, type No, type Registry } from '@polaris/schema'
import { ExprErro, parseExpr, validaExpr, type Expr, FUNCOES_PADRAO, analisa } from '../expr/index'
import { parseTemplate, TemplateErro, type Template } from '../template'
import {
  ESCOPO_BLOCO, ESCOPO_PAGINA, SLOT_NATIVO,
  type IRBloco, type IRBlocoModelo, type IRNo, type IRPagina, type ImplBloco, type Valor,
} from './tipos'

// Compila nós `pagina` e `bloco` do registry para IR. Nunca lança por erro de conteúdo:
// devolve { ok: false, erros } com caminho JSON, regra e dica (mesmo formato dos outros validadores).

type Inst = {
  bloco: string; id?: string; props?: unknown; slots?: Record<string, Inst[]>
  se?: string; repetir?: { cada: string; como: string }
}

export type Resultado<T> = { ok: true; ir: T } | { ok: false; erros: Erro[] }

class Cx {
  readonly erros: Erro[] = []
  readonly usa = new Set<string>()
  constructor(readonly reg: Registry, readonly ctx: Contexto, readonly modo: 'pagina' | 'bloco', readonly slotsDoBloco: readonly string[] = []) {}
  erro(caminho: string, regra: string, mensagem: string, dica?: string, valor?: unknown) {
    this.erros.push({ caminho, regra, mensagem, ...(dica ? { dica } : {}), ...(valor !== undefined ? { valor } : {}) })
  }
}

function checaExpr(cx: Cx, ast: Expr, escopo: readonly string[], caminho: string, fonte: string, base: number): void {
  for (const v of analisa(ast).variaveis) if (escopo.includes(v)) cx.usa.add(v)
  for (const p of validaExpr(ast, escopo, FUNCOES_PADRAO)) {
    cx.erro(caminho, 'binding', `${p.mensagem} (em '${fonte}', posição ${base + p.pos})`, p.dica, fonte)
  }
}

function exprPura(cx: Cx, src: string, escopo: readonly string[], caminho: string): Expr | undefined {
  try {
    const ast = parseExpr(src)
    checaExpr(cx, ast, escopo, caminho, src, 0)
    return ast
  } catch (e) {
    if (e instanceof ExprErro) cx.erro(caminho, 'expressao', `${e.message} (em '${src}', posição ${e.pos})`, e.dica, src)
    else throw e
    return undefined
  }
}

function compilaTexto(cx: Cx, src: string, escopo: readonly string[], caminho: string): Valor {
  let t: Template
  try {
    t = parseTemplate(src)
  } catch (e) {
    if (e instanceof TemplateErro) { cx.erro(caminho, 'template', `${e.message} (posição ${e.pos})`, e.dica, src); return { t: 'lit', v: src } }
    throw e
  }
  if (t.t === 'lit') return { t: 'lit', v: t.v }
  if (t.t === 'expr') { checaExpr(cx, t.ast, escopo, caminho, t.fonte, t.offset); return { t: 'expr', ast: t.ast, fonte: t.fonte } }
  for (const p of t.partes) if (typeof p !== 'string') checaExpr(cx, p.ast, escopo, caminho, p.fonte, p.offset)
  return { t: 'tpl', partes: t.partes.map((p) => (typeof p === 'string' ? p : { ast: p.ast, fonte: p.fonte })) }
}

function compilaValor(cx: Cx, v: unknown, escopo: readonly string[], caminho: string): Valor {
  if (typeof v === 'string') return compilaTexto(cx, v, escopo, caminho)
  if (v === null || typeof v === 'number' || typeof v === 'boolean') return { t: 'lit', v }
  if (Array.isArray(v)) return { t: 'arr', itens: v.map((x, i) => compilaValor(cx, x, escopo, `${caminho}/${i}`)) }
  if (typeof v === 'object') {
    return { t: 'obj', campos: Object.fromEntries(Object.entries(v as object).map(([k, x]) => [k, compilaValor(cx, x, escopo, `${caminho}/${k}`)])) }
  }
  return { t: 'lit', v: null }
}

function resolveBloco(cx: Cx, interfaceId: string, caminho: string): IRBloco | undefined {
  try {
    const r = cx.reg.resolveBloco(interfaceId, cx.ctx)
    const impl: ImplBloco = r.modelo ? 'composto' : r.codigo ? 'codigo' : 'nativo'
    return { interface: interfaceId, cadeia: r.cadeia, impl }
  } catch (e) {
    cx.erro(`${caminho}/bloco`, 'ref', (e as Error).message)
    return undefined
  }
}

function compilaInst(cx: Cx, inst: Inst, caminho: string, escopo: readonly string[]): IRNo {
  const base = { caminho } as { caminho: string; se?: Expr; repetir?: { cada: Expr; como: string } }
  // `se` e `repetir.cada` veem só o escopo de fora; `como` e `indice` valem para props, filhos e slots.
  if (inst.se !== undefined) base.se = exprPura(cx, inst.se, escopo, `${caminho}/se`)
  let interno = escopo
  if (inst.repetir) {
    const cada = exprPura(cx, inst.repetir.cada, escopo, `${caminho}/repetir/cada`)
    const como = inst.repetir.como
    if (escopo.includes(como) || como === 'indice') {
      cx.erro(`${caminho}/repetir/como`, 'repetir', `'${como}' já existe neste escopo e seria sobrescrito`, `escolha outro nome (em uso: ${escopo.join(', ')}, indice)`)
    }
    if (cada) base.repetir = { cada, como }
    interno = [...escopo, como, 'indice']
  }

  if (inst.bloco === SLOT_NATIVO) {
    if (cx.modo !== 'bloco') cx.erro(`${caminho}/bloco`, 'slot-nativo', `${SLOT_NATIVO} só pode ser usado dentro do modelo de um bloco`, 'em páginas, use o bloco que declara o slot')
    const nome = (inst.props as { nome?: unknown } | undefined)?.nome
    if (typeof nome !== 'string') {
      cx.erro(`${caminho}/props/nome`, 'slot-nativo', `${SLOT_NATIVO} precisa de props.nome com o nome do slot`, 'ex.: { "nome": "item" }')
    } else if (cx.modo === 'bloco' && !cx.slotsDoBloco.includes(nome)) {
      const s = sugere(nome, cx.slotsDoBloco)
      cx.erro(`${caminho}/props/nome`, 'slot-nativo', `o bloco não declara o slot '${nome}'`, s ? `quis dizer '${s}'?` : `slots declarados: ${cx.slotsDoBloco.join(', ') || 'nenhum'}`)
    }
    return { tipo: 'slot', nome: typeof nome === 'string' ? nome : '', ...base }
  }

  const bloco = resolveBloco(cx, inst.bloco, caminho) ?? { interface: inst.bloco, cadeia: [inst.bloco], impl: 'nativo' as const }
  const props: Record<string, Valor> = {}
  for (const [k, v] of Object.entries((inst.props ?? {}) as Record<string, unknown>)) props[k] = compilaValor(cx, v, interno, `${caminho}/props/${k}`)
  const slots: Record<string, IRNo[]> = {}
  for (const [nome, lista] of Object.entries(inst.slots ?? {})) {
    slots[nome] = lista.map((f, n) => compilaInst(cx, f, `${caminho}/slots/${nome}/${n}`, interno))
  }
  return { tipo: 'elemento', ...(inst.id !== undefined ? { id: inst.id } : {}), bloco, props, slots, ...base }
}

/** Compila uma página (nó `pagina`) para IR. Inclui os erros de referência, slots, props, ciclos e limites. */
export function compilaPagina(reg: Registry, no: No, ctx: Contexto = {}): Resultado<IRPagina> {
  if (no.kind !== 'pagina') return { ok: false, erros: [{ caminho: '/kind', regra: 'kind', mensagem: `compilaPagina espera kind 'pagina', recebeu '${no.kind}'` }] }
  const spec = no.spec as { rota: string; titulo?: string; dados?: Record<string, string>; raiz: Inst }
  const cx = new Cx(reg, ctx, 'pagina')
  cx.erros.push(...confere(reg, no, ctx))
  const dados = spec.dados ?? {}
  for (const nome of Object.keys(dados)) {
    if ((ESCOPO_PAGINA as readonly string[]).includes(nome) || nome === 'indice') {
      cx.erro(`/spec/dados/${nome}`, 'dados', `'${nome}' é um nome reservado da página e sombrearia o valor do sistema`, `escolha outro nome (reservados: ${[...ESCOPO_PAGINA, 'indice'].join(', ')})`)
    }
  }
  const escopo = [...ESCOPO_PAGINA, ...Object.keys(dados)]
  const titulo = spec.titulo !== undefined ? compilaTexto(cx, spec.titulo, escopo, '/spec/titulo') : undefined
  const raiz = compilaInst(cx, spec.raiz, '/spec/raiz', escopo)
  if (cx.erros.length) return { ok: false, erros: cx.erros }
  return { ok: true, ir: { tipo: 'pagina', id: no.id, versao: no.versao, rota: spec.rota, ...(titulo ? { titulo } : {}), dados, raiz, usa: [...cx.usa].sort() } }
}

/** Compila o `modelo` de um bloco composto. Escopo: `props` e `tenant`; `core/slot` projeta os filhos recebidos. */
export function compilaBloco(reg: Registry, interfaceId: string, ctx: Contexto = {}): Resultado<IRBlocoModelo> {
  let def
  try {
    def = reg.resolveBloco(interfaceId, ctx)
  } catch (e) {
    return { ok: false, erros: [{ caminho: '/spec/interface', regra: 'ref', mensagem: (e as Error).message }] }
  }
  if (!def.modelo) {
    return { ok: false, erros: [{ caminho: '/spec/modelo', regra: 'modelo', mensagem: `o bloco '${interfaceId}' não tem modelo para compilar`, dica: def.codigo ? 'é um bloco de código (sandbox)' : 'é um bloco nativo do runtime' }] }
  }
  const cx = new Cx(reg, ctx, 'bloco', Object.keys(def.slots))
  const resolvido = reg.resolve('bloco', interfaceId, ctx)
  if (resolvido) cx.erros.push(...confere(reg, resolvido.no, ctx).filter((e) => e.caminho.startsWith('/spec/modelo')))
  const modelo = compilaInst(cx, def.modelo as Inst, '/spec/modelo', ESCOPO_BLOCO)
  if (cx.erros.length) return { ok: false, erros: cx.erros }
  return { ok: true, ir: { tipo: 'bloco', interface: interfaceId, cadeia: def.cadeia, modelo, usa: [...cx.usa].sort() } }
}
