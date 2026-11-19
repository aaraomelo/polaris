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
  // SUGESTÕES AO VIVO da busca (form/sugestoes-ao-vivo): a cada pausa na digitação busca no servidor ("url?busca=termo&limite=n") e mostra uma lista com título, descrição e miniatura; só textContent (nunca HTML montado), miniatura só de caminho do próprio site
  var SG = { t: 0, ctl: null, cache: {}, ativo: -1 };
  function sgLista(inp) { var f = inp.form; return f ? f.querySelector('ul[data-sugestoes-url]') : null; }
  function sgFecha(ul, inp) { if (!ul) return; ul.hidden = true; ul.setAttribute('hidden', ''); ul.textContent = ''; SG.ativo = -1; if (inp) { inp.setAttribute('aria-expanded', 'false'); inp.removeAttribute('aria-activedescendant'); } }
  function sgSeguro(u) { return typeof u === 'string' && /^\\/(?!\\/)[^\\\\\\s]{0,300}$/.test(u) ? u : null; }
  // realce do trecho achado: compara sem acento nem maiúsculas (cada letra vira a letra-base; o que não vira uma só mantém o caractere) e monta o texto em pedaços (nós de texto e <mark>), nunca HTML
  function sgBase(s) { var o = ''; for (var i = 0; i < s.length; i++) { var c = s.charAt(i), b = c.normalize ? c.normalize('NFD').replace(/[\u0300-\u036f]/g, '') : c; o += b.length === 1 ? b.toLowerCase() : c.toLowerCase().charAt(0) || c; } return o; }
  function sgRealce(el, texto, termo) {
    var base = sgBase(texto), marca = [], ps = sgBase(termo).split(/[^a-z0-9]+/).filter(function (p) { return p.length > 0; }).slice(0, 5);
    for (var k = 0; k < texto.length; k++) marca[k] = false;
    for (var j = 0; j < ps.length; j++) { var at = base.indexOf(ps[j]); while (at >= 0) { for (var m = at; m < at + ps[j].length; m++) marca[m] = true; at = base.indexOf(ps[j], at + ps[j].length); } }
    var i = 0; while (i < texto.length) {
      var f = i; while (f < texto.length && marca[f] === marca[i]) f++;
      var pedaco = texto.slice(i, f); if (marca[i]) { var mk = d.createElement('mark'); mk.textContent = pedaco; el.appendChild(mk); } else el.appendChild(d.createTextNode(pedaco));
      i = f;
    }
  }
  function sgItens(ul) { return ul.querySelectorAll('li[role="option"]'); }
  function sgMarca(ul, inp, i) {
    var l = sgItens(ul); if (!l.length) return; SG.ativo = (i + l.length) % l.length;
    for (var k = 0; k < l.length; k++) l[k].setAttribute('aria-selected', k === SG.ativo ? 'true' : 'false');
    inp.setAttribute('aria-activedescendant', l[SG.ativo].id); if (l[SG.ativo].scrollIntoView) l[SG.ativo].scrollIntoView({ block: 'nearest' });
  }
  function sgMostra(ul, inp, dados, termo) {
    var campo = function (k) { return ul.getAttribute('data-' + k); }, destino = ul.getAttribute('data-destino') || '/busca', nome = ul.getAttribute('data-nome') || 'q';
    ul.textContent = ''; SG.ativo = -1;
    var lista = Array.isArray(dados) ? dados.slice(0, Number(ul.getAttribute('data-limite')) || 6) : [];
    if (!ul.id) ul.id = 'sg-' + Math.floor(Math.random() * 1e9);
    for (var i = 0; i < lista.length; i++) {
      var it = lista[i]; if (!it || typeof it !== 'object') continue;
      var tit = it[campo('titulo') || 'titulo']; if (typeof tit !== 'string' || !tit) continue;
      var li = d.createElement('li'), a = d.createElement('a'), tx = d.createElement('span'), st = d.createElement('span');
      li.setAttribute('role', 'option'); li.id = ul.id + '-' + i; li.setAttribute('aria-selected', 'false');
      a.href = destino + (destino.indexOf('?') < 0 ? '?' : '&') + encodeURIComponent(nome) + '=' + encodeURIComponent(tit);
      var img = campo('imagem') ? sgSeguro(it[campo('imagem')]) : null;
      if (img) { var im = d.createElement('img'); im.src = img; im.alt = ''; im.width = 40; im.height = 40; im.loading = 'lazy'; a.appendChild(im); }
      tx.setAttribute('data-s-texto', ''); st.setAttribute('data-s-titulo', ''); sgRealce(st, tit, termo); tx.appendChild(st);
      var dc = campo('descricao') ? it[campo('descricao')] : null;
      if (typeof dc === 'string' && dc) { var sd = d.createElement('span'); sd.setAttribute('data-s-desc', ''); sgRealce(sd, dc, termo); tx.appendChild(sd); }
      a.appendChild(tx); li.appendChild(a); ul.appendChild(li);
    }
    var n = sgItens(ul).length;
    if (!n) { var v = d.createElement('li'); v.setAttribute('data-s-vazio', ''); v.setAttribute('role', 'presentation'); v.textContent = 'Nenhuma sugestão para "' + termo + '"'; ul.appendChild(v); }
    ul.hidden = false; ul.removeAttribute('hidden'); inp.setAttribute('aria-expanded', 'true');
    var f = inp.form, s = f.querySelector('[data-s-status]'); if (!s) { s = d.createElement('span'); s.setAttribute('data-s-status', ''); s.setAttribute('role', 'status'); f.appendChild(s); }
    s.textContent = n ? n + (n === 1 ? ' sugestão' : ' sugestões') : 'Nenhuma sugestão';
  }
  function sgBusca(inp, ul, termo) {
    if (SG.ctl && SG.ctl.abort) SG.ctl.abort();
    var base = ul.getAttribute('data-sugestoes-url'), lim = ul.getAttribute('data-limite') || '6', chave = base + '|' + termo;
    if (SG.cache[chave]) { sgMostra(ul, inp, SG.cache[chave], termo); return; }
    var ctl = w.AbortController ? new AbortController() : null; SG.ctl = ctl;
    w.fetch(base + (base.indexOf('?') < 0 ? '?' : '&') + 'busca=' + encodeURIComponent(termo) + '&limite=' + lim, { headers: { accept: 'application/json' }, signal: ctl ? ctl.signal : undefined })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) { if (j === null || inp.value.trim() !== termo) return; SG.cache[chave] = j; sgMostra(ul, inp, j, termo); })
      .catch(function () {});
  }
  d.addEventListener('input', function (e) {
    var inp = e.target; if (!inp || inp.type !== 'search') return; var ul = sgLista(inp); if (!ul) return;
    if (!inp.getAttribute('role')) { inp.setAttribute('role', 'combobox'); inp.setAttribute('aria-autocomplete', 'list'); inp.setAttribute('aria-controls', ul.id || (ul.id = 'sg-' + Math.floor(Math.random() * 1e9))); inp.setAttribute('aria-expanded', 'false'); }
    clearTimeout(SG.t); var t = inp.value.trim();
    if (t.length < 2) { if (SG.ctl && SG.ctl.abort) SG.ctl.abort(); sgFecha(ul, inp); return; }
    SG.t = setTimeout(function () { sgBusca(inp, ul, t); }, 180);
  });
  d.addEventListener('keydown', function (e) {
    var inp = e.target; if (!inp || inp.type !== 'search') return; var ul = sgLista(inp); if (!ul || ul.hidden) return;
    if (e.key === 'ArrowDown') { e.preventDefault(); sgMarca(ul, inp, SG.ativo + 1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); sgMarca(ul, inp, SG.ativo < 0 ? -1 : SG.ativo - 1); }
    else if (e.key === 'Enter' && SG.ativo >= 0) { var a = sgItens(ul)[SG.ativo].querySelector('a'); if (a) { e.preventDefault(); a.click(); } }
    else if (e.key === 'Escape') { e.stopPropagation(); sgFecha(ul, inp); }
  }, true);
  d.addEventListener('click', function (e) {
    var l = d.querySelectorAll('ul[data-sugestoes-url]:not([hidden])');
    for (var i = 0; i < l.length; i++) if (!l[i].parentNode.contains(e.target)) sgFecha(l[i], l[i].parentNode.querySelector('input[type="search"]'));
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
      var as = l[i].parentNode; if (as && as.hasAttribute && as.hasAttribute('data-lateral')) { if (as.contains(alvo) && alvo.closest && alvo.closest('button, a[href]')) l[i].checked = false; continue; } // lateral do painel (celular): escolher um item a recolhe
      var h = l[i].closest ? l[i].closest('header') : null; if (!h) continue;
      if (!h.contains(alvo) || (alvo.closest && alvo.closest('a[href^="#"]'))) l[i].checked = false;
    }
  });
  if (w.history && w.history.scrollRestoration) w.history.scrollRestoration = 'manual';
})(window, document);
`
