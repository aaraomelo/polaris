process.env.POLARIS_LOG_NIVEL = 'silencio'
import { vi } from 'vitest'
vi.setConfig({ testTimeout: 90_000, hookTimeout: 90_000 })
import { registraBase } from '@polaris/engine'
import { registraTemas } from '@polaris/engine/tema'
import { PGlite } from '@electric-sql/pglite'
import { criaAutenticadorJwt } from '@polaris/acesso'
import type { Consulta, DbTenant } from '@polaris/eventos'
import { emite, validaEstrutura, type No, type Registry } from '@polaris/schema'
import { contextoPorJwt, criaServico, regrasDoRegistry } from '@polaris/servico'
import Fastify, { type FastifyInstance } from 'fastify'
import type { KeyObject } from 'node:crypto'
import { SignJWT, generateKeyPair } from 'jose'

type KeyLike = CryptoKey | KeyObject
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { DDL_DIRETORIO, criaAlimentos, criaEstoque, criaPagamentos, criaSemeador, criaServicos, diretorioSql, planoDeCadastro, provedorInterno, provisiona, registroDaPlataforma, rotasCadastro, segmentosDisponiveis, validaAlias, type Diretorio, type PedidoCadastro, type PortasCadastro } from '../src/index'

const reg = registroDaPlataforma()
const pedido = (o: Partial<PedidoCadastro> = {}): PedidoCadastro => ({ alias: 'minha-loja', nome: 'Minha Loja', packs: ['varejo'], dono: { email: 'Dona@Exemplo.com.br', nome: 'Dona Maria' }, aceiteTermos: true, ...o })
const plano = (o: Partial<PedidoCadastro> = {}) => { const r = planoDeCadastro(reg, pedido(o)); if (!r.ok) throw new Error(r.erros.join('; ')); return r.plano }
const erros = (o: Partial<PedidoCadastro>) => { const r = planoDeCadastro(reg, pedido(o)); return r.ok ? [] : r.erros }

describe('packs de fábrica: o catálogo de segmentos é íntegro', () => {
  it('toda referência resolve e toda semente bate com o contrato do serviço (se quebrasse, o cadastro quebraria em produção)', () => {
    const completo = reg.derivado(); registraBase(completo); registraTemas(completo) // as páginas do pack studio usam os blocos base: a verificação vê o mesmo registro que o servidor
    expect(completo.verificaTudo().filter((x) => x.erros.length)).toEqual([])
    for (const id of reg.ids('pack')) expect(validaEstrutura(reg, reg.resolve('pack', id)!.no), id).toEqual([])
  })
  it('o cadastro lista só os segmentos públicos, em ordem; a base financeira é oculta e o varejo vem pré-marcado', () => {
    expect(segmentosDisponiveis(reg).map((s) => [s.id, s.padrao])).toEqual([['varejo', true], ['servicos', false], ['alimentos', false]]); expect(segmentosDisponiveis(reg).map((s) => s.id)).not.toContain('base')
  })
})

describe('alias', () => {
  it('formato: 3 a 30, minúsculas/números/hífen, sem hífen nas pontas, sem duplo (punycode); reservados nunca', () => {
    for (const a of ['lojinha', 'minha-loja', 'a1b', 'x'.repeat(30), '  Loja-Boa  ']) expect(validaAlias(a).ok, a).toBe(true)
    for (const a of ['ab', 'x'.repeat(31), '-loja', 'loja-', 'lo--ja', 'xn--abc', 'loja_x', 'lo ja', 'lojá', 'loja.com', '', 42, null]) expect(validaAlias(a as never), String(a)).toMatchObject({ ok: false })
    for (const a of ['www', 'admin', 'API', 'login', 'polaris', 'pagamentos', 'suporte']) expect(validaAlias(a), a).toEqual({ ok: false, motivo: 'reservado' })
    expect(validaAlias('Minha-Loja')).toEqual({ ok: true, alias: 'minha-loja' }) // normaliza para minúsculas
  })
})

describe('plano de cadastro (puro e determinístico)', () => {
  it('varejo: base primeiro (dependência), serviços e papéis do dono, tenant com os módulos, landing com o nome', () => {
    const p = plano(); expect(p.packs).toEqual(['base', 'varejo']); expect(p.segmento).toBe('varejo'); expect(p.servicos).toEqual(['pagamentos', 'catalogo', 'vendas', 'estoque'])
    expect(p.papeisDono).toEqual(['pagamentos.financeiro', 'pagamentos.caixa', 'catalogo.gerente', 'vendas.gerente', 'estoque.gerente'])
    expect(p.tenant).toMatchObject({ kind: 'tenant', id: 'minha-loja', spec: { alias: 'minha-loja', nome: 'Minha Loja', segmento: 'varejo', modulos: p.servicos } })
    expect(p.landing).toMatchObject({ titulo: 'Minha Loja', chamada: 'Ver produtos' }); expect(p.dono).toEqual({ email: 'dona@exemplo.com.br', nome: 'Dona Maria' })
    expect(p.sementes.map((s) => `${s.servico}.${s.entidade}`)).toEqual(['pagamentos.configPagamento', 'pagamentos.configPagamento', 'pagamentos.caixa', 'estoque.deposito', 'catalogo.unidade'])
  })
  it('vários segmentos: o 1º escolhido define o segmento; união dos módulos; a semente repetida (depósito principal) vale UMA vez; destaques somados', () => {
    const p = plano({ packs: ['servicos', 'varejo'] }); expect(p.segmento).toBe('servicos'); expect(p.packs).toEqual(['base', 'servicos', 'varejo'])
    expect(p.servicos).toEqual(['pagamentos', 'servicos', 'estoque', 'catalogo', 'vendas']); expect(p.sementes.filter((s) => s.entidade === 'deposito').length).toBe(1)
    expect(p.landing!.titulo).toBe('Minha Loja'); expect(p.landing!.destaques.length).toBe(4); expect(p.landing!.subtitulo).toContain('Agende')
    expect(plano({ packs: ['varejo', 'varejo'] }).packs).toEqual(['base', 'varejo']) // repetido vira um só
  })
  it('é determinístico: o mesmo pedido dá o MESMO plano, e o pedido de entrada não é alterado', () => {
    const ped = pedido({ packs: ['alimentos', 'varejo'] }), antes = JSON.stringify(ped); const a = planoDeCadastro(reg, ped), b = planoDeCadastro(reg, ped)
    expect(JSON.stringify(a)).toBe(JSON.stringify(b)); expect(JSON.stringify(ped)).toBe(antes)
  })
  it('recusa com TODOS os motivos: alias, nome, e-mail, termos, segmento inexistente/oculto, nenhum ou demais segmentos', () => {
    expect(erros({ alias: 'ab', nome: 'x', dono: { email: 'nao-e-email', nome: '' }, aceiteTermos: false, packs: [] }).length).toBeGreaterThanOrEqual(5)
    expect(erros({ aceiteTermos: false })).toEqual(['é preciso aceitar os termos de uso']); expect(erros({ alias: 'admin' })).toEqual(['alias reservado'])
    expect(erros({ packs: ['base'] })[0]).toContain('inexistente ou indisponível'); expect(erros({ packs: ['fantasma'] })[0]).toContain('inexistente'); expect(erros({ packs: ['varejo', 'servicos', 'alimentos', 'base', 'x'] }).length).toBeGreaterThan(0)
    for (const email of ['a@b', '@b.com', 'a b@c.com', 'a@b..com', 'a@@b.com', `${'x'.repeat(250)}@b.com`, '<x>@b.com', 'a@-b.com']) expect(erros({ dono: { email, nome: 'Maria' } }), email).toEqual(['e-mail do responsável inválido'])
  })
  it('nome: espaços normalizados; caracteres de controle e override bidirecional (spoofing) recusados; tamanho', () => {
    expect(plano({ nome: '  Minha    Loja  ' }).nome).toBe('Minha Loja')
    for (const nome of ['x', 'a'.repeat(81), 'Loja\u0000x', 'Loja\u202Eevil', 'Loja\u2066x', 'Loja\u007Fx']) expect(erros({ nome }), JSON.stringify(nome)).toEqual(['nome do negócio inválido (2 a 80 caracteres, sem caracteres de controle)'])
    expect(plano({ nome: '{{nome}}' }).landing!.titulo).toBe('{{nome}}') // o nome é DADO: não é reinterpretado como modelo
    expect(plano({ nome: 'Pão & Cia <b>' }).nome).toBe('Pão & Cia <b>') // aceito como texto; quem exibe escapa
  })
  it('entrada hostil não derruba o planejador (tipos errados viram erro, não exceção)', () => {
    for (const lixo of [null, undefined, 42, [], 'x', { alias: {}, nome: [], packs: 'varejo', dono: 'x', aceiteTermos: 'true' }]) expect(() => planoDeCadastro(reg, lixo as never)).not.toThrow()
    expect(planoDeCadastro(reg, { alias: {}, nome: [], packs: 'varejo', dono: 'x', aceiteTermos: 'true' } as never).ok).toBe(false)
  })
  it('conflito declarado entre packs impede a combinação; ciclo é acusado', async () => {
    const { Registry } = await import('@polaris/schema'); const r = new Registry()
    for (const n of [{ kind: 'pack', id: 'a', versao: '1.0.0', estatuto: 'publicado', spec: { nome: 'A', segmento: 'varejo', inclui: {}, conflita: ['b'] } }, { kind: 'pack', id: 'b', versao: '1.0.0', estatuto: 'publicado', spec: { nome: 'B', segmento: 'servicos', inclui: {} } }, { kind: 'pack', id: 'c', versao: '1.0.0', estatuto: 'publicado', spec: { nome: 'C', segmento: 'outro', inclui: {}, depende: ['d'] } }, { kind: 'pack', id: 'd', versao: '1.0.0', estatuto: 'publicado', spec: { nome: 'D', segmento: 'outro', inclui: {}, depende: ['c'] } }]) r.registra(n)
    expect(planoDeCadastro(r, pedido({ packs: ['a', 'b'] }))).toEqual({ ok: false, erros: ["os segmentos 'a' e 'b' não podem ser combinados"] }); expect(planoDeCadastro(r, pedido({ packs: ['a'] })).ok).toBe(true)
    expect((planoDeCadastro(r, pedido({ packs: ['c'] })) as { erros: string[] }).erros[0]).toContain('circular')
  })
})

// ---------- o provisionador, com portas em memória ----------
function memoria(opcoes: { falhaEm?: { etapa: string; vezes: number }; semeiaSemId?: string } = {}) {
  const marcas: string[] = []; const tenants = new Map<string, { id: string; alias: string; chave: string; status: string; email: string; motivo?: string | null }>(); const etapas = new Map<string, Map<string, string | null>>(); const log: string[] = []; const falhas = { ...(opcoes.falhaEm ?? { etapa: '', vezes: 0 }) }
  let n = 0
  const dir: Diretorio = {
    async cria(t) { log.push('cria'); const porAlias = [...tenants.values()].find((x) => x.alias === t.alias), porChave = [...tenants.values()].find((x) => x.chave === t.chave)
      if (porChave && porChave.alias === t.alias && porChave.email === t.donoEmail) return { resultado: 'existente', tenantId: porChave.id, status: porChave.status as never }
      if (porAlias || porChave) return { resultado: 'ocupado' }
      tenants.set(t.tenantId, { id: t.tenantId, alias: t.alias, chave: t.chave, status: 'provisionando', email: t.donoEmail }); etapas.set(t.tenantId, new Map()); return { resultado: 'criado', tenantId: t.tenantId, status: 'provisionando' } },
    async existeAlias(a) { return [...tenants.values()].some((x) => x.alias === a) },
    async etapas(id) { return new Map(etapas.get(id)) }, async conclui(id, nome, v) { etapas.get(id)!.set(nome, v ?? null) }, async marca(id, s, m) { marcas.push(s); const t = tenants.get(id)!; t.status = s; t.motivo = m ?? null }, async habilita(_id, sv) { log.push(`habilita:${sv.length}`) },
  }
  const portas: PortasCadastro = {
    diretorio: dir, novoId: () => `00000000-0000-0000-0000-${String(++n).padStart(12, '0')}`,
    identidade: { async convida(c) { log.push(`convida:${c.email}`); quebra('dono') } },
    semeia: async (c) => { const i = log.filter((l) => l.startsWith('semeia')).length; log.push(`semeia:${c.servico}.${c.entidade}`); quebra(`semente:${i}`); return { id: opcoes.semeiaSemId === 'nulo' ? null : `id-${log.length}` } },
    landing: { async publica() { log.push('landing') } },
  }
  const quebra = (etapa: string) => { if (falhas.etapa === etapa && falhas.vezes > 0) { falhas.vezes--; throw new Error(`falha simulada em ${etapa}`) } }
  return { portas, tenants, etapas, log, marcas }
}

describe('provisionamento: etapas, idempotência e retomada', () => {
  it('caminho feliz: cada etapa uma vez, na ordem; o tenant só fica ativo no FIM', async () => {
    const m = memoria(); const r = await provisiona(plano(), 'chave-do-cadastro-0001', m.portas); expect(r).toMatchObject({ ok: true, alias: 'minha-loja', retomado: false })
    expect(m.log).toEqual(['cria', 'habilita:4', 'convida:dona@exemplo.com.br', 'semeia:pagamentos.configPagamento', 'semeia:pagamentos.configPagamento', 'semeia:pagamentos.caixa', 'semeia:estoque.deposito', 'semeia:catalogo.unidade', 'landing'])
    expect([...m.tenants.values()][0]!.status).toBe('ativo')
  })
  it('repetir o cadastro concluído (mesma chave) devolve o mesmo tenant SEM refazer nada', async () => {
    const m = memoria(); const a = await provisiona(plano(), 'chave-do-cadastro-0002', m.portas), antes = m.log.length; const b = await provisiona(plano(), 'chave-do-cadastro-0002', m.portas)
    expect(m.marcas).toEqual(['provisionando', 'ativo']); expect(b).toMatchObject({ ok: true, retomado: true }); expect((b as { tenantId: string }).tenantId).toBe((a as { tenantId: string }).tenantId); expect(m.log.slice(antes)).toEqual(['cria'])
  })
  it('cai no meio (semente 3): marca `falhou` com a etapa; repetir com a mesma chave CONTINUA da etapa que faltou, sem repetir as feitas', async () => {
    const m = memoria({ falhaEm: { etapa: 'semente:3', vezes: 1 } }); const p = plano()
    const r = await provisiona(p, 'chave-do-cadastro-0003', m.portas); expect(r).toMatchObject({ ok: false, motivo: 'falhou', etapa: 'semente:3', retomavel: true })
    const t = [...m.tenants.values()][0]!; expect(t.status).toBe('falhou'); expect(t.motivo).toContain('semente:3: falha simulada')
    const antes = m.log.length; const r2 = await provisiona(p, 'chave-do-cadastro-0003', m.portas); expect(r2).toMatchObject({ ok: true, retomado: true })
    expect(m.log.slice(antes)).toEqual(['cria', 'semeia:estoque.deposito', 'semeia:catalogo.unidade', 'landing']) // o convite e as 3 primeiras sementes NÃO se repetem
    expect(m.log.filter((l) => l.startsWith('convida')).length).toBe(1); expect(t.status).toBe('ativo')
  })
  it('falha no convite do dono: nada de semente antes dele; segue depois', async () => {
    const m = memoria({ falhaEm: { etapa: 'dono', vezes: 1 } }); const p = plano(); expect((await provisiona(p, 'chave-do-cadastro-0004', m.portas))).toMatchObject({ ok: false, etapa: 'dono' }); expect(m.log.some((l) => l.startsWith('semeia'))).toBe(false)
    expect((await provisiona(p, 'chave-do-cadastro-0004', m.portas)).ok).toBe(true)
  })
  it('alias de OUTRA pessoa é `ocupado` e nada é provisionado; a mesma chave com outro alias/e-mail NUNCA devolve o tenant alheio', async () => {
    const m = memoria(); await provisiona(plano(), 'chave-do-cadastro-0005', m.portas); const antes = m.log.length
    expect(await provisiona(plano(), 'chave-do-cadastro-OUTRA-1', m.portas)).toEqual({ ok: false, motivo: 'alias_ocupado' }); expect(m.log.slice(antes)).toEqual(['cria'])
    expect(await provisiona(plano({ alias: 'outra-loja' }), 'chave-do-cadastro-0005', m.portas)).toEqual({ ok: false, motivo: 'alias_ocupado' }) // chave reaproveitada com outro conteúdo
    expect(await provisiona(plano({ dono: { email: 'ladrao@x.com', nome: 'Ladrão' } }), 'chave-do-cadastro-0005', m.portas)).toEqual({ ok: false, motivo: 'alias_ocupado' })
  })
  it('guarda: a semente seguinte usa o id criado pela anterior; sem id (já existia) a falha é clara', async () => {
    const { Registry } = await import('@polaris/schema'); const r = new Registry(); const ps: Registry = r
    const svc: No = { kind: 'servico', id: 'est', versao: '1.0.0', estatuto: 'publicado', spec: { entidades: { dep: { campos: { nome: { tipo: 'texto', obrigatorio: true } } }, mar: { campos: { dep: { tipo: 'uuid' } } } }, operacoes: {} } } as never
    ps.registra(svc); ps.registra({ kind: 'pack', id: 'x', versao: '1.0.0', estatuto: 'publicado', spec: { nome: 'X', segmento: 'varejo', inclui: { servicos: ['est'] }, sementes: [{ servico: 'est', entidade: 'dep', dados: { nome: 'A' }, guarda: 'd' }, { servico: 'est', entidade: 'mar', dados: { dep: '$d' } }] } } as never)
    const ok = planoDeCadastro(ps, pedido({ packs: ['x'] })); if (!ok.ok) throw new Error(ok.erros.join())
    const m = memoria(); const recebidos: unknown[] = []; m.portas.semeia = async (c) => { recebidos.push(c.dados); return { id: `ID-${recebidos.length}` } }; expect((await provisiona(ok.plano, 'chave-guarda-0000001', m.portas)).ok).toBe(true); expect(recebidos).toEqual([{ nome: 'A' }, { dep: 'ID-1' }])
    // cai DEPOIS de criar a semente que dá a guarda e ANTES da que a usa: a retomada precisa lembrar o id guardado
    const m3 = memoria(); const vistos: unknown[] = []; let cai = true; m3.portas.semeia = async (c) => { if (cai && c.entidade === 'mar') { cai = false; throw new Error('caiu') } vistos.push(c.dados); return { id: `ID-${vistos.length}` } }
    expect(await provisiona(ok.plano, 'chave-guarda-0000003', m3.portas)).toMatchObject({ ok: false, etapa: 'semente:1' }); expect((await provisiona(ok.plano, 'chave-guarda-0000003', m3.portas)).ok).toBe(true); expect(vistos).toEqual([{ nome: 'A' }, { dep: 'ID-1' }])
    const m2 = memoria(); m2.portas.semeia = async () => ({ id: null }); expect(await provisiona(ok.plano, 'chave-guarda-0000002', m2.portas)).toMatchObject({ ok: false, etapa: 'semente:0' }); expect([...m2.tenants.values()][0]!.motivo).toContain("'d' precisa")
  })
})

// ---------- o diretório em Postgres de verdade ----------
describe('diretório da plataforma (Postgres)', () => {
  let pg: PGlite
  beforeAll(async () => { pg = new PGlite(); await pg.exec(DDL_DIRETORIO) })
  afterAll(async () => { await pg.close() })
  const q = async (s: string, p: unknown[] = []) => { const r = await pg.query(s, p); return { rows: r.rows as Array<Record<string, unknown>>, rowCount: r.affectedRows ?? r.rows.length } }
  const t = (alias: string, chave: string, email = 'a@b.com') => ({ tenantId: crypto.randomUUID(), alias, nome: 'N', segmento: 'varejo', packs: ['base', 'varejo'], donoEmail: email, chave })
  it('alias único e chave única: a corrida decide pelo índice; a mesma chamada é `existente`; a alheia é `ocupado`', async () => {
    const d = diretorioSql(q); const a = t('loja-a', 'chave-pg-aaaaaaaaaaaa'); expect(await d.cria(a)).toMatchObject({ resultado: 'criado' })
    expect(await d.cria({ ...a, tenantId: crypto.randomUUID() })).toMatchObject({ resultado: 'existente', tenantId: a.tenantId }); expect(await d.cria(t('loja-a', 'chave-pg-bbbbbbbbbbbb'))).toEqual({ resultado: 'ocupado' }); expect(await d.cria(t('loja-b', 'chave-pg-aaaaaaaaaaaa'))).toEqual({ resultado: 'ocupado' })
    expect(await d.existeAlias('loja-a')).toBe(true); expect(await d.existeAlias('loja-zzz')).toBe(false)
    const rs = await Promise.all([d.cria(t('disputa', 'chave-pg-corrida-0001')), d.cria(t('disputa', 'chave-pg-corrida-0002'))]); expect(rs.map((r) => r.resultado).sort()).toEqual(['criado', 'ocupado'])
  })
  it('etapas, módulos e status: gravação idempotente; cancelado não volta a ativo', async () => {
    const d = diretorioSql(q); const a = t('loja-c', 'chave-pg-cccccccccccc'); await d.cria(a); await d.conclui(a.tenantId, 'dono', 'x'); await d.conclui(a.tenantId, 'dono', 'y'); await d.conclui(a.tenantId, 'semente:0', null)
    expect(await d.etapas(a.tenantId)).toEqual(new Map([['dono', 'y'], ['semente:0', null]])); await d.habilita(a.tenantId, ['catalogo', 'vendas']); await d.habilita(a.tenantId, ['catalogo']); expect((await q(`SELECT count(*)::int AS n FROM plataforma.modulo WHERE tenant_id = $1`, [a.tenantId])).rows[0]!.n).toBe(2)
    await d.marca(a.tenantId, 'ativo'); await q(`UPDATE plataforma.tenant SET status = 'cancelado' WHERE id = $1`, [a.tenantId]); await d.marca(a.tenantId, 'ativo'); expect((await q(`SELECT status FROM plataforma.tenant WHERE id = $1`, [a.tenantId])).rows[0]!.status).toBe('cancelado')
  })
})

// ---------- HTTP público ----------
describe('rotas públicas do cadastro', () => {
  const chave = (n: number) => `chave-http-cadastro-${String(n).padStart(6, '0')}`
  const sobe = (opc: { limite?: { capacidade: number }; humano?: boolean; m?: ReturnType<typeof memoria> } = {}) => {
    const m = opc.m ?? memoria(); let fichas = opc.limite?.capacidade ?? 1000; const app = Fastify()
    rotasCadastro(app, { reg, portas: m.portas, limite: { tenta: (_k, c = 1) => { if (fichas >= c) { fichas -= c; return { ok: true } } return { ok: false, esperaSeg: 7 } } }, ...(opc.humano ? { verificaHumano: async (t: string) => t === 'token-bom' } : {}) })
    return { app, m }
  }
  const cad = (app: FastifyInstance, corpo: unknown, ip = '1.2.3.4') => app.inject({ method: 'POST', url: '/publico/cadastro', remoteAddress: ip, payload: corpo as object })
  const corpo = (n: number, extra: object = {}) => ({ alias: `loja-${n}`, nome: 'Loja', packs: ['varejo'], dono: { email: 'a@b.com', nome: 'Ana' }, aceiteTermos: true, chave: chave(n), ...extra })
  it('GET segmentos e alias: público, sem base; alias informa formato, reservado, em uso e livre', async () => {
    const { app, m } = sobe(); expect((await app.inject({ url: '/publico/segmentos' })).json().segmentos.map((s: any) => s.id)).toEqual(['varejo', 'servicos', 'alimentos'])
    await provisiona(plano({ alias: 'ocupado-x' }), 'chave-previa-000000001', m.portas); const al = async (a: string) => (await app.inject({ url: `/publico/alias/${a}` })).json()
    expect(await al('ocupado-x')).toEqual({ disponivel: false, motivo: 'em_uso' }); expect(await al('livre-ok')).toEqual({ disponivel: true }); expect(await al('admin')).toEqual({ disponivel: false, motivo: 'reservado' }); expect(await al('a')).toEqual({ disponivel: false, motivo: 'formato' })
    const r = await app.inject({ url: '/publico/segmentos' }); expect(r.headers['cache-control']).toBe('no-store'); expect(r.headers['x-content-type-options']).toBe('nosniff')
  })
  it('POST cadastro: 201 sem vazar id interno; repetir com a mesma chave é 200 (mesma resposta); alias alheio é 409', async () => {
    const { app } = sobe(); const a = await cad(app, corpo(1)); expect(a.statusCode).toBe(201); expect(Object.keys(a.json()).sort()).toEqual(['alias', 'mensagem']); expect(a.body).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-/)
    const b = await cad(app, corpo(1)); expect(b.statusCode).toBe(200); expect(b.json().alias).toBe('loja-1'); const c = await cad(app, { ...corpo(2), alias: 'loja-1' }); expect(c.statusCode).toBe(409); expect(c.json().erro.codigo).toBe('alias_ocupado')
  })
  it('corpo ESTRITO: campo desconhecido, chave fraca/ausente, dono incompleto e plano inválido são 400, com detalhes só dos erros de negócio', async () => {
    const { app } = sobe(); for (const c of [{ ...corpo(3), admin: true }, { ...corpo(3), chave: 'curta' }, (({ chave: _c, ...r }) => r)(corpo(3)), { ...corpo(3), dono: { email: 'a@b.com' } }, { ...corpo(3), dono: { email: 'a@b.com', nome: 'A', papel: 'owner' } }, null, [], 'x']) expect((await cad(app, c)).statusCode, JSON.stringify(c)).toBeGreaterThanOrEqual(400)
    const r = await cad(app, corpo(3, { aceiteTermos: false, alias: 'www' })); expect(r.statusCode).toBe(400); expect(r.json().erro).toMatchObject({ codigo: 'cadastro_invalido', detalhes: expect.arrayContaining(['alias reservado', 'é preciso aceitar os termos de uso']) })
  })
  it('LIMITE DE TAXA por IP: o excesso é 429 com retry-after (cadastro custa mais que consulta); outro IP não é afetado', async () => {
    const { app } = sobe({ limite: { capacidade: 12 } }); expect((await cad(app, corpo(4))).statusCode).toBe(201) // custo 10
    const r = await cad(app, corpo(5)); expect(r.statusCode).toBe(429); expect(r.headers['retry-after']).toBe('7'); expect(r.json().erro.codigo).toBe('muitas_requisicoes')
    expect((await app.inject({ url: '/publico/alias/livre-x' })).statusCode).toBe(200); expect((await app.inject({ url: '/publico/alias/livre-y' })).statusCode).toBe(429) // custo 2 cada: sobraram 2 fichas
  })
  it('anti-robô: com verificação ligada exige captcha válido; sem ela o campo é recusado', async () => {
    const h = sobe({ humano: true }); expect((await cad(h.app, corpo(6))).json().erro.codigo).toBe('verificacao_humana'); expect((await cad(h.app, corpo(6, { captcha: 'ruim' }))).statusCode).toBe(400); expect((await cad(h.app, corpo(6, { captcha: 'token-bom' }))).statusCode).toBe(201)
    expect((await cad(sobe().app, corpo(7, { captcha: 'x' }))).statusCode).toBe(400)
  })
  it('falha de provisionamento: 503 retomável SEM vazar a mensagem interna; repetir com a mesma chave conclui', async () => {
    const m = memoria({ falhaEm: { etapa: 'semente:1', vezes: 1 } }); const { app } = sobe({ m }); const r = await cad(app, corpo(8)); expect(r.statusCode).toBe(503); expect(r.json().erro).toMatchObject({ codigo: 'provisionamento_falhou', retomavel: true }); expect(r.body).not.toContain('simulada')
    expect((await cad(app, corpo(8))).statusCode).toBe(200); expect([...m.tenants.values()][0]!.status).toBe('ativo')
  })
})

// ---------- ponta a ponta: o cadastro semeia serviços REAIS, e o dono entra com os papéis do pack ----------
describe('cadastro ponta a ponta com serviços reais (varejo + serviços + alimentos)', () => {
  const ISS = 'https://id.teste', AUD = 'polaris'
  let pg: PGlite, priv: KeyLike; const apps = new Map<string, FastifyInstance>(); const convites: Array<{ email: string; papeis: string[] }> = []
  const consulta = (tx: { query: PGlite['query'] }): Consulta => async (sql, params) => { const r = await tx.query(sql, params as unknown[]); return { rows: r.rows as Record<string, unknown>[], rowCount: r.affectedRows ?? r.rows.length } }
  const db: DbTenant = { transacao: (t, fn) => pg.transaction(async (tx) => { await tx.exec('SET LOCAL ROLE app'); await tx.query(`SELECT set_config('app.tenant_id', $1, true)`, [t]); return fn(consulta(tx)) }) }
  const token = (tid: string, papeis: string[]) => new SignJWT({ tid, papeis }).setProtectedHeader({ alg: 'RS256' }).setSubject('dono').setIssuer(ISS).setAudience(AUD).setExpirationTime('10m').sign(priv)
  const chama = async (servico: string, tenantId: string, papeis: string[], m: string, url: string, corpo?: unknown) => { const r = await apps.get(servico)!.inject({ method: m as 'GET', url, headers: { authorization: `Bearer ${await token(tenantId, papeis)}`, ...(corpo !== undefined ? { 'content-type': 'application/json' } : {}) }, ...(corpo !== undefined ? { payload: JSON.stringify(corpo) } : {}) }); return { status: r.statusCode, corpo: r.body ? JSON.parse(r.body) : null } }
  let dir: Diretorio, landings: Array<{ tenantId: string; landing: unknown }>, portas: PortasCadastro
  beforeAll(async () => {
    const k = await generateKeyPair('RS256'); priv = k.privateKey; pg = new PGlite()
    await pg.exec(`CREATE ROLE migrador NOLOGIN BYPASSRLS; CREATE ROLE app NOLOGIN; GRANT CREATE ON DATABASE postgres TO migrador; SET ROLE migrador;`)
    const ops: Record<string, Record<string, never>> = { pagamentos: criaPagamentos(reg.resolve('servico', 'pagamentos')!.no, { provedores: { interno: provedorInterno } }).operacoes as never, estoque: criaEstoque(reg.resolve('servico', 'estoque')!.no).operacoes as never, servicos: criaServicos(reg.resolve('servico', 'servicos')!.no).operacoes as never, alimentos: criaAlimentos(reg.resolve('servico', 'alimentos')!.no).operacoes as never }
    const usados = ['catalogo', 'pagamentos', 'estoque', 'servicos', 'alimentos']
    for (const s of usados) await pg.exec(emite(reg.resolve('servico', s)!.no, 'sql'))
    await pg.exec(`RESET ROLE; GRANT USAGE ON SCHEMA ${usados.join(', ')} TO app; GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA ${usados.join(', ')} TO app;`)
    const contexto = contextoPorJwt(criaAutenticadorJwt({ emissor: ISS, audiencia: AUD, chave: { publica: k.publicKey } }))
    for (const s of usados) { const no = reg.resolve('servico', s)!.no; const eventos = Object.fromEntries(reg.ids('evento').map((id) => [id, reg.resolve('evento', id)!.no])) as Record<string, No>; const a = criaServico(no, { db, acesso: regrasDoRegistry(reg), contexto, ...(ops[s] ? { operacoes: ops[s] as never } : {}), eventos }); await a.ready(); apps.set(s, a) }
    await pg.exec(DDL_DIRETORIO); dir = diretorioSql(async (sql, p) => { const r = await pg.query(sql, p); return { rows: r.rows as Array<Record<string, unknown>>, rowCount: r.affectedRows ?? r.rows.length } })
    landings = []; let n = 0
    portas = { diretorio: dir, novoId: () => crypto.randomUUID(), identidade: { async convida(c) { convites.push({ email: c.email, papeis: c.papeis }) } }, landing: { async publica(tenantId, landing) { landings.push({ tenantId, landing }) } }, semeia: criaSemeador(reg, (c) => chama(c.servico, c.tenantId, c.papeis, 'POST', c.caminho, c.corpo)) }
    void n
  })
  afterAll(async () => { for (const a of apps.values()) await a.close(); await pg.close() })
  const cadastra = async (o: Partial<PedidoCadastro>, chave: string) => { const p = planoDeCadastro(reg, pedido(o)); if (!p.ok) throw new Error(p.erros.join()); return { plano: p.plano, r: await provisiona(p.plano, chave, portas) } }

  it('varejo: o tenant nasce com depósito padrão, unidade, caixa e formas de pagamento; o DONO opera com os papéis do pack; nada vaza para outro tenant', async () => {
    const { plano: p, r } = await cadastra({ alias: 'loja-um', nome: 'Loja Um' }, 'chave-e2e-varejo-000001'); expect(r.ok).toBe(true); const tid = (r as { tenantId: string }).tenantId
    expect(convites).toContainEqual({ email: 'dona@exemplo.com.br', papeis: p.papeisDono }); expect(landings.at(-1)).toMatchObject({ tenantId: tid, landing: { titulo: 'Loja Um' } })
    const dono = p.papeisDono
    expect((await chama('estoque', tid, dono, 'GET', '/depositos')).corpo.map((d: any) => [d.codigo, d.padrao])).toEqual([['PRINCIPAL', true]]); expect((await chama('catalogo', tid, dono, 'GET', '/unidades')).corpo.map((u: any) => u.codigo)).toEqual(['UN'])
    expect((await chama('pagamentos', tid, dono, 'GET', '/config-pagamento')).corpo.map((c: any) => c.metodo).sort()).toEqual(['dinheiro', 'vale']); expect((await chama('pagamentos', tid, dono, 'GET', '/caixas')).corpo.map((c: any) => c.nome)).toEqual(['Caixa 1'])
    expect((await chama('catalogo', tid, dono, 'POST', '/marcas', { nome: 'Minha marca' })).status).toBe(201) // o dono já pode trabalhar
    expect((await sqlDir(`SELECT status FROM plataforma.tenant WHERE id = $1`, [tid]))[0]!.status).toBe('ativo'); expect((await sqlDir(`SELECT servico FROM plataforma.modulo WHERE tenant_id = $1 ORDER BY 1`, [tid])).map((x) => x.servico)).toEqual(['catalogo', 'estoque', 'pagamentos', 'vendas'])
    const { r: r2 } = await cadastra({ alias: 'loja-dois', nome: 'Loja Dois' }, 'chave-e2e-varejo-000002'); const tid2 = (r2 as { tenantId: string }).tenantId
    expect((await chama('catalogo', tid2, dono, 'GET', '/marcas')).corpo).toEqual([]); expect((await chama('estoque', tid2, dono, 'GET', '/depositos')).corpo.length).toBe(1) // cada tenant tem o SEU depósito (o mesmo código em dois tenants)
  })
  it('serviços + alimentos num cadastro só: sementes de ambos, depósito UMA vez, garantia padrão e categoria do cardápio', async () => {
    const { plano: p, r } = await cadastra({ alias: 'oficina-e-lanche', nome: 'Oficina & Lanche', packs: ['servicos', 'alimentos'] }, 'chave-e2e-combo-0000001'); expect(r.ok).toBe(true); const tid = (r as { tenantId: string }).tenantId
    expect((await chama('estoque', tid, p.papeisDono, 'GET', '/depositos')).corpo.length).toBe(1); expect((await chama('servicos', tid, p.papeisDono, 'GET', '/termos-garantia')).corpo.map((t: any) => t.dias)).toEqual([90]); expect((await chama('alimentos', tid, p.papeisDono, 'GET', '/categorias-cardapio')).corpo.map((c: any) => c.nome)).toEqual(['Cardápio'])
  })
  it('retomada real: se um serviço está fora no meio, o cadastro fica `falhou` e, ao voltar, conclui sem duplicar o que já foi semeado', async () => {
    const original = portas.semeia; let derruba = true
    portas = { ...portas, semeia: async (c) => { if (derruba && c.entidade === 'deposito') throw new Error('estoque fora do ar'); return original(c) } }
    const { plano: p, r } = await cadastra({ alias: 'loja-retoma', nome: 'Loja Retoma' }, 'chave-e2e-retoma-000001'); expect(r).toMatchObject({ ok: false, etapa: 'semente:3' }); const tid = (r as { tenantId: string }).tenantId
    expect((await sqlDir(`SELECT status, motivo FROM plataforma.tenant WHERE id = $1`, [tid]))[0]).toMatchObject({ status: 'falhou' }); derruba = false
    const r2 = await provisiona(p, 'chave-e2e-retoma-000001', portas); expect(r2).toMatchObject({ ok: true, retomado: true })
    expect((await chama('pagamentos', tid, p.papeisDono, 'GET', '/caixas')).corpo.length).toBe(1); expect((await chama('estoque', tid, p.papeisDono, 'GET', '/depositos')).corpo.length).toBe(1); expect((await chama('pagamentos', tid, p.papeisDono, 'GET', '/config-pagamento')).corpo.length).toBe(2)
  })
  const sqlDir = async (s: string, p: unknown[] = []) => (await pg.query(s, p)).rows as Array<Record<string, any>>
})
