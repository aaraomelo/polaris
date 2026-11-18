import type { FastifyInstance, FastifyReply } from 'fastify'
import type { Registry } from '@polaris/schema'
import { planoDeCadastro, segmentosDisponiveis, validaAlias } from './onboarding'
import { provisiona, type Portas } from './provisiona'

// Rotas PÚBLICAS do cadastro self-service. Sem autenticação por definição, então o cuidado é todo com abuso: limite de taxa por IP (consulta de alias também: evita
// enumeração), corpo estrito (campo desconhecido é 400), verificação humana opcional (captcha), nenhuma senha (o dono entra pelo provedor de identidade) e nenhum dado
// interno na resposta (nem o id do tenant).

export type Limite = { tenta(chave: string, custo?: number): { ok: true } | { ok: false; esperaSeg: number } }
export type OpcoesCadastro = {
  reg: Registry
  portas: Portas
  limite: Limite
  /** verifica o desafio anti-robô (Turnstile/hCaptcha…). Se informado, o cadastro EXIGE `captcha` válido */
  verificaHumano?: (token: string, ip: string) => Promise<boolean>
}

const CHAVE = /^[A-Za-z0-9_-]{16,100}$/
const erro = (r: FastifyReply, status: number, codigo: string, mensagem: string, extra: object = {}) => r.status(status).send({ erro: { codigo, mensagem, ...extra } })
const so = (o: unknown, chaves: string[]) => !!o && typeof o === 'object' && !Array.isArray(o) && Object.keys(o).every((k) => chaves.includes(k))

export function rotasCadastro(app: FastifyInstance, o: OpcoesCadastro): void {
  app.addHook('onSend', async (_req, reply) => { reply.header('cache-control', 'no-store'); reply.header('x-content-type-options', 'nosniff') })
  const passa = (ip: string, custo: number, r: FastifyReply): boolean => { const t = o.limite.tenta(`cadastro:${ip}`, custo); if (t.ok) return true; r.header('retry-after', String(t.esperaSeg)); erro(r, 429, 'muitas_requisicoes', `muitas tentativas: tente de novo em ${t.esperaSeg}s`); return false }

  app.get('/publico/segmentos', async (req, reply) => { if (!passa(req.ip, 1, reply)) return reply; return { segmentos: segmentosDisponiveis(o.reg) } })

  app.get<{ Params: { alias: string } }>('/publico/alias/:alias', async (req, reply) => {
    if (!passa(req.ip, 2, reply)) return reply // custo maior: consultar alias é o que se usa para enumerar clientes
    const v = validaAlias(req.params.alias); if (!v.ok) return { disponivel: false, motivo: v.motivo }
    return (await o.portas.diretorio.existeAlias(v.alias)) ? { disponivel: false, motivo: 'em_uso' } : { disponivel: true }
  })

  app.post('/publico/cadastro', async (req, reply) => {
    if (!passa(req.ip, 10, reply)) return reply
    const b = req.body
    if (!so(b, ['alias', 'nome', 'packs', 'dono', 'aceiteTermos', 'chave', 'captcha'])) return erro(reply, 400, 'requisicao_invalida', 'corpo inválido: campos desconhecidos ou ausentes')
    const x = b as Record<string, unknown>
    if (typeof x.chave !== 'string' || !CHAVE.test(x.chave)) return erro(reply, 400, 'requisicao_invalida', 'chave: de 16 a 100 caracteres (letras, números, _ e -); gere uma por cadastro')
    if (!so(x.dono, ['email', 'nome'])) return erro(reply, 400, 'requisicao_invalida', 'dono: informe email e nome')
    if (o.verificaHumano) { if (typeof x.captcha !== 'string' || !x.captcha || x.captcha.length > 4096 || !(await o.verificaHumano(x.captcha, req.ip).catch(() => false))) return erro(reply, 400, 'verificacao_humana', 'não foi possível confirmar que você é uma pessoa') } else if (x.captcha !== undefined) return erro(reply, 400, 'requisicao_invalida', 'captcha não é esperado')
    const plano = planoDeCadastro(o.reg, { alias: x.alias as string, nome: x.nome as string, packs: x.packs as string[], dono: x.dono as { email: string; nome: string }, aceiteTermos: x.aceiteTermos as boolean })
    if (!plano.ok) return erro(reply, 400, 'cadastro_invalido', 'o cadastro tem problemas', { detalhes: plano.erros })
    const r = await provisiona(plano.plano, x.chave, o.portas)
    if (r.ok) return reply.status(r.retomado ? 200 : 201).send({ alias: r.alias, mensagem: 'cadastro concluído: enviamos o convite de acesso para o e-mail do responsável' })
    if (r.motivo === 'alias_ocupado') return erro(reply, 409, 'alias_ocupado', 'este endereço já está em uso: escolha outro')
    return erro(reply, 503, 'provisionamento_falhou', 'não conseguimos terminar o cadastro agora: tente de novo com a mesma chave, ele continua de onde parou', { retomavel: true })
  })
}
