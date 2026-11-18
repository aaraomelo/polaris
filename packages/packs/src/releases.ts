import { createHmac, createHash, timingSafeEqual } from 'node:crypto'
import { jsonCanonico, validaEstrutura, type Registry } from '@polaris/schema'
import type { criaArmazemDeNos } from './overrides'

// Publicação: rascunho → release (snapshot IMUTÁVEL) → preview → produção, com rollback. Uma release é o conjunto EXATO de versões de nós que o tenant serve; promover e voltar
// atrás são trocas de um ponteiro, atômicas, e a release de antes continua intacta. O que entra numa release já foi conferido como um TODO (a coerência entre os nós),
// e é conferido DE NOVO contra o core atual na hora de promover (o core pode ter mudado desde que a release foi criada).

type Q = (sql: string, params?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>>; rowCount: number }>
type Armazem = ReturnType<typeof criaArmazemDeNos>
export type Release = { numero: number; hash: string; autor: string; nota: string | null; criadoEm: string; nos: number }
export type Producao = { producao: number | null; anterior: number | null }
const fmt = (e: { caminho: string; mensagem: string }) => `${e.caminho} ${e.mensagem}`
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const relDe = (r: Record<string, unknown>): Release => ({ numero: Number(r.numero), hash: r.hash as string, autor: r.autor as string, nota: (r.nota as string | null) ?? null, criadoEm: new Date(r.criado_em as string).toISOString(), nos: Object.keys(r.manifesto as object).length })

export type DbPlataforma = { transacao<T>(fn: (q: Q) => Promise<T>): Promise<T> }
/**
 * `db.transacao` é OBRIGATÓRIO: criar e trocar release travam a linha do tenant (`FOR UPDATE`) e só serializam de verdade DENTRO de uma transação. Cada operação pública roda numa.
 * `armazemDe(q)` monta o armazém sobre a transação corrente.
 */
export function criaReleases(o: { db: DbPlataforma; armazemDe: (q: Q) => Armazem; /** quantos registros de release ficam em memória (cada um é imutável: serve para sempre) */ maxEmCache?: number }) {
  const max = o.maxEmCache ?? 200
  const cache = new Map<string, Registry>()
  const dentro = <T>(f: (q: Q, armazem: Armazem) => Promise<T>): Promise<T> => o.db.transacao((q) => f(q, o.armazemDe(q)))

  /** o manifesto → registro do tenant, conferido por inteiro; devolve os erros se algo não fecha */
  async function confere(armazem: Armazem, tenantId: string, manifesto: Record<string, number>): Promise<{ ok: true; registro: Registry } | { ok: false; erros: string[] }> {
    const { registro, ignorados } = await armazem.registroDoTenant(tenantId, new Map(Object.entries(manifesto)))
    const erros = ignorados.map((i) => `nó não carrega: ${i}`)
    for (const chave of Object.keys(manifesto)) {
      const [kind, ...r] = chave.split(':'); const id = r.join(':'); const res = registro.resolve(kind as never, id, { tenantId }); if (!res) continue
      for (const e of registro.verifica(res.no, { tenantId })) erros.push(`${chave}: referência quebrada ${e.caminho} ${e.mensagem}`)
      for (const e of validaEstrutura(registro, res.no, { tenantId })) erros.push(`${chave}: ${fmt(e)}`)
    }
    return erros.length ? { ok: false, erros: erros.slice(0, 30) } : { ok: true, registro }
  }

  async function porNumero(q: Q, tenantId: string, numero: number): Promise<{ manifesto: Record<string, number> } & Release | null> {
    const r = (await q(`SELECT numero, manifesto, hash, autor, nota, criado_em FROM plataforma.release WHERE tenant_id = $1 AND numero = $2`, [tenantId, numero])).rows[0]
    return r ? { manifesto: r.manifesto as Record<string, number>, ...relDe(r) } : null
  }

  return {
    /** fotografa o estado atual (as cabeças) como uma release. Recusa se o conjunto não fecha. Idêntico à última release: devolve a mesma. */
    async cria(tenantId: string, autor: string, nota?: string): Promise<{ ok: true; release: Release; nova: boolean } | { ok: false; erros: string[] }> {
      return dentro(async (q, armazem) => {
      if (!UUID.test(tenantId)) return { ok: false, erros: ['tenant inválido'] }
      const t = (await q(`SELECT status FROM plataforma.tenant WHERE id = $1 FOR UPDATE`, [tenantId])).rows[0] as { status: string } | undefined // serializa as criações do tenant
      if (!t) return { ok: false, erros: ['tenant inexistente'] }; if (t.status === 'cancelado') return { ok: false, erros: ['tenant encerrado'] }
      const manifesto: Record<string, number> = {}; for (const c of await armazem.cabecas(tenantId)) manifesto[`${c.kind}:${c.id}`] = c.seq
      const c = await confere(armazem, tenantId, manifesto); if (!c.ok) return c
      const hash = createHash('sha256').update(jsonCanonico(manifesto)).digest('hex')
      const ult = (await q(`SELECT numero, manifesto, hash, autor, nota, criado_em FROM plataforma.release WHERE tenant_id = $1 ORDER BY numero DESC LIMIT 1`, [tenantId])).rows[0]
      if (ult && ult.hash === hash) return { ok: true, release: relDe(ult), nova: false }
      const r = (await q(`INSERT INTO plataforma.release (tenant_id, numero, manifesto, hash, autor, nota) SELECT $1, coalesce(max(numero), 0) + 1, $2::jsonb, $3, $4, $5 FROM plataforma.release WHERE tenant_id = $1 RETURNING numero, manifesto, hash, autor, nota, criado_em`, [tenantId, JSON.stringify(manifesto), hash, autor.slice(0, 120), nota?.slice(0, 300) ?? null])).rows[0]!
      return { ok: true, release: relDe(r), nova: true }
      })
    },

    /** põe a release em PRODUÇÃO (troca atômica do ponteiro). Reconfere contra o core de hoje. */
    async promove(tenantId: string, numero: number, autor: string, nota?: string): Promise<{ ok: true; producao: number; anterior: number | null } | { ok: false; erros: string[] }> {
      return dentro((q, armazem) => troca(q, armazem, tenantId, numero, autor, 'promocao', nota))
    },
    /** volta: sem `para`, à release que estava em produção ANTES da atual (voltar de novo desfaz o rollback). Com `para`, a uma release específica. */
    async rollback(tenantId: string, autor: string, para?: number, nota?: string): Promise<{ ok: true; producao: number; anterior: number | null } | { ok: false; erros: string[] }> {
      return dentro(async (q, armazem) => {
        const p = (await q(`SELECT producao, anterior FROM plataforma.release_ponteiro WHERE tenant_id = $1 FOR UPDATE`, [tenantId])).rows[0] as { producao: number | null; anterior: number | null } | undefined
        const alvo = para ?? p?.anterior ?? null; if (alvo === null) return { ok: false as const, erros: ['não há release anterior para voltar'] }
        return troca(q, armazem, tenantId, alvo, autor, 'rollback', nota)
      })
    },

    async producao(tenantId: string): Promise<Producao> { const r = (await o.db.transacao((q) => q(`SELECT producao, anterior FROM plataforma.release_ponteiro WHERE tenant_id = $1`, [tenantId]))).rows[0]; return { producao: r?.producao === null || r?.producao === undefined ? null : Number(r.producao), anterior: r?.anterior === null || r?.anterior === undefined ? null : Number(r.anterior) } },
    async lista(tenantId: string, limite = 50): Promise<Release[]> { return (await o.db.transacao((q) => q(`SELECT numero, manifesto, hash, autor, nota, criado_em FROM plataforma.release WHERE tenant_id = $1 ORDER BY numero DESC LIMIT $2`, [tenantId, Math.min(Math.max(1, limite), 200)]))).rows.map(relDe) },
    async diario(tenantId: string, limite = 50) { return (await o.db.transacao((q) => q(`SELECT tipo, de, para, autor, nota, em FROM plataforma.release_evento WHERE tenant_id = $1 ORDER BY n DESC LIMIT $2`, [tenantId, Math.min(Math.max(1, limite), 200)]))).rows.map((r) => ({ tipo: r.tipo as string, de: r.de === null ? null : Number(r.de), para: Number(r.para), autor: r.autor as string, nota: (r.nota as string | null) ?? null, em: new Date(r.em as string).toISOString() })) },
    /** o que mudou entre duas releases: nós adicionados, removidos e com versão diferente */
    async diferenca(tenantId: string, de: number, para: number): Promise<{ adicionados: string[]; removidos: string[]; alterados: string[] } | null> {
      const a = await o.db.transacao((q) => porNumero(q, tenantId, de)), b = await o.db.transacao((q) => porNumero(q, tenantId, para)); if (!a || !b) return null
      return { adicionados: Object.keys(b.manifesto).filter((k) => !(k in a.manifesto)).sort(), removidos: Object.keys(a.manifesto).filter((k) => !(k in b.manifesto)).sort(), alterados: Object.keys(b.manifesto).filter((k) => k in a.manifesto && a.manifesto[k] !== b.manifesto[k]).sort() }
    },

    /** o registro de uma release (core + os nós fixados por ela). Imutável: fica em cache. `null` = release inexistente DESTE tenant. */
    async registroDe(tenantId: string, numero: number): Promise<Registry | null> {
      const chave = `${tenantId}|${numero}`; const c = cache.get(chave); if (c) { cache.delete(chave); cache.set(chave, c); return c }
      const { r, registro } = await dentro(async (q, armazem) => { const r = await porNumero(q, tenantId, numero); return r ? { r, registro: (await armazem.registroDoTenant(tenantId, new Map(Object.entries(r.manifesto)))).registro } : { r: null, registro: null } })
      if (!r || !registro) return null
      cache.set(chave, registro); while (cache.size > max) cache.delete(cache.keys().next().value as string)
      return registro
    },
    /** o que o gateway chama: `null` = o tenant ainda não publicou nada (só core/segmento) */
    async registroDeProducao(tenantId: string, numero: number | null): Promise<Registry> { return (numero === null ? null : await this.registroDe(tenantId, numero)) ?? (await dentro((_q, armazem) => armazem.registroDoTenant(tenantId, new Map()))).registro },
  }

  async function troca(q: Q, armazem: Armazem, tenantId: string, numero: number, autor: string, tipo: 'promocao' | 'rollback', nota?: string) {
    if (!UUID.test(tenantId)) return { ok: false as const, erros: ['tenant inválido'] }
    const t = (await q(`SELECT status FROM plataforma.tenant WHERE id = $1 FOR UPDATE`, [tenantId])).rows[0] as { status: string } | undefined
    if (!t) return { ok: false as const, erros: ['tenant inexistente'] }; if (t.status === 'cancelado') return { ok: false as const, erros: ['tenant encerrado'] }
    const rel = Number.isInteger(numero) ? await porNumero(q, tenantId, numero) : null; if (!rel) return { ok: false as const, erros: [`a release ${String(numero).slice(0, 12)} não existe neste tenant`] }
    const c = await confere(armazem, tenantId, rel.manifesto); if (!c.ok) return { ok: false as const, erros: [`a release ${numero} não é mais íntegra contra o core atual`, ...c.erros] }
    await q(`INSERT INTO plataforma.release_ponteiro (tenant_id, producao, anterior) VALUES ($1, NULL, NULL) ON CONFLICT DO NOTHING`, [tenantId])
    const p = (await q(`SELECT producao, anterior FROM plataforma.release_ponteiro WHERE tenant_id = $1 FOR UPDATE`, [tenantId])).rows[0] as { producao: number | null; anterior: number | null }
    if (p.producao === numero) return { ok: true as const, producao: numero, anterior: p.anterior } // já está lá: nada a fazer
    await q(`UPDATE plataforma.release_ponteiro SET producao = $2, anterior = $3, atualizado_em = now() WHERE tenant_id = $1`, [tenantId, numero, p.producao])
    await q(`INSERT INTO plataforma.release_evento (tenant_id, n, tipo, de, para, autor, nota) SELECT $1, coalesce(max(n), 0) + 1, $2, $3, $4, $5, $6 FROM plataforma.release_evento WHERE tenant_id = $1`, [tenantId, tipo, p.producao, numero, autor.slice(0, 120), nota?.slice(0, 300) ?? null])
    return { ok: true as const, producao: numero, anterior: p.producao }
  }
}

/** Links de pré-visualização: `v1.<payload>.<assinatura>` (HMAC-SHA256). Dão acesso de LEITURA às páginas de UMA release de UM tenant, por pouco tempo, sem login. */
export function criaPreview(o: { segredo: string | Uint8Array; agora?: () => number; ttlMaxSeg?: number }) {
  const seg = typeof o.segredo === 'string' ? Buffer.from(o.segredo) : Buffer.from(o.segredo)
  if (seg.length < 32) throw new Error('o segredo do preview deve ter ao menos 32 bytes')
  const agora = o.agora ?? Date.now, ttlMax = o.ttlMaxSeg ?? 7 * 24 * 3600
  const b64 = (b: Buffer) => b.toString('base64url'), assina = (p: string) => b64(createHmac('sha256', seg).update(`v1.${p}`).digest())
  return {
    emite(tenantId: string, release: number, ttlSeg = 24 * 3600): string {
      if (!UUID.test(tenantId) || !Number.isInteger(release) || release < 1) throw new Error('tenant ou release inválidos')
      const exp = Math.floor(agora() / 1000) + Math.min(Math.max(60, Math.trunc(ttlSeg)), ttlMax)
      const p = b64(Buffer.from(JSON.stringify({ t: tenantId.toLowerCase(), r: release, e: exp }))); return `v1.${p}.${assina(p)}`
    },
    verifica(token: string): { tenantId: string; release: number } | null {
      if (typeof token !== 'string' || token.length > 2048) return null
      const m = /^v1\.([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)$/.exec(token); if (!m) return null
      const esperado = Buffer.from(assina(m[1]!)), dado = Buffer.from(m[2]!); if (esperado.length !== dado.length || !timingSafeEqual(esperado, dado)) return null
      try { const p = JSON.parse(Buffer.from(m[1]!, 'base64url').toString('utf8')) as { t?: unknown; r?: unknown; e?: unknown }; if (typeof p.t !== 'string' || !UUID.test(p.t) || !Number.isInteger(p.r) || typeof p.e !== 'number' || p.e * 1000 < agora()) return null; return { tenantId: p.t, release: p.r as number } } catch { return null }
    },
  }
}
