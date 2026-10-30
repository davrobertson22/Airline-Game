// The route row's fare editor shows every cabin sold on the PAIR, not just the
// cabins of the aircraft whose row is open — SSR of the real PricingPanel.
//
// Fares belong to the O&D pair (state.routePricing). On a pair flown by a
// narrow-body without First and a wide-body with it, the narrow-body's row
// showed only its own cabins, so First could not be seen or set from it. In
// Headwinds this left a fare-cliff warning naming "IST-LHR (First)" with no
// First fare in sight (Discord, Dunno23 2026-10-19); ported here because the
// pricing panel is shared.
//
//   node --import ./tools/_register-loader.mjs tools/pair-cabins-pricing-test.mjs
import assert from 'node:assert/strict';
import React from 'react';
import { renderToString } from 'react-dom/server';
import { AIRCRAFT_TYPES } from '../src/data/aircraft.js';
import { routePairKey, defaultClassPrices, referencePrice } from '../src/utils/simulation.js';

const store = new Map();
globalThis.window = globalThis.window ?? {};
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
  clear: () => store.clear(),
};

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.log(`  ✗ ${name}\n      ${(e.stack || e.message).split('\n').slice(0, 4).join('\n      ')}`); failed++; }
}

const { GameProvider, freshState } = await import('../src/store/GameContext.jsx');
const { PricingPanel } = await import('../src/components/Routes.jsx');

const NARROW = AIRCRAFT_TYPES.find(t => !t.freighter && t.category === 'Narrow Body' && (t.range ?? 0) > 3000);
const WIDE   = AIRCRAFT_TYPES.find(t => !t.freighter && t.category === 'Wide Body' && (t.range ?? 0) > 8000);
const CODES = ['IST', 'LHR', 'FRA'];

function save() {
  return {
    ...freshState(),
    phase: 'playing', week: 20, year: 4, hub: 'IST', cash: 400_000_000,
    gates: Object.fromEntries(CODES.map(c => [c, 40])),
    hubs: { IST: { tier: 2 } },
    fleet: [
      { id: 'nb', typeId: NARROW.id, name: 'Narrow', status: 'assigned', ageWeeks: 50, ownershipType: 'owned',
        config: { businessClass: 12, premiumEconomy: 24, economy: 90 } },
      { id: 'wb', typeId: WIDE.id, name: 'Wide', status: 'assigned', ageWeeks: 50, ownershipType: 'owned',
        config: { firstClass: 8, businessClass: 30, economy: 200 } },
      { id: 'nb2', typeId: NARROW.id, name: 'Narrow 2', status: 'assigned', ageWeeks: 50, ownershipType: 'owned',
        config: { economy: 150 } },
    ],
    routes: [
      { id: 'r1', origin: 'IST', destination: 'LHR', stops: ['IST', 'LHR'], aircraftId: 'nb', weeklyFrequency: 7, weeksOpen: 30, hub: 'IST', season: null, seasonState: 'active' },
      { id: 'r2', origin: 'IST', destination: 'LHR', stops: ['IST', 'LHR'], aircraftId: 'wb', weeklyFrequency: 3, weeksOpen: 30, hub: 'IST', season: null, seasonState: 'active' },
      { id: 'r3', origin: 'IST', destination: 'FRA', stops: ['IST', 'FRA'], aircraftId: 'nb2', weeklyFrequency: 7, weeksOpen: 30, hub: 'IST', season: null, seasonState: 'active' },
    ],
    routePricing: {
      [routePairKey('IST', 'LHR')]: defaultClassPrices(referencePrice('IST', 'LHR')),
      [routePairKey('IST', 'FRA')]: defaultClassPrices(referencePrice('IST', 'FRA')),
    },
    cargoRoutes: [],
  };
}
const renderPanel = (s, routeId) => {
  store.set('bbae_save_v2', JSON.stringify(s));
  const route = { ...s.routes.find(r => r.id === routeId) };
  route.classPrices = s.routePricing[routePairKey(route.origin, route.destination)];
  const aircraft = s.fleet.find(a => a.id === route.aircraftId);
  const el = React.createElement(PricingPanel, { route, aircraft, type: AIRCRAFT_TYPES.find(t => t.id === aircraft.typeId) });
  return renderToString(React.createElement(GameProvider, null, el)).replace(/<!-- -->/g, '');
};

test('the narrow-body row shows First, labelled as another aircraft\'s cabin', () => {
  const html = renderPanel(save(), 'r1');
  assert.match(html, />First/);
  assert.match(html, /\(other aircraft\)/);
});
test('its own cabins keep their seat counts', () => {
  const html = renderPanel(save(), 'r1');
  assert.match(html, /\(12 seats\)/);
  assert.match(html, /\(90 seats\)/);
});
test('the wide-body row shows Prem Eco from the narrow-body, and its own First with seats', () => {
  const html = renderPanel(save(), 'r2');
  assert.match(html, /\(8 seats\)/);
  assert.match(html, /Premium Eco[\s\S]{0,400}\(other aircraft\)/);
});
test('a pair flown by one aircraft shows only its own cabins', () => {
  const html = renderPanel(save(), 'r3');
  assert.doesNotMatch(html, /other aircraft/);
  assert.doesNotMatch(html, />First/);
});

console.log(`\n  ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
