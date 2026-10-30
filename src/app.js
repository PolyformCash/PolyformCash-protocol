/* Polyform front-end effects: damped-spring solver, reveal, parallax, progress, spotlight, dock, CA copy. */
(function () {
  'use strict';
  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
  var RM = reduce.matches;
  reduce.addEventListener && reduce.addEventListener('change', function (e) { RM = e.matches; document.documentElement.classList.toggle('rm', RM); });
  var $ = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  /* ---- damped spring solver: semi-implicit Euler on fixed 1/240s sub-steps ---- */
  var springs = [], raf = 0, last = 0;
  function Spring(x, o) {
    o = o || {};
    this.x = x; this.v = 0; this.to = x;
    this.k = o.k || 170; this.c = o.c || 22; this.m = o.m || 1;
    this.on = o.on; this.done = o.done; this.live = false;
  }
  Spring.prototype.go = function (to) { this.to = to; if (!this.live) { this.live = true; springs.push(this); } kick(); };
  Spring.prototype.snap = function (to) { this.x = this.to = to; this.v = 0; if (this.on) this.on(this.x); };
  function kick() { if (!raf) { last = performance.now(); raf = requestAnimationFrame(tick); } }
  function tick(now) {
    var dt = Math.min(0.05, (now - last) / 1000); last = now;
    var step = 1 / 240, n = Math.max(1, Math.round(dt / step));
    for (var s = 0; s < springs.length; s++) {
      var p = springs[s];
      for (var i = 0; i < n; i++) {
        var a = (-p.k * (p.x - p.to) - p.c * p.v) / p.m;
        p.v += a * step; p.x += p.v * step;
      }
      if (p.on) p.on(p.x);
      if (Math.abs(p.v) < 0.001 && Math.abs(p.x - p.to) < 0.0005) { p.x = p.to; p.v = 0; p.live = false; if (p.on) p.on(p.x); if (p.done) p.done(); }
    }
    springs = springs.filter(function (p) { return p.live; });
    raf = springs.length ? requestAnimationFrame(tick) : 0;
  }
  window.PF = window.PF || {};
  window.PF.Spring = Spring;
  window.PF.reduced = function () { return RM; };

  /* ---- scroll reveal with stagger (spring from 0 to 1) ---- */
  function show(el) { el.style.opacity = 1; el.style.transform = 'none'; el.style.willChange = 'auto'; }
  if (RM) { $$('.reveal').forEach(show); }
  else if ('IntersectionObserver' in window) {
    var io = new IntersectionObserver(function (entries) {
      var batch = entries.filter(function (e) { return e.isIntersecting; });
      batch.forEach(function (e, i) {
        var el = e.target; io.unobserve(el);
        var sp = new Spring(0, {
          k: 210, c: 19,
          on: function (p) { el.style.opacity = Math.max(0, Math.min(1, p * 1.25)); el.style.transform = 'translateY(' + ((1 - p) * 28).toFixed(2) + 'px) scale(' + (0.985 + 0.015 * p).toFixed(4) + ')'; },
          done: function () { show(el); }
        });
        setTimeout(function () { sp.go(1); }, i * 80);
      });
    }, { threshold: 0.12, rootMargin: '0px 0px -6% 0px' });
    $$('.reveal').forEach(function (el) { io.observe(el); });
  } else { $$('.reveal').forEach(show); }

  /* ---- scroll progress ---- */
  var bar = $('#progress');
  function onScroll() {
    var h = document.documentElement.scrollHeight - innerHeight;
    var p = h > 0 ? Math.min(1, scrollY / h) : 0;
    bar.style.transform = 'scaleX(' + p.toFixed(4) + ')';
    sy = scrollY; layout();
  }

  /* ---- hero parallax: pointer + scroll, spring smoothed ---- */
  var layers = $$('.shape').map(function (el) {
    var d = parseFloat(el.dataset.depth || '1');
    var L = { el: el, d: d, px: 0, py: 0, sy: 0 };
    L.sx = new Spring(0, { k: 90, c: 16, on: function () { paint(L); } });
    L.sp = new Spring(0, { k: 90, c: 16, on: function () { paint(L); } });
    return L;
  });
  var mx = 0, my = 0, sy = 0;
  function paint(L) { L.el.style.transform = 'translate3d(' + L.sx.x.toFixed(2) + 'px,' + L.sp.x.toFixed(2) + 'px,0) rotate(' + (L.sx.x * 0.12).toFixed(2) + 'deg)'; }
  function layout() {
    if (RM) return;
    layers.forEach(function (L) { L.sx.go(mx * 46 * L.d); L.sp.go(my * 32 * L.d - sy * 0.18 * L.d); });
  }
  var hero = $('.hero');
  if (!RM && hero) {
    hero.addEventListener('pointermove', function (e) {
      var r = hero.getBoundingClientRect();
      mx = (e.clientX - r.left) / r.width - 0.5; my = (e.clientY - r.top) / r.height - 0.5; layout();
    });
    hero.addEventListener('pointerleave', function () { mx = 0; my = 0; layout(); });
  }
  addEventListener('scroll', onScroll, { passive: true }); addEventListener('resize', onScroll); onScroll();

  /* ---- spotlight: write pointer position into custom properties ---- */
  document.addEventListener('pointermove', function (e) {
    var t = e.target.closest && e.target.closest('.spot, .row');
    if (!t) return;
    var r = t.getBoundingClientRect();
    t.style.setProperty('--mx', (e.clientX - r.left) + 'px'); t.style.setProperty('--my', (e.clientY - r.top) + 'px');
  }, { passive: true });

  /* ---- dock: highlight the section in view ---- */
  var links = $$('.dock-a');
  var secs = links.map(function (a) { return document.getElementById(a.dataset.sec); }).filter(Boolean);
  function mark() {
    var y = scrollY + innerHeight * 0.35, cur = secs[0];
    secs.forEach(function (s) { if (s.getBoundingClientRect().top + scrollY <= y) cur = s; });
    links.forEach(function (a) { a.classList.toggle('is-on', a.dataset.sec === cur.id); });
  }
  addEventListener('scroll', mark, { passive: true }); mark();

  /* ---- clipboard (shared) ---- */
  window.PF.copy = function (text) {
    if (navigator.clipboard && navigator.clipboard.writeText) return navigator.clipboard.writeText(text);
    return new Promise(function (res, rej) {
      var t = document.createElement('textarea'); t.value = text; t.setAttribute('readonly', ''); t.style.position = 'fixed'; t.style.opacity = '0';
      document.body.appendChild(t); t.select();
      try { document.execCommand('copy') ? res() : rej(); } catch (e) { rej(e); } t.remove();
    });
  };

  /* ---- contract slot: read the record at runtime; inert until stated ---- */
  var reg = {}; try { JSON.parse($('#pf-register').textContent).records.forEach(function (r) { reg[r.id] = r; }); } catch (e) {}
  var c = reg.contract, btn = $('.ca-copy'), fb = $('.ca-fb');
  if (c && c.state === 'stated' && btn) {
    var timer;
    btn.addEventListener('click', function () {
      window.PF.copy(c.value).then(function () { fb.textContent = 'Copied'; }, function () { fb.textContent = 'Copy failed'; });
      clearTimeout(timer); timer = setTimeout(function () { fb.textContent = ''; }, 1800);
    });
  }
})();
