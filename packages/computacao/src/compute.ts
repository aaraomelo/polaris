import type { Entradas, Saidas } from './contrato'
import { KernelErro } from './erro'
import { emiteWasm, compilaWasm, type InstanciaWasm } from './wasm'
import { compilaJs, executaInterpretado } from './js'
import type { Kernel } from './ir'
import { emitePtx, nomeEntrada } from './ptx'
import { executaPtx } from './ptx-mock'
import { escolheAlvo, type Alvo, type Capacidades, type Custos, type Decisao } from './roteador'

// Serviço `compute`: fila JUSTA entre tenants, quotas e roteamento. Os alvos do servidor são js, wasm e ptx (webgl é do navegador).
// O driver de GPU é uma PORTA: o mock (interpretador de PTX) valida o emissor; um driver CUDA real (cuModuleLoadData + cuLaunchKernel) implementa a mesma interface e NÃO foi verificado aqui (sem GPU).
export interface DriverGpu {
  nome: string
  executa(args: { ptx: string; entrada: string; kernel: Kernel; entradas: Entradas; n: number }): Promise<Saidas>
}
export const driverGpuMock = (): DriverGpu => ({ nome: 'mock-ptx', executa: async ({ ptx, kernel, entradas, n }) => executaPtx(kernel, ptx, entradas, n) })

export type Quotas = { maxElementosPorJob: number; maxPendentesPorTenant: number; maxPendentesTotal: number; concorrencia: number; esperaMaximaMs: number }
export const QUOTAS_PADRAO: Quotas = { maxElementosPorJob: 4_000_000, maxPendentesPorTenant: 16, maxPendentesTotal: 256, concorrencia: 2, esperaMaximaMs: 30_000 }
export class QuotaErro extends Error { constructor(readonly codigo: 'elementos' | 'tenant_cheio' | 'fila_cheia' | 'espera', m: string) { super(m); this.name = 'QuotaErro' } }

export type Job = { tenant: string; kernel: Kernel; entradas: Entradas; n: number; alvo?: Alvo }
export type Resultado = { saidas: Saidas; alvo: Alvo; decisao: Decisao; esperaMs: number; execMs: number }
type Pendente = { job: Job; entra: number; ok: (r: Resultado) => void; falha: (e: unknown) => void }

export type OpcoesCompute = { drivers?: { ptx?: DriverGpu }; quotas?: Partial<Quotas>; custos?: Custos; agora?: () => number }

export function criaCompute(o: OpcoesCompute = {}) {
  const q: Quotas = { ...QUOTAS_PADRAO, ...o.quotas }, agora = o.agora ?? (() => performance.now())
  const cap: Capacidades = { js: true, wasm: typeof WebAssembly !== 'undefined', ...(o.drivers?.ptx ? { ptx: true } : {}) }
  const filas = new Map<string, Pendente[]>(); const ordem: string[] = []; let ativos = 0, pendentes = 0, cursor = 0
  const wasm = new WeakMap<Kernel, Promise<InstanciaWasm>>(), js = new WeakMap<Kernel, ReturnType<typeof compilaJs>>(), ptx = new WeakMap<Kernel, string>()

  async function executa(job: Job): Promise<{ saidas: Saidas; alvo: Alvo; decisao: Decisao }> {
    const decisao = escolheAlvo(job.kernel, job.n, cap, o.custos)
    let alvo = decisao.alvo
    if (job.alvo) { const c = decisao.candidatos.find((x) => x.alvo === job.alvo); if (!c || c.custo === undefined) throw new KernelErro(`alvo ${job.alvo} indisponível: ${c?.motivo ?? 'desconhecido'}`); alvo = job.alvo }
    const k = job.kernel
    if (alvo === 'ptx') { let t = ptx.get(k); if (!t) { t = emitePtx(k); ptx.set(k, t) }; return { saidas: await o.drivers!.ptx!.executa({ ptx: t, entrada: nomeEntrada(k.id), kernel: k, entradas: job.entradas, n: job.n }), alvo, decisao } }
    if (alvo === 'wasm') { let p = wasm.get(k); if (!p) { p = compilaWasm(k, emiteWasm(k)); wasm.set(k, p) }; return { saidas: (await p)(job.entradas, job.n), alvo, decisao } }
    if (alvo === 'js') { let f = js.get(k); if (!f) { f = compilaJs(k); js.set(k, f) }; return { saidas: f(job.entradas, job.n), alvo, decisao } }
    return { saidas: executaInterpretado(k, job.entradas, job.n), alvo, decisao } // webgl não existe no servidor: nunca escolhido (capacidade ausente)
  }

  /** próximo da fila em round-robin ENTRE TENANTS: um tenant com 16 jobs não passa na frente de quem tem 1 */
  function proximo(): Pendente | undefined {
    for (let j = 0; j < ordem.length; j++) {
      const t = ordem[(cursor + j) % ordem.length]!, f = filas.get(t)!
      if (f.length) { cursor = (cursor + j + 1) % ordem.length; return f.shift() }
    }
    return undefined
  }
  function bombeia(): void {
    while (ativos < q.concorrencia) {
      const p = proximo(); if (!p) return
      pendentes--; const espera = agora() - p.entra
      if (espera > q.esperaMaximaMs) { p.falha(new QuotaErro('espera', `o job esperou ${Math.round(espera)} ms na fila (máximo ${q.esperaMaximaMs})`)); continue }
      ativos++
      const t0 = agora()
      executa(p.job).then((r) => p.ok({ ...r, esperaMs: espera, execMs: agora() - t0 }), p.falha).finally(() => { ativos--; bombeia() })
    }
  }
  return {
    capacidades: () => ({ ...cap }),
    estado: () => ({ ativos, pendentes, porTenant: Object.fromEntries([...filas].map(([t, f]) => [t, f.length]).filter(([, n]) => (n as number) > 0)) }),
    submete(job: Job): Promise<Resultado> {
      if (job.n > q.maxElementosPorJob) return Promise.reject(new QuotaErro('elementos', `n=${job.n} acima da quota por job (${q.maxElementosPorJob})`))
      const fila = filas.get(job.tenant) ?? []
      if (fila.length >= q.maxPendentesPorTenant) return Promise.reject(new QuotaErro('tenant_cheio', `o tenant já tem ${fila.length} jobs na fila (máximo ${q.maxPendentesPorTenant})`))
      if (pendentes >= q.maxPendentesTotal) return Promise.reject(new QuotaErro('fila_cheia', 'fila global cheia'))
      if (!filas.has(job.tenant)) { filas.set(job.tenant, fila); ordem.push(job.tenant) }
      return new Promise<Resultado>((ok, falha) => { fila.push({ job, entra: agora(), ok, falha }); pendentes++; queueMicrotask(bombeia) })
    },
  }
}
