// Charter contracts on the network map.
//
//   TheCookiesGuy  "Would be cool if charter contracts showed up on the map as a
//                   different color (yellow maybe?)"   (Discord, 13 Sep 2026)
//
// A charter is NOT a route record — deliberately. charterOpRecord() feeds block
// hours and slot counts, but a contract never enters state.routes or
// state.cargoRoutes, because everything in those arrays is treated as a market
// participant by demand pooling, pair-share and encroachment (docs/charter-design
// §4, option 1). The map draws from those two arrays, so the same decision that
// keeps charters out of the market keeps them off the map: the contracts need
// their own layer, derived from state.charters, or they are invisible.
//
// The Leaflet layers themselves cannot be asserted here — renderToString runs no
// effects, so no polyline is ever constructed. What CAN be asserted is the pure
// derivation the layer effect consumes (charterMapEntries), the airport set the
// viewport is framed on, and the chrome the component renders around them. Same
// split the rest of this map's suites use.
//
//   node --import ./tools/_register-loader.mjs tools/charter-map-test.mjs

import assert from 'node:assert/strict';
import React from 'react';
import { renderToString } from 'react-dom/server';
import { AIRCRAFT_TYPES } from '../src/data/aircraft.js';
import { getAirport } from '../src/data/airports.js';

// Minimal browser shims for SSR (effects don't run; init reads localStorage).
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
const RouteMapMod = await import('../src/components/RouteMap.jsx');
const RouteMap = RouteMapMod.default;
const { charterMapEntries, mapAirportCodes, CHARTER_COLOR } = RouteMapMod;

// ── Fixture ───────────────────────────────────────────────────────────────────
// One scheduled route out of the hub, and four contracts: one running, one still
// ferrying out to its pickup, one finished and one breached. Only the first two
// are flying anything this week, so only those two belong on a map.

const jet = AIRCRAFT_TYPES
  .filter(t => !t.freighter && t.seats >= 140 && t.seats <= 240)
  .sort((a, b) => b.range - a.range)[0];
assert.ok(jet, 'fixture needs a narrowbody');

const HUB = 'SFO', SPOKE = 'DEN';
const CHARTER_A = 'LAX', CHARTER_B = 'JFK';   // running contract's O&D
const FERRY_FROM = 'ORD', CHARTER_C = 'MIA', CHARTER_D = 'DFW';  // positioning contract
for (const c of [HUB, SPOKE, CHARTER_A, CHARTER_B, FERRY_FROM, CHARTER_C, CHARTER_D]) {
  assert.ok(getAirport(c), `${c} missing from the airport data`);
}

const tail = (id, extra = {}) => ({
  id, typeId: jet.id, name: id, tailNumber: `N${id}`,
  status: 'assigned', ageWeeks: 52, ownershipType: 'owned',
  config: { economy: jet.seats }, ...extra,
});

const contract = (id, origin, destination, status, extra = {}) => ({
  id,
  charter: true,
  offerId: `offer-${id}`,
  templateId: 'adhoc_pax',
  type: 'adhoc_pax',
  name: 'Charter series',
  customer: 'Test Tours',
  origin,
  destination,
  stops: [origin, destination],
  aircraftId: `ac-${id}`,
  weeklyFrequency: 4,
  distanceKm: 3000,
  fee: 4_000_000,
  feePerWeek: 500_000,
  weeksTotal: 8,
  weeksRemaining: 5,
  startWeek: 20,
  positioningWeeksRemaining: 0,
  positionFrom: null,
  ferryCost: 0,
  ferryKm: 0,
  status,
  breachPenalty: 1_000_000,
  ...extra,
});

const charters = [
  contract('run', CHARTER_A, CHARTER_B, 'active'),
  contract('pos', CHARTER_C, CHARTER_D, 'positioning', {
    positioningWeeksRemaining: 1, positionFrom: FERRY_FROM, ferryKm: 2800, ferryCost: 180_000,
  }),
  contract('done', CHARTER_A, SPOKE, 'complete', { weeksRemaining: 0 }),
  contract('gone', CHARTER_B, SPOKE, 'breached', { weeksRemaining: 3 }),
];

const baseSave = {
  ...freshState(),
  phase: 'playing', week: 20, year: 2, hub: HUB, cash: 50_000_000,
  hubs: { [HUB]: { tier: 2, tierSince: 1 } },
  gates: { [HUB]: 10, [SPOKE]: 8 },
  fleet: [
    tail('ac-line'),
    tail('ac-run'), tail('ac-pos'), tail('ac-done'), tail('ac-gone'),
  ],
  routes: [{
    id: 'r1', origin: HUB, destination: SPOKE, aircraftId: 'ac-line',
    weeklyFrequency: 7, weeksOpen: 30, hub: HUB, ticketPrice: 220, cateringLevel: 'full',
  }],
  cargoRoutes: [],
  charters,
  charterReliability: 50,
};

const render = (save) => {
  store.set('bbae_save_v2', JSON.stringify(save));
  return renderToString(React.createElement(GameProvider, null,
    React.createElement(RouteMap))).replaceAll('<!-- -->', '');
};

console.log('\nCharter contracts on the network map\n');

console.log('── 0. The map can derive contracts at all ───────────────');

test('RouteMap exports the charter derivation and a colour of its own', () => {
  assert.equal(typeof charterMapEntries, 'function',
    'charterMapEntries is the seam the layer effect and this suite share');
  assert.ok(typeof CHARTER_COLOR === 'string' && /^#[0-9a-f]{6}$/i.test(CHARTER_COLOR),
    'charters need their own stroke colour');
});

console.log('\n── 1. Which contracts get drawn ─────────────────────────');

test('a running contract is drawn', () => {
  const keys = charterMapEntries(charters).map(e => e.c.id);
  assert.ok(keys.includes('run'), `expected the active contract, got [${keys}]`);
});

test('a contract still ferrying out to its pickup is drawn too', () => {
  // It is committed, it is costing block hours this week, and where the tail is
  // coming FROM is the most useful thing the map can say about it.
  const keys = charterMapEntries(charters).map(e => e.c.id);
  assert.ok(keys.includes('pos'), `expected the positioning contract, got [${keys}]`);
});

test('finished and breached contracts are not', () => {
  const keys = charterMapEntries(charters).map(e => e.c.id);
  assert.ok(!keys.includes('done'), 'a completed contract is history, not a line on the map');
  assert.ok(!keys.includes('gone'), 'a breached contract is not being flown');
});

test('each entry resolves both endpoints', () => {
  for (const e of charterMapEntries(charters)) {
    assert.ok(e.origin?.code && e.dest?.code, `${e.c.id} resolved its airports`);
    assert.equal(e.origin.code, e.c.origin);
    assert.equal(e.dest.code, e.c.destination);
  }
});

test('a contract whose airports are not in the data is dropped, not drawn half', () => {
  const bogus = [contract('bad', 'ZZZ', CHARTER_B, 'active')];
  assert.equal(charterMapEntries(bogus).length, 0);
});

console.log('\n── 2. The empty leg ─────────────────────────────────────');

test('a positioning contract carries its ferry origin', () => {
  const pos = charterMapEntries(charters).find(e => e.c.id === 'pos');
  assert.ok(pos.ferry, 'the empty leg is what a positioning contract is doing this week');
  assert.equal(pos.ferry.code, FERRY_FROM);
});

test('a contract already in place has no ferry leg to draw', () => {
  const run = charterMapEntries(charters).find(e => e.c.id === 'run');
  assert.equal(run.ferry, null, 'nothing is being ferried, so nothing should be drawn');
});

console.log('\n── 3. The map frames and labels them ────────────────────');

test('charter airports join the set the viewport is fitted to', () => {
  const entries = charterMapEntries(charters);
  const codes = mapAirportCodes([HUB], [], entries);
  for (const c of [CHARTER_A, CHARTER_B, CHARTER_C, CHARTER_D]) {
    assert.ok(codes.includes(c),
      `${c} is an endpoint of a live contract — the map should frame it`);
  }
});

test('the legend offers a charter toggle when contracts are running', () => {
  const html = render(baseSave);
  assert.ok(html.includes('Charters'),
    'no charter entry in the map legend — the yellow lines would be unexplained');
});

test('no charter toggle when the airline has no contracts', () => {
  const html = render({ ...baseSave, charters: [] });
  assert.ok(!html.includes('Charters'),
    'the legend should not carry a toggle for something that cannot be on the map');
});

console.log('\n── 4. A charter-only airline still gets a map ───────────');

test('contracts alone are enough to draw', () => {
  // A carrier can hold a contract before it opens a single scheduled route —
  // the empty state used to check routes and cargo only, so that airline was
  // told it had nothing to show while flying a 12-week series.
  const html = render({ ...baseSave, routes: [] });
  assert.ok(!html.includes('No routes yet'),
    'an airline flying a charter is not an airline with an empty map');
});

console.log(`\n${'─'.repeat(56)}`);
console.log(`  ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
