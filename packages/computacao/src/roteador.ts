import type { Kernel } from './ir'

// Roteador de alvo: DETERMINÍSTICO e EXPLICÁVEL. Primeiro elimina o que não pode (capacidade, limites, exatidão), depois escolhe o de menor custo estimado.
// Regra de exatidão: um kernel que NÃO declara `tolerancia` exige resultado bit a bit igual ao da referência; só js, wasm e ptx dão isso. O WebGL só entra com tolerância declarada.
export type Alvo = 'js' | 'wasm' | 'webgl' | 'ptx'
export type Capacidades = {
  js?: boolean; wasm?: boolean
  /** maior lado de textura (MAX_TEXTURE_SIZE) e se há render em float; ausente = sem WebGL2 */
  webgl?: { maxTextura: number }
  /** há driver de GPU com fila disponível */
  ptx?: boolean
}
/** custo em milissegundos: fixo (compilar/transferir/lançar) + por elemento × peso do kernel; calibrável (docs/computacao.md) */
export type Custos = Record<Alvo, { fixo: number; porElemento: number; porNo: number }>
export const CUSTOS_PADRAO: Custos = {
  js: { fixo: 0.01, porElemento: 0.00015, porNo: 0.00040 },
  wasm: { fixo: 0.6, porElemento: 0.00004, porNo: 0.00006 },
  webgl: { fixo: 6, porElemento: 0.00020, porNo: 0.000004 },
  ptx: { fixo: 25, porElemento: 0.00030, porNo: 0.000002 },
}
const DESEMPATE: Alvo[] = ['wasm', 'js', 'ptx', 'webgl']

export type Decisao = { alvo: Alvo; custo: number; candidatos: Array<{ alvo: Alvo; custo?: number; motivo?: string }> }
export class SemAlvoErro extends Error { constructor(readonly motivos: Record<string, string>) { super(`nenhum alvo pode executar o kernel: ${Object.entries(motivos).map(([a, m]) => `${a}: ${m}`).join('; ')}`); this.name = 'SemAlvoErro' } }

export function escolheAlvo(k: Kernel, n: number, cap: Capacidades, custos: Custos = CUSTOS_PADRAO): Decisao {
  const exato = k.tolerancia.relativa === 0 && k.tolerancia.absoluta === 0
  const proibido: Partial<Record<Alvo, string>> = {}
  if (!cap.js) proibido.js = 'indisponível neste ambiente'
  if (!cap.wasm) proibido.wasm = 'WebAssembly indisponível (ou bloqueado pela CSP)'
  if (!cap.webgl) proibido.webgl = 'sem WebGL2 com render em float'
  else if (exato) proibido.webgl = 'o kernel não declara tolerância e a GPU não garante bit a bit'
  else if (k.saidas.length > 4) proibido.webgl = 'mais de 4 saídas'
  else if (k.entradas.some((p) => p.vetor && p.tipo === 'i32') || k.saidas.some((s) => s.tipo === 'i32')) proibido.webgl = 'inteiros em lista viajam como float (exatos só até 2^24)'
  else { const w = Math.ceil(Math.sqrt(n)); if (w > cap.webgl.maxTextura) proibido.webgl = `n=${n} não cabe numa textura ${cap.webgl.maxTextura}²` }
  if (!cap.ptx) proibido.ptx = 'sem driver de GPU'
  if (n > k.maxElementos) throw new SemAlvoErro({ todos: `n=${n} acima do limite do kernel (${k.maxElementos})` })
  const cands = (Object.keys(custos) as Alvo[]).map((alvo) => {
    if (proibido[alvo]) return { alvo, motivo: proibido[alvo]! }
    const c = custos[alvo]; return { alvo, custo: c.fixo + n * (c.porElemento + k.nos * c.porNo) }
  })
  const ok = cands.filter((c) => c.custo !== undefined).sort((a, b) => a.custo! - b.custo! || DESEMPATE.indexOf(a.alvo) - DESEMPATE.indexOf(b.alvo))
  if (!ok.length) throw new SemAlvoErro(Object.fromEntries(cands.map((c) => [c.alvo, c.motivo!])))
  return { alvo: ok[0]!.alvo, custo: ok[0]!.custo!, candidatos: cands }
}
