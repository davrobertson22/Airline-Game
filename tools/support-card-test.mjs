// Render smoke test for the Ko-fi support card (solo game).
//
//   node --import ./tools/_register-loader.mjs tools/support-card-test.mjs
//
// This component is the money path and it is easy to get subtly wrong: it
// touches localStorage (which throws in private windows), and it must not
// promise the badge, which a game with no accounts cannot deliver, nor an
// ad-free game, which neither game offers — the ads help pay for both. Headwinds has its own twin of this file covering the
// multiplayer card — it lives there rather than here because importing it
// across repos loads a second copy of React and every hook call fails.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import React from 'react';
import { renderToString } from 'react-dom/server';

// SSR shims. `store` is swapped per-test to simulate a fresh browser, a browser
// that has dismissed the card, and one where localStorage throws outright.
let store = new Map();
let throwOnStorage = false;
globalThis.window = globalThis.window ?? {};
const storage = {
  getItem: (k) => { if (throwOnStorage) throw new Error('SecurityError'); return store.has(k) ? store.get(k) : null; },
  setItem: (k, v) => { if (throwOnStorage) throw new Error('SecurityError'); store.set(k, String(v)); },
  removeItem: (k) => store.delete(k),
  clear: () => store.clear(),
};
globalThis.localStorage = storage;
globalThis.window.localStorage = storage;

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.error(`  ✗ ${name}\n    ${e.message}`); failed++; }
}

const KOFI = 'https://ko-fi.com/E2V226S4CD';

console.log('\n── Tailwinds (solo) ──────────────────────────────────────');
const TwSupportCard = (await import('../src/components/SupportCard.jsx')).default;

test('renders, and points at the Ko-fi page', () => {
  store = new Map(); throwOnStorage = false;
  const html = renderToString(React.createElement(TwSupportCard));
  assert.ok(html.includes(KOFI), 'Ko-fi link missing');
  assert.ok(html.includes('/support.html'), 'support page link missing');
});

test('promises nothing it cannot deliver (no badge, no ad-free game)', () => {
  store = new Map(); throwOnStorage = false;
  const html = renderToString(React.createElement(TwSupportCard));
  assert.ok(!/SUPPORTER badge/i.test(html), 'solo game must not promise a badge — it has no accounts');
  assert.ok(!/no ads/i.test(html), 'nobody gets an ad-free game — the ads help pay for this');
});

test('stays hidden once dismissed', () => {
  store = new Map([['tw.support.dismissedAt', String(Date.now())]]); throwOnStorage = false;
  assert.equal(renderToString(React.createElement(TwSupportCard)), '');
});

test('a 30-day-old dismissal has expired', () => {
  store = new Map([['tw.support.dismissedAt', String(Date.now() - 31 * 24 * 3600 * 1000)]]);
  throwOnStorage = false;
  assert.ok(renderToString(React.createElement(TwSupportCard)).includes(KOFI));
});

test('renders when localStorage throws (private window)', () => {
  store = new Map(); throwOnStorage = true;
  assert.ok(renderToString(React.createElement(TwSupportCard)).includes(KOFI));
  throwOnStorage = false;
});

// The support PAGE has to keep the same promise the card does. An ad-free perk
// was offered and withdrawn before launch, so the risk is a leftover line that
// still promises it — a page saying "no ads" is a promise the game does not keep.
test('the support page does not promise an ad-free game either', () => {
  const html = readFileSync(new URL('../public/support.html', import.meta.url), 'utf8');
  assert.ok(!/no ads\b|ad-free|ads are off|ads switch off|without ads/i.test(html),
    'public/support.html still promises an ad-free game somewhere');
});

console.log(`\n${failed ? 'FAIL' : 'PASS'} — ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
