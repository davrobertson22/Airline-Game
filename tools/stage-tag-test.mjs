// Beta stage-tag test — no browser, no network.
//
// Tailwinds is in open beta and the top bar says so. This is the solo sibling of
// Headwinds' tools/world-stage-tag-test.mjs, which also covers the per-world
// ALPHA override (multiplayer only — there are no worlds here).
//
//   node --import ./tools/_register-loader.mjs tools/stage-tag-test.mjs

import assert from 'node:assert/strict';
import React from 'react';
import { renderToString } from 'react-dom/server';

// SSR shims — App.jsx and the store touch these at import time.
const store = new Map();
globalThis.window = globalThis.window ?? {};
globalThis.localStorage = globalThis.localStorage ?? {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
  clear: () => store.clear(),
};

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.log(`  ✗ ${name}\n      ${(e.stack || e.message).split('\n').slice(0, 3).join('\n      ')}`); failed++; }
}

console.log('\n── Top-bar stage tag ────────────────────────────────────');

const { StageTag } = await import('../src/App.jsx');

test('App.jsx exports the tag', () => {
  assert.equal(typeof StageTag, 'function');
});

test('it renders Beta by default', () => {
  const html = renderToString(React.createElement(StageTag));
  assert.match(html, />Beta</);
  assert.ok(!/Alpha/.test(html), 'solo has no alpha worlds');
});

test('it carries a title explaining what beta means', () => {
  const html = renderToString(React.createElement(StageTag));
  assert.match(html, /Open beta/);
});

test('an unknown stage still falls back to Beta', () => {
  const html = renderToString(React.createElement(StageTag, { stage: 'gamma' }));
  assert.match(html, />Beta</);
});

console.log(`\n  ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
