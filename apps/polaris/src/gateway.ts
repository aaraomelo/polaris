import { clienteHttp, criaGateway } from '@polaris/gateway'
import { criaArmazemDeNos, criaPreview, criaReleases, criaResolvedorTenant } from '@polaris/packs'
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
  const gw = criaGateway({
    registry: reg, servicos, autenticador: autenticadorDe(c.jwt), ...(tenants ? { tenants } : {}), ...(releases ? { registros: { producao: (t: string, r: number | null) => releases.registroDeProducao(t, r) } } : {}), ...(releases && prev ? { preview: { verifica: (t: string) => prev.verifica(t), registro: (t: string, r: number) => releases.registroDe(t, r) } } : {}), tenantPorHost: (h) => hosts.get(h.toLowerCase()) ?? null,
    limiteTaxa: c.taxa, graphql: { introspeccao: c.introspeccao } as never,
    ...(c.metricasToken ? { metricasToken: c.metricasToken } : {}),
  })
  if (pool) gw.addHook('onClose', async () => { await pool.end() })
  return gw
}
