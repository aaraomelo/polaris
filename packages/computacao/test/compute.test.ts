import { describe, expect, it } from 'vitest'
import { compilaKernel, criaCompute, driverGpuMock, executaInterpretado, QuotaErro, type DriverGpu } from '../src'
import { geraKernel } from './gera'

const saxpy = compilaKernel('saxpy', { entradas: { a: { tipo: 'decimal' }, x: { tipo: 'decimal', lista: true }, y: { tipo: 'decimal', lista: true } }, saidas: { r: { tipo: 'decimal', lista: true } }, corpo: { saidas: { r: 'a * x + y' } } })
const ent = (n: number) => ({ a: 2, x: Array.from({ length: n }, (_, i) => i), y: Array.from({ length: n }, () => 1) })
const gate = () => { let abre!: () => void; const p = new Promise<void>((r) => { abre = r }); return { p, abre } }

describe('serviço compute', () => {
  it('cada alvo do servidor dá o MESMO resultado bit a bit, e o job informa decisão e tempos', async () => {
    const c = criaCompute({ drivers: { ptx: driverGpuMock() } }); const g = geraKernel(11), k = compilaKernel('g', g.spec), e = g.entradas(50) as any
    const ref = executaInterpretado(k, e, 50)
    for (const alvo of ['js', 'wasm', 'ptx'] as const) { const r = await c.submete({ tenant: 't', kernel: k, entradas: e, n: 50, alvo }); expect(r.alvo).toBe(alvo); for (const nome of Object.keys(ref)) expect(Array.from(r.saidas[nome]!)).toEqual(Array.from(ref[nome]!)) }
    const auto = await c.submete({ tenant: 't', kernel: k, entradas: e, n: 50 }); expect(auto.decisao.candidatos.length).toBe(4); expect(auto.execMs).toBeGreaterThanOrEqual(0)
  })
  it('alvo pedido que não existe aqui é recusado com o motivo (webgl no servidor; ptx sem driver)', async () => {
    const c = criaCompute(); await expect(c.submete({ tenant: 't', kernel: saxpy, entradas: ent(3), n: 3, alvo: 'webgl' })).rejects.toThrow(/indisponível: sem WebGL2/)
    await expect(c.submete({ tenant: 't', kernel: saxpy, entradas: ent(3), n: 3, alvo: 'ptx' })).rejects.toThrow(/sem driver/)
  })
  it('quotas: elementos por job, pendentes por tenant e total; e a fila anda de novo quando esvazia', async () => {
    const g = gate(); const lento: DriverGpu = { nome: 'lento', executa: async (a) => { await g.p; return driverGpuMock().executa(a) } }
    const c = criaCompute({ drivers: { ptx: lento }, quotas: { concorrencia: 1, maxPendentesPorTenant: 2, maxPendentesTotal: 3, maxElementosPorJob: 100 } })
    const j = (tenant: string, n = 4) => c.submete({ tenant, kernel: saxpy, entradas: ent(n), n, alvo: 'ptx' })
    await expect(j('a', 101)).rejects.toMatchObject({ codigo: 'elementos' })
    const ps = [j('a')]; await new Promise((r) => setTimeout(r, 5)); ps.push(j('a'), j('a')) // 1 executando + 2 na fila
    await new Promise((r) => setTimeout(r, 5)); expect(c.estado()).toMatchObject({ ativos: 1, pendentes: 2 })
    await expect(j('a')).rejects.toMatchObject({ codigo: 'tenant_cheio' })
    const pb = j('b'); await expect(j('c')).rejects.toMatchObject({ codigo: 'fila_cheia' }); expect(QuotaErro.name).toBe('QuotaErro')
    g.abre(); const rs = await Promise.all([...ps, pb]); expect(rs.every((r) => r.saidas.r!.length === 4)).toBe(true)
    expect(c.estado()).toEqual({ ativos: 0, pendentes: 0, porTenant: {} })
    await expect(j('a')).resolves.toBeDefined()
  })
  it('justiça: um tenant com muitos jobs não passa na frente de quem tem um', async () => {
    const g = gate(); const ordem: string[] = []
    const driver: DriverGpu = { nome: 'ordem', executa: async (a) => { ordem.push(String(a.entradas.a)); await g.p; return driverGpuMock().executa(a) } }
    const c = criaCompute({ drivers: { ptx: driver }, quotas: { concorrencia: 1 } })
    const j = (tenant: string, a: number) => c.submete({ tenant, kernel: saxpy, entradas: { ...ent(2), a }, n: 2, alvo: 'ptx' })
    const todos = [j('A', 1), j('A', 2), j('A', 3), j('A', 4), j('B', 100), j('C', 200)]
    await new Promise((r) => setTimeout(r, 5)); g.abre(); await Promise.all(todos)
    expect(ordem).toEqual(['1', '100', '200', '2', '3', '4']) // A1 já rodava; depois B e C intercalam com o resto de A
  })
  it('espera máxima: job parado na fila além do limite falha, e a fila continua', async () => {
    const g = gate(); let t = 0; const driver: DriverGpu = { nome: 'p', executa: async (a) => { await g.p; return driverGpuMock().executa(a) } }
    const c = criaCompute({ drivers: { ptx: driver }, quotas: { concorrencia: 1, esperaMaximaMs: 1000 }, agora: () => t })
    const j = (a: number) => c.submete({ tenant: 'a', kernel: saxpy, entradas: { ...ent(2), a }, n: 2, alvo: 'ptx' })
    const p1 = j(1), p2 = j(2); await new Promise((r) => setTimeout(r, 5)); t = 5000; g.abre()
    await expect(p1).resolves.toBeDefined(); await expect(p2).rejects.toMatchObject({ codigo: 'espera' }); await expect(j(3)).resolves.toBeDefined()
  })
  it('um job inválido falha sozinho (entrada ruim) e não trava os outros', async () => {
    const c = criaCompute({ quotas: { concorrencia: 1 } })
    const [a, b, d] = await Promise.allSettled([c.submete({ tenant: 't', kernel: saxpy, entradas: { a: 1, x: [1], y: [1] }, n: 1 }), c.submete({ tenant: 't', kernel: saxpy, entradas: { a: 1, x: [1] }, n: 1 }), c.submete({ tenant: 't', kernel: saxpy, entradas: ent(2), n: 2 })])
    expect(a.status).toBe('fulfilled'); expect(b.status).toBe('rejected'); expect(d.status).toBe('fulfilled')
  })
})
