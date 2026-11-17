import { vi } from 'vitest'
vi.setConfig({ testTimeout: 30_000, hookTimeout: 30_000 }) // sobe um Postgres (WASM): com várias suítes em paralelo, 5 s é pouco
import { PGlite } from '@electric-sql/pglite'
import { afterEach, describe, expect, it } from 'vitest'
import { emite, migraSql, type No } from '../src/index'

// Migração SQL por diff de duas versões de um `servico`. A prova é contra um Postgres real: aplicar v1 + migração tem de dar o MESMO catálogo
// (colunas, tipos, nulidade, padrões, índices, políticas, chaves estrangeiras) que aplicar v2 do zero, e os DADOS existentes sobrevivem.

const svc = (versao: string, entidades: object, id = 'loja'): No => ({ kind: 'servico', id, versao, estatuto: 'publicado', spec: { entidades, operacoes: {} } }) as never
const A = '11111111-1111-1111-1111-111111111111', B = '22222222-2222-2222-2222-222222222222'
const abertos: PGlite[] = []
afterEach(async () => { await Promise.all(abertos.splice(0).map((d) => d.close())) })

async function banco(...sqls: string[]): Promise<PGlite> {
  const db = new PGlite(); abertos.push(db)
  // migrador: dono das tabelas e com BYPASSRLS (a FORCE RLS vale até para o dono); app: o papel da aplicação, sujeito à política
  await db.exec(`CREATE ROLE migrador NOLOGIN BYPASSRLS; CREATE ROLE app NOLOGIN; GRANT CREATE ON DATABASE postgres TO migrador;`)
  for (const s of sqls) await db.exec(`SET ROLE migrador; ${s}`)
  await db.exec(`RESET ROLE`)
  return db
}
const aplica = async (db: PGlite, sql: string) => { await db.exec(`SET ROLE migrador; ${sql}; RESET ROLE`) }
const dml = (db: PGlite) => db.exec(`GRANT USAGE ON SCHEMA loja TO app; GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA loja TO app;`)
const como = async (db: PGlite, t: string, sql: string, p: unknown[] = []) => { await db.exec(`RESET ROLE; SET ROLE app; SELECT set_config('app.tenant_id', '${t}', false);`); return db.query(sql, p) }

/** o catálogo do schema, normalizado: o que o Postgres de fato tem */
async function catalogo(db: PGlite, esq = 'loja') {
  const q = async (sql: string) => (await db.query(sql, [esq])).rows
  return {
    colunas: await q(`SELECT table_name, column_name, data_type, udt_name, is_nullable, column_default, numeric_precision, numeric_scale FROM information_schema.columns WHERE table_schema = $1 ORDER BY table_name, column_name`),
    indices: (await q(`SELECT tablename, indexname, indexdef FROM pg_indexes WHERE schemaname = $1 ORDER BY indexname`)),
    politicas: await q(`SELECT tablename, policyname, cmd, qual, with_check FROM pg_policies WHERE schemaname = $1 ORDER BY tablename, policyname`),
    rls: await q(`SELECT c.relname, c.relrowsecurity, c.relforcerowsecurity FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace WHERE n.nspname = $1 AND c.relkind = 'r' ORDER BY c.relname`),
    fks: await q(`SELECT conrelid::regclass::text AS tabela, conname, pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE connamespace = $1::regnamespace AND contype = 'f' ORDER BY conname`),
  }
}
const mesmoCatalogo = async (migrado: PGlite, v2: No) => {
  const fresco = await banco(emite(v2, 'sql'))
  expect(await catalogo(migrado)).toEqual(await catalogo(fresco))
}

const V1 = svc('1.0.0', {
  cliente: { campos: { nome: { tipo: 'texto', obrigatorio: true }, apelido: { tipo: 'texto' } } },
  produto: { campos: { nome: { tipo: 'texto', obrigatorio: true }, preco: { tipo: 'dinheiro', obrigatorio: true }, estoque: { tipo: 'inteiro' }, nota: { tipo: 'texto' } }, indices: [['nome'], ['estoque']] },
})
const dadosV1 = async (db: PGlite) => {
  await dml(db)
  await como(db, A, `INSERT INTO loja.produto (tenant_id, nome, preco, estoque) VALUES ($1, 'Pão', '4.5', 10), ($1, 'Café', '18.9', NULL)`, [A])
  await como(db, B, `INSERT INTO loja.produto (tenant_id, nome, preco, estoque) VALUES ($1, 'Chá', '7', 3)`, [B])
  await como(db, A, `INSERT INTO loja.cliente (tenant_id, nome) VALUES ($1, 'Ana')`, [A])
}

describe('migração segura: o catálogo migrado é IDÊNTICO ao de v2 do zero, e os dados sobrevivem', () => {
  const V2 = svc('2.0.0', {
    cliente: { campos: { nome: { tipo: 'texto', obrigatorio: true }, apelido: { tipo: 'texto' }, email: { tipo: 'texto' } }, indices: [['email']] },
    produto: { campos: { nome: { tipo: 'texto', obrigatorio: true }, preco: { tipo: 'dinheiro', obrigatorio: true }, estoque: { tipo: 'inteiro', obrigatorio: true, padrao: 0 }, nota: { tipo: 'texto' }, ativo: { tipo: 'booleano', obrigatorio: true, padrao: true }, categoriaId: { tipo: 'uuid', referencia: 'categoria' } }, indices: [['nome']] },
    categoria: { campos: { nome: { tipo: 'texto', obrigatorio: true } } },
  })
  it('campo novo com padrão, opcional novo, índice novo/removido, obrigatório com padrão (preenche nulos), entidade nova e FK nova', async () => {
    const db = await banco(emite(V1, 'sql')); await dadosV1(db)
    const m = migraSql(V1, V2)
    expect(m.ok).toBe(true); expect(m.destrutivas).toEqual([])
    await aplica(db, m.up)
    await dml(db)
    // dados preservados; nulos de `estoque` viraram o padrão; `ativo` novo valeu para as linhas antigas
    expect((await como(db, A, `SELECT nome, estoque, ativo FROM loja.produto ORDER BY nome`)).rows).toEqual([{ nome: 'Café', estoque: 0, ativo: true }, { nome: 'Pão', estoque: 10, ativo: true }])
    expect((await como(db, B, `SELECT nome FROM loja.produto`)).rows).toEqual([{ nome: 'Chá' }])
    await mesmoCatalogo(db, V2)
  })
  it('a RLS continua valendo (inclusive na tabela nova) e o FK novo é composto', async () => {
    const db = await banco(emite(V1, 'sql')); await dadosV1(db)
    await aplica(db, migraSql(V1, V2).up); await dml(db)
    const c = await como(db, A, `INSERT INTO loja.categoria (tenant_id, nome) VALUES ($1, 'Padaria') RETURNING id`, [A])
    expect((await como(db, B, 'SELECT * FROM loja.categoria')).rows).toEqual([])
    await expect(como(db, B, `INSERT INTO loja.produto (tenant_id, nome, preco, categoria_id) VALUES ($1, 'x', '1', $2)`, [B, (c.rows[0] as any).id])).rejects.toThrow(/foreign key|violates/i)
  })
  it('sem mudança: nada a fazer (up vazio), e v1→v1 não inventa operações', () => {
    const m = migraSql(V1, svc('1.0.1', JSON.parse(JSON.stringify((V1.spec as any).entidades))))
    expect(m).toMatchObject({ up: '', mudancas: [], ok: true })
  })
})

describe('o que NÃO se faz sem decisão humana', () => {
  it('campo obrigatório novo sem padrão, e opcional→obrigatório sem padrão, são BLOQUEIOS (ok=false)', () => {
    const novo = svc('2', { cliente: { campos: { nome: { tipo: 'texto', obrigatorio: true }, apelido: { tipo: 'texto', obrigatorio: true }, doc: { tipo: 'texto', obrigatorio: true } } }, produto: (V1.spec as any).entidades.produto })
    const m = migraSql(V1, novo)
    expect(m.ok).toBe(false)
    expect(m.bloqueios.some((b) => b.includes('cliente.doc') && b.includes('novo, sem padrão'))).toBe(true)
    expect(m.bloqueios.some((b) => b.includes('cliente.apelido') && b.includes('passa a ser obrigatório sem padrão'))).toBe(true)
  })
  it('remover campo/entidade e estreitar tipo são destrutivos: ficam FORA do up por padrão, listados, e entram com `destrutivo`', async () => {
    const V2 = svc('2', { cliente: { campos: { nome: { tipo: 'texto', obrigatorio: true } } } }) // some `apelido` e a entidade produto
    const m = migraSql(V1, V2)
    expect(m.destrutivas.length).toBe(2)
    expect(m.destrutivas.join(' ')).toMatch(/cliente\.apelido removido/); expect(m.destrutivas.join(' ')).toMatch(/entidade produto removida/)
    expect(m.up).toBe('') // nada seguro a fazer: tudo é destrutivo
    const db = await banco(emite(V1, 'sql')); await dadosV1(db)
    await aplica(db, migraSql(V1, V2, { destrutivo: true }).up)
    expect((await db.query(`SELECT to_regclass('loja.produto') AS t`)).rows[0]).toEqual({ t: null })
    await mesmoCatalogo(db, V2)
  })
  it('tipo: alargar (inteiro→decimal) é seguro e preserva valores; estreitar (texto→inteiro) é destrutivo', async () => {
    const v1 = svc('1', { item: { campos: { qtd: { tipo: 'inteiro', padrao: 1 }, codigo: { tipo: 'texto' } } } })
    const v2 = svc('2', { item: { campos: { qtd: { tipo: 'decimal', padrao: 1 }, codigo: { tipo: 'inteiro' } } } })
    const m = migraSql(v1, v2)
    expect(m.destrutivas).toEqual([expect.stringContaining('item.codigo: tipo texto → inteiro')])
    expect(m.up).toContain('ALTER COLUMN "qtd" TYPE numeric'); expect(m.up).not.toContain('"codigo" TYPE')
    const db = await banco(emite(v1, 'sql')); await dml(db)
    await como(db, A, `INSERT INTO loja.item (tenant_id, qtd, codigo) VALUES ($1, 7, '12')`, [A])
    await aplica(db, m.up)
    expect((await como(db, A, `SELECT qtd::text AS qtd, codigo FROM loja.item`)).rows).toEqual([{ qtd: '7', codigo: '12' }])
  })
})

describe('renomear preserva o dado (RENAME COLUMN), e é a única forma', () => {
  const v1 = svc('1', { cliente: { campos: { nome: { tipo: 'texto', obrigatorio: true }, fone: { tipo: 'texto' } }, indices: [['fone']] } })
  const v2 = svc('2', { cliente: { campos: { nome: { tipo: 'texto', obrigatorio: true }, telefone: { tipo: 'texto' } }, indices: [['telefone']] } })
  it('com `renomeia`: dado mantido, índice trocado, catálogo igual ao de v2', async () => {
    const db = await banco(emite(v1, 'sql')); await dml(db)
    await como(db, A, `INSERT INTO loja.cliente (tenant_id, nome, fone) VALUES ($1, 'Ana', '555')`, [A])
    const m = migraSql(v1, v2, { renomeia: { 'cliente.fone': 'telefone' } })
    expect(m.destrutivas).toEqual([]); expect(m.ok).toBe(true)
    await aplica(db, m.up)
    expect((await como(db, A, `SELECT telefone FROM loja.cliente`)).rows).toEqual([{ telefone: '555' }])
    await mesmoCatalogo(db, v2)
  })
  it('sem `renomeia`: parece remover + criar → destrutivo, com a dica; renomeação incoerente é bloqueio', () => {
    const m = migraSql(v1, v2)
    expect(m.destrutivas.join(' ')).toContain("use 'renomeia'")
    expect(migraSql(v1, v2, { renomeia: { 'cliente.nome': 'telefone' } }).ok).toBe(false)
  })
})

describe('eventos: serviço que passa a publicar e a consumir', () => {
  const base = { cliente: { campos: { nome: { tipo: 'texto', obrigatorio: true } } } }
  const v1 = svc('1', base)
  const v2: No = { ...svc('2', base), spec: { entidades: base, operacoes: { criar: { metodo: 'POST', caminho: '/c', saida: 'cliente', publica: ['cliente.criado'] } }, consome: ['pagamento.confirmado'] } } as never
  it('a migração cria outbox + inbox (com RLS) e o catálogo fica IGUAL ao de v2 do zero; reaplicar é inofensivo', async () => {
    const db = await banco(emite(v1, 'sql'))
    const m = migraSql(v1, v2)
    expect(m.mudancas).toContain('infraestrutura de eventos: outbox + inbox'); expect(m.ok).toBe(true)
    await aplica(db, m.up)
    await mesmoCatalogo(db, v2)
    expect((await db.query(`SELECT count(*)::int AS n FROM pg_policies WHERE schemaname = 'loja' AND tablename IN ('outbox', 'inbox')`)).rows[0]).toEqual({ n: 2 })
    await aplica(db, m.up) // idempotente
    expect(migraSql(v2, v2).up).toBe('') // já tem a infraestrutura: nada a fazer
  })
})

describe('erros', () => {
  it('serviços diferentes ou kind errado são recusados', () => {
    expect(() => migraSql(svc('1', {}, 'a'), svc('2', {}, 'b'))).toThrow(/outro schema/)
    expect(() => migraSql({ kind: 'tema', id: 'a', versao: '1', estatuto: 'publicado', spec: { tokens: {} } } as never, svc('2', {}))).toThrow(/só serviços/)
  })
  it('referência inexistente na versão nova é recusada antes de gerar SQL', () => {
    expect(() => migraSql(V1, svc('2', { cliente: { campos: { x: { tipo: 'uuid', referencia: 'fantasma' } } } }))).toThrow(/inexistente/)
  })
})
