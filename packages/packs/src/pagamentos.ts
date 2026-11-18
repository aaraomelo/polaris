import type { No } from '@polaris/schema'
import { ErroApi, colunas, linhaParaApi, tabela, type Consulta, type EntradaOperacao } from '@polaris/servico'
import { adiciona, compara, percentual, proporcional, soma, subtrai } from './dinheiro'
import type { Portas, PedidoSaga, Resultado } from './vendas'

// Pack Pagamentos e Caixa: provedor plugável, ciclo autorizar → capturar → cancelar/estornar, carteira com razão (ledger) e caixa (abertura, sangria, reforço, fechamento).
// O provedor externo (PagBank, Mercado Pago, Stone…) entra por `Provedor`: o pack não conhece nenhum. Toda chamada ao provedor usa `pagamentoId` como chave de idempotência.

export type Cobranca = { tenantId: string; pagamentoId: string; pedidoId: string; metodo: string; valor: string; parcelas: number }
export type ResultadoProvedor = { ok: true; referencia: string } | { ok: false; motivo: string }
export type Provedor = {
  autoriza(c: Cobranca): Promise<ResultadoProvedor>
  captura(c: Cobranca, referencia: string): Promise<ResultadoProvedor>
  cancela(c: Cobranca, referencia: string): Promise<void>
  estorna(c: Cobranca, referencia: string, valor: string, chave: string): Promise<ResultadoProvedor>
}
/** o provedor interno: tudo aprovado na hora (dinheiro, vale, carteira). Sem rede, sem taxa própria. */
export const provedorInterno: Provedor = {
  autoriza: async (c) => ({ ok: true, referencia: `int-${c.pagamentoId}` }),
  captura: async (c) => ({ ok: true, referencia: `int-${c.pagamentoId}` }),
  cancela: async () => {},
  estorna: async (c, _r, _v, chave) => ({ ok: true, referencia: `int-est-${c.pagamentoId}-${chave}` }),
}

export type OpcoesPagamentos = { provedores: Record<string, Provedor> }
type Linha = Record<string, unknown>
const METODOS = ['dinheiro', 'pix', 'credito', 'debito', 'vale'] as const
const ABERTAS = ['pago', 'estornado_parcial', 'estornado']

export function criaPagamentos(no: No, o: OpcoesPagamentos) {
  const ents = (no.spec as { entidades: Record<string, never> }).entidades
  const T = (e: string) => tabela('pagamentos', e)
  const S = (e: string) => `pagamentos.${e}`
  const ler = async (q: Consulta, ent: string, id: string, bloqueia = false): Promise<Linha | undefined> => {
    const r = (await q(`SELECT ${colunas(ents[ent]!)} FROM ${T(ent)} WHERE id = $1${bloqueia ? ' FOR UPDATE' : ''}`, [id])).rows[0]
    return r && linhaParaApi(ents[ent]!, r)
  }
  const naoEncontrado = (x: string) => new ErroApi(404, 'nao_encontrado', `${x} não encontrado`)
  const cobranca = (tenantId: string, p: Linha): Cobranca => ({ tenantId, pagamentoId: p.id as string, pedidoId: p.pedidoId as string, metodo: p.metodo as string, valor: p.valor as string, parcelas: Number(p.parcelas ?? 1) })
  const provedorDe = (nome: string): Provedor => { const p = o.provedores[nome]; if (!p) throw new ErroApi(422, 'provedor_desconhecido', `provedor '${nome}' não está configurado neste ambiente`); return p }
  const chamaProvedor = async <T>(f: () => Promise<T>): Promise<T> => { try { return await f() } catch { throw new ErroApi(502, 'provedor_indisponivel', 'o provedor de pagamento não respondeu: tente de novo (a operação é idempotente)') } }
  const dinheiroValido = (v: unknown, nome: string, positivo = true): string => {
    const s = String(v); if (!/^\d{1,15}(\.\d{1,4})?$/.test(s)) throw new ErroApi(400, 'entrada_invalida', `${nome} inválido`)
    if (positivo && compara(s, '0') <= 0) throw new ErroApi(400, 'entrada_invalida', `${nome} deve ser maior que zero`)
    return s
  }

  /** razão da carteira: o saldo muda por UPDATE atômico (a linha da carteira serializa os concorrentes) e cada movimento deixa um lançamento com o saldo resultante */
  async function lanca(q: Consulta, tenantId: string, tipo: 'credito' | 'debito', valor: string, ref: { pagamentoId?: string; estornoId?: string; descricao?: string }) {
    await q(`INSERT INTO ${T('carteira')} (tenant_id, nome, saldo) VALUES ($1, 'principal', 0) ON CONFLICT (tenant_id, nome) DO NOTHING`, [tenantId])
    const sinal = tipo === 'credito' ? '+' : '-'
    const r = (await q(`UPDATE ${T('carteira')} SET saldo = saldo ${sinal} $1::numeric, atualizado_em = now() WHERE nome = 'principal' RETURNING id::text AS id, saldo::text AS saldo`, [valor])).rows[0] as { id: string; saldo: string }
    await q(`INSERT INTO ${T('lancamento')} (tenant_id, carteira_id, tipo, valor, saldo_apos, pagamento_id, estorno_id, descricao) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [tenantId, r.id, tipo, valor, r.saldo, ref.pagamentoId ?? null, ref.estornoId ?? null, ref.descricao ?? null])
  }

  /** dinheiro que DEVERIA estar na gaveta: abertura + vendas em dinheiro − estornos em dinheiro + reforços − sangrias */
  async function esperadoDoCaixa(q: Consulta, sessaoId: string, abertura: string): Promise<string> {
    const vendas = (await q(`SELECT valor::text AS v FROM ${T('pagamento')} WHERE sessao_caixa_id = $1 AND metodo = 'dinheiro' AND status = ANY($2::text[])`, [sessaoId, ABERTAS])).rows.map((r) => r.v as string)
    const estornos = (await q(`SELECT valor::text AS v FROM ${T('estorno')} WHERE sessao_caixa_id = $1`, [sessaoId])).rows.map((r) => r.v as string)
    const ops = (await q(`SELECT tipo, valor::text AS v FROM ${T('operacao_caixa')} WHERE sessao_caixa_id = $1`, [sessaoId])).rows as Array<{ tipo: string; v: string }>
    const entra = soma([abertura, ...vendas, ...ops.filter((x) => x.tipo === 'reforco').map((x) => x.v)]), sai = soma([...estornos, ...ops.filter((x) => x.tipo === 'sangria').map((x) => x.v)])
    return subtrai(entra, sai)
  }
  async function sessaoAberta(q: Consulta, id: string): Promise<Linha> {
    const s = await ler(q, 'sessaoCaixa', id, true); if (!s) throw naoEncontrado('sessão de caixa')
    if (s.status !== 'aberta') throw new ErroApi(409, 'caixa_fechado', 'a sessão de caixa já foi fechada')
    return s
  }

  const operacoes = {
    async autorizar({ entrada, ctx, q }: EntradaOperacao): Promise<unknown> {
      const pedidoId = String(entrada.pedidoId), metodo = String(entrada.metodo), valor = dinheiroValido(entrada.valor, 'valor')
      const parcelas = entrada.parcelas === undefined ? 1 : Number(entrada.parcelas)
      if (!(METODOS as readonly string[]).includes(metodo)) throw new ErroApi(400, 'entrada_invalida', `método inválido (use ${METODOS.join(', ')})`)
      if (!Number.isInteger(parcelas) || parcelas < 1 || parcelas > 24 || (metodo !== 'credito' && parcelas !== 1)) throw new ErroApi(400, 'entrada_invalida', 'parcelas: 1 a 24, e só no crédito')
      const sessaoId = entrada.sessaoCaixaId == null ? null : String(entrada.sessaoCaixaId)
      const ja = (await q(`SELECT id::text AS id, metodo, valor::text AS valor FROM ${T('pagamento')} WHERE pedido_id = $1 FOR UPDATE`, [pedidoId])).rows[0] as Linha | undefined
      if (ja) { // a mesma chamada de novo: devolve o pagamento que já existe, sem cobrar outra vez
        if (ja.metodo !== metodo || compara(ja.valor as string, valor) !== 0) throw new ErroApi(409, 'pedido_ja_tem_pagamento', 'este pedido já tem um pagamento com outro método ou valor')
        return ler(q, 'pagamento', ja.id as string)
      }
      const cfg = (await q(`SELECT provedor, taxa_percentual::text AS taxa FROM ${T('config_pagamento')} WHERE metodo = $1 AND ativo`, [metodo])).rows[0] as { provedor: string; taxa: string } | undefined
      if (!cfg) throw new ErroApi(422, 'metodo_indisponivel', `o método '${metodo}' não está habilitado para este tenant`)
      const prov = provedorDe(cfg.provedor)
      if (metodo === 'dinheiro') { if (!sessaoId) throw new ErroApi(422, 'caixa_obrigatorio', 'pagamento em dinheiro exige uma sessão de caixa aberta'); await sessaoAberta(q, sessaoId) } else if (sessaoId) throw new ErroApi(400, 'entrada_invalida', 'sessaoCaixaId só vale para dinheiro')
      const taxa = percentual(valor, cfg.taxa), liquido = subtrai(valor, taxa)
      const id = ((await q(`INSERT INTO ${T('pagamento')} (tenant_id, pedido_id, metodo, status, valor, taxa, liquido, parcelas, provedor, estornado, sessao_caixa_id) VALUES ($1, $2, $3, 'autorizado', $4, $5, $6, $7, $8, 0, $9) RETURNING id::text AS id`,
        [ctx.tenantId, pedidoId, metodo, valor, taxa, liquido, parcelas, cfg.provedor, sessaoId])).rows[0] as { id: string }).id
      const r = await chamaProvedor(() => prov.autoriza({ tenantId: ctx.tenantId, pagamentoId: id, pedidoId, metodo, valor, parcelas }))
      if (r.ok) await q(`UPDATE ${T('pagamento')} SET referencia_externa = $2, atualizado_em = now() WHERE id = $1`, [id, r.referencia])
      else await q(`UPDATE ${T('pagamento')} SET status = 'falhou', motivo_falha = $2, atualizado_em = now() WHERE id = $1`, [id, r.motivo.slice(0, 500)]) // recusa é um RESULTADO (200 com status falhou), não erro: fica registrada e a repetição não recobra
      return ler(q, 'pagamento', id)
    },

    async capturar({ params, ctx, q }: EntradaOperacao): Promise<unknown> {
      const p = await ler(q, 'pagamento', params.id!, true); if (!p) throw naoEncontrado('pagamento')
      if (p.status === 'pago') return p
      if (p.status !== 'autorizado') throw new ErroApi(409, 'estado_invalido', `pagamento ${p.status}: só se captura um pagamento autorizado`)
      const r = await chamaProvedor(() => provedorDe(p.provedor as string).captura(cobranca(ctx.tenantId, p), p.referenciaExterna as string))
      if (!r.ok) { await q(`UPDATE ${T('pagamento')} SET status = 'falhou', motivo_falha = $2, atualizado_em = now() WHERE id = $1`, [p.id, r.motivo.slice(0, 500)]); return ler(q, 'pagamento', p.id as string) }
      await q(`UPDATE ${T('pagamento')} SET status = 'pago', pago_em = now(), referencia_externa = $2, atualizado_em = now() WHERE id = $1`, [p.id, r.referencia])
      if (p.metodo !== 'dinheiro') await lanca(q, ctx.tenantId, 'credito', p.liquido as string, { pagamentoId: p.id as string, descricao: 'recebimento' }) // dinheiro vai para a gaveta (caixa), não para a carteira
      return ler(q, 'pagamento', p.id as string)
    },

    async cancelar({ params, ctx, q }: EntradaOperacao): Promise<unknown> {
      const p = await ler(q, 'pagamento', params.id!, true); if (!p) throw naoEncontrado('pagamento')
      if (p.status === 'cancelado' || p.status === 'falhou') return p
      if (p.status !== 'autorizado') throw new ErroApi(409, 'estado_invalido', `pagamento ${p.status}: depois de pago, o caminho é o estorno`)
      await chamaProvedor(() => provedorDe(p.provedor as string).cancela(cobranca(ctx.tenantId, p), p.referenciaExterna as string))
      await q(`UPDATE ${T('pagamento')} SET status = 'cancelado', atualizado_em = now() WHERE id = $1`, [p.id])
      return ler(q, 'pagamento', p.id as string)
    },

    async estornar({ params, entrada, ctx, q }: EntradaOperacao): Promise<unknown> {
      const valor = dinheiroValido(entrada.valor, 'valor'), chave = String(entrada.chaveIdempotencia), motivo = String(entrada.motivo).trim()
      if (chave.length < 8 || chave.length > 120) throw new ErroApi(400, 'entrada_invalida', 'chaveIdempotencia deve ter de 8 a 120 caracteres')
      if (!motivo) throw new ErroApi(400, 'entrada_invalida', 'informe o motivo do estorno')
      const p = await ler(q, 'pagamento', params.id!, true); if (!p) throw naoEncontrado('pagamento')
      const ja = (await q(`SELECT id::text AS id, pagamento_id::text AS pid, valor::text AS valor FROM ${T('estorno')} WHERE chave_idempotencia = $1`, [chave])).rows[0] as Linha | undefined
      if (ja) { if (ja.pid !== p.id || compara(ja.valor as string, valor) !== 0) throw new ErroApi(409, 'chave_reutilizada', 'esta chave de idempotência já foi usada em outro estorno'); return ler(q, 'estorno', ja.id as string) }
      if (p.status !== 'pago' && p.status !== 'estornado_parcial') throw new ErroApi(409, 'estado_invalido', `pagamento ${p.status}: só se estorna um pagamento pago`)
      const restante = subtrai(p.valor as string, p.estornado as string)
      if (compara(valor, restante) > 0) throw new ErroApi(422, 'estorno_excede', `o estorno excede o que resta estornar (${restante})`)
      let sessaoId: string | null = null
      if (p.metodo === 'dinheiro') { sessaoId = entrada.sessaoCaixaId == null ? null : String(entrada.sessaoCaixaId); if (!sessaoId) throw new ErroApi(422, 'caixa_obrigatorio', 'estorno em dinheiro sai de uma sessão de caixa aberta'); await sessaoAberta(q, sessaoId) }
      const r = await chamaProvedor(() => provedorDe(p.provedor as string).estorna(cobranca(ctx.tenantId, p), p.referenciaExterna as string, valor, chave))
      if (!r.ok) throw new ErroApi(422, 'estorno_recusado', r.motivo.slice(0, 300))
      const id = ((await q(`INSERT INTO ${T('estorno')} (tenant_id, pagamento_id, valor, motivo, chave_idempotencia, referencia_externa, sessao_caixa_id) VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING id::text AS id`, [ctx.tenantId, p.id, valor, motivo, chave, r.referencia, sessaoId])).rows[0] as { id: string }).id
      const novo = adiciona(p.estornado as string, valor), total = compara(novo, p.valor as string) === 0
      await q(`UPDATE ${T('pagamento')} SET estornado = $2, status = $3, atualizado_em = now() WHERE id = $1`, [p.id, novo, total ? 'estornado' : 'estornado_parcial'])
      // a carteira devolve a fatia do LÍQUIDO que cabe a este estorno (a taxa do provedor não volta): estorno total zera o efeito
      if (p.metodo !== 'dinheiro') {
        const jaDebitado = soma([ '0', ...(await q(`SELECT valor::text AS v FROM ${T('lancamento')} WHERE pagamento_id = $1 AND tipo = 'debito'`, [p.id])).rows.map((r) => r.v as string)])
        // o último estorno devolve o RESTANTE do líquido (os arredondamentos dos parciais nunca deixam sobra nem excesso)
        await lanca(q, ctx.tenantId, 'debito', total ? subtrai(p.liquido as string, jaDebitado) : proporcional(valor, p.liquido as string, p.valor as string), { pagamentoId: p.id as string, estornoId: id, descricao: 'estorno' })
      }
      return ler(q, 'estorno', id)
    },

    async abrirCaixa({ params, entrada, ctx, q }: EntradaOperacao): Promise<unknown> {
      const abertura = dinheiroValido(entrada.valorAbertura, 'valorAbertura', false)
      const c = await ler(q, 'caixa', params.id!, true); if (!c) throw naoEncontrado('caixa')
      if (!c.ativo) throw new ErroApi(409, 'caixa_inativo', 'este caixa está desativado')
      if ((await q(`SELECT 1 FROM ${T('sessao_caixa')} WHERE caixa_id = $1 AND status = 'aberta'`, [c.id])).rows.length) throw new ErroApi(409, 'caixa_ja_aberto', 'este caixa já tem uma sessão aberta')
      const id = ((await q(`INSERT INTO ${T('sessao_caixa')} (tenant_id, caixa_id, status, aberto_por, valor_abertura) VALUES ($1, $2, 'aberta', $3, $4) RETURNING id::text AS id`, [ctx.tenantId, c.id, ctx.usuario ?? 'desconhecido', abertura])).rows[0] as { id: string }).id
      return ler(q, 'sessaoCaixa', id)
    },

    async movimentarCaixa({ params, entrada, ctx, q }: EntradaOperacao): Promise<unknown> {
      const tipo = String(entrada.tipo), valor = dinheiroValido(entrada.valor, 'valor')
      if (tipo !== 'sangria' && tipo !== 'reforco') throw new ErroApi(400, 'entrada_invalida', 'tipo deve ser sangria ou reforco')
      const s = await sessaoAberta(q, params.id!)
      if (s.abertoPor !== ctx.usuario) throw new ErroApi(403, 'proibido', 'só quem abriu o caixa movimenta a gaveta')
      if (tipo === 'sangria' && compara(valor, await esperadoDoCaixa(q, s.id as string, s.valorAbertura as string)) > 0) throw new ErroApi(422, 'saldo_insuficiente_no_caixa', 'a sangria é maior que o dinheiro que há na gaveta')
      const id = ((await q(`INSERT INTO ${T('operacao_caixa')} (tenant_id, sessao_caixa_id, tipo, valor, operador, notas) VALUES ($1, $2, $3, $4, $5, $6) RETURNING id::text AS id`, [ctx.tenantId, s.id, tipo, valor, ctx.usuario ?? 'desconhecido', entrada.notas ?? null])).rows[0] as { id: string }).id
      return ler(q, 'operacaoCaixa', id)
    },

    async fecharCaixa({ params, entrada, ctx, q, pode }: EntradaOperacao): Promise<unknown> {
      const contado = dinheiroValido(entrada.valorContado, 'valorContado', false)
      const s = await sessaoAberta(q, params.id!)
      if (!pode('fecharCaixa', S('sessaoCaixa'), s)) throw new ErroApi(403, 'proibido', 'só quem abriu o caixa o fecha')
      const esperado = await esperadoDoCaixa(q, s.id as string, s.valorAbertura as string)
      await q(`UPDATE ${T('sessao_caixa')} SET status = 'fechada', fechado_por = $2, valor_esperado = $3, valor_contado = $4, diferenca = $5, fechada_em = now(), atualizado_em = now() WHERE id = $1`, [s.id, ctx.usuario ?? 'desconhecido', esperado, contado, subtrai(contado, esperado)])
      return ler(q, 'sessaoCaixa', s.id as string)
    },
  }
  return { operacoes }
}

/** O cliente do serviço Pagamentos (HTTP em produção). Devolve o status HTTP e o corpo; erro de rede = exceção. */
export type ClientePagamentos = { chama(tenantId: string, metodo: 'POST', caminho: string, corpo: unknown): Promise<{ status: number; corpo: any }> }

/** Liga a saga do pack Vendas ao serviço Pagamentos. Recusa vira `ok:false`; falha de infraestrutura (5xx, rede) LANÇA, para a saga tentar de novo sem compensar à toa. */
export function portaPagamento(c: ClientePagamentos): Portas['pagamento'] {
  const resolve = (r: { status: number; corpo: any }, esperado: string[]): Resultado => {
    if (r.status >= 500) throw new Error(`pagamentos indisponível (${r.status})`)
    if (r.status >= 400) return { ok: false, motivo: String(r.corpo?.erro?.mensagem ?? `pagamentos recusou (${r.status})`).slice(0, 300) }
    return esperado.includes(r.corpo.status) ? { ok: true, referencia: r.corpo.id } : { ok: false, motivo: String(r.corpo.motivoFalha ?? `pagamento ${r.corpo.status}`).slice(0, 300) }
  }
  return {
    autoriza: async (p: PedidoSaga) => resolve(await c.chama(p.tenantId, 'POST', '/pagamentos/autorizar', { pedidoId: p.pedidoId, metodo: p.metodoPagamento, valor: p.total, ...(p.parcelas > 1 ? { parcelas: p.parcelas } : {}) }), ['autorizado', 'pago']),
    captura: async (p, ref) => resolve(await c.chama(p.tenantId, 'POST', `/pagamentos/${ref}/capturar`, {}), ['pago']),
    cancela: async (p, ref) => { const r = await c.chama(p.tenantId, 'POST', `/pagamentos/${ref}/cancelar`, {}); if (r.status >= 500) throw new Error(`pagamentos indisponível (${r.status})`) },
  }
}
