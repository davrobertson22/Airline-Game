#!/usr/bin/env node
// Tailwinds → Headwinds: point players at the multiplayer game at the moments
// they've outgrown the AI.
//
//   node --import ./tools/_register-loader.mjs tools/headwinds-crosspromo-test.mjs
//
// Background (2026-10-14): Tailwinds gets ~2,000 visitors a month and nothing
// inside the game mentioned Headwinds — only the landing page did, which a
// player sees before they've played. The moments that sell "rivals who think"
// are the ones where the AI has just been beaten:
//   * the victory screen (every AI rival bought out),
//   * the final-call screen (an era run reached its horizon),
//   * the first rival buyout — once per browser, never again, and not when
//     that buyout IS the victory (the victory screen makes the pitch).
// Every link is UTM-tagged so Headwinds' analytics show what Tailwinds sends.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React from 'react';
import { renderToString } from 'react-dom/server';

const store = new Map();
globalThis.window = globalThis.window ?? {};
globalThis.localStorage = globalThis.localStorage ?? {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
  clear: () => store.clear(),
};

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.log(`  ✗ ${name}\n      ${(e.stack || e.message).split('\n').slice(0, 2).join('\n      ')}`); failed++; }
}
const mem = () => { const m = new Map(); return { getItem: (k) => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: (k) => m.delete(k) }; };
const render = (el) => renderToString(el).replace(/<!-- -->/g, '').replace(/&amp;/g, '&');

let H = null, App = null, Toasts = null;
try { H = await import('../src/utils/headwinds.js'); } catch (e) { console.log(`  ✗ src/utils/headwinds.js does not load: ${e.message.split('\n')[0]}`); failed++; }
App = await import('../src/App.jsx');
Toasts = await import('../src/components/ToastSystem.jsx');

console.log('\n── 1. The end screens pitch Headwinds ──────────────────');
const stats = { marketCap: 9e9, cash: 1e9, fleetCount: 120, routeCount: 300, airports: 80, year: 14, lastRival: 'Rhine Air' };
await test('victory screen links to Headwinds worlds, tagged victory', () => {
  assert.equal(typeof App.VictoryOverlay, 'function', 'VictoryOverlay is not exported from App.jsx');
  const html = render(React.createElement(App.VictoryOverlay, { stats, airlineName: 'Test Air', onContinue() {}, onNewGame() {} }));
  assert.match(html, /href="https:\/\/www\.headwindsairlinegame\.com\/worlds\?utm_source=tailwinds&utm_medium=game&utm_campaign=victory"/);
  assert.match(html, /target="_blank"/);
  assert.match(html, /rel="noopener[^"]*"/);
  assert.match(html, /real person/i);
});
await test('final-call screen links to Headwinds worlds, tagged final-call', () => {
  assert.equal(typeof App.FinalCallOverlay, 'function', 'FinalCallOverlay is not exported from App.jsx');
  const html = render(React.createElement(App.FinalCallOverlay, { stats: { ...stats, rank: 3, fieldSize: 6, rivals: [] }, airlineName: 'Test Air', onReview() {}, onNewGame() {} }));
  assert.match(html, /utm_campaign=final-call"/);
  assert.match(html, /Fly It Again/, 'existing buttons still render');
});

console.log('\n── 2. First buyout: one toast, once per browser ────────');
await test('first buyout of a non-final rival raises a toast with a tagged link', () => {
  assert.ok(H, 'helpers missing');
  const s = mem();
  const t = H.buyoutNudgeToast({ rivalsBefore: 5, storage: s });
  assert.ok(t, 'expected a toast');
  assert.equal(t.type, 'info');
  assert.match(t.link?.href ?? '', /utm_campaign=first-buyout$/);
  assert.ok(t.link?.label);
  assert.equal(H.buyoutNudgeToast({ rivalsBefore: 4, storage: s }), null, 'second buyout must not nag');
});
await test('the buyout that wins the game leaves the pitch to the victory screen', () => {
  assert.ok(H, 'helpers missing');
  const s = mem();
  assert.equal(H.buyoutNudgeToast({ rivalsBefore: 1, storage: s }), null);
  assert.ok(H.buyoutNudgeToast({ rivalsBefore: 3, storage: s }), 'and does not burn the one-time nudge');
});
await test('blocked storage: no toast, no crash (never nag on every buyout)', () => {
  assert.ok(H, 'helpers missing');
  const throwing = { getItem() { throw new Error('x'); }, setItem() { throw new Error('x'); } };
  assert.equal(H.buyoutNudgeToast({ rivalsBefore: 5, storage: throwing }), null);
  assert.equal(H.buyoutNudgeToast({ rivalsBefore: 5, storage: null }), null);
});
await test('Competition raises it right after confirming an acquisition', () => {
  const src = readFileSync(new URL('../src/components/Competition.jsx', import.meta.url), 'utf8');
  const confirm = src.slice(src.indexOf('<AcquisitionModal'), src.indexOf('onCancel={() => setAcquireTarget(null)}'));
  assert.match(confirm, /ACQUIRE_COMPETITOR[\s\S]*buyoutNudgeToast\(/, 'onConfirm does not call buyoutNudgeToast after the acquisition');
  assert.match(confirm, /PUSH_TOAST/);
});

console.log('\n── 3. Toasts can carry a link ──────────────────────────');
await test('a toast with link renders an external anchor', () => {
  assert.equal(typeof Toasts.Toast, 'function', 'Toast is not exported from ToastSystem.jsx');
  const html = render(React.createElement(Toasts.Toast, { toast: { type: 'info', title: 'T', message: 'M', link: { href: 'https://example.com/x', label: 'Go →' } }, onDismiss() {} }));
  assert.match(html, /<a [^>]*href="https:\/\/example\.com\/x"[^>]*>Go →<\/a>/);
  assert.match(html, /target="_blank"/);
});
await test('a toast without link is unchanged (no stray anchor)', () => {
  assert.equal(typeof Toasts.Toast, 'function', 'Toast is not exported from ToastSystem.jsx');
  const html = render(React.createElement(Toasts.Toast, { toast: { type: 'success', title: 'Acquired X', message: '+3 routes' }, onDismiss() {} }));
  assert.ok(!html.includes('<a '));
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
