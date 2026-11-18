import { clienteHttp, criaGateway } from '@polaris/gateway'
import { criaArmazemDeNos, criaPreview, criaReleases, criaResolvedorTenant, nosDoPack, rotasStudio, sessaoDeToken } from '@polaris/packs'
import { previsualiza, rotasEstaticasStudio } from '@polaris/studio-app'
import { criaPool } from '@polaris/pg'
import type { Registry } from '@polaris/schema'
import { autenticadorDe } from './auth'
import type { ConfigGateway } from './config'

/** Com `plataforma`, o gateway consulta o diretório (status, módulos, domínios); sem ela, só o mapa estático de desenvolvimento. */
export function montaGateway(c: ConfigGateway, reg: Registry) {
  const pool = c.plataforma ? criaPool({ url: c.plataforma.url, max: 5 }) : null
  const tenants = c.plataforma && pool ? criaResolvedorTenant({ bases: c.plataforma.bases, q: async (sql, params) => { const r = await pool.query(sql, params as unknown[]); return { rows: r.rows as Array<Record<string, unknown>>, rowCount: r.rowCount ?? 0 } } }) : null
  // releases: o registro de cada tenant = core + a release de PRODUÇÃO dele; o preview é um link assinado de uma release ainda não promovida
  const qp = pool ? async (sql: string, params?: unknown[]) => { const r = await pool.query(sql, params as unknown[]); return { rows: r.rows as Array<Record<string, unknown>>, rowCount: r.rowCount ?? 0 } } : null
  const releases = pool && qp ? criaReleases({
    armazemDe: (q) => criaArmazemDeNos({ q, base: reg }),
    db: { transacao: async (fn) => { const cx = await pool.connect(); try { await cx.query('BEGIN'); const r = await fn(async (sql, params) => { const x = await cx.query(sql, params as unknown[]); return { rows: x.rows as Array<Record<string, unknown>>, rowCount: x.rowCount ?? 0 } }); await cx.query('COMMIT'); return r } catch (e) { await cx.query('ROLLBACK').catch(() => {}); throw e } finally { cx.release() } } },
  }) : null
  const prev = c.previewSegredo ? criaPreview({ segredo: c.previewSegredo, ...(c.previewAnteriores ? { anteriores: c.previewAnteriores } : {}) }) : null
  const servicos = Object.fromEntries(Object.entries(c.servicos).map(([id, url]) => {
    const no = reg.resolve('servico', id)?.no
    if (!no) throw new Error(`serviço '${id}' não existe nos nós carregados`)
    return [id, { no, cliente: clienteHttp({ baseUrl: url }) }]
  }))
  const hosts = new Map(Object.entries(c.hosts).map(([h, t]) => [h.toLowerCase(), t.toLowerCase()]))
  // páginas dos tenants (`GET /…`): o nó `tenant` de cada um tem como id o ALIAS do diretório; o alias de um tenant não muda, então fica em cache
  const aliases = new Map<string, string>()
  const paginas = qp ? { cookieSeguro: c.producao, tenantNo: async (c: { tenantId: string }) => {
    const a = aliases.get(c.tenantId); if (a) return a
    const r = (await qp(`SELECT alias FROM plataforma.tenant WHERE id = $1`, [c.tenantId])).rows[0]?.alias
    if (typeof r === 'string') { aliases.set(c.tenantId, r); while (aliases.size > 5000) aliases.delete(aliases.keys().next().value as string); return r }
    return undefined
  } } : null
  // Studio: `/studio` (cliente) e `/studio/*` (API de autoria) no MESMO servidor, com a autenticação do gateway: o tenant e o usuário vêm só do token, e a permissão dos papéis `studio.*`
  if (c.studioDir) for (const n of nosDoPack('studio')) { try { reg.registra(n) } catch { /* já registrado (nós carregados do diretório) */ } }
  const studio = c.studioDir && qp ? (() => {
    const armazem = criaArmazemDeNos({ q: qp, base: reg }), dir = c.studioDir
    return (app: import('fastify').FastifyInstance, api: { sessao(req: import('fastify').FastifyRequest): Promise<{ tenantId: string; usuario?: string; papeis?: string[] } | null> }) => {
      void app.register(async (inst) => {
        rotasEstaticasStudio(inst, dir)
        rotasStudio(inst, { previsualiza, ...(prev ? { previewEmite: (t: string, r: number, ttl: number) => prev.emite(t, r, ttl) } : {}), ...(releases ? { releases: {
          lista: (t: string, n?: number) => releases.lista(t, n), producao: (t: string) => releases.producao(t), diferenca: (t: string, de: number, para: number) => releases.diferenca(t, de, para),
          rollback: async (t: string, autor: string, para?: number, nota?: string) => { const r = await releases.rollback(t, autor, para, nota); if (r.ok) tenants?.invalida(); return r }, // o diretório guarda a release de produção em cache
        } } : {}), ...(paginas ? { tenantNo: (t: string) => paginas.tenantNo({ tenantId: t }) } : {}), ...(releases ? { publicar: async (a: { tenantId: string; autor: string; nota?: string }) => {
          const c = await releases.cria(a.tenantId, a.autor, a.nota); if (!c.ok) return c
          const p = await releases.promove(a.tenantId, c.release.numero, a.autor, a.nota); if (!p.ok) return p
          tenants?.invalida() // o diretório guarda a release de produção em cache: sem isto o site só mudaria quando o cache vencesse
          return { ok: true as const, release: c.release.numero }
        } } : {}), armazem, baseDe: async () => reg, q: qp, autentica: async (req) => { const s = await api.sessao(req); return s?.usuario ? sessaoDeToken(reg, { tenantId: s.tenantId, usuario: s.usuario, papeis: s.papeis ?? [] }) : null } })
      })
    }
  })() : null
  const gw = criaGateway({
    ...(paginas ? { paginas } : {}),
    ...(studio ? { estende: studio as never } : {}),
    registry: reg, servicos, autenticador: autenticadorDe(c.jwt), ...(tenants ? { tenants } : {}), ...(releases ? { registros: { producao: (t: string, r: number | null) => releases.registroDeProducao(t, r) } } : {}), ...(releases && prev ? { preview: { verifica: (t: string) => prev.verifica(t), registro: (t: string, r: number) => releases.registroDe(t, r) } } : {}), tenantPorHost: (h) => hosts.get(h.toLowerCase()) ?? null,
    limiteTaxa: c.taxa, graphql: { introspeccao: c.introspeccao } as never,
    ...(c.metricasToken ? { metricasToken: c.metricasToken } : {}),
  })
  if (pool) gw.addHook('onClose', async () => { await pool.end() })
  return gw
}
