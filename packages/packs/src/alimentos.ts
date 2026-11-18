import type { No } from '@polaris/schema'
import { ErroApi, colunas, linhaParaApi, tabela, type Consulta, type EntradaOperacao } from '@polaris/servico'
import { compara, divideConta, multiplica, percentual, soma, subtrai } from './dinheiro'

// Pack Alimentos: cardápio com modificadores, comanda (mesa, balcão, entrega), fila da cozinha (KDS) por estação, fechamento, divisão de conta e despacho.
// O item lançado guarda uma FOTO do nome, preço e modificadores do momento: mudar o cardápio depois não altera a comanda aberta.

type Linha = Record<string, unknown>
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const TIPOS = ['mesa', 'balcao', 'entrega']
const DINHEIRO = /^\d{1,15}(\.\d{1,4})?$/

export function criaAlimentos(no: No) {
  const ents = (no.spec as { entidades: Record<string, never> }).entidades
  const T = (e: string) => tabela('alimentos', e)
  const ler = async (q: Consulta, ent: string, id: string, bloqueia = false): Promise<Linha | undefined> => {
    const r = (await q(`SELECT ${colunas(ents[ent]!)} FROM ${T(ent)} WHERE id = $1${bloqueia ? ' FOR UPDATE' : ''}`, [id])).rows[0]
    return r && linhaParaApi(ents[ent]!, r)
  }
  const bad = (m: string) => new ErroApi(400, 'entrada_invalida', m)
  const nf = (x: string) => new ErroApi(404, 'nao_encontrado', `${x} não encontrado`)
  const dinheiro = (v: unknown, nome: string): string => { const s = String(v ?? '0'); if (!DINHEIRO.test(s)) throw bad(`${nome} inválido`); return s }
  const proximo = async (q: Consulta, tenantId: string): Promise<number> =>
    Number(((await q(`INSERT INTO ${T('sequencia')} (tenant_id, nome, valor) VALUES ($1, 'comanda', 1) ON CONFLICT (tenant_id, nome) DO UPDATE SET valor = ${T('sequencia')}.valor + 1, atualizado_em = now() RETURNING valor`, [tenantId])).rows[0] as { valor: number }).valor)
  const comandaAberta = async (q: Consulta, id: string): Promise<Linha> => {
    const c = await ler(q, 'comanda', id, true); if (!c) throw nf('comanda')
    if (c.status !== 'aberta') throw new ErroApi(409, 'comanda_fechada', `comanda ${c.status}: não aceita mais alterações`)
    return c
  }
  const itensAtivos = async (q: Consulta, comandaId: string) => (await q(`SELECT id::text AS id, status, total::text AS total FROM ${T('item_comanda')} WHERE comanda_id = $1 AND status <> 'cancelado'`, [comandaId])).rows as Array<{ id: string; status: string; total: string }>
  const recalcula = async (q: Consulta, id: string): Promise<void> => { // o subtotal sempre sai dos itens vivos
    const sub = soma(['0', ...(await itensAtivos(q, id)).map((i) => i.total)]); await q(`UPDATE ${T('comanda')} SET subtotal = $2, total = $2, atualizado_em = now() WHERE id = $1`, [id, sub])
  }
  /** a máquina de estado de UM item da cozinha: só as transições do papel que a chama */
  async function transicao(q: Consulta, id: string, de: string, para: string, extra: string): Promise<Linha> {
    const i = await ler(q, 'itemComanda', id, true); if (!i) throw nf('item')
    if (i.status === para) return i // repetir é no-op
    if (i.status !== de) throw new ErroApi(409, 'transicao_invalida', `item ${i.status}: só se vai para ${para} a partir de ${de}`)
    await q(`UPDATE ${T('item_comanda')} SET status = $2${extra}, atualizado_em = now() WHERE id = $1`, [id, para]); return (await ler(q, 'itemComanda', id))!
  }

  const operacoes = {
    async abrirComanda({ entrada, ctx, q }: EntradaOperacao): Promise<unknown> {
      const tipo = String(entrada.tipo); if (!TIPOS.includes(tipo)) throw bad(`tipo deve ser ${TIPOS.join(', ')}`)
      let mesa: string | null = null, endereco: string | null = null; const taxaEntrega = dinheiro(entrada.taxaEntrega, 'taxaEntrega')
      if (tipo === 'mesa') {
        mesa = entrada.mesaId == null ? null : String(entrada.mesaId); if (!mesa || !UUID.test(mesa)) throw bad('comanda de mesa exige mesaId')
        const m = (await q(`SELECT ativo FROM ${T('mesa')} WHERE id = $1 FOR UPDATE`, [mesa])).rows[0] as { ativo: boolean } | undefined // a trava da mesa serializa quem tenta abri-la
        if (!m) throw nf('mesa'); if (!m.ativo) throw new ErroApi(409, 'mesa_inativa', 'mesa desativada')
        if ((await q(`SELECT 1 FROM ${T('comanda')} WHERE mesa_id = $1 AND status = 'aberta'`, [mesa])).rows.length) throw new ErroApi(409, 'mesa_ocupada', 'a mesa já tem uma comanda aberta')
      } else if (entrada.mesaId != null) throw bad('só comanda de mesa leva mesaId')
      if (tipo === 'entrega') { endereco = String(entrada.enderecoEntrega ?? '').trim(); if (!endereco) throw bad('entrega exige enderecoEntrega') } else if (compara(taxaEntrega, '0') > 0 || entrada.enderecoEntrega != null) throw bad('taxa e endereço de entrega só valem para entrega')
      const n = await proximo(q, ctx.tenantId)
      const id = ((await q(`INSERT INTO ${T('comanda')} (tenant_id, numero, tipo, mesa_id, cliente_id, status, endereco_entrega, taxa_entrega, status_entrega, subtotal, taxa_servico, desconto, total, aberta_por) VALUES ($1, $2, $3, $4, $5, 'aberta', $6, $7, $8, 0, 0, 0, 0, $9) RETURNING id::text AS id`,
        [ctx.tenantId, n, tipo, mesa, entrada.clienteId ?? null, endereco, taxaEntrega, tipo === 'entrega' ? 'aguardando' : null, ctx.usuario ?? 'desconhecido'])).rows[0] as { id: string }).id
      return ler(q, 'comanda', id)
    },

    async lancarItem({ params, entrada, ctx, q }: EntradaOperacao): Promise<unknown> {
      const c = await comandaAberta(q, params.id!)
      const qtd = Number(entrada.quantidade); if (!Number.isInteger(qtd) || qtd < 1 || qtd > 99) throw bad('quantidade deve ser de 1 a 99')
      const it = (await q(`SELECT id::text AS id, nome, estacao, preco::text AS preco, disponivel FROM ${T('item')} WHERE id = $1`, [entrada.itemId])).rows[0] as { id: string; nome: string; estacao: string; preco: string; disponivel: boolean } | undefined
      if (!it) throw nf('item do cardápio'); if (!it.disponivel) throw new ErroApi(422, 'indisponivel', `${it.nome} está indisponível`)
      const escolhidas = entrada.modificadores == null ? [] : entrada.modificadores; if (!Array.isArray(escolhidas) || escolhidas.length > 50 || escolhidas.some((x) => typeof x !== 'string' || !UUID.test(x))) throw bad('modificadores: lista de ids de opção')
      if (new Set(escolhidas).size !== escolhidas.length) throw bad('opção repetida')
      const grupos = (await q(`SELECT g.id::text AS id, g.nome, g.minimo, g.maximo FROM ${T('item_grupo')} ig JOIN ${T('grupo_modificador')} g ON g.id = ig.grupo_id AND g.tenant_id = ig.tenant_id WHERE ig.item_id = $1`, [it.id])).rows as Array<{ id: string; nome: string; minimo: number; maximo: number | null }>
      const opcoes = escolhidas.length ? (await q(`SELECT id::text AS id, grupo_id::text AS grupo, nome, acrescimo::text AS acrescimo, ativo FROM ${T('opcao')} WHERE id = ANY($1::uuid[])`, [escolhidas])).rows as Array<{ id: string; grupo: string; nome: string; acrescimo: string; ativo: boolean }> : []
      if (opcoes.length !== escolhidas.length) throw new ErroApi(422, 'opcao_invalida', 'opção inexistente')
      for (const o of opcoes) { if (!grupos.some((g) => g.id === o.grupo)) throw new ErroApi(422, 'opcao_invalida', `a opção '${o.nome}' não pertence a este item`); if (!o.ativo) throw new ErroApi(422, 'indisponivel', `a opção '${o.nome}' está indisponível`) }
      for (const g of grupos) { // mínimo e máximo POR GRUPO ("ponto da carne": exatamente 1; "adicionais": até 3)
        const n = opcoes.filter((o) => o.grupo === g.id).length
        if (n < Number(g.minimo)) throw new ErroApi(422, 'modificador_obrigatorio', `escolha ao menos ${g.minimo} em '${g.nome}'`)
        if (g.maximo != null && n > Number(g.maximo)) throw new ErroApi(422, 'modificador_excedido', `escolha no máximo ${g.maximo} em '${g.nome}'`)
      }
      const unit = soma([it.preco, ...opcoes.map((o) => o.acrescimo)]), total = multiplica(unit, String(qtd))
      const id = ((await q(`INSERT INTO ${T('item_comanda')} (tenant_id, comanda_id, item_id, nome, estacao, quantidade, preco_base, modificadores, total, observacao, status) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, 'novo') RETURNING id::text AS id`,
        [ctx.tenantId, c.id, it.id, it.nome, it.estacao, qtd, it.preco, JSON.stringify(opcoes.map((o) => ({ opcaoId: o.id, nome: o.nome, acrescimo: o.acrescimo }))), total, entrada.observacao == null ? null : String(entrada.observacao).slice(0, 300)])).rows[0] as { id: string }).id
      await recalcula(q, c.id as string); return ler(q, 'itemComanda', id)
    },

    async cancelarItem({ params, entrada, q, pode }: EntradaOperacao): Promise<unknown> {
      const i = await ler(q, 'itemComanda', params.id!, true); if (!i) throw nf('item')
      if (!pode('cancelarItem', 'alimentos.itemComanda', i)) throw new ErroApi(403, 'proibido', 'depois de começar o preparo, só o gerente cancela')
      if (i.status === 'cancelado') return i
      if (i.status === 'entregue') throw new ErroApi(409, 'transicao_invalida', 'item já entregue: o ajuste é desconto na conta')
      const motivo = String(entrada.motivo ?? '').trim(); if (!motivo) throw bad('informe o motivo')
      await comandaAberta(q, i.comandaId as string)
      await q(`UPDATE ${T('item_comanda')} SET status = 'cancelado', motivo_cancelamento = $2, atualizado_em = now() WHERE id = $1`, [i.id, motivo.slice(0, 300)]); await recalcula(q, i.comandaId as string); return ler(q, 'itemComanda', i.id as string)
    },
    iniciarPreparo: ({ params, q }: EntradaOperacao) => transicao(q, params.id!, 'novo', 'em_preparo', ', preparo_iniciado_em = now()'),
    marcarPronto: ({ params, q }: EntradaOperacao) => transicao(q, params.id!, 'em_preparo', 'pronto', ', pronto_em = now()'),
    entregarItem: ({ params, q }: EntradaOperacao) => transicao(q, params.id!, 'pronto', 'entregue', ''),

    /** KDS: o que a estação precisa fazer agora, do mais antigo para o mais novo */
    async fila({ entrada, q }: EntradaOperacao): Promise<unknown> {
      const estacao = String(entrada.estacao ?? '').trim(); if (!estacao) throw bad('informe a estação')
      return (await q(`SELECT ${colunas(ents.itemComanda!)} FROM ${T('item_comanda')} i WHERE estacao = $1 AND status IN ('novo', 'em_preparo') AND EXISTS (SELECT 1 FROM ${T('comanda')} c WHERE c.id = i.comanda_id AND c.status = 'aberta') ORDER BY criado_em, id LIMIT 200`, [estacao])).rows.map((r) => linhaParaApi(ents.itemComanda!, r))
    },

    async fecharComanda({ params, entrada, q, publica }: EntradaOperacao): Promise<unknown> {
      const c0 = await ler(q, 'comanda', params.id!, true); if (!c0) throw nf('comanda'); if (c0.status === 'fechada') return c0
      const c = await comandaAberta(q, params.id!); const itens = await itensAtivos(q, c.id as string)
      if (!itens.length) throw new ErroApi(422, 'comanda_vazia', 'a comanda não tem itens')
      const ok = c.tipo === 'entrega' ? ['pronto', 'entregue'] : ['entregue']; const pend = itens.filter((i) => !ok.includes(i.status))
      if (pend.length) throw new ErroApi(422, 'itens_pendentes', `${pend.length} item(ns) ainda não ${c.tipo === 'entrega' ? 'ficaram prontos' : 'foram entregues'}`)
      if (c.tipo === 'entrega' && c.statusEntrega !== 'entregue') throw new ErroApi(422, 'entrega_pendente', 'a entrega ainda não foi confirmada')
      const pct = entrada.taxaServicoPercentual == null ? (c.tipo === 'mesa' ? '10' : '0') : String(entrada.taxaServicoPercentual); const desconto = dinheiro(entrada.desconto, 'desconto')
      if (!/^\d{1,3}(\.\d{1,4})?$/.test(pct) || compara(pct, '100') > 0) throw bad('taxaServicoPercentual inválida (0 a 100)')
      const sub = soma(itens.map((i) => i.total)), servico = percentual(sub, pct), bruto = soma([sub, servico, c.taxaEntrega as string]), total = subtrai(bruto, desconto)
      if (compara(total, '0') < 0) throw new ErroApi(422, 'desconto_maior_que_total', 'o desconto excede o total da conta')
      await q(`UPDATE ${T('comanda')} SET status = 'fechada', subtotal = $2, taxa_servico = $3, desconto = $4, total = $5, fechada_em = now(), atualizado_em = now() WHERE id = $1`, [c.id, sub, servico, desconto, total])
      await publica('comanda.fechada', { comandaId: c.id as string, total, tipo: c.tipo as string }); return ler(q, 'comanda', c.id as string)
    },

    async cancelarComanda({ params, q }: EntradaOperacao): Promise<unknown> {
      const c0 = await ler(q, 'comanda', params.id!, true); if (!c0) throw nf('comanda'); if (c0.status === 'cancelada') return c0
      const c = await comandaAberta(q, params.id!)
      if ((await itensAtivos(q, c.id as string)).some((i) => i.status !== 'novo')) throw new ErroApi(409, 'itens_em_andamento', 'há itens em preparo ou entregues: cancele-os antes (o gerente) ou feche a conta')
      await q(`UPDATE ${T('item_comanda')} SET status = 'cancelado', motivo_cancelamento = 'comanda cancelada' WHERE comanda_id = $1 AND status = 'novo'`, [c.id])
      await q(`UPDATE ${T('comanda')} SET status = 'cancelada', subtotal = 0, total = 0, atualizado_em = now() WHERE id = $1`, [c.id]); return ler(q, 'comanda', c.id as string)
    },

    /** divide a conta fechada em N partes que SOMAM exatamente o total (o resto de centavos vai para as primeiras) */
    async dividirConta({ params, entrada, ctx, q }: EntradaOperacao): Promise<unknown> {
      const c = await ler(q, 'comanda', params.id!, true); if (!c) throw nf('comanda'); if (c.status !== 'fechada') throw new ErroApi(409, 'comanda_aberta', 'só se divide uma conta fechada')
      const n = Number(entrada.partes); if (!Number.isInteger(n) || n < 2 || n > 50) throw bad('partes: de 2 a 50')
      if ((await q(`SELECT 1 FROM ${T('parte_conta')} WHERE comanda_id = $1 AND paga LIMIT 1`, [c.id])).rows.length) throw new ErroApi(409, 'parte_paga', 'já há parte paga: não se refaz a divisão')
      await q(`DELETE FROM ${T('parte_conta')} WHERE comanda_id = $1`, [c.id]) // redividir antes de pagar substitui a divisão anterior
      const valores = divideConta(c.total as string, n)
      for (const [i, v] of valores.entries()) await q(`INSERT INTO ${T('parte_conta')} (tenant_id, comanda_id, indice, valor, paga) VALUES ($1, $2, $3, $4, false)`, [ctx.tenantId, c.id, i + 1, v])
      return (await q(`SELECT ${colunas(ents.parteConta!)} FROM ${T('parte_conta')} WHERE comanda_id = $1 ORDER BY indice`, [c.id])).rows.map((r) => linhaParaApi(ents.parteConta!, r))
    },

    async despachar({ params, entrada, q }: EntradaOperacao): Promise<unknown> {
      const c = await comandaAberta(q, params.id!); if (c.tipo !== 'entrega') throw new ErroApi(409, 'nao_e_entrega', 'só comanda de entrega é despachada')
      if (c.statusEntrega === 'saiu') return c
      if (c.statusEntrega !== 'aguardando') throw new ErroApi(409, 'transicao_invalida', `entrega ${c.statusEntrega}`)
      const itens = await itensAtivos(q, c.id as string); if (!itens.length) throw new ErroApi(422, 'comanda_vazia', 'a comanda não tem itens')
      if (itens.some((i) => i.status !== 'pronto' && i.status !== 'entregue')) throw new ErroApi(422, 'itens_pendentes', 'há itens que ainda não ficaram prontos')
      const entregador = String(entrada.entregador ?? '').trim(); if (!entregador) throw bad('informe o entregador')
      await q(`UPDATE ${T('comanda')} SET status_entrega = 'saiu', entregador = $2, atualizado_em = now() WHERE id = $1`, [c.id, entregador.slice(0, 100)]); return ler(q, 'comanda', c.id as string)
    },
    async confirmarEntrega({ params, q }: EntradaOperacao): Promise<unknown> {
      const c = await comandaAberta(q, params.id!); if (c.tipo !== 'entrega') throw new ErroApi(409, 'nao_e_entrega', 'só comanda de entrega tem entrega')
      if (c.statusEntrega === 'entregue') return c
      if (c.statusEntrega !== 'saiu') throw new ErroApi(409, 'transicao_invalida', 'a entrega ainda não saiu')
      await q(`UPDATE ${T('item_comanda')} SET status = 'entregue', atualizado_em = now() WHERE comanda_id = $1 AND status = 'pronto'`, [c.id]) // com o cliente: os itens prontos contam como entregues
      await q(`UPDATE ${T('comanda')} SET status_entrega = 'entregue', atualizado_em = now() WHERE id = $1`, [c.id]); return ler(q, 'comanda', c.id as string)
    },
  }
  return { operacoes }
}
