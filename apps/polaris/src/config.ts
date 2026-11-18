// Configuração por AMBIENTE, estrita: tudo é validado na partida e o processo NÃO sobe com configuração ruim (falha rápida, com TODOS os problemas listados).
// Segredos (URL do banco com senha, chave, token) nunca aparecem em mensagens de erro nem em log.

export type Env = Record<string, string | undefined>
export class ErroConfig extends Error { constructor(readonly problemas: string[]) { super(`configuração inválida:\n${problemas.map((p) => `  - ${p}`).join('\n')}`); this.name = 'ErroConfig' } }

class Leitor {
  readonly problemas: string[] = []
  constructor(readonly env: Env) {}
  texto(nome: string, o: { obrigatorio?: boolean; padrao?: string } = {}): string | undefined {
    const v = this.env[nome]?.trim()
    if (v) return v
    if (o.obrigatorio) this.problemas.push(`${nome} é obrigatória`)
    return o.padrao
  }
  inteiro(nome: string, padrao: number, min: number, max: number): number {
    const v = this.env[nome]?.trim(); if (!v) return padrao
    const n = Number(v)
    if (!Number.isInteger(n) || n < min || n > max) { this.problemas.push(`${nome} deve ser um inteiro entre ${min} e ${max}`); return padrao }
    return n
  }
  /** URL com protocolo permitido; NUNCA ecoa a URL (pode ter senha) */
  url(nome: string, protocolos: string[], o: { obrigatorio?: boolean; semCredenciais?: boolean } = {}): string | undefined {
    const v = this.texto(nome, o); if (!v) return undefined
    try {
      const u = new URL(v)
      if (!protocolos.includes(u.protocol)) this.problemas.push(`${nome} deve começar com ${protocolos.map((p) => `${p}//`).join(' ou ')}`)
      else if (o.semCredenciais && (u.username || u.password)) this.problemas.push(`${nome} não pode ter usuário/senha na URL`)
    } catch { this.problemas.push(`${nome} não é uma URL válida`) }
    return v
  }
  json<T>(nome: string, valida: (v: unknown) => string | null): T | undefined {
    const v = this.env[nome]?.trim(); if (!v) return undefined
    let x: unknown
    try { x = JSON.parse(v) } catch { this.problemas.push(`${nome} não é JSON válido`); return undefined }
    const erro = valida(x); if (erro) { this.problemas.push(`${nome}: ${erro}`); return undefined }
    return x as T
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const ID_SERVICO = /^[a-z][a-z0-9.-]{0,62}$/

export type ConfigJwt = { emissor: string; audiencia: string; chave: { jwksUrl: string } | { jwk: Record<string, unknown> } | { segredo: string } }
export type ConfigComum = { nos: string; porta: number; host: string; producao: boolean; hosts: Record<string, string>; jwt: ConfigJwt; metricasToken?: string }

function comum(l: Leitor): Omit<ConfigComum, "nos" | "jwt"> & { nos?: string | undefined; jwt?: ConfigJwt } {
  const producao = (l.env.NODE_ENV ?? '') === 'production'
  const nos = l.texto('POLARIS_NOS', { obrigatorio: true })
  const hosts = l.json<Record<string, string>>('POLARIS_HOSTS', (v) => (v && typeof v === 'object' && !Array.isArray(v) && Object.entries(v).every(([h, t]) => /^[a-z0-9.-]{1,253}$/i.test(h) && typeof t === 'string' && UUID.test(t)) ? null : 'deve ser {"host": "<uuid do tenant>"}')) ?? {}
  const emissor = l.texto('JWT_EMISSOR', { obrigatorio: true }), audiencia = l.texto('JWT_AUDIENCIA', { obrigatorio: true })
  const jwks = l.url('JWT_JWKS_URL', ['https:', 'http:'], { semCredenciais: true }), jwk = l.json<Record<string, unknown>>('JWT_CHAVE_PUBLICA_JWK', (v) => (v && typeof v === 'object' && 'kty' in v && !('d' in v) ? null : 'deve ser uma chave PÚBLICA em JWK (sem o campo privado "d")'))
  const segredo = l.texto('JWT_SEGREDO')
  const fontes = [jwks, jwk, segredo].filter((x) => x !== undefined).length
  if (fontes === 0) l.problemas.push('defina UMA chave de verificação: JWT_JWKS_URL, JWT_CHAVE_PUBLICA_JWK ou (só em desenvolvimento) JWT_SEGREDO')
  if (fontes > 1) l.problemas.push('defina só UMA de JWT_JWKS_URL, JWT_CHAVE_PUBLICA_JWK e JWT_SEGREDO')
  if (segredo !== undefined && producao) l.problemas.push('JWT_SEGREDO (HS256) não é aceito em produção: use chave pública (JWKS ou JWK), para que quem verifica não possa também emitir tokens')
  if (segredo !== undefined && segredo.length < 32) l.problemas.push('JWT_SEGREDO deve ter ao menos 32 caracteres')
  const metricas = l.texto('POLARIS_METRICAS_TOKEN'); if (metricas !== undefined && metricas.length < 16) l.problemas.push('POLARIS_METRICAS_TOKEN deve ter ao menos 16 caracteres')
  const chave = jwks ? { jwksUrl: jwks } : jwk ? { jwk } : segredo ? { segredo } : undefined
  return { producao, nos, hosts, porta: l.inteiro('PORT', 3000, 1, 65535), host: l.texto('HOST', { padrao: '127.0.0.1' })!, ...(emissor && audiencia && chave ? { jwt: { emissor, audiencia, chave } } : {}), ...(metricas ? { metricasToken: metricas } : {}) }
}

export type ConfigServico = ConfigComum & { servico: string; bancoUrl: string; bancoPapel?: string; migrar?: { url: string; papelApp: string } }
export function configServico(env: Env): ConfigServico {
  const l = new Leitor(env); const c = comum(l)
  const servico = l.texto('POLARIS_SERVICO', { obrigatorio: true }); if (servico && !ID_SERVICO.test(servico)) l.problemas.push('POLARIS_SERVICO inválido')
  const bancoUrl = l.url('DATABASE_URL', ['postgres:', 'postgresql:'], { obrigatorio: true })
  const migrar = l.env.POLARIS_MIGRAR === '1' ? l.url('DATABASE_URL_MIGRADOR', ['postgres:', 'postgresql:'], { obrigatorio: true }) : undefined
  const papelApp = l.texto('POLARIS_PAPEL_APP', { padrao: 'polaris_app' })!; if (!/^[a-z_][a-z0-9_]{0,62}$/.test(papelApp)) l.problemas.push('POLARIS_PAPEL_APP inválido')
  const bancoPapel = l.texto('POLARIS_DB_PAPEL'); if (bancoPapel !== undefined && !/^[a-z_][a-z0-9_]{0,62}$/.test(bancoPapel)) l.problemas.push('POLARIS_DB_PAPEL inválido')
  if (migrar && bancoUrl && migrar === bancoUrl) l.problemas.push('DATABASE_URL_MIGRADOR deve ser DIFERENTE de DATABASE_URL: a aplicação nunca usa o papel que ignora a RLS')
  if (l.problemas.length) throw new ErroConfig(l.problemas)
  return { ...(c as ConfigComum), servico: servico!, bancoUrl: bancoUrl!, ...(bancoPapel ? { bancoPapel } : {}), ...(migrar ? { migrar: { url: migrar, papelApp } } : {}) }
}

export type ConfigGateway = ConfigComum & { previewSegredo?: string; plataforma?: { url: string; bases: string[] }; servicos: Record<string, string>; taxa: { capacidade: number; porSegundo: number } | false; introspeccao: boolean }
export function configGateway(env: Env): ConfigGateway {
  const l = new Leitor(env); const c = comum(l)
  const servicos = l.json<Record<string, string>>('POLARIS_SERVICOS', (v) => {
    if (!v || typeof v !== 'object' || Array.isArray(v) || !Object.keys(v).length) return 'deve ser {"servico": "http://host:porta"}'
    for (const [id, u] of Object.entries(v)) { if (!ID_SERVICO.test(id)) return `id de serviço inválido: ${id.slice(0, 30)}`; try { const x = new URL(String(u)); if (!['http:', 'https:'].includes(x.protocol) || x.username || x.password || x.search || x.hash) return `URL inválida para '${id}' (http(s), sem credenciais, sem query)` } catch { return `URL inválida para '${id}'` } }
    return null
  })
  if (!servicos && !l.problemas.some((p) => p.startsWith('POLARIS_SERVICOS'))) l.problemas.push('POLARIS_SERVICOS é obrigatória')
  const plataformaUrl = l.url('DATABASE_URL_PLATAFORMA', ['postgres:', 'postgresql:'])
  const bases = (l.texto('POLARIS_BASES_DOMINIO') ?? '').split(',').map((b) => b.trim().toLowerCase()).filter(Boolean)
  for (const b of bases) if (!/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(b)) l.problemas.push(`POLARIS_BASES_DOMINIO: '${b.slice(0, 40)}' não é um domínio`)
  if (plataformaUrl && !bases.length) l.problemas.push('POLARIS_BASES_DOMINIO é obrigatória com DATABASE_URL_PLATAFORMA (o domínio dos subdomínios dos tenants, ex.: polaris.app)')
  if (!plataformaUrl && bases.length) l.problemas.push('POLARIS_BASES_DOMINIO só vale com DATABASE_URL_PLATAFORMA')
  if (c.producao && !plataformaUrl) l.problemas.push('em produção o gateway exige DATABASE_URL_PLATAFORMA (status e módulos dos tenants); POLARIS_HOSTS é só para desenvolvimento')
  const previewSegredo = l.texto('POLARIS_PREVIEW_SEGREDO'); if (previewSegredo !== undefined && previewSegredo.length < 32) l.problemas.push('POLARIS_PREVIEW_SEGREDO deve ter ao menos 32 caracteres')
  if (previewSegredo !== undefined && !plataformaUrl) l.problemas.push('POLARIS_PREVIEW_SEGREDO só vale com DATABASE_URL_PLATAFORMA')
  const taxaDesligada = l.env.POLARIS_LIMITE_TAXA === 'desligado'
  const taxa = taxaDesligada ? false as const : { capacidade: l.inteiro('POLARIS_TAXA_CAPACIDADE', 120, 1, 100_000), porSegundo: l.inteiro('POLARIS_TAXA_POR_SEGUNDO', 20, 1, 100_000) }
  if (l.problemas.length) throw new ErroConfig(l.problemas)
  return { ...(c as ConfigComum), ...(plataformaUrl ? { plataforma: { url: plataformaUrl, bases } } : {}), ...(previewSegredo ? { previewSegredo } : {}), servicos: servicos!, taxa, introspeccao: l.env.POLARIS_GRAPHQL_INTROSPECCAO === '1' && !(c.producao) }
}
