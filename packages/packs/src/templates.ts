import { createHash } from 'node:crypto'
import { Registry, jsonCanonico, validaEstrutura, type Erro } from '@polaris/schema'
import type { criaArmazemDeNos } from './overrides'
import { KINDS_DO_TENANT } from './overrides'

// MODELOS (templates) de site guardados no banco: um pacote de nós com nome e versão, por tenant, em versões IMUTÁVEIS (`seq`).
// Guardar valida o pacote inteiro contra o registro (schema, referências, estrutura); APLICAR grava os nós no armazém do tenant como rascunhos (na ordem das dependências),
// troca `@img/<nome>` pelo endereço do ativo de mesmo nome do tenant, ajusta o nó `tenant` do site (tema, páginas, idiomas) e, se pedido, publica uma release.
type Q = (sql: string, params?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>>; rowCount: number }>
type Armazem = ReturnType<typeof criaArmazemDeNos>
export type Modelo = { slug: string; nome: string; descricao: string | null; segmento: string | null; versao: string; idiomas: string[]; miniatura: string | null; nos: Array<Record<string, unknown>> }
export type ResumoModelo = Omit<Modelo, 'nos'> & { seq: number; nNos: number; autor: string; nota: string | null; criadoEm: string }
export type ResultadoModelo = { ok: true; seq: number; novo: boolean } | { ok: false; erros: string[] }
export type ResultadoAplica = { ok: true; nos: number; fotos: string[]; site: boolean; release: number | null } | { ok: false; erros: string[] }
const SLUG = /^[a-z][a-z0-9-]{0,62}$/, SEMVER = /^\d+\.\d+\.\d+$/, IMG = /@img\/([A-Za-z0-9_-]+)/g
const KINDS_MODELO = [...KINDS_DO_TENANT, 'tenant'] as const
/** o que o tenant grava ANTES do que o referencia: tradução, tema e formulário, depois blocos, dados, papéis, documentos e cartazes, e por último as páginas */
const ORDEM = ['traducao', 'tema', 'formulario', 'bloco', 'dados', 'papel', 'documento', 'cartaz', 'pagina']
const LIM = { maxBytes: 4 * 1024 * 1024, maxNos: 500, maxVersoes: 1000, maxModelos: 100 }
const fmt = (e: Erro) => `${e.caminho} ${e.mensagem}${e.dica ? ` — ${e.dica}` : ''}`
const hashDe = (v: unknown) => createHash('sha256').update(jsonCanonico(v)).digest('hex')
const proxima = (v: string) => { const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(v); return m ? `${m[1]}.${m[2]}.${Number(m[3]) + 1}` : '1.0.1' }

export function criaTemplates(o: {
  q: Q; base: Registry; armazem: Armazem
  /** id do nó `tenant` do site do tenant (o alias); sem ele, o modelo não mexe na configuração do site */
  tenantNo?: (tenantId: string) => string | undefined | Promise<string | undefined>
  /** os ativos (imagens) do tenant, para trocar `@img/<nome>` */
  ativos?: { lista(tenantId: string): Promise<Array<{ nome: string; caminho: string }>> }
  /** põe os rascunhos em produção (`criaReleases`) */
  publicar?: (a: { tenantId: string; autor: string; nota?: string }) => Promise<{ ok: true; release: number } | { ok: false; erros: string[] }>
}) {
  const { q } = o

  /** valida o pacote como o armazém validaria cada nó, mas TODOS juntos (as referências entre eles valem) */
  function confere(tenantId: string, nos: Array<Record<string, unknown>>): string[] {
    const erros: string[] = [], reg = o.base.derivado(), ok: Array<ReturnType<Registry['registra']>> = []
    const vistos = new Set<string>()
    for (const n of nos) {
      const rot = `${String(n.kind)}:${String(n.id)}`
      if (!(KINDS_MODELO as readonly string[]).includes(String(n.kind))) { erros.push(`${rot}: um modelo não leva '${String(n.kind).slice(0, 30)}' (permitidos: ${KINDS_MODELO.join(', ')})`); continue }
      if (vistos.has(rot)) { erros.push(`${rot}: nó repetido`); continue } vistos.add(rot)
      if (n.kind === 'bloco' && (n.spec as { codigo?: unknown } | undefined)?.codigo !== undefined) { erros.push(`${rot}: bloco com \`codigo\` é da plataforma`); continue }
      const { tenantId: _t, segmento: _g, filhos: _f, ...limpo } = n
      try { ok.push(reg.registra({ ...limpo, tenantId } as never)) } catch (e) { erros.push(...((e as { detalhes?: Erro[] }).detalhes?.map((d) => `${rot}: ${fmt(d)}`) ?? [`${rot}: ${(e as Error).message}`]).slice(0, 5)) }
    }
    if (!erros.length) for (const no of ok) { for (const e of reg.verifica(no, { tenantId })) erros.push(`${no.kind}:${no.id}: referência quebrada: ${e.caminho} ${e.mensagem}`); for (const e of validaEstrutura(reg, no, { tenantId })) erros.push(`${no.kind}:${no.id}: ${fmt(e)}`) }
    return erros.slice(0, 20)
  }

  const resumo = (r: Record<string, unknown>): ResumoModelo => { const c = r.conteudo as Modelo; return { slug: c.slug, nome: c.nome, descricao: c.descricao ?? null, segmento: c.segmento ?? null, versao: c.versao, idiomas: c.idiomas, miniatura: c.miniatura ?? null, seq: Number(r.seq), nNos: c.nos.length, autor: r.autor as string, nota: (r.nota as string | null) ?? null, criadoEm: new Date(r.criado_em as string).toISOString() } }
  const cabeca = async (tenantId: string, slug: string) => (await q(`SELECT slug, seq, conteudo, hash, autor, nota, criado_em FROM plataforma.template_versao WHERE tenant_id = $1 AND slug = $2 ORDER BY seq DESC LIMIT 1`, [tenantId, slug])).rows[0]

  return {
    confere,
    /** grava uma versão nova do modelo (conteúdo idêntico à cabeça não cria outra) */
    async salva(tenantId: string, autor: string, slug: string, dado: unknown, nota?: string): Promise<ResultadoModelo> {
      if (!SLUG.test(slug)) return { ok: false, erros: ['slug inválido (minúsculas, números e hífen)'] }
      if (!dado || typeof dado !== 'object' || Array.isArray(dado)) return { ok: false, erros: ['o modelo deve ser um objeto'] }
      const d = dado as Record<string, unknown>, erros: string[] = []
      for (const k of Object.keys(d)) if (!['nome', 'descricao', 'segmento', 'versao', 'idiomas', 'miniatura', 'nos'].includes(k)) erros.push(`campo desconhecido: ${k.slice(0, 30)}`)
      if (typeof d.nome !== 'string' || !d.nome.trim() || d.nome.length > 120) erros.push('nome: texto de 1 a 120 caracteres')
      if (d.descricao !== undefined && d.descricao !== null && (typeof d.descricao !== 'string' || d.descricao.length > 1000)) erros.push('descricao: até 1000 caracteres')
      if (d.segmento !== undefined && d.segmento !== null && (typeof d.segmento !== 'string' || d.segmento.length > 40)) erros.push('segmento: até 40 caracteres')
      if (d.miniatura !== undefined && d.miniatura !== null && (typeof d.miniatura !== 'string' || d.miniatura.length > 300)) erros.push('miniatura: até 300 caracteres')
      if (typeof d.versao !== 'string' || !SEMVER.test(d.versao)) erros.push('versao: use o formato 1.2.3')
      if (!Array.isArray(d.idiomas) || !d.idiomas.length || d.idiomas.length > 20 || d.idiomas.some((i) => typeof i !== 'string' || !/^[a-z]{2,3}(-[A-Za-z0-9]{2,8})*$/.test(i))) erros.push('idiomas: lista de 1 a 20 códigos (o primeiro é o padrão), ex.: ["pt-BR","en"]')
      if (!Array.isArray(d.nos) || !d.nos.length) erros.push('nos: lista com pelo menos um nó')
      else if (d.nos.length > LIM.maxNos) erros.push(`nos: no máximo ${LIM.maxNos}`)
      else if (d.nos.some((n) => !n || typeof n !== 'object' || Array.isArray(n))) erros.push('nos: cada nó deve ser um objeto')
      if (erros.length) return { ok: false, erros }
      if (JSON.stringify(d).length > LIM.maxBytes) return { ok: false, erros: [`o modelo excede ${LIM.maxBytes} bytes`] }
      const t = (await q(`SELECT status FROM plataforma.tenant WHERE id = $1`, [tenantId])).rows[0] as { status: string } | undefined
      if (!t) return { ok: false, erros: ['tenant inexistente'] }; if (t.status === 'cancelado') return { ok: false, erros: ['tenant encerrado'] }
      const ne = confere(tenantId, d.nos as Array<Record<string, unknown>>); if (ne.length) return { ok: false, erros: ne }
      const conteudo: Modelo = { slug, nome: (d.nome as string).trim(), descricao: (d.descricao as string | null | undefined) ?? null, segmento: (d.segmento as string | null | undefined) ?? null, versao: d.versao as string, idiomas: d.idiomas as string[], miniatura: (d.miniatura as string | null | undefined) ?? null, nos: (d.nos as Array<Record<string, unknown>>).map(({ tenantId: _t, segmento: _g, filhos: _f, ...n }) => n) }
      const hash = hashDe(conteudo), cab = await cabeca(tenantId, slug)
      if (cab && cab.hash === hash && cab.conteudo !== null) return { ok: true, seq: Number(cab.seq), novo: false }
      if (!cab || cab.conteudo === null) { const n = Number((await q(`SELECT count(*)::int AS n FROM (SELECT DISTINCT ON (slug) conteudo FROM plataforma.template_versao WHERE tenant_id = $1 ORDER BY slug, seq DESC) x WHERE conteudo IS NOT NULL`, [tenantId])).rows[0]!.n); if (n >= LIM.maxModelos) return { ok: false, erros: [`limite de ${LIM.maxModelos} modelos`] } }
      if (cab && Number(cab.seq) >= LIM.maxVersoes) return { ok: false, erros: [`limite de ${LIM.maxVersoes} versões deste modelo`] }
      for (let i = 0; i < 40; i++) {
        const seq = cab ? Number(cab.seq) + 1 + i : 1 + i
        try { await q(`INSERT INTO plataforma.template_versao (tenant_id, slug, seq, conteudo, hash, autor, nota) VALUES ($1, $2, $3, $4::jsonb, $5, $6, $7)`, [tenantId, slug, seq, JSON.stringify(conteudo), hash, autor, nota?.slice(0, 300) ?? null]); return { ok: true, seq, novo: true } }
        catch (e) { if ((e as { code?: string }).code !== '23505') throw e; await new Promise((r) => setTimeout(r, Math.random() * 20)) } // outro gravou o mesmo seq: tenta o próximo
      }
      return { ok: false, erros: ['muita concorrência ao gravar o modelo: tente de novo'] }
    },
    /** os modelos do tenant (cabeças, sem os nós): leve de propósito */
    async lista(tenantId: string): Promise<ResumoModelo[]> {
      return (await q(`SELECT DISTINCT ON (slug) slug, seq, conteudo, autor, nota, criado_em FROM plataforma.template_versao WHERE tenant_id = $1 ORDER BY slug, seq DESC`, [tenantId])).rows.filter((r) => r.conteudo !== null).map(resumo)
    },
    /** um modelo inteiro (com os nós): a cabeça ou a versão `seq` */
    async le(tenantId: string, slug: string, seq?: number): Promise<{ seq: number; autor: string; nota: string | null; criadoEm: string; modelo: Modelo } | null> {
      if (!SLUG.test(slug)) return null
      const r = seq === undefined ? await cabeca(tenantId, slug) : (await q(`SELECT slug, seq, conteudo, hash, autor, nota, criado_em FROM plataforma.template_versao WHERE tenant_id = $1 AND slug = $2 AND seq = $3`, [tenantId, slug, seq])).rows[0]
      if (!r || r.conteudo === null) return null
      return { seq: Number(r.seq), autor: r.autor as string, nota: (r.nota as string | null) ?? null, criadoEm: new Date(r.criado_em as string).toISOString(), modelo: r.conteudo as Modelo }
    },
    /** as versões do modelo, da mais nova à mais antiga (a lápide aparece como `removido`) */
    async historico(tenantId: string, slug: string, limite = 50): Promise<Array<{ seq: number; versao: string | null; autor: string; nota: string | null; criadoEm: string; removido: boolean; nNos: number }>> {
      return (await q(`SELECT seq, conteudo, autor, nota, criado_em FROM plataforma.template_versao WHERE tenant_id = $1 AND slug = $2 ORDER BY seq DESC LIMIT $3`, [tenantId, slug, Math.min(Math.max(limite, 1), 200)])).rows
        .map((r) => ({ seq: Number(r.seq), versao: r.conteudo === null ? null : (r.conteudo as Modelo).versao, autor: r.autor as string, nota: (r.nota as string | null) ?? null, criadoEm: new Date(r.criado_em as string).toISOString(), removido: r.conteudo === null, nNos: r.conteudo === null ? 0 : (r.conteudo as Modelo).nos.length }))
    },
    /** remove (lápide): as versões antigas continuam no histórico e `salva` do mesmo slug o traz de volta */
    async remove(tenantId: string, autor: string, slug: string): Promise<boolean> {
      const cab = await cabeca(tenantId, slug); if (!cab || cab.conteudo === null) return false
      await q(`INSERT INTO plataforma.template_versao (tenant_id, slug, seq, conteudo, hash, autor, nota) VALUES ($1, $2, $3, NULL, $4, $5, 'removido')`, [tenantId, slug, Number(cab.seq) + 1, hashDe(null), autor]); return true
    },
    /** aplica o modelo ao tenant (veja o topo do arquivo). Valida TUDO antes de gravar; os nós gravados ficam como rascunho até a release. */
    async aplica(tenantId: string, autor: string, slug: string, opc: { seq?: number; publicar?: boolean; nota?: string } = {}): Promise<ResultadoAplica> {
      const m = await this.le(tenantId, slug, opc.seq); if (!m) return { ok: false, erros: ['modelo inexistente'] }
      // 1) as fotos: `@img/<nome>` → o ativo do tenant com esse nome (o mais recente); faltou algum, nada é gravado
      const nomes = new Set<string>(); for (const mt of JSON.stringify(m.modelo.nos).matchAll(IMG)) nomes.add(mt[1]!)
      const urls = new Map<string, string>(); if (nomes.size) { for (const a of (await o.ativos?.lista(tenantId)) ?? []) if (nomes.has(a.nome) && !urls.has(a.nome)) urls.set(a.nome, a.caminho); const falta = [...nomes].filter((n) => !urls.has(n)); if (falta.length) return { ok: false, erros: [`faltam as imagens do tenant: ${falta.slice(0, 20).join(', ')} (envie-as com esses nomes nos ativos)`] } }
      const nos = JSON.parse(JSON.stringify(m.modelo.nos).replace(IMG, (_x, n: string) => urls.get(n) ?? _x)) as Array<Record<string, unknown>>
      // 2) o nó `tenant` do modelo não vira override: o do tenant continua dono do alias, dos módulos e do nome; o modelo só dá tema, páginas, página de erro e idiomas
      const alias = await o.tenantNo?.(tenantId), modeloSite = nos.filter((n) => n.kind === 'tenant'), doSite = modeloSite.find((n) => n.id === alias) ?? modeloSite[0]
      const comuns = nos.filter((n) => n.kind !== 'tenant'), erros = confere(tenantId, nos); if (erros.length) return { ok: false, erros }
      // 3) grava na ordem das dependências (cada nó é validado pelo armazém junto com os outros já gravados do tenant)
      const ord = (n: Record<string, unknown>) => { const i = ORDEM.indexOf(String(n.kind)); return i < 0 ? ORDEM.length : i }
      for (const n of [...comuns].sort((a, b) => ord(a) - ord(b))) {
        const r = await o.armazem.salva(tenantId, autor, { ...n, estatuto: 'publicado' }, `modelo ${slug} ${m.modelo.versao}${opc.nota ? `: ${opc.nota}` : ''}`.slice(0, 300))
        if (!r.ok) return { ok: false, erros: r.erros.map((e) => `${String(n.kind)}:${String(n.id)}: ${e}`).slice(0, 20) }
      }
      let site = false
      if (doSite && alias) {
        const cab = (await o.armazem.cabecas(tenantId)).find((c) => c.kind === 'tenant' && c.id === alias), atual = (cab?.conteudo ?? o.base.resolve('tenant', alias, { tenantId })?.no) as Record<string, unknown> | undefined
        if (atual) {
          const dele = (doSite.spec ?? {}) as Record<string, unknown>, spec = { ...(atual.spec as object) } as Record<string, unknown>
          for (const k of ['tema', 'paginas', 'paginaNaoEncontrada', 'idiomas', 'idiomaPadrao']) if (dele[k] !== undefined) spec[k] = dele[k]
          const { tenantId: _t, segmento: _g, ...resto } = atual
          const r = await o.armazem.salva(tenantId, autor, { ...resto, versao: proxima(String(atual.versao ?? '1.0.0')), spec }, `modelo ${slug} ${m.modelo.versao}: configuração do site`, { configDoSite: true })
          if (!r.ok) return { ok: false, erros: r.erros.map((e) => `tenant:${alias}: ${e}`).slice(0, 20) }
          site = true
        }
      }
      // 4) publicar (opcional)
      let release: number | null = null
      if (opc.publicar) { if (!o.publicar) return { ok: false, erros: ['publicar não está disponível neste ambiente (os nós foram gravados como rascunho)'] }; const p = await o.publicar({ tenantId, autor, nota: `modelo ${slug} ${m.modelo.versao}` }); if (!p.ok) return { ok: false, erros: p.erros }; release = p.release }
      return { ok: true, nos: comuns.length + (site ? 1 : 0), fotos: [...nomes], site, release }
    },
  }
}
