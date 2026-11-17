// @vitest-environment jsdom
import { Registry } from '@polaris/schema'
import { JSDOM } from 'jsdom'
import { act, createElement } from 'react'
import { describe, expect, it, vi } from 'vitest'
import { COMPONENTES_BASE, compilaPrograma, criaCarregador, lazyBloco, registraBase, type Componentes, type ErroRuntime, type PedidoServico, type Programa } from '../src/index'
import { hidrataAsync } from '../src/render/cliente'
import { renderPaginaStream, textoDoStream } from '../src/render/stream'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const no = (kind: string, id: string, spec: object) => ({ kind, id, versao: '1.0.0', estatuto: 'publicado', spec }) as any
const P = (b: string, extra: object = {}) => ({ bloco: b, ...extra })
const espera = (ms: number) => new Promise((r) => setTimeout(r, ms))

function programa(): Programa {
  const r = new Registry()
  registraBase(r)
  r.registra(no('bloco', 'x.grafico', { interface: 'x/grafico', props: { type: 'object', properties: { titulo: { type: 'string' } } } }))
  r.registra(no('servico', 'catalogo', { entidades: {}, operacoes: {} }))
  r.registra(no('dados', 'd.loja', { fonte: { tipo: 'servico', servico: 'catalogo', operacao: 'loja' } }))
  r.registra(no('dados', 'd.prod', { fonte: { tipo: 'servico', servico: 'catalogo', operacao: 'produtos' } }))
  const res = compilaPrograma(r, r.registra(no('pagina', 'p', {
    rota: '/', titulo: '{loja.nome}',
    dados: { loja: 'd.loja', prods: { dados: 'd.prod', stream: true } },
    raiz: P('layout/pilha', { slots: { filhos: [
      P('texto/titulo', { props: { texto: '{loja.nome}' } }),
      P('x/grafico', { props: { titulo: 'vendas' } }),
      P('texto/paragrafo', { id: 'status', props: { texto: '{status.prods}' } }),
      P('texto/paragrafo', { id: 'erro', props: { texto: '{erros.prods}' } }),
      P('nav/botao', { id: 'recarregar', props: { texto: 'Recarregar' }, eventos: { aoClicar: [{ acao: 'executar', dados: 'prods' }] } }),
      P('texto/paragrafo', { id: 'item', repetir: { cada: 'prods', como: 'p' }, props: { texto: '{p.nome}' }, esqueleto: P('texto/paragrafo', { props: { texto: 'carregando-lista' } }) }),
    ] } }),
  })))
  if (!res.ok) throw new Error(JSON.stringify(res.erros, null, 1))
  return res.programa
}

const grafico = ({ props }: { props: Record<string, unknown> }) => createElement('figure', null, `g:${String(props.titulo)}`)
const componentes: Componentes = { ...COMPONENTES_BASE, 'x/grafico': lazyBloco(async () => ({ default: grafico as never })) }

/** Transmite a página, executa os scripts de conclusão do React num "navegador" e devolve o documento final. */
async function paginaTransmitida(prov: (p: PedidoServico) => Promise<unknown>) {
  const pg = programa()
  const s = await renderPaginaStream(pg, componentes, { provedores: { servico: prov }, tenant: { id: 't1' } })
  const html = await textoDoStream(s.stream)
  const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true })
  await espera(400)
  document.documentElement.innerHTML = `<head></head><body>${dom.window.document.body.innerHTML}</body>`
  return { pg, html }
}
const textos = () => [...document.querySelectorAll('#polaris p')].map((p) => `${p.id || 'sem-id'}=${p.textContent}`)

describe('hidratação do HTML transmitido em streaming', () => {
  it('hidrata sem divergência, sem refazer a chamada, e o status fora da fronteira atualiza', async () => {
    const { pg } = await paginaTransmitida(async (p) => (p.operacao === 'loja' ? { nome: 'Padaria Sol' } : [{ nome: 'pão' }, { nome: 'bolo' }]))
    expect(textos()).toEqual(expect.arrayContaining(['status=carregando', 'item=pão', 'item=bolo'])) // o que o servidor entregou
    expect(document.getElementById('polaris')!.textContent).not.toContain('carregando-lista')
    const antes = document.getElementById('polaris')!.innerHTML

    const erro = vi.spyOn(console, 'error').mockImplementation(() => {})
    const chamadas = vi.fn(async () => [])
    const erros: ErroRuntime[] = []
    let raiz!: Awaited<ReturnType<typeof hidrataAsync>>
    await act(async () => { raiz = await hidrataAsync(componentes, { carregador: criaCarregador(pg, { provedores: { servico: chamadas } }), onErro: (e) => erros.push(e) }); await espera(60) })

    expect(erro).not.toHaveBeenCalled() // nenhum aviso de divergência de hidratação
    expect(erros).toEqual([])
    expect(chamadas).not.toHaveBeenCalled() // o dado veio no HTML da fronteira: nenhuma segunda chamada
    expect(textos()).toEqual(expect.arrayContaining(['status=ok', 'item=pão', 'item=bolo'])) // status agora reflete o dado
    expect(document.querySelector('figure')!.textContent).toBe('g:vendas') // bloco lazy hidratou
    expect(document.getElementById('polaris')!.innerHTML.replace(/<p id="status">ok/, '<p id="status">carregando')).toBe(antes)
    erro.mockRestore(); raiz.unmount()
  })

  it('depois de hidratar, executar atualiza a lista (a fronteira passa a seguir o store)', async () => {
    const { pg } = await paginaTransmitida(async (p) => (p.operacao === 'loja' ? { nome: 'Padaria Sol' } : [{ nome: 'pão' }]))
    const erro = vi.spyOn(console, 'error').mockImplementation(() => {})
    const nova = vi.fn(async () => [{ nome: 'croissant' }, { nome: 'sonho' }])
    let raiz!: Awaited<ReturnType<typeof hidrataAsync>>
    await act(async () => { raiz = await hidrataAsync(componentes, { carregador: criaCarregador(pg, { provedores: { servico: nova } }) }); await espera(60) })
    await act(async () => { document.getElementById('recarregar')!.dispatchEvent(new MouseEvent('click', { bubbles: true })); await espera(30) })
    expect(nova).toHaveBeenCalledTimes(1)
    expect(textos()).toEqual(expect.arrayContaining(['item=croissant', 'item=sonho', 'status=ok']))
    expect(textos()).not.toContain('item=pão')
    expect(erro).not.toHaveBeenCalled()
    erro.mockRestore(); raiz.unmount()
  })

  it('fonte em streaming com falha: status erro e a mensagem opaca chegam ao cliente', async () => {
    const { pg } = await paginaTransmitida(async (p) => { if (p.operacao === 'loja') return { nome: 'Padaria Sol' }; throw new Error('segredo-interno') })
    expect(document.body.innerHTML).not.toContain('segredo-interno')
    const erro = vi.spyOn(console, 'error').mockImplementation(() => {})
    let raiz!: Awaited<ReturnType<typeof hidrataAsync>>
    await act(async () => { raiz = await hidrataAsync(componentes, { carregador: criaCarregador(pg, { provedores: { servico: async () => [] } }) }); await espera(60) })
    expect(textos()).toEqual(expect.arrayContaining(['status=erro', 'erro=falha ao carregar os dados']))
    expect(erro).not.toHaveBeenCalled()
    erro.mockRestore(); raiz.unmount()
  })
})
