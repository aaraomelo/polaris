import type { Registry } from '@polaris/schema'
import type { Landing, Plano, Semente } from './onboarding'

// Cadastro self-service, parte com I/O: executa o PLANO por etapas, cada uma registrada no diretório da plataforma. É RETOMÁVEL: se cair no meio (convite, semente 3),
// repetir a MESMA chamada (mesma `chave`) continua de onde parou, sem duplicar. O tenant só fica `ativo` quando tudo terminou: antes disso o login/gateway o recusam.

export type Status = 'provisionando' | 'ativo' | 'falhou'
export type Diretorio = {
  /** reserva o alias para esta `chave`. `existente` = a mesma chave de antes (retomada); `ocupado` = de outra pessoa */
  cria(t: { tenantId: string; alias: string; nome: string; segmento: string; packs: string[]; donoEmail: string; chave: string }): Promise<{ resultado: 'criado' | 'existente'; tenantId: string; status: Status } | { resultado: 'ocupado' }>
  existeAlias(alias: string): Promise<boolean>
  etapas(tenantId: string): Promise<Map<string, string | null>>
  conclui(tenantId: string, etapa: string, valor?: string | null): Promise<void>
  marca(tenantId: string, status: Status, motivo?: string | null): Promise<void>
  habilita(tenantId: string, servicos: string[]): Promise<void>
}
export type Portas = {
  diretorio: Diretorio
  identidade: { /** convida o dono no provedor de identidade (a plataforma NUNCA guarda senha); idempotente por tenant+e-mail */ convida(c: { tenantId: string; email: string; nome: string; papeis: string[] }): Promise<void> }
  /** cria a semente no tenant, com as permissões do DONO; devolve o id. Se já existe, devolve o id existente (idempotente) */
  semeia(c: { tenantId: string; servico: string; entidade: string; dados: Record<string, unknown>; papeis: string[] }): Promise<{ id: string | null }>
  landing: { publica(tenantId: string, landing: Landing): Promise<void> }
  novoId(): string
}
export type Resultado = { ok: true; tenantId: string; alias: string; retomado: boolean } | { ok: false; motivo: 'alias_ocupado' } | { ok: false; motivo: 'falhou'; etapa: string; tenantId: string; retomavel: true }

const msg = (e: unknown) => (e instanceof Error ? e.message : String(e)).replace(/\s+/g, ' ').slice(0, 300)

export async function provisiona(plano: Plano, chave: string, p: Portas): Promise<Resultado> {
  const c = await p.diretorio.cria({ tenantId: p.novoId(), alias: plano.alias, nome: plano.nome, segmento: plano.segmento, packs: plano.packs, donoEmail: plano.dono.email, chave })
  if (c.resultado === 'ocupado') return { ok: false, motivo: 'alias_ocupado' }
  const { tenantId } = c
  if (c.status === 'ativo') return { ok: true, tenantId, alias: plano.alias, retomado: true } // repetir um cadastro concluído devolve o mesmo tenant
  const feitas = await p.diretorio.etapas(tenantId)
  const guardas = new Map<string, string>()
  for (const [k, v] of feitas) if (k.startsWith('guarda:') && v) guardas.set(k.slice(7), v)
  let etapa = 'inicio'
  const roda = async (nome: string, f: () => Promise<string | null | void>) => { if (feitas.has(nome)) return; etapa = nome; const v = await f(); await p.diretorio.conclui(tenantId, nome, v ?? null) }
  try {
    await p.diretorio.marca(tenantId, 'provisionando')
    await roda('modulos', () => p.diretorio.habilita(tenantId, plano.servicos))
    await roda('dono', () => p.identidade.convida({ tenantId, email: plano.dono.email, nome: plano.dono.nome, papeis: plano.papeisDono }))
    for (const [i, s] of plano.sementes.entries()) {
      await roda(`semente:${i}`, async () => {
        const dados = resolveGuardas(s, guardas)
        const r = await p.semeia({ tenantId, servico: s.servico, entidade: s.entidade, dados, papeis: plano.papeisDono })
        if (s.guarda) { if (!r.id) throw new Error(`a semente ${i} (${s.servico}.${s.entidade}) já existia e não devolveu o id que '${s.guarda}' precisa`); guardas.set(s.guarda, r.id); await p.diretorio.conclui(tenantId, `guarda:${s.guarda}`, r.id) }
        return r.id
      })
    }
    if (plano.landing) await roda('landing', () => p.landing.publica(tenantId, plano.landing!))
    await p.diretorio.marca(tenantId, 'ativo')
    return { ok: true, tenantId, alias: plano.alias, retomado: c.resultado === 'existente' }
  } catch (e) {
    await p.diretorio.marca(tenantId, 'falhou', `${etapa}: ${msg(e)}`).catch(() => {})
    return { ok: false, motivo: 'falhou', etapa, tenantId, retomavel: true }
  }
}

/** `"$guarda"` (valor inteiro) vira o id guardado por uma semente anterior */
function resolveGuardas(s: Semente, guardas: Map<string, string>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(s.dados).map(([k, v]) => { if (typeof v === 'string' && v.startsWith('$')) { const g = guardas.get(v.slice(1)); if (!g) throw new Error(`guarda '${v}' sem valor`); return [k, g] } return [k, v] }))
}

/** O semeador padrão: cria a semente pelo CRUD do próprio serviço (então passa por validação, RLS e papéis, como qualquer cliente). `chama` é HTTP em produção. */
export function criaSemeador(reg: Registry, chama: (c: { servico: string; tenantId: string; papeis: string[]; caminho: string; corpo: unknown }) => Promise<{ status: number; corpo: any }>): Portas['semeia'] {
  return async ({ tenantId, servico, entidade, dados, papeis }) => {
    const no = reg.resolve('servico', servico)?.no; const caminho = (no?.spec as { entidades?: Record<string, { crud?: { caminho: string } }> } | undefined)?.entidades?.[entidade]?.crud?.caminho
    if (!caminho) throw new Error(`o serviço '${servico}' não expõe CRUD para '${entidade}'`)
    const r = await chama({ servico, tenantId, papeis, caminho, corpo: dados })
    if (r.status === 201) return { id: String(r.corpo.id) }
    if (r.status === 409) return { id: null } // já existia (único): a semente é idempotente
    throw new Error(`semente ${servico}.${entidade}: HTTP ${r.status} ${String(r.corpo?.erro?.mensagem ?? '').slice(0, 120)}`)
  }
}
