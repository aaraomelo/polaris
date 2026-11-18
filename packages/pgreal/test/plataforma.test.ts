import { DDL_DIRETORIO, criaArmazemDeNos, criaGestorDominios, criaReleases, diretorioSql, mudaStatusTenant, planoDeCadastro, provisiona, registroDaPlataforma, type PortasCadastro } from '@polaris/packs'
import { registraBase } from '@polaris/engine'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { criaBanco, temPostgres, type Banco } from '../src/harness'

// A plataforma (diretório, releases, cadastro, domínios) com várias conexões de verdade.
const base = registroDaPlataforma(); registraBase(base)
const tudo = async <T>(n: number, f: (i: number) => Promise<T>) => Promise.all(Array.from({ length: n }, (_, i) => f(i)))
let b: Banco
type Q = (s: string, p?: unknown[]) => Promise<{ rows: Array<Record<string, unknown>>; rowCount: number }>
const q: Q = async (s, p = []) => { const r = await b.admin.query(s, p); return { rows: r.rows, rowCount: r.rowCount ?? 0 } }
const tx = async <T>(fn: (qq: Q) => Promise<T>): Promise<T> => { const c = await b.admin.connect(); try { await c.query('BEGIN'); const r = await fn(async (s, p = []) => { const x = await c.query(s, p as unknown[]); return { rows: x.rows, rowCount: x.rowCount ?? 0 } }); await c.query('COMMIT'); return r } catch (e) { await c.query('ROLLBACK').catch(() => {}); throw e } finally { c.release() } }
const arm = () => criaArmazemDeNos({ q, base })
const rel = () => criaReleases({ db: { transacao: tx }, armazemDe: (qq) => criaArmazemDeNos({ q: qq, base }) })
const pagina = (id: string, texto = 'oi') => ({ kind: 'pagina', id, versao: '1.0.0', estatuto: 'publicado', spec: { rota: `/${id}`, raiz: { bloco: 'texto/paragrafo', props: { texto } } } })
async function tenant(alias: string): Promise<string> { const id = crypto.randomUUID(); await diretorioSql(q).cria({ tenantId: id, alias, nome: alias, segmento: 'varejo', packs: ['varejo'], donoEmail: `${alias}@x.com`, chave: `chave-real-${alias}-xxxxxxxx` }); await q(`UPDATE plataforma.tenant SET status = 'ativo' WHERE id = $1`, [id]); return id }

describe.skipIf(!temPostgres)('Plataforma sob concorrência (Postgres real)', () => {
  beforeAll(async () => { b = await criaBanco('plataforma'); await b.admin.query(DDL_DIRETORIO) })
  afterAll(async () => { await b?.fecha() })

  it('RELEASE: 16 `cria` simultâneas do mesmo estado (8 rodadas) dão UMA release (a trava do tenant serializa); sem ela, colidem na chave primária', async () => {
    for (let rodada = 0; rodada < 8; rodada++) { // várias rodadas: a janela da corrida é curta, e uma rodada só pode "passar por sorte"
      const T = await tenant(`rel-1-${rodada}`); await arm().salva(T, 'ana', pagina('home', 'a')); const rs = await tudo(16, (i) => rel().cria(T, `u${i}`))
      expect(rs.every((r) => r.ok), `rodada ${rodada}`).toBe(true); expect(new Set(rs.map((r) => (r as { release: { numero: number } }).release.numero))).toEqual(new Set([1])); expect(rs.filter((r) => (r as { nova: boolean }).nova).length).toBe(1)
    }
  })
  it('PROMOÇÕES simultâneas: o ponteiro termina em UMA release, o diário tem uma entrada por troca, sem buracos, e `anterior` é coerente', async () => {
    const T = await tenant('rel-2'); const a = arm(); const nums: number[] = []
    for (let i = 1; i <= 6; i++) { await a.salva(T, 'ana', pagina('home', `v${i}`)); nums.push(((await rel().cria(T, 'ana')) as { release: { numero: number } }).release.numero) }
    const rs = await tudo(6, (i) => rel().promove(T, nums[i]!, `u${i}`)); expect(rs.every((r) => r.ok)).toBe(true)
    const p = (await q(`SELECT producao, anterior FROM plataforma.release_ponteiro WHERE tenant_id = $1`, [T])).rows[0]!; expect(nums).toContain(Number(p.producao))
    const d = (await q(`SELECT n, de, para FROM plataforma.release_evento WHERE tenant_id = $1 ORDER BY n`, [T])).rows; expect(d.map((x) => Number(x.n))).toEqual([1, 2, 3, 4, 5, 6]) // um por troca, sem buraco nem repetição
    for (let i = 1; i < d.length; i++) expect(d[i]!.de).toBe(d[i - 1]!.para) // a cadeia fecha: cada troca parte de onde a anterior chegou
    expect(Number(p.producao)).toBe(Number(d.at(-1)!.para)); expect(Number(p.anterior)).toBe(Number(d.at(-1)!.de))
  })
  it('GRAVAÇÕES simultâneas do mesmo nó ganham `seq` distintos, sem perder nenhuma', async () => {
    const T = await tenant('rel-3'); const rs = await tudo(15, (i) => arm().salva(T, `u${i}`, pagina('corrida', `texto ${i}`))); expect(rs.every((r) => r.ok)).toBe(true)
    expect((await q(`SELECT seq FROM plataforma.no_versao WHERE tenant_id = $1 AND id = 'corrida' ORDER BY seq`, [T])).rows.map((r) => Number(r.seq))).toEqual(Array.from({ length: 15 }, (_, i) => i + 1))
  })
  it('CADASTRO: 10 cadastros simultâneos do MESMO alias (chaves diferentes) → exatamente 1 vence; os outros recebem `alias_ocupado` e NADA é provisionado por eles', async () => {
    const semeadas: string[] = []; const portas = (): PortasCadastro => ({ diretorio: diretorioSql(q), novoId: () => crypto.randomUUID(), identidade: { async convida(c) { semeadas.push(`dono:${c.email}`) } }, semeia: async (c) => { semeadas.push(`${c.servico}.${c.entidade}`); return { id: crypto.randomUUID() } }, landing: { async publica() { semeadas.push('landing') } } })
    const plano = (i: number) => { const r = planoDeCadastro(registroDaPlataforma(), { alias: 'disputada', nome: `Loja ${i}`, packs: ['varejo'], dono: { email: `dono${i}@x.com`, nome: 'Dono' }, aceiteTermos: true }); if (!r.ok) throw new Error(r.erros.join()); return r.plano }
    const rs = await tudo(10, (i) => provisiona(plano(i), `chave-disputa-${String(i).padStart(3, '0')}-xxxxxxxx`, portas()))
    expect(rs.filter((r) => r.ok).length).toBe(1); expect(rs.filter((r) => !r.ok && r.motivo === 'alias_ocupado').length).toBe(9)
    expect(semeadas.filter((s) => s.startsWith('dono:')).length).toBe(1) // só o vencedor foi convidado/semeado
    expect((await q(`SELECT count(*)::int AS n FROM plataforma.tenant WHERE alias = 'disputada'`)).rows[0]!.n).toBe(1)
  })
  it('CADASTRO IDEMPOTENTE: a MESMA chave repetida 8 vezes ao mesmo tempo cria um tenant só', async () => {
    const r = planoDeCadastro(registroDaPlataforma(), { alias: 'mesma-chave', nome: 'Mesma', packs: ['alimentos'], dono: { email: 'm@x.com', nome: 'Maria' }, aceiteTermos: true }); if (!r.ok) throw new Error('plano'); let convites = 0
    const portas: PortasCadastro = { diretorio: diretorioSql(q), novoId: () => crypto.randomUUID(), identidade: { async convida() { convites++ } }, semeia: async () => ({ id: crypto.randomUUID() }), landing: { async publica() {} } }
    const rs = await tudo(8, () => provisiona(r.plano, 'chave-mesma-concorrente-1', portas)); expect(rs.filter((x) => x.ok).length).toBeGreaterThanOrEqual(1)
    expect((await q(`SELECT count(*)::int AS n FROM plataforma.tenant WHERE alias = 'mesma-chave'`)).rows[0]!.n).toBe(1); expect(new Set(rs.filter((x) => x.ok).map((x) => (x as { tenantId: string }).tenantId)).size).toBe(1)
  })
  it('DOMÍNIO: dois tenants provando a posse do mesmo domínio ao mesmo tempo → só um fica VERIFICADO (índice único parcial)', async () => {
    const T1 = await tenant('dom-1'), T2 = await tenant('dom-2'); const dns = { txt: async () => ['polaris-verificacao=tok-dom-1', 'polaris-verificacao=tok-dom-2'] }
    const g1 = criaGestorDominios({ q, dns, bases: ['polaris.app'], novoToken: () => 'tok-dom-1' }), g2 = criaGestorDominios({ q, dns, bases: ['polaris.app'], novoToken: () => 'tok-dom-2' })
    await g1.adiciona(T1, 'disputado.com'); await g2.adiciona(T2, 'disputado.com')
    const rs = await Promise.allSettled([g1.verifica(T1, 'disputado.com'), g2.verifica(T2, 'disputado.com')])
    expect((await q(`SELECT count(*)::int AS n FROM plataforma.dominio WHERE dominio = 'disputado.com' AND verificado`)).rows[0]!.n).toBe(1) // nunca dois
    expect(rs.filter((r) => r.status === 'fulfilled' && r.value === 'verificado').length).toBeGreaterThanOrEqual(1)
  })
  it('STATUS: suspender e cancelar ao mesmo tempo terminam em estado válido (cancelado é terminal), sem corrida', async () => {
    for (let i = 0; i < 80; i++) { const T = await tenant(`st-${i}`); await Promise.all([tx((qq) => mudaStatusTenant(qq, T, 'cancelado')), ...Array.from({ length: 5 }, () => tx((qq) => mudaStatusTenant(qq, T, 'suspenso')))]); expect((await q(`SELECT status FROM plataforma.tenant WHERE id = $1`, [T])).rows[0]!.status, `tenant ${i}`).toBe('cancelado') } // `cancelado` é terminal: um suspenso atrasado nunca o desfaz
  })
})
