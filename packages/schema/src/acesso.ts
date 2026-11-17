import { rotasDe, type CrudOp } from './servico-api'
import { sugere } from './sugere'
import type { Erro } from './mensagens'
import type { Contexto, Registry } from './registry'
import type { No } from './index'

// Um papel referencia sujeitos (`servico.entidade`), ações e campos DOS SERVIÇOS registrados. Erro de digitação aqui seria uma regra que nunca casa
// (ou, pior, uma negação que não nega): por isso é conferido contra o catálogo de acesso de cada serviço.

const CRUD: CrudOp[] = ['listar', 'obter', 'criar', 'atualizar', 'remover']
const AUDITORIA = ['id', 'criadoEm', 'atualizadoEm']
type Entrada = { acoes: Set<string>; campos: Set<string> }

/** O que se pode referenciar numa regra: sujeito → ações válidas e campos. */
export function catalogoDeAcesso(reg: Registry, ctx: Contexto = {}): Map<string, Entrada> {
  const cat = new Map<string, Entrada>()
  for (const id of reg.ids('servico')) {
    const r = reg.resolve('servico', id, ctx); if (!r) continue
    const spec = r.no.spec as { entidades: Record<string, { campos: Record<string, unknown> }> }
    for (const rota of rotasDe(r.no)) {
      const e = cat.get(rota.sujeito) ?? { acoes: new Set<string>(), campos: new Set<string>() }
      e.acoes.add(rota.acao); cat.set(rota.sujeito, e)
    }
    for (const [nome, ent] of Object.entries(spec.entidades)) {
      const e = cat.get(`${id}.${nome}`); if (e) for (const c of [...Object.keys(ent.campos), ...AUDITORIA]) e.campos.add(c)
    }
  }
  return cat
}

/** campos citados numa condição `onde` (recursivo em $and/$or/$nor; ignora operadores) */
export function camposDaCondicao(c: unknown, out = new Set<string>()): Set<string> {
  if (Array.isArray(c)) { for (const x of c) camposDaCondicao(x, out); return out }
  if (c && typeof c === 'object') for (const [k, v] of Object.entries(c)) { if (k === '$and' || k === '$or' || k === '$nor') camposDaCondicao(v, out); else if (!k.startsWith('$')) out.add(k) }
  return out
}

export function validaPapel(reg: Registry, no: No, ctx: Contexto = {}): Erro[] {
  if (no.kind !== 'papel') return []
  const cat = catalogoDeAcesso(reg, ctx)
  const out: Erro[] = []
  const regras = ((no.spec as { regras?: Array<{ acoes: string[]; sujeitos: string[]; onde?: unknown; campos?: string[] }> }).regras) ?? []
  regras.forEach((r, i) => {
    const base = `/spec/regras/${i}`
    const concretos = r.sujeitos.filter((s) => s !== 'all')
    r.sujeitos.forEach((s, j) => {
      if (s !== 'all' && !cat.has(s)) { const d = sugere(s, [...cat.keys()]); out.push({ caminho: `${base}/sujeitos/${j}`, regra: 'sujeito', mensagem: `o sujeito '${s}' não existe em nenhum serviço registrado`, ...(d ? { dica: `quis dizer '${d}'?` } : {}) }) }
    })
    const validos = concretos.filter((s) => cat.has(s))
    if (validos.length) {
      r.acoes.forEach((a, j) => {
        if (a === 'manage') return
        // a ação precisa existir em ao menos um dos sujeitos da regra (uma regra pode agrupar sujeitos com ações diferentes)
        if (!validos.some((s) => cat.get(s)!.acoes.has(a))) { const todas = [...new Set(validos.flatMap((s) => [...cat.get(s)!.acoes]))].sort(); const d = sugere(a, todas); out.push({ caminho: `${base}/acoes/${j}`, regra: 'acao', mensagem: `a ação '${a}' não existe em ${validos.join(', ')} (ações: ${todas.join(', ')})`, ...(d ? { dica: `quis dizer '${d}'?` } : {}) }) }
      })
      ;(r.campos ?? []).forEach((c, j) => { if (!validos.some((s) => cat.get(s)!.campos.has(c))) out.push({ caminho: `${base}/campos/${j}`, regra: 'campo', mensagem: `o campo '${c}' não existe em ${validos.join(', ')}` }) })
      for (const c of camposDaCondicao(r.onde)) if (!validos.some((s) => cat.get(s)!.campos.has(c))) out.push({ caminho: `${base}/onde`, regra: 'campo', mensagem: `a condição usa o campo '${c}', que não existe em ${validos.join(', ')}` })
    }
  })
  return out
}
