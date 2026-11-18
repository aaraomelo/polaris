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
    const no = pagina('x'); (no.spec.raiz.slots.filhos[0] as any).id = 'a}body{display:none'; expect((await previa({ no, selecionado: 'a' })).html).not.toContain('a}body{display:none')
  })
})
