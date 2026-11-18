import { describe, expect, it } from 'vitest'
import { configGateway, configServico, ErroConfig, type Env } from '../src/config'

const T = '11111111-1111-1111-1111-111111111111'
const base: Env = { POLARIS_NOS: '/nos', JWT_EMISSOR: 'https://id.x', JWT_AUDIENCIA: 'polaris', JWT_JWKS_URL: 'https://id.x/jwks.json' }
const srv: Env = { ...base, POLARIS_SERVICO: 'loja', DATABASE_URL: 'postgres://app:SENHA-SECRETA@db:5432/polaris' }
const gw: Env = { ...base, POLARIS_SERVICOS: '{"loja":"http://loja:3001"}' }
const problemas = (f: () => unknown): string[] => { try { f(); return [] } catch (e) { expect(e).toBeInstanceOf(ErroConfig); return (e as ErroConfig).problemas } }

describe('configServico', () => {
  it('configuração válida: padrões seguros (127.0.0.1, porta 3000)', () => {
    const c = configServico(srv); expect(c).toMatchObject({ servico: 'loja', porta: 3000, host: '127.0.0.1', producao: false, jwt: { chave: { jwksUrl: 'https://id.x/jwks.json' } } })
  })
  it('lista TODOS os problemas de uma vez e nunca ecoa a senha do banco', () => {
    const p = problemas(() => configServico({ DATABASE_URL: 'mysql://u:SENHA-SECRETA@x', PORT: '99999' }))
    expect(p.length).toBeGreaterThanOrEqual(5); expect(p.join('\n')).not.toContain('SENHA-SECRETA')
    expect(p.join('\n')).toMatch(/POLARIS_NOS é obrigatória/); expect(p.join('\n')).toMatch(/PORT deve ser/); expect(p.join('\n')).toMatch(/DATABASE_URL deve começar/)
  })
  it('url do banco inválida e mensagem de erro sem a URL', () => { const p = problemas(() => configServico({ ...srv, DATABASE_URL: 'não é url SENHA-SECRETA' })); expect(p.join()).toContain('não é uma URL'); expect(p.join()).not.toContain('SENHA') })
  it('JWT: exige exatamente uma fonte de chave; segredo HS256 só fora de produção e com 32+ caracteres', () => {
    const { JWT_JWKS_URL: _j, ...semChave } = srv
    expect(problemas(() => configServico(semChave)).join()).toMatch(/defina UMA chave/)
    expect(problemas(() => configServico({ ...srv, JWT_SEGREDO: 'x'.repeat(40) })).join()).toMatch(/só UMA/)
    expect(configServico({ ...semChave, JWT_SEGREDO: 'x'.repeat(40) }).jwt.chave).toEqual({ segredo: 'x'.repeat(40) })
    expect(problemas(() => configServico({ ...semChave, JWT_SEGREDO: 'curto' })).join()).toMatch(/ao menos 32/)
    expect(problemas(() => configServico({ ...semChave, JWT_SEGREDO: 'x'.repeat(40), NODE_ENV: 'production' })).join()).toMatch(/não é aceito em produção/)
  })
  it('JWK público: recusa chave PRIVADA (campo d) e JSON ruim; JWKS sem credenciais na URL', () => {
    const { JWT_JWKS_URL: _j, ...semChave } = srv
    expect(configServico({ ...semChave, JWT_CHAVE_PUBLICA_JWK: '{"kty":"OKP","crv":"Ed25519","x":"abc"}' }).jwt.chave).toHaveProperty('jwk')
    expect(problemas(() => configServico({ ...semChave, JWT_CHAVE_PUBLICA_JWK: '{"kty":"OKP","d":"privada"}' })).join()).toMatch(/PÚBLICA/)
    expect(problemas(() => configServico({ ...semChave, JWT_CHAVE_PUBLICA_JWK: '{' })).join()).toMatch(/não é JSON/)
    expect(problemas(() => configServico({ ...srv, JWT_JWKS_URL: 'https://u:p@id.x/j' })).join()).toMatch(/usuário\/senha/)
  })
  it('migração: o migrador é obrigatório com POLARIS_MIGRAR=1 e NUNCA pode ser a mesma URL da aplicação (a app não usa papel que ignora a RLS)', () => {
    expect(problemas(() => configServico({ ...srv, POLARIS_MIGRAR: '1' })).join()).toMatch(/DATABASE_URL_MIGRADOR é obrigatória/)
    expect(problemas(() => configServico({ ...srv, POLARIS_MIGRAR: '1', DATABASE_URL_MIGRADOR: srv.DATABASE_URL })).join()).toMatch(/DIFERENTE/)
    expect(configServico({ ...srv, POLARIS_MIGRAR: '1', DATABASE_URL_MIGRADOR: 'postgres://mig:x@db/polaris' }).migrar).toEqual({ url: 'postgres://mig:x@db/polaris', papelApp: 'polaris_app' })
    expect(problemas(() => configServico({ ...srv, POLARIS_PAPEL_APP: 'a; DROP' })).join()).toMatch(/POLARIS_PAPEL_APP inválido/)
  })
  it('id de serviço, métricas e hosts validados', () => {
    expect(problemas(() => configServico({ ...srv, POLARIS_SERVICO: '../etc' })).join()).toMatch(/POLARIS_SERVICO inválido/)
    expect(problemas(() => configServico({ ...srv, POLARIS_METRICAS_TOKEN: 'curto' })).join()).toMatch(/16 caracteres/)
    expect(configServico({ ...srv, POLARIS_HOSTS: JSON.stringify({ 'loja.exemplo.com': T }) }).hosts).toEqual({ 'loja.exemplo.com': T })
    expect(problemas(() => configServico({ ...srv, POLARIS_HOSTS: '{"a.com":"nao-uuid"}' })).join()).toMatch(/POLARIS_HOSTS/)
  })
  it('PORT: inteiro de 1 a 65535 (sem decimais, sem lixo)', () => { for (const v of ['0', '70000', '3.5', 'abc', '-1']) expect(problemas(() => configServico({ ...srv, PORT: v })).join(), v).toMatch(/PORT/); expect(configServico({ ...srv, PORT: '8080' }).porta).toBe(8080) })
})

describe('configGateway', () => {
  it('válida; taxa padrão e introspecção desligada', () => { expect(configGateway(gw)).toMatchObject({ servicos: { loja: 'http://loja:3001' }, taxa: { capacidade: 120, porSegundo: 20 }, introspeccao: false }) })
  it('URLs de serviço: só http(s), sem credenciais, sem query/hash; ids fechados', () => {
    for (const u of ['ftp://x', 'http://u:p@x', 'http://x?a=1', 'http://x#h', 'lixo']) expect(problemas(() => configGateway({ ...gw, POLARIS_SERVICOS: JSON.stringify({ loja: u }) })).join(), u).toMatch(/URL inválida/)
    expect(problemas(() => configGateway({ ...gw, POLARIS_SERVICOS: '{"Loja X":"http://x"}' })).join()).toMatch(/id de serviço inválido/)
    expect(problemas(() => configGateway({ ...gw, POLARIS_SERVICOS: '{}' })).join()).toMatch(/POLARIS_SERVICOS/)
    expect(problemas(() => configGateway(base)).join()).toMatch(/POLARIS_SERVICOS é obrigatória/)
  })
  it('introspecção GraphQL só fora de produção; limite de taxa pode ser desligado só explicitamente', () => {
    expect(configGateway({ ...gw, POLARIS_GRAPHQL_INTROSPECCAO: '1' }).introspeccao).toBe(true)
    expect(configGateway({ ...gw, POLARIS_GRAPHQL_INTROSPECCAO: '1', NODE_ENV: 'production' }).introspeccao).toBe(false)
    expect(configGateway({ ...gw, POLARIS_LIMITE_TAXA: 'desligado' }).taxa).toBe(false)
    expect(configGateway({ ...gw, POLARIS_LIMITE_TAXA: 'false' }).taxa).toEqual({ capacidade: 120, porSegundo: 20 })
    expect(problemas(() => configGateway({ ...gw, POLARIS_TAXA_CAPACIDADE: '0' })).join()).toMatch(/POLARIS_TAXA_CAPACIDADE/)
  })
})
