/* Live board. Reads the market-source record from the embedded register and nothing else:
   nothing else is consulted. */
(function () {
  'use strict';
  var PF = window.PF || {};
  var RM = function () { return PF.reduced ? PF.reduced() : false; };
  var $ = function (s, r) { return (r || document).querySelector(s); };

  var src = null;
  try { JSON.parse($('#pf-register').textContent).records.forEach(function (r) { if (r.id === 'market-source') src = r; }); } catch (e) {}
  if (!src || src.state !== 'stated') { setStatus('error', 'Feed not configured'); return; }

  var POLL = 60000, BACKOFF_BASE = 2000, BACKOFF_MAX = 60000, TIMEOUT = 12000, CHUNK = 30;
  var rowsEl = $('#rows'), tickerEl = $('#ticker'), errEl = $('#err');
  var state = { data: [], sort: 'volume', rows: {}, ticks: [], tickKey: '' };
  var timer = 0, fails = 0, inflight = false, firstPaint = true;

  var COPY_ICON = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M9 9h10v10H9zM5 15V5h10"/></svg>';
  var CHECK_ICON = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="m5 12.5 4.5 4.5L19 7.5"/></svg>';

  /* ---- formatting ---- */
  var compact = new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 2 });
  function fmtMoney(n) { return '$' + compact.format(n); }
  function fmtPrice(n) {
    if (!isFinite(n)) return '—';
    if (n >= 1000) return '$' + n.toLocaleString('en-US', { maximumFractionDigits: 0 });
    if (n >= 1) return '$' + n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    if (n >= 0.01) return '$' + n.toFixed(4);
    if (n === 0) return '$0';
    var d = Math.min(12, 3 - Math.floor(Math.log10(n)));
    return '$' + n.toFixed(d);
  }
  function fmtPct(n) { return (n > 0 ? '+' : n < 0 ? '−' : '') + Math.abs(n).toFixed(2) + '%'; }
  function fmtInt(n) { return String(Math.round(n)); }

  /* ---- numbers: count-up from zero on first sight, tween + flash on change ---- */
  function setNum(el, value, fmt, delay) {
    var prev = el._v;
    el._v = value;
    if (RM()) { el.textContent = fmt(value); return; }
    if (prev === value) { el.textContent = fmt(value); return; }
    var from = prev === undefined ? 0 : prev, dur = prev === undefined ? 900 : 650;
    var host = el.closest('.c, .tile') || el;
    if (prev !== undefined) { host.classList.remove('flash-up', 'flash-dn'); void host.offsetWidth; host.classList.add(value > prev ? 'flash-up' : 'flash-dn'); }
    var t0 = 0, token = (el._tok = (el._tok || 0) + 1);
    function frame(now) {
      if (el._tok !== token) return;
      if (!t0) t0 = now;
      var p = Math.min(1, (now - t0) / dur), e = 1 - Math.pow(1 - p, 3);
      el.textContent = fmt(from + (value - from) * e);
      if (p < 1) requestAnimationFrame(frame); else el.textContent = fmt(value);
    }
    setTimeout(function () { if (el._tok === token) requestAnimationFrame(frame); }, delay || 0);
  }

  /* ---- status ---- */
  function setStatus(s, text) {
    var st = $('#status'); if (!st) return;
    st.dataset.state = s; $('#status-text').textContent = text;
  }

  /* ---- network ---- */
  function getJson(url) {
    var ctl = new AbortController(), t = setTimeout(function () { ctl.abort(); }, TIMEOUT);
    return fetch(url, { signal: ctl.signal, headers: { accept: 'application/json' } }).then(function (r) {
      if (!r.ok) throw new Error('http ' + r.status);
      return r.json();
    }).finally(function () { clearTimeout(t); });
  }

  function load() {
    return getJson(src.boostsUrl).then(function (boosts) {
      if (!Array.isArray(boosts)) throw new Error('shape');
      var seen = {}, addrs = [];
      boosts.forEach(function (b) {
        if (b && b.chainId === 'solana' && b.tokenAddress && !seen[b.tokenAddress]) { seen[b.tokenAddress] = 1; addrs.push(b.tokenAddress); }
      });
      if (!addrs.length) throw new Error('empty');
      var reqs = [];
      for (var i = 0; i < addrs.length; i += CHUNK) reqs.push(getJson(src.pairsUrl + addrs.slice(i, i + CHUNK).join(',')));
      return Promise.all(reqs);
    }).then(function (parts) {
      var by = {};
      parts.forEach(function (arr) {
        if (!Array.isArray(arr)) return;
        arr.forEach(function (p) {
          if (!p || p.chainId !== 'solana' || !p.baseToken) return;
          var price = parseFloat(p.priceUsd); if (!isFinite(price)) return;
          var a = p.baseToken.address, vol = (p.volume && +p.volume.h24) || 0, liq = (p.liquidity && +p.liquidity.usd) || 0;
          var t = by[a];
          if (!t) t = by[a] = { addr: a, sym: p.baseToken.symbol || '?', name: p.baseToken.name || '', img: (p.info && p.info.imageUrl) || '', price: price, chg: (p.priceChange && +p.priceChange.h24) || 0, vol: 0, liq: 0, best: -1 };
          t.vol += vol; t.liq += liq;
          if (liq > t.best) { t.best = liq; t.price = price; t.chg = (p.priceChange && +p.priceChange.h24) || 0; if (p.info && p.info.imageUrl) t.img = p.info.imageUrl; }
        });
      });
      var list = Object.keys(by).map(function (k) { return by[k]; }).sort(function (a, b) { return b.vol - a.vol; }).slice(0, 10);
      if (!list.length) throw new Error('empty');
      return list;
    });
  }

  /* ---- skeleton ---- */
  function skeletons() {
    var h = '';
    for (var i = 0; i < 10; i++) h += '<div class="row skel" aria-hidden="true"><span class="rk sk"></span><div class="tk"><span class="logo-tile sk"></span><span class="nm"><b class="sk" style="width:5rem">&nbsp;</b></span></div><div class="metrics"><div class="c"><small>Price</small><span class="sk">&nbsp;</span></div><div class="c"><small>24h</small><span class="sk">&nbsp;</span></div><div class="c"><small>Volume</small><span class="sk">&nbsp;</span></div><div class="c"><small>Liquidity</small><span class="sk">&nbsp;</span></div></div><span></span></div>';
    rowsEl.innerHTML = h;
  }
  function dashRows() {
    var h = '';
    for (var i = 0; i < 10; i++) h += '<div class="row" role="listitem"><span class="rk">' + (i + 1) + '</span><div class="tk"><span class="logo-tile">—</span><span class="nm"><b>—</b></span></div><div class="metrics"><div class="c"><small>Price</small><span>—</span></div><div class="c"><small>24h</small><span>—</span></div><div class="c"><small>Volume</small><span>—</span></div><div class="c"><small>Liquidity</small><span>—</span></div></div><span></span></div>';
    rowsEl.innerHTML = h; rowsEl.setAttribute('aria-busy', 'false');
  }

  /* ---- rows ---- */
  function tile(t) {
    var el = document.createElement('span'); el.className = 'logo-tile';
    var l = document.createElement('span'); l.textContent = (t.sym || '?').charAt(0).toUpperCase(); el.appendChild(l);
    if (t.img) {
      var im = new Image(); im.alt = ''; im.decoding = 'async'; im.referrerPolicy = 'no-referrer';
      im.onload = function () { l.style.display = 'none'; };
      im.onerror = function () { im.remove(); };
      im.src = t.img; el.appendChild(im);
    }
    return el;
  }

  function makeRow(t) {
    var r = document.createElement('div'); r.className = 'row spot'; r.setAttribute('role', 'listitem'); r.dataset.addr = t.addr;
    r.innerHTML = '<span class="rk"></span><div class="tk"><span class="ph"></span><span class="nm"><b></b><span></span></span></div>' +
      '<div class="metrics"><div class="c"><small>Price</small><span class="v-px"></span></div><div class="c"><small>24h</small><span class="v-ch"></span></div>' +
      '<div class="c"><small>Volume</small><span class="v-vol"></span></div><div class="c"><small>Liquidity</small><span class="v-liq"></span></div></div>' +
      '<button type="button" class="copy-btn cp" aria-label="">' + COPY_ICON + '</button>';
    r.querySelector('.ph').replaceWith(tile(t));
    r.querySelector('.nm b').textContent = t.sym; r.querySelector('.nm span').textContent = t.name;
    var b = r.querySelector('.cp'); b.setAttribute('aria-label', 'Copy the address for ' + t.sym);
    b.addEventListener('click', function () {
      PF.copy(t.addr).then(function () {
        b.classList.add('ok'); b.innerHTML = CHECK_ICON; b.setAttribute('aria-label', 'Copied the address for ' + t.sym);
        setTimeout(function () { b.classList.remove('ok'); b.innerHTML = COPY_ICON; b.setAttribute('aria-label', 'Copy the address for ' + t.sym); }, 1500);
      });
    });
    return r;
  }

  var SORTS = {
    volume: function (a, b) { return b.vol - a.vol; },
    move: function (a, b) { return Math.abs(b.chg) - Math.abs(a.chg); },
    liq: function (a, b) { return b.liq - a.liq; }
  };

  function paintRows(animate) {
    var list = state.data.slice().sort(SORTS[state.sort]);
    var live = {};
    list.forEach(function (t, i) {
      live[t.addr] = 1;
      var r = state.rows[t.addr], fresh = false;
      if (!r) { r = state.rows[t.addr] = makeRow(t); fresh = true; }
      r.querySelector('.rk').textContent = i + 1;
      var d = animate ? i * 70 : 0;
      setNum(r.querySelector('.v-px'), t.price, fmtPrice, d);
      var ch = r.querySelector('.v-ch'); setNum(ch, t.chg, fmtPct, d);
      ch.className = 'v-ch ' + (t.chg >= 0 ? 'up' : 'dn');
      setNum(r.querySelector('.v-vol'), t.vol, fmtMoney, d);
      setNum(r.querySelector('.v-liq'), t.liq, fmtMoney, d);
      rowsEl.appendChild(r);
      if (fresh && animate) { r.style.setProperty('--i', i); r.classList.add('is-in'); }
    });
    Object.keys(state.rows).forEach(function (k) { if (!live[k]) { state.rows[k].remove(); delete state.rows[k]; } });
  }

  /* ---- tiles ---- */
  function paintTiles() {
    var d = state.data, vol = 0, liq = 0;
    d.forEach(function (t) { vol += t.vol; liq += t.liq; });
    var abs = d.map(function (t) { return Math.abs(t.chg); }).sort(function (a, b) { return a - b; });
    var m = abs.length ? (abs.length % 2 ? abs[(abs.length - 1) / 2] : (abs[abs.length / 2 - 1] + abs[abs.length / 2]) / 2) : 0;
    setNum($('#t-vol'), vol, fmtMoney); setNum($('#t-liq'), liq, fmtMoney); setNum($('#t-n'), d.length, fmtInt); setNum($('#t-med'), m, function (n) { return n.toFixed(2) + '%'; });
  }

  /* ---- ticker (same data, built once per set of tokens, then updated in place) ---- */
  function tickHtml(t, hidden) {
    return '<span class="tick"' + (hidden ? ' aria-hidden="true"' : '') + ' data-a="' + t.addr + '"><span class="ph"></span><b>' + esc(t.sym) + '</b><span class="px"></span><span class="ch"></span></span>';
  }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function paintTicker() {
    var list = state.data.slice().sort(SORTS.volume), key = list.map(function (t) { return t.addr; }).join('|');
    if (key !== state.tickKey) {
      state.tickKey = key;
      tickerEl.innerHTML = list.map(function (t) { return tickHtml(t, false); }).join('') + list.map(function (t) { return tickHtml(t, true); }).join('');
      Array.prototype.forEach.call(tickerEl.children, function (el) {
        var t = list.filter(function (x) { return x.addr === el.dataset.a; })[0];
        el.querySelector('.ph').replaceWith(tile(t));
      });
    }
    Array.prototype.forEach.call(tickerEl.children, function (el) {
      var t = list.filter(function (x) { return x.addr === el.dataset.a; })[0];
      el.querySelector('.px').textContent = fmtPrice(t.price);
      var c = el.querySelector('.ch'); c.textContent = fmtPct(t.chg); c.style.color = t.chg >= 0 ? 'var(--accent-bright)' : 'var(--faint)';
    });
  }

  /* ---- run / poll ---- */
  function onData(list) {
    var first = !state.data.length;
    state.data = list;
    if (first) { rowsEl.innerHTML = ''; }
    errEl.hidden = true; rowsEl.setAttribute('aria-busy', 'false');
    paintRows(first); paintTiles(); paintTicker();
    setStatus('live', 'Streaming');
  }
  function onFail() {
    fails++;
    if (state.data.length) setStatus('stale', 'Reconnecting');
    else { setStatus('error', 'Feed unreachable'); errEl.hidden = false; if (rowsEl.querySelector('.skel')) dashRows(); }
  }
  function schedule(ms) { clearTimeout(timer); timer = setTimeout(run, ms); }
  function run() {
    if (document.hidden || inflight) return;
    inflight = true;
    load().then(function (list) { fails = 0; onData(list); }, onFail).then(function () {
      inflight = false;
      if (document.hidden) return;
      var wait = fails ? Math.min(BACKOFF_MAX, BACKOFF_BASE * Math.pow(2, fails - 1)) * (0.85 + Math.random() * 0.3) : POLL;
      schedule(wait);
    });
  }
  document.addEventListener('visibilitychange', function () {
    if (document.hidden) clearTimeout(timer);
    else { clearTimeout(timer); run(); }
  });

  /* ---- tabs ---- */
  Array.prototype.forEach.call(document.querySelectorAll('.tab'), function (b) {
    b.addEventListener('click', function () {
      state.sort = b.dataset.sort;
      Array.prototype.forEach.call(document.querySelectorAll('.tab'), function (x) { var on = x === b; x.classList.toggle('is-on', on); x.setAttribute('aria-selected', on); });
      if (state.data.length) paintRows(false);
    });
  });

  skeletons();
  setStatus('loading', 'Connecting');
  run();
})();
