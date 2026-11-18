import { Registry } from '@polaris/schema'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { A, B, criaAmbiente, type Ambiente } from './ambiente'
import type { InfoTenant, PreviewDeRelease, RegistrosDeTenant, ResolvedorTenant } from '../src/index'

// O gateway serve a RELEASE DE PRODUÇÃO de cada tenant e, só com link assinado, uma release ainda não promovida.
let e: Ambiente
const pagina = (versao: string) => ({ kind: 'pagina', id: 'home', versao, estatuto: 'publicado', spec: { rota: '/', dados: {}, raiz: { bloco: 'texto/paragrafo', props: { texto: `release ${versao}` } } } })
const consultasRegistro: string[] = []
let producaoA: number | null = 1
const registros = new Map<string, Registry>()
const dir = (id: string): InfoTenant => ({ id, status: 'ativo', modulos: ['loja'], release: id === A ? producaoA : null })
const tenants: ResolvedorTenant = { porHost: async (h) => (h === 'a.loja.test' ? dir(A) : h === 'b.loja.test' ? dir(B) : null), porId: async (id) => (id === A || id === B ? dir(id) : null) }
const provedor: RegistrosDeTenant = { producao: async (t, r) => { consultasRegistro.push(`${t.slice(0, 4)}:${r}`); return registros.get(`${t}|${r}`) ?? registros.get(`${t}|base`) ?? e.reg } }
const preview: PreviewDeRelease = {
  verifica: (tok) => { const m = /^ok\.([0-9a-f-]{36})\.(\d+)$/.exec(tok); return m ? { tenantId: m[1]!, release: Number(m[2]) } : null },
  registro: async (t, r) => registros.get(`${t}|${r}`) ?? null,
}
beforeAll(async () => {
  e = await criaAmbiente({ gateway: { tenants, registros: provedor, preview } }); await e.semear()
  const comPagina = (v: string) => { const r = e.reg.derivado(); r.registra({ ...pagina(v), tenantId: A }); return r }
  registros.set(`${A}|1`, comPagina('1.1.0')); registros.set(`${A}|2`, comPagina('2.1.0')); registros.set(`${A}|3`, comPagina('3.1.0')); registros.set(`${A}|base`, e.reg)
  // duas releases com a MESMA versão de página e conteúdo diferente (o autor não subiu a versão): o cache de programas não pode confundir as duas
  const mesmaVersao = (dados: object) => { const r = e.reg.derivado(); r.registra({ kind: 'pagina', id: 'home', versao: '9.9.9', estatuto: 'publicado', tenantId: A, spec: { rota: '/', dados, raiz: { bloco: 'texto/paragrafo', props: { texto: 'x' } } } } as never); return r }
  registros.set(`${A}|4`, mesmaVersao({})); registros.set(`${A}|5`, mesmaVersao({ produtos: 'd.produtos' }))
})
afterAll(async () => { await e.fim() })
const versao = async (host: string, headers: Record<string, string> = {}, tok?: string) => { const r = await e.req('GET', '/bff/paginas/home', { host, ...(tok ? { tok } : {}), headers }); return { status: r.statusCode, corpo: e.json(r) } }

describe('o gateway serve a release de PRODUÇÃO do tenant', () => {
  it('cada tenant vê a página da SUA release; quem não publicou vê o core; promover/rollback mudam o que se serve', async () => {
    expect((await versao('a.loja.test')).corpo.versao).toBe('1.1.0')
    producaoA = 2; expect((await versao('a.loja.test')).corpo.versao).toBe('2.1.0') // promoção
    producaoA = 1; expect((await versao('a.loja.test')).corpo.versao).toBe('1.1.0') // rollback
    expect((await versao('b.loja.test')).corpo.versao).toBe('1.0.0') // B nunca publicou: core
    producaoA = 1
  })
  it('autenticado também recebe a release do tenant do token', async () => {
    const ta = await e.token('ana', A, ['vendedor']); expect((await versao('a.loja.test', {}, ta)).corpo.versao).toBe('1.1.0')
  })
})

describe('cache de programas por release', () => {
  it('duas releases com a MESMA versão de página e conteúdo diferente não se confundem (promover e voltar serve o conteúdo certo)', async () => {
    const chaves = async () => Object.keys((await versao('a.loja.test')).corpo.status).sort()
    producaoA = 4; expect(await chaves()).toEqual([]); producaoA = 5; expect(await chaves()).toEqual(['produtos']); producaoA = 4; expect(await chaves()).toEqual([]); producaoA = 1
  })
})

describe('preview: ver uma release antes de promover', () => {
  it('link válido mostra a release pedida e a produção continua intacta; a produção não vaza para o preview', async () => {
    const r = await versao('a.loja.test', { 'x-polaris-preview': `ok.${A}.3` }); expect(r.corpo.versao).toBe('3.1.0'); expect((await versao('a.loja.test')).corpo.versao).toBe('1.1.0')
  })
  it('link inválido é 401; link de OUTRA conta é 403; release inexistente é 404; link adulterado/longo é recusado', async () => {
    const x = await versao('a.loja.test', { 'x-polaris-preview': 'lixo' }); expect([x.status, x.corpo.erro.codigo]).toEqual([401, 'preview_invalido'])
    const y = await versao('a.loja.test', { 'x-polaris-preview': `ok.${B}.1` }); expect([y.status, y.corpo.erro.codigo]).toEqual([403, 'preview_de_outra_conta'])
    const z = await versao('a.loja.test', { 'x-polaris-preview': `ok.${A}.99` }); expect([z.status, z.corpo.erro.codigo]).toEqual([404, 'release_inexistente'])
    expect((await versao('a.loja.test', { 'x-polaris-preview': 'x'.repeat(3000) })).status).toBe(401)
  })
  it('sem a opção `preview` o cabeçalho é recusado (nunca ignorado em silêncio)', async () => {
    const e2 = await criaAmbiente({ gateway: { tenants, registros: provedor } }); try { const r = await e2.req('GET', '/bff/paginas/home', { host: 'a.loja.test', headers: { 'x-polaris-preview': `ok.${A}.3` } }); expect([r.statusCode, e2.json(r).erro.codigo]).toEqual([400, 'preview_indisponivel']) } finally { await e2.fim() }
  })
  it('o preview vale só para ler página: não altera o REST nem as ações (que seguem em produção)', async () => {
    const ta = await e.token('ana', A, ['vendedor']); const r = await e.req('GET', '/api/loja/produtos', { host: 'a.loja.test', tok: ta, headers: { 'x-polaris-preview': `ok.${A}.3` } }); expect(r.statusCode).toBe(200)
  })
})
void consultasRegistro
