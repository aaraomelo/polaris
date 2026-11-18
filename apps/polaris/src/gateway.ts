import { clienteHttp, criaGateway } from '@polaris/gateway'
import { criaResolvedorTenant } from '@polaris/packs'
import { criaPool } from '@polaris/pg'
import type { Registry } from '@polaris/schema'
import { autenticadorDe } from './auth'
import type { ConfigGateway } from './config'

/** Com `plataforma`, o gateway consulta o diretório (status, módulos, domínios); sem ela, só o mapa estático de desenvolvimento. */
export function montaGateway(c: ConfigGateway, reg: Registry) {
  const pool = c.plataforma ? criaPool({ url: c.plataforma.url, max: 5 }) : null
  const tenants = c.plataforma && pool ? criaResolvedorTenant({ bases: c.plataforma.bases, q: async (sql, params) => { const r = await pool.query(sql, params as unknown[]); return { rows: r.rows as Array<Record<string, unknown>>, rowCount: r.rowCount ?? 0 } } }) : null
  const servicos = Object.fromEntries(Object.entries(c.servicos).map(([id, url]) => {
    const no = reg.resolve('servico', id)?.no
    if (!no) throw new Error(`serviço '${id}' não existe nos nós carregados`)
    return [id, { no, cliente: clienteHttp({ baseUrl: url }) }]
  }))
  const hosts = new Map(Object.entries(c.hosts).map(([h, t]) => [h.toLowerCase(), t.toLowerCase()]))
  const gw = criaGateway({
    registry: reg, servicos, autenticador: autenticadorDe(c.jwt), ...(tenants ? { tenants } : {}), tenantPorHost: (h) => hosts.get(h.toLowerCase()) ?? null,
    limiteTaxa: c.taxa, graphql: { introspeccao: c.introspeccao } as never,
    ...(c.metricasToken ? { metricasToken: c.metricasToken } : {}),
  })
  if (pool) gw.addHook('onClose', async () => { await pool.end() })
  return gw
}
