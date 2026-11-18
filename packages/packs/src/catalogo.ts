import { ErroApi, colunas, tabela, type EntradaOperacao } from '@polaris/servico'
import type { No } from '@polaris/schema'
import { compara, normaliza } from './dinheiro'

/** Um item de tabela de preço já filtrado como aplicável (tabela ativa e vigente; quantidade ≥ mínimo; produto e variante certos). */
export type Candidato = { tabelaPrecoId: string; itemId: string; varianteId: string | null; preco: string; qtdMinima: number | null }
export type Preco = { preco: string; origem: 'base' | 'tabela'; tabelaPrecoId: string | null }

/**
 * Regra de preço do catálogo (pura e determinística):
 *  1. base = preço da variante, ou o do produto quando a variante não tem preço próprio;
 *  2. entre as tabelas aplicáveis vence, nesta ordem: item específico da variante > item do produto; maior quantidade mínima; MENOR preço; menor id de tabela (desempate estável);
 *  3. uma tabela aplicável SEMPRE substitui a base (tabela pode ser promoção ou atacado).
 */
export function resolvePreco(base: { produto: string; variante: string | null }, candidatos: Candidato[]): Preco {
  const basePreco = normaliza(base.variante ?? base.produto)
  const ordem = [...candidatos].sort((a, b) =>
    Number(b.varianteId !== null) - Number(a.varianteId !== null) || (b.qtdMinima ?? 0) - (a.qtdMinima ?? 0) || compara(a.preco, b.preco) || (a.tabelaPrecoId < b.tabelaPrecoId ? -1 : a.tabelaPrecoId > b.tabelaPrecoId ? 1 : a.itemId < b.itemId ? -1 : 1))
  const c = ordem[0]
  return c ? { preco: normaliza(c.preco), origem: 'tabela', tabelaPrecoId: c.tabelaPrecoId } : { preco: basePreco, origem: 'base', tabelaPrecoId: null }
}

type Linha = Record<string, unknown>
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/** Implementação da operação `cotar`: calcula o preço no momento e GRAVA a cotação (o checkout referencia o preço combinado, sem recalcular). */
export function operacoesCatalogo(no: No) {
  const ents = (no.spec as { entidades: Record<string, { campos: Record<string, never> }> }).entidades
  return {
    async cotar({ entrada, q, pode }: EntradaOperacao): Promise<unknown> {
      const produtoId = String(entrada.produtoId), varianteId = entrada.varianteId == null ? null : String(entrada.varianteId)
      const qtd = Number(entrada.quantidade)
      if (!UUID.test(produtoId) || (varianteId !== null && !UUID.test(varianteId))) throw new ErroApi(400, 'entrada_invalida', 'id inválido')
      if (!Number.isFinite(qtd) || qtd <= 0) throw new ErroApi(400, 'entrada_invalida', 'a quantidade deve ser maior que zero')
      if (!pode('cotar', 'catalogo.cotacao')) throw new ErroApi(403, 'proibido', 'sem permissão para cotar')
      const p = (await q(`SELECT preco::text AS preco, ativo, vendavel, tem_variantes FROM ${tabela('catalogo', 'produto')} WHERE id = $1`, [produtoId])).rows[0] as Linha | undefined
      if (!p) throw new ErroApi(404, 'nao_encontrado', 'produto não encontrado')
      if (!p.ativo || !p.vendavel) throw new ErroApi(422, 'indisponivel', 'produto inativo ou não vendável')
      let precoVariante: string | null = null
      if (varianteId) {
        const v = (await q(`SELECT preco::text AS preco, ativo FROM ${tabela('catalogo', 'variante')} WHERE id = $1 AND produto_id = $2`, [varianteId, produtoId])).rows[0] as Linha | undefined
        if (!v) throw new ErroApi(404, 'nao_encontrado', 'variante não encontrada para este produto')
        if (!v.ativo) throw new ErroApi(422, 'indisponivel', 'variante inativa')
        precoVariante = (v.preco as string | null) ?? null
      } else if (p.tem_variantes) throw new ErroApi(422, 'variante_obrigatoria', 'este produto tem variantes: informe a variante')
      const itens = (await q(
        `SELECT i.id::text AS "itemId", i.tabela_preco_id::text AS "tabelaPrecoId", i.variante_id::text AS "varianteId", i.preco::text AS preco, i.qtd_minima::float8 AS "qtdMinima"
           FROM ${tabela('catalogo', 'item_tabela_preco')} i JOIN ${tabela('catalogo', 'tabela_preco')} t ON t.id = i.tabela_preco_id AND t.tenant_id = i.tenant_id
          WHERE i.produto_id = $1 AND (i.variante_id IS NULL OR i.variante_id IS NOT DISTINCT FROM $2::uuid)
            AND t.ativo AND (t.inicia_em IS NULL OR t.inicia_em <= current_date) AND (t.termina_em IS NULL OR t.termina_em >= current_date)
            AND (i.qtd_minima IS NULL OR i.qtd_minima <= $3::numeric)`, [produtoId, varianteId, qtd])).rows as unknown as Candidato[]
      const r = resolvePreco({ produto: p.preco as string, variante: precoVariante }, itens)
      const ent = ents.cotacao!
      const ins = await q(
        `INSERT INTO ${tabela('catalogo', 'cotacao')} (tenant_id, produto_id, variante_id, quantidade, preco_unitario, origem, tabela_preco_id)
         VALUES (current_setting('app.tenant_id')::uuid, $1, $2, $3, $4, $5, $6) RETURNING id::text AS id`, [produtoId, varianteId, qtd, r.preco, r.origem, r.tabelaPrecoId])
      const id = (ins.rows[0] as { id: string }).id
      return (await q(`SELECT ${colunas(ent as never)} FROM ${tabela('catalogo', 'cotacao')} WHERE id = $1`, [id])).rows[0]
    },
  }
}
