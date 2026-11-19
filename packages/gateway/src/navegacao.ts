// ---------------------------------------------------------------------------------------------------------------------------------------------
// NAVEGAÇÃO NO CLIENTE: clicar num link do próprio site troca a página SEM recarregar o navegador (nem refaz o tema, a conexão ou o cliente já carregado).
// É melhoria progressiva: sem JavaScript, ou diante de qualquer dúvida (outra origem, tecla modificadora, `target`, resposta que não é HTML, falha de rede),
// o navegador navega do jeito normal. O servidor responde ao pedido de navegação (`x-polaris-nav`) com a página COMPLETA (sem pedaços em streaming).
// O script é ES2017 puro, servido do próprio gateway (CSP: `'self'`), e não depende de nada do engine além da API pública do pacote do cliente (`Polaris.inicia`).
// ---------------------------------------------------------------------------------------------------------------------------------------------
export const CABECALHO_NAV = 'x-polaris-nav'

export const ROTEADOR_JS = `(function (w, d) {
  'use strict';
  if (w.__PL_NAV) return; w.__PL_NAV = true;
  var q = w.__PL = w.__PL || { fila: [], montado: null };
  var RESERVADO = /^\\/(api|bff|studio|graphql|_polaris|metricas|saude|_dev)(\\/|$)|^\\/entrar\\/ir(\\/|$)/;
  var mods = {}, n = 0, ult = w.location.pathname + w.location.search;
  function bundleDe(doc) {
    var l = doc.querySelectorAll('script[src^="/_polaris/a/"]');
    for (var i = 0; i < l.length; i++) if (!l[i].hasAttribute('data-pl-router')) return l[i].getAttribute('src');
    return null;
  }
  var atual = bundleDe(d);
  function lembra() { if (atual && !mods[atual] && w.Polaris && w.Polaris.inicia) mods[atual] = w.Polaris; }
  function carrega(src, pronto, falha) {
    q.auto = false; // o pacote não se inicia sozinho: quem decide quando é este roteador (o DOM já é o da página nova)
    var s = d.createElement('script'); s.src = src; s.async = true;
    s.onload = function () { q.auto = true; mods[src] = w.Polaris; pronto(); };
    s.onerror = function () { q.auto = true; falha(); };
    d.head.appendChild(s);
  }
  function estilos(doc) {
    var novos = doc.querySelectorAll('link[rel="stylesheet"]'), velhos = d.querySelectorAll('link[rel="stylesheet"]'), tem = {}, i;
    for (i = 0; i < velhos.length; i++) tem[velhos[i].getAttribute('href')] = velhos[i];
    var quer = {};
    for (i = 0; i < novos.length; i++) { var h = novos[i].getAttribute('href'); quer[h] = 1; if (!tem[h]) { var l = d.createElement('link'); l.rel = 'stylesheet'; l.href = h; d.head.appendChild(l); } }
    for (var h2 in tem) if (!quer[h2] && tem[h2].parentNode) tem[h2].parentNode.removeChild(tem[h2]);
  }
  function json(id, doc) {
    var o = doc.getElementById(id); if (!o) return;
    var e = d.getElementById(id); if (!e) { e = d.createElement('script'); e.type = 'application/json'; e.id = id; d.body.appendChild(e); }
    e.textContent = o.textContent;
  }
  function vai(url, empilha, falha) {
    var minha = ++n;
    w.fetch(url, { headers: { 'x-polaris-nav': '1', accept: 'text/html' }, credentials: 'same-origin' }).then(function (r) {
      if (!/text\\/html/.test(r.headers.get('content-type') || '')) throw new Error('nao-html');
      return r.text().then(function (t) { return { t: t, url: r.url, status: r.status }; });
    }).then(function (x) {
      if (minha !== n) return; // chegou outro clique depois: este resultado é velho
      var doc = new DOMParser().parseFromString(x.t, 'text/html'), c = doc.getElementById('polaris'), p = doc.getElementById('pl-programa'), src = bundleDe(doc);
      if (!c || !p || !src) throw new Error('sem-pagina');
      lembra();
      if (q.montado && q.montado.destroi) { try { q.montado.destroi(); } catch (e) { /* já desmontada */ } }
      q.montado = null; q.fila.length = 0;
      d.title = doc.title; d.documentElement.lang = doc.documentElement.lang || 'pt-BR';
      var modo = doc.documentElement.getAttribute('data-modo'); if (modo) d.documentElement.setAttribute('data-modo', modo); else d.documentElement.removeAttribute('data-modo');
      estilos(doc);
      d.getElementById('polaris').innerHTML = c.innerHTML;
      json('pl-programa', doc); json('pl-estado', doc);
      if (empilha) w.history.pushState({ pl: 1 }, '', x.url);
      var u = new URL(x.url, w.location.href), alvo = u.hash && d.getElementById(decodeURIComponent(u.hash.slice(1)));
      if (alvo) alvo.scrollIntoView(); else if (empilha) w.scrollTo(0, 0);
      atual = src; ult = u.pathname + u.search;
      var ilha = doc.querySelector('script[data-pl-ilha]'), ilhaSrc = ilha ? ilha.getAttribute('src') : null;
      var ok = function () {
        var h = d.getElementById('polaris'); if (h && h.setAttribute) { h.setAttribute('tabindex', '-1'); }
        if (!ilhaSrc) return;
        // a página nova tem formulário: o pacote da ilha monta os pontos de montagem (carrega só se ainda não veio)
        if (w.PolarisFormularios && w.PolarisFormularios.inicia) { w.PolarisFormularios.inicia(); return; }
        var s2 = d.createElement('script'); s2.src = ilhaSrc; s2.async = true; s2.setAttribute('data-pl-ilha', ''); d.head.appendChild(s2);
      };
      if (mods[src]) { mods[src].inicia(); ok(); } else carrega(src, function () { w.Polaris.inicia(); ok(); }, falha);
    }).catch(function () { if (minha === n) falha(); });
  }
  d.addEventListener('click', function (e) {
    if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    var a = e.target && e.target.closest ? e.target.closest('a[href]') : null;
    if (!a) return;
    var alvo = a.getAttribute('target'); if (alvo && alvo !== '_self') return;
    if (a.hasAttribute('download') || /(^|\\s)external(\\s|$)/.test(a.getAttribute('rel') || '')) return;
    var u; try { u = new URL(a.href, w.location.href); } catch (x) { return; }
    if (u.origin !== w.location.origin || RESERVADO.test(u.pathname)) return;
    if (u.pathname === w.location.pathname && u.search === w.location.search && u.hash) return; // âncora na mesma página: o navegador resolve
    lembra(); if (!q.montado && !(w.Polaris && w.Polaris.inicia)) return; // o cliente ainda não carregou: navegação normal
    e.preventDefault();
    vai(u.href, true, function () { w.location.href = u.href; });
  });
  w.addEventListener('popstate', function () {
    if (w.location.pathname + w.location.search === ult) return; // só mudou a âncora
    vai(w.location.href, false, function () { w.location.reload(); });
  });
  // menu recolhível do cabeçalho (nav/alternador, que já funciona sem JavaScript): com o script, Esc e o clique FORA do cabeçalho também o fecham, e clicar numa âncora (#…) do próprio menu o fecha
  function abertos() { return d.querySelectorAll('input[data-alternador]:checked'); }
  function subAbertos() { return d.querySelectorAll('details[data-submenu][open]'); }
  d.addEventListener('keydown', function (e) {
    if (e.key !== 'Escape') return;
    var sm = subAbertos(); for (var j = 0; j < sm.length; j++) { sm[j].removeAttribute('open'); var sv = sm[j].querySelector('summary'); if (j === 0 && sv && sv.focus) sv.focus(); }
    var l = abertos(); for (var i = 0; i < l.length; i++) { l[i].checked = false; if (i === 0 && l[i].focus) l[i].focus(); } // o foco volta para o interruptor (o botão "Menu" mostra o anel de foco)
  });
  d.addEventListener('click', function (e) {
    var sm = subAbertos(), alvo0 = e.target;
    for (var j = 0; j < sm.length; j++) if (alvo0 && !sm[j].contains(alvo0)) sm[j].removeAttribute('open'); // clique fora do submenu (ou num link dele, que navega) o fecha
    var l = abertos(), alvo = e.target; if (!l.length || !alvo) return;
    for (var i = 0; i < l.length; i++) {
      var h = l[i].closest ? l[i].closest('header') : null; if (!h) continue;
      if (!h.contains(alvo) || (alvo.closest && alvo.closest('a[href^="#"]'))) l[i].checked = false;
    }
  });
  if (w.history && w.history.scrollRestoration) w.history.scrollRestoration = 'manual';
})(window, document);
`
