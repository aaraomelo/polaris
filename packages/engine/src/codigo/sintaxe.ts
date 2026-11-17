import type { Sandbox } from './sandbox'

/** Confere só a SINTAXE do código (sem executá-lo): para ferramentas (Studio, CI). Devolve a mensagem de erro ou null. */
export function verificaSintaxe(sandbox: Sandbox, fonte: string): string | null {
  const r = sandbox.executa({
    fonte: `function render(){ try { new Function(${JSON.stringify(fonte)}); return { ok: true } } catch (e) { return { erro: String(e && e.message) } } }`,
    props: null, contexto: { agora: '1970-01-01T00:00:00.000Z' }, ms: 100,
  })
  if (!r.ok) return r.erro
  try { const o = JSON.parse(r.saida) as { erro?: string }; return typeof o.erro === 'string' ? o.erro : null } catch { return 'resposta inesperada' }
}
