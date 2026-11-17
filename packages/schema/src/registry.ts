import { criaValidador, type Erro, type No } from './index'
import type { Migrador } from './migracao'

// ---------------------------------------------------------------------------
// Registry de schemas: guarda nós validados e os resolve por escopo e versão.
// Cascata de escopo: tenant → segmento → core (o mais específico vence).
// ---------------------------------------------------------------------------

export type Contexto = {
  tenantId?: string | null
  segmento?: string | null
  /** Inclui nós em rascunho (preview/editor). Padrão: só `publicado`. */
  incluirRascunho?: boolean
}

export type Escopo = 'tenant' | 'segmento' | 'core'

export type Resolvido = { no: No; escopo: Escopo }

export class RegistryErro extends Error {
  constructor(mensagem: string, readonly detalhes: Erro[] = []) {
    super(mensagem)
    this.name = 'RegistryErro'
  }
}

/** Chave lógica: blocos são endereçados pela `interface`; os demais pelo `id`. */
export function chaveDe(no: No): string {
  const k = no.kind === 'bloco' ? (no.spec.interface as string) : no.id
  return `${no.kind}:${k}`
}

function escopoDe(no: No): { escopo: Escopo; dono: string | null } {
  if (no.tenantId) return { escopo: 'tenant', dono: no.tenantId }
  if (no.segmento) return { escopo: 'segmento', dono: no.segmento }
  return { escopo: 'core', dono: null }
}

function cmpSemver(a: string, b: string): number {
  const pa = a.split('.').map(Number)
  const pb = b.split('.').map(Number)
  for (let i = 0; i < 3; i++) if (pa[i] !== pb[i]) return pa[i]! - pb[i]!
  return 0
}

/** Fonte de nós (disco, HTTP, memória). */
export type Fonte = () => Promise<unknown[]> | unknown[]

/** Fonte HTTP: GET que devolve um array JSON de nós. */
export function fonteHttp(url: string, f: typeof fetch = fetch): Fonte {
  return async () => {
    const r = await f(url)
    if (!r.ok) throw new RegistryErro(`falha ao carregar ${url}: ${r.status}`)
    return (await r.json()) as unknown[]
  }
}

export class Registry {
  private readonly valida = criaValidador()

  /** Com `migrador`, nós de majors antigos são migrados ao registrar. */
  constructor(private readonly opcoes: { migrador?: Migrador } = {}) {}

  /** chave → escopo|dono → versao → nó */
  private readonly nos = new Map<string, Map<string, Map<string, No>>>()
  private readonly cache = new Map<string, Resolvido | null>()

  /** Valida e registra um nó. Lança RegistryErro (com caminhos JSON) se inválido. */
  registra(dado: unknown): No {
    if (this.opcoes.migrador && dado && typeof dado === 'object') {
      dado = this.opcoes.migrador.migra(dado as Record<string, unknown>).no
    }
    const r = this.valida(dado)
    if (!r.ok) {
      const id = (dado as { id?: unknown })?.id
      const e0 = r.erros[0]
      throw new RegistryErro(`nó inválido (${String(id)}): ${e0?.caminho} ${e0?.mensagem}${e0?.dica ? ` — ${e0.dica}` : ''}${r.erros.length > 1 ? ` (+${r.erros.length - 1} erro(s))` : ''}`, r.erros)
    }
    const no = r.no
    const { escopo, dono } = escopoDe(no)
    const chave = chaveDe(no)
    const porEscopo = this.nos.get(chave) ?? new Map()
    const porVersao = porEscopo.get(`${escopo}|${dono}`) ?? new Map()
    if (porVersao.has(no.versao)) {
      throw new RegistryErro(`duplicado: ${chave} ${no.versao} já existe no escopo ${escopo}${dono ? ':' + dono : ''}`)
    }
    porVersao.set(no.versao, no)
    porEscopo.set(`${escopo}|${dono}`, porVersao)
    this.nos.set(chave, porEscopo)
    for (const f of no.filhos ?? []) this.registra(f)
    this.cache.clear()
    return no
  }

  async carrega(fonte: Fonte): Promise<number> {
    const lista = await fonte()
    for (const d of lista) this.registra(d)
    return lista.length
  }

  /** Ids distintos de um kind, em ordem alfabética (para varrer o registry: build, listagens). Blocos aparecem pela `interface`. */
  ids(kind: No['kind']): string[] {
    const ps = `${kind}:`
    return [...this.nos.keys()].filter((k) => k.startsWith(ps)).map((k) => k.slice(ps.length)).sort()
  }

  /** Resolve pela cascata tenant → segmento → core; dentro do escopo, a maior versão elegível. */
  resolve(kind: No['kind'], id: string, ctx: Contexto = {}): Resolvido | null {
    const chave = `${kind}:${id}`
    const ck = `${chave}|${ctx.tenantId ?? ''}|${ctx.segmento ?? ''}|${ctx.incluirRascunho ? 1 : 0}`
    if (this.cache.has(ck)) return this.cache.get(ck)!
    const porEscopo = this.nos.get(chave)
    let achado: Resolvido | null = null
    if (porEscopo) {
      const ordem: Array<[Escopo, string | null]> = []
      if (ctx.tenantId) ordem.push(['tenant', ctx.tenantId])
      if (ctx.segmento) ordem.push(['segmento', ctx.segmento])
      ordem.push(['core', null])
      for (const [escopo, dono] of ordem) {
        const versoes = porEscopo.get(`${escopo}|${dono}`)
        if (!versoes) continue
        const elegiveis = [...versoes.values()].filter((n) =>
          ctx.incluirRascunho ? n.estatuto !== 'obsoleto' : n.estatuto === 'publicado',
        )
        if (elegiveis.length === 0) continue
        elegiveis.sort((a, b) => cmpSemver(b.versao, a.versao))
        achado = { no: elegiveis[0]!, escopo }
        break
      }
    }
    this.cache.set(ck, achado)
    return achado
  }

  /** Resolve um bloco pela interface, já com `extends` aplicado (props, slots e implementação herdados). */
  resolveBloco(interfaceId: string, ctx: Contexto = {}): BlocoResolvido {
    return this.resolveBlocoRec(interfaceId, ctx, [])
  }

  private resolveBlocoRec(interfaceId: string, ctx: Contexto, pilha: string[]): BlocoResolvido {
    if (pilha.includes(interfaceId)) {
      throw new RegistryErro(`ciclo em extends: ${[...pilha, interfaceId].join(' → ')}`)
    }
    const r = this.resolve('bloco', interfaceId, ctx)
    if (!r) throw new RegistryErro(`bloco não encontrado: ${interfaceId}`)
    const spec = r.no.spec as unknown as BlocoSpec
    if (!spec.extends) {
      return { interface: interfaceId, cadeia: [interfaceId], props: spec.props, slots: { ...spec.slots }, eventos: { ...spec.eventos }, modelo: spec.modelo, codigo: spec.codigo }
    }
    const pai = this.resolveBlocoRec(spec.extends, ctx, [...pilha, interfaceId])
    return {
      interface: interfaceId,
      cadeia: [interfaceId, ...pai.cadeia],
      props: mesclaProps(pai.props, spec.props),
      slots: { ...pai.slots, ...spec.slots },
      eventos: { ...pai.eventos, ...spec.eventos },
      modelo: spec.modelo ?? pai.modelo,
      codigo: spec.codigo ?? pai.codigo,
    }
  }

  /** Referências que o nó faz a outros nós (chave kind:id), para checar integridade. */
  referencias(no: No): Array<{ kind: No['kind']; id: string; caminho: string }> {
    const refs: Array<{ kind: No['kind']; id: string; caminho: string }> = []
    const s = no.spec as Record<string, any>
    const instancias = (i: any, caminho: string) => {
      if (!i) return
      refs.push({ kind: 'bloco', id: i.bloco, caminho: `${caminho}/bloco` })
      for (const [slot, lista] of Object.entries<any[]>(i.slots ?? {})) {
        lista.forEach((f, n) => instancias(f, `${caminho}/slots/${slot}/${n}`))
      }
    }
    switch (no.kind) {
      case 'pagina':
        for (const [nome, d] of Object.entries<string | { dados: string }>(s.dados ?? {})) {
          refs.push({ kind: 'dados', id: typeof d === 'string' ? d : d.dados, caminho: typeof d === 'string' ? `/spec/dados/${nome}` : `/spec/dados/${nome}/dados` })
        }
        if (s.layout) refs.push({ kind: 'bloco', id: s.layout, caminho: '/spec/layout' })
        instancias(s.raiz, '/spec/raiz')
        break
      case 'bloco':
        if (s.extends) refs.push({ kind: 'bloco', id: s.extends, caminho: '/spec/extends' })
        if (s.layout) refs.push({ kind: 'bloco', id: s.layout, caminho: '/spec/layout' })
        for (const [slot, def] of Object.entries<any>(s.slots ?? {})) {
          ;(def.aceita ?? []).forEach((id: string, n: number) => refs.push({ kind: 'bloco', id, caminho: `/spec/slots/${slot}/aceita/${n}` }))
        }
        instancias(s.modelo, '/spec/modelo')
        break
      case 'dados':
        if (s.fonte?.tipo === 'servico') refs.push({ kind: 'servico', id: s.fonte.servico, caminho: '/spec/fonte/servico' })
        break
      case 'tenant':
        if (s.tema) refs.push({ kind: 'tema', id: s.tema, caminho: '/spec/tema' })
        ;(s.paginas ?? []).forEach((id: string, n: number) => refs.push({ kind: 'pagina', id, caminho: `/spec/paginas/${n}` }))
        for (const k of ['paginaNegado', 'paginaNaoEncontrada']) if (s[k]) refs.push({ kind: 'pagina', id: s[k], caminho: `/spec/${k}` })
        break
      case 'kernel':
        ;(s.emissoes ?? []).forEach((e: any, n: number) => {
          if (e.backend) refs.push({ kind: 'backend', id: e.backend, caminho: `/spec/emissoes/${n}/backend` })
        })
        break
    }
    return refs
  }

  /** Verifica integridade referencial de um nó no contexto dado. Devolve as referências quebradas. */
  verifica(no: No, ctx: Contexto = {}): Erro[] {
    const erros: Erro[] = []
    for (const r of this.referencias(no)) {
      if (!this.resolve(r.kind, r.id, ctx)) {
        erros.push({ caminho: r.caminho, regra: 'ref', mensagem: `${r.kind} '${r.id}' não encontrado` })
      }
    }
    return erros
  }

  /** Verifica todos os nós publicados visíveis no contexto. */
  verificaTudo(ctx: Contexto = {}): Array<{ no: string; erros: Erro[] }> {
    const saida: Array<{ no: string; erros: Erro[] }> = []
    for (const chave of this.nos.keys()) {
      const [kind, ...resto] = chave.split(':')
      const r = this.resolveChave(kind as No['kind'], resto.join(':'), ctx)
      if (!r) continue
      const erros = this.verifica(r.no, ctx)
      if (erros.length) saida.push({ no: chave, erros })
    }
    return saida
  }

  private resolveChave(kind: No['kind'], chaveId: string, ctx: Contexto): Resolvido | null {
    return this.resolve(kind, chaveId, ctx)
  }
}

export type BlocoSpec = {
  interface: string
  extends?: string
  props?: { type: 'object'; properties?: Record<string, unknown>; required?: string[] }
  slots?: Record<string, { aceita?: string[]; min?: number; max?: number }>
  eventos?: Record<string, { payload?: string }>
  modelo?: unknown
  codigo?: unknown
}

export type BlocoResolvido = {
  interface: string
  /** interface → pai → avô… */
  cadeia: string[]
  props?: BlocoSpec['props']
  slots: NonNullable<BlocoSpec['slots']>
  /** eventos declarados (herdados via extends) */
  eventos: NonNullable<BlocoSpec['eventos']>
  modelo?: unknown
  codigo?: unknown
}

function mesclaProps(pai: BlocoSpec['props'], filho: BlocoSpec['props']): BlocoSpec['props'] {
  if (!pai) return filho
  if (!filho) return pai
  return {
    type: 'object',
    properties: { ...pai.properties, ...filho.properties },
    required: [...new Set([...(pai.required ?? []), ...(filho.required ?? [])])],
  }
}
