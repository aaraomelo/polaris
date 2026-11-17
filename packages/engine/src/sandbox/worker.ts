import { createRequire } from 'node:module'
import { MessageChannel, receiveMessageOnPort, Worker, type MessagePort } from 'node:worker_threads'
import type { Sandbox } from '../codigo/sandbox'
import { executaPedido, type BrutoExecucao } from './local'

// QuickJS num worker_thread, com ponte SÍNCRONA (o SSR é síncrono): a thread principal envia o pedido pela MessagePort
// e bloqueia em Atomics.wait com timeout; o worker responde e notifica. Se o prazo duro estoura, o worker é MORTO
// (terminate): preempção real, que o interpretador sozinho não dá (chamadas nativas longas não são interrompíveis).
// Só Node: o navegador não pode bloquear a thread principal. Defesa em profundidade: o worker ainda aplica limite de
// memória e prazo cooperativo, e roda com resourceLimits próprios.

const CODIGO_WORKER = `
const { workerData } = require('node:worker_threads')
const { getQuickJS, shouldInterruptAfterDeadline } = require(workerData.qjsPath)
const flag = new Int32Array(workerData.sab)
getQuickJS().then((QJS) => {
  workerData.port.on('message', (req) => {
    let res, rt, ctx
    try {
      rt = QJS.newRuntime(); rt.setMemoryLimit(req.mem); rt.setMaxStackSize(req.pilha)
      rt.setInterruptHandler(shouldInterruptAfterDeadline(Date.now() + req.ms))
      ctx = rt.newContext()
      const r = ctx.evalCode(req.script)
      if (r.error) { const e = ctx.dump(r.error); r.error.dispose(); res = { ok: false, nome: String(e && e.name), mensagem: String(e && e.message) } }
      else { res = { ok: true, valor: ctx.getString(r.value) }; r.value.dispose() }
    } catch (e) { res = { ok: false, nome: 'HostError', mensagem: String(e && e.message) } }
    finally { try { ctx && ctx.dispose() } catch (_) {} try { rt && rt.dispose() } catch (_) {} }
    workerData.port.postMessage(res)
    Atomics.store(flag, 0, 1); Atomics.notify(flag, 0)
  })
  Atomics.store(flag, 1, 1); Atomics.notify(flag, 1)
})
`

export type OpcoesWorker = {
  /** tolerância além do prazo cooperativo antes de matar o worker (padrão 250 ms) */
  margemDuraMs?: number
  /** limites do heap V8 do worker, em MB (padrão 128) */
  heapMb?: number
}

/** Interno (exportado para teste): a ponte síncrona com o worker. Use criaSandboxWorker. */
export class Ponte {
  private w: Worker | undefined
  private port: MessagePort | undefined
  private flag = new Int32Array(new SharedArrayBuffer(8))
  fechado = false
  constructor(private readonly op: Required<OpcoesWorker>) {}

  private inicia(): boolean {
    this.flag = new Int32Array(new SharedArrayBuffer(8))
    const { port1, port2 } = new MessageChannel()
    const qjsPath = createRequire(import.meta.url).resolve('quickjs-emscripten')
    const w = new Worker(CODIGO_WORKER, {
      eval: true, workerData: { sab: this.flag.buffer, port: port2, qjsPath }, transferList: [port2],
      resourceLimits: { maxOldGenerationSizeMb: this.op.heapMb, maxYoungGenerationSizeMb: 32, stackSizeMb: 4 },
    })
    w.unref() // um worker ocioso não segura o processo aberto
    this.w = w; this.port = port1
    if (Atomics.wait(this.flag, 1, 0, 8000) === 'timed-out') { this.mata(); return false }
    return true
  }

  mata(): void {
    try { void this.w?.terminate() } catch { /* já morto */ }
    this.port?.close()
    this.w = undefined; this.port = undefined
  }

  roda(script: string, ms: number, mem: number): BrutoExecucao | 'morto' {
    if (this.fechado) return { ok: false, nome: 'HostError', mensagem: 'sandbox encerrado' }
    if ((!this.w || this.w.threadId < 0) && !this.inicia()) return { ok: false, nome: 'HostError', mensagem: 'o executor isolado não iniciou' }
    Atomics.store(this.flag, 0, 0)
    this.port!.postMessage({ script, ms, mem, pilha: 256 * 1024 })
    if (Atomics.wait(this.flag, 0, 0, ms + this.op.margemDuraMs) === 'timed-out') {
      this.mata() // preempção: o próximo pedido sobe um worker novo
      return 'morto'
    }
    for (let i = 0; i < 50; i++) {
      const m = receiveMessageOnPort(this.port!)
      if (m) return m.message as BrutoExecucao
      Atomics.wait(this.flag, 1, 99, 1) // dá 1 ms para a mensagem chegar na fila
    }
    this.mata()
    return { ok: false, nome: 'HostError', mensagem: 'o executor isolado não respondeu' }
  }
}

/** Sandbox de servidor: QuickJS num worker, com prazo DURO. Sobe o worker já na criação (falha cedo). */
export async function criaSandboxWorker(opcoes: OpcoesWorker = {}): Promise<Sandbox> {
  const p = new Ponte({ margemDuraMs: opcoes.margemDuraMs ?? 250, heapMb: opcoes.heapMb ?? 128 })
  p.roda('1', 1000, 4 * 1024 * 1024) // aquecimento: sobe o worker e carrega o WASM
  return {
    duro: true,
    executa: (pedido) => executaPedido(pedido, (script, ms, mem) => p.roda(script, ms, mem)),
    libera: () => { p.fechado = true; p.mata() },
  }
}
