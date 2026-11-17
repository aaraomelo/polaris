import type { ResultadoAuth } from '@polaris/acesso'
import { regrasDePapeis, type Regra } from '@polaris/acesso'
import type { Registry } from '@polaris/schema'
import { ErroApi } from './erros'
import type { Contexto, RequisicaoInfo } from './tipos'

/**
 * Regras do chamador a partir dos nós `papel` do registry (herança e cascata tenant → segmento → core incluídas). Papel inexistente LANÇA (vira 500,
 * não "sem regras"): um papel digitado errado no token não pode virar um acesso silenciosamente diferente. Resultado em cache por (tenant, papéis) — limpe
 * o cache (`limpa()`) quando os papéis mudarem.
 */
export function regrasDoRegistry(reg: Registry): { regras(ctx: Contexto): Regra[]; limpa(): void } {
  const cache = new Map<string, Regra[]>()
  return {
    regras: (ctx) => {
      const papeis = [...new Set(ctx.papeis ?? [])].sort()
      const chave = `${ctx.tenantId}|${papeis.join(',')}`
      let r = cache.get(chave)
      if (!r) { r = regrasDePapeis(reg, papeis, { tenantId: ctx.tenantId }); cache.set(chave, r) }
      return r
    },
    limpa: () => cache.clear(),
  }
}

/**
 * Liga um autenticador JWT (`criaAutenticadorJwt`) ao serviço. Token PRESENTE e inválido é sempre 401 (mesmo em rota pública: nunca vira anônimo por engano).
 * Sem cabeçalho Authorization: `anonimo(req)` decide (por exemplo, resolver o tenant pelo host para rotas públicas); sem ele, não há contexto.
 */
export function contextoPorJwt(autentica: (cabecalho: string | undefined) => Promise<ResultadoAuth>, anonimo?: (req: RequisicaoInfo) => Contexto | null) {
  return async (req: RequisicaoInfo): Promise<Contexto | null> => {
    const cab = req.headers.authorization
    if (cab === undefined) return anonimo?.(req) ?? null
    const r = await autentica(Array.isArray(cab) ? cab[0] : cab)
    if (!r.ok) throw new ErroApi(401, 'credencial_invalida', 'credencial inválida')
    return { tenantId: r.contexto.tenantId, usuario: r.contexto.usuario, papeis: r.contexto.papeis }
  }
}
