import { readFileSync } from 'node:fs'
import { registraBase } from '@polaris/engine'
import { registraTemas } from '@polaris/engine/tema'
import { registroDaPlataforma } from '@polaris/packs'
import { describe, expect, it } from 'vitest'
import { OPERACOES, chama, criaCarregador, ErroStudio } from '../src/host/api'

const reg = registroDaPlataforma(); registraBase(reg); registraTemas(reg)
const servico = reg.resolve('servico', 'studio')!.no.spec as { operacoes: Record<string, { metodo: string; caminho: string; entrada?: Record<string, unknown> }> }

describe('o hospedeiro e o contrato `servico studio`', () => {
  it('toda operação do contrato tem tradução para a API REST, e nenhuma tradução sobra', () => { expect(Object.keys(OPERACOES).sort()).toEqual(Object.keys(servico.operacoes).sort()) })
  it('o método e o caminho que o hospedeiro usa batem com o contrato (parâmetros do caminho = entrada)', () => {
    const arg = (op: string) => Object.fromEntries(Object.keys(servico.operacoes[op]!.entrada ?? {}).map((k) => [k, k === 'seq' ? 3 : k === 'resolvido' ? true : k === 'no' ? { a: 1 } : 'x']))
    for (const [op, def] of Object.entries(servico.operacoes)) {
      const r = OPERACOES[op]!(arg(op)); expect(r.metodo, op).toBe(def.metodo)
      // o caminho do contrato (`/nos/:kind/:id`) é o da API com o prefixo /studio e o mesmo formato de segmentos
      const esperado = def.caminho.replace(/:[a-zA-Z]+/g, '[^/?]+'); expect(new RegExp(`^/studio${esperado}(\\?.*)?$`).test(r.url), `${op}: ${r.url} ≁ ${def.caminho}`).toBe(true)
    }
  })
  it('id com barra vai como segmentos separados (a rota usa curinga); kind e valores de consulta são escapados', () => {
    expect(OPERACOES.abrirNo!({ kind: 'pagina', id: 'a/b c' }).url).toBe('/studio/nos/pagina/a/b%20c'); expect(OPERACOES.listarComentarios!({ kind: 'p&q', id: 'x y' }).url).toBe('/studio/comentarios?kind=p%26q&id=x%20y')
    expect(OPERACOES.compararVersoes!({ kind: 'pagina', id: 'h', de: 'base', para: 2 }).url).toBe('/studio/diff/pagina/h?de=base&para=2')
  })
  it('o corpo: salvar leva baseSeq (inclusive null) e omite o que é indefinido; previa e comentário descartam vazios', () => {
    expect(OPERACOES.salvarNo!({ kind: 'tema', id: 'm', no: { x: 1 }, baseSeq: null, nota: '' }).corpo).toEqual({ no: { x: 1 }, baseSeq: null }); expect(OPERACOES.salvarNo!({ kind: 'tema', id: 'm', no: {}, nota: 'n' }).corpo).toEqual({ no: {}, nota: 'n' })
    expect(OPERACOES.previsualizar!({ no: { a: 1 }, tema: null, selecionado: '' }).corpo).toEqual({ no: { a: 1 } }); expect(OPERACOES.comentar!({ kind: 'pagina', id: 'h', texto: 't', ancora: '', versao: null, respondeA: '' }).corpo).toEqual({ kind: 'pagina', id: 'h', texto: 't' })
  })
  it('chama: token no cabeçalho, erro do servidor vira ErroStudio com os detalhes, operação desconhecida é recusada; o carregador só atende dados do serviço studio', async () => {
    const vistos: Array<{ url: string; init: any }> = []
    const f = (async (url: string, init: any) => { vistos.push({ url, init }); return url.includes('ruim') ? new Response(JSON.stringify({ erro: { codigo: 'no_invalido', mensagem: 'o nó não passou', erros: ['a', 'b', 'c', 'd'] } }), { status: 422 }) : new Response(JSON.stringify({ ok: 1 })) }) as unknown as typeof fetch
    expect(await chama('listarNos', {}, { fetch: f, token: 'tok123' })).toEqual({ ok: 1 }); expect(vistos[0]!.init.headers.authorization).toBe('Bearer tok123')
    const e: any = await chama('abrirNo', { kind: 'pagina', id: 'ruim' }, { fetch: f }).catch((x) => x); expect(e).toBeInstanceOf(ErroStudio); expect(e).toMatchObject({ status: 422, codigo: 'no_invalido' }); expect(e.message).toBe('o nó não passou: a; b; c')
    await expect(chama('constructor', {}, { fetch: f })).rejects.toThrow(/desconhecida/); await expect(chama('__proto__', {}, { fetch: f })).rejects.toThrow(/desconhecida/)
    const prog = { pagina: { dados: { x: { id: 'd.x' }, y: { id: 'd.y' } }, fontes: { 'd.x': { fonte: { servico: 'studio', operacao: 'listarNos' }, carregar: 'auto' }, 'd.y': { fonte: { servico: 'outro', operacao: 'o' }, carregar: 'manual' } } } }
    const c = criaCarregador(prog as never, { fetch: f, token: 't' }); expect(await c({ dados: 'x', args: {}, estado: {} })).toEqual({ ok: 1 }); await expect(c({ dados: 'y', args: {}, estado: {} })).rejects.toThrow(/não é do serviço studio/); await expect(c({ dados: 'z', args: {}, estado: {} })).rejects.toThrow(); await expect(c({ dados: 'constructor', args: {}, estado: {} })).rejects.toThrow()
  })
  it('a prévia espera um instante: uma rajada de chamadas faz UMA requisição (a última), as superadas devolvem ausente; operações comuns saem na hora', async () => {
    const vistos: string[] = []
    const f = (async (url: string, init: any) => { vistos.push(String(JSON.parse(init.body ?? '{}').no ?? url)); return new Response(JSON.stringify({ ok: true }), { status: 200 }) }) as never
    const prog = { pagina: { dados: { p: { id: 'd.p' }, l: { id: 'd.l' } }, fontes: { 'd.p': { fonte: { servico: 'studio', operacao: 'previsualizar' }, carregar: 'manual' }, 'd.l': { fonte: { servico: 'studio', operacao: 'listarNos' }, carregar: 'auto' } } } }
    const c = criaCarregador(prog as never, { fetch: f, token: 't' })
    const rajada = ['a', 'b', 'c'].map((no) => c({ dados: 'p', args: { no }, estado: {} }))
    expect(await Promise.all(rajada)).toEqual([undefined, undefined, { ok: true }]); expect(vistos).toEqual(['c'])
    vistos.length = 0; expect(await c({ dados: 'l', args: {}, estado: {} })).toEqual({ ok: true }); expect(vistos).toEqual(['/studio/nos']) // sem atraso
    expect(await c({ dados: 'p', args: { no: 'd' }, estado: {} })).toEqual({ ok: true }); expect(vistos).toEqual(['/studio/nos', 'd']) // chamadas separadas no tempo não se fundem
  })
  it('toda `dados` do pack studio aponta para uma operação que existe no contrato', () => {
    const nos = JSON.parse(readFileSync(new URL('../../../packages/packs/nos/studio/pagina-studio.json', import.meta.url), 'utf8')) as Array<{ kind: string; id: string; spec: { fonte?: { servico?: string; operacao?: string } } }>
    const dados = nos.filter((n) => n.kind === 'dados'); expect(dados.length).toBeGreaterThan(8)
    for (const d of dados) { expect(d.spec.fonte!.servico).toBe('studio'); expect(Object.keys(servico.operacoes), d.id).toContain(d.spec.fonte!.operacao) }
  })
})
