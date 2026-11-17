// Harness de medição (servido nas duas variantes; roda no navegador real). Mede, no MESMO documento e com o MESMO programa:
//   carga   — bytes de JS (comprimidos e não), avaliação do bundle, tempo até o 1º clique funcionar (equivalente a TTI de interação)
//   interações — tempo síncrono do handler (clique → DOM atualizado) e até o próximo quadro, mediana e p95
(function () {
  var W = window
  W.__M = { tti: null, marcas: {} }
  var macro = function (ms) { return new Promise(function (r) { setTimeout(r, ms || 0) }) }
  // espera `ok()` ficar verdadeiro: 1º um microtask (React 19 descarrega atualizações discretas em microtask), depois macrotasks
  async function atePronto(ok) {
    if (ok()) return
    await Promise.resolve()
    if (ok()) return
    for (var i = 0; i < 2000 && !ok(); i++) await macro(0)
  }
  // 1º clique que FUNCIONA (o DOM reflete o clique): tenta a cada 10 ms até o texto do contador mudar
  async function poll() {
    for (;;) {
      var b = document.getElementById('b-n'), p = document.getElementById('n')
      if (b && p) {
        var antes = p.textContent
        b.click(); W.__M.cliquesAteTti = (W.__M.cliquesAteTti || 0) + 1
        await atePronto(function () { return p.textContent !== antes })
        if (p.textContent !== antes) { W.__M.tti = performance.now(); return }
      }
      await macro(10)
    }
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function () { setTimeout(poll, 0) }); else setTimeout(poll, 0)

  // o quadro pode não vir (aba sem foco em automação): espera no máximo 80 ms e conta quantas vezes isso aconteceu
  W.__M.semQuadro = 0
  var quadro = function () { return new Promise(function (r) { var feito = false; var fim = function () { if (!feito) { feito = true; r() } }; setTimeout(function () { if (!feito) W.__M.semQuadro++; fim() }, 80); requestAnimationFrame(function () { requestAnimationFrame(fim) }) }) }
  var med = function (v) { var s = v.slice().sort(function (a, b) { return a - b }); return s[Math.floor(s.length / 2)] }
  var p95 = function (v) { var s = v.slice().sort(function (a, b) { return a - b }); return s[Math.min(s.length - 1, Math.floor(s.length * 0.95))] }
  var setVal = function (el, v) { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, v); el.dispatchEvent(new Event('input', { bubbles: true })) }

  /** mede "clique → o DOM já reflete" (mesmo critério para os dois caminhos); `ok(antes)` diz quando refletiu */
  async function op(nome, fn, leAntes, ok, vezes) {
    var sync = [], total = []
    for (var i = 0; i < vezes; i++) {
      var antes = leAntes()
      var t0 = performance.now(); fn(i); await atePronto(function () { return ok(antes) }); var t1 = performance.now()
      if (!ok(antes)) throw new Error('o DOM não refletiu: ' + nome)
      await quadro(); var t2 = performance.now()
      sync.push(t1 - t0); total.push(t2 - t0)
    }
    return { nome: nome, ms_med: +med(sync).toFixed(2), ms_p95: +p95(sync).toFixed(2) }
  }

  W.__rodaTudo = async function () {
    while (W.__M.tti === null) await new Promise(function (r) { setTimeout(r, 5) })
    await quadro()
    var nav = performance.getEntriesByType('navigation')[0]
    var js = performance.getEntriesByType('resource').filter(function (r) { return /\.js(\?|$)/.test(r.name) && !/medir\.js/.test(r.name) })
    var fcp = (performance.getEntriesByName('first-contentful-paint')[0] || {}).startTime
    var heap0 = performance.memory ? performance.memory.usedJSHeapSize : null
    var el = function (id) { return document.getElementById(id) }
    var N = document.getElementById('lista').children.length
    var lista = el('lista'), mid = Math.floor(N / 2)
    var cont = function () { return lista.children.length }, txtMeio = function () { return lista.children[mid] && lista.children[mid].textContent }, txtPrimeiro = function () { return lista.children[0].textContent }
    var difere = function (a) { return function (antes) { return a() !== antes } }
    var ops = []
    ops.push(await op('contador +1 (fora da lista)', function () { el('b-n').click() }, function () { return el('n').textContent }, function (a) { return el('n').textContent !== a }, 30))
    ops.push(await op('alterar 1 item no meio', function () { el('b-um').click() }, txtMeio, difere(txtMeio), 30))
    ops.push(await op('inserir 1 no meio', function () { el('b-add').click() }, cont, difere(cont), 20))
    ops.push(await op('remover 1 do meio', function () { el('b-rem').click() }, cont, difere(cont), 20))
    ops.push(await op('inverter a lista', function () { el('b-inv').click() }, txtPrimeiro, difere(txtPrimeiro), 10))
    ops.push(await op('digitar no filtro (a→ab→a→"")', function (i) { setVal(el('campo'), ['a', 'ab', 'a', ''][i % 4]) }, cont, difere(cont), 16))
    var heap1 = performance.memory ? performance.memory.usedJSHeapSize : null
    return JSON.stringify({
      itens: N,
      carga: {
        fcp_ms: fcp && +fcp.toFixed(0), dcl_ms: +nav.domContentLoadedEventEnd.toFixed(0), tti_clique_ms: +W.__M.tti.toFixed(0), cliques_ate_funcionar: W.__M.cliquesAteTti,
        js_gz_kb: +(js.reduce(function (s, r) { return s + r.encodedBodySize }, 0) / 1024).toFixed(1), js_kb: +(js.reduce(function (s, r) { return s + r.decodedBodySize }, 0) / 1024).toFixed(1),
        html_gz_kb: +(nav.encodedBodySize / 1024).toFixed(1), marcas: W.__M.marcas, sem_quadro: W.__M.semQuadro,
      },
      heap_mb: heap0 && { apos_carga: +(heap0 / 1048576).toFixed(1), apos_ops: +(heap1 / 1048576).toFixed(1) },
      ops: ops,
    })
  }
})()
