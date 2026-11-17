import { afterAll, describe, expect, it } from 'vitest'
import { PADROES_CODIGO, verificaSintaxe, type PedidoCodigo, type ResultadoCodigo, type Sandbox } from '../src/index'
import { criaSandboxLocal } from '../src/sandbox/local'
import { criaSandboxWorker, Ponte } from '../src/sandbox/worker'

const AGORA = '2026-06-08T12:00:00.000Z'
const pedido = (fonte: string, props: unknown = {}, extra: Partial<PedidoCodigo> = {}): PedidoCodigo => ({ fonte, props, contexto: { agora: AGORA, idioma: 'pt-BR' }, ...extra })
const render = (corpo: string) => `function render(props, ctx) { ${corpo} }`

const sandboxes: Array<[string, () => Promise<Sandbox>]> = [['local (QuickJS no processo)', criaSandboxLocal], ['worker (QuickJS em worker_thread)', () => criaSandboxWorker()]]
const abertos: Sandbox[] = []
afterAll(() => abertos.forEach((s) => s.libera()))

describe.each(sandboxes)('sandbox %s', (_nome, fabrica) => {
  let sb!: Sandbox
  const ok = (r: ResultadoCodigo) => { if (!r.ok) throw new Error(`${r.tipo}: ${r.erro}`); return JSON.parse(r.saida) }
  const falha = (r: ResultadoCodigo) => { if (r.ok) throw new Error('esperava falha: ' + r.saida); return r }
  const roda = (fonte: string, props?: unknown, extra?: Partial<PedidoCodigo>) => sb.executa(pedido(fonte, props, extra))

  it('inicia', async () => { sb = await fabrica(); abertos.push(sb) })

  describe('execução', () => {
    it('render(props, ctx) devolve JSON; props e contexto chegam por cópia', () => {
      const r = ok(roda(render('return { tag: "p", children: [props.nome + ":" + ctx.idioma + ":" + ctx.agora] }'), { nome: 'Sol' }))
      expect(r).toEqual({ tag: 'p', children: ['Sol:pt-BR:' + AGORA] })
    })

    it('props complexas (aninhadas, unicode, U+2028, aspas) não quebram nem injetam código', () => {
      const props = { a: { b: [1, 'dois', { c: null }] }, t: 'ç日本😀  "\');process;(', u: '</script><script>x</script>' }
      expect(ok(roda(render('return props'), props))).toEqual(props)
    })

    it('uma "injeção" nas props nunca vira código', () => {
      const r = ok(roda(render('return { ok: typeof injetado, v: props.v }'), { v: '"}); var injetado = 1; ({"' }))
      expect(r.ok).toBe('undefined')
    })

    it('console é capturado e limitado, não escapa para o host', () => {
      const r = roda(render('for (var i = 0; i < 50; i++) console.log("linha", i, {x:1}); return 1'))
      expect(r.ok && r.logs).toHaveLength(20)
      expect(r.ok && r.logs[0]).toBe('linha 0 [object Object]')
    })

    it('mede o tempo', () => { expect(roda(render('return 1')).ms).toBeGreaterThanOrEqual(0) })
  })

  describe('determinismo (servidor e cliente precisam gerar a mesma saída)', () => {
    it('Date.now() e new Date() devolvem o "agora" da requisição, não o relógio real', () => {
      const r = ok(roda(render('return { n: Date.now(), d: new Date().toISOString(), f: new Date(0).getTime(), i: new Date("2020-01-01T00:00:00Z").getFullYear() }')))
      expect(r).toEqual({ n: Date.parse(AGORA), d: AGORA, f: 0, i: 2020 })
    })

    it('o fuso é fixo em UTC: getters locais, parse sem fuso, construtor com partes e toString não dependem do host', () => {
      const r = ok(roda(render(`
        var d = new Date("2020-06-15T23:30:45.123Z");
        var s = new Date("2020-06-15T23:30:45");   // sem fuso: no JS puro seria hora LOCAL
        var p = new Date(2020, 5, 15, 23, 30, 45); // por partes: no JS puro seria hora LOCAL
        return { y: d.getFullYear(), mo: d.getMonth(), da: d.getDate(), dow: d.getDay(), h: d.getHours(), mi: d.getMinutes(), tz: d.getTimezoneOffset(),
                 s: s.toISOString(), p: p.toISOString(), eq: s.getTime() === p.getTime(), ts: d.toString(), tl: d.toLocaleString(), tld: d.toLocaleDateString(), inv: new Date("x").toString(),
                 parse: Date.parse("2020-06-15T00:00:00"), utc: Date.parse("2020-06-15T00:00:00Z") }`)))
      expect(r).toEqual({ y: 2020, mo: 5, da: 15, dow: 1, h: 23, mi: 30, tz: 0, s: '2020-06-15T23:30:45.000Z', p: '2020-06-15T23:30:45.000Z', eq: true,
        ts: 'Mon, 15 Jun 2020 23:30:45 GMT', tl: '2020-06-15 23:30:45', tld: '2020-06-15', inv: 'Invalid Date', parse: Date.parse('2020-06-15T00:00:00Z'), utc: Date.parse('2020-06-15T00:00:00Z') })
    })

    it('Math.random é determinístico para a mesma entrada e muda com outra', () => {
      const f = render('return [Math.random(), Math.random(), Math.random()]')
      expect(ok(roda(f, { x: 1 }))).toEqual(ok(roda(f, { x: 1 })))
      expect(ok(roda(f, { x: 1 }))).not.toEqual(ok(roda(f, { x: 2 })))
      for (const n of ok(roda(f, { x: 1 })) as number[]) expect(n >= 0 && n < 1).toBe(true)
    })

    it('duas execuções iguais dão saída byte a byte igual', () => {
      const f = render('return { t: Date.now(), r: Math.random(), l: props.l.map(function(x){ return x * 2 }) }')
      const a = roda(f, { l: [1, 2, 3] }); const b = roda(f, { l: [1, 2, 3] })
      expect(a.ok && b.ok && a.saida === b.saida).toBe(true)
    })
  })

  describe('isolamento do host e entre execuções', () => {
    it('não há acesso ao host: process, require, fetch, timers, DOM, módulos', () => {
      const r = ok(roda(render(`return ['process','require','module','Buffer','fetch','XMLHttpRequest','WebSocket','setTimeout','setInterval','setImmediate','document','window','localStorage','navigator','importScripts','postMessage'].map(function(k){ return k + ':' + typeof globalThis[k] }).join(',')`)))
      expect(r).not.toMatch(/:(function|object)/)
    })

    it('Function/constructor/eval não chegam ao host (só ao próprio realm)', () => {
      const r = ok(roda(render(`
        var out = [];
        try { out.push(typeof (function(){}).constructor("return typeof process")()) } catch (e) { out.push("erro") }
        try { out.push((0, eval)("typeof process")) } catch (e) { out.push("erro") }
        try { out.push(typeof globalThis.constructor.constructor("return process")()) } catch (e) { out.push("erro") }
        return out`)))
      for (const v of r as string[]) expect(['undefined', 'erro', 'string']).toContain(v)
      expect((r as string[]).filter((v) => v === 'object' || v === 'function')).toEqual([])
    })

    it('import() dinâmico não lê arquivos nem módulos do host', () => {
      const r = roda(render(`try { var p = import("node:fs"); return { tipo: typeof p } } catch (e) { return { tipo: "erro", m: String(e.message).slice(0, 40) } }`))
      if (r.ok) expect(JSON.stringify(JSON.parse(r.saida))).not.toMatch(/readFile|readdir|writeFile/)
    })

    it('poluir protótipos e globais não afeta o host nem a execução seguinte', () => {
      roda(render('Object.prototype.poluido = 1; Array.prototype.poluido = 2; globalThis.segredo = "x"; String.prototype.trim = function(){ return "HACK" }; return 1'))
      expect(({} as Record<string, unknown>).poluido).toBeUndefined()
      expect(([] as unknown as Record<string, unknown>).poluido).toBeUndefined()
      expect(' a '.trim()).toBe('a')
      const r = ok(roda(render('return { a: typeof ({}).poluido, b: typeof segredo, c: " a ".trim() }')))
      expect(r).toEqual({ a: 'undefined', b: 'undefined', c: 'a' }) // contexto novo a cada execução: nada vaza entre blocos/tenants
    })

    it('cada execução parte do zero (sem estado compartilhado)', () => {
      const f = render('globalThis.n = (globalThis.n || 0) + 1; return globalThis.n')
      expect(ok(roda(f))).toBe(1); expect(ok(roda(f))).toBe(1); expect(ok(roda(f))).toBe(1)
    })
  })

  describe('limites e falhas (nunca lançam para o host)', () => {
    it('laço infinito → tempo, dentro do prazo cooperativo', () => {
      const t = Date.now(); const r = falha(roda(render('while (true) {}'), {}, { ms: 80 }))
      expect(r.ok === false && r.tipo).toBe('tempo')
      expect(Date.now() - t).toBeLessThan(1500)
    })

    it('ReDoS é interrompido (o motor de regex confere o prazo)', () => {
      expect(falha(roda(render('return /(a+)+$/.test("a".repeat(40) + "b")'), {}, { ms: 80 })).tipo).toBe('tempo')
    })

    it('estruturas gigantes → memória', () => {
      expect(falha(roda(render('var a = []; while (true) a.push({ x: 1, y: [1, 2, 3] })'), {}, { ms: 500, memoriaBytes: 2 * 1024 * 1024 })).tipo).toBe('memoria')
      expect(falha(roda(render('return new Array(1e8).fill(0).length'), {}, { memoriaBytes: 2 * 1024 * 1024 })).tipo).toBe('memoria')
    })

    it('recursão infinita → execucao (estouro de pilha)', () => {
      const r = falha(roda(render('function f() { return f() + 1 } return f()')))
      expect(r.tipo).toBe('execucao'); expect(r.erro).toContain('pilha')
    })

    it('sintaxe inválida → sintaxe; sem render → execucao com mensagem útil', () => {
      expect(falha(roda('function render( { return 1 }')).tipo).toBe('sintaxe')
      const r = falha(roda('var x = 1'))
      expect(r.tipo).toBe('execucao'); expect(r.erro).toContain('function render')
    })

    it('exceção do autor vira falha com a mensagem (limitada)', () => {
      const r = falha(roda(render('throw new Error("deu ruim " + "x".repeat(1000))')))
      expect(r.tipo).toBe('execucao'); expect(r.erro.length).toBeLessThanOrEqual(300); expect(r.erro).toContain('deu ruim')
    })

    it('saída não serializável (função, circular, BigInt) → falha, não exceção no host', () => {
      expect(falha(roda(render('return function(){}'))).tipo).toBe('execucao')
      expect(falha(roda(render('var o = {}; o.o = o; return o'))).tipo).toBe('execucao')
      expect(falha(roda(render('return { n: 10n }'))).tipo).toBe('execucao')
      expect(falha(roda(render('return undefined'))).tipo).toBe('execucao')
    })

    it('saída grande demais → saida', () => {
      expect(falha(roda(render('return "x".repeat(300000)'), {}, { saidaMaxBytes: 1000 })).tipo).toBe('saida')
    })

    it('entrada inválida ou grande demais é recusada antes de executar', () => {
      const circular: Record<string, unknown> = {}; circular.c = circular
      expect(falha(roda(render('return 1'), circular)).tipo).toBe('entrada')
      expect(falha(roda(render('return 1'), { grande: 'x'.repeat(PADROES_CODIGO.entradaMaxBytes + 1) })).tipo).toBe('entrada')
    })

    it('depois de uma falha, o sandbox continua funcionando', () => {
      falha(roda(render('while(true){}'), {}, { ms: 50 }))
      falha(roda('syntax error here'))
      expect(ok(roda(render('return 42')))).toBe(42)
    })
  })

  it('verificaSintaxe: confere sem executar', () => {
    expect(verificaSintaxe(sb, 'function render(){ return 1 }')).toBeNull()
    expect(verificaSintaxe(sb, 'function render( {')).toMatch(/./)
    expect(verificaSintaxe(sb, 'function render(){ while(true){} }')).toBeNull() // só parseia: o laço nunca roda
  })
})

describe('preempção (só o sandbox em worker)', () => {
  it('declara prazo duro; o local declara que não', async () => {
    const w = await criaSandboxWorker(); const l = await criaSandboxLocal()
    abertos.push(w, l)
    expect(w.duro).toBe(true)
    expect(l.duro).toBe(false)
  })

  it('uma chamada nativa quadrática (Array.join, 5 s sem preempção) é MORTA no prazo duro', async () => {
    const w = await criaSandboxWorker({ margemDuraMs: 150 }); abertos.push(w)
    const t = Date.now()
    const r = w.executa(pedido(render('var a = []; while (true) a.push(Array(1e5).join("x"))'), {}, { ms: 50, memoriaBytes: 2 * 1024 * 1024 }))
    const dt = Date.now() - t
    expect(r.ok).toBe(false)
    expect(!r.ok && r.tipo).toBe('tempo')
    expect(dt).toBeLessThan(1000) // sem preempção seriam ~5 s (medido)
  })

  it('depois de matar o executor, o próximo pedido sobe outro e funciona', async () => {
    const w = await criaSandboxWorker({ margemDuraMs: 100 }); abertos.push(w)
    for (let i = 0; i < 3; i++) {
      expect(w.executa(pedido(render('var a = []; while (true) a.push(Array(1e5).join("x"))'), {}, { ms: 30, memoriaBytes: 2 * 1024 * 1024 })).ok).toBe(false)
      const r = w.executa(pedido(render('return { i: ' + i + ' }')))
      expect(r.ok && JSON.parse(r.saida)).toEqual({ i })
    }
  })

  it('muitas execuções seguidas (custo da ponte) e libera() encerra de verdade', async () => {
    const w = await criaSandboxWorker(); abertos.push(w)
    const t = Date.now()
    for (let i = 0; i < 200; i++) expect(w.executa(pedido(render('return props.i'), { i })).ok).toBe(true)
    expect(Date.now() - t).toBeLessThan(5000)
    w.libera()
    const r = w.executa(pedido(render('return 1')))
    expect(r.ok).toBe(false)
    expect(!r.ok && r.tipo).toBe('indisponivel')
  })

  it('um worker que MORRE SOZINHO (crash/OOM do próprio worker) é detectado e substituído, sem esperar o prazo', async () => {
    const p = new Ponte({ margemDuraMs: 1000, heapMb: 128 })
    expect(p.roda('1+1', 500, 4 * 1024 * 1024)).toEqual({ ok: true, valor: '2' })
    await (p as unknown as { w: { terminate(): Promise<number> } }).w.terminate() // morte externa: o objeto Worker continua referenciado
    const t = Date.now()
    expect(p.roda('2+2', 500, 4 * 1024 * 1024)).toEqual({ ok: true, valor: '4' })
    expect(Date.now() - t).toBeLessThan(900) // não esperou o prazo duro de ~1,5 s para descobrir
    p.fechado = true; p.mata()
  })

  it('dois sandboxes em worker são independentes', async () => {
    const a = await criaSandboxWorker(); const b = await criaSandboxWorker(); abertos.push(a, b)
    a.libera()
    expect(b.executa(pedido(render('return 7'))).ok).toBe(true)
  })

  it('o worker e o local produzem exatamente a mesma saída', async () => {
    const w = await criaSandboxWorker(); const l = await criaSandboxLocal(); abertos.push(w, l)
    const f = render('return { d: Date.now(), r: [Math.random(), Math.random()], p: props, s: "x".repeat(5) }')
    const a = w.executa(pedido(f, { k: [1, { z: 2 }] })); const b = l.executa(pedido(f, { k: [1, { z: 2 }] }))
    expect(a.ok && b.ok && a.saida === b.saida).toBe(true)
  })
})
