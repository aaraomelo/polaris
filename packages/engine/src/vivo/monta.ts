import { avalia, verdadeiro, type Escopo } from '../expr/avalia'
import type { Funcoes } from '../expr/tipos'
import type { IRElemento, IRNo } from '../ir/tipos'
import { criaModeloNucleo, type ModeloNucleo, type OpcoesNucleo } from '../modelo/nucleo'
import { executaAcoes } from '../render/acoes'
import type { Programa } from '../render/programa'
import type { AcaoStore, Store } from '../render/store'
import { LIMITES_RUNTIME, type ErroRuntime } from '../render/tipos'
import { valorDe } from '../render/valor'
import type { DescritoresDom } from './blocos'
import { descritoresPadrao } from '../expr/padrao'
import { caminhosMudados } from '../estado/caminho'
import { chavesDeCaminhos, cruza, depsCabeca, depsValor, MARCA, raizDe, usaTotal } from './dep'
import { aplicaLista, planoLista } from './lista'
import { Divergencia, Pos } from './pos'

// ---------------------------------------------------------------------------
// Espelho DOM do Modelo. O DOM é só uma projeção: toda a verdade está no store imutável (src/modelo).
//   - cada expressão sabe de quais chaves depende (dep.ts); o Modelo entrega as chaves que mudaram e só o que depende delas roda;
//   - listas com chave usam LIS (lista.ts); sem chave, a posição é a identidade;
//   - eventos: um listener por tipo no contêiner (delegação);
//   - hidratação: o MESMO construtor, só que adotando os nós que o servidor já pôs (pos.ts);
//   - mundo fechado: subárvores que não dependem de nada que possa mudar não ganham controlador algum.
// O oráculo de correção é o React: o DOM final tem de ser igual ao do SSR do mesmo estado.
// ---------------------------------------------------------------------------

type Esc = Record<string, unknown>
type Ctrl = { usa: Set<string>; morto: boolean; atualiza(m: ReadonlySet<string>): void; destroi(): void }
type Dono = { nos: Ctrl[] }
type Host = Record<string, (pos: Pos) => Ctrl | null>
type Entrada = { h: Record<string, (e: Event) => void>; sync?: () => void }

type Amb = {
  programa: Programa
  desc: DescritoresDom
  funcoes: Funcoes
  modelo: ModeloNucleo
  handlers: WeakMap<Node, Entrada>
  stats: { controladores: number }
  onErro?: (e: ErroRuntime) => void
}
/** Contexto de construção de um nó: escopo, host dos slots, chaves que podem mudar neste escopo e profundidade. */
type Cx = { esc: Esc; host: Host | null; mut: ReadonlySet<string> | null; prof: number }

const tem = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k)
const copia = <T>(a: readonly T[]) => a.slice()

function destroiNos(nos: Ctrl[]): void { for (const n of copia(nos)) n.destroi(); nos.length = 0 }
function atualizaNos(nos: Ctrl[], m: ReadonlySet<string>): void { for (const n of copia(nos)) if (!n.morto && cruza(n.usa, m)) n.atualiza(m) }

function faixa(ini: Node, fim: Node): Node[] { const r: Node[] = []; for (let n: Node | null = ini; n; n = n.nextSibling) { r.push(n); if (n === fim) break } return r }
function removeFaixa(ini: Node, fim: Node): void { for (const n of faixa(ini, fim)) n.parentNode?.removeChild(n) }
function moveFaixa(ini: Node, fim: Node, pai: Node, ref: Node | null): void { for (const n of faixa(ini, fim)) pai.insertBefore(n, ref) }
function limpaEntre(ini: Node, fim: Node): void { while (ini.nextSibling && ini.nextSibling !== fim) ini.parentNode!.removeChild(ini.nextSibling) }

function igual(a: unknown, b: unknown, prof = 0): boolean {
  if (Object.is(a, b)) return true
  if (prof > 4 || typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false
  if (Array.isArray(a) !== Array.isArray(b)) return false
  const ka = Object.keys(a), kb = Object.keys(b)
  if (ka.length !== kb.length) return false
  for (const k of ka) if (!tem(b, k) || !igual((a as Esc)[k], (b as Esc)[k], prof + 1)) return false
  return true
}

function avaliaProps(no: IRElemento, esc: Esc, f: Funcoes): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [k, v] of Object.entries(no.props)) out[k] = valorDe(v, esc, f)
  return out
}
function depsProps(no: IRElemento): Set<string> { const s = new Set<string>(); for (const v of Object.values(no.props)) depsValor(v, s); return s }

/** Alguma dependência pode ser afetada por alguma chave mutável? Um caminho contém o outro: `estado.itens.0.nome` × `estado.itens` (e o inverso). */
function cruzaMut(deps: ReadonlySet<string>, mut: ReadonlySet<string>): boolean {
  for (const k of deps) {
    for (let i = k.indexOf('.'); ; i = k.indexOf('.', i + 1)) { if (mut.has(i < 0 ? k : k.slice(0, i))) return true; if (i < 0) break } // k ou um prefixo de k é mutável
    for (const m of mut) if (m.startsWith(`${k}.`)) return true // algo DENTRO de k é mutável
  }
  return false
}
/** Nó sem nada que possa mudar: não precisa de controlador. */
const estatico = (no: IRNo, cx: Cx): boolean => cx.mut !== null && !cruzaMut(usaTotal(no), cx.mut)
const regista = (amb: Amb, dono: Dono, c: Ctrl) => { amb.stats.controladores++; dono.nos.push(c) }

// ---- construção ------------------------------------------------------------

function constroi(no: IRNo, cx: Cx, dono: Dono, amb: Amb, pos: Pos): void {
  if (cx.prof > LIMITES_RUNTIME.profundidade) { amb.onErro?.({ caminho: no.caminho, regra: 'limite', mensagem: `profundidade de renderização acima de ${LIMITES_RUNTIME.profundidade}` }); return }
  if (no.se) return constroiSe(no, cx, dono, amb, pos)
  return constroiRep(no, cx, dono, amb, pos)
}

function constroiSe(no: IRNo, cx: Cx, dono: Dono, amb: Amb, pos: Pos): void {
  const { esc } = cx
  const { se } = depsCabeca(no)
  let sub: Dono | null = null
  let fim!: Comment
  const ini = pos.com(); pos.coloca(ini)
  const monta = (p: Pos) => { sub = { nos: [] }; constroiRep(no, cx, sub, amb, p) }
  if (verdadeiro(avalia(no.se!, esc as Escopo, amb.funcoes))) monta(pos)
  fim = pos.com(); pos.coloca(fim)
  if (estatico(no, cx)) { sub = null; return }
  regista(amb, dono, {
    usa: usaTotal(no), morto: false,
    atualiza(m) {
      if (cruza(se, m)) {
        const c = verdadeiro(avalia(no.se!, esc as Escopo, amb.funcoes))
        if (c && !sub) return monta(new Pos(fim.parentNode!, fim, false))
        if (!c && sub) { destroiNos(sub.nos); limpaEntre(ini, fim); sub = null; return }
      }
      if (sub) atualizaNos(sub.nos, m)
    },
    destroi() { this.morto = true; if (sub) destroiNos(sub.nos) },
  })
}

type Item = { chave: string; ini: Comment; fim: Comment; esc: Esc; dono: Dono; item: unknown; i: number; readonly parentNode: Node | null }

function constroiRep(no: IRNo, cx: Cx, dono: Dono, amb: Amb, pos: Pos): void {
  if (!no.repetir) return constroiUm(no, cx, dono, amb, pos)
  const { esc } = cx
  const { como, cada, chave: exprChave } = no.repetir
  const { cabeca } = depsCabeca(no)
  const itens = new Map<string, Item>()
  let ordem: Item[] = []
  // se a lista é constante, cada item também é: `como` e `indice` não mudam
  const dinamica = cx.mut === null || cruzaMut(cabeca, cx.mut)
  const mutItem = cx.mut === null ? null : dinamica ? new Set([...cx.mut, como, 'indice']) : cx.mut

  const criaItem = (chave: string, item: unknown, i: number, p: Pos): Item => {
    const a = p.com(); p.coloca(a)
    const itemEsc: Esc = { ...esc, [como]: item, indice: i }
    const d: Dono = { nos: [] }
    constroiUm(no, { ...cx, esc: itemEsc, mut: mutItem }, d, amb, p)
    const b = p.com(); p.coloca(b)
    return { chave, ini: a, fim: b, esc: itemEsc, dono: d, item, i, get parentNode() { return a.parentNode } }
  }
  let fim!: Comment
  const paiLista = {
    insertBefore(it: Item, r: Item | null) { moveFaixa(it.ini, it.fim, fim.parentNode!, r ? r.ini : fim) },
    removeChild(it: Item) { removeFaixa(it.ini, it.fim); destroiNos(it.dono.nos) },
  }
  const atualizaItem = (it: Item, m: ReadonlySet<string>, novo?: { item: unknown; i: number }) => {
    const mi = new Set<string>()
    for (const k of m) {
      const r = raizDe(k)
      if (r === como || r === 'indice') continue
      mi.add(k)
      if (tem(esc, r)) it.esc[r] = esc[r]; else delete it.esc[r]
    }
    if (novo) {
      // o item mudou: só os CAMINHOS dele que mudaram (p.preco, não p inteiro) acordam as expressões do item
      if (!Object.is(it.item, novo.item)) { chavesDeCaminhos(como, caminhosMudados(it.item, novo.item), mi); it.item = novo.item; it.esc[como] = novo.item }
      if (it.i !== novo.i) { it.i = novo.i; it.esc.indice = novo.i; mi.add('indice'); mi.add(`indice${MARCA}`) }
    }
    if (mi.size) atualizaNos(it.dono.nos, mi)
  }
  const calcula = (): Array<{ chave: string; item: unknown; i: number }> => {
    const l = avalia(cada, esc as Escopo, amb.funcoes)
    if (!Array.isArray(l)) return []
    if (l.length > LIMITES_RUNTIME.iteracoes) amb.onErro?.({ caminho: no.caminho, regra: 'limite', mensagem: `repetir com ${l.length} itens; renderizando os primeiros ${LIMITES_RUNTIME.iteracoes}` })
    const vistos = new Set<string>()
    const out: Array<{ chave: string; item: unknown; i: number }> = []
    const n = Math.min(l.length, LIMITES_RUNTIME.iteracoes)
    for (let i = 0; i < n; i++) {
      const item = l[i]
      let c: string
      if (exprChave) {
        const v = avalia(exprChave, { ...esc, [como]: item, indice: i } as Escopo, amb.funcoes)
        c = typeof v === 'string' || typeof v === 'number' || typeof v === 'boolean' ? String(v) : `\u0001${i}`
      } else c = String(i)
      while (vistos.has(c)) c += '\u0000'
      vistos.add(c)
      out.push({ chave: c, item, i })
    }
    return out
  }
  const reconcilia = (m: ReadonlySet<string>) => {
    const novos = calcula()
    const plano = planoLista(ordem.map((x) => x.chave), novos.map((x) => x.chave))
    const dados = new Map(novos.map((x) => [x.chave, x]))
    const criados = new Set<string>()
    aplicaLista<Item>(paiLista, itens, plano, (c) => { criados.add(c); const d = dados.get(c)!; return criaItem(c, d.item, d.i, new Pos(document.createDocumentFragment(), null, false)) })
    ordem = novos.map((x) => itens.get(x.chave)!)
    for (const x of novos) if (!criados.has(x.chave)) atualizaItem(itens.get(x.chave)!, m, x)
  }

  const ini = pos.com(); pos.coloca(ini)
  for (const x of calcula()) { const it = criaItem(x.chave, x.item, x.i, pos); itens.set(x.chave, it); ordem.push(it) }
  fim = pos.com(); pos.coloca(fim)
  if (estatico(no, cx)) return
  regista(amb, dono, {
    usa: usaTotal(no), morto: false,
    atualiza(m) {
      if (cruza(cabeca, m)) reconcilia(m)
      else for (const it of ordem) atualizaItem(it, m)
    },
    destroi() { this.morto = true; for (const it of ordem) destroiNos(it.dono.nos) },
  })
}

function constroiUm(no: IRNo, cx: Cx, dono: Dono, amb: Amb, pos: Pos): void {
  if (no.tipo === 'slot') {
    const h = cx.host?.[no.nome]
    if (!h) return
    const conteudo = h(pos)
    if (conteudo) regista(amb, dono, { usa: new Set(), morto: false, atualiza() {}, destroi() { this.morto = true; conteudo.destroi() } })
    return
  }
  if (no.bloco.impl === 'composto') return constroiComposto(no, cx, dono, amb, pos)
  if (no.bloco.impl === 'codigo') { amb.onErro?.({ caminho: no.caminho, regra: 'componente-ausente', mensagem: `bloco de código '${no.bloco.interface}' não é suportado pelo runtime vivo` }); return }
  return constroiNativo(no, cx, dono, amb, pos)
}

function constroiComposto(no: IRElemento, cx: Cx, dono: Dono, amb: Amb, pos: Pos): void {
  const m = amb.programa.blocos[no.bloco.interface]
  if (!m) { amb.onErro?.({ caminho: no.caminho, regra: 'bloco-ausente', mensagem: `modelo do bloco '${no.bloco.interface}' não está no programa` }); return }
  const { esc } = cx
  const deps = depsProps(no)
  let props = avaliaProps(no, esc, amb.funcoes)
  const inner: Esc = { props, tenant: esc.tenant }
  const nosInner: Dono = { nos: [] }
  // as props só mudam se alguma dependência delas pode mudar
  const propsMudam = cx.mut === null || cruzaMut(deps, cx.mut)
  const mutInner = cx.mut === null ? null : propsMudam ? new Set([...cx.mut, 'props']) : cx.mut
  // slots: o conteúdo é construído no escopo de FORA, só quando o modelo chamar core/slot
  const hostSlots: Host = {}
  for (const [nome, lista] of Object.entries(no.slots)) {
    const usa = new Set<string>(); for (const f of lista) for (const k of usaTotal(f)) usa.add(k)
    const fixo = cx.mut !== null && !cruzaMut(usa, cx.mut)
    hostSlots[nome] = (p) => {
      const sub: Dono = { nos: [] }
      for (const f of lista) constroi(f, { ...cx, prof: cx.prof + 1 }, sub, amb, p)
      if (fixo) return null
      const c: Ctrl = {
        usa, morto: false,
        atualiza(mm) { atualizaNos(sub.nos, mm) },
        destroi() { if (this.morto) return; this.morto = true; const i = dono.nos.indexOf(c); if (i >= 0) dono.nos.splice(i, 1); destroiNos(sub.nos) },
      }
      regista(amb, dono, c)
      return c
    }
  }
  constroi(m.modelo, { esc: inner, host: hostSlots, mut: mutInner, prof: cx.prof + 1 }, nosInner, amb, pos)
  if (estatico(no, cx)) return
  regista(amb, dono, {
    usa: usaTotal(no), morto: false,
    atualiza(mm) {
      if (!cruza(deps, mm)) return
      const np = avaliaProps(no, esc, amb.funcoes)
      if (igual(props, np)) return
      const mi = new Set<string>()
      for (const k of new Set([...Object.keys(props), ...Object.keys(np)])) {
        if (!igual(props[k], np[k])) chavesDeCaminhos('props', caminhosMudados(props[k], np[k]).map((f) => [k, ...f]), mi)
      }
      props = np; inner.props = np
      atualizaNos(nosInner.nos, mi)
    },
    destroi() { this.morto = true; destroiNos(nosInner.nos) },
  })
}

/** Atributos: ao adotar, só escreve o que difere do HTML do servidor. */
function poeAttr(el: Element, k: string, v: string): void { if (el.getAttribute(k) !== v) el.setAttribute(k, v) }

function constroiNativo(no: IRElemento, cx: Cx, dono: Dono, amb: Amb, pos: Pos): void {
  const nome = no.bloco.cadeia.find((c) => tem(amb.desc, c))
  if (!nome) { amb.onErro?.({ caminho: no.caminho, regra: 'componente-ausente', mensagem: `não há descritor para '${no.bloco.interface}' (cadeia: ${no.bloco.cadeia.join(' → ')})` }); return }
  const { esc, host } = cx
  const d = amb.desc[nome]!
  const deps = depsProps(no)
  let props = avaliaProps(no, esc, amb.funcoes)
  let chave: string | null = null
  let atual!: Node
  let attrs: Record<string, string> = {}
  const filhos: Dono = { nos: [] }

  const cria = (p: Pos) => {
    chave = d.chave(props)
    if (chave === null) { atual = p.com(); p.coloca(atual); return }
    const el = p.el(d.tag(props))
    attrs = d.attrs(props, no.id)
    for (const [k, v] of Object.entries(attrs)) poeAttr(el, k, v)
    if (d.valor) (el as HTMLInputElement).value = d.valor(props)
    const t = d.texto?.(props)
    if (t !== undefined) { if (el.textContent !== t) el.textContent = t }
    else if (d.filhos) {
      const dentro = p.dentro(el)
      for (const f of no.slots.filhos ?? []) constroi(f, { ...cx, prof: cx.prof + 1 }, filhos, amb, dentro)
      dentro.confere()
    }
    if (no.eventos && d.eventos) {
      const h: Record<string, (e: Event) => void> = {}
      for (const [evento, acoes] of Object.entries(no.eventos)) {
        const ev = d.eventos[evento]
        if (ev) h[ev.dom] = (e) => { void executaAcoes(acoes, esc as Escopo, { evento: ev.payload?.(e) }, amb.modelo.cx) }
      }
      const entrada: Entrada = { h }
      if (d.valor) entrada.sync = () => { const v = d.valor!(props); if ((el as HTMLInputElement).value !== v) (el as HTMLInputElement).value = v }
      amb.handlers.set(el, entrada)
    }
    atual = el; p.coloca(el)
  }
  cria(pos)
  if (estatico(no, cx)) return

  regista(amb, dono, {
    usa: usaTotal(no), morto: false,
    atualiza(m) {
      if (cruza(deps, m)) {
        const np = avaliaProps(no, esc, amb.funcoes)
        if (!igual(props, np)) {
          const k = d.chave(np)
          if (k !== chave) {
            destroiNos(filhos.nos)
            const velho = atual
            props = np
            const df = document.createDocumentFragment()
            cria(new Pos(df, null, false))
            velho.parentNode?.replaceChild(atual, velho)
            return
          }
          props = np
          if (atual.nodeType === 1) {
            const el = atual as Element
            const na = d.attrs(np, no.id)
            for (const a of Object.keys(attrs)) if (!tem(na, a)) el.removeAttribute(a)
            for (const [a, v] of Object.entries(na)) if (attrs[a] !== v) el.setAttribute(a, v)
            attrs = na
            const t = d.texto?.(np)
            if (t !== undefined && el.textContent !== t) el.textContent = t
            if (d.valor) { const v = d.valor(np); if ((el as HTMLInputElement).value !== v) (el as HTMLInputElement).value = v }
          }
        }
      }
      atualizaNos(filhos.nos, m)
    },
    destroi() { this.morto = true; destroiNos(filhos.nos) },
  })
}

// ---- raiz ------------------------------------------------------------------

export type OpcoesVivo = Omit<OpcoesNucleo, 'programa'> & {
  programa: Programa
  container: Element
  descritores?: DescritoresDom
  /** adota o HTML que o servidor já pôs no contêiner (em vez de construir). Se divergir, reconstrói tudo e avisa por onErro. */
  hidrata?: boolean
}

export type Vivo = {
  /** o modelo (store imutável, ações). O DOM é só o espelho dele. Histórico/desfazer: `montaVivo` (completo) ou `anexaHistorico(modelo, n)`. */
  modelo: ModeloNucleo
  store(): Store
  despacha(a: AcaoStore): void
  flush(): void
  titulo(): string
  /** quantos controladores (efeitos de atualização) ficaram retidos: nós estáticos não geram nenhum */
  diagnostico(): { controladores: number; hidratou: boolean }
  destroi(): void
}

/** Monta (ou hidrata) a página DENTRO de `container` e a mantém viva. Não usa React. Núcleo: sem histórico (ver `montaVivo` em vivo/index). */
export function montaVivoNucleo(o: OpcoesVivo): Vivo {
  const programa = o.programa
  const modelo = criaModeloNucleo(o)
  const handlers = new WeakMap<Node, Entrada>()
  const funcoes = modelo.cx.funcoes!
  let stats = { controladores: 0 }
  let raiz: Dono = { nos: [] }
  let hidratou = false
  const amb = (): Amb => ({ programa, desc: o.descritores ?? descritoresPadrao(), funcoes, modelo, handlers, stats, ...(o.onErro ? { onErro: o.onErro } : {}) })
  const cx: Cx = { esc: modelo.escopo as Esc, host: null, mut: modelo.mutaveis, prof: 0 }

  const constroiTudo = (adota: boolean) => {
    const pos = new Pos(o.container, null, adota, adota ? o.container.firstChild : null)
    constroi(programa.pagina.raiz, cx, raiz, amb(), pos)
    pos.confere()
  }
  if (o.hidrata) {
    try { constroiTudo(true); hidratou = true } catch (e) {
      if (!(e instanceof Divergencia)) throw e
      o.onErro?.({ caminho: programa.pagina.raiz.caminho, regra: 'hidratacao', mensagem: `HTML do servidor diverge do cliente (${e.message}); reconstruindo` })
      destroiNos(raiz.nos); raiz = { nos: [] }; stats = { controladores: 0 }
      o.container.textContent = ''
      constroiTudo(false)
    }
  } else constroiTudo(false)

  const desassina = modelo.assina((m) => atualizaNos(raiz.nos, m.mudou))
  const ouve = (e: Event) => {
    for (let n = e.target as Node | null; n && n !== o.container; n = n.parentNode) {
      const ent = handlers.get(n)
      const fn = ent?.h[e.type]
      if (fn) { fn(e); modelo.flush(); ent!.sync?.() }
    }
  }
  const tipos = ['click', 'input']
  for (const t of tipos) o.container.addEventListener(t, ouve)

  return {
    modelo, store: modelo.store, despacha: modelo.despacha, flush: modelo.flush,
    titulo: () => { const t = programa.pagina.titulo; if (!t) return ''; const v = valorDe(t, modelo.escopo, funcoes); return v === null || v === undefined || typeof v === 'object' ? '' : String(v) },
    diagnostico: () => ({ controladores: stats.controladores, hidratou }),
    destroi() { desassina(); modelo.destroi(); for (const t of tipos) o.container.removeEventListener(t, ouve); destroiNos(raiz.nos) },
  }
}

/** A página pode rodar no runtime vivo? (sem streaming, esqueleto, blocos de código nem blocos sem descritor) */
export function elegivelVivo(programa: Programa, descritores: DescritoresDom = descritoresPadrao()): { ok: true } | { ok: false; motivos: Array<{ caminho: string; motivo: string }> } {
  const motivos: Array<{ caminho: string; motivo: string }> = []
  for (const [n, d] of Object.entries(programa.pagina.dados)) if (d.stream) motivos.push({ caminho: `/spec/dados/${n}`, motivo: 'dado em streaming' })
  const anda = (no: IRNo, visitados: Set<string>) => {
    if (no.tipo !== 'elemento') return
    if (no.aguarda?.length) motivos.push({ caminho: no.caminho, motivo: 'usa dado em streaming' })
    if (no.esqueleto) motivos.push({ caminho: no.caminho, motivo: 'tem esqueleto (streaming)' })
    if (no.bloco.impl === 'codigo') motivos.push({ caminho: no.caminho, motivo: `o bloco '${no.bloco.interface}' é código customizado` })
    else if (no.bloco.impl === 'nativo' && !no.bloco.cadeia.some((c) => tem(descritores, c))) motivos.push({ caminho: no.caminho, motivo: `o bloco '${no.bloco.interface}' não tem descritor DOM` })
    else if (no.bloco.impl === 'composto' && !visitados.has(no.bloco.interface)) {
      visitados.add(no.bloco.interface)
      const m = programa.blocos[no.bloco.interface]
      if (m) anda(m.modelo, visitados)
    }
    for (const l of Object.values(no.slots)) for (const f of l) anda(f, visitados)
  }
  anda(programa.pagina.raiz, new Set())
  return motivos.length ? { ok: false, motivos } : { ok: true }
}
