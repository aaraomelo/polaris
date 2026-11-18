import { PGlite } from '@electric-sql/pglite'
import { registraBase } from '@polaris/engine'
import { registraTemas } from '@polaris/engine/tema'
import { DDL_DIRETORIO, criaArmazemDeNos, diretorioSql, registroDaPlataforma } from '@polaris/packs'
import type { FastifyInstance } from 'fastify'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { criaServidorStudio } from '../src/servidor'

// A pré-visualização do SERVIDOR: o mesmo compilador e renderizador da produção, sem navegador.
const T = '11111111-1111-1111-1111-111111111111'
let pg: PGlite, app: FastifyInstance
const q = async (s: string, p: unknown[] = []) => { const r = await pg.query(s, p); return { rows: r.rows as Array<Record<string, unknown>>, rowCount: r.affectedRows ?? r.rows.length } }
const pagina = (texto: string, extra: object = {}) => ({ kind: 'pagina', id: 'p', versao: '1.0.0', spec: { rota: '/p', raiz: { bloco: 'layout/pilha', id: 'raiz', slots: { filhos: [{ bloco: 'texto/titulo', id: 'titulo', props: { texto, nivel: 1 } }] } } }, ...extra })
const previa = (corpo: object) => app.inject({ method: 'POST', url: '/studio/previa', headers: { cookie: 'x' }, payload: corpo }).then((r) => ({ status: r.statusCode, ...r.json() }))
beforeAll(async () => {
  pg = new PGlite(); await pg.exec(DDL_DIRETORIO); await diretorioSql(q).cria({ tenantId: T, alias: 'loja', nome: 'l', segmento: 'varejo', packs: ['varejo'], donoEmail: 'a@b.com', chave: 'chave-previa-xxxxxxxxxxxxxx' })
  const base = registroDaPlataforma(); registraBase(base); registraTemas(base)
  app = criaServidorStudio({ armazem: criaArmazemDeNos({ q, base }), baseDe: async () => base, q, autentica: async () => ({ tenantId: T, usuario: 'u', pode: () => true }) }); await app.ready()
})
afterAll(async () => { await app.close(); await pg.close() })

describe('/studio/previa', () => {
  it('devolve o HTML do rascunho com o CSS do tema e o destaque do bloco selecionado', async () => {
    const r = await previa({ no: pagina('Olá, prévia'), selecionado: 'titulo' }); expect(r).toMatchObject({ status: 200, ok: true, erros: [] })
    expect(r.html).toContain('<h1 id="titulo">Olá, prévia</h1>'); expect(r.html).toContain('--cor-primaria'); expect(r.html).toContain('#titulo{outline')
  })
  it('usa o tema enviado (e cai no padrão se o tema for inválido)', async () => {
    const tema = { kind: 'tema', id: 'meu', versao: '1.0.0', spec: { tokens: { cor: { primaria: '#abcdef' } } } }
    expect((await previa({ no: pagina('x'), tema })).html.toLowerCase()).toContain('#abcdef')
    expect((await previa({ no: pagina('x'), tema: { kind: 'tema', id: 'ruim', versao: '1.0.0', spec: { tokens: 5 } } })).ok).toBe(true)
  })
  it('erro de compilação vira ok:false com a lista de erros, não 500', async () => {
    const r = await previa({ no: pagina('{variavelQueNaoExiste.x}') }); expect(r).toMatchObject({ status: 200, ok: false, html: '' }); expect(r.erros.length).toBeGreaterThan(0)
    const r2 = await previa({ no: { kind: 'pagina', id: 'p', versao: '1.0.0', spec: { rota: 'sem-barra' } } }); expect(r2.ok).toBe(false)
  })
  it('HTML no texto sai escapado e o id perigoso não vira CSS', async () => {
    const r = await previa({ no: pagina('<img src=x onerror=alert(1)><script>1</script>'), selecionado: 'titulo' }); expect(r.html).not.toContain('<img src=x'); expect(r.html).toContain('&lt;img src=x')
    expect((await previa({ no: pagina('x'), selecionado: 'a}body{display:none' })).status).toBe(400) // o id que vira CSS é validado na borda
    const solto = (await import('../src/preview')).geraPreview(pagina('x'), [], 'a}body{display:none'); expect(solto.ok && solto.html.split('</style>')[0]).not.toContain('a}body') // e, se chegar à função, não entra no CSS
  })
  it('formulário: HTML estático com tema e máscara; `problemas` vazio quando a definição é coerente com o serviço do tenant', async () => {
    const base = registroDaPlataforma()
    const f = { kind: 'formulario', id: 'contato', versao: '1.0.0', spec: { titulo: 'Contato', campos: [{ nome: 'nome', tipo: 'texto', obrigatorio: true }, { nome: 'cpf', tipo: 'cpf' }], acoes: [{ id: 'e', rotulo: 'Enviar', tipo: 'limpar' }] } }
    const r = await previa({ no: f }); expect(r).toMatchObject({ status: 200, ok: true, problemas: [] }); expect(r.html).toContain('<h2>Contato</h2>'); expect(r.html).toContain('placeholder="000.000.000-00"'); expect(r.html).toContain('--cor-primaria'); expect(r.html).toContain('.pl-form{'); expect(r.html).toContain('data-modo="claro"')
    expect((await previa({ no: f, modo: 'escuro' })).html).toContain('data-modo="escuro"'); void base
  })
  it('formulário: `problemas` aponta schema, estrutura, máscara incoerente, regex perigosa, expressão ruim e envio contra o serviço', async () => {
    const f = { kind: 'formulario', id: 'ruim', versao: '1.0.0', spec: { campos: [
      { nome: 'a', tipo: 'cpf', mascara: { padrao: '000.000.00-00' }, validacao: { padrao: '(a+)+$' }, se: 'valores.x ==' },
      { nome: 'a', tipo: 'texto' }, { nome: 'b', tipo: 'texto', validacao: { igualA: 'zzz' } }], envio: { servico: 'nao-existe', operacao: 'x' } } }
    const r = await previa({ no: f }); expect(r.status).toBe(200); const t = (r.problemas as string[]).join('\n')
    expect(t).toContain("já existe um campo 'a'"); expect(t).toContain('10 posição'); expect(t).toContain('repetição aninhada'); expect(t).toContain("'zzz' não é um campo"); expect(t).toContain('/spec/campos/0/se'); expect(t).toMatch(/servico 'nao-existe' não encontrado/)
    expect((await previa({ no: { kind: 'formulario', id: 'x', versao: '1.0.0', spec: { campos: [] } } })).problemas.join()).toMatch(/pelo menos 1/)
    expect(r.html).not.toBe('') // mesmo com problemas, desenha o que dá
  })
  it('formulário: passo da prévia pelo id, texto do autor escapado, definição que não passa no schema devolve só os problemas', async () => {
    const f = { kind: 'formulario', id: 'p', versao: '1.0.0', spec: { titulo: '<img src=x onerror=1>', campos: [{ nome: 'a', tipo: 'texto' }, { nome: 'b', tipo: 'texto' }], passos: [{ id: 'um', titulo: 'Um', campos: ['a'] }, { id: 'dois', titulo: 'Dois', campos: ['b'] }] } }
    const r = await previa({ no: f, selecionado: 'dois' }); expect(r.html).toContain('data-campo="b"'); expect(r.html).not.toContain('data-campo="a"'); expect(r.html).toContain('aria-current="step">Dois'); expect(r.html).not.toMatch(/<img/i)
    const ruim = await previa({ no: { kind: 'formulario', id: 'q', versao: '1.0.0', spec: { campos: [{ nome: 'Ruim Nome', tipo: 'texto' }] } } }); expect(ruim).toMatchObject({ ok: true, html: '' }); expect(ruim.problemas.length).toBeGreaterThan(0)
  })
})
