import { criaAjv, ESQUEMA_ATUAL, type Kind } from './index'

// ---------------------------------------------------------------------------
// Migração declarativa de nós entre majors do schema de um kind.
// Uma migração é um documento JSON (polaris://migracao/v1): sem código, só ops.
// ---------------------------------------------------------------------------

export type Op =
  | { op: 'renomeia'; de: string; para: string }
  | { op: 'define'; caminho: string; valor: unknown; sobrescreve?: boolean }
  | { op: 'remove'; caminho: string }
  | { op: 'mapeia'; caminho: string; tabela: Record<string, unknown> }

export type Migracao = { kind: Kind; de: number; para: number; nota?: string; ops: Op[] }

export class MigracaoErro extends Error {
  constructor(mensagem: string) {
    super(mensagem)
    this.name = 'MigracaoErro'
  }
}

type Obj = Record<string, unknown>
const partes = (ptr: string) => ptr.split('/').slice(1).map((p) => p.replace(/~1/g, '/').replace(/~0/g, '~'))

function pai(raiz: Obj, caminho: string[], cria: boolean): Obj | null {
  let cur: Obj = raiz
  for (const k of caminho.slice(0, -1)) {
    const prox = cur[k]
    if (prox === undefined && cria) cur[k] = {}
    if (typeof cur[k] !== 'object' || cur[k] === null || Array.isArray(cur[k])) return null
    cur = cur[k] as Obj
  }
  return cur
}

function aplicaOp(no: Obj, op: Op): void {
  if (op.op === 'renomeia') {
    const de = partes(op.de), para = partes(op.para)
    const pd = pai(no, de, false)
    const kd = de[de.length - 1]!
    if (!pd || !(kd in pd)) return // nada a renomear: campo opcional ausente
    const valor = pd[kd]
    delete pd[kd]
    const pp = pai(no, para, true)
    if (!pp) throw new MigracaoErro(`destino inválido: ${op.para}`)
    pp[para[para.length - 1]!] = valor
  } else if (op.op === 'define') {
    const c = partes(op.caminho)
    const p = pai(no, c, true)
    if (!p) throw new MigracaoErro(`caminho inválido: ${op.caminho}`)
    const k = c[c.length - 1]!
    if (op.sobrescreve || !(k in p)) p[k] = structuredClone(op.valor)
  } else if (op.op === 'remove') {
    const c = partes(op.caminho)
    const p = pai(no, c, false)
    if (p) delete p[c[c.length - 1]!]
  } else {
    const c = partes(op.caminho)
    const p = pai(no, c, false)
    const k = c[c.length - 1]!
    if (!p || !(k in p)) return
    const atual = p[k]
    if (typeof atual === 'string' && Object.prototype.hasOwnProperty.call(op.tabela, atual)) p[k] = structuredClone(op.tabela[atual])
  }
}

/** Aplica uma migração a uma cópia do nó. Não muta a entrada. */
export function aplicaMigracao(no: Obj, m: Migracao): Obj {
  const copia = structuredClone(no)
  for (const op of m.ops) aplicaOp(copia, op)
  copia.esquema = m.para
  return copia
}

export type Aplicada = { kind: Kind; de: number; para: number }

export class Migrador {
  private readonly porKind = new Map<Kind, Map<number, Migracao>>()
  private readonly valida = (() => {
    const v = criaAjv().getSchema('polaris://migracao/v1')!
    return (d: unknown) => (v(d) ? null : (v.errors ?? []).map((e) => `${e.instancePath || '/'} ${e.message}`).join('; '))
  })()

  /** `atuais` é injetável para teste; em produção é ESQUEMA_ATUAL. */
  constructor(private readonly atuais: Record<string, number> = ESQUEMA_ATUAL) {}

  registra(dado: unknown): Migracao {
    const erro = this.valida(dado)
    if (erro) throw new MigracaoErro(`migração inválida: ${erro}`)
    const m = dado as Migracao
    if (m.para !== m.de + 1) throw new MigracaoErro(`migração ${m.kind} ${m.de}→${m.para}: só se migra de N para N+1`)
    const tab = this.porKind.get(m.kind) ?? new Map()
    if (tab.has(m.de)) throw new MigracaoErro(`migração duplicada: ${m.kind} ${m.de}→${m.para}`)
    tab.set(m.de, m)
    this.porKind.set(m.kind, tab)
    return m
  }

  atual(kind: Kind): number {
    return this.atuais[kind] ?? 1
  }

  /** Cada kind precisa de uma migração para cada N→N+1 até o major atual. Devolve as que faltam. */
  lacunas(): string[] {
    const faltas: string[] = []
    for (const kind of Object.keys(this.atuais) as Kind[]) {
      for (let n = 1; n < this.atual(kind); n++) {
        if (!this.porKind.get(kind)?.has(n)) faltas.push(`${kind} ${n}→${n + 1}`)
      }
    }
    for (const [kind, tab] of this.porKind) {
      for (const m of tab.values()) if (m.para > this.atual(kind)) faltas.push(`${kind} ${m.de}→${m.para} (além do major atual ${this.atual(kind)})`)
    }
    return faltas
  }

  /** Migra o nó até o major atual do seu kind. Lança se o nó é de um major futuro ou se falta migração. */
  migra<T extends Obj>(no: T): { no: Obj; aplicadas: Aplicada[] } {
    const kind = no.kind as Kind
    const alvo = this.atual(kind)
    let atual = typeof no.esquema === 'number' ? no.esquema : 1
    if (atual > alvo) throw new MigracaoErro(`${kind} '${String(no.id)}' é do esquema ${atual}, mais novo que o suportado (${alvo})`)
    let corrente: Obj = no
    const aplicadas: Aplicada[] = []
    while (atual < alvo) {
      const m = this.porKind.get(kind)?.get(atual)
      if (!m) throw new MigracaoErro(`sem migração ${kind} ${atual}→${atual + 1}`)
      corrente = aplicaMigracao(corrente, m)
      aplicadas.push({ kind, de: m.de, para: m.para })
      atual = m.para
    }
    return { no: corrente, aplicadas }
  }
}
