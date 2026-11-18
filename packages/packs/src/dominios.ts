import { createHash } from 'node:crypto'
import { ALIAS_RESERVADOS } from './onboarding'

// Domínios e resolução de tenant. Dois tipos de endereço levam a um tenant: o SUBDOMÍNIO da plataforma (`<alias>.<base>`, sem registro: o alias já é único) e o DOMÍNIO PRÓPRIO,
// que só vale depois de VERIFICADO por DNS (um TXT com um token que só o dono do tenant recebeu). Host que não é de ninguém resolve para NADA: nunca para "todos".

type Q = (sql: string, params?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>>; rowCount: number }>
export type StatusTenant = 'provisionando' | 'ativo' | 'falhou' | 'suspenso' | 'cancelado'
export type InfoTenant = { id: string; status: StatusTenant; modulos: string[] }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const LABEL = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)$/

/** O host como o cabeçalho traz → a forma canônica; `null` se não é um nome de host válido (porta e ponto final são tirados; IP, usuário@, espaço, unicode e `_` são recusados) */
export function normalizaHost(h: unknown): string | null {
  if (typeof h !== 'string' || h.length === 0 || h.length > 260) return null
  let x = h.trim().toLowerCase()
  if (/[\s@/\\?#%\u0000-\u001f]/.test(x)) return null
  if (x.startsWith('[')) return null // IPv6 literal
  x = x.replace(/:\d{1,5}$/, '').replace(/\.$/, '')
  if (!x || x.length > 253 || x.includes(':')) return null
  const labels = x.split('.')
  if (labels.some((l) => !LABEL.test(l))) return null
  if (labels.length >= 1 && labels.every((l) => /^\d+$/.test(l))) return null // 1.2.3.4 e afins
  return x
}

export type ResultadoDominio = { ok: true; dominio: string } | { ok: false; motivo: 'formato' | 'reservado' | 'da_plataforma' | 'ip' }
/** um domínio PRÓPRIO que um cliente pode reivindicar */
export function validaDominio(d: unknown, bases: string[]): ResultadoDominio {
  const h = normalizaHost(d); if (!h) return { ok: false, motivo: 'formato' }
  const labels = h.split('.')
  if (labels.length < 2 || !/^[a-z]{2,63}$|^xn--[a-z0-9-]{1,59}$/.test(labels.at(-1)!)) return { ok: false, motivo: 'formato' } // precisa de um TLD de verdade
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal') || h.endsWith('.test') || h.endsWith('.invalid') || h.endsWith('.example')) return { ok: false, motivo: 'reservado' }
  for (const b of bases) if (h === b || h.endsWith(`.${b}`)) return { ok: false, motivo: 'da_plataforma' } // ninguém reivindica o que é da plataforma (nem `loja.<base>` como "próprio")
  return { ok: true, dominio: h }
}

export type Dns = { /** os valores dos registros TXT do nome (vazio se não há); erro de rede lança */ txt(nome: string): Promise<string[]> }
const NOME_TXT = (dominio: string) => `_polaris-verificacao.${dominio}`
export type Reivindicacao = { dominio: string; verificado: boolean; registro: { tipo: 'TXT'; nome: string; valor: string } }

export function criaGestorDominios(o: { q: Q; dns: Dns; bases: string[]; novoToken?: () => string; maxPorTenant?: number }) {
  const { q } = o, max = o.maxPorTenant ?? 10
  const token = o.novoToken ?? (() => createHash('sha256').update(crypto.randomUUID() + crypto.randomUUID()).digest('hex').slice(0, 40))
  const registro = (dominio: string, t: string) => ({ tipo: 'TXT' as const, nome: NOME_TXT(dominio), valor: `polaris-verificacao=${t}` })
  return {
    /** o tenant reivindica um domínio: devolve o que ele precisa publicar no DNS. Idempotente (o mesmo token). */
    async adiciona(tenantId: string, dominio: unknown): Promise<{ ok: true; reivindicacao: Reivindicacao } | { ok: false; motivo: string }> {
      const v = validaDominio(dominio, o.bases); if (!v.ok) return { ok: false, motivo: v.motivo }
      const ja = (await q(`SELECT token, verificado FROM plataforma.dominio WHERE tenant_id = $1 AND dominio = $2`, [tenantId, v.dominio])).rows[0] as { token: string; verificado: boolean } | undefined
      if (ja) return { ok: true, reivindicacao: { dominio: v.dominio, verificado: ja.verificado, registro: registro(v.dominio, ja.token) } }
      if (Number((await q(`SELECT count(*)::int AS n FROM plataforma.dominio WHERE tenant_id = $1`, [tenantId])).rows[0]!.n) >= max) return { ok: false, motivo: 'limite' }
      const t = token()
      await q(`INSERT INTO plataforma.dominio (tenant_id, dominio, token) VALUES ($1, $2, $3)`, [tenantId, v.dominio, t])
      return { ok: true, reivindicacao: { dominio: v.dominio, verificado: false, registro: registro(v.dominio, t) } }
    },
    /** confere o TXT no DNS. Quem prova a posse GANHA o domínio e derruba as reivindicações não verificadas dos outros; se OUTRO tenant já o tem verificado, é `em_uso` */
    async verifica(tenantId: string, dominio: unknown): Promise<'verificado' | 'pendente' | 'inexistente' | 'em_uso' | 'dns_indisponivel'> {
      const d = normalizaHost(dominio); if (!d) return 'inexistente'
      const r = (await q(`SELECT token, verificado FROM plataforma.dominio WHERE tenant_id = $1 AND dominio = $2`, [tenantId, d])).rows[0] as { token: string; verificado: boolean } | undefined
      if (!r) return 'inexistente'; if (r.verificado) return 'verificado'
      let txt: string[]; try { txt = await o.dns.txt(NOME_TXT(d)) } catch { return 'dns_indisponivel' }
      if (!txt.includes(`polaris-verificacao=${r.token}`)) return 'pendente'
      if ((await q(`SELECT 1 FROM plataforma.dominio WHERE dominio = $1 AND verificado AND tenant_id <> $2`, [d, tenantId])).rows.length) return 'em_uso'
      await q(`DELETE FROM plataforma.dominio WHERE dominio = $1 AND NOT verificado AND tenant_id <> $2`, [d, tenantId])
      await q(`UPDATE plataforma.dominio SET verificado = true, verificado_em = now() WHERE tenant_id = $1 AND dominio = $2`, [tenantId, d])
      return 'verificado'
    },
    async remove(tenantId: string, dominio: unknown): Promise<boolean> { const d = normalizaHost(dominio); return !!d && (await q(`DELETE FROM plataforma.dominio WHERE tenant_id = $1 AND dominio = $2`, [tenantId, d])).rowCount > 0 },
    async lista(tenantId: string): Promise<Reivindicacao[]> { return (await q(`SELECT dominio, token, verificado FROM plataforma.dominio WHERE tenant_id = $1 ORDER BY dominio`, [tenantId])).rows.map((r) => ({ dominio: r.dominio as string, verificado: r.verificado as boolean, registro: registro(r.dominio as string, r.token as string) })) },
    /** domínio que deixou de provar a posse (o cliente apagou o TXT, ou o domínio mudou de dono) PERDE a verificação: sem isso, um domínio abandonado serviria a um tenant para sempre */
    async revalida(limite = 100): Promise<{ conferidos: number; revogados: string[] }> {
      const lote = (await q(`SELECT tenant_id::text AS t, dominio, token FROM plataforma.dominio WHERE verificado ORDER BY verificado_em LIMIT $1`, [limite])).rows as Array<{ t: string; dominio: string; token: string }>
      const revogados: string[] = []
      for (const r of lote) { let txt: string[]; try { txt = await o.dns.txt(NOME_TXT(r.dominio)) } catch { continue } // DNS fora do ar NÃO revoga ninguém
        if (!txt.includes(`polaris-verificacao=${r.token}`)) { await q(`UPDATE plataforma.dominio SET verificado = false, verificado_em = NULL WHERE tenant_id = $1 AND dominio = $2`, [r.t, r.dominio]); revogados.push(r.dominio) } }
      return { conferidos: lote.length, revogados }
    },
  }
}

export type OpcoesResolvedor = { q: Q; bases: string[]; ttlMs?: number; ttlNegativoMs?: number; maxEntradas?: number; agora?: () => number }

/**
 * Host/ID → tenant, com cache. Positivo por pouco tempo (a suspensão tem de valer logo), negativo ainda menor, e LIMITADO: quem varia o cabeçalho Host não faz o mapa crescer nem
 * martela o banco (uma consulta por host novo, e a mesma consulta simultânea é UMA). `invalida` zera na hora (o mesmo processo que suspendeu).
 */
export function criaResolvedorTenant(o: OpcoesResolvedor) {
  const ttl = o.ttlMs ?? 30_000, ttlNeg = o.ttlNegativoMs ?? 5_000, max = o.maxEntradas ?? 5_000, agora = o.agora ?? Date.now
  const bases = o.bases.map((b) => b.toLowerCase())
  const cache = new Map<string, { v: InfoTenant | null; ate: number }>(), voo = new Map<string, Promise<InfoTenant | null>>()
  const INFO = `SELECT t.id::text AS id, t.status, coalesce((SELECT array_agg(m.servico ORDER BY m.servico) FROM plataforma.modulo m WHERE m.tenant_id = t.id), '{}') AS modulos FROM plataforma.tenant t`
  const info = (r: Record<string, unknown> | undefined): InfoTenant | null => (r ? { id: r.id as string, status: r.status as StatusTenant, modulos: [...(r.modulos as string[])] } : null)
  async function busca(chave: string): Promise<InfoTenant | null> {
    if (chave.startsWith('id:')) { const id = chave.slice(3); return UUID.test(id) ? info((await o.q(`${INFO} WHERE t.id = $1`, [id])).rows[0]) : null }
    const host = chave.slice(5)
    for (const b of bases) if (host.endsWith(`.${b}`)) { // subdomínio da plataforma: UM nível só, e alias reservado nunca é tenant
      const alias = host.slice(0, -(b.length + 1)); if (alias.includes('.') || ALIAS_RESERVADOS.has(alias)) return null
      return info((await o.q(`${INFO} WHERE t.alias = $1`, [alias])).rows[0])
    }
    if (bases.includes(host)) return null // o apex da plataforma não é de tenant
    return info((await o.q(`${INFO} WHERE t.id = (SELECT tenant_id FROM plataforma.dominio WHERE dominio = $1 AND verificado)`, [host])).rows[0]) // domínio próprio: só o VERIFICADO
  }
  async function com(chave: string): Promise<InfoTenant | null> {
    const t = agora(), c = cache.get(chave)
    if (c && c.ate > t) { cache.delete(chave); cache.set(chave, c); return c.v } // LRU: o mais recente vai para o fim
    const em = voo.get(chave); if (em) return em
    const p = busca(chave).then((v) => { cache.delete(chave); cache.set(chave, { v, ate: agora() + (v ? ttl : ttlNeg) }); while (cache.size > max) cache.delete(cache.keys().next().value as string); return v }).finally(() => { voo.delete(chave) })
    voo.set(chave, p); return p
  }
  return {
    async porHost(host: string): Promise<InfoTenant | null> { const h = normalizaHost(host); return h ? com(`host:${h}`) : null },
    async porId(id: string): Promise<InfoTenant | null> { return UUID.test(id) ? com(`id:${id.toLowerCase()}`) : null },
    invalida(): void { cache.clear() },
    get tamanho() { return cache.size },
  }
}

/** A mudança de estado de um tenant ATIVO/SUSPENSO/CANCELADO (provisionando/falhou são do cadastro). Cancelado é terminal. */
const DE: Record<string, string[]> = { ativo: ['suspenso', 'cancelado'], suspenso: ['ativo', 'cancelado'], cancelado: [] }
export async function mudaStatusTenant(q: Q, tenantId: string, para: 'ativo' | 'suspenso' | 'cancelado', motivo?: string): Promise<{ ok: true } | { ok: false; motivo: 'inexistente' | 'transicao_invalida'; de?: string }> {
  const r = (await q(`SELECT status FROM plataforma.tenant WHERE id = $1 FOR UPDATE`, [tenantId])).rows[0] as { status: string } | undefined
  if (!r) return { ok: false, motivo: 'inexistente' }
  if (r.status === para) return { ok: true }
  if (!(DE[r.status] ?? []).includes(para)) return { ok: false, motivo: 'transicao_invalida', de: r.status }
  await q(`UPDATE plataforma.tenant SET status = $2, motivo = $3, atualizado_em = now() WHERE id = $1`, [tenantId, para, motivo?.slice(0, 300) ?? null]); return { ok: true }
}
