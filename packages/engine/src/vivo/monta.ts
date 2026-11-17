import { avalia, FUNCOES_PADRAO, verdadeiro, type Escopo, type Funcoes } from '../expr/index'
import type { IRElemento, IRNo } from '../ir/tipos'
import { executaAcoes, type Carregador, type ContextoAcoes } from '../render/acoes'
import type { Programa } from '../render/programa'
import { escopoDaStore, iniciaStore, reduz, type AcaoStore, type SementeStore, type Store } from '../render/store'
import { LIMITES_RUNTIME, type ErroRuntime } from '../render/tipos'
import { valorDe } from '../render/valor'
import { DESCRITORES_BASE, type DescritoresDom } from './blocos'
import { cruza, depsCabeca, depsValor, raizDe, usaTotal } from './dep'
import { aplicaLista, planoLista } from './lista'

// ---------------------------------------------------------------------------
// Runtime "vivo": constrói o DOM direto do IR e o mantém atualizado a partir do store imutável, SEM React e sem VDOM.
//   - cada expressão sabe de quais chaves depende (dep.ts); a cada ação, o diff por referência do store dá as chaves
//     que mudaram e só os efeitos que dependem delas rodam;
//   - listas com chave usam LIS (lista.ts); sem chave, a posição é a identidade;
//   - eventos: um listener por tipo no contêiner (delegação).
// O oráculo de correção é o React: o DOM final tem de ser igual ao do SSR do mesmo estado.
// ---------------------------------------------------------------------------

type Esc = Record<string, unknown>
type Ctrl = { usa: Set<string>; morto: boolean; atualiza(m: Set<string>): void; destroi(): void }
type Dono = { nos: Ctrl[] }
type Host = Record<string, (pai: Node, ref: Node | null) => Ctrl>
type Entrada = { h: Record<string, (e: Event) => void>; sync?: () => void }

type Amb = {
  programa: Programa
  desc: DescritoresDom
  funcoes: Funcoes
  cx: ContextoAcoes
  handlers: WeakMap<Node, Entrada>
  onErro?: (e: ErroRuntime) => void
}

const tem = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k)
const copia = <T>(a: readonly T[]) => a.slice()

function destroiNos(nos: Ctrl[]): void { for (const n of copia(nos)) n.destroi(); nos.length = 0 }
function atualizaNos(nos: Ctrl[], m: Set<string>): void { for (const n of copia(nos)) if (!n.morto && cruza(n.usa, m)) n.atualiza(m) }

function marca(pai: Node, ref: Node | null): { ini: Comment; fim: Comment } {
  const ini = document.createComment(''), fim = document.createComment('')
  pai.insertBefore(ini, ref); pai.insertBefore(fim, ref)
  return { ini, fim }
}
function faixa(ini: Node, fim: Node): Node[] { const r: Node[] = []; for (let n: Node | null = ini; n; n = n.nextSibling) { r.push(n); if (n === fim) break } return r }
function removeFaixa(ini: Node, fim: Node): void { for (const n of faixa(ini, fim)) n.parentNode?.removeChild(n) }
function moveFaixa(ini: Node, fim: Node, pai: Node, ref: Node | null): void { for (const n of faixa(ini, fim)) pai.insertBefore(n, ref) }
/** remove o que está ENTRE os marcadores (exclusive) */
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

// ---- construção ------------------------------------------------------------

function constroi(no: IRNo, esc: Esc, dono: Dono, host: Host | null, amb: Amb, pai: Node, ref: Node | null, prof: number): void {
  if (prof > LIMITES_RUNTIME.profundidade) { amb.onErro?.({ caminho: no.caminho, regra: 'limite', mensagem: `profundidade de renderização acima de ${LIMITES_RUNTIME.profundidade}` }); return }
  if (no.se) return constroiSe(no, esc, dono, host, amb, pai, ref, prof)
  return constroiRep(no, esc, dono, host, amb, pai, ref, prof)
}

function constroiSe(no: IRNo, esc: Esc, dono: Dono, host: Host | null, amb: Amb, pai: Node, ref: Node | null, prof: number): void {
  const { se } = depsCabeca(no)
  const { ini, fim } = marca(pai, ref)
  let sub: Dono | null = null
  const monta = () => { sub = { nos: [] }; constroiRep(no, esc, sub, host, amb, fim.parentNode!, fim, prof) }
  const desmonta = () => { destroiNos(sub!.nos); limpaEntre(ini, fim); sub = null }
  const ctrl: Ctrl = {
    usa: usaTotal(no), morto: false,
    atualiza(m) {
      if (cruza(se, m)) {
        const c = verdadeiro(avalia(no.se!, esc as Escopo, amb.funcoes))
        if (c && !sub) return monta()
        if (!c && sub) return desmonta()
      }
      if (sub) atualizaNos(sub.nos, m)
    },
    destroi() { this.morto = true; if (sub) destroiNos(sub.nos) },
  }
  dono.nos.push(ctrl)
  if (verdadeiro(avalia(no.se!, esc as Escopo, amb.funcoes))) monta()
}

type Item = { chave: string; ini: Comment; fim: Comment; esc: Esc; dono: Dono; item: unknown; i: number; readonly parentNode: Node | null }

function constroiRep(no: IRNo, esc: Esc, dono: Dono, host: Host | null, amb: Amb, pai: Node, ref: Node | null, prof: number): void {
  if (!no.repetir) return constroiUm(no, esc, dono, host, amb, pai, ref, prof)
  const { como, cada, chave: exprChave } = no.repetir
  const { cabeca } = depsCabeca(no)
  const { ini, fim } = marca(pai, ref)
  const itens = new Map<string, Item>()
  let ordem: Item[] = []

  const criaItem = (chave: string, item: unknown, i: number): Item => {
    const df = document.createDocumentFragment()
    const a = document.createComment(''), b = document.createComment('')
    df.appendChild(a); df.appendChild(b)
    const itemEsc: Esc = { ...esc, [como]: item, indice: i }
    const d: Dono = { nos: [] }
    constroiUm(no, itemEsc, d, host, amb, df, b, prof)
    return { chave, ini: a, fim: b, esc: itemEsc, dono: d, item, i, get parentNode() { return a.parentNode } }
  }
  const paiLista = {
    insertBefore(it: Item, r: Item | null) { moveFaixa(it.ini, it.fim, fim.parentNode!, r ? r.ini : fim) },
    removeChild(it: Item) { removeFaixa(it.ini, it.fim); destroiNos(it.dono.nos) },
  }

  const atualizaItem = (it: Item, m: Set<string>, novo?: { item: unknown; i: number }) => {
    const mi = new Set<string>()
    for (const k of m) {
      const r = raizDe(k)
      if (r === como || r === 'indice') continue
      mi.add(k)
      if (tem(esc, r)) it.esc[r] = esc[r]; else delete it.esc[r]
    }
    if (novo) {
      if (!Object.is(it.item, novo.item)) { it.item = novo.item; it.esc[como] = novo.item; mi.add(como) }
      if (it.i !== novo.i) { it.i = novo.i; it.esc.indice = novo.i; mi.add('indice') }
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
      while (vistos.has(c)) c += '\u0000' // chave repetida: desambigua de forma determinística
      vistos.add(c)
      out.push({ chave: c, item, i })
    }
    return out
  }

  const reconcilia = (m: Set<string>) => {
    const novos = calcula()
    const plano = planoLista(ordem.map((x) => x.chave), novos.map((x) => x.chave))
    const dados = new Map(novos.map((x) => [x.chave, x]))
    const criados = new Set<string>()
    aplicaLista<Item>(paiLista, itens, plano, (c) => { criados.add(c); const d = dados.get(c)!; return criaItem(c, d.item, d.i) })
    ordem = novos.map((x) => itens.get(x.chave)!)
    for (const x of novos) if (!criados.has(x.chave)) atualizaItem(itens.get(x.chave)!, m, x)
  }

  const ctrl: Ctrl = {
    usa: usaTotal(no), morto: false,
    atualiza(m) {
      if (cruza(cabeca, m)) reconcilia(m)
      else for (const it of ordem) atualizaItem(it, m)
    },
    destroi() { this.morto = true; for (const it of ordem) destroiNos(it.dono.nos) },
  }
  dono.nos.push(ctrl)
  // construção inicial: itens direto antes do marcador final
  for (const x of calcula()) {
    const it = criaItem(x.chave, x.item, x.i)
    itens.set(x.chave, it); ordem.push(it)
    moveFaixa(it.ini, it.fim, fim.parentNode!, fim)
  }
  void ini
}

function constroiUm(no: IRNo, esc: Esc, dono: Dono, host: Host | null, amb: Amb, pai: Node, ref: Node | null, prof: number): void {
  if (no.tipo === 'slot') {
    const h = host?.[no.nome]
    if (!h) return
    const conteudo = h(pai, ref)
    dono.nos.push({ usa: new Set(), morto: false, atualiza() {}, destroi() { this.morto = true; conteudo.destroi() } })
    return
  }
  if (no.bloco.impl === 'composto') return constroiComposto(no, esc, dono, host, amb, pai, ref, prof)
  if (no.bloco.impl === 'codigo') { amb.onErro?.({ caminho: no.caminho, regra: 'componente-ausente', mensagem: `bloco de código '${no.bloco.interface}' não é suportado pelo runtime vivo` }); return }
  return constroiNativo(no, esc, dono, host, amb, pai, ref, prof)
}

function constroiComposto(no: IRElemento, esc: Esc, dono: Dono, host: Host | null, amb: Amb, pai: Node, ref: Node | null, prof: number): void {
  const m = amb.programa.blocos[no.bloco.interface]
  if (!m) { amb.onErro?.({ caminho: no.caminho, regra: 'bloco-ausente', mensagem: `modelo do bloco '${no.bloco.interface}' não está no programa` }); return }
  const deps = depsProps(no)
  let props = avaliaProps(no, esc, amb.funcoes)
  const inner: Esc = { props, tenant: esc.tenant }
  const nosInner: Dono = { nos: [] }
  // slots: o conteúdo é construído no escopo de FORA (esc/dono/host de quem instanciou), só quando o modelo chamar core/slot
  const hostSlots: Host = {}
  for (const [nome, lista] of Object.entries(no.slots)) {
    const usa = new Set<string>(); for (const f of lista) for (const k of usaTotal(f)) usa.add(k)
    hostSlots[nome] = (p, r) => {
      const sub: Dono = { nos: [] }
      const c: Ctrl = {
        usa, morto: false,
        atualiza(mm) { atualizaNos(sub.nos, mm) },
        destroi() { if (this.morto) return; this.morto = true; const i = dono.nos.indexOf(c); if (i >= 0) dono.nos.splice(i, 1); destroiNos(sub.nos) },
      }
      dono.nos.push(c)
      for (const f of lista) constroi(f, esc, sub, host, amb, p, r, prof + 1)
      return c
    }
  }
  constroi(m.modelo, inner, nosInner, hostSlots, amb, pai, ref, prof + 1)
  dono.nos.push({
    usa: usaTotal(no), morto: false,
    atualiza(mm) {
      if (!cruza(deps, mm)) return
      const np = avaliaProps(no, esc, amb.funcoes)
      if (igual(props, np)) return
      const mi = new Set<string>(['props'])
      for (const k of new Set([...Object.keys(props), ...Object.keys(np)])) if (!igual(props[k], np[k])) mi.add(`props.${k}`)
      props = np; inner.props = np
      atualizaNos(nosInner.nos, mi)
    },
    destroi() { this.morto = true; destroiNos(nosInner.nos) },
  })
}

function constroiNativo(no: IRElemento, esc: Esc, dono: Dono, host: Host | null, amb: Amb, pai: Node, ref: Node | null, prof: number): void {
  const nome = no.bloco.cadeia.find((c) => tem(amb.desc, c))
  if (!nome) { amb.onErro?.({ caminho: no.caminho, regra: 'componente-ausente', mensagem: `não há descritor para '${no.bloco.interface}' (cadeia: ${no.bloco.cadeia.join(' → ')})` }); return }
  const d = amb.desc[nome]!
  const deps = depsProps(no)
  let props = avaliaProps(no, esc, amb.funcoes)
  let chave: string | null = null
  let atual: Node
  let attrs: Record<string, string> = {}
  const filhos: Dono = { nos: [] }

  const cria = () => {
    chave = d.chave(props)
    if (chave === null) { atual = document.createComment(''); return }
    const el = document.createElement(d.tag(props))
    attrs = d.attrs(props, no.id)
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v)
    if (d.valor) (el as HTMLInputElement).value = d.valor(props)
    const t = d.texto?.(props)
    if (t !== undefined) { if (t !== '') el.textContent = t }
    else if (d.filhos) for (const f of no.slots.filhos ?? []) constroi(f, esc, filhos, host, amb, el, null, prof + 1)
    if (no.eventos && d.eventos) {
      const h: Record<string, (e: Event) => void> = {}
      for (const [evento, acoes] of Object.entries(no.eventos)) {
        const ev = d.eventos[evento]
        if (ev) h[ev.dom] = (e) => { void executaAcoes(acoes, esc as Escopo, { evento: ev.payload?.(e) }, amb.cx) }
      }
      const entrada: Entrada = { h }
      if (d.valor) entrada.sync = () => { const v = d.valor!(props); if ((el as HTMLInputElement).value !== v) (el as HTMLInputElement).value = v }
      amb.handlers.set(el, entrada)
    }
    atual = el
  }
  cria()
  pai.insertBefore(atual!, ref)

  dono.nos.push({
    usa: usaTotal(no), morto: false,
    atualiza(m) {
      if (cruza(deps, m)) {
        const np = avaliaProps(no, esc, amb.funcoes)
        if (!igual(props, np)) {
          const k = d.chave(np)
          if (k !== chave) {
            destroiNos(filhos.nos)
            const velho = atual
            props = np; cria()
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

function chavesMudadas(a: Store, b: Store, programa: Programa): Set<string> {
  const m = new Set<string>()
  for (const g of ['estado', 'status', 'erros'] as const) {
    if (a[g] === b[g]) continue
    m.add(g)
    const x = a[g] as Record<string, unknown>, y = b[g] as Record<string, unknown>
    for (const k of new Set([...Object.keys(x), ...Object.keys(y)])) if (tem(x, k) !== tem(y, k) || x[k] !== y[k]) m.add(`${g}.${k}`)
  }
  for (const k of Object.keys(programa.pagina.dados)) if (tem(a.dados, k) !== tem(b.dados, k) || a.dados[k] !== b.dados[k]) m.add(k)
  return m
}

export type OpcoesVivo = SementeStore & {
  programa: Programa
  container: Element
  descritores?: DescritoresDom
  params?: Record<string, unknown>
  consulta?: Record<string, unknown>
  tenant?: Record<string, unknown>
  idioma?: string
  carregador?: Carregador
  navegar?: (url: string) => void
  onErro?: (e: ErroRuntime) => void
  funcoes?: Funcoes
}

export type Vivo = {
  /** estado atual do store (imutável) */
  store(): Store
  /** aplica já o que estiver pendente (as ações assíncronas agendam isto em microtask) */
  flush(): void
  /** aplica uma ação ao store e atualiza o DOM na hora */
  despacha(a: AcaoStore): void
  titulo(): string
  destroi(): void
}

/** Monta a página DENTRO de `container` (que deve estar vazio) e a mantém viva. Não usa React. */
export function montaVivo(o: OpcoesVivo): Vivo {
  const programa = o.programa
  const funcoes = o.funcoes ?? FUNCOES_PADRAO
  const store = { atual: iniciaStore(programa, o) }
  let ultima = store.atual
  const base = { params: o.params ?? {}, consulta: o.consulta ?? {}, tenant: o.tenant ?? {}, idioma: o.idioma ?? '' }
  const esc = escopoDaStore(programa, store.atual, base) as Esc
  let agendado = false
  const vivoFlag = { atual: true }

  const flush = () => {
    agendado = false
    if (!vivoFlag.atual) return
    const nova = store.atual
    if (nova === ultima) return
    const m = chavesMudadas(ultima, nova, programa)
    ultima = nova
    esc.estado = nova.estado; esc.status = nova.status; esc.erros = nova.erros
    for (const k of Object.keys(programa.pagina.dados)) { if (tem(nova.dados, k)) esc[k] = nova.dados[k]; else delete esc[k] }
    atualizaNos(raiz.nos, m)
  }
  const cx: ContextoAcoes = {
    programa, store, sequencia: {}, vivo: vivoFlag, funcoes,
    dispatch: () => { if (!agendado) { agendado = true; queueMicrotask(flush) } },
    ...(o.carregador ? { carregador: o.carregador } : {}),
    ...(o.navegar ? { navegar: o.navegar } : {}),
    ...(o.onErro ? { onErro: o.onErro } : {}),
  }
  const handlers = new WeakMap<Node, Entrada>()
  const amb: Amb = { programa, desc: o.descritores ?? DESCRITORES_BASE, funcoes, cx, handlers, ...(o.onErro ? { onErro: o.onErro } : {}) }

  const raiz: Dono = { nos: [] }
  constroi(programa.pagina.raiz, esc, raiz, null, amb, o.container, null, 0)

  const ouve = (e: Event) => {
    for (let n = e.target as Node | null; n && n !== o.container; n = n.parentNode) {
      const ent = handlers.get(n)
      const fn = ent?.h[e.type]
      if (fn) { fn(e); flush(); ent!.sync?.() }
    }
  }
  const tipos = ['click', 'input']
  for (const t of tipos) o.container.addEventListener(t, ouve)

  return {
    store: () => store.atual,
    flush,
    despacha(a) { store.atual = reduz(store.atual, a); flush() },
    titulo: () => { const t = programa.pagina.titulo; if (!t) return ''; const v = valorDe(t, esc, funcoes); return v === null || v === undefined || typeof v === 'object' ? '' : String(v) },
    destroi() { vivoFlag.atual = false; for (const t of tipos) o.container.removeEventListener(t, ouve); destroiNos(raiz.nos) },
  }
}

/** A página pode rodar no runtime vivo? (sem streaming, esqueleto, blocos de código nem blocos sem descritor) */
export function elegivelVivo(programa: Programa, descritores: DescritoresDom = DESCRITORES_BASE): { ok: true } | { ok: false; motivos: Array<{ caminho: string; motivo: string }> } {
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
