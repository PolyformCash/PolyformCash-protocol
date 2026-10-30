// npm run gates: checks dist/, proves both register branches (contract/x/github absent and stated),
// proves market independence from CA state, and runs the mutation harness. Exit 0 only if everything holds.
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import jpeg from 'jpeg-js';
import { PNG } from 'pngjs';
import { ROOT, readRegister, validateRegister, rec, isStated, SOLANA_ADDR } from './lib.mjs';
import { build } from './build.mjs';

const TMP = path.join(ROOT, '.tmp');
const FIX = { ca: 'So11111111111111111111111111111111111111112', x: 'https://x.com/polyform_fixture', gh: 'https://github.com/polyform-fixture' };

// ---------- helpers ----------
const walk = d => fs.readdirSync(d, { recursive: true, withFileTypes: true }).filter(e => e.isFile()).map(e => path.join(e.parentPath ?? e.path, e.name));
const textFiles = d => walk(d).filter(f => /\.(html|css|js|svg|json|txt)$/.test(f));
const read = f => fs.readFileSync(f, 'utf8');
const clone = o => JSON.parse(JSON.stringify(o));
const rel = (d, f) => path.relative(d, f).replace(/\\/g, '/');

export function variant(base, state) {
  const reg = clone(base);
  for (const id of ['contract', 'x', 'github']) {
    const i = reg.records.findIndex(r => r.id === id), old = reg.records[i];
    const keep = { id: old.id, label: old.label, source: old.source, scope: old.scope, recordedOn: old.recordedOn };
    if (state === 'absent') reg.records[i] = { ...keep, state: 'absent' };
    else reg.records[i] = { ...keep, state: 'stated', ...(id === 'contract' ? { value: FIX.ca } : { url: id === 'x' ? FIX.x : FIX.gh }) };
  }
  return reg;
}

// address-shaped strings must match a stated registry value; 0x hex is never rejected on shape alone
export function scanAddresses(text, reg) {
  const allowed = [];
  for (const r of reg.records) if (isStated(r)) for (const k of ['value', 'url', 'rpc', 'boostsUrl', 'pairsUrl']) if (typeof r[k] === 'string') allowed.push(r[k]);
  const found = [];
  for (const m of text.matchAll(/0x[0-9a-fA-F]{40}\b/g)) found.push(m[0]);
  for (const m of text.matchAll(/[1-9A-HJ-NP-Za-km-z]{32,44}/g)) if (/[0-9]/.test(m[0]) && /[a-z]/.test(m[0]) && /[A-Z]/.test(m[0])) found.push(m[0]);
  return found.filter(s => !allowed.some(a => a === s || a.includes(s)));
}

const words = s => s.toLowerCase().replace(/&[a-z#0-9]+;/g, ' ').match(/[a-z0-9$]+(?:'[a-z]+)?/g) || [];
const bigrams = s => { const w = words(s), out = []; for (let i = 0; i < w.length - 1; i++) out.push(w[i] + ' ' + w[i + 1]); return out; };
function visibleBlocks(html) {
  const h = html.replace(/<script[\s\S]*?<\/script>/g, '').replace(/<style[\s\S]*?<\/style>/g, '').replace(/<svg[\s\S]*?<\/svg>/g, ' ');
  return (h.match(/>([^<>]+)</g) || []).map(t => t.slice(1, -1).trim()).filter(Boolean);
}
function jsStrings(js) { return [...js.matchAll(/'([^'\\\n]{6,})'/g)].map(m => m[1]).filter(s => /\s/.test(s) && !/[<>{}=;]/.test(s)); }

const DATE_RES = [
  [/\b\d{4}-\d{2}-\d{2}\b/, 'iso date'],
  [/\b\d{1,2}[\/.]\d{1,2}[\/.]\d{2,4}\b/, 'numeric date'],
  [/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+\d{1,4}\b/i, 'month day'],
  [/\b\d{1,2}:\d{2}(:\d{2})?\s*(am|pm)?\b/i, 'clock string'],
  [/\b(as of|checked|last updated|updated at|timestamp)\b/i, 'time phrase'],
  [/\b(19|20)\d{2}\b/, 'year'],
  [/\b(toLocale(Date|Time)String|new Date|Date\.now|DateTimeFormat)\b/, 'date api'],
];

const BAN = new RegExp(['cl' + 'aude', 'anthr' + 'opic', 'ai[- ]generated', 'generated (by|with) ai', 'co-authored-by', 'chat' + 'gpt', 'copi' + 'lot'].join('|'), 'i');

// ---------- gates ----------
// each gate: (ctx) => string[] of problems; ctx = { dir, reg, html, css, js, files }
function context(dir, reg) {
  const files = textFiles(dir);
  const g = n => files.filter(f => f.endsWith(n)).map(read).join('\n');
  return { dir, reg, files, html: read(path.join(dir, 'index.html')), css: g('styles.css'), tokensCss: g('tokens.css'), js: g('app.js') + '\n' + g('market.js'), market: g('market.js') };
}

const GATES = [
  ['G01 register schema valid', c => validateRegister(c.reg)],
  ['G02 inert records carry no value or url (register and embedded copy)', c => {
    const p = [];
    const emb = JSON.parse((c.html.match(/id="pf-register">([\s\S]*?)<\/script>/) || [, '{"records":[]}'])[1]);
    for (const [name, list] of [['register', c.reg.records], ['embedded', emb.records]])
      for (const r of list) if (r.state !== 'stated') for (const k of ['value', 'url', 'rpc', 'boostsUrl', 'pairsUrl']) if (k in r) p.push(`${name}:${r.id} carries ${k}`);
    if (JSON.stringify(emb).match(/\d{4}-\d{2}-\d{2}/)) p.push('embedded register carries a date');
    return p;
  }],
  ['G03 dist has index.html, favicon, styles, scripts, tokens', c => ['index.html', 'favicon.svg', 'assets/styles.css', 'assets/app.js', 'assets/market.js', 'assets/tokens.css'].filter(f => !fs.existsSync(path.join(c.dir, f))).map(f => 'missing ' + f)],
  ['G04 every local src/href in index.html resolves inside dist', c => {
    const p = [];
    for (const m of c.html.matchAll(/\b(?:src|href)="([^"#][^"]*)"/g)) {
      const u = m[1]; if (/^(https?:|mailto:|data:)/.test(u)) continue;
      for (const part of u.split(',').map(s => s.trim().split(/\s+/)[0]).filter(Boolean)) if (!fs.existsSync(path.join(c.dir, part))) p.push('unresolved ' + part);
    }
    for (const m of c.html.matchAll(/srcset="([^"]+)"/g)) for (const s of m[1].split(',')) { const u = s.trim().split(/\s+/)[0]; if (!fs.existsSync(path.join(c.dir, u))) p.push('unresolved ' + u); }
    return p;
  }],
  ['G05 logo copied into dist, referenced by index.html, valid RGBA PNG, source bytes intact', c => {
    const p = [];
    const src = path.join(ROOT, 'brand/LOGO POLYFORM PNG.png');
    for (const f of ['logo-64.png', 'logo-128.png', 'logo-256.png', 'logo-512.png', 'logo-full.png', 'apple-touch-icon.png']) {
      const fp = path.join(c.dir, 'assets', f);
      if (!fs.existsSync(fp)) { p.push('missing assets/' + f); continue; }
      const b = fs.readFileSync(fp);
      if (b.readUInt32BE(0) !== 0x89504e47) p.push(f + ' not a PNG');
    }
    if (!/<img[^>]+src="assets\/logo-64\.png"/.test(c.html)) p.push('header img does not reference assets/logo-64.png');
    const full = path.join(c.dir, 'assets/logo-full.png');
    if (fs.existsSync(full) && !fs.readFileSync(full).equals(fs.readFileSync(src))) p.push('logo-full.png differs from brand source');
    return p;
  }],
  ['G06 premultiplied resize left no dark fringe (partial-alpha pixels stay light)', c => {
    const f = path.join(c.dir, 'assets/logo-256.png');
    if (!fs.existsSync(f)) return ['logo-256.png missing'];
    const png = PNG.sync.read(fs.readFileSync(f));
    let bad = 0, partial = 0;
    for (let i = 0; i < png.data.length; i += 4) { const a = png.data[i + 3]; if (a > 8 && a < 247) { partial++; if (png.data[i] < 40) bad++; } }
    return partial === 0 ? ['no antialiased pixels found'] : bad > partial * 0.01 ? [`${bad}/${partial} edge pixels are dark`] : [];
  }],
  ['G07 favicon: 32x32 svg, no comment with a double hyphen, still has a traced path', c => {
    const f = path.join(c.dir, 'favicon.svg'); if (!fs.existsSync(f)) return ['favicon.svg missing'];
    const s = read(f), p = [];
    if (!/viewBox="0 0 32 32"/.test(s) || !/width="32"/.test(s) || !/height="32"/.test(s)) p.push('not 32x32');
    for (const m of s.matchAll(/<!--([\s\S]*?)-->/g)) if (m[1].includes('--')) p.push('comment contains a double hyphen');
    if (/<!--(?![\s\S]*-->)/.test(s)) p.push('unterminated comment');
    if (!/<path[^>]+d="M[^"]{200,}"/.test(s)) p.push('traced path missing');
    if (!/rel="icon"[^>]+favicon\.svg|href="favicon\.svg"/.test(c.html)) p.push('index.html does not link favicon.svg');
    return p;
  }],
  ['G08 no dates, timestamps, clock strings or date APIs anywhere in dist', c => {
    const p = [];
    for (const f of c.files) {
      const code = /\.(js|css)$/.test(f), t = read(f).replace(/\sd="[^"]*"/g, '').replace(/xmlns="[^"]*"/g, '');
      for (const [re, n] of DATE_RES) { if (code && /^(year|numeric date)$/.test(n)) continue; const m = t.match(re); if (m) p.push(`${rel(c.dir, f)}: ${n} "${m[0]}"`); } }
    return p;
  }],
  ['G09 social anchors: href only for stated records, icon-only, both at all widths', c => {
    const p = [];
    for (const id of ['x', 'github']) {
      const m = c.html.match(new RegExp(`<a[^>]*data-social="${id}"[^>]*>([\\s\\S]*?)</a>`));
      if (!m) { p.push(`${id} icon missing`); continue; }
      const tag = m[0].slice(0, m[0].indexOf('>') + 1), r = rec(c.reg, id);
      const hasHref = /\shref=/.test(tag);
      if (isStated(r) !== hasHref) p.push(`${id}: href=${hasHref} but state=${r.state}`);
      if (isStated(r) && !tag.includes(`href="${r.url}"`)) p.push(`${id}: href is not the stored url`);
      if (m[1].replace(/<svg[\s\S]*?<\/svg>/g, '').trim()) p.push(`${id}: icon carries text`);
      if (!/<svg/.test(m[1])) p.push(`${id}: no svg`);
    }
    const headerAt = c.html.indexOf('<nav class="social"'); if (headerAt < 0 || headerAt > c.html.indexOf('<main')) p.push('socials not in the top bar');
    if (/\.(social|icon-btn)[^{]*\{[^}]*display:\s*none/.test(c.css)) p.push('css hides a social icon');
    for (const m of c.css.matchAll(/@media[^{]*\{([\s\S]*?)\n\}/g)) if (/\.(social|icon-btn)[^{]*\{[^}]*display:\s*none/.test(m[1])) p.push('css hides a social icon inside a media query');
    return p;
  }],
  ['G10 no link for unstated records (x, github, chart, contract-derived)', c => {
    const p = [];
    const stated = new Set(c.reg.records.filter(isStated).flatMap(r => [r.url, r.value, r.rpc].filter(Boolean)));
    for (const m of c.html.matchAll(/<a\b[^>]*\shref="([^"]+)"/g)) {
      const u = m[1];
      if (/^https?:/.test(u) && !stated.has(u) && !(isStated(rec(c.reg, 'contract')) && u === `https://dexscreener.com/solana/${rec(c.reg, 'contract').value}`)) p.push('unregistered external link ' + u);
    }
    for (const id of ['x', 'github', 'chart', 'contract']) for (const m of c.html.matchAll(new RegExp(`<(a|span|button)\\b[^>]*data-record="${id}"[^>]*>`, 'g'))) {
      const stateOf = id === 'chart' ? rec(c.reg, 'contract') : rec(c.reg, id);
      if (!isStated(stateOf) && (/\shref=/.test(m[0]) || /data-copy/.test(m[0]))) p.push(`${id}: inert node carries href or copy value`);
    }
    return p;
  }],
  ['G11 contract slot: top of page, large, full address + copy when stated, label + pending when absent', c => {
    const p = [], r = rec(c.reg, 'contract');
    const caAt = c.html.indexOf('class="ca"'), mainAt = c.html.indexOf('<main');
    if (caAt < 0 || caAt > mainAt) p.push('slot is not above <main>');
    if (!/\.top\s*\{[^}]*position:\s*sticky/.test(c.css)) p.push('top block is not sticky (not always visible)');
    const fs_ = c.css.match(/\.ca-value\s*\{[^}]*font-size:\s*clamp\([^,]+,[^,]+,\s*([\d.]+)rem\)/);
    if (!fs_ || parseFloat(fs_[1]) < 1.5) p.push('slot font is not large (max < 1.5rem)');
    const slot = (c.html.match(/<section class="ca"[\s\S]*?<\/section>/) || [''])[0];
    if (isStated(r)) {
      if (!slot.includes(`data-copy="${r.value}"`)) p.push('data-copy is not the stated value');
      if (!new RegExp(`<span class="ca-addr">${r.value}</span>`).test(slot)) p.push('full address not displayed');
      if (!/aria-live="polite"/.test(slot)) p.push('no copy feedback region');
      if (!/Copied/.test(c.js)) p.push('no copy feedback text in script');
    } else {
      if (/data-copy|ca-copy|<button/.test(slot)) p.push('inert slot has a copy control');
      if (!/pending/.test(slot)) p.push('inert slot lacks "pending"');
      if (SOLANA_ADDR.test(slot.replace(/<[^>]+>/g, '').trim())) p.push('inert slot carries an address');
    }
    return p;
  }],
  ['G12 address scanner: address-shaped strings match a stated registry value (0x never blanket-rejected)', c => {
    const p = [];
    for (const f of c.files) for (const s of scanAddresses(read(f), c.reg)) p.push(`${rel(c.dir, f)}: unregistered address-shaped string ${s}`);
    return p;
  }],
  ['G13 palette: colour literals live only in tokens.css (+ favicon built from tokens)', c => {
    const p = [];
    for (const f of c.files) {
      const name = rel(c.dir, f); if (/tokens\.css$|favicon\.svg$/.test(name)) continue;
      const t = read(f).replace(/&#\d+;|&#x[0-9a-f]+;/gi, '').replace(/\\u[0-9a-f]{4}/gi, '');
      const m = t.match(/#[0-9a-fA-F]{3,8}\b(?![-\w])/g) || [];
      for (const h of m) if (!/^#(top|why|market|register|path|ca)$/.test(h) && /^#([0-9a-f]{3}|[0-9a-f]{4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.test(h) && /[0-9]/.test(h)) p.push(`${name}: literal ${h}`);
      if (/\brgba?\(\s*\d/.test(t) || /\bhsla?\(\s*\d/.test(t)) p.push(`${name}: rgb/hsl literal`);
    }
    return p;
  }],
  ['G14 palette provenance: each token is a real pixel of its source asset at the stated coordinate', c => {
    const p = [], tokens = JSON.parse(read(path.join(ROOT, 'src/tokens.json')));
    const srcs = { cover: 'reference/SAMPUL POLYFORM JPG.jpg.jpeg', scene: 'reference/POLYFORM 1.jpg.jpeg', mark: 'brand/LOGO POLYFORM JPG.jpg.jpeg' };
    const img = {};
    for (const [k, t] of Object.entries(tokens)) {
      const j = img[t.src] ??= jpeg.decode(fs.readFileSync(path.join(ROOT, srcs[t.src])), { useTArray: true });
      const i = (t.y * j.width + t.x) * 4, hex = '#' + [0, 1, 2].map(n => j.data[i + n].toString(16).padStart(2, '0')).join('');
      if (hex !== t.hex) p.push(`${k}: ${t.hex} is not the pixel at (${t.x},${t.y}) of ${t.src} (${hex})`);
      if (!c.tokensCss.includes(`--${k.replace(/[A-Z]/g, m => '-' + m.toLowerCase())}: ${t.hex}; /* ${t.src} @ x=${t.x}, y=${t.y} */`)) p.push(`${k}: provenance comment missing in tokens.css`);
    }
    return p;
  }],
  ['G15 reduced motion: css media query, script matchMedia, instant fallback for springs and count-ups', c => {
    const p = [];
    if (!/@media \(prefers-reduced-motion: reduce\)/.test(c.css)) p.push('css lacks reduced-motion query');
    if (!/animation:\s*none\s*!important/.test(c.css)) p.push('css does not zero animations');
    if (!/matchMedia\('\(prefers-reduced-motion: reduce\)'\)/.test(c.js) || !/matchMedia\('\(prefers-reduced-motion: reduce\)'\)/.test(c.html)) p.push('missing matchMedia check');
    if (!/if \(RM\(\)\) \{ el\.textContent/.test(c.market)) p.push('count-up has no instant fallback');
    if (!/if \(RM\) \{ \$\$\('\.reveal'\)\.forEach\(show\)/.test(c.js)) p.push('reveal has no instant fallback');
    return p;
  }],
  ['G16 no ch units', c => c.files.filter(f => /\.(css|html|js)$/.test(f)).flatMap(f => (read(f).match(/\b\d*\.?\d+ch\b/g) || []).map(m => `${rel(c.dir, f)}: ${m}`))],
  ['G17 tap targets: 44px minimum declared for every control class', c => {
    const p = [];
    if (!/\.tap\s*\{[^}]*min-height:\s*2\.75rem[^}]*min-width:\s*2\.75rem/.test(c.css)) p.push('.tap lacks 2.75rem min size');
    for (const cls of ['icon-btn', 'copy-btn', 'dock-a']) if (!new RegExp(`\\.${cls}\\s*\\{[^}]*height:\\s*2\\.75rem`).test(c.css)) p.push(`.${cls} lacks 2.75rem height`);
    return p;
  }],
  ['G18 live market wiring: 60s poll, backoff, visibility pause, immediate fetch on visible, last good data kept', c => {
    const m = c.market, p = [];
    for (const [re, n] of [[/POLL = 60000/, '60s poll'], [/Math\.pow\(2, fails - 1\)/, 'exponential backoff'], [/visibilitychange/, 'visibility listener'], [/document\.hidden/, 'hidden check'], [/api\.dexscreener|boostsUrl/, 'source'], [/chainId === 'solana'/, 'solana filter'], [/slice\(0, 10\)/, 'top 10'], [/b\.vol - a\.vol/, 'volume sort'], [/referrerPolicy/, 'image handling'], [/charAt\(0\)\.toUpperCase\(\)/, 'letter tile'], [/AbortController/, 'timeout'], [/clearTimeout\(timer\); run\(\)/, 'immediate fetch on visible'], [/state\.data\.length\) setStatus\('stale'/, 'keeps last good data on failure'], [/'Feed unreachable'/, 'error text'], [/ticker/, 'ticker from same data']]) if (!re.test(m)) p.push('missing: ' + n);
    const shell = c.html.replace(/<script type="application\/json"[\s\S]*?<\/script>/, '');
    if (/tokens\/v1\/solana/.test(shell) || /dexscreener/i.test(shell.replace(/https:\/\/dexscreener\.com\/solana\/[A-Za-z0-9]+/g, ''))) p.push('market endpoint hard-coded in html (must come from register)');
    return p;
  }],
  ['G19 market ignores CA state: no contract reference in market.js, and it reads only market-source', c => {
    const p = [];
    if (/contract|\bca\b|ca-copy/i.test(c.market)) p.push('market.js references contract state');
    if ((c.market.match(/'market-source'/g) || []).length !== 1) p.push('market.js must read exactly the market-source record');
    return p;
  }],
  ['G20 skeletons, count-up, flash, spotlight, parallax, progress, spring solver, live pill present', c => {
    const p = [];
    for (const [t, n] of [[c.css, '.sk'], [c.css, 'flashup'], [c.css, '.spot::before'], [c.css, 'ping'], [c.css, 'marquee'], [c.css, 'drift1'], [c.js, 'Spring.prototype.go'], [c.js, 'data-depth|dataset.depth'], [c.js, "#progress"], [c.js, 'IntersectionObserver'], [c.js, '--mx'], [c.html, 'class="progress"'], [c.html, 'class="status"'], [c.market, 'flash-up']]) if (!new RegExp(n.replace(/\./g, '\\.')).test(t)) p.push('missing ' + n);
    return p;
  }],
  ['G21 copy is original: zero 2-grams shared with the reference copy', c => {
    const corpus = new Set(read(path.join(ROOT, 'tools/ref-copy.txt')).split('\n').flatMap(bigrams));
    const ours = [...visibleBlocks(c.html), ...jsStrings(c.js)];
    const hits = [];
    for (const b of ours) for (const g of bigrams(b)) if (corpus.has(g)) hits.push(`"${g}"`);
    return [...new Set(hits)];
  }],
  ['G22 deploy folder holds only site files (no readme, license, docs, register, brand, reference)', c => walk(c.dir).map(f => rel(c.dir, f)).filter(n => /readme|license|whitepaper|\.md$|register\.json|brand|reference|node_modules|\.map$/i.test(n)).map(n => 'unexpected ' + n)],
  ['G23 repo hygiene: no CLAUDE.md, no .claude/, no AI attribution in any shipped or repo text', c => {
    const p = [];
    if (fs.existsSync(path.join(ROOT, 'CLAUDE.md'))) p.push('CLAUDE.md present');
    if (fs.existsSync(path.join(ROOT, '.claude'))) p.push('.claude/ present');
    const roots = [c.dir, path.join(ROOT, 'src'), path.join(ROOT, 'scripts'), path.join(ROOT, 'docs')];
    const files = roots.filter(fs.existsSync).flatMap(textFiles).concat(['README.md', 'LICENSE', 'package.json', 'register.json'].map(f => path.join(ROOT, f)).filter(fs.existsSync));
    for (const f of files) { const m = read(f).match(BAN); if (m) p.push(`${rel(ROOT, f)}: "${m[0]}"`); }
    return p;
  }],
  ['G24 external anchors carry rel="noopener noreferrer"', c => [...c.html.matchAll(/<a\b[^>]*target="_blank"[^>]*>/g)].filter(m => !/rel="noopener noreferrer"/.test(m[0])).map(m => 'missing rel: ' + m[0].slice(0, 60))],
];

function runAll(dir, reg) {
  const c = context(dir, reg);
  return GATES.map(([name, fn]) => { let problems; try { problems = fn(c); } catch (e) { problems = ['threw: ' + e.message]; } return { name, id: name.slice(0, 3), problems }; });
}
const failedIds = res => res.filter(r => r.problems.length).map(r => r.id);

// ---------- main ----------
const out = [];
let total = 0, passed = 0;
const check = (label, ok, detail = '') => { total++; if (ok) passed++; out.push(`${ok ? 'PASS' : 'FAIL'}  ${label}${!ok && detail ? '\n        ' + detail : ''}`); };

function section(title) { out.push(`\n== ${title}`); }

const base = readRegister();
const live = path.join(ROOT, 'dist');
if (!fs.existsSync(path.join(live, 'index.html'))) { console.error('dist/ missing: run npm run build first'); process.exit(1); }

section(`dist/ (contract is ${rec(base, 'contract').state})`);
for (const r of runAll(live, base)) check(r.name, !r.problems.length, r.problems.slice(0, 6).join('\n        '));

// both branches, built into .tmp so dist/ is untouched
const built = {};
for (const state of ['absent', 'stated']) {
  const reg = variant(base, state), dir = path.join(TMP, 'branch-' + state);
  build({ register: reg, out: dir }); built[state] = { dir, reg };
  section(`branch: contract/x/github ${state}`);
  for (const r of runAll(dir, reg)) check(`[${state}] ${r.name}`, !r.problems.length, r.problems.slice(0, 6).join('\n        '));
}

section('market independence (market follows its own record only)');
const slice = d => { const h = read(path.join(d, 'index.html')); return h.slice(h.indexOf('id="market"'), h.indexOf('id="why"')); };
check('market section markup is identical in both CA states', slice(built.absent.dir) === slice(built.stated.dir));
check('market.js is byte-identical in both CA states', fs.readFileSync(path.join(built.absent.dir, 'assets/market.js')).equals(fs.readFileSync(path.join(built.stated.dir, 'assets/market.js'))));
check('absent branch: contract, x, github have no href and no value anywhere in the page', (() => { const h = read(path.join(built.absent.dir, 'index.html')); return !h.includes(FIX.ca) && !h.includes(FIX.x) && !h.includes(FIX.gh) && !/x\.com|github\.com/.test(h); })());
check('stated branch: contract, x, github all live', (() => { const h = read(path.join(built.stated.dir, 'index.html')); return h.includes(`data-copy="${FIX.ca}"`) && h.includes(`href="${FIX.x}"`) && h.includes(`href="${FIX.gh}"`); })());

section('address scanner behaviour');
const T = FIX.ca, EVM = '0x' + 'ab12cd34'.repeat(5);
const regT = { records: [{ id: 'contract', state: 'stated', value: T }, { id: 'evm', state: 'stated', value: EVM }] };
check('stated Solana address passes', scanAddresses(`x ${T} y`, regT).length === 0);
check('stated 0x hex passes (not blanket-rejected)', scanAddresses(`x ${EVM} y`, regT).length === 0);
check('unregistered 0x hex is flagged', scanAddresses('0x' + '9f'.repeat(20), regT).length === 1);
check('unregistered base58 is flagged', scanAddresses('Gx9Zk2' + 'Qm7pLr4Wt8Yv3Bn5Hd6Jc1Fs0Xa'.replace(/[0Ol]/g, 'A') + 'zzzz', regT).length === 1);
check('absent contract allows nothing', scanAddresses(T, { records: [{ id: 'contract', state: 'absent' }] }).length === 1);

section('mutation harness (anchors read the live record state at runtime)');
const st = rec(base, 'contract').state;
const MUT = [
  ['inject a date', 'G08', d => edit(d, 'index.html', h => h.replace('</footer>', '<p>Checked 2026-10-30</p></footer>'))],
  ['inject a clock string', 'G08', d => edit(d, 'index.html', h => h.replace('</footer>', '<p>12:45</p></footer>'))],
  ['inject an "as of" phrase', 'G08', d => edit(d, 'index.html', h => h.replace('</footer>', '<p>as of now</p></footer>'))],
  ['inject unregistered base58 address', 'G12', d => edit(d, 'index.html', h => h.replace('</footer>', '<p>Gx9Zk2Qm7pLr4Wt8Yv3Bn5Hd6Jc1Fs9Xa2Ke</p></footer>'))],
  ['inject unregistered 0x address', 'G12', d => edit(d, 'index.html', h => h.replace('</footer>', '<p>0x' + '9f'.repeat(20) + '</p></footer>'))],
  ['flip social href against current state', 'G09', d => edit(d, 'index.html', h => { const r = rec(base, 'x'); return isStated(r) ? h.replace(/(<a[^>]*data-social="x"[^>]*?)\shref="[^"]*"/, '$1') : h.replace(/<a class="icon-btn is-inert" data-record="x"/, '<a href="https://x.com/zz" class="icon-btn is-inert" data-record="x"'); })],
  ['flip contract copy value against current state', 'G11', d => edit(d, 'index.html', h => isStated(rec(base, 'contract')) ? h.replace(/data-copy="[^"]*"/, '') : h.replace('<span class="ca-value is-inert"', `<button data-copy="${FIX.ca}" class="ca-copy"></button><span class="ca-value is-inert"`))],
  ['link an unstated chart chip', 'G10', d => edit(d, 'index.html', h => isStated(rec(base, 'contract')) ? h.replace(/(<a class="chip tap" data-record="chart"[^>]*) href="[^"]*"/, '$1 href="https://example.org/"') : h.replace('<span class="chip is-inert" data-record="chart"', '<a href="https://dexscreener.com/solana/zzz" class="chip is-inert" data-record="chart"').replace(/(data-record="chart"[^>]*>)Chart <em>pending<\/em><\/span>/, '$1Chart</a>'))],
  ['remove a logo rendition', 'G05', d => fs.rmSync(path.join(d, 'assets/logo-64.png'))],
  ['point the header logo at a missing file', 'G04', d => edit(d, 'index.html', h => h.replace('assets/logo-64.png"', 'assets/logo-missing.png"'))],
  ['add a colour literal outside tokens', 'G13', d => edit(d, 'assets/styles.css', c => c + '\n.x{color:#123456}\n')],
  ['add an rgb literal outside tokens', 'G13', d => edit(d, 'assets/styles.css', c => c + '\n.x{color:rgb(1,2,3)}\n')],
  ['add a ch unit', 'G16', d => edit(d, 'assets/styles.css', c => c + '\n.x{width:10ch}\n')],
  ['strip the reduced-motion query', 'G15', d => edit(d, 'assets/styles.css', c => c.replace('@media (prefers-reduced-motion: reduce)', '@media print'))],
  ['hide social icons on small screens', 'G09', d => edit(d, 'assets/styles.css', c => c + '\n@media (max-width: 40rem) {\n.social { display: none; }\n}\n')],
  ['favicon comment with double hyphen', 'G07', d => edit(d, 'favicon.svg', s => s.replace('<rect', '<!-- a -- b --><rect'))],
  ['favicon wrong size', 'G07', d => edit(d, 'favicon.svg', s => s.replace('viewBox="0 0 32 32"', 'viewBox="0 0 48 48"'))],
  ['market.js reads contract state', 'G19', d => edit(d, 'assets/market.js', s => s + '\n/* uses contract */')],
  ['drop the 60s poll', 'G18', d => edit(d, 'assets/market.js', s => s.replace('POLL = 60000', 'POLL = 5000'))],
  ['ship a readme in dist', 'G22', d => fs.writeFileSync(path.join(d, 'README.md'), 'x')],
  ['ship the register in dist', 'G22', d => fs.writeFileSync(path.join(d, 'register.json'), '{}')],
  ['attribution text in a shipped file', 'G23', d => edit(d, 'index.html', h => h.replace('</footer>', '<!-- Co-Authored-By: someone --></footer>'))],
  ['reference phrase in copy', 'G21', d => edit(d, 'index.html', h => h.replace('</footer>', '<p>Get started with deep liquidity</p></footer>'))],
  ['rel dropped from external link', 'G24', d => edit(d, 'index.html', h => h.includes('target="_blank"') ? h.replace(/ rel="noopener noreferrer"/, '') : h.replace('</footer>', '<a href="https://x.com/zz" target="_blank">x</a></footer>'))],
  ['tap size removed', 'G17', d => edit(d, 'assets/styles.css', c => c.replace(/\.tap \{[^}]*\}/, '.tap { }'))],
  ['dark fringe: replace logo with straight-alpha dark edge', 'G06', d => { const f = path.join(d, 'assets/logo-256.png'); const p = PNG.sync.read(fs.readFileSync(f)); for (let i = 0; i < p.data.length; i += 4) if (p.data[i + 3] > 8 && p.data[i + 3] < 247) p.data[i] = p.data[i + 1] = p.data[i + 2] = 0; fs.writeFileSync(f, PNG.sync.write(p)); }],
];
function edit(d, f, fn) { const p = path.join(d, f); const a = read(p), b = fn(a); if (a === b) throw new Error(`mutation anchor not found in ${f}`); fs.writeFileSync(p, b); }

let mi = 0;
for (const [name, gate, fn] of MUT) {
  const dir = path.join(TMP, 'mut-' + mi++);
  build({ register: base, out: dir });
  try { fn(dir); } catch (e) { check(`mutation "${name}" applies`, false, e.message); continue; }
  const failed = failedIds(runAll(dir, base));
  check(`mutation "${name}" is caught by ${gate}`, failed.includes(gate), `failed gates: ${failed.join(',') || 'none'}`);
}
{ // register mutation: make a record inert-with-value / stated-without-anything, read current state at runtime
  const bad = clone(base); const target = bad.records.find(r => r.state !== 'stated') || bad.records[0];
  if (target.state !== 'stated') target.value = 'leak'; else { target.state = 'absent'; }
  check(`mutation "inert record carries value" (${target.id}) is caught by G01`, validateRegister(bad).length > 0);
  const bad2 = clone(base); const t2 = bad2.records.find(r => r.id === 'contract'); Object.assign(t2, { state: 'stated', value: 'not-an-address' });
  check('mutation "stated contract with a non-address value" is caught by G01', validateRegister(bad2).length > 0);
  const bad3 = clone(base); const t3 = bad3.records.find(r => r.id === 'x'); Object.assign(t3, { state: 'stated', url: 'https://example.org/x' }); delete t3.value;
  check('mutation "stated x record on a foreign host" is caught by G01', validateRegister(bad3).length > 0);
}
check('unmutated copy still passes every gate (control)', (() => { const d = path.join(TMP, 'control'); build({ register: base, out: d }); return failedIds(runAll(d, base)).length === 0; })());

fs.rmSync(TMP, { recursive: true, force: true });
console.log(out.join('\n'));
console.log(`\ngates: ${passed}/${total} passed (${GATES.length} gates x 3 builds, ${MUT.length + 3} mutations, scanner and independence checks)`);
process.exit(passed === total ? 0 : 1);
