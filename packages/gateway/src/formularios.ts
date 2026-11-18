import { avaliaExpressao, textoI18n, validaValores, voltaSegura, type FormularioSpec } from '@polaris/engine'
import type { Registry } from '@polaris/schema'
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import type { ChamadorCompleto } from './chamador'
import { FalhaServico } from './cliente'
import { ErroGw, traduz, type CtxGw } from './gateway'
import type { PortaIdentidade } from './identidade'
import { cookieDeSessao, lerCookie } from './paginas'

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
  /** login e senha (`envio.sistema`); sem isto, essas ações respondem 501 */
  identidade?: PortaIdentidade
  /** o cookie de sessão leva `Secure` (padrão sim) e o link do e-mail usa https */
  cookieSeguro?: boolean
  log: { warn(m: string, c?: Record<string, unknown>): void }
}
type NoForm = { id: string; versao: string; spec: FormularioSpec & { titulo?: unknown; descricao?: unknown; envio?: Envio; mensagens?: Record<string, unknown> } }
type Envio = { sistema?: 'entrar' | 'esqueci' | 'redefinir'; servico: string; operacao: string; args?: Record<string, string | object>; idempotencia?: boolean; sucesso?: { mensagem?: unknown; limpar?: boolean; acoes?: unknown[] }; erro?: { mensagem?: unknown; mapeiaCampos?: boolean; acoes?: unknown[] } }

const ID_FORM = /^[a-z0-9][a-z0-9._-]{0,127}$/
const CHAVE = /^[A-Za-z0-9_.:-]{8,100}$/
const IDIOMA = /^[a-z]{2,3}(-[A-Za-z0-9]{2,8})?$/
const CORPO_MAX = 256 * 1024
type Cache = Map<string, { ate: number; p: Promise<{ corpo: unknown }> }>

export function instalaFormularios(app: FastifyInstance, d: DepsFormularios): void {
  const sistema = sistemaDeps(d)
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
    // sessão do site (cookie) só vale aqui com o cabeçalho `x-polaris-form` (um site de outra origem não consegue mandá-lo sem preflight, e o cookie é SameSite=Lax): o navegador envia do próprio site, logado
    let doCookie = false
    if (req.headers.authorization === undefined && req.headers['x-polaris-form'] === '1') { const tk = lerCookie(req.headers.cookie); if (tk) { req.headers.authorization = `Bearer ${tk}`; doCookie = true } }
    let ctx: CtxGw
    try { ctx = await d.entra(req) } catch (err) {
      if (!doCookie || !(err instanceof ErroGw) || err.status !== 401) throw err
      delete req.headers.authorization; ctx = await d.entra(req) // sessão expirada: segue como visitante (o serviço decide se aquela operação aceita)
    }; d.limita(req, ctx, 3)
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
    if (envio.sistema) return sistema(envio.sistema, r.valores, ctx, req, reply, idioma ?? 'pt-BR', spec)

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

/** AÇÕES DA PLATAFORMA (`envio.sistema`): login, "esqueci a senha" e nova senha. Valem as regras de segurança do login: só com o cabeçalho `x-polaris-form` (nada de CSRF), taxa bem mais apertada que a de um formulário comum,
 * falha de credencial sempre igual (a identidade já garante), "esqueci" responde SEMPRE o mesmo e trabalha em segundo plano (o tempo não diz se a conta existe), nada de senha nem token em log. */
function sistemaDeps(d: DepsFormularios) {
  const en = (idioma: string) => idioma.startsWith('en')
  return async function sistema(nome: 'entrar' | 'esqueci' | 'redefinir', valores: Record<string, unknown>, ctx: CtxGw, req: FastifyRequest, reply: FastifyReply, idioma: string, spec: NoForm['spec']): Promise<unknown> {
    const id = d.identidade; if (!id) throw new ErroGw(501, 'identidade_indisponivel', 'o login não está habilitado neste ambiente')
    if (req.headers['x-polaris-form'] !== '1') throw new ErroGw(400, 'cabecalho_ausente', 'requisição inválida')
    d.limita(req, ctx, 10)
    const seguro = d.cookieSeguro !== false, txt = (t: unknown, pt: string, e: string) => textoI18n(t as never, idioma) ?? (en(idioma) ? e : pt)
    const email = String(valores.email ?? ''), senha = String(valores.senha ?? '')
    reply.header('cache-control', 'no-store')
    if (nome === 'entrar') {
      const r = await id.entra({ tenantId: ctx.tenantId, email, senha })
      if (!r.ok && r.motivo === 'bloqueado') { const min = Math.max(1, Math.ceil((r.ate.getTime() - Date.now()) / 60_000)); reply.header('retry-after', String(min * 60)); return reply.status(429).send({ erro: { codigo: 'muitas_tentativas', mensagem: en(idioma) ? `Too many attempts. Try again in ${min} minute(s).` : `Muitas tentativas. Tente de novo em ${min} minuto(s).` } }) }
      if (!r.ok) return reply.status(401).send({ erro: { codigo: 'credenciais_invalidas', mensagem: txt(spec.envio?.erro?.mensagem, 'E-mail ou senha incorretos.', 'Wrong e-mail or password.') } })
      const token = await id.emite(r.usuario)
      reply.header('set-cookie', cookieDeSessao(token, seguro))
      return { ok: true, resultado: { nome: r.usuario.nome }, sucesso: { mensagem: txt(spec.envio?.sucesso?.mensagem, 'Bem-vindo!', 'Welcome!'), limpar: true, acoes: [{ acao: 'navegar', para: voltaSegura(typeof valores.volta === 'string' ? valores.volta : null) }] } }
    }
    if (nome === 'esqueci') {
      const base = `${seguro ? 'https' : 'http'}://${String(req.headers.host ?? '')}`
      void (async () => { // em segundo plano: a resposta sai igual e na mesma hora, exista a conta ou não
        try {
          const p = await id.pedeRedefinicao({ tenantId: ctx.tenantId, email }); if (!p) return
          const link = `${base}/senha/redefinir?token=${p.token}`
          await id.enviaEmail({ tenantId: ctx.tenantId, para: p.usuario.email, assunto: en(idioma) ? 'Reset your password' : 'Redefinir a sua senha', corpo: en(idioma) ? `Hello, ${p.usuario.nome}.\n\nTo choose a new password, open this link (valid for 1 hour):\n${link}\n\nIf you did not ask for this, ignore this e-mail.` : `Olá, ${p.usuario.nome}.\n\nPara criar uma nova senha, abra este link (vale por 1 hora):\n${link}\n\nSe você não pediu, ignore este e-mail.` })
        } catch { d.log.warn('falha no "esqueci a senha"', { tenant: ctx.tenantId }) }
      })()
      return { ok: true, sucesso: { mensagem: txt(spec.envio?.sucesso?.mensagem, 'Se o e-mail estiver cadastrado, enviamos um link para criar uma nova senha.', 'If the e-mail is registered, we sent a link to choose a new password.'), limpar: true, acoes: [] } }
    }
    const r = await id.redefine({ tenantId: ctx.tenantId, token: String(valores.token ?? ''), senha })
    if (!r.ok && r.motivo === 'token_invalido') { const m = en(idioma) ? 'This link is no longer valid. Ask for a new one under "Forgot my password".' : 'Este link não vale mais. Peça um novo em "Esqueci minha senha".'; return reply.status(422).send({ erro: { codigo: 'token_invalido', mensagem: m }, erros: [{ campo: '_formulario', regra: 'token', mensagem: m }] }) }
    if (!r.ok) { const m = r.erros?.[0] ?? (en(idioma) ? 'Choose a stronger password.' : 'Escolha uma senha mais forte.'); return reply.status(422).send({ erro: { codigo: 'senha_fraca', mensagem: m }, erros: [{ campo: 'senha', regra: 'politica', mensagem: m }] }) }
    return { ok: true, sucesso: { mensagem: txt(spec.envio?.sucesso?.mensagem, 'Senha alterada! Entre com a nova senha.', 'Password changed! Sign in with the new password.'), limpar: true, acoes: [{ acao: 'navegar', para: '/entrar' }] } }
  }
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
