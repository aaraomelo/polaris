import { useSyncExternalStore } from 'react'
import { atualiza, duplica, defineValor, Historico, idLivre, insere, move, noEm, propsIniciais, remove, renomeiaId, trocaProps, type Caminho, type DefBloco, type Inst } from '@polaris/studio'
import { api, ErroApi, type Comentario, type DefBlocoApi, type Meta } from './api'

export type Aviso = { tipo: 'ok' | 'erro' | 'conflito'; texto: string; detalhes?: string[] }
export type Aberto = { kind: string; id: string; origem: 'tenant' | 'base' | 'novo'; seqBase: number | null }
export const PAGINA_NOVA = (id: string, rota: string) => ({ kind: 'pagina', id, versao: '1.0.0', estatuto: 'rascunho', spec: { rota, raiz: { bloco: 'layout/pilha', id: 'raiz' } } })
const TEMA_NOVO = (id: string) => ({ kind: 'tema', id, versao: '1.0.0', estatuto: 'rascunho', spec: { tokens: { cor: { fundo: '#ffffff', texto: '#111111', primaria: '#1d4ed8' } } } })

/** O estado do editor, fora do React (testável e sem re-render a cada tecla): o rascunho do nó vive num Historico; a UI assina e relê. */
export class Editor {
  private ouvintes = new Set<() => void>(); private v = 0
  defs: Record<string, DefBlocoApi> = {}
  nos: Meta[] = []; base: Record<string, string[]> = {}
  blocosDoTenant: any[] = []
  aberto: Aberto | undefined; hist: Historico<any> | undefined
  selecao: Caminho = []
  aviso: Aviso | undefined; salvando = false; carregando = false
  comentarios: Comentario[] = []; versoes: Meta[] = []
  /** erros do compilador no RASCUNHO atual (quem renderiza o preview informa); salvar com erros avisa que não deve ser publicado */
  errosCompilacao: string[] = []
  defineErrosCompilacao(e: string[]): void { if (e.length !== this.errosCompilacao.length || e.some((x, i) => x !== this.errosCompilacao[i])) { this.errosCompilacao = e; this.notifica() } }

  assina = (f: () => void) => { this.ouvintes.add(f); return () => { this.ouvintes.delete(f) } }
  versao = () => this.v
  notifica() { this.v++; for (const f of this.ouvintes) f() }

  get no(): any { return this.hist?.atual }
  get raiz(): Inst | undefined { return this.no?.kind === 'pagina' ? (this.no.spec?.raiz as Inst | undefined) : undefined }
  get sujo(): boolean { return this.hist?.sujo ?? false }
  defs$: DefBloco = (b) => { const d = this.defs[b]; return d ? { slots: d.slots } : undefined }
  selecionado(): Inst | undefined { return this.raiz ? noEm(this.raiz, this.selecao) : undefined }

  async inicia(): Promise<void> {
    this.carregando = true; this.notifica()
    try {
      const [blocos, lista] = await Promise.all([api.blocos(), api.lista()])
      this.defs = Object.fromEntries(blocos.map((b) => [b.id, b])); this.nos = lista.nos; this.base = lista.base
      this.blocosDoTenant = (await Promise.all(lista.nos.filter((n) => n.kind === 'bloco').map((n) => api.abre('bloco', n.id).then((r) => r.no).catch(() => null)))).filter(Boolean)
      this.aviso = undefined
    } catch (e) { this.aviso = { tipo: 'erro', texto: msg(e) } }
    this.carregando = false; this.notifica()
  }
  async recarregaLista(): Promise<void> { const l = await api.lista(); this.nos = l.nos; this.base = l.base; this.notifica() }

  async abre(kind: string, id: string): Promise<void> {
    if (this.sujo && !this.confirmaDescarte()) return
    try {
      const r = await api.abre(kind, id)
      this.aberto = { kind, id, origem: r.origem, seqBase: r.seq }; this.hist = new Historico(r.no, { agrupaMs: 900 }); this.selecao = []; this.aviso = undefined
      await this.carregaLateral()
    } catch (e) { this.aviso = { tipo: 'erro', texto: msg(e) } }
    this.notifica()
  }
  novo(kind: 'pagina' | 'tema', id: string, rota: string): void {
    const no = kind === 'pagina' ? PAGINA_NOVA(id, rota) : TEMA_NOVO(id)
    this.aberto = { kind, id, origem: 'novo', seqBase: null }; this.hist = new Historico<any>(no, { agrupaMs: 900 }); this.hist.aplica({ ...no }, 'novo') // referência nova: o rascunho começa "sujo" (ainda não existe no servidor)
    this.selecao = []; this.comentarios = []; this.versoes = []; this.aviso = undefined; this.notifica()
  }
  confirmaDescarte = (): boolean => (typeof window === 'undefined' ? true : window.confirm('Há alterações não salvas. Descartar?'))
  async carregaLateral(): Promise<void> {
    if (!this.aberto || this.aberto.origem === 'novo') { this.comentarios = []; this.versoes = []; return }
    const { kind, id } = this.aberto
    const [c, v] = await Promise.all([api.comentarios(kind, id).catch(() => []), api.historico(kind, id).catch(() => [])]); this.comentarios = c; this.versoes = v
  }

  // ---------- edição (tudo passa pelo Historico) ----------
  /** troca o nó inteiro (tema, metadados) */
  edita(novo: any, rotulo: string, grupo?: string): void { this.hist?.aplica(novo, rotulo, grupo); this.notifica() }
  private comRaiz(r: { ok: true; raiz: Inst; caminho?: Caminho } | { ok: false; erro: string }, rotulo: string, sel?: 'novo' | 'manter', grupo?: string): void {
    if (!r.ok) { this.aviso = { tipo: 'erro', texto: r.erro }; this.notifica(); return }
    this.aviso = undefined; this.hist!.aplica({ ...this.no, spec: { ...this.no.spec, raiz: r.raiz } }, rotulo, grupo)
    if (sel === 'novo' && r.caminho) this.selecao = r.caminho
    this.notifica()
  }
  seleciona(c: Caminho): void { this.selecao = c; this.notifica() }
  adiciona(bloco: string, slot: string, pai: Caminho = this.selecao): void {
    const raiz = this.raiz; if (!raiz) return
    const p = noEm(raiz, pai); if (!p) return
    const inst: Inst = { bloco, id: idLivre(raiz, bloco), ...(Object.keys(propsIniciais(this.defs[bloco]?.props)).length ? { props: propsIniciais(this.defs[bloco]?.props) } : {}) }
    this.comRaiz(insere(raiz, pai, slot, p.slots?.[slot]?.length ?? 0, inst, this.defs$), `adicionar ${bloco}`, 'novo')
  }
  remove(): void { const r = this.raiz; if (r) { const pai = this.selecao.slice(0, -1); const x = remove(r, this.selecao, this.defs$); this.comRaiz(x, 'remover bloco'); if (x.ok) this.selecao = pai } }
  duplica(): void { const r = this.raiz; if (r) this.comRaiz(duplica(r, this.selecao, this.defs$), 'duplicar', 'novo') }
  /** sobe/desce entre irmãos */
  desloca(delta: -1 | 1): void {
    const r = this.raiz, s = this.selecao; if (!r || !s.length) return
    const u = s[s.length - 1]!, pai = s.slice(0, -1), lista = noEm(r, pai)?.slots?.[u.slot] ?? []
    const alvo = u.indice + delta; if (alvo < 0 || alvo >= lista.length) return
    this.comRaiz(move(r, s, pai, u.slot, delta < 0 ? alvo : alvo + 1, this.defs$), delta < 0 ? 'subir bloco' : 'descer bloco', 'novo')
  }
  /** para dentro do irmão anterior (se ele tiver o slot `filhos`) */
  recua(): void {
    const r = this.raiz, s = this.selecao; if (!r || !s.length) return
    const u = s[s.length - 1]!, pai = s.slice(0, -1); if (u.indice === 0) return
    const irmao = [...pai, { slot: u.slot, indice: u.indice - 1 }], i = noEm(r, irmao)!, slots = this.defs[i.bloco]?.slots ?? {}
    const slot = slots.filhos ? 'filhos' : Object.keys(slots)[0]; if (!slot) { this.aviso = { tipo: 'erro', texto: `o bloco ${i.bloco} não aceita filhos` }; this.notifica(); return }
    this.comRaiz(move(r, s, irmao, slot, i.slots?.[slot]?.length ?? 0, this.defs$), 'mover para dentro', 'novo')
  }
  /** para fora: vira irmão do pai, logo depois dele */
  avanca(): void {
    const r = this.raiz, s = this.selecao; if (s.length < 2) return
    const pai = s.slice(0, -1), up = pai[pai.length - 1]!, avo = pai.slice(0, -1)
    this.comRaiz(move(r!, s, avo, up.slot, up.indice + 1, this.defs$), 'mover para fora', 'novo')
  }
  setProps(props: Record<string, unknown>, grupo?: string): void { const r = this.raiz; if (r) this.comRaiz(trocaProps(r, this.selecao, props), 'editar propriedades', 'manter', grupo) }
  setProp(caminho: readonly string[], valor: unknown, grupo?: string): void { const s = this.selecionado(); if (s) this.setProps(defineValor(s.props, caminho, valor), grupo ?? `prop:${this.selecao.map((p) => `${p.slot}${p.indice}`).join('/')}:${caminho.join('.')}`) }
  setId(id: string): void { const r = this.raiz; if (r) this.comRaiz(renomeiaId(r, this.selecao, id.trim() === '' ? undefined : id.trim()), 'renomear id', 'manter', `id:${this.selecao.length}`) }
  setSe(se: string): void { const r = this.raiz; if (r) this.comRaiz(atualiza(r, this.selecao, (i) => { const { se: _s, ...o } = i; return se.trim() ? { ...o, se } : o }), 'condição de exibição', 'manter', `se:${this.selecao.length}`) }
  desfaz(): void { if (!this.hist) return; this.hist.desfaz(); this.fixaSelecao(); this.notifica() }
  refaz(): void { if (!this.hist) return; this.hist.refaz(); this.fixaSelecao(); this.notifica() }
  private fixaSelecao(): void { const r = this.raiz; if (!r) { this.selecao = []; return } let c = this.selecao; while (c.length && !noEm(r, c)) c = c.slice(0, -1); this.selecao = c }

  // ---------- servidor ----------
  async salva(nota?: string): Promise<boolean> {
    if (!this.aberto || !this.hist || this.salvando) return false
    this.salvando = true; this.notifica()
    try {
      const r = await api.salva(this.no, this.aberto.origem === 'novo' ? null : this.aberto.seqBase, nota)
      this.aberto = { ...this.aberto, origem: 'tenant', seqBase: r.versao.seq }; this.hist.marcaSalvo()
      this.aviso = this.errosCompilacao.length ? { tipo: 'erro', texto: `Salvo como versão ${r.versao.seq}, mas a página tem erros de compilação e não deve ser publicada`, detalhes: this.errosCompilacao.slice(0, 5) } : { tipo: 'ok', texto: r.novo ? `Salvo como versão ${r.versao.seq}` : 'Sem alterações em relação à última versão' }
      await Promise.all([this.recarregaLista(), this.carregaLateral()]); this.salvando = false; this.notifica(); return true
    } catch (e) {
      this.aviso = e instanceof ErroApi && e.codigo === 'conflito' ? { tipo: 'conflito', texto: `${(e.extra.autor as string | undefined) ?? 'Outra pessoa'} salvou a versão ${String(e.extra.seqAtual)} depois que você abriu. Recarregue para ver as mudanças (suas alterações ficam no histórico de desfazer).` }
        : e instanceof ErroApi && e.codigo === 'no_invalido' ? { tipo: 'erro', texto: 'O servidor recusou o nó', detalhes: (e.extra.erros as string[] | undefined) ?? [] } : { tipo: 'erro', texto: msg(e) }
      this.salvando = false; this.notifica(); return false
    }
  }
  /** substitui o rascunho por uma versão antiga (como edição desfazível; só grava ao salvar) */
  restauraVersao(no: any, seq: number): void { this.hist?.aplica({ ...no, versao: this.no.versao }, `restaurar versão ${seq}`); this.selecao = []; this.fixaSelecao(); this.notifica() }
  async comenta(texto: string, ancora?: string, respondeA?: string): Promise<void> {
    if (!this.aberto) return
    try { await api.comenta({ kind: this.aberto.kind, id: this.aberto.id, texto, ...(ancora ? { ancora } : {}), ...(respondeA ? { respondeA } : {}), ...(this.aberto.seqBase ? { versao: this.aberto.seqBase } : {}) }); this.comentarios = await api.comentarios(this.aberto.kind, this.aberto.id); this.aviso = undefined } catch (e) { this.aviso = { tipo: 'erro', texto: msg(e) } }
    this.notifica()
  }
  async resolve(cid: string, resolvido: boolean): Promise<void> {
    if (!this.aberto) return
    try { await api.resolve(cid, resolvido); this.comentarios = await api.comentarios(this.aberto.kind, this.aberto.id) } catch (e) { this.aviso = { tipo: 'erro', texto: msg(e) } }
    this.notifica()
  }
}
const msg = (e: unknown) => (e instanceof Error ? e.message : String(e))
export const useEditor = (e: Editor): Editor => { useSyncExternalStore(e.assina, e.versao); return e }
