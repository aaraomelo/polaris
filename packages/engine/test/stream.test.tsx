import { Registry } from '@polaris/schema'
import { createElement } from 'react'
import { JSDOM } from 'jsdom'
import { describe, expect, it, vi } from 'vitest'
import { COMPONENTES_BASE, compilaPrograma, lazyBloco, registraBase, type Componentes, type ErroRuntime, type PedidoServico, type Programa } from '../src/index'
import { renderPaginaStream, textoDoStream } from '../src/render/stream'

const no = (kind: string, id: string, spec: object) => ({ kind, id, versao: '1.0.0', estatuto: 'publicado', spec }) as any
const P = (b: string, extra: object = {}) => ({ bloco: b, ...extra })

function programa(extra: { raiz?: object; titulo?: string } = {}): Programa {
  const r = new Registry()
  registraBase(r)
  r.registra(no('servico', 'catalogo', { entidades: {}, operacoes: {} }))
  r.registra(no('dados', 'd.loja', { fonte: { tipo: 'servico', servico: 'catalogo', operacao: 'loja' } }))
  r.registra(no('dados', 'd.prod', { fonte: { tipo: 'servico', servico: 'catalogo', operacao: 'produtos' } }))
  const res = compilaPrograma(r, r.registra(no('pagina', 'p', {
    rota: '/', titulo: extra.titulo ?? '{loja.nome}',
    dados: { loja: 'd.loja', prods: { dados: 'd.prod', stream: true } },
    raiz: extra.raiz ?? P('layout/pilha', { slots: { filhos: [
      P('texto/titulo', { props: { texto: '{loja.nome}' } }),
      P('texto/paragrafo', { id: 'status', props: { texto: '{status.prods}' } }),
      P('texto/paragrafo', { id: 'item', repetir: { cada: 'prods', como: 'p' }, props: { texto: '{p.nome}' }, esqueleto: P('texto/paragrafo', { id: 'esq', props: { texto: 'carregando-lista' } }) }),
    ] } }),
  })))
  if (!res.ok) throw new Error(JSON.stringify(res.erros, null, 1))
  return res.programa
}

/** Leitor incremental do stream: acumula o que já chegou e deixa esperar por uma condição. */
function leitor(s: NodeJS.ReadableStream) {
  let acc = ''
  const fim = new Promise<void>((r) => s.on('end', () => r()))
  s.on('data', (c) => { acc += c.toString() })
  return {
    get texto() { return acc },
    fim,
    async ate(pred: (t: string) => boolean, ms = 2000) {
      const t0 = Date.now()
      while (!pred(acc)) { if (Date.now() - t0 > ms) throw new Error(`timeout esperando condição; chegou: ${acc.slice(0, 300)}`); await new Promise((r) => setTimeout(r, 2)) }
    },
  }
}
const portao = () => { let libera!: () => void; const p = new Promise<void>((r) => { libera = r }); return { p, libera } }
const espera = (ms: number) => new Promise((r) => setTimeout(r, ms))

const lojaOk = { nome: 'Padaria Sol' }
const provedor = (porOp: Record<string, (p: PedidoServico) => Promise<unknown>>) => ({ servico: (p: PedidoServico) => porOp[p.operacao]!(p) })

describe('streaming: o shell sai antes dos dados lentos', () => {
  it('esqueleto no shell; o dado chega depois e substitui o esqueleto', async () => {
    const g = portao()
    const s = await renderPaginaStream(programa(), COMPONENTES_BASE, { provedores: provedor({ loja: async () => lojaOk, produtos: async () => { await g.p; return [{ nome: 'pão' }, { nome: 'bolo' }] } }) })
    const l = leitor(s.stream)
    await l.ate((t) => t.includes('carregando-lista'))
    expect(l.texto).toContain('Padaria Sol') // dado bloqueante já está no shell
    expect(l.texto).not.toContain('>pão<') // o lento ainda não chegou
    expect(l.texto).toContain('<!--$?-->') // fronteira pendente
    g.libera()
    await l.fim
    expect(l.texto).toContain('<p id="item">pão</p>')
    expect(l.texto).toContain('<p id="item">bolo</p>')
    expect(l.texto).toMatch(/\$RC\(/) // o React troca o esqueleto pelo conteúdo
    expect(l.texto.endsWith('</div></body></html>')).toBe(true)
    await s.tudoPronto
  })

  it('dado bloqueante segura o primeiro byte; o streaming já começou a carregar em paralelo', async () => {
    const g = portao()
    const ordem: string[] = []
    const prom = renderPaginaStream(programa(), COMPONENTES_BASE, { provedores: provedor({
      loja: async () => { ordem.push('loja-inicio'); await g.p; return lojaOk },
      produtos: async () => { ordem.push('produtos-inicio'); return [{ nome: 'x' }] },
    }) })
    let saiu = false
    void prom.then(() => { saiu = true })
    await espera(30)
    expect(saiu).toBe(false) // o shell depende da loja
    expect(ordem.sort()).toEqual(['loja-inicio', 'produtos-inicio']) // as duas cargas já estavam em andamento
    g.libera()
    const s = await prom
    expect(await textoDoStream(s.stream)).toContain('Padaria Sol')
  })

  it('esperaTudo (robôs/SEO): a página sai completa, sem esqueleto nem troca de fronteira', async () => {
    const s = await renderPaginaStream(programa(), COMPONENTES_BASE, { esperaTudo: true, provedores: provedor({ loja: async () => lojaOk, produtos: async () => { await espera(20); return [{ nome: 'pão' }] } }) })
    const t = await textoDoStream(s.stream)
    const pagina = t.slice(t.indexOf('<div id="polaris">')) // o `programa` embutido no estado também contém o texto do esqueleto
    expect(pagina).toContain('<p id="item">pão</p>')
    expect(pagina).not.toContain('carregando-lista')
    expect(t).not.toMatch(/\$RC\(/)
  })

  it('o estado de hidratação vem ANTES do conteúdo e só traz o bloqueante', async () => {
    const s = await renderPaginaStream(programa(), COMPONENTES_BASE, { provedores: provedor({ loja: async () => lojaOk, produtos: async () => [{ nome: 'x' }] }) })
    const t = await textoDoStream(s.stream)
    const iEstado = t.indexOf('id="__POLARIS__"')
    expect(iEstado).toBeGreaterThan(0)
    expect(iEstado).toBeLessThan(t.indexOf('id="polaris"'))
    const json = JSON.parse(t.slice(t.indexOf('>', iEstado) + 1, t.indexOf('</script>', iEstado)))
    expect(json.dados).toEqual({ loja: lojaOk }) // `prods` NÃO está aqui: chega dentro da própria fronteira
    expect(json.status.prods).toBeUndefined() // o cliente deriva: dado em streaming sem valor na semente = carregando
  })

  it('o dado em streaming viaja dentro do HTML da fronteira (data-pl-b), com JSON escapado', async () => {
    const hostil = '</script><script>alert(1)</script><!--'
    const s = await renderPaginaStream(programa(), COMPONENTES_BASE, { provedores: provedor({ loja: async () => lojaOk, produtos: async () => [{ nome: hostil }] }) })
    const t = await textoDoStream(s.stream)
    expect(t).toContain('data-pl-b="r/filhos/2"')
    expect(t).not.toContain('<script>alert(1)')
    expect(t).not.toMatch(/<\/script><script>/)
    const m = /<script type="application\/json" data-pl-b="[^"]+">([\s\S]*?)<\/script>/.exec(t)!
    expect(JSON.parse(m[1]!).prods.valor[0].nome).toBe(hostil)
  })
})

describe('streaming: falhas', () => {
  it('fonte em streaming que falha: a página termina, com status erro e mensagem opaca', async () => {
    const onErro = vi.fn()
    const s = await renderPaginaStream(programa(), COMPONENTES_BASE, { onErro, provedores: provedor({ loja: async () => lojaOk, produtos: async () => { throw new Error('senha=hunter2 db-interno') } }) })
    const t = await textoDoStream(s.stream)
    expect(t).not.toMatch(/hunter2|db-interno/)
    const m = /data-pl-b="[^"]+">([\s\S]*?)<\/script>/.exec(t)!
    expect(JSON.parse(m[1]!)).toEqual({ prods: { ok: false, erro: 'falha ao carregar os dados' } })
    expect(t).not.toContain('class="item"')
    expect(onErro).toHaveBeenCalled()
  })

  it('timeout da fonte em streaming vira erro, sem travar o stream', async () => {
    const r = new Registry()
    registraBase(r)
    r.registra(no('servico', 'catalogo', { entidades: {}, operacoes: {} }))
    r.registra(no('dados', 'd.lento', { fonte: { tipo: 'servico', servico: 'catalogo', operacao: 'x' }, timeoutMs: 20 }))
    const res = compilaPrograma(r, r.registra(no('pagina', 'p', { rota: '/', dados: { l: { dados: 'd.lento', stream: true } }, raiz: P('texto/paragrafo', { props: { texto: '{l}' }, se: 'l', esqueleto: P('texto/paragrafo', { props: { texto: 'aguarde' } }) }) })))
    if (!res.ok) throw new Error(JSON.stringify(res.erros))
    const s = await renderPaginaStream(res.programa, COMPONENTES_BASE, { provedores: { servico: () => new Promise(() => {}) } })
    const t = await textoDoStream(s.stream)
    expect(t).toContain('"erro":"tempo esgotado (20 ms)"')
  })

  it('erro no shell rejeita (ainda dá para responder 500)', async () => {
    const quebra: Componentes = { ...COMPONENTES_BASE, 'texto/titulo': () => { throw new Error('quebrou no shell') } }
    await expect(renderPaginaStream(programa(), quebra, { provedores: provedor({ loja: async () => lojaOk, produtos: async () => [] }) })).rejects.toThrow(/quebrou no shell/)
  })

  it('componente que lança DENTRO de uma fronteira: reportado, a página termina com status 200', async () => {
    const quebra: Componentes = { ...COMPONENTES_BASE, 'texto/paragrafo': ({ props, id }) => { if (id === 'item') throw new Error('item quebrou'); return createElement('p', id ? { id } : null, String(props.texto ?? '')) } }
    const erros: ErroRuntime[] = []
    const s = await renderPaginaStream(programa(), quebra, { onErroRuntime: (e) => erros.push(e), provedores: provedor({ loja: async () => lojaOk, produtos: async () => [{ nome: 'x' }] }) })
    expect(s.status).toBe(200)
    const t = await textoDoStream(s.stream)
    expect(t).toContain('Padaria Sol')
    expect(erros.some((e) => e.mensagem.includes('item quebrou'))).toBe(true)
  })

  it('abort: fronteiras que não terminam são entregues ao cliente e o stream fecha', async () => {
    const s = await renderPaginaStream(programa(), COMPONENTES_BASE, { abortaEmMs: 30, timeoutPadraoMs: 5000, provedores: provedor({ loja: async () => lojaOk, produtos: () => new Promise(() => {}) }) })
    const t = await textoDoStream(s.stream)
    expect(t.endsWith('</div></body></html>')).toBe(true)
    expect(t).toContain('carregando-lista')
  })
})

describe('streaming: CSP', () => {
  it('nonce vai nos scripts inline do React e nos módulos; sem nonce nada é adicionado', async () => {
    const g = portao()
    const prov = provedor({ loja: async () => lojaOk, produtos: async () => { await g.p; return [{ nome: 'x' }] } })
    const s = await renderPaginaStream(programa(), COMPONENTES_BASE, { nonce: 'abc123', scripts: ['/assets/app.js'], provedores: prov })
    const l = leitor(s.stream)
    await l.ate((t) => t.includes('carregando-lista')); g.libera(); await l.fim
    expect(l.texto).toContain('<script type="module" nonce="abc123" src="/assets/app.js"></script>')
    const inline = [...l.texto.matchAll(/<script(?![^>]*type=)([^>]*)>/g)].map((m) => m[1])
    expect(inline.length).toBeGreaterThan(0)
    expect(inline.every((a) => a!.includes('nonce="abc123"'))).toBe(true) // todo script executável tem nonce
    const sem = await renderPaginaStream(programa(), COMPONENTES_BASE, { scripts: ['/a.js'], provedores: provedor({ loja: async () => lojaOk, produtos: async () => [] }) })
    expect(await textoDoStream(sem.stream)).not.toContain('nonce')
  })
})

describe('streaming: estrutura e navegador', () => {
  it('só a fronteira espera: o conteúdo que não usa o dado sai no shell', async () => {
    const g = portao()
    const s = await renderPaginaStream(programa(), COMPONENTES_BASE, { provedores: provedor({ loja: async () => lojaOk, produtos: async () => { await g.p; return [] } }) })
    const l = leitor(s.stream)
    await l.ate((t) => t.includes('carregando-lista'))
    expect(l.texto).toContain('<h1>Padaria Sol</h1>')
    expect(l.texto).toContain('<p id="status">carregando</p>')
    g.libera(); await l.fim
  })

  it('num navegador real (scripts executados) o conteúdo troca o esqueleto no lugar certo', async () => {
    const s = await renderPaginaStream(programa(), COMPONENTES_BASE, { provedores: provedor({ loja: async () => lojaOk, produtos: async () => { await espera(15); return [{ nome: 'pão' }, { nome: 'bolo' }] } }) })
    const html = await textoDoStream(s.stream)
    const dom = new JSDOM(html, { runScripts: 'dangerously', pretendToBeVisual: true })
    await espera(400) // o React agrupa as trocas de fronteira com um pequeno atraso
    const raiz = dom.window.document.getElementById('polaris')!
    const itens = [...raiz.querySelectorAll('p#item')].map((p) => p.textContent)
    expect(itens).toEqual(['pão', 'bolo'])
    expect(raiz.textContent).not.toContain('carregando-lista')
    expect(raiz.querySelector('#esq')).toBeNull()
  })

  it('blocos lazy: pré-carregados antes do shell, com modulepreload no <head>', async () => {
    const grafico = vi.fn(async () => ({ default: ({ props }: { props: Record<string, unknown> }) => createElement('figure', null, `g:${String(props.titulo)}`) }))
    const r = new Registry()
    registraBase(r)
    r.registra(no('bloco', 'x.grafico', { interface: 'x/grafico', props: { type: 'object', properties: { titulo: { type: 'string' } } } }))
    const res = compilaPrograma(r, r.registra(no('pagina', 'p', { rota: '/', raiz: P('x/grafico', { props: { titulo: 'v' } }) })))
    if (!res.ok) throw new Error('x')
    const comps: Componentes = { ...COMPONENTES_BASE, 'x/grafico': lazyBloco(grafico as never, { chunk: '/assets/grafico.1.js' }) }
    const s = await renderPaginaStream(res.programa, comps, { provedores: {} })
    const t = await textoDoStream(s.stream)
    expect(t).toContain('<figure>g:v</figure>') // sem fallback: o módulo já estava carregado
    expect(t).toContain('<link rel="modulepreload" href="/assets/grafico.1.js">')
    expect(t).not.toContain('<!--$?-->')
    expect(s.preCarga.carregados).toEqual(['x/grafico'])
  })

  it('módulo lazy que falha: a página sai sem o bloco e relata', async () => {
    const r = new Registry()
    registraBase(r)
    r.registra(no('bloco', 'x.g', { interface: 'x/g' }))
    const res = compilaPrograma(r, r.registra(no('pagina', 'p', { rota: '/', raiz: P('layout/pilha', { slots: { filhos: [P('x/g'), P('texto/paragrafo', { props: { texto: 'resto' } })] } }) })))
    if (!res.ok) throw new Error('x')
    const erros: ErroRuntime[] = []
    const s = await renderPaginaStream(res.programa, { ...COMPONENTES_BASE, 'x/g': lazyBloco(async () => { throw new Error('404') }) }, { provedores: {}, onErroRuntime: (e) => erros.push(e) })
    expect(await textoDoStream(s.stream)).toContain('<p>resto</p>')
    expect(erros.some((e) => e.mensagem.includes("'x/g' não carregou"))).toBe(true)
  })
})
