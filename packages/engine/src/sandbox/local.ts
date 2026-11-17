import { getQuickJS, shouldInterruptAfterDeadline, type QuickJSWASMModule } from 'quickjs-emscripten'
import { PADROES_CODIGO, type PedidoCodigo, type ResultadoCodigo, type Sandbox } from '../codigo/sandbox'
import { classificaErro, interpretaSaida, montaScript } from '../codigo/script'

// QuickJS (WebAssembly) no mesmo processo. Funciona no navegador e no Node.
// Garante: realm isolado (sem process/require/fetch/DOM/relógio/aleatório reais), memória limitada, contexto NOVO a
// cada execução (nada vaza entre blocos nem entre tenants), saída limitada.
// NÃO garante: preempção. O prazo é cooperativo (o interpretador o confere entre instruções); uma chamada nativa
// longa (ex.: Array(1e5).join, quadrática) não é interrompida. No servidor use @polaris/engine/sandbox-node.

const PILHA_BYTES = 256 * 1024

export type BrutoExecucao = { ok: true; valor: string } | { ok: false; nome: string; mensagem: string }

function executaBruto(QJS: QuickJSWASMModule, script: string, ms: number, memoria: number): BrutoExecucao {
  let rt: ReturnType<QuickJSWASMModule['newRuntime']> | undefined
  let ctx: ReturnType<NonNullable<typeof rt>['newContext']> | undefined
  try {
    rt = QJS.newRuntime()
    rt.setMemoryLimit(memoria)
    rt.setMaxStackSize(PILHA_BYTES)
    rt.setInterruptHandler(shouldInterruptAfterDeadline(Date.now() + ms))
    ctx = rt.newContext()
    const r = ctx.evalCode(script)
    if (r.error) {
      const e = ctx.dump(r.error) as { name?: unknown; message?: unknown } | undefined
      r.error.dispose()
      return { ok: false, nome: String(e?.name ?? ''), mensagem: String(e?.message ?? '') }
    }
    const valor = ctx.getString(r.value)
    r.value.dispose()
    return { ok: true, valor }
  } catch (e) {
    return { ok: false, nome: 'HostError', mensagem: e instanceof Error ? e.message : String(e) }
  } finally {
    try { ctx?.dispose() } catch { /* já liberado */ }
    try { rt?.dispose() } catch { /* já liberado */ }
  }
}

/** Monta, executa e classifica. Comum a todas as implementações: a semântica é idêntica. */
export function executaPedido(pedido: PedidoCodigo, roda: (script: string, ms: number, memoria: number) => BrutoExecucao | 'morto'): ResultadoCodigo {
  const t0 = performance.now()
  const ms = pedido.ms ?? PADROES_CODIGO.ms
  const m = montaScript(pedido)
  if (!m.ok) return { ok: false, tipo: m.tipo, erro: m.erro, ms: 0 }
  const b = roda(m.script, ms, pedido.memoriaBytes ?? PADROES_CODIGO.memoriaBytes)
  const dt = Math.round(performance.now() - t0)
  if (b === 'morto') return { ok: false, tipo: 'tempo', erro: 'o código excedeu o tempo permitido (executor encerrado)', ms: dt }
  if (!b.ok) { const c = classificaErro(b.nome, b.mensagem); return { ok: false, tipo: b.nome === 'HostError' ? 'indisponivel' : c.tipo, erro: b.nome === 'HostError' ? b.mensagem.slice(0, 200) : c.erro, ms: dt } }
  if (b.valor.length > (pedido.saidaMaxBytes ?? PADROES_CODIGO.saidaMaxBytes) * 8 + 8192) return { ok: false, tipo: 'saida', erro: 'a saída do código é grande demais', ms: dt }
  return interpretaSaida(b.valor, dt)
}

/** Carrega o módulo WASM (uma vez) e devolve o sandbox. Chame antes de renderizar; depois disso `executa` é síncrono. */
export async function criaSandboxLocal(): Promise<Sandbox> {
  const QJS = await getQuickJS()
  return {
    duro: false,
    executa: (pedido) => executaPedido(pedido, (script, ms, memoria) => executaBruto(QJS, script, ms, memoria)),
    libera: () => {},
  }
}
