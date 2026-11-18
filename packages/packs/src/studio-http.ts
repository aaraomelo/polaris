import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify'
import { regrasDePapeis, resolve } from '@polaris/acesso'
import type { Registry } from '@polaris/schema'
import { diffNo, GRUPOS, validaTexto, validaToken, type Grupo } from '@polaris/studio'
import type { criaArmazemDeNos, KindDoTenant } from './overrides'
import { KINDS_DO_TENANT } from './overrides'

// API de AUTORIA do Studio. O tenant e o autor vêm SEMPRE da sessão (`autentica`), nunca do corpo: não há como gravar, ler ou comentar em nome de outro tenant ou outra pessoa.
// Tudo é gravado como versão imutável (E7); aqui só há leitura, gravação com controle de concorrência (409 se alguém salvou antes), histórico, diff e comentários.
export type Sessao = { tenantId: string; usuario: string; pode(permissao: 'studio.ver' | 'studio.comentar' | 'studio.editar'): boolean }
const ACAO: Record<Parameters<Sessao['pode']>[0], string> = { 'studio.ver': 'ver', 'studio.comentar': 'comentar', 'studio.editar': 'editar' }
/** a sessão do Studio a partir do token do gateway: as permissões vêm dos PAPÉIS (`studio.leitor` ⊂ `studio.comentarista` ⊂ `studio.editor`), com a mesma semântica de acesso dos serviços (negar vence, falha fechada). Papel desconhecido = sem nenhuma permissão. */
export function sessaoDeToken(reg: Registry, c: { tenantId: string; usuario: string; papeis: readonly string[] }): Sessao {
  let regras: ReturnType<typeof regrasDePapeis> = []
  try { regras = regrasDePapeis(reg, c.papeis.filter((p) => p.startsWith('studio.'))) } catch { regras = [] }
  return { tenantId: c.tenantId, usuario: c.usuario, pode: (p) => { try { return resolve(regras, ACAO[p], 'studio.no', {}, {}).tipo !== 'nada' } catch { return false } } }
}

export type OpcoesStudio = {
  armazem: ReturnType<typeof criaArmazemDeNos>
  /** o registro BASE (core + segmento) do tenant: de onde vêm blocos do catálogo e nós que o tenant ainda não sobrescreveu */
  baseDe: (tenantId: string) => Promise<import('@polaris/schema').Registry>
  q: (sql: string, params?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>>; rowCount: number }>
  autentica: (req: FastifyRequest) => Promise<Sessao | null>
  /** gera o HTML de pré-visualização de uma página (compilador e renderizador do engine); injetado porque o pacote não depende do engine. Sem ele, `/studio/previa` é 501. */
  previsualiza?: (a: { no: unknown; tema?: unknown; selecionado?: string; blocosDoTenant: unknown[] }) => { ok: true; html: string; titulo: string } | { ok: false; erros: string[] }
  limite?: { tenta(chave: string, custo?: number): { ok: true } | { ok: false; esperaSeg: number } }
}
const ID = /^[a-z][A-Za-z0-9._/-]{0,127}$/, UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i, ANCORA = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/
const erro = (r: FastifyReply, s: number, codigo: string, mensagem: string, extra: object = {}) => r.status(s).send({ erro: { codigo, mensagem, ...extra } })
const so = (o: unknown, chaves: string[]) => !!o && typeof o === 'object' && !Array.isArray(o) && Object.keys(o).every((k) => chaves.includes(k))
const comentarioDe = (r: Record<string, unknown>) => ({ id: r.id as string, kind: r.kind as string, noId: r.no_id as string, ...(r.ancora ? { ancora: r.ancora as string } : {}), ...(r.versao !== null && r.versao !== undefined ? { versao: Number(r.versao) } : {}), autor: r.autor as string, texto: r.texto as string, criadoEm: new Date(r.criado_em as string).toISOString(), ...(r.resp_a ? { respondeA: r.resp_a as string } : {}), resolvido: r.resolvido === true })

/** valores de token que o schema do tema aceita (texto livre) mas que o CSS não: cor e medida inválidas viram erro ANTES de gravar */
export function errosDeTema(no: Record<string, unknown>): string[] {
  const out: string[] = [], spec = (no.spec ?? {}) as { tokens?: Record<string, unknown>; modos?: Record<string, Record<string, unknown>> }
  const confere = (base: string, t: unknown) => {
    if (!t || typeof t !== 'object') return
    for (const g of GRUPOS) { const grupo = (t as Record<string, unknown>)[g]; if (!grupo || typeof grupo !== 'object') continue
      for (const [nome, v] of Object.entries(grupo as Record<string, unknown>)) { const e = validaToken(g as Grupo, nome, v); if (e) out.push(`${base}.${g}.${nome}: ${e}`) } }
  }
  confere('tokens', spec.tokens); for (const [m, t] of Object.entries(spec.modos ?? {})) confere(`modos.${m}`, t)
  return out.slice(0, 20)
}

export function rotasStudio(app: FastifyInstance, o: OpcoesStudio): void {
  app.addHook('onSend', async (_req, reply) => { reply.header('cache-control', 'no-store'); reply.header('x-content-type-options', 'nosniff') })
  async function sessao(req: FastifyRequest, reply: FastifyReply, p: Parameters<Sessao['pode']>[0], custo = 1): Promise<Sessao | null> {
    const s = await o.autentica(req).catch(() => null)
    if (!s) { erro(reply, 401, 'nao_autenticado', 'entre para usar o Studio'); return null }
    if (!s.pode(p)) { erro(reply, 403, 'sem_permissao', `falta a permissão ${p}`); return null }
    if (o.limite) { const t = o.limite.tenta(`studio:${s.tenantId}:${s.usuario}`, custo); if (!t.ok) { reply.header('retry-after', String(t.esperaSeg)); erro(reply, 429, 'muitas_requisicoes', 'devagar: muitas requisições'); return null } }
    return s
  }
  const kindOk = (k: string): k is KindDoTenant => (KINDS_DO_TENANT as readonly string[]).includes(k)
  const alvo = (req: FastifyRequest<{ Params: { kind: string; '*': string } }>, reply: FastifyReply): { kind: KindDoTenant; id: string } | null => {
    const kind = req.params.kind, id = req.params['*']
    if (!kindOk(kind)) { erro(reply, 400, 'requisicao_invalida', `kind inválido (use ${KINDS_DO_TENANT.join(', ')})`); return null }
    if (!ID.test(id)) { erro(reply, 400, 'requisicao_invalida', 'id inválido'); return null }
    return { kind, id }
  }

  // catálogo de blocos do tenant (paleta + formulário de props): o que o editor precisa de cada bloco
  app.get('/studio/blocos', async (req, reply) => {
    const s = await sessao(req, reply, 'studio.ver'); if (!s) return reply
    const { registro } = await o.armazem.registroDoTenant(s.tenantId)
    const blocos = registro.ids('bloco').map((id) => { const no = registro.resolve('bloco', id)?.no; const sp = (no?.spec ?? {}) as Record<string, unknown>; return { id, titulo: (sp.titulo as string | undefined) ?? id, ...(sp.descricao ? { descricao: sp.descricao } : {}), ...(sp.props ? { props: sp.props } : {}), slots: sp.slots ?? {}, composto: sp.modelo !== undefined, ...(sp.codigo !== undefined ? { codigo: true } : {}) } })
    return { blocos }
  })

  app.get('/studio/nos', async (req, reply) => {
    const s = await sessao(req, reply, 'studio.ver'); if (!s) return reply
    const base = await o.baseDe(s.tenantId)
    return { nos: await o.armazem.lista(s.tenantId), base: Object.fromEntries(KINDS_DO_TENANT.map((k) => [k, base.ids(k as never)])) }
  })

  app.get<{ Params: { kind: string; '*': string } }>('/studio/nos/:kind/*', async (req, reply) => {
    const a = alvo(req, reply); if (!a) return reply
    const s = await sessao(req, reply, 'studio.ver'); if (!s) return reply
    const cab = (await o.armazem.cabecas(s.tenantId)).find((c) => c.kind === a.kind && c.id === a.id)
    if (cab) return { origem: 'tenant', seq: cab.seq, no: cab.conteudo }
    const b = (await o.baseDe(s.tenantId)).resolve(a.kind as never, a.id)
    if (b) return { origem: 'base', seq: null, no: b.no }
    return erro(reply, 404, 'nao_encontrado', 'nó inexistente')
  })

  app.put<{ Params: { kind: string; '*': string } }>('/studio/nos/:kind/*', { bodyLimit: 512 * 1024 }, async (req, reply) => {
    const a = alvo(req, reply); if (!a) return reply
    const s = await sessao(req, reply, 'studio.editar', 3); if (!s) return reply
    const b = req.body; if (!so(b, ['no', 'nota', 'baseSeq'])) return erro(reply, 400, 'requisicao_invalida', 'corpo inválido: use { no, nota?, baseSeq? }')
    const x = b as { no?: unknown; nota?: unknown; baseSeq?: unknown }
    if (x.nota !== undefined && (typeof x.nota !== 'string' || x.nota.length > 200)) return erro(reply, 400, 'requisicao_invalida', 'nota: texto de até 200 caracteres')
    if (x.baseSeq !== undefined && x.baseSeq !== null && (!Number.isInteger(x.baseSeq) || (x.baseSeq as number) < 0)) return erro(reply, 400, 'requisicao_invalida', 'baseSeq inválido')
    const no = x.no as Record<string, unknown> | undefined
    if (!no || typeof no !== 'object' || no.kind !== a.kind || no.id !== a.id) return erro(reply, 400, 'requisicao_invalida', 'o nó do corpo precisa ter o mesmo kind e id da URL')
    // concorrência otimista: quem abriu a versão N só grava se a cabeça ainda é N (null = "não havia versão do tenant")
    if (x.baseSeq !== undefined) {
      const cab = (await o.armazem.cabecas(s.tenantId)).find((c) => c.kind === a.kind && c.id === a.id)
      const atual = cab ? cab.seq : null
      if ((x.baseSeq ?? null) !== atual) { const h = atual === null ? [] : await o.armazem.historico(s.tenantId, a.kind, a.id, 1); return erro(reply, 409, 'conflito', 'este nó foi alterado por outra pessoa depois que você o abriu', { seqAtual: atual, ...(h[0] ? { autor: h[0].autor, criadoEm: h[0].criadoEm } : {}) }) }
    }
    if (a.kind === 'tema') { const inv = errosDeTema(no); if (inv.length) return erro(reply, 422, 'no_invalido', 'o tema tem valores inválidos', { erros: inv }) }
    const r = await o.armazem.salva(s.tenantId, s.usuario, no, x.nota as string | undefined)
    return r.ok ? reply.status(r.novo ? 201 : 200).send({ versao: r.versao, novo: r.novo }) : erro(reply, 422, 'no_invalido', 'o nó não passou na validação', { erros: r.erros })
  })

  app.delete<{ Params: { kind: string; '*': string } }>('/studio/nos/:kind/*', async (req, reply) => {
    const a = alvo(req, reply); if (!a) return reply
    const s = await sessao(req, reply, 'studio.editar', 3); if (!s) return reply
    const r = await o.armazem.remove(s.tenantId, a.kind, a.id, s.usuario, 'restaurado para o padrão')
    return r.ok ? { ok: true } : erro(reply, 404, 'nao_encontrado', r.erro)
  })

  app.get<{ Params: { kind: string; '*': string }; Querystring: { limite?: string } }>('/studio/historico/:kind/*', async (req, reply) => {
    const a = alvo(req, reply); if (!a) return reply
    const s = await sessao(req, reply, 'studio.ver'); if (!s) return reply
    const lim = req.query.limite === undefined ? 50 : Number(req.query.limite); if (!Number.isInteger(lim) || lim < 1 || lim > 200) return erro(reply, 400, 'requisicao_invalida', 'limite: de 1 a 200')
    return { versoes: await o.armazem.historico(s.tenantId, a.kind, a.id, lim) }
  })

  app.get<{ Params: { kind: string; '*': string }; Querystring: { seq?: string } }>('/studio/versao/:kind/*', async (req, reply) => {
    const a = alvo(req, reply); if (!a) return reply
    const s = await sessao(req, reply, 'studio.ver'); if (!s) return reply
    const seq = Number(req.query.seq); if (!Number.isInteger(seq) || seq < 1) return erro(reply, 400, 'requisicao_invalida', 'seq: inteiro a partir de 1')
    const v = await o.armazem.versao(s.tenantId, a.kind, a.id, seq); return v ? { meta: v.meta, no: v.conteudo } : erro(reply, 404, 'nao_encontrado', 'versão inexistente')
  })

  /** diff entre duas versões: números de `seq`, ou `base` (o nó padrão do core/segmento) */
  app.get<{ Params: { kind: string; '*': string }; Querystring: { de?: string; para?: string } }>('/studio/diff/:kind/*', async (req, reply) => {
    const a = alvo(req, reply); if (!a) return reply
    const s = await sessao(req, reply, 'studio.ver', 2); if (!s) return reply
    const carrega = async (ref: string | undefined): Promise<Record<string, unknown> | null | 'invalido'> => {
      if (ref === 'base') return ((await o.baseDe(s.tenantId)).resolve(a.kind as never, a.id)?.no as unknown as Record<string, unknown>) ?? null
      const n = Number(ref); if (!Number.isInteger(n) || n < 1) return 'invalido'
      return ((await o.armazem.versao(s.tenantId, a.kind, a.id, n))?.conteudo as Record<string, unknown> | null | undefined) ?? null
    }
    const [de, para] = [await carrega(req.query.de), await carrega(req.query.para)]
    if (de === 'invalido' || para === 'invalido') return erro(reply, 400, 'requisicao_invalida', 'de/para: número de versão ou "base"')
    if (!de || !para) return erro(reply, 404, 'nao_encontrado', 'versão inexistente')
    return { diff: diffNo(de, para) }
  })

  app.get<{ Querystring: { kind?: string; id?: string } }>('/studio/comentarios', async (req, reply) => {
    const s = await sessao(req, reply, 'studio.ver'); if (!s) return reply
    const { kind, id } = req.query; if (!kind || !id || !kindOk(kind) || !ID.test(id)) return erro(reply, 400, 'requisicao_invalida', 'informe kind e id válidos')
    const r = await o.q(`SELECT id, kind, no_id, ancora, versao, autor, texto, resp_a, resolvido, criado_em FROM plataforma.comentario WHERE tenant_id = $1 AND kind = $2 AND no_id = $3 ORDER BY criado_em, id LIMIT 1000`, [s.tenantId, kind, id])
    return { comentarios: r.rows.map(comentarioDe) }
  })

  app.post('/studio/comentarios', { bodyLimit: 16 * 1024 }, async (req, reply) => {
    const s = await sessao(req, reply, 'studio.comentar', 2); if (!s) return reply
    const b = req.body; if (!so(b, ['kind', 'id', 'ancora', 'versao', 'texto', 'respondeA'])) return erro(reply, 400, 'requisicao_invalida', 'corpo inválido')
    const x = b as Record<string, unknown>
    if (typeof x.kind !== 'string' || !kindOk(x.kind) || typeof x.id !== 'string' || !ID.test(x.id)) return erro(reply, 400, 'requisicao_invalida', 'kind/id inválidos')
    const t = validaTexto(x.texto); if (t) return erro(reply, 400, 'requisicao_invalida', t)
    if (x.ancora !== undefined && (typeof x.ancora !== 'string' || !ANCORA.test(x.ancora))) return erro(reply, 400, 'requisicao_invalida', 'âncora inválida')
    if (x.versao !== undefined && (!Number.isInteger(x.versao) || (x.versao as number) < 1)) return erro(reply, 400, 'requisicao_invalida', 'versão inválida')
    if (x.respondeA !== undefined) {
      if (typeof x.respondeA !== 'string' || !UUID.test(x.respondeA)) return erro(reply, 400, 'requisicao_invalida', 'respondeA inválido')
      const pai = (await o.q(`SELECT kind, no_id FROM plataforma.comentario WHERE tenant_id = $1 AND id = $2`, [s.tenantId, x.respondeA])).rows[0]
      if (!pai || pai.kind !== x.kind || pai.no_id !== x.id) return erro(reply, 400, 'requisicao_invalida', 'só se responde a um comentário do mesmo nó')
    }
    const r = await o.q(`INSERT INTO plataforma.comentario (tenant_id, kind, no_id, ancora, versao, autor, texto, resp_a) VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING id, kind, no_id, ancora, versao, autor, texto, resp_a, resolvido, criado_em`,
      [s.tenantId, x.kind, x.id, x.ancora ?? null, x.versao ?? null, s.usuario, x.texto, x.respondeA ?? null])
    return reply.status(201).send({ comentario: comentarioDe(r.rows[0]!) })
  })

  /** pré-visualização no servidor: o rascunho (e o tema) vão no corpo; devolve o HTML pronto para um iframe `sandbox=""` ou os erros do compilador */
  app.post('/studio/previa', { bodyLimit: 512 * 1024 }, async (req, reply) => {
    const s = await sessao(req, reply, 'studio.ver', 3); if (!s) return reply
    if (!o.previsualiza) return erro(reply, 501, 'nao_implementado', 'este servidor não gera pré-visualização')
    const b = req.body; if (!so(b, ['no', 'tema', 'selecionado'])) return erro(reply, 400, 'requisicao_invalida', 'corpo: { no, tema?, selecionado? }')
    const x = b as { no?: unknown; tema?: unknown; selecionado?: unknown }
    if (!x.no || typeof x.no !== 'object' || Array.isArray(x.no)) return erro(reply, 400, 'requisicao_invalida', 'no: objeto esperado')
    if (x.selecionado !== undefined && (typeof x.selecionado !== 'string' || !ANCORA.test(x.selecionado))) return erro(reply, 400, 'requisicao_invalida', 'selecionado inválido')
    const blocos = (await o.armazem.cabecas(s.tenantId)).filter((c) => c.kind === 'bloco').map((c) => ({ ...(c.conteudo as object), tenantId: s.tenantId }))
    const r = o.previsualiza({ no: x.no, ...(x.tema ? { tema: x.tema } : {}), ...(x.selecionado ? { selecionado: x.selecionado } : {}), blocosDoTenant: blocos })
    return r.ok ? { ok: true, html: r.html, erros: [] } : { ok: false, html: '', erros: r.erros }
  })

  app.post<{ Params: { cid: string } }>('/studio/comentarios/:cid/resolver', async (req, reply) => {
    const s = await sessao(req, reply, 'studio.comentar'); if (!s) return reply
    if (!UUID.test(req.params.cid)) return erro(reply, 400, 'requisicao_invalida', 'id inválido')
    const b = req.body; if (!so(b, ['resolvido']) || typeof (b as { resolvido?: unknown }).resolvido !== 'boolean') return erro(reply, 400, 'requisicao_invalida', 'corpo: { resolvido: boolean }')
    const r = await o.q(`UPDATE plataforma.comentario SET resolvido = $3 WHERE tenant_id = $1 AND id = $2 AND resp_a IS NULL RETURNING id`, [s.tenantId, req.params.cid, (b as { resolvido: boolean }).resolvido])
    return r.rowCount ? { ok: true } : erro(reply, 404, 'nao_encontrado', 'comentário inexistente (só o comentário inicial de um fio se resolve)')
  })
}
