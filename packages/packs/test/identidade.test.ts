import { PGlite } from '@electric-sql/pglite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { DDL_DIRETORIO, criaConviteDoDono, criaIdentidade, confereSenha, diretorioSql, hashSenha, normalizaEmail, politicaDeSenha, type Identidade } from '../src/index'

const A = '11111111-1111-1111-1111-111111111111', B = '22222222-2222-2222-2222-222222222222'
const CUSTO = { N: 16, r: 8, p: 1 } // barato para os testes; o padrão de produção é N=2^15
let pg: PGlite, relogio = new Date('2026-06-15T12:00:00.000Z'), id: Identidade
const q = async (s: string, p: unknown[] = []) => { const r = await pg.query(s, p); return { rows: r.rows as Array<Record<string, unknown>>, rowCount: r.affectedRows ?? r.rows.length } }
const avanca = (ms: number) => { relogio = new Date(relogio.getTime() + ms) }
beforeAll(async () => {
  pg = new PGlite(); await pg.exec(DDL_DIRETORIO)
  for (const [t, a] of [[A, 'loja-a'], [B, 'loja-b']] as const) await diretorioSql(q).cria({ tenantId: t, alias: a, nome: a, segmento: 'varejo', packs: ['varejo'], donoEmail: `${a}@x.com`, chave: `chave-id-${a}-xxxxxxxxxxxxxx` })
  id = criaIdentidade({ q, custo: CUSTO, agora: () => relogio })
})
afterAll(async () => { await pg.close() })
const SENHA = 'uma-senha-longa-123'
const cria = (tenantId = A, email = 'ana@exemplo.com', senha = SENHA, papeis = ['gerente']) => id.criaUsuario({ tenantId, email, nome: 'Ana Souza', papeis, senha })

describe('senha', () => {
  it('hash com sal e parâmetros; confere certo e errado; sal diferente a cada hash', async () => {
    const h = await hashSenha('abcdefghij1', CUSTO), h2 = await hashSenha('abcdefghij1', CUSTO)
    expect(h).toMatch(/^scrypt\$16\$8\$1\$[\w-]+\$[\w-]+$/); expect(h).not.toBe(h2)
    expect(await confereSenha('abcdefghij1', h, CUSTO)).toEqual({ ok: true, rehash: false }); expect((await confereSenha('abcdefghij2', h, CUSTO)).ok).toBe(false); expect((await confereSenha('', h, CUSTO)).ok).toBe(false)
  })
  it('custo diferente do atual pede rehash; hash malformado, ausente ou com custo absurdo reprova sem lançar nem travar', async () => {
    const h = await hashSenha('abcdefghij1', CUSTO); expect(await confereSenha('abcdefghij1', h, { N: 32, r: 8, p: 1 })).toEqual({ ok: true, rehash: true })
    const t0 = Date.now()
    for (const ruim of [null, undefined, '', 'x', 'scrypt$16$8$1$a$b$c', 'scrypt$1073741824$8$1$AAAA$AAAA', 'scrypt$16$999$1$AAAA$AAAA', 'bcrypt$10$abc', `scrypt$16$8$1$${'A'.repeat(100000)}$AA`]) expect((await confereSenha('qualquer', ruim as never, CUSTO)).ok, String(ruim).slice(0, 30)).toBe(false)
    expect(Date.now() - t0).toBeLessThan(3000)
  })
  it('Unicode equivalente (NFKC) vale igual; senha gigante não derruba', async () => {
    const h = await hashSenha('Ａｂｃｄｅｆｇｈｉｊ１', CUSTO); expect((await confereSenha('Abcdefghij1', h, CUSTO)).ok).toBe(true)
    expect((await confereSenha('x'.repeat(10_000), h, CUSTO)).ok).toBe(false)
  })
  it('política: tamanho, comuns, só números, poucos caracteres, e-mail e nome dentro da senha', () => {
    expect(politicaDeSenha('curta1')).toEqual(['A senha precisa de pelo menos 10 caracteres.']); expect(politicaDeSenha('x'.repeat(129))[0]).toMatch(/até 128/)
    expect(politicaDeSenha('qwertyuiop')[0]).toMatch(/muito comum/); expect(politicaDeSenha('1234567890')[0]).toMatch(/muito comum|só números/); expect(politicaDeSenha('4829173650')).toEqual(['A senha não pode ter só números.'])
    expect(politicaDeSenha('aaaaaaaaaaaa')[0]).toMatch(/poucos caracteres/); expect(politicaDeSenha('ana.souza-2026!', { email: 'ana.souza@x.com' })[0]).toMatch(/seu e-mail/); expect(politicaDeSenha('maria aparecida 9', { nome: 'Maria Aparecida' })[0]).toMatch(/seu nome/)
    expect(politicaDeSenha('cavalo-bateria-grampo')).toEqual([]); expect(politicaDeSenha('uma frase com espaços 7')).toEqual([])
  })
  it('normalizaEmail: minúsculas, sem espaços, recusa lixo e injeção', () => {
    expect(normalizaEmail('  Ana@Exemplo.COM ')).toBe('ana@exemplo.com'); for (const ruim of ['', 'ana', 'ana@', "a'; DROP TABLE x;--@e.com", 'a b@e.com', 'a@@e.com', 5, null, 'x'.repeat(300) + '@e.com']) expect(normalizaEmail(ruim), String(ruim).slice(0, 20)).toBeNull()
  })
})

describe('identidade: usuários e login', () => {
  it('cria usuário (e-mail único por tenant, sem diferenciar maiúsculas); dados ruins e senha fraca são recusados', async () => {
    const r = await cria(); expect(r).toMatchObject({ ok: true, usuario: { email: 'ana@exemplo.com', papeis: ['gerente'], status: 'ativo' } })
    expect(await cria(A, 'ANA@exemplo.com')).toMatchObject({ ok: false, motivo: 'ja_existe' }); expect(await cria(B)).toMatchObject({ ok: true }) // outro tenant: pode
    expect(await cria(A, 'novo@exemplo.com', '123')).toMatchObject({ ok: false, motivo: 'senha_fraca' }); expect(await cria(A, 'x')).toMatchObject({ ok: false, motivo: 'dados_invalidos' }); expect(await cria(A, 'p@exemplo.com', SENHA, ['papel ruim'])).toMatchObject({ ok: false, motivo: 'dados_invalidos' }); expect(await cria('nao-uuid')).toMatchObject({ ok: false, motivo: 'dados_invalidos' })
    expect((await q(`SELECT senha_hash FROM plataforma.usuario WHERE email = 'ana@exemplo.com' AND tenant_id = $1`, [A])).rows[0]!.senha_hash).toMatch(/^scrypt\$/) // nunca a senha em claro
  })
  it('entra com e-mail e senha (e-mail normalizado); a falha é a MESMA para senha errada, e-mail desconhecido e outro tenant', async () => {
    const ok = await id.entra({ tenantId: A, email: '  ANA@exemplo.com ', senha: SENHA }); expect(ok).toMatchObject({ ok: true, usuario: { email: 'ana@exemplo.com', papeis: ['gerente'] } })
    const erradas = await Promise.all([id.entra({ tenantId: A, email: 'ana@exemplo.com', senha: 'errada-errada-1' }), id.entra({ tenantId: A, email: 'ninguem@exemplo.com', senha: SENHA }), id.entra({ tenantId: A, email: 'lixo', senha: SENHA }), id.entra({ tenantId: A, email: 'ana@exemplo.com', senha: 5 as never })])
    expect(erradas).toEqual(Array(4).fill({ ok: false, motivo: 'credenciais' }))
    await cria(B, 'so-do-b@exemplo.com'); expect(await id.entra({ tenantId: A, email: 'so-do-b@exemplo.com', senha: SENHA })).toEqual({ ok: false, motivo: 'credenciais' }) // a conta do B não entra no A
    expect((await q(`SELECT ultimo_login FROM plataforma.usuario WHERE email = 'ana@exemplo.com' AND tenant_id = $1`, [A])).rows[0]!.ultimo_login).not.toBeNull()
  })
  it('bloqueia depois de 5 falhas, também para e-mail que NÃO existe (não revela contas), e libera com o tempo; sucesso zera a contagem', async () => {
    const tenta = (email: string, senha: string) => id.entra({ tenantId: A, email, senha })
    expect(await tenta('ana@exemplo.com', SENHA)).toMatchObject({ ok: true }) // zera o que os testes anteriores deixaram
    for (const email of ['ana@exemplo.com', 'fantasma@exemplo.com']) {
      for (let i = 0; i < 4; i++) expect(await tenta(email, 'errada-errada-1')).toEqual({ ok: false, motivo: 'credenciais' })
      const quinta = await tenta(email, 'errada-errada-1'); expect(quinta).toMatchObject({ ok: false, motivo: 'bloqueado' }); expect((quinta as { ate: Date }).ate.getTime()).toBe(relogio.getTime() + 15 * 60_000)
    }
    expect(await tenta('ana@exemplo.com', SENHA)).toMatchObject({ ok: false, motivo: 'bloqueado' }) // bloqueado não serve para testar a senha certa
    avanca(14 * 60_000); expect(await tenta('ana@exemplo.com', SENHA)).toMatchObject({ motivo: 'bloqueado' }); avanca(2 * 60_000)
    expect(await tenta('ana@exemplo.com', SENHA)).toMatchObject({ ok: true })
    for (let i = 0; i < 3; i++) await tenta('ana@exemplo.com', 'errada-errada-1'); expect(await tenta('ana@exemplo.com', SENHA)).toMatchObject({ ok: true }) // 3 falhas + sucesso: zera
    for (let i = 0; i < 4; i++) expect(await tenta('ana@exemplo.com', 'errada-errada-1')).toEqual({ ok: false, motivo: 'credenciais' }) // recomeçou do zero: 4 falhas ainda não bloqueiam (se somasse com as 3 de antes, bloquearia)
    expect(await tenta('ana@exemplo.com', SENHA)).toMatchObject({ ok: true })
  })
  it('conta desativada e conta convidada (sem senha) não entram; reativar volta', async () => {
    avanca(16 * 60_000); const u = await cria(A, 'bia@exemplo.com'); const uid = (u as { usuario: { id: string } }).usuario.id
    expect(await id.muda(A, uid, { status: 'desativado' })).toBe(true); expect(await id.entra({ tenantId: A, email: 'bia@exemplo.com', senha: SENHA })).toEqual({ ok: false, motivo: 'credenciais' })
    expect(await id.muda(A, uid, { status: 'ativo', papeis: ['studio.editor'] })).toBe(true); expect(await id.entra({ tenantId: A, email: 'bia@exemplo.com', senha: SENHA })).toMatchObject({ ok: true, usuario: { papeis: ['studio.editor'] } })
    expect(await id.muda(B, uid, { status: 'desativado' })).toBe(false) // o id é do tenant A
    expect(await id.muda(A, uid, { status: 'x' as never })).toBe(false); expect(await id.muda(A, 'nao-uuid', {})).toBe(false)
  })
  it('hash de custo antigo é refeito no login (rehash) sem o usuário notar', async () => {
    avanca(16 * 60_000); const velho = criaIdentidade({ q, custo: { N: 16, r: 8, p: 1 }, agora: () => relogio }), novo = criaIdentidade({ q, custo: { N: 32, r: 8, p: 1 }, agora: () => relogio })
    await velho.criaUsuario({ tenantId: A, email: 'cris@exemplo.com', nome: 'Cris', senha: SENHA }); expect(await novo.entra({ tenantId: A, email: 'cris@exemplo.com', senha: SENHA })).toMatchObject({ ok: true })
    expect((await q(`SELECT senha_hash FROM plataforma.usuario WHERE email = 'cris@exemplo.com'`)).rows[0]!.senha_hash).toMatch(/^scrypt\$32\$/); expect(await novo.entra({ tenantId: A, email: 'cris@exemplo.com', senha: SENHA })).toMatchObject({ ok: true })
  })
})

describe('identidade: redefinição de senha e convite', () => {
  it('"esqueci": só devolve token para conta existente e ativa, no máximo um por minuto; outro tenant não tem conta', async () => {
    avanca(16 * 60_000)
    expect(await id.pedeRedefinicao({ tenantId: A, email: 'ninguem@exemplo.com' })).toBeNull(); expect(await id.pedeRedefinicao({ tenantId: A, email: 'lixo' })).toBeNull(); expect(await id.pedeRedefinicao({ tenantId: B, email: 'ana@exemplo.com' })).not.toBeNull() // a Ana do B é outra conta
    const p = await id.pedeRedefinicao({ tenantId: A, email: 'ana@exemplo.com' }); expect(p).toMatchObject({ usuario: { email: 'ana@exemplo.com' } }); expect(p!.token).toMatch(/^[\w-]{43}$/)
    expect(await id.pedeRedefinicao({ tenantId: A, email: 'ana@exemplo.com' })).toBeNull(); avanca(61_000); expect(await id.pedeRedefinicao({ tenantId: A, email: 'ana@exemplo.com' })).not.toBeNull()
    expect((await q(`SELECT token_hash FROM plataforma.token_senha`)).rows.every((r) => /^[0-9a-f]{64}$/.test(String(r.token_hash)))).toBe(true) // só o hash do token fica no banco
  })
  it('redefine com o token: uso único, só no tenant certo, senha fraca não gasta o token, o mais novo invalida os antigos, limpa o bloqueio', async () => {
    avanca(2 * 60_000)
    const t1 = (await id.pedeRedefinicao({ tenantId: A, email: 'ana@exemplo.com' }))!.token; avanca(61_000); const t2 = (await id.pedeRedefinicao({ tenantId: A, email: 'ana@exemplo.com' }))!.token
    expect(await id.redefine({ tenantId: A, token: t1, senha: 'outra-senha-forte-9' })).toEqual({ ok: false, motivo: 'token_invalido' }) // o antigo foi invalidado pelo novo
    expect(await id.redefine({ tenantId: B, token: t2, senha: 'outra-senha-forte-9' })).toEqual({ ok: false, motivo: 'token_invalido' }) // token de um tenant não vale no outro
    expect(await id.redefine({ tenantId: A, token: t2, senha: 'curta' })).toMatchObject({ ok: false, motivo: 'senha_fraca' })
    for (let i = 0; i < 5; i++) await id.entra({ tenantId: A, email: 'ana@exemplo.com', senha: 'errada-errada-1' }) // bloqueia
    const ok = await id.redefine({ tenantId: A, token: t2, senha: 'outra-senha-forte-9' }); expect(ok).toMatchObject({ ok: true, usuario: { email: 'ana@exemplo.com' } })
    expect(await id.redefine({ tenantId: A, token: t2, senha: 'mais-outra-senha-9' })).toEqual({ ok: false, motivo: 'token_invalido' }) // uso único
    expect(await id.entra({ tenantId: A, email: 'ana@exemplo.com', senha: 'outra-senha-forte-9' })).toMatchObject({ ok: true }); expect(await id.entra({ tenantId: A, email: 'ana@exemplo.com', senha: SENHA })).toMatchObject({ ok: false }) // a antiga morreu, e o bloqueio também
  })
  it('token expirado e token malformado são recusados; dois usos simultâneos: só um passa', async () => {
    avanca(2 * 60_000); const t = (await id.pedeRedefinicao({ tenantId: A, email: 'ana@exemplo.com' }))!.token
    for (const ruim of ['', 'x', 'a'.repeat(200), "'; DROP TABLE x;--", 5]) expect(await id.redefine({ tenantId: A, token: ruim as never, senha: 'outra-senha-forte-9' }), String(ruim).slice(0, 15)).toEqual({ ok: false, motivo: 'token_invalido' })
    const [x, y] = await Promise.all([id.redefine({ tenantId: A, token: t, senha: 'senha-de-corrida-1' }), id.redefine({ tenantId: A, token: t, senha: 'senha-de-corrida-2' })]); expect([x.ok, y.ok].filter(Boolean).length).toBe(1)
    avanca(2 * 60_000); const t3 = (await id.pedeRedefinicao({ tenantId: A, email: 'ana@exemplo.com' }))!.token; avanca(61 * 60_000 + 1000)
    expect(await id.redefine({ tenantId: A, token: t3, senha: 'depois-de-expirar-1' })).toEqual({ ok: false, motivo: 'token_invalido' })
  })
  it('convite: cria a conta sem senha (não entra), o link define a senha e ativa; convite vale 7 dias; reconvidar é recusado', async () => {
    const c = await id.convida({ tenantId: A, email: 'novo.dono@exemplo.com', nome: 'Novo Dono', papeis: ['studio.editor', 'gerente'] }); expect(c).toMatchObject({ ok: true, usuario: { status: 'convidado' } })
    expect(await id.convida({ tenantId: A, email: 'NOVO.dono@exemplo.com', nome: 'x' })).toMatchObject({ ok: false, motivo: 'ja_existe' }); expect(await id.entra({ tenantId: A, email: 'novo.dono@exemplo.com', senha: SENHA })).toEqual({ ok: false, motivo: 'credenciais' })
    const r = await id.redefine({ tenantId: A, token: (c as { token: string }).token, senha: 'cavalo-bateria-grampo' }); expect(r).toMatchObject({ ok: true, usuario: { status: 'ativo', papeis: ['studio.editor', 'gerente'] } })
    expect(await id.entra({ tenantId: A, email: 'novo.dono@exemplo.com', senha: 'cavalo-bateria-grampo' })).toMatchObject({ ok: true })
    const d = await id.convida({ tenantId: A, email: 'tarde@exemplo.com', nome: 'Tarde' }); avanca(8 * 86_400_000); expect(await id.redefine({ tenantId: A, token: (d as { token: string }).token, senha: 'cavalo-bateria-grampo' })).toEqual({ ok: false, motivo: 'token_invalido' })
  })
  it('conta desativada não redefine nem recebe token', async () => {
    const u = (await cria(A, 'inativo@exemplo.com')) as { usuario: { id: string } }; await id.muda(A, u.usuario.id, { status: 'desativado' })
    expect(await id.pedeRedefinicao({ tenantId: A, email: 'inativo@exemplo.com' })).toBeNull()
  })
  it('caixa de saída: guarda o e-mail por tenant e lista só o do tenant', async () => {
    await id.enfileiraEmail({ tenantId: A, para: 'ana@exemplo.com', assunto: 'Redefinir', corpo: 'link' }); await id.enfileiraEmail({ tenantId: B, para: 'b@exemplo.com', assunto: 'Outro', corpo: 'x' })
    const a = await id.emails(A); expect(a.map((e) => e.assunto)).toEqual(['Redefinir']); expect((await id.emails(B)).map((e) => e.assunto)).toEqual(['Outro']); expect(await id.emails('nao-uuid-aqui-xxxxxxxx-xxxxxxxxxxxx')).toEqual([])
  })
})

describe('convite do dono (porta do cadastro)', () => {
  it('cria a conta sem senha, manda UM e-mail com o link de definir a senha (vale 7 dias) e o link funciona; repetir não manda outro', async () => {
    const convite = criaConviteDoDono({ identidade: id, urlDe: async (t) => `https://${t === A ? 'loja-a' : 'loja-b'}.polaris.app/` })
    await convite.convida({ tenantId: A, email: 'dono@padaria.com', nome: 'Dona Padaria', papeis: ['studio.editor', 'gerente'] })
    const e1 = (await id.emails(A)).filter((m) => m.para === 'dono@padaria.com'); expect(e1.length).toBe(1); expect(e1[0]!.assunto).toMatch(/Defina a sua senha/); expect(e1[0]!.corpo).toMatch(/https:\/\/loja-a\.polaris\.app\/senha\/redefinir\?token=[\w-]{43}/); expect(e1[0]!.corpo).not.toMatch(/senha[:=]/i)
    expect(await id.entra({ tenantId: A, email: 'dono@padaria.com', senha: 'qualquer-coisa-1' })).toEqual({ ok: false, motivo: 'credenciais' }) // ainda sem senha
    const token = /token=([\w-]+)/.exec(e1[0]!.corpo)![1]!; expect(await id.redefine({ tenantId: A, token, senha: 'cavalo-bateria-grampo' })).toMatchObject({ ok: true, usuario: { papeis: ['studio.editor', 'gerente'], status: 'ativo' } })
    await convite.convida({ tenantId: A, email: 'dono@padaria.com', nome: 'Dona Padaria', papeis: ['gerente'] }); expect((await id.emails(A)).filter((m) => m.para === 'dono@padaria.com').length).toBe(1) // cadastro retomado: sem e-mail repetido
    await expect(convite.convida({ tenantId: A, email: 'ruim', nome: 'x', papeis: [] })).rejects.toThrow(/dados_invalidos/)
  })
})
