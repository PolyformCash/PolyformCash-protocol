import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ROOT, readRegister, validateRegister, publicRegister, renderCA, renderSocials, renderChart, renderRecords } from './lib.mjs';
import { loadLogo, squareCrop, resizePremul, onBackground, pngBuffer, traceFavicon } from './assets.mjs';

const hexToRgb = h => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16));

export function tokensCss(tokens) {
  const lines = ['/* Palette. Every value is a real pixel of a supplied asset (nearest pixel to a k-means centre / dominant bin).',
    '   This is the only file that holds colour literals. */', ':root{'];
  for (const [k, v] of Object.entries(tokens)) {
    const name = k.replace(/[A-Z]/g, m => '-' + m.toLowerCase());
    lines.push(`  --${name}: ${v.hex}; /* ${v.src} @ x=${v.x}, y=${v.y} */`);
  }
  lines.push('}', '');
  return lines.join('\n');
}

let assetCache = null;

export function build({ register = readRegister(), out = path.join(ROOT, 'dist') } = {}) {
  const errs = validateRegister(register);
  if (errs.length) throw new Error('register invalid: ' + errs.join('; '));
  const tokens = JSON.parse(fs.readFileSync(path.join(ROOT, 'src/tokens.json'), 'utf8'));

  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(path.join(out, 'assets'), { recursive: true });

  // styles + scripts
  fs.writeFileSync(path.join(out, 'assets/tokens.css'), tokensCss(tokens));
  for (const f of ['styles.css', 'app.js', 'market.js']) fs.copyFileSync(path.join(ROOT, 'src', f), path.join(out, 'assets', f));

  // logo: original copied verbatim, plus premultiplied-resized renditions
  const logoSrc = path.join(ROOT, 'brand', 'LOGO POLYFORM PNG.png');
  fs.copyFileSync(logoSrc, path.join(out, 'assets/logo-full.png'));
  if (!assetCache) {
    const crop = squareCrop(loadLogo(logoSrc), 0.08);
    assetCache = { favicon: traceFavicon(crop, tokens) };
    for (const s of [64, 128, 256, 512]) assetCache['logo-' + s + '.png'] = pngBuffer(resizePremul(crop, s));
    assetCache['apple-touch-icon.png'] = pngBuffer(onBackground(crop, 180, hexToRgb(tokens.navy.hex)));
  }
  for (const [k, v] of Object.entries(assetCache)) fs.writeFileSync(path.join(out, k === 'favicon' ? 'favicon.svg' : 'assets/' + k), v);

  // page
  const pub = publicRegister(register);
  const html = fs.readFileSync(path.join(ROOT, 'src/index.html'), 'utf8')
    .replace('{{CA_SLOT}}', renderCA(register))
    .replace('{{SOCIALS}}', renderSocials(register))
    .replace('{{CHART_CHIP}}', renderChart(register))
    .replace('{{RECORDS}}', renderRecords(register))
    .replace('{{REGISTER_JSON}}', JSON.stringify(pub).replace(/</g, '\\u003c'));
  if (/\{\{[A-Z_]+\}\}/.test(html)) throw new Error('unfilled placeholder in index.html');
  fs.writeFileSync(path.join(out, 'index.html'), html);
  return out;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const out = build();
  const n = fs.readdirSync(out, { recursive: true }).length;
  console.log(`built ${path.relative(ROOT, out)}/ (${n} entries)`);
}
