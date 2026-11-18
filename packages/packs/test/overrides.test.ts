import { PGlite } from '@electric-sql/pglite'
import { registraBase } from '@polaris/engine'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { DDL_DIRETORIO, criaArmazemDeNos, diretorioSql, registroDaPlataforma } from '../src/index'

const A = '11111111-1111-1111-1111-111111111111', B = '22222222-2222-2222-2222-222222222222'
let pg: PGlite
const q = async (s: string, p: unknown[] = []) => { const r = await pg.query(s, p); return { rows: r.rows as Array<Record<string, unknown>>, rowCount: r.affectedRows ?? r.rows.length } }
const base = registroDaPlataforma(); registraBase(base)
const modulos: Record<string, string[]> = { [A]: ['catalogo', 'vendas'], [B]: ['estoque'] }
const arm = () => criaArmazemDeNos({ q, base, modulosDe: async (t) => modulos[t] ?? [] })
const no = (kind: string, id: string, spec: object, extra: object = {}) => ({ kind, id, versao: '1.0.0', estatuto: 'publicado', spec, ...extra })
const pagina = (id: string, texto = 'oi', extra: object = {}) => no('pagina', id, { rota: `/${id}`, raiz: { bloco: 'texto/paragrafo', props: { texto } } }, extra)
async function tenant(id: string, alias: string, status = 'ativo') { await diretorioSql(q).cria({ tenantId: id, alias, nome: alias, segmento: 'varejo', packs: ['varejo'], donoEmail: `${alias}@x.com`, chave: `chave-ov-${alias}-xxxxxxxxxx` }); await q(`UPDATE plataforma.tenant SET status = $2 WHERE id = $1`, [id, status]) }
beforeAll(async () => { pg = new PGlite(); await pg.exec(DDL_DIRETORIO); await tenant(A, 'tenant-a'); await tenant(B, 'tenant-b'); await tenant('33333333-3333-3333-3333-333333333333', 'tenant-c', 'cancelado') })
afterAll(async () => { await pg.close() })
const erros = async (t: string, dado: unknown) => { const r = await arm().salva(t, 'ana', dado); return r.ok ? [] : r.erros }

describe('versões imutáveis: histórico, idempotência, remoção', () => {
  it('cada alteração é uma versão nova; o mesmo conteúdo não cria outra; a cabeça é a mais recente; o histórico guarda autor e nota', async () => {
    const a = arm(); const v1 = await a.salva(A, 'ana', pagina('promo', 'v1'), 'primeira'); expect(v1).toMatchObject({ ok: true, novo: true, versao: { seq: 1, autor: 'ana', nota: 'primeira' } })
    const igual = await a.salva(A, 'bia', pagina('promo', 'v1')); expect(igual).toMatchObject({ ok: true, novo: false, versao: { seq: 1 } })
    const v2 = await a.salva(A, 'bia', pagina('promo', 'v2')); expect(v2).toMatchObject({ ok: true, novo: true, versao: { seq: 2, autor: 'bia' } })
    expect((await a.historico(A, 'pagina', 'promo')).map((v) => [v.seq, v.autor, v.nota])).toEqual([[2, 'bia', null], [1, 'ana', 'primeira']])
    expect((await a.cabecas(A)).find((c) => c.id === 'promo')).toMatchObject({ seq: 2 }); expect(((await a.versao(A, 'pagina', 'promo', 1))!.conteudo as any).spec.raiz.props.texto).toBe('v1'); expect(await a.versao(A, 'pagina', 'promo', 9)).toBeNull()
  })
  it('o banco RECUSA alterar ou apagar uma versão (imutabilidade não depende do código)', async () => {
    await arm().salva(A, 'ana', pagina('imutavel')); await expect(q(`UPDATE plataforma.no_versao SET autor = 'x' WHERE id = 'imutavel'`)).rejects.toThrow(/imutáveis/); await expect(q(`DELETE FROM plataforma.no_versao WHERE id = 'imutavel'`)).rejects.toThrow(/imutáveis/)
  })
  it('remover grava uma LÁPIDE: sai das cabeças e do registro, o histórico continua, e recriar vira versão nova', async () => {
    const a = arm(); await a.salva(A, 'ana', pagina('descartavel', 'a')); expect(await a.remove(A, 'pagina', 'descartavel', 'ana', 'não serve mais')).toEqual({ ok: true }); expect(await a.remove(A, 'pagina', 'descartavel', 'ana')).toEqual({ ok: true })
    expect((await a.cabecas(A)).map((c) => c.id)).not.toContain('descartavel'); expect((await a.historico(A, 'pagina', 'descartavel')).map((v) => [v.seq, v.removido])).toEqual([[2, true], [1, false]]); expect((await a.registroDoTenant(A)).registro.ids('pagina')).not.toContain('descartavel')
    expect(await a.salva(A, 'ana', pagina('descartavel', 'a'))).toMatchObject({ ok: true, novo: true, versao: { seq: 3 } }); expect(await a.remove(A, 'pagina', 'nunca-existiu', 'ana')).toEqual({ ok: false, erro: 'nó inexistente' })
  })
  it('gravações simultâneas do MESMO nó não se atropelam: cada uma ganha o seu `seq`', async () => {
    const a = arm(); const rs = await Promise.all(Array.from({ length: 6 }, (_, i) => a.salva(A, `u${i}`, pagina('corrida', `texto ${i}`)))); expect(rs.every((r) => r.ok)).toBe(true)
    expect((await a.historico(A, 'pagina', 'corrida')).map((v) => v.seq).sort()).toEqual([1, 2, 3, 4, 5, 6])
  })
})

describe('o que um tenant NÃO pode gravar', () => {
  it('kinds da plataforma (serviço, evento, kernel, backend, pack, tenant) são recusados', async () => {
    for (const kind of ['servico', 'evento', 'kernel', 'backend', 'pack', 'tenant', 'quiral']) expect((await erros(A, no(kind, 'x', {}))).join(), kind).toMatch(/não sobrescreve/)
  })
  it('escopo: não publica em segmento, não declara outro tenant, não leva `filhos`; o `tenantId` gravado é SEMPRE o do dono', async () => {
    expect(await erros(A, pagina('p1', 'x', { segmento: 'varejo' }))).toEqual(['um tenant não publica em escopo de segmento']); expect(await erros(A, pagina('p1b', 'x', { segmento: 'outro' }))).toContain('um tenant não publica em escopo de segmento'); expect((await erros(A, pagina('p2', 'x', { tenantId: B }))).join()).toMatch(/outro tenant/); expect((await erros(A, pagina('p3', 'x', { filhos: [pagina('p4')] }))).join()).toMatch(/filhos/)
    expect((await arm().salva(A, 'ana', pagina('p5', 'x', { tenantId: A }))).ok).toBe(true); expect((await arm().registroDoTenant(A)).registro.resolve('pagina', 'p5', { tenantId: A })!.escopo).toBe('tenant'); expect((await arm().registroDoTenant(B)).registro.ids('pagina')).not.toContain('p5')
  })
  it('bloco com `codigo` (executa) é recusado; bloco por composição é aceito', async () => {
    expect((await erros(A, no('bloco', 'meu.codigo', { interface: 'meu/codigo', codigo: { modo: 'puro', fonte: 'x' } }))).join()).toMatch(/COMPOSIÇÃO/)
    expect((await erros(A, no('bloco', 'meu.cartao', { interface: 'meu/cartao', extends: 'texto/paragrafo' }))).filter((e) => !/interface/.test(e))).toEqual([])
  })
  it('tamanho, id e tenant inválidos; tenant encerrado e inexistente', async () => {
    expect((await erros(A, pagina('grande', 'x'.repeat(300_000)))).join()).toMatch(/excede/); for (const id of ['', 'Maiuscula', '../x', 'a b', 'x'.repeat(200)]) expect((await erros(A, pagina(id))).length, id).toBeGreaterThan(0)
    expect(await erros('lixo', pagina('x'))).toEqual(['tenant inválido']); expect(await erros('33333333-3333-3333-3333-333333333333', pagina('x'))).toEqual(['tenant encerrado']); expect(await erros('99999999-9999-9999-9999-999999999999', pagina('x'))).toEqual(['tenant inexistente'])
    for (const lixo of [null, 42, 'x', [], undefined]) expect((await erros(A, lixo)).length, String(lixo)).toBeGreaterThan(0)
  })
})

describe('validação CONTRA o registro do tenant', () => {
  it('página com bloco inexistente, props inválidas e dado inexistente é recusada com a causa', async () => {
    expect((await erros(A, no('pagina', 'quebrada', { rota: '/q', raiz: { bloco: 'bloco/que-nao-existe' } }))).join()).toMatch(/bloco|referência/i)
    expect((await erros(A, no('pagina', 'quebrada2', { rota: '/q2', dados: { x: 'dados.fantasma' }, raiz: { bloco: 'texto/paragrafo', props: { texto: 'a' } } }))).join()).toMatch(/dados.fantasma|referência/i)
    expect((await erros(A, no('pagina', 'sem-rota', { raiz: { bloco: 'texto/paragrafo' } }))).length).toBeGreaterThan(0)
  })
  it('um nó pode usar outro DO MESMO tenant (dados → página) e não o de outro tenant', async () => {
    const a = arm(); expect((await a.salva(A, 'ana', no('dados', 'dados.meus-produtos', { fonte: { tipo: 'servico', servico: 'catalogo', operacao: 'listarProduto' } }))).ok).toBe(true)
    expect((await a.salva(A, 'ana', no('pagina', 'usa-dado', { rota: '/u', dados: { produtos: 'dados.meus-produtos' }, raiz: { bloco: 'texto/paragrafo', props: { texto: 'x' } } }))).ok).toBe(true)
    expect((await erros(B, no('pagina', 'usa-dado', { rota: '/u', dados: { produtos: 'dados.meus-produtos' }, raiz: { bloco: 'texto/paragrafo', props: { texto: 'x' } } }))).join()).toMatch(/dados.meus-produtos|referência/i) // o `dados` é do A
  })
  it('`dados` só aponta para serviço HABILITADO do tenant e para operação que existe', async () => {
    expect((await erros(B, no('dados', 'dados.sem-modulo', { fonte: { tipo: 'servico', servico: 'catalogo', operacao: 'listarProduto' } }))).join()).toMatch(/não está habilitado/) // B só tem `estoque`
    expect((await erros(A, no('dados', 'dados.op-fantasma', { fonte: { tipo: 'servico', servico: 'catalogo', operacao: 'naoExiste' } }))).length).toBeGreaterThan(0)
  })
  it('papel: sujeito/ação/campo inexistentes são recusados; papel válido é aceito e passa a valer só para o tenant', async () => {
    expect((await erros(A, no('papel', 'caixa-x', { regras: [{ acoes: ['listar'], sujeitos: ['fantasma.coisa'] }] }))).join()).toMatch(/sujeito|existe/); expect((await erros(A, no('papel', 'caixa-y', { regras: [{ acoes: ['voar'], sujeitos: ['catalogo.produto'] }] }))).join()).toMatch(/ação|voar/)
    expect((await arm().salva(A, 'ana', no('papel', 'estagiario', { regras: [{ acoes: ['listar', 'obter'], sujeitos: ['catalogo.produto'], campos: ['nome', 'preco'] }] }))).ok).toBe(true)
    expect((await arm().registroDoTenant(A)).registro.resolve('papel', 'estagiario', { tenantId: A })).not.toBeNull(); expect((await arm().registroDoTenant(B)).registro.resolve('papel', 'estagiario', { tenantId: B })).toBeNull()
  })
  it('o override substitui o core SÓ para o dono: o registro base nunca muda e os outros tenants seguem no core', async () => {
    const a = arm(); const antes = JSON.stringify(base.ids('tema')); expect((await a.salva(A, 'ana', no('tema', 'tema.base', { tokens: { cor: { primaria: '#112233' } } }))).ok).toBe(true)
    const ra = (await a.registroDoTenant(A)).registro, rb = (await a.registroDoTenant(B)).registro
    expect(ra.resolve('tema', 'tema.base', { tenantId: A })!.escopo).toBe('tenant'); expect(rb.resolve('tema', 'tema.base', { tenantId: B })?.escopo ?? 'core').not.toBe('tenant'); expect(base.resolve('tema', 'tema.base', { tenantId: A })?.escopo ?? 'core').not.toBe('tenant'); expect(JSON.stringify(base.ids('tema'))).toBe(antes)
  })
})

describe('registro do tenant a partir do armazém', () => {
  it('nó corrompido no banco NÃO derruba o tenant: é pulado e reportado; as outras páginas seguem', async () => {
    const a = arm(); await a.salva(A, 'ana', pagina('saudavel', 'ok'))
    await q(`SET session_replication_role = replica`).catch(() => null); await q(`INSERT INTO plataforma.no_versao (tenant_id, kind, id, seq, conteudo, hash, autor) VALUES ($1, 'pagina', 'corrompida', 1, '{"kind":"pagina","id":"corrompida","versao":"1.0.0","spec":{"lixo":true}}', 'h', 'x')`, [A])
    const { registro, ignorados } = await a.registroDoTenant(A); expect(registro.ids('pagina')).toContain('saudavel'); expect(registro.ids('pagina')).not.toContain('corrompida'); expect(ignorados.join()).toMatch(/corrompida/)
  })
  it('versões fixadas (escolha): reconstrói o tenant EXATAMENTE como estava; versão inexistente é reportada', async () => {
    const a = arm(); await a.salva(A, 'ana', pagina('fixada', 'primeira')); await a.salva(A, 'ana', pagina('fixada', 'segunda'))
    const r1 = await a.registroDoTenant(A, new Map([['pagina:fixada', 1]])); expect((r1.registro.resolve('pagina', 'fixada', { tenantId: A })!.no.spec as any).raiz.props.texto).toBe('primeira'); expect(r1.registro.ids('pagina')).not.toContain('saudavel') // só o que a release fixou
    expect((await a.registroDoTenant(A, new Map([['pagina:fixada', 77]]))).ignorados.join()).toMatch(/inexistente/)
  })
  it('isolamento: o armazém de um tenant não lista nem lê as versões de outro', async () => {
    const a = arm(); expect((await a.lista(B)).map((v) => v.id)).not.toContain('promo'); expect(await a.versao(B, 'pagina', 'promo', 1)).toBeNull(); expect(await a.historico(B, 'pagina', 'promo')).toEqual([])
  })
})

describe('limites', () => {
  it('número máximo de overrides por tenant e de versões por nó', async () => {
    const pequeno = criaArmazemDeNos({ q, base, limites: { maxNos: 3, maxVersoesPorNo: 2 } }); const T = '44444444-4444-4444-4444-444444444444'; await tenant(T, 'tenant-d')
    for (const id of ['n1', 'n2', 'n3']) expect((await pequeno.salva(T, 'x', pagina(id))).ok).toBe(true); expect((await pequeno.salva(T, 'x', pagina('n4')))).toMatchObject({ ok: false, erros: [expect.stringContaining('limite de 3')] })
    expect((await pequeno.salva(T, 'x', pagina('n1', 'novo texto'))).ok).toBe(true); expect((await pequeno.salva(T, 'x', pagina('n1', 'mais um')))).toMatchObject({ ok: false, erros: [expect.stringContaining('limite de 2 versões')] })
    await pequeno.remove(T, 'pagina', 'n2', 'x'); expect((await pequeno.salva(T, 'x', pagina('n4'))).ok).toBe(true) // removido libera vaga
  })
})
