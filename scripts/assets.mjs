// Logo pipeline: premultiplied area resize (the source PNG is colortype 6 with ~3.6M pure-black transparent pixels,
// so straight-alpha resampling would bleed black into the edges) and favicon tracing from the real alpha grid.
import fs from 'node:fs';
import { PNG } from 'pngjs';

export function loadLogo(file) {
  const p = PNG.sync.read(fs.readFileSync(file));
  return p;
}

export function alphaBounds(p) {
  let x0 = p.width, y0 = p.height, x1 = -1, y1 = -1;
  for (let y = 0; y < p.height; y++) for (let x = 0; x < p.width; x++) {
    if (p.data[(y * p.width + x) * 4 + 3] > 8) { if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
  }
  return { x0, y0, x1, y1 };
}

// square crop around the glyph with padding, returned as float premultiplied RGBA
export function squareCrop(p, pad = 0.1) {
  const b = alphaBounds(p);
  const w = b.x1 - b.x0 + 1, h = b.y1 - b.y0 + 1;
  const side = Math.round(Math.max(w, h) * (1 + pad * 2));
  const ox = Math.round(b.x0 + w / 2 - side / 2), oy = Math.round(b.y0 + h / 2 - side / 2);
  const out = new Float32Array(side * side * 4);
  for (let y = 0; y < side; y++) for (let x = 0; x < side; x++) {
    const sx = x + ox, sy = y + oy;
    if (sx < 0 || sy < 0 || sx >= p.width || sy >= p.height) continue;
    const i = (sy * p.width + sx) * 4, o = (y * side + x) * 4;
    const a = p.data[i + 3] / 255;
    out[o] = p.data[i] / 255 * a; out[o + 1] = p.data[i + 1] / 255 * a; out[o + 2] = p.data[i + 2] / 255 * a; out[o + 3] = a;
  }
  return { data: out, side };
}

// box (area) downscale in premultiplied space, then un-premultiply
export function resizePremul(src, size) {
  const { data, side } = src;
  const out = new PNG({ width: size, height: size });
  const k = side / size;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    let r = 0, g = 0, b = 0, a = 0, wsum = 0;
    const sy0 = y * k, sy1 = (y + 1) * k, sx0 = x * k, sx1 = (x + 1) * k;
    for (let sy = Math.floor(sy0); sy < Math.ceil(sy1); sy++) {
      const wy = Math.min(sy + 1, sy1) - Math.max(sy, sy0);
      for (let sx = Math.floor(sx0); sx < Math.ceil(sx1); sx++) {
        const w = wy * (Math.min(sx + 1, sx1) - Math.max(sx, sx0));
        const i = (sy * side + sx) * 4;
        r += data[i] * w; g += data[i + 1] * w; b += data[i + 2] * w; a += data[i + 3] * w; wsum += w;
      }
    }
    r /= wsum; g /= wsum; b /= wsum; a /= wsum;
    const o = (y * size + x) * 4;
    if (a > 0) { out.data[o] = Math.round(Math.min(1, r / a) * 255); out.data[o + 1] = Math.round(Math.min(1, g / a) * 255); out.data[o + 2] = Math.round(Math.min(1, b / a) * 255); }
    out.data[o + 3] = Math.round(a * 255);
  }
  return out;
}

export function pngBuffer(png) { return PNG.sync.write(png); }

// composite premultiplied crop onto an opaque background colour (for touch icons)
export function onBackground(src, size, bg, inset = 0.14) {
  const inner = Math.round(size * (1 - inset * 2));
  const glyph = resizePremul(src, inner);
  const out = new PNG({ width: size, height: size });
  const off = Math.round((size - inner) / 2);
  for (let i = 0; i < size * size; i++) { out.data[i * 4] = bg[0]; out.data[i * 4 + 1] = bg[1]; out.data[i * 4 + 2] = bg[2]; out.data[i * 4 + 3] = 255; }
  for (let y = 0; y < inner; y++) for (let x = 0; x < inner; x++) {
    const i = (y * inner + x) * 4, o = ((y + off) * size + x + off) * 4, a = glyph.data[i + 3] / 255;
    for (let c = 0; c < 3; c++) out.data[o + c] = Math.round(glyph.data[i + c] * a + out.data[o + c] * (1 - a));
  }
  return out;
}

// ---- favicon tracing: marching squares on the real alpha grid, then Douglas-Peucker ----
function alphaGrid(src, n) {
  const g = resizePremul(src, n); // alpha channel after area average = coverage
  const a = new Float32Array(n * n);
  for (let i = 0; i < n * n; i++) a[i] = g.data[i * 4 + 3] / 255;
  return a;
}

function loops(a, n) {
  const v = (x, y) => (x < 0 || y < 0 || x >= n || y >= n ? 0 : a[y * n + x] >= 0.5 ? 1 : 0);
  const segs = [];
  const T = (x, y) => [x + 0.5, y], R = (x, y) => [x + 1, y + 0.5], B = (x, y) => [x + 0.5, y + 1], L = (x, y) => [x, y + 0.5];
  for (let y = -1; y < n; y++) for (let x = -1; x < n; x++) {
    const idx = v(x, y) * 8 + v(x + 1, y) * 4 + v(x + 1, y + 1) * 2 + v(x, y + 1);
    const S = (p, q) => segs.push([p, q]);
    switch (idx) {
      case 1: case 14: S(L(x, y), B(x, y)); break;
      case 2: case 13: S(B(x, y), R(x, y)); break;
      case 3: case 12: S(L(x, y), R(x, y)); break;
      case 4: case 11: S(T(x, y), R(x, y)); break;
      case 5: S(T(x, y), L(x, y)); S(B(x, y), R(x, y)); break;
      case 6: case 9: S(T(x, y), B(x, y)); break;
      case 7: case 8: S(T(x, y), L(x, y)); break;
      case 10: S(T(x, y), R(x, y)); S(L(x, y), B(x, y)); break;
    }
  }
  const key = p => p[0] + ',' + p[1];
  const adj = new Map();
  for (const [p, q] of segs) { for (const [s, t] of [[p, q], [q, p]]) { const k = key(s); if (!adj.has(k)) adj.set(k, []); adj.get(k).push(t); } }
  const seen = new Set(), out = [];
  for (const [p] of segs) {
    if (seen.has(key(p))) continue;
    const loop = [p]; seen.add(key(p)); let cur = p, prev = null;
    for (;;) {
      const nb = adj.get(key(cur)).find(t => key(t) !== (prev && key(prev)) && !seen.has(key(t)));
      if (!nb) break;
      loop.push(nb); seen.add(key(nb)); prev = cur; cur = nb;
    }
    if (loop.length > 8) out.push(loop);
  }
  return out;
}

function dp(pts, eps) {
  if (pts.length < 3) return pts;
  const [a, b] = [pts[0], pts[pts.length - 1]];
  let md = 0, mi = 0;
  const dx = b[0] - a[0], dy = b[1] - a[1], len = Math.hypot(dx, dy) || 1;
  for (let i = 1; i < pts.length - 1; i++) {
    const d = Math.abs(dy * pts[i][0] - dx * pts[i][1] + b[0] * a[1] - b[1] * a[0]) / len;
    if (d > md) { md = d; mi = i; }
  }
  if (md <= eps) return [a, b];
  return [...dp(pts.slice(0, mi + 1), eps).slice(0, -1), ...dp(pts.slice(mi), eps)];
}

export function traceFavicon(src, tokens) {
  const n = 192;
  const grid = alphaGrid(src, n);
  const size = 32, art = 21, off = (size - art) / 2, k = art / n;
  const paths = loops(grid, n).map(l => {
    // split the closed loop at its extremes so simplification keeps corners
    let i0 = 0; l.forEach((p, i) => { if (p[0] + p[1] < l[i0][0] + l[i0][1]) i0 = i; });
    const rot = [...l.slice(i0), ...l.slice(0, i0), l[i0]];
    const half = Math.floor(rot.length / 2);
    const s = [...dp(rot.slice(0, half + 1), 0.9).slice(0, -1), ...dp(rot.slice(half), 0.9).slice(0, -1)];
    return 'M' + s.map(p => (p[0] * k + off).toFixed(2) + ' ' + (p[1] * k + off).toFixed(2)).join('L') + 'Z';
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32" viewBox="0 0 32 32">` +
    `<rect width="32" height="32" rx="7" fill="${tokens.navy.hex}"/>` +
    `<path fill="${tokens.text.hex}" fill-rule="evenodd" d="${paths.join('')}"/></svg>\n`;
}
