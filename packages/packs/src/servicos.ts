import type { No } from '@polaris/schema'
import { ErroApi, colunas, linhaParaApi, tabela, type Consulta, type EntradaOperacao } from '@polaris/servico'
import { compara, multiplica, soma, subtrai } from './dinheiro'

// Pack Serviços: agenda sem conflito por recurso, orçamento → ordem de serviço, garantia. Totais em dinheiro exato; máquinas de estado explícitas;
// toda transição é validada e idempotente quando repetida. A conclusão da OS publica `os.concluida` (o Estoque baixa as peças).

type Linha = Record<string, unknown>
const OS_ABERTAS = ['aberta', 'em_andamento', 'aguardando_peca', 'aguardando_cliente']
const OS_DE: Record<string, string[]> = {
  aberta: ['em_andamento', 'cancelada'], em_andamento: ['aguardando_peca', 'aguardando_cliente', 'concluida', 'cancelada'],
  aguardando_peca: ['em_andamento', 'cancelada'], aguardando_cliente: ['em_andamento', 'cancelada'], concluida: ['entregue'], entregue: [], cancelada: [],
}
const AG_DE: Record<string, string[]> = { agendado: ['confirmado', 'em_atendimento', 'cancelado', 'faltou'], confirmado: ['em_atendimento', 'cancelado', 'faltou'], em_atendimento: ['concluido', 'cancelado'], concluido: [], cancelado: [], faltou: [] }
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const DINHEIRO = /^\d{1,15}(\.\d{1,4})?$/, QTD = /^\d{1,12}(\.\d{1,4})?$/

export function criaServicos(no: No) {
  const ents = (no.spec as { entidades: Record<string, never> }).entidades
  const T = (e: string) => tabela('servicos', e)
  const S = (e: string) => `servicos.${e}`
  const ler = async (q: Consulta, ent: string, id: string, bloqueia = false): Promise<Linha | undefined> => {
    const r = (await q(`SELECT ${colunas(ents[ent]!)} FROM ${T(ent)} WHERE id = $1${bloqueia ? ' FOR UPDATE' : ''}`, [id])).rows[0]
    return r && linhaParaApi(ents[ent]!, r)
  }
  const bad = (m: string) => new ErroApi(400, 'entrada_invalida', m)
  const nf = (x: string) => new ErroApi(404, 'nao_encontrado', `${x} não encontrado`)
  const dinheiro = (v: unknown, nome: string, zeroOk = true): string => { const s = String(v ?? '0'); if (!DINHEIRO.test(s)) throw bad(`${nome} inválido`); if (!zeroOk && compara(s, '0') <= 0) throw bad(`${nome} deve ser maior que zero`); return s }
  const quantidade = (v: unknown): string => { const s = String(v); if (!QTD.test(s) || compara(s, '0') <= 0) throw bad('quantidade inválida (maior que zero, até 4 casas)'); return s }
  const instante = (v: unknown, nome: string): Date => { const d = new Date(String(v)); if (Number.isNaN(d.getTime())) throw bad(`${nome} inválido (use data e hora ISO 8601)`); return d }
  const proximo = async (q: Consulta, tenantId: string, nome: string): Promise<number> =>
    Number(((await q(`INSERT INTO ${T('sequencia')} (tenant_id, nome, valor) VALUES ($1, $2, 1) ON CONFLICT (tenant_id, nome) DO UPDATE SET valor = ${T('sequencia')}.valor + 1, atualizado_em = now() RETURNING valor`, [tenantId, nome])).rows[0] as { valor: number }).valor)
  const itemValido = (e: Record<string, unknown>) => {
    const tipo = String(e.tipo); if (tipo !== 'servico' && tipo !== 'peca') throw bad('tipo deve ser servico ou peca')
    const descricao = String(e.descricao ?? '').trim(); if (!descricao || descricao.length > 300) throw bad('descricao obrigatória (até 300 caracteres)')
    const produtoId = e.produtoId == null ? null : String(e.produtoId); if (produtoId && !UUID.test(produtoId)) throw bad('produtoId inválido'); if (tipo === 'servico' && produtoId) throw bad('serviço não tem produtoId')
    const q = quantidade(e.quantidade), preco = dinheiro(e.precoUnitario, 'precoUnitario'), desc = dinheiro(e.desconto, 'desconto')
    const bruto = multiplica(preco, q); if (compara(desc, bruto) > 0) throw new ErroApi(422, 'desconto_maior_que_item', 'o desconto da linha excede o valor da linha')
    return { tipo, descricao, produtoId, q, preco, desc, total: subtrai(bruto, desc) }
  }
  const pode = (ctxPode: EntradaOperacao['pode'], acao: string, ent: string, linha?: Record<string, unknown>) => ctxPode(acao, S(ent), linha)

  // ---------- agenda ----------
  async function conflito(q: Consulta, recursoId: string, ini: Date, fim: Date, ignora?: string): Promise<boolean> {
    return (await q(`SELECT 1 FROM ${T('agendamento')} WHERE recurso_id = $1 AND status NOT IN ('cancelado', 'faltou') AND inicio < $3::timestamptz AND fim > $2::timestamptz AND ($4::uuid IS NULL OR id <> $4::uuid) LIMIT 1`, [recursoId, ini.toISOString(), fim.toISOString(), ignora ?? null])).rows.length > 0
  }
  async function recursoAtivo(q: Consulta, id: string): Promise<void> {
    const r = (await q(`SELECT ativo FROM ${T('recurso')} WHERE id = $1 FOR UPDATE`, [id])).rows[0] as { ativo: boolean } | undefined // a trava do recurso serializa os agendamentos concorrentes dele
    if (!r) throw nf('recurso'); if (!r.ativo) throw new ErroApi(409, 'recurso_inativo', 'recurso desativado')
  }

  // ---------- totais ----------
  async function recalculaOrcamento(q: Consulta, id: string): Promise<void> {
    const o = (await ler(q, 'orcamento', id))!; const itens = (await q(`SELECT total::text AS t FROM ${T('item_orcamento')} WHERE orcamento_id = $1`, [id])).rows.map((r) => r.t as string)
    const sub = soma(['0', ...itens]), total = subtrai(sub, o.desconto as string)
    if (compara(total, '0') < 0) throw new ErroApi(422, 'desconto_maior_que_subtotal', 'o desconto do orçamento excede o subtotal')
    await q(`UPDATE ${T('orcamento')} SET subtotal = $2, total = $3, atualizado_em = now() WHERE id = $1`, [id, sub, total])
  }
  async function recalculaOS(q: Consulta, id: string): Promise<void> {
    const os = (await ler(q, 'ordemServico', id))!; const itens = (await q(`SELECT tipo, total::text AS t FROM ${T('item_ordem_servico')} WHERE ordem_servico_id = $1`, [id])).rows as Array<{ tipo: string; t: string }>
    const pecas = soma(['0', ...itens.filter((i) => i.tipo === 'peca').map((i) => i.t)]), servicos = soma(['0', ...itens.filter((i) => i.tipo === 'servico').map((i) => i.t)])
    const total = subtrai(soma([pecas, servicos]), os.desconto as string)
    if (compara(total, '0') < 0) throw new ErroApi(422, 'desconto_maior_que_total', 'o desconto excede o total da OS')
    await q(`UPDATE ${T('ordem_servico')} SET total_pecas = $2, total_servicos = $3, total = $4, atualizado_em = now() WHERE id = $1`, [id, pecas, servicos, total])
  }

  const operacoes = {
    async agendar({ entrada, ctx, q }: EntradaOperacao): Promise<unknown> {
      const recurso = String(entrada.recursoId), servico = String(entrada.servicoId), ini = instante(entrada.inicio, 'inicio')
      if (ini.getTime() < Date.now()) throw new ErroApi(422, 'no_passado', 'não se agenda no passado')
      await recursoAtivo(q, recurso)
      const s = (await q(`SELECT duracao_min, ativo FROM ${T('servico_oferecido')} WHERE id = $1`, [servico])).rows[0] as { duracao_min: number; ativo: boolean } | undefined
      if (!s) throw nf('serviço'); if (!s.ativo) throw new ErroApi(409, 'servico_inativo', 'serviço desativado')
      const fim = new Date(ini.getTime() + Number(s.duracao_min) * 60_000)
      if (await conflito(q, recurso, ini, fim)) throw new ErroApi(409, 'horario_ocupado', 'o recurso já tem um agendamento nesse horário')
      const id = ((await q(`INSERT INTO ${T('agendamento')} (tenant_id, cliente_id, recurso_id, servico_id, inicio, fim, status, criado_por, notas) VALUES ($1, $2, $3, $4, $5, $6, 'agendado', $7, $8) RETURNING id::text AS id`,
        [ctx.tenantId, String(entrada.clienteId), recurso, servico, ini.toISOString(), fim.toISOString(), ctx.usuario ?? 'desconhecido', entrada.notas ?? null])).rows[0] as { id: string }).id
      return ler(q, 'agendamento', id)
    },
    async remarcar({ params, entrada, q }: EntradaOperacao): Promise<unknown> {
      const a = await ler(q, 'agendamento', params.id!, true); if (!a) throw nf('agendamento')
      if (a.status !== 'agendado' && a.status !== 'confirmado') throw new ErroApi(409, 'estado_invalido', `agendamento ${a.status}: só se remarca antes do atendimento`)
      const ini = instante(entrada.inicio, 'inicio'); if (ini.getTime() < Date.now()) throw new ErroApi(422, 'no_passado', 'não se remarca para o passado')
      const recurso = entrada.recursoId == null ? String(a.recursoId) : String(entrada.recursoId); await recursoAtivo(q, recurso)
      const duracao = new Date(String(a.fim)).getTime() - new Date(String(a.inicio)).getTime(), fim = new Date(ini.getTime() + duracao)
      if (await conflito(q, recurso, ini, fim, a.id as string)) throw new ErroApi(409, 'horario_ocupado', 'o recurso já tem um agendamento nesse horário')
      await q(`UPDATE ${T('agendamento')} SET recurso_id = $2, inicio = $3, fim = $4, atualizado_em = now() WHERE id = $1`, [a.id, recurso, ini.toISOString(), fim.toISOString()])
      return ler(q, 'agendamento', a.id as string)
    },
    async mudarStatusAgendamento({ params, entrada, q }: EntradaOperacao): Promise<unknown> {
      const a = await ler(q, 'agendamento', params.id!, true); if (!a) throw nf('agendamento'); const para = String(entrada.para)
      if (!(para in AG_DE)) throw bad(`status inválido (${Object.keys(AG_DE).join(', ')})`)
      if (a.status === para) return a // repetir é no-op
      if (!AG_DE[a.status as string]!.includes(para)) throw new ErroApi(409, 'transicao_invalida', `de ${a.status} não se vai para ${para}`)
      await q(`UPDATE ${T('agendamento')} SET status = $2, atualizado_em = now() WHERE id = $1`, [a.id, para]); return ler(q, 'agendamento', a.id as string)
    },

    async abrirOrcamento({ entrada, ctx, q }: EntradaOperacao): Promise<unknown> {
      const validoAte = entrada.validoAte == null ? null : String(entrada.validoAte); if (validoAte && !/^\d{4}-\d{2}-\d{2}$/.test(validoAte)) throw bad('validoAte deve ser AAAA-MM-DD')
      const n = await proximo(q, ctx.tenantId, 'orcamento')
      const id = ((await q(`INSERT INTO ${T('orcamento')} (tenant_id, numero, cliente_id, status, valido_ate, subtotal, desconto, total, notas, criado_por) VALUES ($1, $2, $3, 'rascunho', $4, 0, $5, 0, $6, $7) RETURNING id::text AS id`,
        [ctx.tenantId, n, String(entrada.clienteId), validoAte, dinheiro(entrada.desconto, 'desconto'), entrada.notas ?? null, ctx.usuario ?? 'desconhecido'])).rows[0] as { id: string }).id
      return ler(q, 'orcamento', id)
    },
    async adicionarItemOrcamento({ params, entrada, ctx, q }: EntradaOperacao): Promise<unknown> {
      const o = await ler(q, 'orcamento', params.id!, true); if (!o) throw nf('orçamento')
      if (o.status !== 'rascunho') throw new ErroApi(409, 'orcamento_fechado', 'só se edita um orçamento em rascunho')
      const i = itemValido(entrada)
      const id = ((await q(`INSERT INTO ${T('item_orcamento')} (tenant_id, orcamento_id, tipo, produto_id, descricao, quantidade, preco_unitario, desconto, total) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING id::text AS id`,
        [ctx.tenantId, o.id, i.tipo, i.produtoId, i.descricao, i.q, i.preco, i.desc, i.total])).rows[0] as { id: string }).id
      await recalculaOrcamento(q, o.id as string); return ler(q, 'itemOrcamento', id)
    },
    async removerItemOrcamento({ params, q }: EntradaOperacao): Promise<unknown> {
      const o = await ler(q, 'orcamento', params.id!, true); if (!o) throw nf('orçamento')
      if (o.status !== 'rascunho') throw new ErroApi(409, 'orcamento_fechado', 'só se edita um orçamento em rascunho')
      if (!(await q(`DELETE FROM ${T('item_orcamento')} WHERE id = $1 AND orcamento_id = $2`, [params.itemId, o.id])).rowCount) throw nf('item')
      await recalculaOrcamento(q, o.id as string); return ler(q, 'orcamento', o.id as string)
    },
    async enviarOrcamento({ params, q }: EntradaOperacao): Promise<unknown> {
      const o = await ler(q, 'orcamento', params.id!, true); if (!o) throw nf('orçamento'); if (o.status === 'enviado') return o
      if (o.status !== 'rascunho') throw new ErroApi(409, 'transicao_invalida', `orçamento ${o.status}: não se envia`)
      if (!(await q(`SELECT 1 FROM ${T('item_orcamento')} WHERE orcamento_id = $1 LIMIT 1`, [o.id])).rows.length) throw new ErroApi(422, 'orcamento_vazio', 'o orçamento não tem itens')
      await q(`UPDATE ${T('orcamento')} SET status = 'enviado', atualizado_em = now() WHERE id = $1`, [o.id]); return ler(q, 'orcamento', o.id as string)
    },
    async decidirOrcamento({ params, entrada, q }: EntradaOperacao): Promise<unknown> {
      const o = await ler(q, 'orcamento', params.id!, true); if (!o) throw nf('orçamento'); const d = String(entrada.decisao)
      if (d !== 'aprovar' && d !== 'rejeitar') throw bad('decisao deve ser aprovar ou rejeitar'); const alvo = d === 'aprovar' ? 'aprovado' : 'rejeitado'
      if (o.status === alvo) return o
      if (o.status !== 'enviado') throw new ErroApi(409, 'transicao_invalida', `orçamento ${o.status}: só se decide um orçamento enviado`)
      if (d === 'aprovar' && o.validoAte && String(o.validoAte) < new Date().toISOString().slice(0, 10)) throw new ErroApi(422, 'orcamento_expirado', 'a validade do orçamento passou')
      await q(`UPDATE ${T('orcamento')} SET status = $2, atualizado_em = now() WHERE id = $1`, [o.id, alvo]); return ler(q, 'orcamento', o.id as string)
    },
    async converterOrcamento({ params, entrada, ctx, q }: EntradaOperacao): Promise<unknown> {
      const o = await ler(q, 'orcamento', params.id!, true); if (!o) throw nf('orçamento')
      if (o.status === 'convertido') return ler(q, 'ordemServico', o.ordemServicoId as string) // repetir devolve a MESMA OS
      if (o.status !== 'aprovado') throw new ErroApi(409, 'transicao_invalida', `orçamento ${o.status}: só se converte um orçamento aprovado`)
      const termo = entrada.termoGarantiaId == null ? null : String(entrada.termoGarantiaId)
      if (termo && !(await q(`SELECT 1 FROM ${T('termo_garantia')} WHERE id = $1 AND ativo`, [termo])).rows.length) throw new ErroApi(404, 'nao_encontrado', 'termo de garantia não encontrado ou inativo')
      const n = await proximo(q, ctx.tenantId, 'os')
      const id = ((await q(`INSERT INTO ${T('ordem_servico')} (tenant_id, numero, cliente_id, objeto, responsavel_id, orcamento_id, termo_garantia_id, status, descricao, total_pecas, total_servicos, desconto, total, criado_por) VALUES ($1, $2, $3, $4, $5, $6, $7, 'aberta', $8, 0, 0, $9, 0, $10) RETURNING id::text AS id`,
        [ctx.tenantId, n, o.clienteId, entrada.objeto ?? null, entrada.responsavelId ?? null, o.id, termo, `Orçamento nº ${o.numero}${o.notas ? ` — ${o.notas}` : ''}`.slice(0, 500), o.desconto, ctx.usuario ?? 'desconhecido'])).rows[0] as { id: string }).id
      await q(`INSERT INTO ${T('item_ordem_servico')} (tenant_id, ordem_servico_id, tipo, produto_id, descricao, quantidade, preco_unitario, desconto, total) SELECT tenant_id, $2, tipo, produto_id, descricao, quantidade, preco_unitario, desconto, total FROM ${T('item_orcamento')} WHERE orcamento_id = $1`, [o.id, id])
      await recalculaOS(q, id)
      await q(`UPDATE ${T('orcamento')} SET status = 'convertido', ordem_servico_id = $2, atualizado_em = now() WHERE id = $1`, [o.id, id]); return ler(q, 'ordemServico', id)
    },
    async expirarOrcamentos({ q }: EntradaOperacao): Promise<unknown> {
      const ids = (await q(`UPDATE ${T('orcamento')} SET status = 'expirado', atualizado_em = now() WHERE status IN ('rascunho', 'enviado') AND valido_ate < current_date RETURNING id::text AS id`)).rows as Array<{ id: string }>
      const out: unknown[] = []; for (const { id } of ids) out.push(await ler(q, 'orcamento', id)); return out
    },

    async abrirOS({ entrada, ctx, q }: EntradaOperacao): Promise<unknown> {
      const termo = entrada.termoGarantiaId == null ? null : String(entrada.termoGarantiaId)
      if (termo && !(await q(`SELECT 1 FROM ${T('termo_garantia')} WHERE id = $1 AND ativo`, [termo])).rows.length) throw new ErroApi(404, 'nao_encontrado', 'termo de garantia não encontrado ou inativo')
      const n = await proximo(q, ctx.tenantId, 'os'), descricao = String(entrada.descricao).trim(); if (!descricao) throw bad('descricao obrigatória')
      const id = ((await q(`INSERT INTO ${T('ordem_servico')} (tenant_id, numero, cliente_id, objeto, responsavel_id, termo_garantia_id, status, descricao, total_pecas, total_servicos, desconto, total, criado_por) VALUES ($1, $2, $3, $4, $5, $6, 'aberta', $7, 0, 0, 0, 0, $8) RETURNING id::text AS id`,
        [ctx.tenantId, n, String(entrada.clienteId), entrada.objeto ?? null, entrada.responsavelId ?? null, termo, descricao, ctx.usuario ?? 'desconhecido'])).rows[0] as { id: string }).id
      return ler(q, 'ordemServico', id)
    },
    async adicionarItemOS({ params, entrada, ctx, q, pode: p }: EntradaOperacao): Promise<unknown> {
      const os = await ler(q, 'ordemServico', params.id!, true); if (!os || !pode(p, 'adicionarItemOS', 'ordemServico', os)) throw nf('ordem de serviço')
      if (!OS_ABERTAS.includes(os.status as string)) throw new ErroApi(409, 'os_fechada', `OS ${os.status}: não aceita mais itens`)
      const i = itemValido(entrada)
      await q(`INSERT INTO ${T('item_ordem_servico')} (tenant_id, ordem_servico_id, tipo, produto_id, descricao, quantidade, preco_unitario, desconto, total) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [ctx.tenantId, os.id, i.tipo, i.produtoId, i.descricao, i.q, i.preco, i.desc, i.total])
      await recalculaOS(q, os.id as string); return ler(q, 'ordemServico', os.id as string)
    },
    async removerItemOS({ params, q, pode: p }: EntradaOperacao): Promise<unknown> {
      const os = await ler(q, 'ordemServico', params.id!, true); if (!os || !pode(p, 'removerItemOS', 'ordemServico', os)) throw nf('ordem de serviço')
      if (!OS_ABERTAS.includes(os.status as string)) throw new ErroApi(409, 'os_fechada', `OS ${os.status}: não aceita alterações`)
      if (!(await q(`DELETE FROM ${T('item_ordem_servico')} WHERE id = $1 AND ordem_servico_id = $2`, [params.itemId, os.id])).rowCount) throw nf('item')
      await recalculaOS(q, os.id as string); return ler(q, 'ordemServico', os.id as string)
    },
    async mudarStatusOS({ params, entrada, ctx, q, pode: p, publica }: EntradaOperacao): Promise<unknown> {
      const os = await ler(q, 'ordemServico', params.id!, true); if (!os || !pode(p, 'mudarStatusOS', 'ordemServico', os)) throw nf('ordem de serviço')
      const para = String(entrada.para); if (!(para in OS_DE)) throw bad(`status inválido (${Object.keys(OS_DE).join(', ')})`)
      if (os.status === para) return os
      if (!OS_DE[os.status as string]!.includes(para)) throw new ErroApi(409, 'transicao_invalida', `de ${os.status} não se vai para ${para}`)
      if (entrada.diagnostico != null) await q(`UPDATE ${T('ordem_servico')} SET diagnostico = $2 WHERE id = $1`, [os.id, String(entrada.diagnostico).slice(0, 2000)])
      if (para === 'cancelada') {
        const motivo = String(entrada.motivo ?? '').trim(); if (!motivo) throw bad('informe o motivo do cancelamento')
        await q(`UPDATE ${T('ordem_servico')} SET status = 'cancelada', motivo_cancelamento = $2, atualizado_em = now() WHERE id = $1`, [os.id, motivo.slice(0, 500)])
      } else if (para === 'concluida') {
        if (!(await q(`SELECT 1 FROM ${T('item_ordem_servico')} WHERE ordem_servico_id = $1 LIMIT 1`, [os.id])).rows.length) throw new ErroApi(422, 'os_sem_itens', 'a OS não tem itens: nada a cobrar')
        await q(`UPDATE ${T('ordem_servico')} SET status = 'concluida', concluida_em = now(), atualizado_em = now() WHERE id = $1`, [os.id])
        const pecas = (await q(`SELECT produto_id::text AS "produtoId", sum(quantidade)::text AS quantidade FROM ${T('item_ordem_servico')} WHERE ordem_servico_id = $1 AND tipo = 'peca' AND produto_id IS NOT NULL GROUP BY produto_id ORDER BY produto_id`, [os.id])).rows
        await publica('os.concluida', { ordemServicoId: os.id as string, total: os.total as string, itens: pecas }) // o Estoque baixa as peças; mesma transação da conclusão
      } else if (para === 'entregue') {
        await q(`UPDATE ${T('ordem_servico')} SET status = 'entregue', entregue_em = now(), garantia_ate = (SELECT current_date + t.dias::int FROM ${T('termo_garantia')} t WHERE t.id = termo_garantia_id), atualizado_em = now() WHERE id = $1`, [os.id])
      } else await q(`UPDATE ${T('ordem_servico')} SET status = $2, atualizado_em = now() WHERE id = $1`, [os.id, para])
      void ctx; return ler(q, 'ordemServico', os.id as string)
    },
  }
  return { operacoes }
}
