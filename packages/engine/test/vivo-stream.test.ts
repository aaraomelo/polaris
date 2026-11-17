import { JSDOM } from 'jsdom'
import { describe, expect, it } from 'vitest'
import { empacotaCliente } from '../src/aot/index'
import { COMPONENTES_BASE, compilaHtmlVivo, compilaPrograma, registraBase, renderPaginaHtml, type Programa } from '../src/index'
import { Registry } from '@polaris/schema'
import { semeiaDaFila } from '../src/vivo/fila'
import { BOOT, hashDoBoot, streamVivo, textoDoStreamVivo } from '../src/vivo/stream'

import { VALORES, no, P, pagina } from './fixtures-stream'

function canon(n: Node): string {
  if (n.nodeType === 3) return n.textContent!
  if (n.nodeType !== 1) return ''
  const el = n as HTMLElement
  const attrs = [...el.attributes].filter((a) => a.name !== 'value').map((a) => `${a.name}=${JSON.stringify(a.value)}`).sort()
  if (el.tagName === 'INPUT') attrs.push(`value=${JSON.stringify((el as HTMLInputElement).value)}`)
  const filhos: string[] = []; let t = ''
  for (const c of [...el.childNodes]) { if (c.nodeType === 3) t += c.textContent; else if (c.nodeType === 1) { if (t) { filhos.push(t); t = '' } filhos.push(canon(c)) } }
  if (t) filhos.push(t)
  return `<${el.tagName.toLowerCase()} ${attrs.join(' ')}>${filhos.join('')}</>`
}

type Deferred = { promise: Promise<unknown>; ok(v: unknown): void; falha(e: Error): void }
const deferred = (): Deferred => { let ok!: (v: unknown) => void, falha!: (e: Error) => void; const promise = new Promise<unknown>((a, b) => { ok = a; falha = b }); return { promise, ok, falha } }
const tick = () => new Promise((r) => setTimeout(r, 0))

/**
 * Um navegador simulado recebendo o documento aos pedaços. `montaAntes`: índice do pedaço ANTES do qual o runtime carrega (0 = logo depois do shell;
 * n = só depois do último pedaço). Devolve o estado final do DOM e do runtime.
 */
async function roda(pg: Programa, opcoes: { ordem: string[]; montaAntes: number; falhas?: string[]; esperaTudo?: boolean; abortaEmMs?: number; deixaPendente?: string[] }) {
  const pac = await empacotaCliente(pg)
  if (!pac.ok) throw new Error(JSON.stringify(pac.motivos))
  const defs: Record<string, Deferred> = Object.fromEntries(['a', 'b', 'c', 'd'].map((k) => [k, deferred()]))
  const gen = streamVivo(pg, { provedores: { servico: (p) => defs[p.operacao]!.promise as Promise<unknown> }, clienteSrc: '/c.js', timeoutPadraoMs: 60000, ...(opcoes.esperaTudo ? { esperaTudo: true } : {}), ...(opcoes.abortaEmMs ? { abortaEmMs: opcoes.abortaEmMs } : {}) })
  defs.c!.ok(VALORES.c) // o bloqueante já está pronto
  // (jsdom reabre o documento a cada document.write fora do parser: o fluxo é simulado inserindo cada pedaço no <body>, como o parser faz)
  const dom = new JSDOM('', { runScripts: 'dangerously' })
  const w = dom.window as any
  const doc = w.document as Document
  const pedacos: string[] = []
  let primeiroEscrito = false
  const escreve = async (s: string) => {
    pedacos.push(s)
    if (!primeiroEscrito) { // o 1º pedaço traz o <head> (com o boot inline) e o começo do <body>
      primeiroEscrito = true
      expect(s).toContain(`<script>${BOOT}</script>`)
      w.eval(BOOT) // o script do <head> roda antes de o corpo existir
      doc.body.innerHTML = s.slice(s.indexOf('<body>') + 6)
    } else if (!s.startsWith('</body>')) doc.body.insertAdjacentHTML('beforeend', s)
    await tick()
  }
  const resolve = (k: string) => (opcoes.falhas ?? []).includes(k) ? defs[k]!.falha(new Error(`segredo-do-provedor ${k}`)) : defs[k]!.ok(VALORES[k])

  if (opcoes.esperaTudo) for (const k of opcoes.ordem) resolve(k)
  const primeiro = await gen.next()
  await escreve(primeiro.value as string)
  let indice = 0
  const monta = async () => { w.eval(pac.pacote.codigo); await tick() }
  let montou = false
  const quandoMontar = async () => { if (!montou && indice >= opcoes.montaAntes) { montou = true; await monta() } }
  await quandoMontar()
  for (const k of opcoes.ordem) {
    if ((opcoes.deixaPendente ?? []).includes(k)) continue
    if (!opcoes.esperaTudo) resolve(k)
    const r = await gen.next()
    if (r.done) break
    indice++
    await quandoMontar() // o runtime carrega ANTES deste pedaço chegar
    await escreve(r.value)
  }
  for (;;) { const r = await gen.next(); if (r.done) break; indice++; await quandoMontar(); await escreve(r.value) }
  if (!montou) { montou = true; await monta() }
  await tick()
  return { w, doc, dom, pedacos, vivo: w.__PL?.montado }
}

function oraculo(pg: Programa, doc: Document, store: { estado: any; dados: any; status: any; erros: any }) {
  const d = doc.createElement('div')
  d.innerHTML = renderPaginaHtml({ programa: pg, componentes: COMPONENTES_BASE, estado: store.estado, dados: store.dados, status: store.status, erros: store.erros }).corpo
  return [...d.childNodes].map(canon).join('')
}
const atual = (doc: Document) => [...doc.getElementById('polaris')!.childNodes].map(canon).join('')
const textos = (doc: Document) => [...doc.querySelectorAll('#polaris p, #polaris h2, #polaris h3, #polaris h4, #polaris h5')].map((e) => e.textContent).join('|')
const FINAL = { estado: {}, dados: { a: VALORES.a, b: VALORES.b, c: VALORES.c, d: VALORES.d }, status: { a: 'ok', b: 'ok', c: 'ok', d: 'ok' }, erros: {} }

describe('fronteiras no HTML marcado do servidor', () => {
  it('o HTML traz marcadores f:/…, esqueleto enquanto carrega, e o servidor sabe quais fronteiras pode trocar', () => {
    const pg = pagina()
    const h = compilaHtmlVivo(pg); if (!h.ok) throw new Error(JSON.stringify(h.motivos))
    const fr = Object.fromEntries(h.pagina.fronteiras.map((f) => [f.chave, f]))
    const porVars = (v: string) => h.pagina.fronteiras.filter((f) => f.vars.join() === v)
    expect(h.pagina.retidas).toEqual(['b']) // b é usado por uma fronteira dentro de repetir
    expect(h.pagina.fronteiras.length).toBe(8)
    expect(porVars('b').length).toBe(2) // a do repetir e a da página: ambas usam b
    expect(porVars('b').every((f) => !f.trocavel)).toBe(true) // nenhuma das duas é trocada no HTML: o estado do cliente tem de bater com o DOM
    expect(h.pagina.fronteiras.filter((f) => f.vars.join() !== 'b').every((f) => f.trocavel)).toBe(true) // ...as demais podem
    expect(Object.keys(fr).every((k) => /^[A-Za-z0-9/_.~]+$/.test(k))).toBe(true) // chave segura para comentário e literal
    const corpo = h.pagina.render({ dados: { c: VALORES.c } }).corpo
    expect(corpo).toContain('carregando a') // esqueleto
    expect(corpo).not.toContain('a=A')
    expect(corpo.match(/<!--f:/g)!.length).toBe(corpo.match(/<!--\/f:/g)!.length)
  })
})

describe('streaming sem React: o navegador recebe os pedaços e o resultado final é o do React', () => {
  const pg = pagina()
  const ORDENS = [['a', 'd', 'b'], ['b', 'd', 'a'], ['d', 'a', 'b'], ['d', 'b', 'a']]

  it('runtime carregado em QUALQUER ponto do fluxo (antes dos dados, no meio, depois de tudo): DOM final = oráculo, hidratado sem reconstruir', async () => {
    for (const ordem of ORDENS) for (let montaAntes = 0; montaAntes <= 4; montaAntes++) {
      const r = await roda(pg, { ordem, montaAntes })
      const rotulo = `ordem ${ordem} monta antes do pedaço ${montaAntes}`
      expect(r.vivo, rotulo).toBeDefined()
      expect(r.vivo.diagnostico().hidratou, `${rotulo}: hidratou (adotou o HTML do servidor)`).toBe(true)
      expect(r.vivo.store().status, rotulo).toEqual({ a: 'ok', b: 'ok', c: 'ok', d: 'ok' })
      expect(atual(r.doc), rotulo).toBe(oraculo(pg, r.doc, r.vivo.store()))
      expect(atual(r.doc), rotulo).toBe(oraculo(pg, r.doc, FINAL))
    }
  }, 60000)

  it('esqueletos sobem e descem: no meio do caminho o DOM já mostra o que chegou e o esqueleto do que falta', async () => {
    const meio = await roda(pg, { ordem: ['a'], montaAntes: 0, abortaEmMs: 50 })
    expect(textos(meio.doc)).toContain('a=A') // chegou
    expect(meio.vivo.store().status.a).toBe('ok')
    // d e b não resolveram: o prazo os transformou em erro (a página não fica presa em esqueleto)
    expect(meio.vivo.store().status).toMatchObject({ b: 'erro', d: 'erro' })
    expect(meio.vivo.store().erros.d).toBe('tempo esgotado')
    expect(atual(meio.doc)).toBe(oraculo(pg, meio.doc, meio.vivo.store()))
  })

  it('falha de dado: vira erro opaco (o detalhe do provedor não vaza para o HTML), a fronteira sai do esqueleto e a página continua', async () => {
    for (const montaAntes of [0, 2, 4]) {
      const r = await roda(pg, { ordem: ['a', 'd', 'b'], montaAntes, falhas: ['d'] })
      const html = r.doc.documentElement.outerHTML
      expect(html).not.toContain('segredo-do-provedor')
      expect(r.vivo.store().status.d).toBe('erro')
      expect(r.vivo.diagnostico().hidratou).toBe(true)
      expect(atual(r.doc), `monta antes de ${montaAntes}`).toBe(oraculo(pg, r.doc, r.vivo.store()))
    }
  }, 30000)

  it('esperaTudo (robôs/SEO): um único pedaço de conteúdo, sem esqueletos e sem pedaços de dados', async () => {
    const r = await roda(pg, { ordem: ['a', 'b', 'd'], montaAntes: 1, esperaTudo: true })
    expect(r.pedacos.some((p) => p.includes('<script type="application/json" data-pl-c>'))).toBe(false)
    expect(textos(r.doc)).not.toContain('carregando') // nenhum esqueleto: o shell já saiu completo
    expect(r.pedacos.length).toBe(2) // o documento inteiro + o fechamento
    expect(atual(r.doc)).toBe(oraculo(pg, r.doc, FINAL))
  })

  it('esperaTudo com um dado que FALHA: a fronteira mostra o conteúdo (com o erro disponível), não o esqueleto', async () => {
    const r = await roda(pg, { ordem: ['a', 'b', 'd'], montaAntes: 1, esperaTudo: true, falhas: ['d'] })
    expect(textos(r.doc)).not.toContain('carregando')
    expect(r.vivo.store().status.d).toBe('erro')
    expect(atual(r.doc)).toBe(oraculo(pg, r.doc, r.vivo.store()))
  })

  it('FUZZ: ordem de chegada, ponto de montagem e falhas aleatórios — sempre o mesmo DOM que o React para o estado final', async () => {
    let s = 77
    const rnd = () => ((s = (s * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff)
    for (let i = 0; i < 40; i++) {
      const ordem = ['a', 'b', 'd'].sort(() => rnd() - 0.5)
      const falhas = ['a', 'b', 'd'].filter(() => rnd() < 0.25)
      const r = await roda(pg, { ordem, montaAntes: Math.floor(rnd() * 5), falhas })
      const rot = `#${i} ordem ${ordem} falhas ${falhas}`
      expect(r.vivo.diagnostico().hidratou, rot).toBe(true)
      for (const k of ['a', 'b', 'd']) expect(r.vivo.store().status[k], `${rot} status ${k}`).toBe(falhas.includes(k) ? 'erro' : 'ok')
      expect(atual(r.doc), rot).toBe(oraculo(pg, r.doc, r.vivo.store()))
    }
  }, 120000)
})

describe('segurança e protocolo', () => {
  it('valor com </script>, <!-- e U+2028 viaja só como JSON inerte: nenhum elemento é injetado e o dado chega intacto', async () => {
    const pg = pagina()
    const r = await roda(pg, { ordem: ['a', 'd', 'b'], montaAntes: 3 })
    expect(r.doc.querySelector('#polaris')!.innerHTML).not.toContain('<!--x') // o texto hostil aparece escapado como texto, não como marcação
    expect(textos(r.doc)).toContain('D</script><!--x')
    const brutos = r.pedacos.join('')
    const blocos = [...brutos.matchAll(/<script type="application\/json" data-pl-c>([^]*?)<\/script>/g)].map((m) => m[1]!)
    expect(blocos.length).toBe(3)
    for (const b of blocos) expect(b).not.toMatch(/[<>&\u2028\u2029]/)
    expect(r.vivo.store().dados.d).toEqual(VALORES.d)
  })

  it('o script de boot é estático (um hash de CSP para o site todo) e os pedaços de dados são JSON inerte, sem scripts por pedaço', async () => {
    const pg = pagina()
    const doc = await textoDoStreamVivo(streamVivo(pg, { provedores: { servico: async (p) => VALORES[p.operacao] }, clienteSrc: '/c.js' }))
    expect(doc.match(/<script[^>]*>/g)!.filter((t) => !/type="application\/json"/.test(t) && !/src=/.test(t)).length).toBe(1) // só o boot
    expect(doc).toContain(BOOT)
    expect(await hashDoBoot()).toMatch(/^sha256-[A-Za-z0-9+/]+=*$/)
    const comNonce = await textoDoStreamVivo(streamVivo(pg, { provedores: { servico: async (p) => VALORES[p.operacao] }, clienteSrc: '/c.js', nonce: 'abc' }))
    expect(comNonce).toContain('<script nonce="abc">')
  })

  it('semeiaDaFila: o que o DOM já mostra entra no estado; o marcado `tarde` espera a hidratação; o último valor vence', () => {
    const s = semeiaDaFila([{ d: [['a', true, 1, false], ['b', true, 2, true]] }, { d: [['a', true, 3], ['c', false, 'boom']] }, {}])
    expect(s.dados).toEqual({ a: 3 }); expect(s.status).toEqual({ a: 'ok', c: 'erro' }); expect(s.erros).toEqual({ c: 'boom' })
    expect(s.tardias).toEqual([['b', true, 2]])
  })

  it('página que o runtime vivo não suporta é recusada antes de qualquer byte', async () => {
    const r = new Registry(); registraBase(r)
    r.registra(no('bloco', 'x.nada', { interface: 'x/nada' }))
    const res = compilaPrograma(r, r.registra(no('pagina', 'nao', { rota: '/', raiz: P('x/nada') })))
    if (!res.ok) throw new Error('x')
    await expect(streamVivo(res.programa, { provedores: {}, clienteSrc: '/c.js' }).next()).rejects.toThrow(/não roda no runtime vivo/)
  })
})
