import type { Chegada, OpcoesVivo, Vivo } from './monta'

// ---------------------------------------------------------------------------
// FILA DE CHEGADAS (lado do navegador). O servidor transmite os dados em streaming como pedaços JSON; um script mínimo (stream.ts, BOOT) os
// guarda em `window.__PL.fila` ENQUANTO o runtime ainda não carregou, e os entrega ao runtime depois. Assim a ordem não importa: o dado
// pode chegar antes, durante ou depois do download do cliente e da hidratação.
// ---------------------------------------------------------------------------

/** Um pedaço do servidor: `d` = dados [nome, ok, valor|erro, tarde?]; `s` = trocas de HTML [chave, html] já aplicadas pelo script de boot. */
export type Pedaco = { d?: Array<readonly [string, boolean, unknown, boolean?]>; s?: Array<readonly [string, string]> }
export type Fila = { fila: Pedaco[]; montado: { chega(d: ReadonlyArray<Chegada>): void } | null; auto?: boolean }

/**
 * Estado que o DOM já mostra: dados que chegaram e cujo HTML o servidor trocou. Os marcados `tarde` (usados por fronteiras que o servidor não
 * consegue renderizar sozinhas) NÃO entram: o DOM ainda mostra o esqueleto delas, então chegam ao runtime só depois da hidratação.
 */
export function semeiaDaFila(fila: readonly Pedaco[]): { dados: Record<string, unknown>; status: Record<string, 'ok' | 'erro'>; erros: Record<string, string>; tardias: Chegada[] } {
  const dados: Record<string, unknown> = {}, status: Record<string, 'ok' | 'erro'> = {}, erros: Record<string, string> = {}
  const tardias: Chegada[] = []
  for (const p of fila) for (const [nome, ok, valor, tarde] of p.d ?? []) {
    if (tarde) { tardias.push([nome, ok, valor]); continue }
    if (ok) { dados[nome] = valor; status[nome] = 'ok'; delete erros[nome] } else { delete dados[nome]; status[nome] = 'erro'; erros[nome] = String(valor) }
  }
  return { dados, status, erros, tardias }
}

/** Monta a página a partir do documento: programa e estado inicial embutidos pelo servidor + a fila de chegadas. Hidrata o HTML existente. */
export function iniciaDoDocumento(monta: (o: OpcoesVivo) => Vivo, extra: Partial<OpcoesVivo> = {}): Vivo {
  const le = (id: string): any => { const e = document.getElementById(id); return e ? JSON.parse(e.textContent ?? 'null') : undefined }
  const programa = le('pl-programa')
  const seed = le('pl-estado') ?? {}
  const w = window as unknown as { __PL?: Fila }
  const q = (w.__PL ??= { fila: [], montado: null })
  const s = semeiaDaFila(q.fila)
  const v = monta({
    programa, container: document.getElementById('polaris')!, hidrata: true, fechado: true, ...seed,
    dados: { ...seed.dados, ...s.dados }, status: { ...seed.status, ...s.status }, erros: { ...seed.erros, ...s.erros }, ...extra,
  } as OpcoesVivo)
  q.fila.length = 0
  q.montado = v
  if (s.tardias.length) v.chega(s.tardias)
  return v
}

/** Espera o servidor terminar de mandar o programa e o estado (streaming) e então inicia. Idempotente. */
export function iniciaQuando(inicia: () => Vivo): void {
  const pronto = () => !!document.getElementById('pl-estado') || !!document.getElementById('pl-programa')
  const go = () => { if (!pronto()) return false; inicia(); return true }
  if (go()) return
  const o = new MutationObserver(() => { if (go()) o.disconnect() })
  o.observe(document, { childList: true, subtree: true })
}
