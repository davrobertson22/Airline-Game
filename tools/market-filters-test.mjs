// Fleet → Market "Show only" filters: in production, dated designs, leasable.
//
// Discord, 2026-10-12 (VodkaOnFire): "in fleet -> market, I'd like to be able
// to filter out any aircraft that are no longer in production and/or
// separately any aircraft that is now aging. The list gets a bit wild when you
// get 20 years in to a save. ... some people might appreciate being able to
// filter based on whether aircraft can be leased or not?"
//
// The contract: each chip hides exactly the types the rest of the market
// already treats that way — second-hand only, "Dated design" badge, Lease
// button disabled — so a chip can never disagree with the card it hides.
//
//   node --import ./tools/_register-loader.mjs tools/market-filters-test.mjs

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

const { GameProvider, freshState } = await import('../src/store/GameContext.jsx');
const Marketplace = (await import('../src/components/Marketplace.jsx')).default;
const { AIRCRAFT_TYPES, aircraftAvailability, isVintage } = await import('../src/data/aircraft.js');
const { designAgeQualityPts } = await import('../src/models/demand.js');
const {
  isOutOfProduction, isDatedDesign, marketLeaseLockReason, passesMarketFilters, DEFAULT_MARKET_FILTERS,
} = await import('../src/utils/marketFilters.js');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.log(`  ✗ ${name}\n      ${(e.stack || e.message).split('\n').slice(0, 5).join('\n      ')}`); failed++; }
}
function section(t) { console.log(`\n── ${t} ${'─'.repeat(Math.max(0, 62 - t.length))}`); }
const clean = (html) => html.replace(/<!-- -->/g, '').replace(/&amp;/g, '&').replace(/&#x27;/g, "'").replace(/&quot;/g, '"');
const get = (id) => AIRCRAFT_TYPES.find(t => t.id === id);

const FIXED_RIVAL = { id: 'fixed', name: 'Fixed Air', homeHub: 'ORD', tier: 'legacy', cash: 1e8, routes: {}, fleet: [{ id: 'fx-t1', typeId: 'a320neo', routeKey: 'ORD-DEN' }] };
const base = (over = {}) => ({
  ...freshState(), phase: 'playing', week: 1, year: 1, cash: 40_000_000, hub: 'JFK', airlineName: 'Test',
  // One fixed rival: the market shows every rival's fleet (World fleet), and a
  // save with NO rivals is given a randomly sampled roster on load, which would
  // make two renders of the same save differ.
  routes: [], cargoRoutes: [], competitors: [FIXED_RIVAL], fleet: [], pendingOrders: [], objectives: [],
  objectivesEnabled: false, ...over,
});
function render(save, filters = null, layout = 'table') {
  store.clear();
  store.set('bbae_save_v2', JSON.stringify(save));
  store.set('market_layout', layout);
  if (filters) store.set('market_filters', JSON.stringify(filters));
  return clean(renderToString(React.createElement(GameProvider, null, React.createElement(Marketplace))));
}

console.log('\nFleet → Market show-only filters\n');

section('1. The rules agree with the rest of the market');

test('out of production = the line has closed, in both era and classic worlds', () => {
  for (const t of AIRCRAFT_TYPES) {
    for (const y of [1960, 1990, 2010]) {
      const av = aircraftAvailability(t, y);
      if (av === 'used')   assert.ok(isOutOfProduction(t, y), `${t.name} sells used in ${y} but passes "in production"`);
      if (av === 'new' && t.oop != null) assert.ok(!isOutOfProduction(t, y), `${t.name} is new-build in ${y} but is hidden`);
    }
  }
  assert.ok(isOutOfProduction(get('a320ceo'), null), 'A320ceo line closed 2021 — out of production in a 2026 classic world');
  assert.ok(!isOutOfProduction(get('a320neo'), null), 'the A320neo is still being built');
});

test('dated design = the same score as the "Dated design" badge, era worlds only', () => {
  for (const t of AIRCRAFT_TYPES) {
    assert.equal(isDatedDesign(t, 1995), designAgeQualityPts(t, 1995) < 0, t.name);
    assert.equal(isDatedDesign(t, null), false, `${t.name}: classic designs never date`);
  }
  assert.ok(isDatedDesign(get('b727200'), 1990), 'a 1967 design is dated by 1990');
  assert.ok(!isDatedDesign(get('a320ceo'), 1990), 'a 1988 design is not');
  assert.ok(!isDatedDesign(get('concorde'), 2010), 'Supersonic is exempt, as in the quality score');
});

test('leasable = the Lease button is enabled', () => {
  assert.ok(!marketLeaseLockReason(get('md80'), 1990), 'MD-80 (EIS 1980) is with lessors by 1990');
  assert.match(marketLeaseLockReason(get('a320ceo'), 1990) ?? '', /Lessors take it from 1998/);
  assert.match(marketLeaseLockReason(get('dc910'), null) ?? '', /No lessor stocks it/);
  assert.ok(isVintage(get('dc910')));
});

test('with no chips on, nothing is hidden', () => {
  for (const t of AIRCRAFT_TYPES) {
    for (const y of [null, 1955, 1990, 2020]) assert.ok(passesMarketFilters(t, y, DEFAULT_MARKET_FILTERS), `${t.name} @ ${y}`);
  }
});

section('2. The screen');

test('classic: no dated-design chip (nothing ever dates there)', () => {
  const html = render(base());
  assert.match(html, /data-market-filter="inProduction"/);
  assert.match(html, /data-market-filter="leasable"/);
  assert.doesNotMatch(html, /data-market-filter="hideDated"/);
});

test('era: all three chips are offered', () => {
  const html = render(base({ startYear: 1990 }));
  assert.match(html, /data-market-filter="hideDated"/);
});

test('1990, no filters: the 727-200, DC-9-30, A320ceo and MD-80 are all listed', () => {
  const html = render(base({ startYear: 1990 }));
  for (const n of ['Boeing 727-200<', 'Douglas DC-9-30<', 'Airbus A320ceo<', 'McDonnell Douglas MD-80<']) {
    assert.ok(html.includes(n), `${n} missing before any filter is applied — the cases below would prove nothing`);
  }
});

test('1990, "In production": the 727-200 and DC-9-30 go, the A320ceo and MD-80 stay', () => {
  const html = render(base({ startYear: 1990 }), { inProduction: true });
  assert.ok(!html.includes('Boeing 727-200<'));
  assert.ok(!html.includes('Douglas DC-9-30<'));
  assert.ok(html.includes('Airbus A320ceo<'));
  assert.ok(html.includes('McDonnell Douglas MD-80<'));
  assert.match(html, /aria-pressed="true"[^>]*data-market-filter="inProduction"/);
});

test('1990, "Hide dated designs": the 727-200 goes, the MD-80 stays', () => {
  const html = render(base({ startYear: 1990 }), { hideDated: true });
  assert.ok(!html.includes('Boeing 727-200<'));
  assert.ok(html.includes('McDonnell Douglas MD-80<'));
});

test('1990, "Leasable now": the A320ceo (lessors from 1998) goes, the MD-80 stays', () => {
  const html = render(base({ startYear: 1990 }), { leasable: true });
  assert.ok(!html.includes('Airbus A320ceo<'));
  assert.ok(html.includes('McDonnell Douglas MD-80<'));
});

test('a remembered "Hide dated designs" hides nothing in a classic save', () => {
  const off = render(base());
  const on  = render(base(), { hideDated: true });
  assert.equal(on, off);
});

test('a corrupt remembered filter falls back to showing everything', () => {
  store.clear();
  const off = render(base());
  store.clear();
  store.set('bbae_save_v2', JSON.stringify(base()));
  store.set('market_layout', 'table');
  store.set('market_filters', '{not json');
  const html = clean(renderToString(React.createElement(GameProvider, null, React.createElement(Marketplace))));
  assert.equal(html, off);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
