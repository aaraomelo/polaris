import { confere, sugere, type Contexto, type Erro, type No, type Registry } from '@polaris/schema'
import { confereValor } from '../dados/args'
import { ExprErro, parseExpr, validaExpr, type Expr, FUNCOES_PADRAO, analisa, deAst, formata } from '../expr/index'
import { parseTemplate, TemplateErro, type Template } from '../template'
import {
  ESCOPO_ARGS, ESCOPO_BLOCO, ESCOPO_PAGINA, RESERVADOS, SLOT_CONTEUDO, SLOT_NATIVO,
  type CampoParametro, type FonteDados, type IRAcao, type IRBloco, type IRBlocoModelo, type IRDado, type IREstado, type IRNo, type IRPagina, type ImplBloco, type Valor,
} from './tipos'

// Compila nós `pagina` e `bloco` do registry para IR. Nunca lança por erro de conteúdo:
// devolve { ok: false, erros } com caminho JSON, regra e dica (mesmo formato dos outros validadores).

/** expressão como o autor escreveu: texto (açúcar) ou AST canônico em JSON */
type ExprSrc = string | Record<string, unknown>
type AcaoSrc = { acao: 'definir' | 'executar' | 'navegar'; estado?: string; valor?: ExprSrc; dados?: string; args?: Record<string, unknown>; depois?: AcaoSrc[]; emErro?: AcaoSrc[]; para?: string }
type Inst = {
  bloco: string; id?: string; props?: unknown; slots?: Record<string, Inst[]>
  se?: ExprSrc; repetir?: { cada: ExprSrc; como: string; chave?: ExprSrc }; eventos?: Record<string, AcaoSrc[]>; esqueleto?: Inst
}

export type Resultado<T> = { ok: true; ir: T } | { ok: false; erros: Erro[] }

const MAX_ACOES_POR_EVENTO = 50
const MAX_PROFUNDIDADE_ACOES = 5

/** Contexto de uma página em compilação: o que as ações podem referenciar. */
type PaginaCx = { estado: IREstado; dados: Record<string, IRDado>; fontes: Record<string, FonteDados>; stream: Set<string> }

class Cx {
  readonly erros: Erro[] = []
  readonly usa = new Set<string>()
  /** variáveis usadas pelas expressões PRÓPRIAS do nó em compilação (props, se, repetir.cada), para achar fronteiras de streaming */
  proprio: Set<string> | null = null
  constructor(readonly reg: Registry, readonly ctx: Contexto, readonly modo: 'pagina' | 'bloco', readonly slotsDoBloco: readonly string[] = [], readonly pagina: PaginaCx | null = null) {}
  erro(caminho: string, regra: string, mensagem: string, dica?: string, valor?: unknown) {
    this.erros.push({ caminho, regra, mensagem, ...(dica ? { dica } : {}), ...(valor !== undefined ? { valor } : {}) })
  }
}

function checaExpr(cx: Cx, ast: Expr, escopo: readonly string[], caminho: string, fonte: string, base: number): void {
  for (const v of analisa(ast).variaveis) if (escopo.includes(v)) { cx.usa.add(v); cx.proprio?.add(v) }
  for (const p of validaExpr(ast, escopo, FUNCOES_PADRAO)) {
    cx.erro(caminho, 'binding', `${p.mensagem} (em '${fonte}'${base < 0 ? '' : `, posição ${base + p.pos}`})`, p.dica, fonte)
  }
}

function exprPura(cx: Cx, src: ExprSrc, escopo: readonly string[], caminho: string): Expr | undefined {
  if (typeof src !== 'string') {
    // AST canônico: os erros apontam o caminho JSON dentro do próprio nó
    const r = deAst(src)
    if (!r.ok) { for (const e of r.erros) cx.erro(`${caminho}${e.caminho}`, 'expressao', e.mensagem, e.dica); return undefined }
    checaExpr(cx, r.expr, escopo, caminho, formata(r.expr), -1)
    return r.expr
  }
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
    // { "$expr": <AST canônico> }: expressão avaliada no lugar (o resto dos objetos é literal)
    const chaves = Object.keys(v as object)
    if (chaves.length === 1 && chaves[0] === '$expr') {
      const e = exprPura(cx, (v as { $expr: ExprSrc }).$expr, escopo, `${caminho}/$expr`)
      return e ? { t: 'expr', ast: e, fonte: formata(e) } : { t: 'lit', v: null }
    }
    return { t: 'obj', campos: Object.fromEntries(Object.entries(v as object).map(([k, x]) => [k, compilaValor(cx, x, escopo, `${caminho}/${k}`)])) }
  }
  return { t: 'lit', v: null }
}

/** Argumentos de uma fonte: nomes conhecidos (com "quis dizer") e tipo dos valores literais. Obrigatórios são checados por quem junta as origens. */
function compilaArgs(cx: Cx, args: Record<string, unknown>, fonte: FonteDados | undefined, escopo: readonly string[], caminho: string): Record<string, Valor> {
  const out: Record<string, Valor> = {}
  for (const [nome, v] of Object.entries(args)) {
    const campo = fonte?.parametros[nome]
    if (fonte && !campo) {
      const s = sugere(nome, Object.keys(fonte.parametros))
      cx.erro(`${caminho}/${nome}`, 'dados-arg', `'${nome}' não é um parâmetro da fonte '${fonte.id}'`, s ? `quis dizer '${s}'?` : `parâmetros: ${Object.keys(fonte.parametros).join(', ') || 'nenhum'}`)
    }
    const c = compilaValor(cx, v, escopo, `${caminho}/${nome}`)
    if (campo && c.t === 'lit' && c.v !== null) {
      const r = confereValor(campo, c.v)
      if (!r.ok) cx.erro(`${caminho}/${nome}`, 'dados-arg', `o argumento '${nome}' deveria ser ${r.esperado}`, undefined, c.v)
    }
    out[nome] = c
  }
  return out
}

function faltaObrigatorio(cx: Cx, fonte: FonteDados, informados: Set<string>, caminho: string, quem: string): void {
  for (const [nome, c] of Object.entries(fonte.parametros)) {
    if (c.obrigatorio && c.padrao === undefined && !informados.has(nome)) {
      cx.erro(caminho, 'dados-arg', `${quem}: falta o argumento obrigatório '${nome}' da fonte '${fonte.id}'`, `adicione "${nome}" em args`)
    }
  }
}

function resolveBloco(cx: Cx, interfaceId: string, caminho: string): (IRBloco & { eventos: string[] }) | undefined {
  try {
    const r = cx.reg.resolveBloco(interfaceId, cx.ctx)
    const impl: ImplBloco = r.modelo ? 'composto' : r.codigo ? 'codigo' : 'nativo'
    return { interface: interfaceId, cadeia: r.cadeia, impl, eventos: Object.keys(r.eventos) }
  } catch (e) {
    cx.erro(`${caminho}/bloco`, 'ref', (e as Error).message)
    return undefined
  }
}

// ---- ações ------------------------------------------------------------------

function compilaAcoes(cx: Cx, lista: AcaoSrc[], caminho: string, escopo: readonly string[], prof: number, contador: { n: number }): IRAcao[] {
  if (prof > MAX_PROFUNDIDADE_ACOES) {
    cx.erro(caminho, 'acao-limite', `ações aninhadas demais (mais de ${MAX_PROFUNDIDADE_ACOES} níveis de depois/emErro)`)
    return []
  }
  const pg = cx.pagina!
  const out: IRAcao[] = []
  lista.forEach((a, i) => {
    const c = `${caminho}/${i}`
    if (++contador.n === MAX_ACOES_POR_EVENTO + 1) cx.erro(c, 'acao-limite', `mais de ${MAX_ACOES_POR_EVENTO} ações em um mesmo evento`)
    if (a.acao === 'definir') {
      if (!(a.estado! in pg.estado)) {
        const s = sugere(a.estado!, Object.keys(pg.estado))
        cx.erro(`${c}/estado`, 'acao', `o estado '${a.estado}' não foi declarado em spec.estado`, s ? `quis dizer '${s}'?` : `estados declarados: ${Object.keys(pg.estado).join(', ') || 'nenhum'}`)
      }
      const valor = exprPura(cx, a.valor!, escopo, `${c}/valor`)
      if (valor) out.push({ acao: 'definir', estado: a.estado!, valor, fonte: typeof a.valor === 'string' ? a.valor : formata(valor), caminho: c })
    } else if (a.acao === 'executar') {
      const nome = a.dados!
      const dado = pg.dados[nome]
      if (!dado) {
        const s = sugere(nome, Object.keys(pg.dados))
        cx.erro(`${c}/dados`, 'acao', `a variável de dados '${nome}' não foi declarada em spec.dados`, s ? `quis dizer '${s}'?` : `dados declarados: ${Object.keys(pg.dados).join(', ') || 'nenhum'}`)
      }
      const fonte = dado ? pg.fontes[dado.id] : undefined
      const args = compilaArgs(cx, a.args ?? {}, fonte, escopo, `${c}/args`)
      if (fonte && dado) faltaObrigatorio(cx, fonte, new Set([...Object.keys(dado.args), ...Object.keys(args)]), c, 'executar')
      out.push({
        acao: 'executar', dados: nome, args, caminho: c,
        depois: compilaAcoes(cx, a.depois ?? [], `${c}/depois`, [...escopo, 'resultado'], prof + 1, contador),
        emErro: compilaAcoes(cx, a.emErro ?? [], `${c}/emErro`, [...escopo, 'erro'], prof + 1, contador),
      })
    } else {
      out.push({ acao: 'navegar', para: compilaTexto(cx, a.para!, escopo, `${c}/para`), caminho: c })
    }
  })
  return out
}

// ---- árvore -----------------------------------------------------------------

function compilaInst(cx: Cx, inst: Inst, caminho: string, escopo: readonly string[], cobertas: ReadonlySet<string> = new Set()): IRNo {
  const base = { caminho } as { caminho: string; se?: Expr; repetir?: { cada: Expr; como: string; chave?: Expr } }
  // coleta as variáveis das expressões PRÓPRIAS do nó (se, repetir.cada, props): é o que decide a fronteira de streaming
  const proprio = new Set<string>()
  const anterior = cx.proprio
  cx.proprio = proprio
  // `se` e `repetir.cada` veem só o escopo de fora; `como` e `indice` valem para props, filhos, slots e eventos.
  if (inst.se !== undefined) { const se = exprPura(cx, inst.se, escopo, `${caminho}/se`); if (se !== undefined) base.se = se }
  let interno = escopo
  if (inst.repetir) {
    const cada = exprPura(cx, inst.repetir.cada, escopo, `${caminho}/repetir/cada`)
    const como = inst.repetir.como
    if (escopo.includes(como) || (RESERVADOS as readonly string[]).includes(como)) {
      cx.erro(`${caminho}/repetir/como`, 'repetir', `'${como}' já existe neste escopo ou é reservado e seria sobrescrito`, `escolha outro nome (em uso: ${[...new Set([...escopo, 'indice'])].join(', ')})`)
    }
    interno = [...escopo, como, 'indice']
    const chave = inst.repetir.chave !== undefined ? exprPura(cx, inst.repetir.chave, interno, `${caminho}/repetir/chave`) : undefined
    if (cada) base.repetir = { cada, como, ...(chave ? { chave } : {}) }
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
    cx.proprio = anterior
    return { tipo: 'slot', nome: typeof nome === 'string' ? nome : '', ...base }
  }

  const resolvido = resolveBloco(cx, inst.bloco, caminho)
  const bloco: IRBloco = resolvido ? { interface: resolvido.interface, cadeia: resolvido.cadeia, impl: resolvido.impl } : { interface: inst.bloco, cadeia: [inst.bloco], impl: 'nativo' }
  const props: Record<string, Valor> = {}
  for (const [k, v] of Object.entries((inst.props ?? {}) as Record<string, unknown>)) props[k] = compilaValor(cx, v, interno, `${caminho}/props/${k}`)
  cx.proprio = anterior

  // Fronteira de streaming: o nó usa um dado em streaming que nenhum ancestral já cobre.
  const stream = cx.pagina?.stream
  const novas = stream ? [...proprio].filter((v) => stream.has(v) && !cobertas.has(v)).sort() : []
  const cobertasFilhos = novas.length ? new Set([...cobertas, ...novas]) : cobertas

  const slots: Record<string, IRNo[]> = {}
  for (const [nome, lista] of Object.entries(inst.slots ?? {})) {
    slots[nome] = lista.map((f, n) => compilaInst(cx, f, `${caminho}/slots/${nome}/${n}`, interno, cobertasFilhos))
  }

  let esqueleto: IRNo | undefined
  if (inst.esqueleto) {
    if (!novas.length) {
      cx.erro(`${caminho}/esqueleto`, 'esqueleto', 'esqueleto só tem efeito em instâncias que usam dados em streaming', 'marque o dado com stream: true em spec.dados e use-o nesta instância, ou remova o esqueleto')
    } else {
      // o esqueleto aparece ANTES dos dados chegarem: não pode usá-los
      const semStream = interno.filter((v) => !stream!.has(v))
      esqueleto = compilaInst(cx, inst.esqueleto, `${caminho}/esqueleto`, semStream, stream!)
    }
  }

  let eventos: Record<string, IRAcao[]> | undefined
  if (inst.eventos) {
    if (!cx.pagina) {
      cx.erro(`${caminho}/eventos`, 'evento', 'eventos só são aceitos em instâncias de páginas', 'o modelo de um bloco não tem estado nem dados para as ações usarem')
    } else {
      eventos = {}
      for (const [nome, acoes] of Object.entries(inst.eventos)) {
        if (resolvido && !resolvido.eventos.includes(nome)) {
          const s = sugere(nome, resolvido.eventos)
          cx.erro(`${caminho}/eventos/${nome}`, 'evento', `o bloco '${inst.bloco}' não emite o evento '${nome}'`, s ? `quis dizer '${s}'?` : `eventos do bloco: ${resolvido.eventos.join(', ') || 'nenhum'}`)
        }
        eventos[nome] = compilaAcoes(cx, acoes, `${caminho}/eventos/${nome}`, [...interno, 'evento'], 1, { n: 0 })
      }
    }
  }
  return { tipo: 'elemento', ...(inst.id !== undefined ? { id: inst.id } : {}), bloco, props, slots, ...(eventos ? { eventos } : {}), ...(novas.length ? { aguarda: novas } : {}), ...(esqueleto ? { esqueleto } : {}), ...base }
}

// ---- página -----------------------------------------------------------------

/** Variáveis raiz referenciadas por um Valor compilado. */
function varsDeValor(v: Valor): string[] {
  const out = new Set<string>()
  const anda = (x: Valor): void => {
    if (x.t === 'expr') for (const n of analisa(x.ast).variaveis) out.add(n)
    else if (x.t === 'tpl') for (const p of x.partes) { if (typeof p !== 'string') for (const n of analisa(p.ast).variaveis) out.add(n) }
    else if (x.t === 'arr') x.itens.forEach(anda)
    else if (x.t === 'obj') Object.values(x.campos).forEach(anda)
  }
  anda(v)
  return [...out]
}

type DadoSrc = string | { dados: string; args?: Record<string, unknown>; stream?: boolean }
type EstadoSrc = Record<string, { tipo: string; inicial?: unknown; lista?: boolean }>

function compilaEstado(cx: Cx, src: EstadoSrc): IREstado {
  const out: IREstado = {}
  for (const [nome, d] of Object.entries(src)) {
    if ((RESERVADOS as readonly string[]).includes(nome)) cx.erro(`/spec/estado/${nome}`, 'estado', `'${nome}' é um nome reservado`, `reservados: ${RESERVADOS.join(', ')}`)
    const inicial = d.inicial === undefined ? null : d.inicial
    if (inicial !== null) {
      const r = confereValor({ tipo: d.tipo, ...(d.lista !== undefined ? { lista: d.lista } : {}) }, inicial)
      if (!r.ok) cx.erro(`/spec/estado/${nome}/inicial`, 'estado', `o valor inicial de '${nome}' deveria ser ${r.esperado}`, undefined, inicial)
    }
    out[nome] = { tipo: d.tipo, inicial, ...(d.lista ? { lista: true } : {}) }
  }
  return out
}

function fonteDe(cx: Cx, id: string): FonteDados | undefined {
  const r = cx.reg.resolve('dados', id, cx.ctx)
  if (!r) return undefined // a referência quebrada já é reportada por confere()
  const s = r.no.spec as { fonte: FonteDados['fonte']; parametros?: Record<string, CampoParametro>; cache?: FonteDados['cache']; carregar?: 'auto' | 'manual'; timeoutMs?: number }
  return { id, fonte: s.fonte, parametros: s.parametros ?? {}, ...(s.cache ? { cache: s.cache } : {}), carregar: s.carregar ?? 'auto', ...(s.timeoutMs ? { timeoutMs: s.timeoutMs } : {}) }
}

const MAX_LAYOUTS = 5

/**
 * Envolve o conteúdo da página na cadeia de layouts: o bloco `layout` da página, depois o `layout` (pai) declarado
 * no spec de cada bloco, e assim por diante. Cada layout recebe o que está dentro dele no slot `conteudo`.
 * Só o layout direto da página recebe `layoutProps` (avaliadas no escopo da página).
 */
function envolveEmLayouts(cx: Cx, conteudo: IRNo, layout: string, layoutProps: Record<string, unknown> | undefined, escopo: readonly string[]): IRNo {
  let atual = conteudo
  let iface: string | undefined = layout
  const visitados: string[] = []
  while (iface) {
    if (visitados.includes(iface)) { cx.erro('/spec/layout', 'layout', `layouts em ciclo: ${[...visitados, iface].join(' → ')}`); break }
    if (visitados.length >= MAX_LAYOUTS) { cx.erro('/spec/layout', 'layout', `layouts aninhados demais (mais de ${MAX_LAYOUTS} níveis)`, `cadeia: ${visitados.join(' → ')}`); break }
    const primeiro = visitados.length === 0
    visitados.push(iface)
    let def
    try { def = cx.reg.resolveBloco(iface, cx.ctx) } catch (e) { cx.erro('/spec/layout', 'ref', (e as Error).message); break }
    if (!(SLOT_CONTEUDO in def.slots)) {
      cx.erro('/spec/layout', 'layout', `o bloco '${iface}' é usado como layout e precisa declarar o slot '${SLOT_CONTEUDO}'`, `slots declarados: ${Object.keys(def.slots).join(', ') || 'nenhum'}`)
      break
    }
    const props: Record<string, Valor> = {}
    if (primeiro) {
      for (const [k, v] of Object.entries(layoutProps ?? {})) {
        const c = compilaValor(cx, v, escopo, `/spec/layoutProps/${k}`)
        const emStream = cx.pagina ? varsDeValor(c).filter((n) => cx.pagina!.stream.has(n)) : []
        if (emStream.length) cx.erro(`/spec/layoutProps/${k}`, 'layout', `layoutProps não pode depender de dado em streaming (${emStream.join(', ')}): o layout envolve a página e não tem esqueleto`, 'use um dado bloqueante')
        props[k] = c
      }
    }
    const impl: ImplBloco = def.modelo ? 'composto' : def.codigo ? 'codigo' : 'nativo'
    atual = { tipo: 'elemento', caminho: primeiro ? '/spec/layout' : `layout:${iface}`, bloco: { interface: iface, cadeia: def.cadeia, impl }, props, slots: { [SLOT_CONTEUDO]: [atual] } }
    iface = (cx.reg.resolve('bloco', iface, cx.ctx)?.no.spec as { layout?: string } | undefined)?.layout
  }
  return atual
}

/** Compila uma página (nó `pagina`) para IR. Inclui os erros de referência, slots, props, ciclos e limites. */
export function compilaPagina(reg: Registry, no: No, ctx: Contexto = {}): Resultado<IRPagina> {
  if (no.kind !== 'pagina') return { ok: false, erros: [{ caminho: '/kind', regra: 'kind', mensagem: `compilaPagina espera kind 'pagina', recebeu '${no.kind}'` }] }
  const spec = no.spec as { rota: string; titulo?: string; dados?: Record<string, DadoSrc>; estado?: EstadoSrc; raiz: Inst; layout?: string; layoutProps?: Record<string, unknown> }
  const base = new Cx(reg, ctx, 'pagina')
  base.erros.push(...confere(reg, no, ctx))

  const estado = compilaEstado(base, spec.estado ?? {})
  const dados: Record<string, IRDado> = {}
  const fontes: Record<string, FonteDados> = {}
  for (const [nome, d] of Object.entries(spec.dados ?? {})) {
    const caminho = `/spec/dados/${nome}`
    if ((RESERVADOS as readonly string[]).includes(nome)) {
      base.erro(caminho, 'dados', `'${nome}' é um nome reservado da página e sombrearia o valor do sistema`, `escolha outro nome (reservados: ${RESERVADOS.join(', ')})`)
    }
    const id = typeof d === 'string' ? d : d.dados
    const fonte = fonteDe(base, id)
    if (fonte) fontes[id] = fonte
    const args = typeof d === 'string' ? {} : compilaArgs(base, d.args ?? {}, fonte, ESCOPO_ARGS, `${caminho}/args`)
    if (fonte && fonte.carregar === 'auto') faltaObrigatorio(base, fonte, new Set(Object.keys(args)), caminho, `a variável '${nome}'`)
    dados[nome] = { id, args, stream: typeof d !== 'string' && d.stream === true }
    if (dados[nome]!.stream && fonte?.carregar === 'manual') {
      base.erro(caminho, 'dados', `'${nome}' é manual: só uma ação executar o carrega, então não há o que transmitir em streaming`, 'remova stream: true ou use carregar: auto')
    }
  }

  const stream = new Set(Object.entries(dados).filter(([, d]) => d.stream).map(([n]) => n))
  const cx = new Cx(reg, ctx, 'pagina', [], { estado, dados, fontes, stream })
  cx.erros.push(...base.erros)
  for (const v of base.usa) cx.usa.add(v)
  const escopo = [...ESCOPO_PAGINA, ...Object.keys(dados)]
  const titulo = spec.titulo !== undefined ? compilaTexto(cx, spec.titulo, escopo, '/spec/titulo') : undefined
  if (titulo) {
    const usados = varsDeValor(titulo).filter((v) => stream.has(v))
    if (usados.length) cx.erro('/spec/titulo', 'titulo', `o título não pode depender de dado em streaming (${usados.join(', ')}): ele é enviado antes de os dados chegarem`, 'use um dado bloqueante no título ou tire a variável dele')
  }
  const conteudo = compilaInst(cx, spec.raiz, '/spec/raiz', escopo)
  if (spec.layoutProps && !spec.layout) cx.erro('/spec/layoutProps', 'layout', 'layoutProps sem layout: não há bloco de layout para recebê-las', 'declare spec.layout ou remova layoutProps')
  const raiz = spec.layout ? envolveEmLayouts(cx, conteudo, spec.layout, spec.layoutProps, escopo) : conteudo
  if (cx.erros.length) return { ok: false, erros: cx.erros }
  return { ok: true, ir: { tipo: 'pagina', id: no.id, versao: no.versao, rota: spec.rota, ...(titulo ? { titulo } : {}), dados, fontes, estado, raiz, usa: [...cx.usa].sort() } }
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
