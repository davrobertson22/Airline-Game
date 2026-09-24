// era-lease-age-test.mjs — era lessors only carry a type 10+ years after EIS.
//
// Dave, 2026-09-24 (ported from Headwinds): a plane has to be 10+ years past
// EIS to be leased. Era games only — classic keeps its vintage rule. War-surplus
// types (`surplus: true` — C-46, C-47, DC-4) are exempt.
//
// HEAD failure proof: on HEAD leaseDenial returns null for everything in an era
// game, so a 1950 airline leases the brand-new CV-240 (eis 1948).
//
//   node --import ./tools/_register-loader.mjs tools/era-lease-age-test.mjs
import assert from 'node:assert/strict';
import React from 'react';
import { renderToString } from 'react-dom/server';

const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
  clear: () => store.clear(),
};
globalThis.window ??= { localStorage: globalThis.localStorage, addEventListener() {}, removeEventListener() {}, matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }), innerWidth: 1200 };
if (!globalThis.window.localStorage) globalThis.window.localStorage = globalThis.localStorage;
globalThis.window.matchMedia ??= () => ({ matches: false, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
globalThis.window.innerWidth ??= 1200;

const { GameProvider, freshState, gameReducer, leaseDenial } = await import('../src/store/GameContext.jsx');
const Marketplace = (await import('../src/components/Marketplace.jsx')).default;

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.log(`  ✗ ${name}\n      ${(e.stack || e.message).split('\n').slice(0, 5).join('\n      ')}`); failed++; }
}
const clean = (html) => html.replace(/<!-- -->/g, '').replace(/&amp;/g, '&').replace(/&#x27;/g, "'").replace(/&quot;/g, '"');
const base = (over = {}) => ({
  ...freshState(), phase: 'playing', week: 1, year: 1, cash: 40_000_000, hub: 'JFK', airlineName: 'Test',
  routes: [], cargoRoutes: [], competitors: [], fleet: [], pendingOrders: [], ...over,
});
const at = (calYear) => base({ startYear: 1950, year: calYear - 1949 });

test('an era lessor refuses a type until 10 years after EIS, naming the year', () => {
  const d = leaseDenial(at(1950), 'cv240');
  assert.equal(d?.code, 'lessor_age', 'CV-240 (1948) leasable in 1950');
  assert.match(d.message, /1958/);
  assert.ok(leaseDenial(at(1957), 'cv240'), 'CV-240 leasable a year early');
  assert.equal(leaseDenial(at(1958), 'cv240'), null, 'CV-240 refused at EIS+10');
  assert.ok(leaseDenial(at(1967), 'b707120'), '707 leasable in 1967');
  assert.equal(leaseDenial(at(1968), 'b707120'), null, '707 refused in 1968');
  assert.equal(leaseDenial(at(1950), 'dc3'), null, 'DC-3 (1936) refused in 1950');
});

test('war-surplus types lease from day one', () => {
  for (const id of ['c47', 'dc4', 'c46']) assert.equal(leaseDenial(at(1950), id), null, `${id} refused in 1950`);
});

test('classic games are unchanged', () => {
  const classic = base({ startYear: null });
  assert.equal(leaseDenial(classic, 'a320ceo'), null);
  assert.equal(leaseDenial(classic, 'a320neo'), null);
  assert.equal(leaseDenial(classic, 'dc4')?.code, 'vintage');
});

test('the reducer refuses the lease (LEASE_AIRCRAFT and ORDER as lease)', () => {
  const s = at(1950);
  assert.equal(gameReducer(s, { type: 'LEASE_AIRCRAFT', typeId: 'cv240' }), s, 'LEASE_AIRCRAFT went through');
  assert.equal(gameReducer(s, { type: 'ORDER_AIRCRAFT', typeId: 'cv240', ownershipType: 'lease', quantity: 1 }), s, 'lease ORDER went through');
  assert.notEqual(gameReducer(s, { type: 'LEASE_AIRCRAFT', typeId: 'c47' }), s, 'surplus C-47 lease refused');
});

test('the Marketplace shows the same block (SSR, 1950)', () => {
  store.clear();
  store.set('bbae_save_v2', JSON.stringify(at(1950)));
  store.set('market_layout', 'table');
  const html = clean(renderToString(React.createElement(GameProvider, null, React.createElement(Marketplace))));
  const row = (name) => { const i = html.indexOf(name); assert.notEqual(i, -1, `${name} never rendered`); return html.slice(i, html.indexOf('</tr>', i)); };
  assert.match(row('Convair CV-240'), /Lessors take it from 1958/, 'CV-240 row lacks the lease year');
  assert.doesNotMatch(row('Douglas C-47'), /Lessors take it from/, 'surplus C-47 blocked');
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
