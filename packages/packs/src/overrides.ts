import { createHash } from 'node:crypto'
import { Registry, jsonCanonico, validaEstrutura, type Erro, type No } from '@polaris/schema'

// Overrides por tenant: o tenant redefine páginas, temas, dados, papéis e documentos (e blocos de COMPOSIÇÃO) pela cascata tenant → segmento → core, sem tocar nos outros.
// Cada gravação é uma versão IMUTÁVEL (um gatilho no banco recusa UPDATE/DELETE); o "rascunho" é a versão mais recente, e uma release (publicação) fixa um conjunto delas.
// O que vale para qualquer tenant é validado AQUI, na gravação: o que for gravado já foi conferido contra o registro, as referências e os módulos do tenant.

type Q = (sql: string, params?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>>; rowCount: number }>
/** o que um tenant PODE sobrescrever. `servico` (muda banco), `evento`, `kernel`/`backend` (executam código), `pack` e `tenant` (são da plataforma) NUNCA. */
export const KINDS_DO_TENANT = ['pagina', 'tema', 'dados', 'papel', 'documento', 'bloco'] as const
export type KindDoTenant = (typeof KINDS_DO_TENANT)[number]
/** com `configDoSite` (só `PUT /studio/site`), o armazém grava também o nó `tenant`; por padrão e na rota genérica de nós vale só KINDS_DO_TENANT */
const KINDS_NO_ARMAZEM = [...KINDS_DO_TENANT, 'tenant'] as const
export type VersaoNo = { kind: string; id: string; seq: number; hash: string; autor: string; nota: string | null; criadoEm: string; removido: boolean }
export type Limites = { maxBytes: number; maxNos: number; maxVersoesPorNo: number }
const LIMITES: Limites = { maxBytes: 256 * 1024, maxNos: 500, maxVersoesPorNo: 1000 }
export type ResultadoSalvar = { ok: true; versao: VersaoNo; novo: boolean } | { ok: false; erros: string[] }
const ID = /^[a-z][A-Za-z0-9._/-]{0,127}$/
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

const hashDe = (v: unknown) => createHash('sha256').update(jsonCanonico(v)).digest('hex')
const versaoDe = (r: Record<string, unknown>): VersaoNo => ({ kind: r.kind as string, id: r.id as string, seq: Number(r.seq), hash: r.hash as string, autor: r.autor as string, nota: (r.nota as string | null) ?? null, criadoEm: new Date(r.criado_em as string).toISOString(), removido: r.conteudo === null })
const fmt = (e: Erro) => `${e.caminho} ${e.mensagem}${e.dica ? ` — ${e.dica}` : ''}`

export function criaArmazemDeNos(o: { q: Q; base: Registry; /** módulos (serviços) habilitados do tenant: um `dados` não pode apontar para serviço que ele não tem */ modulosDe?: (tenantId: string) => Promise<string[]>; limites?: Partial<Limites> }) {
  const { q } = o, lim = { ...LIMITES, ...o.limites }

  /** as CABEÇAS: a versão mais recente de cada nó do tenant (as removidas — lápide — ficam de fora) */
  async function cabecas(tenantId: string): Promise<Array<{ kind: string; id: string; seq: number; conteudo: unknown }>> {
    return (await q(`SELECT DISTINCT ON (kind, id) kind, id, seq, conteudo FROM plataforma.no_versao WHERE tenant_id = $1 ORDER BY kind, id, seq DESC`, [tenantId])).rows
      .filter((r) => r.conteudo !== null).map((r) => ({ kind: r.kind as string, id: r.id as string, seq: Number(r.seq), conteudo: r.conteudo }))
  }

  /** O registro do tenant: o core/segmento mais os nós do tenant (`escolha`: as versões fixadas por uma release; sem ela, as cabeças). Nó corrompido/inválido NÃO derruba o tenant: é pulado e reportado. */
  async function registroDoTenant(tenantId: string, escolha?: Map<string, number>): Promise<{ registro: Registry; ignorados: string[] }> {
    const reg = o.base.derivado(), ignorados: string[] = []
    let nos: Array<{ kind: string; id: string; conteudo: unknown }>
    if (escolha) {
      nos = []
      for (const [chave, seq] of escolha) { const [kind, ...resto] = chave.split(':'); const id = resto.join(':'); const r = (await q(`SELECT conteudo FROM plataforma.no_versao WHERE tenant_id = $1 AND kind = $2 AND id = $3 AND seq = $4`, [tenantId, kind, id, seq])).rows[0]; if (r && r.conteudo !== null) nos.push({ kind: kind!, id, conteudo: r.conteudo }); else ignorados.push(`${chave}@${seq}: versão inexistente`) }
    } else nos = await cabecas(tenantId)
    for (const n of nos) { try { reg.registra({ ...(n.conteudo as object), tenantId }) } catch (e) { ignorados.push(`${n.kind}:${n.id}: ${(e as Error).message.slice(0, 160)}`) } } // `tenantId` SEMPRE o do dono: o conteúdo gravado não manda nele
    return { registro: reg, ignorados }
  }

  async function salva(tenantId: string, autor: string, dado: unknown, nota?: string, opc: { configDoSite?: boolean } = {}): Promise<ResultadoSalvar> {
    const erros: string[] = []
    if (!UUID.test(tenantId)) return { ok: false, erros: ['tenant inválido'] }
    if (!dado || typeof dado !== 'object' || Array.isArray(dado)) return { ok: false, erros: ['o nó deve ser um objeto'] }
    const d = dado as Record<string, unknown>
    if (JSON.stringify(d).length > lim.maxBytes) return { ok: false, erros: [`o nó excede ${lim.maxBytes} bytes`] }
    if (!((opc.configDoSite ? KINDS_NO_ARMAZEM : KINDS_DO_TENANT) as readonly string[]).includes(String(d.kind))) erros.push(`um tenant não sobrescreve '${String(d.kind).slice(0, 30)}' (permitidos: ${KINDS_DO_TENANT.join(', ')})`)
    if (typeof d.id !== 'string' || !ID.test(d.id)) erros.push('id inválido')
    if (d.segmento !== undefined && d.segmento !== null) erros.push('um tenant não publica em escopo de segmento')
    if (d.tenantId !== undefined && d.tenantId !== null && d.tenantId !== tenantId) erros.push('o nó declara outro tenant')
    if (d.filhos !== undefined) erros.push('`filhos` não é aceito em override de tenant (cada nó é gravado por si)')
    if (d.kind === 'bloco' && (d.spec as { codigo?: unknown } | undefined)?.codigo !== undefined) erros.push('um tenant sobrescreve blocos por COMPOSIÇÃO (`modelo`); blocos com `codigo` são da plataforma')
    if (erros.length) return { ok: false, erros }
    const t = (await q(`SELECT status FROM plataforma.tenant WHERE id = $1`, [tenantId])).rows[0] as { status: string } | undefined
    if (!t) return { ok: false, erros: ['tenant inexistente'] }; if (t.status === 'cancelado') return { ok: false, erros: ['tenant encerrado'] }
    const { tenantId: _t, ...limpo } = d; const no0 = { ...limpo, tenantId } as Record<string, unknown>
    const kind = no0.kind as string, id = no0.id as string
    // 1) o nó, no registro do tenant COM os outros nós dele: schema, referências e estrutura
    const outros = (await cabecas(tenantId)).filter((c) => !(c.kind === kind && c.id === id))
    const reg = o.base.derivado(); for (const c of outros) { try { reg.registra({ ...(c.conteudo as object), tenantId }) } catch { /* o que já está gravado e quebrou não impede salvar OUTRO nó */ } }
    let no: No
    try { no = reg.registra(no0) } catch (e) { return { ok: false, erros: ((e as { detalhes?: Erro[] }).detalhes?.map(fmt) ?? [(e as Error).message]).slice(0, 20) } }
    const ctx = { tenantId }; for (const e of reg.verifica(no, ctx)) erros.push(`referência quebrada: ${e.caminho} ${e.mensagem}`)
    for (const e of validaEstrutura(reg, no, ctx)) erros.push(fmt(e))
    // 2) um `dados` só pode usar serviço que o TENANT tem habilitado
    if (kind === 'dados' && o.modulosDe) { const sv = (no.spec as { fonte?: { tipo?: string; servico?: string } }).fonte; if (sv?.tipo === 'servico' && sv.servico) { const mods = await o.modulosDe(tenantId); if (!mods.includes(sv.servico)) erros.push(`o serviço '${sv.servico}' não está habilitado para este tenant`) } }
    if (erros.length) return { ok: false, erros: erros.slice(0, 20) }
    // 3) limites e gravação (versão nova SEMPRE; conteúdo idêntico à cabeça não cria outra)
    const conteudo = { ...(no0 as object) } as Record<string, unknown>; delete conteudo.tenantId
    const hash = hashDe(conteudo)
    const cab = (await q(`SELECT kind, id, seq, hash, autor, nota, criado_em, conteudo FROM plataforma.no_versao WHERE tenant_id = $1 AND kind = $2 AND id = $3 ORDER BY seq DESC LIMIT 1`, [tenantId, kind, id])).rows[0]
    if (cab && cab.hash === hash && cab.conteudo !== null) return { ok: true, versao: versaoDe(cab), novo: false }
    if (!cab || cab.conteudo === null) { const n = Number((await q(`SELECT count(*)::int AS n FROM (SELECT DISTINCT ON (kind, id) conteudo FROM plataforma.no_versao WHERE tenant_id = $1 ORDER BY kind, id, seq DESC) x WHERE conteudo IS NOT NULL`, [tenantId])).rows[0]!.n); if (n >= lim.maxNos) return { ok: false, erros: [`limite de ${lim.maxNos} overrides por tenant`] } }
    if (cab && Number(cab.seq) >= lim.maxVersoesPorNo) return { ok: false, erros: [`limite de ${lim.maxVersoesPorNo} versões deste nó`] }
    for (let tentativa = 0; tentativa < 40; tentativa++) { // cada rodada, pelo menos UM dos concorrentes ganha o seq: com N escritores simultâneos bastam N rodadas (atraso aleatório curto desfaz a sincronia)
      if (tentativa > 0) await new Promise((r) => setTimeout(r, Math.random() * 4))
      const r = await q(`INSERT INTO plataforma.no_versao (tenant_id, kind, id, seq, conteudo, hash, autor, nota) SELECT $1, $2, $3, coalesce(max(seq), 0) + 1, $4::jsonb, $5, $6, $7 FROM plataforma.no_versao WHERE tenant_id = $1 AND kind = $2 AND id = $3 ON CONFLICT DO NOTHING RETURNING kind, id, seq, hash, autor, nota, criado_em, conteudo`, [tenantId, kind, id, JSON.stringify(conteudo), hash, autor.slice(0, 120), nota?.slice(0, 300) ?? null])
      if (r.rows[0]) return { ok: true, versao: versaoDe(r.rows[0]), novo: true } // (uma corrida pelo mesmo `seq` perde o ON CONFLICT e tenta de novo com o próximo)
    }
    return { ok: false, erros: ['muitas gravações simultâneas deste nó: tente de novo'] }
  }

  /** "retirar o override": grava uma LÁPIDE (o nó volta a ser o do segmento/core na próxima release); o histórico fica */
  async function remove(tenantId: string, kind: string, id: string, autor: string, nota?: string): Promise<{ ok: true } | { ok: false; erro: string }> {
    const cab = (await q(`SELECT conteudo FROM plataforma.no_versao WHERE tenant_id = $1 AND kind = $2 AND id = $3 ORDER BY seq DESC LIMIT 1`, [tenantId, kind, id])).rows[0]
    if (!cab) return { ok: false, erro: 'nó inexistente' }; if (cab.conteudo === null) return { ok: true }
    await q(`INSERT INTO plataforma.no_versao (tenant_id, kind, id, seq, conteudo, hash, autor, nota) SELECT $1, $2, $3, max(seq) + 1, NULL, 'removido', $4, $5 FROM plataforma.no_versao WHERE tenant_id = $1 AND kind = $2 AND id = $3`, [tenantId, kind, id, autor.slice(0, 120), nota?.slice(0, 300) ?? null])
    return { ok: true }
  }

  return {
    salva, remove, registroDoTenant, cabecas,
    async historico(tenantId: string, kind: string, id: string, limite = 50): Promise<VersaoNo[]> { return (await q(`SELECT kind, id, seq, hash, autor, nota, criado_em, conteudo FROM plataforma.no_versao WHERE tenant_id = $1 AND kind = $2 AND id = $3 ORDER BY seq DESC LIMIT $4`, [tenantId, kind, id, Math.min(Math.max(1, limite), 200)])).rows.map(versaoDe) },
    async versao(tenantId: string, kind: string, id: string, seq: number): Promise<{ meta: VersaoNo; conteudo: unknown } | null> { const r = (await q(`SELECT kind, id, seq, hash, autor, nota, criado_em, conteudo FROM plataforma.no_versao WHERE tenant_id = $1 AND kind = $2 AND id = $3 AND seq = $4`, [tenantId, kind, id, seq])).rows[0]; return r ? { meta: versaoDe(r), conteudo: r.conteudo } : null },
    async lista(tenantId: string): Promise<VersaoNo[]> { return (await q(`SELECT DISTINCT ON (kind, id) kind, id, seq, hash, autor, nota, criado_em, conteudo FROM plataforma.no_versao WHERE tenant_id = $1 ORDER BY kind, id, seq DESC`, [tenantId])).rows.map(versaoDe) },
  }
}
