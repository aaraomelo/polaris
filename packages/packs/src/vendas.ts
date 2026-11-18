import { criaConsumidor, criaPublicador, type DbTenant, type Publicador } from '@polaris/eventos'
import type { No } from '@polaris/schema'
import { ErroApi, colunas, linhaParaApi, tabela, type Consulta, type Contexto, type EntradaOperacao } from '@polaris/servico'
import { multiplica, soma } from './dinheiro'

// Pack Vendas: carrinho → pedido → saga (estoque → autorização → captura), com compensação.
// Os OUTROS domínios entram por PORTAS (interfaces): o pack não conhece o Estoque nem os Pagamentos, só o contrato. Toda porta que causa efeito externo PRECISA
// ser idempotente pela chave (`pedidoId`): a saga pode repetir um passo (queda depois do efeito, antes de confirmar) e isso nunca deve duplicar nada.

export type Cotacao = { id: string; produtoId: string; varianteId: string | null; quantidade: string; precoUnitario: string; criadoEm: string }
export type ItemSaga = { produtoId: string; varianteId: string | null; quantidade: string }
export type PedidoSaga = { tenantId: string; pedidoId: string; total: string; metodoPagamento: string; parcelas: number; itens: ItemSaga[] }
export type Resultado = { ok: true; referencia: string } | { ok: false; motivo: string }

export type Portas = {
  catalogo: { /** a cotação (do tenant do contexto) ou null. Nunca confie num preço que veio do cliente. */ cotacao(ctx: Contexto, id: string): Promise<Cotacao | null> }
  estoque: { reserva(p: PedidoSaga): Promise<Resultado>; libera(p: PedidoSaga, referencia: string): Promise<void> }
  pagamento: { autoriza(p: PedidoSaga): Promise<Resultado>; cancela(p: PedidoSaga, referencia: string): Promise<void>; captura(p: PedidoSaga, referencia: string): Promise<Resultado> }
}
export type OpcoesVendas = { portas: Portas; eventos: Record<string, No>; /** validade de uma cotação em ms (padrão 30 min) */ validadeCotacaoMs?: number; agora?: () => number }

type Linha = Record<string, unknown>
const PASSOS = ['estoque', 'autorizacao', 'captura'] as const

export function criaVendas(no: No, o: OpcoesVendas) {
  const ents = (no.spec as { entidades: Record<string, never> }).entidades
  const publicador: Publicador = criaPublicador('vendas', o.eventos)
  const agora = o.agora ?? Date.now, validade = o.validadeCotacaoMs ?? 30 * 60_000
  const T = (e: string) => tabela('vendas', e)
  const ler = async (q: Consulta, ent: string, id: string, bloqueia = false): Promise<Linha | undefined> => {
    const r = (await q(`SELECT ${colunas(ents[ent]!)} FROM ${T(ent)} WHERE id = $1${bloqueia ? ' FOR UPDATE' : ''}`, [id])).rows[0]
    return r && linhaParaApi(ents[ent]!, r) // o formato da API (null some do JSON, decimal vira número), igual ao do CRUD
  }
  const sujeito = (e: string) => `vendas.${e}`

  /** A saga, retomável: lê o estado, pula o que já deu certo, compensa em ordem inversa se um passo recusa. Roda na transação de `q` (a do consumidor ou a da rota). */
  async function processaPedido(q: Consulta, tenantId: string, pedidoId: string, traceparent?: string): Promise<Linha> {
    const p = await ler(q, 'pedido', pedidoId, true)
    if (!p) throw new ErroApi(404, 'nao_encontrado', 'pedido não encontrado')
    if (p.status !== 'criado' && p.status !== 'processando') return p // confirmado, falhou ou cancelado: reprocessar não faz nada (idempotente)
    await q(`UPDATE ${T('pedido')} SET status = 'processando', atualizado_em = now() WHERE id = $1`, [pedidoId])
    const itens = (await q(`SELECT produto_id::text AS "produtoId", variante_id::text AS "varianteId", quantidade::text AS quantidade FROM ${T('item_pedido')} WHERE pedido_id = $1 ORDER BY criado_em, id`, [pedidoId])).rows as unknown as ItemSaga[]
    const ped: PedidoSaga = { tenantId, pedidoId, total: p.total as string, metodoPagamento: p.metodoPagamento as string, parcelas: Number(p.parcelas ?? 1), itens }
    const feitos = new Map<string, string>(((await q(`SELECT passo, referencia FROM ${T('passo_saga')} WHERE pedido_id = $1 AND estado = 'ok'`, [pedidoId])).rows as Linha[]).map((r) => [r.passo as string, r.referencia as string]))
    const grava = (passo: string, estado: string, referencia: string | null, detalhe: string | null) => q(
      `INSERT INTO ${T('passo_saga')} (tenant_id, pedido_id, passo, estado, referencia, detalhe) VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (tenant_id, pedido_id, passo) DO UPDATE SET estado = EXCLUDED.estado, referencia = EXCLUDED.referencia, detalhe = EXCLUDED.detalhe, atualizado_em = now()`, [tenantId, pedidoId, passo, estado, referencia, detalhe])
    const faz: Record<(typeof PASSOS)[number], () => Promise<Resultado>> = {
      estoque: () => o.portas.estoque.reserva(ped),
      autorizacao: () => o.portas.pagamento.autoriza(ped),
      captura: () => o.portas.pagamento.captura(ped, feitos.get('autorizacao')!),
    }
    // o que desfaz cada passo (a captura não se desfaz aqui: o estorno é do pack Pagamentos)
    const desfaz: Partial<Record<(typeof PASSOS)[number], (ref: string) => Promise<void>>> = {
      estoque: (r) => o.portas.estoque.libera(ped, r), autorizacao: (r) => o.portas.pagamento.cancela(ped, r),
    }
    let motivo: string | null = null
    for (const passo of PASSOS) {
      if (feitos.has(passo)) continue
      const r = await faz[passo]() // uma exceção aqui (rede, timeout) NÃO é recusa: sobe, a transação desfaz e a entrega é repetida
      if (r.ok) { feitos.set(passo, r.referencia); await grava(passo, 'ok', r.referencia, null) } else { await grava(passo, 'falhou', null, r.motivo.slice(0, 500)); motivo = `${passo}: ${r.motivo}`.slice(0, 500); break }
    }
    if (motivo === null) {
      await q(`UPDATE ${T('pedido')} SET status = 'confirmado', motivo_falha = NULL, atualizado_em = now() WHERE id = $1`, [pedidoId])
      await publicador.publicar(q, tenantId, 'pedido.confirmado', { pedidoId, total: p.total }, traceparent)
    } else {
      for (const passo of [...PASSOS].reverse()) { // compensa o que deu certo, do último para o primeiro
        const ref = feitos.get(passo); const d = desfaz[passo]
        if (ref === undefined || !d) continue
        await d(ref); await grava(passo, 'compensado', ref, null)
      }
      await q(`UPDATE ${T('pedido')} SET status = 'falhou', motivo_falha = $2, atualizado_em = now() WHERE id = $1`, [pedidoId, motivo])
      await publicador.publicar(q, tenantId, 'pedido.falhou', { pedidoId, motivo }, traceparent)
    }
    return (await ler(q, 'pedido', pedidoId))!
  }

  const operacoes = {
    async adicionarItem({ params, entrada, ctx, q, pode }: EntradaOperacao): Promise<unknown> {
      const c = await ler(q, 'carrinho', params.id!, true); if (!c) throw new ErroApi(404, 'nao_encontrado', 'carrinho não encontrado')
      if (!pode('adicionarItem', sujeito('itemCarrinho'), { criadoPor: c.criadoPor })) throw new ErroApi(404, 'nao_encontrado', 'carrinho não encontrado') // não revela o que não é seu
      if (c.status !== 'aberto') throw new ErroApi(409, 'carrinho_fechado', 'o carrinho já foi finalizado')
      const cot = await o.portas.catalogo.cotacao(ctx, String(entrada.cotacaoId))
      if (!cot) throw new ErroApi(422, 'cotacao_invalida', 'cotação inexistente')
      if (agora() - Date.parse(cot.criadoEm) > validade) throw new ErroApi(422, 'cotacao_expirada', 'a cotação expirou: peça uma nova')
      const qtd = String(cot.quantidade) // a API do Catálogo entrega `decimal` como número JSON; o contrato da porta aceita os dois
      const total = multiplica(cot.precoUnitario, qtd)
      const r = await q(`INSERT INTO ${T('item_carrinho')} (tenant_id, carrinho_id, criado_por, cotacao_id, produto_id, variante_id, quantidade, preco_unitario, total_linha) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id::text AS id`,
        [ctx.tenantId, c.id, c.criadoPor, cot.id, cot.produtoId, cot.varianteId ?? null, qtd, cot.precoUnitario, total])
      return ler(q, 'itemCarrinho', (r.rows[0] as { id: string }).id)
    },

    async finalizar({ params, entrada, ctx, q, pode, publica }: EntradaOperacao): Promise<unknown> {
      const c = await ler(q, 'carrinho', params.id!, true); if (!c) throw new ErroApi(404, 'nao_encontrado', 'carrinho não encontrado')
      if (!pode('finalizar', sujeito('pedido'), { criadoPor: c.criadoPor })) throw new ErroApi(404, 'nao_encontrado', 'carrinho não encontrado')
      const chave = String(entrada.chaveIdempotencia)
      if (chave.length < 8 || chave.length > 120) throw new ErroApi(400, 'entrada_invalida', 'chaveIdempotencia deve ter de 8 a 120 caracteres')
      const ja = (await q(`SELECT id::text AS id, carrinho_id::text AS "carrinhoId" FROM ${T('pedido')} WHERE chave_idempotencia = $1`, [chave])).rows[0] as Linha | undefined
      if (ja) { // repetição da mesma chamada: devolve o MESMO pedido, sem criar outro
        if (ja.carrinhoId !== c.id) throw new ErroApi(409, 'chave_reutilizada', 'esta chave de idempotência já foi usada em outro carrinho')
        return ler(q, 'pedido', ja.id as string)
      }
      if (c.status !== 'aberto') throw new ErroApi(409, 'carrinho_fechado', 'o carrinho já foi finalizado')
      const itens = (await q(`SELECT cotacao_id::text AS "cotacaoId", produto_id::text AS "produtoId", variante_id::text AS "varianteId", quantidade::text AS quantidade, preco_unitario::text AS "precoUnitario", total_linha::text AS "totalLinha" FROM ${T('item_carrinho')} WHERE carrinho_id = $1 ORDER BY criado_em, id`, [c.id])).rows as Linha[]
      if (!itens.length) throw new ErroApi(422, 'carrinho_vazio', 'o carrinho não tem itens')
      const total = soma(itens.map((i) => i.totalLinha as string))
      const ped = await q(`INSERT INTO ${T('pedido')} (tenant_id, carrinho_id, criado_por, chave_idempotencia, status, total, metodo_pagamento, parcelas) VALUES ($1, $2, $3, $4, 'criado', $5, $6, $7) RETURNING id::text AS id`, [ctx.tenantId, c.id, c.criadoPor, chave, total, c.metodoPagamento, c.parcelas ?? 1])
      const pedidoId = (ped.rows[0] as { id: string }).id
      for (const i of itens) await q(`INSERT INTO ${T('item_pedido')} (tenant_id, pedido_id, criado_por, produto_id, variante_id, cotacao_id, quantidade, preco_unitario, total_linha) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [ctx.tenantId, pedidoId, c.criadoPor, i.produtoId, i.varianteId, i.cotacaoId, i.quantidade, i.precoUnitario, i.totalLinha])
      await q(`UPDATE ${T('carrinho')} SET status = 'finalizado', atualizado_em = now() WHERE id = $1`, [c.id])
      await publica('pedido.criado', { pedidoId, total }) // mesma transação: o pedido e o evento nascem juntos ou nenhum dos dois
      return ler(q, 'pedido', pedidoId)
    },

    async cancelar({ params, q, pode }: EntradaOperacao): Promise<unknown> {
      const p = await ler(q, 'pedido', params.id!, true)
      if (!p || !pode('cancelar', sujeito('pedido'), p)) throw new ErroApi(404, 'nao_encontrado', 'pedido não encontrado')
      if (p.status === 'cancelado') return p
      if (p.status !== 'criado' && p.status !== 'falhou') throw new ErroApi(409, 'nao_cancelavel', `pedido ${p.status}: só se cancela antes do processamento (o estorno de pedido pago é do pack Pagamentos)`)
      await q(`UPDATE ${T('pedido')} SET status = 'cancelado', atualizado_em = now() WHERE id = $1`, [params.id])
      return ler(q, 'pedido', params.id!)
    },

    async processar({ params, ctx, q, pode }: EntradaOperacao): Promise<unknown> {
      if (!pode('processar', sujeito('pedido'))) throw new ErroApi(403, 'proibido', 'sem permissão')
      return processaPedido(q, ctx.tenantId, params.id!)
    },
  }

  /** O consumidor de `pedido.criado`: dispara a saga numa transação do tenant, com a marca de inbox (efeito uma vez, mesmo com entrega repetida). */
  const consumidor = (db: DbTenant) => criaConsumidor({
    db, servico: 'vendas', consumidor: 'saga-pedido', tipos: ['pedido.criado'],
    handler: async (env, q) => { await processaPedido(q, env.tenantId, String(env.payload.pedidoId), env.traceparent) },
  })

  return { operacoes, processaPedido, consumidor }
}
