import { criaConsumidor, type DbTenant } from '@polaris/eventos'
import type { No } from '@polaris/schema'
import { ErroApi, colunas, linhaParaApi, tabela, type Consulta, type EntradaOperacao } from '@polaris/servico'
import { adiciona, compara, custoMedio, subtrai } from './dinheiro'
import type { Portas, PedidoSaga, Resultado } from './vendas'

// Pack Estoque e Depósitos: saldo por (item, depósito) com `reservado`, razão de movimentos (append-only), reservas idempotentes por pedido e baixa por EVENTO.
// Regras de ouro: nunca saldo negativo; toda mudança de saldo deixa um movimento; todo efeito é idempotente (chave ou pedido); locks sempre em ordem fixa (sem deadlock).

type Linha = Record<string, unknown>
const TIPOS_SAIDA = ['perda', 'devolucao_fornecedor', 'consumo'] as const
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function criaEstoque(no: No, o: { validadeReservaMinutos?: number } = {}) {
  const ents = (no.spec as { entidades: Record<string, never> }).entidades
  const T = (e: string) => tabela('estoque', e)
  const validadePadrao = o.validadeReservaMinutos ?? 30
  const ler = async (q: Consulta, ent: string, id: string, bloqueia = false): Promise<Linha | undefined> => {
    const r = (await q(`SELECT ${colunas(ents[ent]!)} FROM ${T(ent)} WHERE id = $1${bloqueia ? ' FOR UPDATE' : ''}`, [id])).rows[0]
    return r && linhaParaApi(ents[ent]!, r)
  }
  const bad = (m: string) => new ErroApi(400, 'entrada_invalida', m)
  const qtd = (v: unknown, nome = 'quantidade', zeroOk = false): string => {
    const s = String(v); if (!/^\d{1,12}(\.\d{1,4})?$/.test(s)) throw bad(`${nome} inválida (até 4 casas decimais)`)
    if (!zeroOk && compara(s, '0') <= 0) throw bad(`${nome} deve ser maior que zero`)
    return s
  }
  const uuid = (v: unknown, nome: string): string => { const s = String(v); if (!UUID.test(s)) throw bad(`${nome} inválido`); return s.toLowerCase() }
  const chaveOk = (v: unknown): string => { const s = String(v); if (s.length < 8 || s.length > 120) throw bad('chave deve ter de 8 a 120 caracteres'); return s }
  const item = (e: Record<string, unknown>) => { const produtoId = uuid(e.produtoId, 'produtoId'), varianteId = e.varianteId == null ? null : uuid(e.varianteId, 'varianteId'); return { produtoId, varianteId, itemId: varianteId ?? produtoId } }

  async function depositoAtivo(q: Consulta, id: string): Promise<void> {
    const d = (await q(`SELECT ativo FROM ${T('deposito')} WHERE id = $1`, [id])).rows[0] as { ativo: boolean } | undefined
    if (!d) throw new ErroApi(404, 'nao_encontrado', 'depósito não encontrado'); if (!d.ativo) throw new ErroApi(409, 'deposito_inativo', 'depósito desativado')
  }
  /** garante a linha de saldo e a TRAVA; devolve os números em texto exato */
  async function saldoTravado(q: Consulta, tenantId: string, it: ReturnType<typeof item>, depositoId: string) {
    await q(`INSERT INTO ${T('saldo')} (tenant_id, item_id, produto_id, variante_id, deposito_id, quantidade, reservado, custo_medio) VALUES ($1, $2, $3, $4, $5, 0, 0, 0) ON CONFLICT (tenant_id, item_id, deposito_id) DO NOTHING`, [tenantId, it.itemId, it.produtoId, it.varianteId, depositoId])
    return (await q(`SELECT id::text AS id, quantidade::text AS quantidade, reservado::text AS reservado, custo_medio::text AS custo FROM ${T('saldo')} WHERE item_id = $1 AND deposito_id = $2 FOR UPDATE`, [it.itemId, depositoId])).rows[0] as { id: string; quantidade: string; reservado: string; custo: string }
  }
  const disponivel = (s: { quantidade: string; reservado: string }) => subtrai(s.quantidade, s.reservado)
  async function movimenta(q: Consulta, tenantId: string, usuario: string, m: { it: ReturnType<typeof item>; depositoId: string; tipo: string; delta: string; custo: string; chave: string; refTipo?: string | null | undefined; refId?: string | null | undefined; notas?: unknown }): Promise<string> {
    return ((await q(`INSERT INTO ${T('movimento')} (tenant_id, item_id, produto_id, deposito_id, tipo, delta, custo_unitario, ref_tipo, ref_id, chave, notas, criado_por) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) RETURNING id::text AS id`,
      [tenantId, m.it.itemId, m.it.produtoId, m.depositoId, m.tipo, m.delta, m.custo, m.refTipo ?? null, m.refId ?? null, m.chave, m.notas == null ? null : String(m.notas).slice(0, 500), usuario])).rows[0] as { id: string }).id
  }
  /** a repetição da MESMA chamada devolve o movimento original; a mesma chave com outro conteúdo é 409 */
  async function jaFeito(q: Consulta, chave: string, tipo: string, depositoId: string, itemId: string, delta: string): Promise<Linha | null> {
    const r = (await q(`SELECT id::text AS id, item_id::text AS item, delta::text AS delta FROM ${T('movimento')} WHERE chave = $1 AND tipo = $2 AND deposito_id = $3`, [chave, tipo, depositoId])).rows[0] as Linha | undefined
    if (!r) return null
    if (r.item !== itemId || (delta !== '' && compara(r.delta as string, delta) !== 0)) throw new ErroApi(409, 'chave_reutilizada', 'esta chave já foi usada em outro movimento')
    return (await ler(q, 'movimento', r.id as string))!
  }

  const operacoes = {
    async entrada({ entrada, ctx, q }: EntradaOperacao): Promise<unknown> {
      const it = item(entrada), dep = uuid(entrada.depositoId, 'depositoId'), n = qtd(entrada.quantidade), custo = String(entrada.custoUnitario), chave = chaveOk(entrada.chave)
      if (!/^\d{1,15}(\.\d{1,4})?$/.test(custo)) throw bad('custoUnitario inválido')
      const ja = await jaFeito(q, chave, 'entrada', dep, it.itemId, n); if (ja) return ja
      await depositoAtivo(q, dep); const s = await saldoTravado(q, ctx.tenantId, it, dep)
      const novoCusto = custoMedio(s.quantidade, s.custo, n, custo)
      await q(`UPDATE ${T('saldo')} SET quantidade = $2, custo_medio = $3, atualizado_em = now() WHERE id = $1`, [s.id, adiciona(s.quantidade, n), novoCusto])
      return ler(q, 'movimento', await movimenta(q, ctx.tenantId, ctx.usuario ?? 'sistema', { it, depositoId: dep, tipo: 'entrada', delta: n, custo, chave, refTipo: entrada.refTipo as string | undefined, refId: entrada.refId as string | undefined, notas: entrada.notas }))
    },

    async saida({ entrada, ctx, q }: EntradaOperacao): Promise<unknown> {
      const it = item(entrada), dep = uuid(entrada.depositoId, 'depositoId'), n = qtd(entrada.quantidade), tipo = String(entrada.tipo), chave = chaveOk(entrada.chave)
      if (!(TIPOS_SAIDA as readonly string[]).includes(tipo)) throw bad(`tipo deve ser ${TIPOS_SAIDA.join(', ')}`)
      const ja = await jaFeito(q, chave, tipo, dep, it.itemId, `-${n}`); if (ja) return ja
      await depositoAtivo(q, dep); const s = await saldoTravado(q, ctx.tenantId, it, dep)
      if (compara(n, disponivel(s)) > 0) throw new ErroApi(422, 'estoque_insuficiente', `disponível ${disponivel(s)}, pedido ${n}`) // nunca saldo negativo (o reservado não se vende)
      await q(`UPDATE ${T('saldo')} SET quantidade = $2, atualizado_em = now() WHERE id = $1`, [s.id, subtrai(s.quantidade, n)])
      return ler(q, 'movimento', await movimenta(q, ctx.tenantId, ctx.usuario ?? 'sistema', { it, depositoId: dep, tipo, delta: `-${n}`, custo: s.custo, chave, notas: entrada.notas }))
    },

    async ajustar({ entrada, ctx, q }: EntradaOperacao): Promise<unknown> {
      const it = item(entrada), dep = uuid(entrada.depositoId, 'depositoId'), contada = qtd(entrada.quantidadeContada, 'quantidadeContada', true), chave = chaveOk(entrada.chave)
      const ja = await jaFeito(q, chave, 'ajuste', dep, it.itemId, ''); if (ja) return ja
      await depositoAtivo(q, dep); const s = await saldoTravado(q, ctx.tenantId, it, dep)
      if (compara(contada, s.reservado) < 0) throw new ErroApi(422, 'abaixo_do_reservado', `a contagem (${contada}) é menor que o reservado (${s.reservado}): libere reservas antes`)
      const delta = subtrai(contada, s.quantidade)
      await q(`UPDATE ${T('saldo')} SET quantidade = $2, atualizado_em = now() WHERE id = $1`, [s.id, contada])
      return ler(q, 'movimento', await movimenta(q, ctx.tenantId, ctx.usuario ?? 'sistema', { it, depositoId: dep, tipo: 'ajuste', delta, custo: s.custo, chave, refTipo: 'inventario', notas: entrada.notas }))
    },

    async transferir({ entrada, ctx, q }: EntradaOperacao): Promise<unknown> {
      const it = item(entrada), de = uuid(entrada.origemId, 'origemId'), para = uuid(entrada.destinoId, 'destinoId'), n = qtd(entrada.quantidade), chave = chaveOk(entrada.chave)
      if (de === para) throw bad('origem e destino devem ser diferentes')
      const ja = await jaFeito(q, chave, 'transferencia_saida', de, it.itemId, `-${n}`); if (ja) return ja
      await depositoAtivo(q, de); await depositoAtivo(q, para)
      const [a, b] = de < para ? [de, para] : [para, de] // trava SEMPRE na mesma ordem: duas transferências opostas não se bloqueiam
      const sa = await saldoTravado(q, ctx.tenantId, it, a), sb = await saldoTravado(q, ctx.tenantId, it, b)
      const so = de === a ? sa : sb, sd = de === a ? sb : sa
      if (compara(n, disponivel(so)) > 0) throw new ErroApi(422, 'estoque_insuficiente', `disponível ${disponivel(so)}, pedido ${n}`)
      await q(`UPDATE ${T('saldo')} SET quantidade = $2, atualizado_em = now() WHERE id = $1`, [so.id, subtrai(so.quantidade, n)])
      await q(`UPDATE ${T('saldo')} SET quantidade = $2, custo_medio = $3, atualizado_em = now() WHERE id = $1`, [sd.id, adiciona(sd.quantidade, n), custoMedio(sd.quantidade, sd.custo, n, so.custo)]) // o custo viaja com a mercadoria
      const out = await movimenta(q, ctx.tenantId, ctx.usuario ?? 'sistema', { it, depositoId: de, tipo: 'transferencia_saida', delta: `-${n}`, custo: so.custo, chave, refTipo: 'transferencia' })
      await movimenta(q, ctx.tenantId, ctx.usuario ?? 'sistema', { it, depositoId: para, tipo: 'transferencia_entrada', delta: n, custo: so.custo, chave, refTipo: 'transferencia' })
      return ler(q, 'movimento', out)
    },

    async reservar({ entrada, ctx, q }: EntradaOperacao): Promise<unknown> {
      const pedidoId = uuid(entrada.pedidoId, 'pedidoId'), minutos = entrada.validadeMinutos == null ? validadePadrao : Number(entrada.validadeMinutos)
      if (!Number.isInteger(minutos) || minutos < 1 || minutos > 7 * 24 * 60) throw bad('validadeMinutos inválida')
      const ja = (await q(`SELECT id::text AS id FROM ${T('reserva')} WHERE pedido_id = $1 FOR UPDATE`, [pedidoId])).rows[0] as { id: string } | undefined
      if (ja) return ler(q, 'reserva', ja.id) // repetição: a mesma reserva, sem reservar de novo
      if (!Array.isArray(entrada.itens) || entrada.itens.length < 1 || entrada.itens.length > 200) throw bad('itens: de 1 a 200')
      const juntos = new Map<string, { it: ReturnType<typeof item>; n: string }>()
      for (const x of entrada.itens as Array<Record<string, unknown>>) { if (!x || typeof x !== 'object') throw bad('item inválido'); const it = item(x), n = qtd(x.quantidade); const j = juntos.get(it.itemId); juntos.set(it.itemId, { it, n: j ? adiciona(j.n, n) : n }) }
      const dep = (await q(`SELECT id::text AS id FROM ${T('deposito')} WHERE padrao AND ativo LIMIT 1`)).rows[0] as { id: string } | undefined
      if (!dep) throw new ErroApi(422, 'sem_deposito_padrao', 'o tenant não tem um depósito padrão ativo')
      const ordem = [...juntos.values()].sort((a, b) => (a.it.itemId < b.it.itemId ? -1 : 1)) // ordem fixa de trava
      const faltas: string[] = []; const travados = new Map<string, { id: string; quantidade: string; reservado: string; custo: string }>()
      for (const { it, n } of ordem) { const s = await saldoTravado(q, ctx.tenantId, it, dep.id); travados.set(it.itemId, s); if (compara(n, disponivel(s)) > 0) faltas.push(`${it.itemId} (disponível ${disponivel(s)}, pedido ${n})`) }
      const rid = ((await q(`INSERT INTO ${T('reserva')} (tenant_id, pedido_id, status, motivo, expira_em) VALUES ($1, $2, $3, $4, now() + ($5 || ' minutes')::interval) RETURNING id::text AS id`,
        [ctx.tenantId, pedidoId, faltas.length ? 'recusada' : 'ativa', faltas.length ? `sem estoque: ${faltas.join('; ')}`.slice(0, 500) : null, String(minutos)])).rows[0] as { id: string }).id
      if (!faltas.length) for (const { it, n } of ordem) { // tudo ou nada: só reserva se TODOS os itens couberem
        await q(`INSERT INTO ${T('reserva_item')} (tenant_id, reserva_id, item_id, produto_id, deposito_id, quantidade) VALUES ($1, $2, $3, $4, $5, $6)`, [ctx.tenantId, rid, it.itemId, it.produtoId, dep.id, n])
        await q(`UPDATE ${T('saldo')} SET reservado = $2, atualizado_em = now() WHERE id = $1`, [travados.get(it.itemId)!.id, adiciona(travados.get(it.itemId)!.reservado, n)])
      }
      return ler(q, 'reserva', rid)
    },

    async liberar({ params, q }: EntradaOperacao): Promise<unknown> { return liberaReserva(q, params.id!) },

    async expirarReservas({ q }: EntradaOperacao): Promise<unknown> {
      const ids = (await q(`SELECT id::text AS id FROM ${T('reserva')} WHERE status = 'ativa' AND expira_em < now() ORDER BY expira_em, id LIMIT 500`)).rows as Array<{ id: string }>
      const out: unknown[] = []; for (const { id } of ids) out.push(await liberaReserva(q, id, 'expirada')); return out
    },

    async abaixoDoMinimo({ q }: EntradaOperacao): Promise<unknown> {
      return (await q(`SELECT ${colunas(ents.saldo!)} FROM ${T('saldo')} WHERE minimo IS NOT NULL AND quantidade - reservado <= minimo ORDER BY (quantidade - reservado), id LIMIT 500`)).rows.map((r) => linhaParaApi(ents.saldo!, r))
    },
  }

  async function liberaReserva(q: Consulta, id: string, motivo?: string): Promise<Linha> {
    const r = await ler(q, 'reserva', id, true); if (!r) throw new ErroApi(404, 'nao_encontrado', 'reserva não encontrada')
    if (r.status === 'liberada' || r.status === 'recusada') return r
    if (r.status !== 'ativa') throw new ErroApi(409, 'estado_invalido', `reserva ${r.status}: só se libera uma reserva ativa`)
    const itens = (await q(`SELECT item_id::text AS item, deposito_id::text AS dep, quantidade::text AS n FROM ${T('reserva_item')} WHERE reserva_id = $1 ORDER BY item_id`, [id])).rows as Array<{ item: string; dep: string; n: string }>
    for (const i of itens) { const s = (await q(`SELECT id::text AS id, reservado::text AS reservado FROM ${T('saldo')} WHERE item_id = $1 AND deposito_id = $2 FOR UPDATE`, [i.item, i.dep])).rows[0] as { id: string; reservado: string }; await q(`UPDATE ${T('saldo')} SET reservado = $2, atualizado_em = now() WHERE id = $1`, [s.id, subtrai(s.reservado, i.n)]) }
    await q(`UPDATE ${T('reserva')} SET status = 'liberada', motivo = $2, atualizado_em = now() WHERE id = $1`, [id, motivo ?? null])
    return (await ler(q, 'reserva', id))!
  }

  /** A baixa de um pedido CONFIRMADO (evento `pedido.confirmado`): a reserva vira saída de venda, com o custo médio do momento. Idempotente. */
  async function baixaDoPedido(q: Consulta, tenantId: string, pedidoId: string): Promise<void> {
    const r = (await q(`SELECT id::text AS id, status FROM ${T('reserva')} WHERE pedido_id = $1 FOR UPDATE`, [pedidoId])).rows[0] as { id: string; status: string } | undefined
    const divergente = async (motivo: string) => { if (r) await q(`UPDATE ${T('reserva')} SET status = 'divergente', motivo = $2, atualizado_em = now() WHERE id = $1`, [r.id, motivo]); else await q(`INSERT INTO ${T('reserva')} (tenant_id, pedido_id, status, motivo) VALUES ($1, $2, 'divergente', $3)`, [tenantId, pedidoId, motivo]) }
    if (r?.status === 'confirmada' || r?.status === 'divergente') return
    if (!r) return divergente('pedido confirmado sem reserva de estoque')
    const itens = (await q(`SELECT item_id::text AS item, produto_id::text AS produto, deposito_id::text AS dep, quantidade::text AS n FROM ${T('reserva_item')} WHERE reserva_id = $1 ORDER BY item_id`, [r.id])).rows as Array<{ item: string; produto: string; dep: string; n: string }>
    const ativa = r.status === 'ativa'
    const travados = new Map<string, { id: string; quantidade: string; reservado: string; custo: string }>()
    for (const i of itens) travados.set(i.item, (await q(`SELECT id::text AS id, quantidade::text AS quantidade, reservado::text AS reservado, custo_medio::text AS custo FROM ${T('saldo')} WHERE item_id = $1 AND deposito_id = $2 FOR UPDATE`, [i.item, i.dep])).rows[0] as never)
    if (!ativa) { // a reserva expirou/foi liberada antes da confirmação: só baixa se AINDA houver estoque livre para tudo; senão registra a venda sem estoque (divergência para o time)
      if (r.status === 'recusada' || itens.some((i) => compara(i.n, disponivel(travados.get(i.item)!)) > 0)) return divergente('venda confirmada sem estoque (reserva expirada ou recusada)')
    }
    for (const i of itens) {
      const s = travados.get(i.item)!
      await q(`UPDATE ${T('saldo')} SET quantidade = $2, reservado = $3, atualizado_em = now() WHERE id = $1`, [s.id, subtrai(s.quantidade, i.n), ativa ? subtrai(s.reservado, i.n) : s.reservado])
      await movimenta(q, tenantId, 'sistema', { it: { produtoId: i.produto, varianteId: null, itemId: i.item }, depositoId: i.dep, tipo: 'venda', delta: `-${i.n}`, custo: s.custo, chave: `pedido-${pedidoId}`, refTipo: 'pedido', refId: pedidoId })
    }
    await q(`UPDATE ${T('reserva')} SET status = 'confirmada', motivo = $2, atualizado_em = now() WHERE id = $1`, [r.id, ativa ? null : 'reserva expirada: baixa direta'])
  }

  const consumidor = (db: DbTenant) => criaConsumidor({ db, servico: 'estoque', consumidor: 'baixa-pedido', tipos: ['pedido.confirmado'], handler: async (env, q) => { await baixaDoPedido(q, env.tenantId, String(env.payload.pedidoId)) } })
  return { operacoes, consumidor, baixaDoPedido }
}

export type ClienteEstoque = { chama(tenantId: string, metodo: 'POST', caminho: string, corpo: unknown): Promise<{ status: number; corpo: any }> }

/** Liga a saga de Vendas ao serviço Estoque. Sem estoque = recusa (`ok:false`, a saga compensa); 5xx/rede = lança (a saga repete). */
export function portaEstoque(c: ClienteEstoque): Portas['estoque'] {
  const falha = (r: { status: number }) => { if (r.status >= 500) throw new Error(`estoque indisponível (${r.status})`) }
  return {
    reserva: async (p: PedidoSaga): Promise<Resultado> => {
      const r = await c.chama(p.tenantId, 'POST', '/reservas', { pedidoId: p.pedidoId, itens: p.itens.map((i) => ({ produtoId: i.produtoId, ...(i.varianteId ? { varianteId: i.varianteId } : {}), quantidade: i.quantidade })) })
      falha(r)
      if (r.status >= 400) return { ok: false, motivo: String(r.corpo?.erro?.mensagem ?? `estoque recusou (${r.status})`).slice(0, 300) }
      return r.corpo.status === 'ativa' ? { ok: true, referencia: r.corpo.id } : { ok: false, motivo: String(r.corpo.motivo ?? `reserva ${r.corpo.status}`).slice(0, 300) }
    },
    libera: async (p, ref) => { falha(await c.chama(p.tenantId, 'POST', `/reservas/${ref}/liberar`, {})) },
  }
}
