// Belly cargo on screen (claude/belly-cargo-design.md, build step 3).
//
// The engine suite (tools/belly-cargo-test.mjs) proves the numbers. This one
// renders the real components and checks the player is shown those numbers:
// the route panel, the rate that is actually charged, and the Finance row.
//
//   node --import ./tools/_register-loader.mjs tools/belly-cargo-ui-test.mjs
import assert from 'node:assert/strict';
import React from 'react';
import { renderToString } from 'react-dom/server';

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.log(`  ✗ ${name}\n      ${(e.stack || e.message).split('\n').slice(0, 4).join('\n      ')}`); failed++; }
}
const store = new Map();
globalThis.localStorage = {
  getItem: k => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)),
  removeItem: k => store.delete(k), clear: () => store.clear(), key: i => [...store.keys()][i] ?? null,
  get length() { return store.size; },
};
globalThis.window ??= { localStorage: globalThis.localStorage, matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }) };

const { GameProvider, freshState, gameReducer } = await import('../src/store/GameContext.jsx');
const { defaultClassPrices, referencePrice, formatMoney } = await import('../src/utils/simulation.js');
const { bellyReferenceRate } = await import('../src/models/bellyCargo.js');
const BellyCargoPanel = (await import('../src/components/BellyCargo.jsx')).default;
const Finance = (await import('../src/components/Finance.jsx')).default;

const realRandom = Math.random;
function airline(belly) {
  let seed = 31337; Math.random = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  let s = gameReducer(freshState(), { type: 'START_GAME', airlineName: 'B', hub: 'JFK', enableObjectives: false, productionLines: false, bellyCargo: belly });
  s = { ...s, cash: 5e9, newWorldRestrictions: true, competitors: [] };
  s = gameReducer(s, { type: 'BUY_AIRCRAFT', typeId: 'b7879' });
  s = gameReducer(s, { type: 'ADD_GATE', airportCode: 'LHR' });
  s = gameReducer(s, { type: 'ADD_ROUTE', aircraftId: s.fleet[0].id, origin: 'JFK', destination: 'LHR', weeklyFrequency: 6 });
  s = { ...s, routePricing: { ...s.routePricing, 'JFK-LHR': defaultClassPrices(Math.round(referencePrice('JFK', 'LHR'))) } };
  for (const g of ['pilots', 'cabinCrew', 'groundStaff', 'maintenanceTeam']) s = gameReducer(s, { type: 'HIRE_CREW', group: g, bodies: 200, startNow: true });
  Math.random = () => 0.9999999;
  s = gameReducer(s, { type: 'ADVANCE_WEEK' });
  Math.random = realRandom;
  return s;
}
const clean = (h) => h.replace(/&amp;/g, '&').replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/<!-- -->/g, '');
const render = (state, el) => { store.set('bbae_save_v2', JSON.stringify(state)); return clean(renderToString(React.createElement(GameProvider, null, el))); };

console.log('\nBelly cargo (render)\n');
const on = airline(true), off = airline(false);
const rr = on.lastReport.routeResults[0];

test('the route panel shows what the tick booked', () => {
  const html = render(on, React.createElement(BellyCargoPanel, { origin: 'JFK', destination: 'LHR', results: on.lastReport.routeResults }));
  assert.ok(html.includes('Belly cargo'), 'no panel');
  assert.ok(html.includes(`${rr.bellyTonnes.toLocaleString()} t`), `tonnes ${rr.bellyTonnes} not on screen`);
  assert.ok(html.includes(`+${formatMoney(rr.bellyRevenue)}`), 'revenue not on screen');
  assert.ok(html.includes(`−${formatMoney(rr.bellyHandlingCost + rr.bellyFuelCost)}`), 'cost not on screen');
  assert.ok(html.includes('following the market'));
  assert.ok(html.includes(`value="${bellyReferenceRate('JFK', 'LHR').toFixed(3)}"`), 'the rate box does not show the market rate');
});

test('a rate of your own is the one in the box, with the way back to the market', () => {
  const s = gameReducer(on, { type: 'SET_BELLY_RATE', origin: 'JFK', destination: 'LHR', rate: bellyReferenceRate('JFK', 'LHR') * 1.2 });
  const html = render(s, React.createElement(BellyCargoPanel, { origin: 'LHR', destination: 'JFK', results: [] }));
  assert.ok(html.includes(`value="${s.bellyRates['JFK-LHR'].toFixed(3)}"`));
  assert.ok(html.includes('yours is +20%'));
  assert.ok(html.includes('Follow the market'));
});

test('a game without belly cargo shows no panel and no Finance row', () => {
  assert.equal(render(off, React.createElement(BellyCargoPanel, { origin: 'JFK', destination: 'LHR', results: off.lastReport.routeResults })), '');
  assert.ok(!render(off, React.createElement(Finance)).includes('pl-belly-cargo'));
});

test('Finance breaks belly revenue out, at the figure the forecast carries', () => {
  const html = render(on, React.createElement(Finance));
  assert.ok(html.includes('pl-belly-cargo'), 'no belly row in the P&L');
  assert.ok(html.includes('passenger holds'));
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
