// The map shows who else is flying.
//
// D7(d). The network map has always walked every competitor's live routes, and
//        then `continue`d on anyone who wasn't an alliance member or a codeshare
//        partner. So the twenty-five carriers actually competing for the
//        player's passengers were the one thing the map would not draw — while
//        it drew, in full, the networks of the airlines helping them.
//
//        Headwinds has no component to port here: its rival view is a server
//        payload. What Tailwinds needed was one `continue` relaxed, a colour by
//        carrier tier, and a decision about legibility — twenty-five carriers
//        add roughly 165 lines, so the field is drawn faint and the routes on
//        pairs the player actually flies are drawn solid on top of it.
//
//   node --import ./tools/_register-loader.mjs tools/rival-map-test.mjs

import assert from 'node:assert/strict';
import React from 'react';
import { renderToString } from 'react-dom/server';
import { referencePrice, routePairKey, defaultClassPrices, defaultConfig } from '../src/utils/simulation.js';
import { getAircraftType } from '../src/data/aircraft.js';

const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k), clear: () => store.clear(),
  key: (i) => [...store.keys()][i] ?? null, get length() { return store.size; },
};
globalThis.window ??= {
  localStorage: globalThis.localStorage,
  matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
};
if (!globalThis.window.localStorage) globalThis.window.localStorage = globalThis.localStorage;

const { GameProvider, freshState } = await import('../src/store/GameContext.jsx');
const RouteMap = (await import('../src/components/RouteMap.jsx')).default;

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.log(`  ✗ ${name}\n      ${(e.stack || e.message).split('\n').slice(0, 4).join('\n      ')}`); failed++; }
}
const realWarn = console.warn;
const quietly = (fn) => { console.warn = () => {}; try { return fn(); } finally { console.warn = realWarn; } };

const clean = (html) => html
  .replace(/<!-- -->/g, '')
  .replace(/&amp;/g, '&').replace(/&#x27;/g, "'").replace(/&quot;/g, '"');

const NARROW = getAircraftType('a320ceo');
const HUB = 'JFK';

const carrier = (id, tier, pairs) => ({
  id, name: `${id} Air`, tier, homeHub: pairs[0][0], baseQualityScore: 68,
  routes: Object.fromEntries(pairs.map(([o, d]) =>
    [routePairKey(o, d), { frequency: 14, priceMultiplier: 1, aircraftType: NARROW.id, tails: 1 }])),
});

const save = (over = {}) => ({
  ...freshState(),
  phase: 'playing', week: 20, year: 3, hub: HUB, cash: 5e7, airlineName: 'Map Air',
  gates: { [HUB]: 6, ORD: 2, MIA: 2 },
  fleet: [
    { id: 'a0', typeId: NARROW.id, tailNumber: 'N0', status: 'assigned', ageWeeks: 60,
      ownershipType: 'owned', config: defaultConfig(NARROW.seats) },
  ],
  routes: [
    { id: 'r0', origin: HUB, destination: 'ORD', aircraftId: 'a0', weeklyFrequency: 14,
      weeksOpen: 80, hub: HUB, ticketPrice: Math.round(referencePrice(HUB, 'ORD')), cateringLevel: 'standard' },
  ],
  cargoRoutes: [],
  routePricing: { [routePairKey(HUB, 'ORD')]: defaultClassPrices(Math.round(referencePrice(HUB, 'ORD'))) },
  competitors: [],
  allianceMembership: null,
  codeshareAgreements: [],
  ...over,
});

const render = (state) => {
  store.clear();
  store.set('bbae_save_v2', JSON.stringify(state));
  return clean(quietly(() => renderToString(
    React.createElement(GameProvider, null, React.createElement(RouteMap)))));
};

// ── The toggle ──────────────────────────────────────────────────────────────

console.log('\n── There is a way to see them ───────────────────────────');

test('a world with rivals offers a Rivals toggle', () => {
  const html = render(save({ competitors: [carrier('zoom', 'budget', [[HUB, 'ORD']])] }));
  assert.ok(html.includes('Rivals'), 'the legend should offer the overlay');
});

test('the overlay starts switched off', () => {
  // Twenty-five carriers put roughly 165 more lines on the map. The information
  // is worth having; it is not worth having by default.
  //
  // Note there is no "world with no rivals" to test against: reconcileState
  // re-seeds a 25-carrier bank whenever a save arrives with an empty one, so a
  // saved game always has a market. That is deliberate, and it is why this
  // asserts the default rather than the absence.
  const html = render(save({ competitors: [carrier('zoom', 'budget', [[HUB, 'ORD']])] }));
  const btn = html.slice(html.indexOf('Show every rival network') - 400,
                         html.indexOf('Show every rival network'));
  assert.ok(/opacity:0\.4/.test(btn.replace(/\s/g, '')),
    'the Rivals legend entry should render dimmed, i.e. off');
});

test('the toggle counts the pairs of yours somebody else flies', () => {
  // The number IS the reason to turn it on: it says how much of your own
  // network you are sharing.
  const html = render(save({ competitors: [
    carrier('zoom', 'budget', [[HUB, 'ORD']]),          // on your route
    carrier('apex', 'premium', [[HUB, 'ORD']]),         // also on your route
    carrier('far',  'legacy',  [['LHR', 'CDG']]),       // nowhere near you
  ] }));
  assert.ok(html.includes('Rivals (1)'),
    'one pair of yours is contested, however many carriers are on it');
});

test('rivals flying only elsewhere leave the count off', () => {
  const html = render(save({ competitors: [carrier('far', 'legacy', [['LHR', 'CDG']])] }));
  assert.ok(html.includes('Rivals'), 'still offered — the field is worth seeing');
  assert.ok(!html.includes('Rivals ('), 'but none of your own pairs is contested');
});

test('the count is pairs, not carriers, and not routes', () => {
  const state = save({
    routes: [
      { id: 'r0', origin: HUB, destination: 'ORD', aircraftId: 'a0', weeklyFrequency: 14,
        weeksOpen: 80, hub: HUB, ticketPrice: 300, cateringLevel: 'standard' },
      { id: 'r1', origin: HUB, destination: 'MIA', aircraftId: 'a0', weeklyFrequency: 7,
        weeksOpen: 80, hub: HUB, ticketPrice: 280, cateringLevel: 'standard' },
    ],
    competitors: [
      carrier('one', 'budget', [[HUB, 'ORD'], [HUB, 'MIA']]),
      carrier('two', 'legacy', [[HUB, 'ORD']]),
    ],
  });
  const html = render(state);
  assert.ok(html.includes('Rivals (2)'), 'two of your pairs are contested, by three rival routes');
});

// ── Partners keep their own treatment ───────────────────────────────────────

console.log('\n── A partner is not a rival ─────────────────────────────');

test('a codeshare partner is still a codeshare partner', () => {
  const html = render(save({
    competitors: [carrier('friend', 'legacy', [[HUB, 'ORD']])],
    codeshareAgreements: [{ id: 'cs1', competitorId: 'friend' }],
  }));
  assert.ok(html.includes('Codeshare'), 'the partner overlay should still be offered');
  assert.ok(!html.includes('Rivals ('),
    'and an airline carrying your passengers is not contesting you');
});

test('an alliance member is not counted as competing with you', () => {
  // A real alliance and one of its real members — the component resolves
  // membership through getAlliance, so an invented id would just read as a
  // stranger and the test would pass for the wrong reason.
  const state = save({ competitors: [carrier('globalair', 'legacy', [[HUB, 'ORD']])] });
  state.allianceMembership = { allianceId: 'skybridge' };
  const html = render(state);
  assert.ok(!html.includes('Rivals ('),
    'alliance and codeshare partners are drawn as partners, not as the competition');
});

// ── It renders at scale ─────────────────────────────────────────────────────

console.log('\n── Twenty-five carriers do not break it ─────────────────');

test('a full world renders without falling over', () => {
  const spokes = ['ORD', 'MIA', 'BOS', 'DFW', 'LAX', 'SFO', 'ATL', 'DEN'];
  const bank = Array.from({ length: 25 }, (_, i) =>
    carrier(`c${i}`, ['budget', 'legacy', 'premium'][i % 3],
      spokes.slice(i % 4, (i % 4) + 3).map(d => [HUB, d])));
  const html = render(save({ competitors: bank }));
  assert.ok(html.length > 0);
  assert.ok(html.includes('Rivals ('), 'the player\'s ORD route is contested by most of them');
});

test('a rival with no network at all is simply not drawn', () => {
  const html = render(save({ competitors: [
    { id: 'ghost', name: 'Ghost Air', tier: 'legacy', routes: {} },
    carrier('real', 'budget', [[HUB, 'ORD']]),
  ] }));
  assert.ok(html.includes('Rivals (1)'), 'the one with a network is the one that counts');
});

test('a route to an airport the game has never heard of is skipped', () => {
  const html = render(save({ competitors: [{
    id: 'bad', name: 'Bad Air', tier: 'legacy',
    routes: { 'XXX-YYY': { frequency: 7, priceMultiplier: 1 } },
  }] }));
  assert.ok(html.length > 0, 'a malformed route must not take the map down with it');
  assert.ok(!html.includes('Rivals ('));
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
