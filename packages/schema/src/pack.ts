import type { Erro } from './mensagens'
import type { Contexto, Registry } from './registry'
import type { No } from './index'

// Validação ESTRUTURAL de um `pack` (o que o schema JSON não alcança): sementes contra os contratos dos serviços, referências `$guarda` e ciclos de dependência.
// O que quebra aqui quebraria o CADASTRO de um tenant novo, na hora de provisionar: melhor falhar quando o pack é publicado.

type Semente = { servico: string; entidade: string; dados: Record<string, unknown>; guarda?: string }
type Spec = { depende?: string[]; inclui?: { servicos?: string[] }; sementes?: Semente[] }
const e = (caminho: string, regra: string, mensagem: string): Erro => ({ caminho, regra, mensagem })

/** a fila de packs que entram ANTES deste (dependências, em ordem), ou o ciclo encontrado */
export function fechoDeDependencias(reg: Registry, id: string, ctx: Contexto = {}): { ordem: string[] } | { ciclo: string[] } {
  const ordem: string[] = [], estado = new Map<string, 1 | 2>(), pilha: string[] = []
  let ciclo: string[] | null = null
  const visita = (p: string): void => {
    if (ciclo) return
    if (estado.get(p) === 2) return
    if (estado.get(p) === 1) { ciclo = [...pilha.slice(pilha.indexOf(p)), p]; return }
    estado.set(p, 1); pilha.push(p)
    for (const d of ((reg.resolve('pack', p, ctx)?.no.spec as Spec | undefined)?.depende ?? [])) visita(d)
    pilha.pop(); estado.set(p, 2); ordem.push(p)
  }
  visita(id)
  return ciclo ? { ciclo } : { ordem }
}

export function validaPack(reg: Registry, no: No, ctx: Contexto = {}): Erro[] {
  if (no.kind !== 'pack') return []
  const spec = no.spec as Spec, out: Erro[] = []
  const f = fechoDeDependencias(reg, no.id, ctx)
  if ('ciclo' in f) out.push(e('/spec/depende', 'ciclo', `dependência circular entre packs: ${f.ciclo.join(' → ')}`))
  const disponiveis = new Set<string>(spec.inclui?.servicos ?? [])
  if ('ordem' in f) for (const p of f.ordem) for (const s of (reg.resolve('pack', p, ctx)?.no.spec as Spec | undefined)?.inclui?.servicos ?? []) disponiveis.add(s)
  const guardas = new Set<string>()
  ;(spec.sementes ?? []).forEach((s, i) => {
    const base = `/spec/sementes/${i}`
    const sv = reg.resolve('servico', s.servico, ctx)?.no
    if (!sv) { out.push(e(`${base}/servico`, 'referencia', `o serviço '${s.servico}' não existe`)); return }
    if (!disponiveis.has(s.servico)) out.push(e(`${base}/servico`, 'servico', `o serviço '${s.servico}' não é incluído por este pack nem por suas dependências: a semente não teria onde gravar`))
    const campos = ((sv.spec as { entidades?: Record<string, { campos: Record<string, { obrigatorio?: boolean; padrao?: unknown }> }> }).entidades ?? {})[s.entidade]?.campos
    if (!campos) { out.push(e(`${base}/entidade`, 'entidade', `o serviço '${s.servico}' não tem a entidade '${s.entidade}'`)); return }
    for (const [k, v] of Object.entries(s.dados)) {
      if (!(k in campos)) out.push(e(`${base}/dados/${k}`, 'campo', `a entidade '${s.entidade}' não tem o campo '${k}'`))
      if (typeof v === 'string' && v.startsWith('$') && !guardas.has(v.slice(1))) out.push(e(`${base}/dados/${k}`, 'guarda', `'${v}' não é uma guarda definida por uma semente ANTERIOR`))
    }
    for (const [k, c] of Object.entries(campos)) if (c.obrigatorio && c.padrao === undefined && !(k in s.dados)) out.push(e(`${base}/dados`, 'obrigatorio', `falta o campo obrigatório '${k}' de '${s.entidade}'`))
    if (s.guarda) { if (guardas.has(s.guarda)) out.push(e(`${base}/guarda`, 'guarda', `a guarda '${s.guarda}' já foi usada`)); guardas.add(s.guarda) }
  })
  return out
}
