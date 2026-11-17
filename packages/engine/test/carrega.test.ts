import { Registry } from '@polaris/schema'
import { describe, expect, it, vi } from 'vitest'
import { CacheDados, carregaDado, carregaDados, compilaPrograma, registraBase, type PedidoServico, type Programa } from '../src/index'

const no = (kind: string, id: string, spec: object, extra: object = {}) => ({ kind, id, versao: '1.0.0', estatuto: 'publicado', spec, ...extra }) as any
const P = (b: string, extra: object = {}) => ({ bloco: b, ...extra })
const U = '11111111-1111-1111-1111-111111111111'

const monta = (dadosNos: Record<string, object>, dadosPagina: Record<string, unknown>, extraPagina: object = {}): Programa => {
  const r = new Registry()
  registraBase(r)
  r.registra(no('servico', 'catalogo', { entidades: {}, operacoes: {} }))
  for (const [id, spec] of Object.entries(dadosNos)) r.registra(no('dados', id, spec))
  const res = compilaPrograma(r, r.registra(no('pagina', 'p', { rota: '/', dados: dadosPagina, raiz: P('layout/pilha'), ...extraPagina })))
  if (!res.ok) throw new Error(JSON.stringify(res.erros, null, 1))
  return res.programa
}
const svc = (operacao: string, extra: object = {}) => ({ fonte: { tipo: 'servico', servico: 'catalogo', operacao }, ...extra })

describe('carregaDado: fontes e argumentos', () => {
  it('estático devolve cópia (não compartilha referência)', async () => {
    const pg = monta({ 'd.cfg': { fonte: { tipo: 'estatico', valor: { a: [1] } } } }, { cfg: 'd.cfg' })
    const a = await carregaDado(pg, 'cfg', { provedores: {} })
    const b = await carregaDado(pg, 'cfg', { provedores: {} })
    expect(a).toEqual({ ok: true, valor: { a: [1] } })
    expect((a as any).valor).not.toBe((b as any).valor)
  })

  it('serviço: recebe serviço, operação, args avaliados (params/consulta/estado) e tenant', async () => {
    const pg = monta(
      { 'd.prod': svc('listar', { parametros: { q: { tipo: 'texto' }, pagina: { tipo: 'inteiro', padrao: 1 }, id: { tipo: 'uuid' } } }) },
      { produtos: { dados: 'd.prod', args: { q: '{estado.termo}', pagina: '{consulta.p}', id: '{params.id}' } } },
      { estado: { termo: { tipo: 'texto', inicial: 'pão' } } },
    )
    const chamadas: PedidoServico[] = []
    const r = await carregaDado(pg, 'produtos', {
      provedores: { servico: async (p) => { chamadas.push(p); return [1, 2] } },
      params: { id: U }, consulta: { p: '3' }, estado: { termo: 'pão' }, tenant: { id: 't1' },
    })
    expect(r).toEqual({ ok: true, valor: [1, 2] })
    expect(chamadas).toHaveLength(1)
    expect(chamadas[0]).toMatchObject({ servico: 'catalogo', operacao: 'listar', args: { q: 'pão', pagina: 3, id: U }, tenant: { id: 't1' } })
    expect(chamadas[0]!.signal).toBeInstanceOf(AbortSignal)
  })

  it('argumento inválido não chama o provedor', async () => {
    const pg = monta({ 'd.prod': svc('listar', { parametros: { id: { tipo: 'uuid', obrigatorio: true } } }) }, { p: { dados: 'd.prod', args: { id: '{params.id}' } } })
    const prov = vi.fn(async () => 1)
    const r = await carregaDado(pg, 'p', { provedores: { servico: prov }, params: { id: 'lixo' } })
    expect(r).toMatchObject({ ok: false })
    expect((r as any).erro).toContain("deveria ser uuid")
    expect(prov).not.toHaveBeenCalled()
  })

  it('variável não declarada e provedor ausente têm mensagem clara', async () => {
    const pg = monta({ 'd.x': svc('x'), 'd.h': { fonte: { tipo: 'http', url: 'https://a.test/x' } } }, { x: 'd.x', h: 'd.h' })
    expect(await carregaDado(pg, 'nada', { provedores: {} })).toMatchObject({ ok: false, erro: expect.stringContaining('não declarada') })
    expect(await carregaDado(pg, 'x', { provedores: {} })).toMatchObject({ ok: false, erro: expect.stringContaining("tipo 'servico'") })
    expect(await carregaDado(pg, 'h', { provedores: {} })).toMatchObject({ ok: false, erro: expect.stringContaining("tipo 'http'") })
  })

  it('http usa o provedor (quem implementa decide a allowlist; o runtime nunca faz fetch)', async () => {
    const pg = monta({ 'd.h': { fonte: { tipo: 'http', url: 'https://a.test/x' } } }, { h: 'd.h' })
    const http = vi.fn(async (p: { url: string }) => ({ de: p.url }))
    expect(await carregaDado(pg, 'h', { provedores: { http } })).toEqual({ ok: true, valor: { de: 'https://a.test/x' } })
  })

  it('extras (de uma ação executar) se somam aos args declarados e os substituem', async () => {
    const pg = monta({ 'd.prod': svc('listar', { parametros: { q: { tipo: 'texto' }, pagina: { tipo: 'inteiro' } } }) }, { p: { dados: 'd.prod', args: { q: 'a', pagina: 1 } } })
    let visto: Record<string, unknown> = {}
    await carregaDado(pg, 'p', { provedores: { servico: async (p) => { visto = p.args; return null } } }, { pagina: 5 })
    expect(visto).toEqual({ q: 'a', pagina: 5 })
  })
})

describe('carregaDados: paralelo, erros por variável, manual', () => {
  it('carrega as auto em paralelo e não carrega as manuais', async () => {
    const pg = monta({ 'd.a': svc('a'), 'd.b': svc('b'), 'd.m': svc('m', { carregar: 'manual' }) }, { a: 'd.a', b: 'd.b', m: 'd.m' })
    const iniciadas: string[] = []
    let libera!: () => void
    const portao = new Promise<void>((r) => { libera = r })
    const p = carregaDados(pg, { provedores: { servico: async (x) => { iniciadas.push(x.operacao); await portao; return x.operacao } } })
    await new Promise((r) => setTimeout(r, 5))
    expect(iniciadas.sort()).toEqual(['a', 'b']) // as duas começaram antes de qualquer uma terminar
    libera()
    const r = await p
    expect(r).toEqual({ dados: { a: 'a', b: 'b' }, status: { a: 'ok', b: 'ok' }, erros: {} })
  })

  it('falha de uma fonte não derruba as outras e não lança', async () => {
    const pg = monta({ 'd.a': svc('a'), 'd.b': svc('b') }, { a: 'd.a', b: 'd.b' })
    const r = await carregaDados(pg, { provedores: { servico: async (x) => { if (x.operacao === 'a') throw new Error('boom'); return 'ok' } } })
    expect(r.status).toEqual({ a: 'erro', b: 'ok' })
    expect(r.dados).toEqual({ b: 'ok' })
  })

  it('o erro entregue é opaco; o detalhe vai só para onErro', async () => {
    const pg = monta({ 'd.a': svc('a') }, { a: 'd.a' })
    const onErro = vi.fn()
    const r = await carregaDados(pg, { provedores: { servico: async () => { throw new Error('conexão com db-interno:5432 recusada, senha=hunter2') } }, onErro })
    expect(r.erros.a).toBe('falha ao carregar os dados')
    expect(JSON.stringify(r)).not.toMatch(/hunter2|db-interno/)
    expect(onErro).toHaveBeenCalledWith(expect.objectContaining({ dados: 'a', fonte: 'd.a' }))
    expect(String((onErro.mock.calls[0]![0] as { erro: Error }).erro.message)).toContain('hunter2')
  })

  it('timeout: aborta o sinal e devolve erro; usa o da fonte quando houver', async () => {
    const pg = monta({ 'd.a': svc('a', { timeoutMs: 20 }), 'd.b': svc('b') }, { a: 'd.a', b: 'd.b' })
    let abortou = false
    const r = await carregaDados(pg, {
      timeoutPadraoMs: 15,
      provedores: { servico: (p) => new Promise((res) => { p.signal.addEventListener('abort', () => { abortou = true }); if (p.operacao === 'b') setTimeout(() => res('tarde'), 200) }) },
    })
    expect(r.status).toEqual({ a: 'erro', b: 'erro' })
    expect(r.erros.a).toBe('tempo esgotado (20 ms)')
    expect(r.erros.b).toBe('tempo esgotado (15 ms)')
    expect(abortou).toBe(true)
  })

  it('cancelamento externo aborta o sinal do provedor', async () => {
    const pg = monta({ 'd.a': svc('a') }, { a: 'd.a' })
    const ctl = new AbortController()
    let visto = false
    const p = carregaDado(pg, 'a', { signal: ctl.signal, timeoutPadraoMs: 500, provedores: { servico: (x) => new Promise(() => { x.signal.addEventListener('abort', () => { visto = true }) }) } })
    ctl.abort()
    await new Promise((r) => setTimeout(r, 5))
    expect(visto).toBe(true)
    await p.catch(() => {})
  })
})

describe('cache', () => {
  const fontes = { 'd.a': svc('a', { cache: { ttlSegundos: 60 }, parametros: { q: { tipo: 'texto' } } }) }
  const pagina = { a: { dados: 'd.a', args: { q: '{consulta.q}' } } }

  it('segunda chamada com os mesmos args não vai ao provedor; args diferentes vão', async () => {
    const pg = monta(fontes, pagina)
    const cache = new CacheDados()
    const prov = vi.fn(async (p: PedidoServico) => ({ q: p.args.q }))
    const op = (q: string) => ({ provedores: { servico: prov }, cache, consulta: { q }, tenant: { id: 't1' } })
    expect(await carregaDado(pg, 'a', op('x'))).toEqual({ ok: true, valor: { q: 'x' } })
    expect(await carregaDado(pg, 'a', op('x'))).toEqual({ ok: true, valor: { q: 'x' } })
    await carregaDado(pg, 'a', op('y'))
    expect(prov).toHaveBeenCalledTimes(2)
  })

  it('TENANTS ISOLADOS: o cache de um tenant nunca é entregue a outro', async () => {
    const pg = monta(fontes, pagina)
    const cache = new CacheDados()
    const prov = vi.fn(async (p: PedidoServico) => ({ dono: p.tenant.id }))
    const como = (id: string) => carregaDado(pg, 'a', { provedores: { servico: prov }, cache, consulta: { q: 'x' }, tenant: { id } })
    expect(await como('t1')).toEqual({ ok: true, valor: { dono: 't1' } })
    expect(await como('t2')).toEqual({ ok: true, valor: { dono: 't2' } })
    expect(await como('t1')).toEqual({ ok: true, valor: { dono: 't1' } })
    expect(prov).toHaveBeenCalledTimes(2)
  })

  it('o tenant isola até com chave de cache customizada (que não menciona o tenant)', async () => {
    const pg = monta({ 'd.a': svc('a', { cache: { ttlSegundos: 60, chave: 'fixa' } }) }, { a: 'd.a' })
    const cache = new CacheDados()
    const prov = vi.fn(async (p: PedidoServico) => ({ dono: p.tenant.id }))
    const como = (id: string) => carregaDado(pg, 'a', { provedores: { servico: prov }, cache, tenant: { id } })
    expect(await como('t1')).toEqual({ ok: true, valor: { dono: 't1' } })
    expect(await como('t2')).toEqual({ ok: true, valor: { dono: 't2' } })
  })

  it('chave customizada com template: valores iguais compartilham, diferentes não', async () => {
    const pg = monta(
      { 'd.a': svc('a', { cache: { ttlSegundos: 60, chave: 'busca:{args.q | minusculas}' }, parametros: { q: { tipo: 'texto' } } }) },
      { a: { dados: 'd.a', args: { q: '{consulta.q}' } } },
    )
    const cache = new CacheDados()
    const prov = vi.fn(async () => 1)
    const op = (q: string) => ({ provedores: { servico: prov }, cache, consulta: { q }, tenant: { id: 't' } })
    await carregaDado(pg, 'a', op('Pão')); await carregaDado(pg, 'a', op('pão')); await carregaDado(pg, 'a', op('bolo'))
    expect(prov).toHaveBeenCalledTimes(2)
  })

  it('expira pelo TTL (relógio injetado)', async () => {
    const pg = monta(fontes, pagina)
    let t = 1000
    const cache = new CacheDados({ agora: () => t })
    const prov = vi.fn(async () => 1)
    const op = { provedores: { servico: prov }, cache, consulta: { q: 'x' } }
    await carregaDado(pg, 'a', op); t += 59_000; await carregaDado(pg, 'a', op)
    expect(prov).toHaveBeenCalledTimes(1)
    t += 2_000; await carregaDado(pg, 'a', op)
    expect(prov).toHaveBeenCalledTimes(2)
  })

  it('erro não é cacheado', async () => {
    const pg = monta(fontes, pagina)
    const cache = new CacheDados()
    let n = 0
    const prov = async () => { if (++n === 1) throw new Error('x'); return 'ok' }
    const op = { provedores: { servico: prov }, cache, consulta: { q: 'x' } }
    expect(await carregaDado(pg, 'a', op)).toMatchObject({ ok: false })
    expect(await carregaDado(pg, 'a', op)).toEqual({ ok: true, valor: 'ok' })
  })

  it('chamadas concorrentes iguais viram uma só (deduplicação em voo)', async () => {
    const pg = monta(fontes, pagina)
    const cache = new CacheDados()
    const prov = vi.fn(async () => { await new Promise((r) => setTimeout(r, 10)); return 'v' })
    const op = { provedores: { servico: prov }, cache, consulta: { q: 'x' }, tenant: { id: 't' } }
    const rs = await Promise.all([carregaDado(pg, 'a', op), carregaDado(pg, 'a', op), carregaDado(pg, 'a', op)])
    expect(prov).toHaveBeenCalledTimes(1)
    expect(rs.every((r) => r.ok)).toBe(true)
  })

  it('o valor do cache não é compartilhado por referência (mutar a resposta não corrompe)', async () => {
    const pg = monta(fontes, pagina)
    const cache = new CacheDados()
    const op = { provedores: { servico: async () => ({ lista: [1] }) }, cache, consulta: { q: 'x' } }
    const miss = (await carregaDado(pg, 'a', op)) as { ok: true; valor: { lista: number[] } }
    miss.valor.lista.push(99)
    const hit1 = (await carregaDado(pg, 'a', op)) as { ok: true; valor: { lista: number[] } }
    expect(hit1.valor.lista).toEqual([1])
    hit1.valor.lista.push(77) // mutar o valor de um HIT também não pode corromper o que está guardado
    const hit2 = (await carregaDado(pg, 'a', op)) as { ok: true; valor: { lista: number[] } }
    expect(hit2.valor.lista).toEqual([1])
  })

  it('sem ttl a fonte não usa cache; LRU respeita o tamanho máximo', async () => {
    const pg = monta({ 'd.a': svc('a') }, { a: 'd.a' })
    const cache = new CacheDados()
    const prov = vi.fn(async () => 1)
    await carregaDado(pg, 'a', { provedores: { servico: prov }, cache }); await carregaDado(pg, 'a', { provedores: { servico: prov }, cache })
    expect(prov).toHaveBeenCalledTimes(2)
    expect(cache.tamanho).toBe(0)
    const c2 = new CacheDados({ maxItens: 2 })
    c2.set('a', 1, 60); c2.set('b', 2, 60); c2.get('a'); c2.set('c', 3, 60)
    expect(c2.get('b')).toBeUndefined() // b era o menos recente
    expect(c2.get('a')).toBeDefined()
    expect(c2.get('c')).toBeDefined()
  })
})
