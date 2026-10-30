import fs from 'node:fs';
import path from 'node:path';

import { fileURLToPath } from 'node:url';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const STATES = ['stated', 'absent', 'unconfirmed'];
export const SOLANA_ADDR = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;

export function readRegister(file = path.join(ROOT, 'register.json')) {
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}

export const rec = (reg, id) => reg.records.find(r => r.id === id);
export const isStated = r => !!r && r.state === 'stated';

export function handleOf(url) {
  try { return '@' + new URL(url).pathname.split('/').filter(Boolean)[0]; } catch { return ''; }
}

// public copy of the register: dates stay in register.json as data only
export function publicRegister(reg) {
  return { version: reg.version, records: reg.records.map(({ recordedOn, ...r }) => r) };
}

export function validateRegister(reg) {
  const errs = [];
  const ids = new Set();
  for (const r of reg.records) {
    if (ids.has(r.id)) errs.push(`duplicate id ${r.id}`); ids.add(r.id);
    if (!STATES.includes(r.state)) errs.push(`${r.id}: bad state ${r.state}`);
    if (r.state !== 'stated') {
      for (const k of Object.keys(r)) if (/^(value|url|rpc|boostsUrl|pairsUrl)$/.test(k)) errs.push(`${r.id}: inert record carries ${k}`);
    } else if (!('value' in r) && !('url' in r)) errs.push(`${r.id}: stated record carries no value or url`);
  }
  for (const need of ['chain', 'contract', 'x', 'github', 'market-source']) if (!ids.has(need)) errs.push(`missing record ${need}`);
  const c = rec(reg, 'contract');
  if (isStated(c) && !SOLANA_ADDR.test(c.value || '')) errs.push('contract: value is not a base58 Solana address');
  const x = rec(reg, 'x'); if (isStated(x) && !/^https:\/\/(x|twitter)\.com\/[^/]+/.test(x.url || '')) errs.push('x: url must be an x.com profile');
  const g = rec(reg, 'github'); if (isStated(g) && !/^https:\/\/github\.com\/[^/]+/.test(g.url || '')) errs.push('github: url must be a github.com profile');
  return errs;
}

const esc = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const X_SVG = '<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true" focusable="false"><path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/></svg>';
const GH_SVG = '<svg viewBox="0 0 16 16" width="20" height="20" fill="currentColor" aria-hidden="true" focusable="false"><path d="M8 0c4.42 0 8 3.58 8 8a8.013 8.013 0 0 1-5.45 7.59c-.4.08-.55-.17-.55-.38 0-.27.01-1.13.01-2.2 0-.75-.25-1.23-.54-1.48 1.78-.2 3.65-.88 3.65-3.95 0-.88-.31-1.59-.82-2.15.08-.2.36-1.02-.08-2.12 0 0-.67-.22-2.2.82-.64-.18-1.32-.27-2-.27-.68 0-1.36.09-2 .27-1.53-1.03-2.2-.82-2.2-.82-.44 1.1-.16 1.92-.08 2.12-.51.56-.82 1.28-.82 2.15 0 3.06 1.86 3.75 3.64 3.95-.23.2-.44.55-.51 1.07-.46.21-1.61.55-2.33-.66-.15-.24-.6-.83-1.23-.82-.67.01-.27.38.01.53.34.19.73.9.82 1.13.16.45.68 1.31 2.69.94 0 .67.01 1.3.01 1.49 0 .21-.15.45-.55.38A7.995 7.995 0 0 1 0 8c0-4.42 3.58-8 8-8Z"/></svg>';
const COPY_SVG = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false"><path d="M9 9h10v10H9zM5 15V5h10"/></svg>';

export function renderCA(reg) {
  const c = rec(reg, 'contract');
  if (!isStated(c)) {
    return `<section class="ca" id="ca" data-record="contract" data-state="${c.state}" aria-label="Contract address">` +
      `<div class="ca-in"><span class="ca-label">Contract</span><span class="ca-value is-inert" aria-disabled="true">pending</span></div></section>`;
  }
  return `<section class="ca" id="ca" data-record="contract" data-state="stated" aria-label="Contract address">` +
    `<div class="ca-in"><span class="ca-label">Contract</span>` +
    `<button type="button" class="ca-value ca-copy tap" data-copy="${esc(c.value)}" aria-label="Copy the contract address"><span class="ca-addr">${esc(c.value)}</span>${COPY_SVG}</button>` +
    `<span class="ca-fb" role="status" aria-live="polite"></span></div></section>`;
}

export function renderSocial(reg, id, label, svg) {
  const r = rec(reg, id);
  if (isStated(r)) {
    return `<a class="icon-btn" data-record="${id}" data-social="${id}" data-state="stated" href="${esc(r.url)}" target="_blank" rel="noopener noreferrer" aria-label="${label}, ${esc(handleOf(r.url))}">${svg}</a>`;
  }
  return `<a class="icon-btn is-inert" data-record="${id}" data-social="${id}" data-state="${r.state}" aria-disabled="true" aria-label="${label}, pending" role="img">${svg}</a>`;
}

export function renderSocials(reg) {
  return renderSocial(reg, 'x', 'X', X_SVG) + renderSocial(reg, 'github', 'GitHub', GH_SVG);
}

export function renderChart(reg) {
  const c = rec(reg, 'contract');
  if (isStated(c)) return `<a class="chip tap" data-record="chart" data-state="stated" href="https://dexscreener.com/solana/${esc(c.value)}" target="_blank" rel="noopener noreferrer">Chart</a>`;
  return `<span class="chip is-inert" data-record="chart" data-state="${c.state}" aria-disabled="true">Chart <em>pending</em></span>`;
}

export function renderRecords(reg) {
  const rows = [['chain', 'Chain'], ['contract', 'Contract'], ['x', 'X'], ['github', 'GitHub'], ['market-source', 'Market feed']];
  return rows.map(([id, label]) => {
    const r = rec(reg, id);
    let tail;
    if (!isStated(r)) tail = '<em>pending</em>';
    else if (id === 'contract') tail = '<em class="ok">stated</em>';
    else if (id === 'x' || id === 'github') tail = `<em class="ok">${esc(handleOf(r.url))}</em>`;
    else if (id === 'market-source') tail = '<em class="ok">live</em>';
    else tail = `<em class="ok">${esc(r.value)}</em>`;
    return `<li class="rec" data-record="${id}" data-state="${r.state}"><span>${label}</span>${tail}</li>`;
  }).join('\n');
}
