import { clienteHttp, criaGateway } from '@polaris/gateway'
import type { Registry } from '@polaris/schema'
import { autenticadorDe } from './auth'
import type { ConfigGateway } from './config'

export function montaGateway(c: ConfigGateway, reg: Registry) {
  const servicos = Object.fromEntries(Object.entries(c.servicos).map(([id, url]) => {
    const no = reg.resolve('servico', id)?.no
    if (!no) throw new Error(`serviço '${id}' não existe nos nós carregados`)
    return [id, { no, cliente: clienteHttp({ baseUrl: url }) }]
  }))
  const hosts = new Map(Object.entries(c.hosts).map(([h, t]) => [h.toLowerCase(), t.toLowerCase()]))
  return criaGateway({
    registry: reg, servicos, autenticador: autenticadorDe(c.jwt), tenantPorHost: (h) => hosts.get(h.toLowerCase()) ?? null,
    limiteTaxa: c.taxa, graphql: { introspeccao: c.introspeccao } as never,
    ...(c.metricasToken ? { metricasToken: c.metricasToken } : {}),
  })
}
