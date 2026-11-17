import { rotasDe } from './servico-api'
import { sugere } from './sugere'
import type { Erro } from './mensagens'
import type { Contexto, Registry } from './registry'
import type { No } from './index'

// Um `dados` com fonte de serviço é um CONTRATO com o serviço: a operação precisa existir (como rota gerada ou declarada) e os `parametros` precisam ser os
// que ela aceita, com o mesmo tipo. Erro de digitação aqui seria uma página que só quebra em produção.

export function validaDados(reg: Registry, no: No, ctx: Contexto = {}): Erro[] {
  if (no.kind !== 'dados') return []
  const spec = no.spec as { fonte: { tipo: string; servico?: string; operacao?: string }; parametros?: Record<string, { tipo: string; lista?: boolean }> }
  if (spec.fonte.tipo !== 'servico' || !spec.fonte.servico || !spec.fonte.operacao) return []
  const sv = reg.resolve('servico', spec.fonte.servico, ctx)
  if (!sv) return [] // a referência quebrada já é reportada por `verifica`
  const rotas = rotasDe(sv.no)
  const ids = rotas.map((r) => r.id)
  const rota = rotas.find((r) => r.id === spec.fonte.operacao)
  if (!rota) { const d = sugere(spec.fonte.operacao, ids); return [{ caminho: '/spec/fonte/operacao', regra: 'operacao', mensagem: `o serviço '${spec.fonte.servico}' não tem a operação '${spec.fonte.operacao}'`, ...(d ? { dica: `quis dizer '${d}'?` } : { dica: `operações: ${ids.join(', ')}` }) }] }
  const aceitos: Record<string, { tipo: string; lista?: boolean }> = { ...Object.fromEntries(rota.params.map((p) => [p, { tipo: 'uuid' }])), ...rota.entrada as Record<string, { tipo: string; lista?: boolean }>, ...(rota.lista ? { pagina: { tipo: 'inteiro' }, limite: { tipo: 'inteiro' } } : {}) }
  const out: Erro[] = []
  for (const [nome, p] of Object.entries(spec.parametros ?? {})) {
    const c = aceitos[nome]
    if (!c) { const d = sugere(nome, Object.keys(aceitos)); out.push({ caminho: `/spec/parametros/${nome}`, regra: 'parametro', mensagem: `a operação '${rota.id}' não aceita o parâmetro '${nome}'`, ...(d ? { dica: `quis dizer '${d}'?` } : { dica: `aceitos: ${Object.keys(aceitos).join(', ') || 'nenhum'}` }) }); continue }
    if (c.tipo !== p.tipo || !!c.lista !== !!p.lista) out.push({ caminho: `/spec/parametros/${nome}/tipo`, regra: 'tipo', mensagem: `o parâmetro '${nome}' é ${p.tipo}${p.lista ? '[]' : ''} aqui, mas a operação '${rota.id}' espera ${c.tipo}${c.lista ? '[]' : ''}` })
  }
  return out
}
