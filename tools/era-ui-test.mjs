// era-ui-test.mjs — Era mode (Tailwinds port): the screens render era state.
// SSR smoke through the real GameProvider: the marketplace locks types that
// haven't flown, the setup wizard offers the era picker, the era-gated
// buttons read as such — and a classic save renders exactly as it did.
//
//   node --import ./tools/_register-loader.mjs tools/era-ui-test.mjs
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

const { GameProvider, freshState } = await import('../src/store/GameContext.jsx');
const Marketplace     = (await import('../src/components/Marketplace.jsx')).default;
const SetupScreen     = (await import('../src/components/SetupScreen.jsx')).default;
const BoardObjectives = (await import('../src/components/BoardObjectives.jsx')).default;
const Ancillaries     = (await import('../src/components/Ancillaries.jsx')).default;
const { AIRCRAFT_TYPES, eraPurchasePrice } = await import('../src/data/aircraft.js');
const { formatMoney } = await import('../src/utils/simulation.js');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.log(`  ✗ ${name}\n      ${(e.stack || e.message).split('\n').slice(0, 5).join('\n      ')}`); failed++; }
}
const clean = (html) => html.replace(/<!-- -->/g, '').replace(/&amp;/g, '&').replace(/&#x27;/g, "'").replace(/&quot;/g, '"');

function render(Component, save) {
  store.clear();
  store.set('bbae_save_v2', JSON.stringify(save));
  return clean(renderToString(React.createElement(GameProvider, null, React.createElement(Component))));
}
const base = (over = {}) => ({
  ...freshState(), phase: 'playing', week: 1, year: 1, cash: 40_000_000, hub: 'JFK', airlineName: 'Test',
  routes: [], cargoRoutes: [], competitors: [], fleet: [], pendingOrders: [], objectives: [{ id: 'revenue_500k', completed: false }],
  objectivesEnabled: true, ...over,
});

test('setup wizard offers the era picker', () => {
  store.clear();
  const html = clean(renderToString(React.createElement(GameProvider, null, React.createElement(SetupScreen))));
  assert.match(html, /Classic/);
  assert.match(html, /1950 · Piston age/);
  assert.match(html, /1978 · Deregulation/);
  assert.match(html, /Custom year/);
});

test('marketplace in 1950 shows the propliners and locks the 707', () => {
  const html = render(Marketplace, base({ startYear: 1950 }));
  assert.match(html, /DC-3|DC-4|Stratocruiser|Constellation/);
  assert.doesNotMatch(html, /A320neo|787-9|747-400/, 'modern types are not even listed');
  const html1959 = render(Marketplace, base({ startYear: 1957, year: 3 }));   // calendar 1959
  assert.match(html1959, /707/);
  assert.match(html1959, /Enters service 196\d|In service 196\d/, 'the DC-8/Convair 880 generation shows as locked, not absent');
});

test('a type previewed ahead of its entry into service wears a badge on the card and the C-47 is on sale', () => {
  store.set('market_layout', 'cards');
  const html = render(Marketplace, base({ startYear: 1950 }));
  assert.match(html, /Not yet in service · 1953/, 'the Viscount card in 1950 does not say it is not yet in service');
  assert.match(html, /C-47 Skytrain/);
  assert.doesNotMatch(html.slice(html.indexOf('Convair CV-240'), html.indexOf('Convair CV-240') + 6000), /16 years old/,
    'the CV-240 is in production in 1950 and must not quote its 2026 second-hand age');
  const cvCard = html.slice(html.indexOf('Convair CV-240'), html.indexOf('Convair CV-240') + 6000);
  const cv = AIRCRAFT_TYPES.find(t => t.id === 'cv240');
  assert.match(cvCard, new RegExp(formatMoney(eraPurchasePrice(cv, 1950)).replace(/[$.]/g, '\\$&')),
    'the CV-240 card in 1950 does not quote the era new-build price');
  store.delete('market_layout');
});

test('the 1950 market carries a freighter, the North Star, and a cruise-speed spec', () => {
  // Discord 2026-09-03 (CorporalSimmons). Two holes this closes: before the
  // C-46 the earliest freighter in the catalogue was the 1959 An-12, so cargo
  // did not exist in a 1950 world; and cruise speed drove block time while
  // appearing on no screen at all.
  store.set('market_layout', 'cards');
  const html = render(Marketplace, base({ startYear: 1950 }));
  assert.match(html, /C-46 Commando/, 'the 1950 market has no freighter at all without it');
  assert.match(html, /Canadair North Star/);
  assert.match(html, /Cruise/, 'the market card carries no cruise-speed pill');
  assert.match(html, /365 km\/h/, 'the DC-4 card does not quote its cruise speed');
  assert.match(html, /Not yet in service · 1951/, 'the 1049 is a year out and shows on the card as a preview');
  const in1951 = render(Marketplace, base({ startYear: 1951 }));
  assert.match(in1951, /Lockheed L-1049 Super Constellation/);
  store.delete('market_layout');
});

test('marketplace in a classic game is the full catalogue with no locks', () => {
  const html = render(Marketplace, base());
  assert.match(html, /A320neo/);
  assert.match(html, /DC-3/, 'propliners are part of the classic catalogue too');
  assert.doesNotMatch(html, /Enters service|In service \d{4}|No airworthy frames/);
});

test('board objectives print the era-scaled target', () => {
  const era = render(BoardObjectives, base({ startYear: 1950 }));
  assert.match(era, /Generate \$4\dK in a single week/, 'a 1950 revenue target is ~8% of the modern one');
  const classic = render(BoardObjectives, base());
  assert.match(classic, /Generate \$500K in a single week/);
});

test('ancillaries are “not yet” before 2008 and activatable after', () => {
  const early = render(Ancillaries, base({ startYear: 1950, year: 41 }));   // 1990
  assert.match(early, /Not in this era yet|do not exist yet|don.t exist yet|arrives around 2008|2008/);
  assert.doesNotMatch(early, /Activate recommended pricing/);
  const late = render(Ancillaries, base({ startYear: 1950, year: 61 }));    // 2010
  assert.match(late, /Activate recommended pricing/);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
