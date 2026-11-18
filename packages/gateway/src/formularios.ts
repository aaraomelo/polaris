import { avaliaExpressao, textoI18n, validaValores, type FormularioSpec } from '@polaris/engine'
import type { Registry } from '@polaris/schema'
import type { FastifyInstance, FastifyRequest } from 'fastify'
import type { ChamadorCompleto } from './chamador'
import { FalhaServico } from './cliente'
import { ErroGw, traduz, type CtxGw } from './gateway'

// ---------------------------------------------------------------------------------------------------------------------------------------------
// FORMULÁRIOS: `GET /bff/formularios/:id` entrega a definição (o navegador monta e valida com o MESMO motor); `POST /bff/formularios/:id` é onde a validação VALE:
// o servidor valida de novo o que veio (nunca confia no navegador), normaliza, e só então chama a operação do serviço declarada em `envio`. Erros voltam por campo,
// com a mensagem do autor no idioma pedido; o erro de validação do serviço também é mapeado para o campo de mesmo nome. A chave de idempotência evita o envio duplo.
// ---------------------------------------------------------------------------------------------------------------------------------------------

export type DepsFormularios = {
  entra(req: FastifyRequest): Promise<CtxGw>
  limita(req: FastifyRequest, ctx: CtxGw, custo?: number): void
  chamador: ChamadorCompleto
  registroDe(ctx: CtxGw, fallback: Registry): Registry
  registro: Registry
  log: { warn(m: string, c?: Record<string, unknown>): void }
}
type NoForm = { id: string; versao: string; spec: FormularioSpec & { titulo?: unknown; descricao?: unknown; envio?: Envio; mensagens?: Record<string, unknown> } }
type Envio = { servico: string; operacao: string; args?: Record<string, string | object>; idempotencia?: boolean; sucesso?: { mensagem?: unknown; limpar?: boolean; acoes?: unknown[] }; erro?: { mensagem?: unknown; mapeiaCampos?: boolean; acoes?: unknown[] } }

const ID_FORM = /^[a-z0-9][a-z0-9._-]{0,127}$/
const CHAVE = /^[A-Za-z0-9_.:-]{8,100}$/
const IDIOMA = /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})?$/
const CORPO_MAX = 256 * 1024
type Cache = Map<string, { ate: number; p: Promise<{ corpo: unknown }> }>

export function instalaFormularios(app: FastifyInstance, d: DepsFormularios): void {
  const feitos: Cache = new Map()
  const achaForm = (ctx: CtxGw, id: string): NoForm => {
    if (!ID_FORM.test(id)) throw new ErroGw(404, 'formulario_inexistente', 'formulário inexistente')
    const r = d.registroDe(ctx, d.registro).resolve('formulario', id, { tenantId: ctx.tenantId })
    if (!r) throw new ErroGw(404, 'formulario_inexistente', 'formulário inexistente') // inexistente OU de outro tenant: indistinguível
    return r.no as unknown as NoForm
  }

  app.get<{ Params: { id: string } }>('/bff/formularios/:id', async (req) => {
    const ctx = await d.entra(req); d.limita(req, ctx)
    const f = achaForm(ctx, req.params.id)
    return { id: f.id, versao: f.versao, spec: f.spec }
  })

  app.post<{ Params: { id: string }; Body: { valores?: unknown; campos?: unknown; idioma?: unknown } }>('/bff/formularios/:id', { bodyLimit: CORPO_MAX }, async (req, reply) => {
    const ctx = await d.entra(req); d.limita(req, ctx, 3)
    const f = achaForm(ctx, req.params.id), spec = f.spec
    const b = req.body
    if (!b || typeof b !== 'object' || Array.isArray(b) || typeof b.valores !== 'object' || b.valores === null || Array.isArray(b.valores)) throw new ErroGw(400, 'requisicao_invalida', 'corpo: { valores: { … }, campos?, idioma? }')
    const idioma = typeof b.idioma === 'string' && IDIOMA.test(b.idioma) ? b.idioma : ctx.chamada.idioma && IDIOMA.test(ctx.chamada.idioma) ? ctx.chamada.idioma : undefined
    const nomes = new Set(spec.campos.map((c) => c.nome))
    // `campos`: valida só um passo do assistente (não envia)
    let passo: string[] | undefined
    if (b.campos !== undefined) { if (!Array.isArray(b.campos) || b.campos.length > 200 || b.campos.some((n) => typeof n !== 'string' || !nomes.has(n))) throw new ErroGw(400, 'requisicao_invalida', 'campos: nomes de campos do formulário'); passo = b.campos as string[] }
    const hoje = new Date().toISOString().slice(0, 10)
    const r = validaValores(spec, b.valores as Record<string, unknown>, { ...(idioma ? { idioma } : {}), hoje, ...(passo ? { campos: passo } : {}) })
    if (!r.ok) return reply.status(422).send({ erro: { codigo: 'formulario_invalido', mensagem: textoI18n(spec.mensagens?.formulario as never, idioma ?? 'pt-BR') ?? (idioma?.startsWith('en') ? 'Fix the highlighted fields.' : 'Corrija os campos destacados.') }, erros: r.erros })
    if (passo) return { ok: true, passo: true, valores: r.valores }
    const envio = spec.envio
    if (!envio) return { ok: true, valores: r.valores } // formulário sem envio: o navegador usa o resultado validado

    // chave de idempotência: o mesmo envio (duplo clique, retentativa) devolve o MESMO resultado, sem chamar o serviço de novo
    const chaveCab = req.headers['idempotency-key']
    const chave = typeof chaveCab === 'string' && envio.idempotencia !== false ? chaveCab : undefined
    if (chaveCab !== undefined && !(typeof chaveCab === 'string' && CHAVE.test(chaveCab))) throw new ErroGw(400, 'requisicao_invalida', 'Idempotency-Key: de 8 a 100 caracteres [A-Za-z0-9_.:-]')
    const id = chave ? `${ctx.tenantId}|${ctx.usuario ?? 'anonimo'}|${f.id}|${chave}` : undefined
    const agora = Date.now(); for (const [k, v] of feitos) if (v.ate < agora) feitos.delete(k); while (feitos.size > 2000) feitos.delete(feitos.keys().next().value as string)
    const existente = id ? feitos.get(id) : undefined
    if (existente) { reply.header('idempotent-replay', 'true'); return (await existente.p).corpo }

    const args = montaArgs(envio, r.valores)
    const exec = (async () => {
      const resp = await d.chamador(envio.servico, envio.operacao, args, ctx.chamada)
      const suc = envio.sucesso ?? {}
      return { corpo: { ok: true, resultado: resp.corpo, sucesso: { mensagem: textoI18n((suc.mensagem ?? spec.mensagens?.sucesso) as never, idioma ?? 'pt-BR'), limpar: suc.limpar === true, acoes: suc.acoes ?? [] } } }
    })()
    if (id) feitos.set(id, { ate: agora + 10 * 60_000, p: exec })
    try { return (await exec).corpo } catch (e) {
      if (id) feitos.delete(id) // falha não fica em cache: dá para tentar de novo com a mesma chave
      if (e instanceof FalhaServico && e.status !== undefined && e.status >= 400 && e.status < 500) {
        const mapeia = envio.erro?.mapeiaCampos !== false, campos = mapeia ? camposDoServico(e.detalhes, nomes) : []
        const msg = textoI18n((envio.erro?.mensagem ?? spec.mensagens?.envio) as never, idioma ?? 'pt-BR') ?? e.mensagemServico ?? 'requisição recusada'
        return reply.status(e.status === 400 ? 422 : e.status).send({ erro: { codigo: campos.length ? 'formulario_invalido' : (e.codigo ?? 'recusado'), mensagem: campos.length ? (e.mensagemServico ?? msg) : msg }, ...(campos.length ? { erros: campos } : {}), ...(envio.erro?.acoes ? { acoes: envio.erro.acoes } : {}) })
      }
      d.log.warn('envio de formulário falhou', { formulario: f.id })
      const t = traduz(e); throw new ErroGw(t.status, t.codigo, textoI18n((envio.erro?.mensagem ?? spec.mensagens?.envio) as never, idioma ?? 'pt-BR') ?? t.message)
    }
  })
}

/** argumentos da operação: `envio.args` (expressões sobre `valores`) ou, sem ele, cada campo com o próprio nome; `undefined` e nulos saem */
function montaArgs(envio: Envio, valores: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  if (envio.args) for (const [k, expr] of Object.entries(envio.args)) { const v = avaliaExpressao(expr as never, { valores }); if (v !== undefined && v !== null) out[k] = v }
  else for (const [k, v] of Object.entries(valores)) if (v !== undefined && v !== null) out[k] = v
  return out
}
/** o 400 do serviço traz `detalhes: [{ caminho: '/nome', mensagem }]`: o que casa com um campo do formulário vira erro desse campo */
function camposDoServico(detalhes: unknown, nomes: Set<string>): Array<{ campo: string; regra: string; mensagem: string }> {
  if (!Array.isArray(detalhes)) return []
  const out: Array<{ campo: string; regra: string; mensagem: string }> = []
  for (const x of detalhes.slice(0, 50)) {
    const c = (x as { caminho?: unknown })?.caminho, m = (x as { mensagem?: unknown })?.mensagem
    if (typeof c !== 'string' || typeof m !== 'string') continue
    const campo = c.replace(/^\//, '').split('/')[0]!
    if (nomes.has(campo)) out.push({ campo, regra: 'servico', mensagem: m.slice(0, 300) })
  }
  return out
}
