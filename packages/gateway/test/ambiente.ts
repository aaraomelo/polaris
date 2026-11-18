process.env.POLARIS_LOG_NIVEL = 'silencio'
import { PGlite } from '@electric-sql/pglite'
import { criaAutenticadorJwt } from '@polaris/acesso'
import { COMPONENTES_BASE, registraBase } from '@polaris/engine'
import { criaObservabilidade, exportadorMemoria } from '@polaris/observabilidade'
import { Registry, emite, type No } from '@polaris/schema'
import { contextoPorJwt, criaServico, dbDePglite, regrasDoRegistry } from '@polaris/servico'
import { SignJWT, generateKeyPair } from 'jose'
import { FalhaServico, clienteEmProcesso, criaGateway, type ClienteServico, type PedidoServico, type Servicos } from '../src/index'

void COMPONENTES_BASE
export const A = '11111111-1111-1111-1111-111111111111', B = '22222222-2222-2222-2222-222222222222'
export const ISS = 'https://id.exemplo.com', AUD = 'polaris-api'
export const HOSTS: Record<string, string> = { 'a.loja.test': A, 'b.loja.test': B }

export const LOJA: No = { kind: 'servico', id: 'loja', versao: '1.0.0', estatuto: 'publicado', spec: {
  entidades: {
    cliente: { campos: { nome: { tipo: 'texto', obrigatorio: true } }, crud: { caminho: '/clientes' } },
    produto: { campos: { nome: { tipo: 'texto', obrigatorio: true }, preco: { tipo: 'dinheiro', obrigatorio: true } }, crud: { caminho: '/produtos' } },
    pedido: { campos: { criadoPor: { tipo: 'texto', obrigatorio: true }, clienteId: { tipo: 'uuid', referencia: 'cliente' }, total: { tipo: 'dinheiro', obrigatorio: true } }, crud: { caminho: '/pedidos' } },
    vitrine: { campos: { titulo: { tipo: 'texto' } }, crud: { caminho: '/vitrines', operacoes: ['listar'], permissao: 'publica' } },
  },
  operacoes: { quebra: { metodo: 'POST', caminho: '/quebra', entrada: {} } },
} } as never
const papel = (id: string, regras: object[]) => ({ kind: 'papel', id, versao: '1.0.0', estatuto: 'publicado', spec: { regras } }) as never

const no = (kind: string, id: string, spec: object) => ({ kind, id, versao: '1.0.0', estatuto: 'publicado', spec }) as never
const P = (b: string, extra: object = {}) => ({ bloco: b, ...extra })
const svc = (operacao: string, extra: object = {}) => ({ fonte: { tipo: 'servico', servico: 'loja', operacao }, ...extra })

/** O cliente do serviço com instrumentos: atraso, falha injetada, simultaneidade máxima e o registro de TODA chamada que chegou ao serviço. */
export function instrumenta(base: ClienteServico & { chamadas: PedidoServico[] }) {
  const estado = { atrasoMs: 0, falha: null as null | (() => never), emVoo: 0, maxVoo: 0, bloqueio: null as null | Promise<void> }
  const cliente: ClienteServico & { chamadas: PedidoServico[]; estado: typeof estado } = {
    chamadas: base.chamadas, estado,
    async chama(p, s) {
      estado.emVoo++; estado.maxVoo = Math.max(estado.maxVoo, estado.emVoo)
      try {
        if (estado.bloqueio) await estado.bloqueio
        if (estado.atrasoMs) await new Promise((r) => setTimeout(r, estado.atrasoMs))
        if (estado.falha) estado.falha()
        return await base.chama(p, s)
      } finally { estado.emVoo-- }
    },
  }
  return cliente
}

export type Ambiente = Awaited<ReturnType<typeof criaAmbiente>>
export async function criaAmbiente(opcoes: { gateway?: Record<string, unknown> } = {}) {
  const k = await generateKeyPair('RS256')
  const token = (sub: string, tid: string, papeis: string[], exp: string | number = '10m') => new SignJWT({ tid, papeis }).setProtectedHeader({ alg: 'RS256' }).setSubject(sub).setIssuer(ISS).setAudience(AUD).setExpirationTime(exp).sign(k.privateKey)
  const autentica = criaAutenticadorJwt({ emissor: ISS, audiencia: AUD, chave: { publica: k.publicKey } })

  const pg = new PGlite()
  await pg.exec(`CREATE ROLE migrador NOLOGIN BYPASSRLS; CREATE ROLE app NOLOGIN; GRANT CREATE ON DATABASE postgres TO migrador; SET ROLE migrador;`)
  await pg.exec(emite(LOJA, 'sql'))
  await pg.exec(`RESET ROLE; GRANT USAGE ON SCHEMA loja TO app; GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA loja TO app; SET ROLE app;`)

  const papeis = new Registry()
  papeis.registra(papel('vendedor', [
    { acoes: ['manage'], sujeitos: ['loja.produto', 'loja.cliente'] },
    { acoes: ['listar', 'obter', 'criar', 'atualizar'], sujeitos: ['loja.pedido'], onde: { criadoPor: '$usuario' } },
  ]))
  const spans = exportadorMemoria()
  const obsLoja = criaObservabilidade({ servico: 'loja', exportador: spans, nivel: 'silencio' })
  // o serviço atrás do gateway: o tenant de rota pública vem de `x-forwarded-host`, que SÓ o gateway envia
  const appLoja = criaServico(LOJA, {
    db: dbDePglite(pg), acesso: regrasDoRegistry(papeis), obs: obsLoja,
    contexto: contextoPorJwt(autentica, (r) => { const h = r.headers['x-forwarded-host']; const t = typeof h === 'string' ? HOSTS[h] : undefined; return t ? { tenantId: t } : null }),
    operacoes: { quebra: async () => { throw new Error('bug interno do serviço com segredo-interno-xyz') } },
  })
  await appLoja.ready()
  const clienteLoja = instrumenta(clienteEmProcesso(appLoja))

  // o registry do gateway: o serviço e as PÁGINAS do tenant (com os nós `dados`)
  const reg = new Registry(); registraBase(reg)
  reg.registra(LOJA as never)
  reg.registra(no('dados', 'd.vitrine', { fonte: svc('listarVitrine').fonte, cache: { ttlSegundos: 60 } }))
  reg.registra(no('dados', 'd.produtos', { ...svc('listarProduto'), parametros: { nome: { tipo: 'texto' } }, cache: { ttlSegundos: 60 } }))
  reg.registra(no('dados', 'd.pedidos', { ...svc('listarPedido'), cache: { ttlSegundos: 60 } }))
  reg.registra(no('dados', 'd.cliente', { ...svc('obterCliente'), parametros: { id: { tipo: 'uuid', obrigatorio: true } } }))
  reg.registra(no('dados', 'd.novoproduto', { ...svc('criarProduto'), parametros: { nome: { tipo: 'texto', obrigatorio: true }, preco: { tipo: 'dinheiro', obrigatorio: true } }, carregar: 'manual' }))
  reg.registra(no('dados', 'd.externo', { fonte: { tipo: 'http', url: 'http://interno.local/admin' } }))
  reg.registra(no('pagina', 'home', { rota: '/', dados: { vitrine: 'd.vitrine', produtos: 'd.produtos', pedidos: 'd.pedidos', novoProduto: 'd.novoproduto' }, raiz: P('texto/paragrafo', { props: { texto: 'oi' } }) }))
  reg.registra(no('pagina', 'ficha', { rota: '/ficha/:id', params: { id: { tipo: 'uuid' } }, dados: { cliente: { dados: 'd.cliente', args: { id: '{params.id}' } } }, raiz: P('texto/paragrafo', { props: { texto: '{cliente.nome}' } }) }))
  reg.registra(no('pagina', 'ext', { rota: '/ext', dados: { externo: 'd.externo' }, raiz: P('texto/paragrafo', { props: { texto: 'x' } }) }))

  const spansGw = exportadorMemoria()
  const logsGw: string[] = []
  const obsGw = criaObservabilidade({ servico: 'gateway', exportador: spansGw, saida: (l) => logsGw.push(l), nivel: 'debug' })
  const servicos: Servicos = { loja: { no: LOJA, cliente: clienteLoja } }
  const gw = criaGateway({ registry: reg, servicos, autenticador: autentica, tenantPorHost: (h: string) => HOSTS[h], obs: obsGw, metricasToken: 'token-de-metricas-16+', limiteTaxa: false, graphql: { introspeccao: false }, ...(opcoes.gateway ?? {}) } as never)
  await gw.ready()

  const req = (metodo: string, url: string, o: { tok?: string | null; corpo?: unknown; headers?: Record<string, string>; host?: string } = {}) =>
    gw.inject({ method: metodo as 'GET', url, headers: { host: o.host ?? 'a.loja.test', ...(o.tok ? { authorization: `Bearer ${o.tok}` } : {}), ...(o.corpo !== undefined ? { 'content-type': 'application/json' } : {}), ...(o.headers ?? {}) }, ...(o.corpo !== undefined ? { payload: typeof o.corpo === 'string' ? o.corpo : JSON.stringify(o.corpo) } : {}) })
  const json = (r: { body: string }) => JSON.parse(r.body)
  const bruto = async (sql: string, p: unknown[] = []) => { await pg.exec('RESET ROLE; SET ROLE migrador'); const r = (await pg.query(sql, p)).rows as Array<Record<string, any>>; await pg.exec('RESET ROLE; SET ROLE app'); return r }
  const semear = async () => {
    const t = await token('seed', A, ['vendedor']), tb = await token('seedb', B, ['vendedor'])
    const c = await appLoja.inject({ method: 'POST', url: '/clientes', headers: { authorization: `Bearer ${t}`, 'content-type': 'application/json' }, payload: JSON.stringify({ nome: 'Cliente A' }) })
    await appLoja.inject({ method: 'POST', url: '/produtos', headers: { authorization: `Bearer ${t}`, 'content-type': 'application/json' }, payload: JSON.stringify({ nome: 'Pão', preco: '4.50' }) })
    await appLoja.inject({ method: 'POST', url: '/produtos', headers: { authorization: `Bearer ${tb}`, 'content-type': 'application/json' }, payload: JSON.stringify({ nome: 'Só do B', preco: '1.00' }) })
    // a vitrine é pública e escrita direto no banco (o serviço só a lista)
    await bruto(`INSERT INTO loja.vitrine (tenant_id, titulo) VALUES ($1, 'Vitrine A'), ($2, 'Vitrine B')`, [A, B])
    return { clienteId: JSON.parse(c.body).id as string }
  }
  const fim = async () => { await gw.close(); await appLoja.close(); await pg.close() }
  return { gw, req, json, token, pg, bruto, semear, fim, clienteLoja, spans, spansGw, logsGw, obsGw, appLoja, reg, servicos, FalhaServico }
}
