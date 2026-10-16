// Routes tab, Gates tab and Route Finder lag — and Barca's Routes columns.
// Ported from Headwinds (Discord, 2026-10-16: Barca's "sortable hours and runway
// length", "routes tab is very laggy… click to show more like the route
// finder", "similarly for gates tab", plus Route Finder lag reports).
// tools/routes-gates-finder-perf-probe.mjs has the numbers; this suite pins:
//
//   1. hydrateState: one screen state per saved state, and a change that leaves
//      routes / fares / catering alone keeps state.routes (route-keyed memos on
//      the Routes table and the finder hold still).
//   2. slotUsageByAirport — one walk of the schedule — agrees with slotsUsedAt
//      for every airport (the Gates tab called that per sort comparison).
//   3. Routes table: Hours and Runway columns (runway = the SHORTER end), 25
//      rows a page.
//   4. Gates tab: 25 rows a page.
//   5. Route Finder: forecasts priced a slice at a time — a big airline's first
//      paint says "forecasting x of y…", a small one finishes in the first
//      slice, and every number shown is scoreCandidates' number for that row.
//
// Verified failing on HEAD (hydrateState / slotUsageByAirport not exported, no
// Hours/Runway, 100-row pages, unpaged gates, the finder priced in one pass).
//
//   node --import ./tools/_register-loader.mjs tools/routes-gates-finder-lag-test.mjs

import assert from 'node:assert/strict';
import React from 'react';
import { renderToString } from 'react-dom/server';

const store = new Map();
globalThis.window = globalThis.window ?? {};
globalThis.window.matchMedia = () => ({ matches: false, addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {} });
globalThis.window.dispatchEvent = globalThis.window.dispatchEvent ?? (() => true);
globalThis.matchMedia = globalThis.window.matchMedia;
globalThis.localStorage = { getItem: k => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: k => store.delete(k), clear: () => store.clear() };
globalThis.document = globalThis.document ?? { addEventListener() {}, removeEventListener() {}, querySelector() { return null; } };

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.log(`  ✗ ${name}\n      ${(e.stack || e.message).split('\n').slice(0, 5).join('\n      ')}`); failed++; }
}

const GC = await import('../src/store/GameContext.jsx');
const { GameProvider, freshState } = GC;
const Routes = (await import('../src/components/Routes.jsx')).default;
const Airports = (await import('../src/components/Airports.jsx')).default;
const RouteFinder = (await import('../src/components/RouteFinder.jsx')).default;
const { clearFinderMemory, rememberFinder, finderMemoryKey } = await import('../src/utils/finderMemory.js');
const engine = GC;
const { slotsUsedAt } = engine;
const { cargoSlotsUsedAt, formatMoney, currentGameDate } = await import('../src/utils/simulation.js');
const { findCandidates, sortCandidates, scoreCandidates } = await import('../src/models/routeFinder.js');
const { getAirport, AIRPORTS } = await import('../src/data/airports.js');
const { buildWorld } = await import('./routes-gates-finder-perf-probe.mjs');

const clean = (h) => h.replaceAll('<!-- -->', '');
// GameProvider boots from the save in localStorage.
const renderRemote = (state, el) => {
  store.set('bbae_save_v2', JSON.stringify(state));
  return clean(renderToString(React.createElement(GameProvider, null, el)));
};

// ── 1. one hydrated state per saved state ───────────────────────────────────
console.log('\n── 1. the screen state is built once per saved state ──────────');

test('hydrateState: same state in, same object out', () => {
  const { hydrateState } = GC;
  assert.equal(typeof hydrateState, 'function', 'hydrateState is not exported');
  const st = buildWorld({ routes: 30, rivals: 2, rivalRoutes: 5, gateAirports: 10 });
  assert.equal(hydrateState(st), hydrateState(st));
});

test('a change that leaves routes, fares and catering alone keeps state.routes', () => {
  const { hydrateState } = GC;
  const st = buildWorld({ routes: 30, rivals: 2, rivalRoutes: 5, gateAirports: 10 });
  const next = { ...st, cash: st.cash - 1, gates: { ...st.gates, BOS: 9 } };
  assert.notEqual(hydrateState(st), hydrateState(next));
  assert.equal(hydrateState(st).routes, hydrateState(next).routes, 'an unrelated action rebuilt the hydrated routes');
});

test('…and a fare change does produce new hydrated routes', () => {
  const { hydrateState } = GC;
  const st = buildWorld({ routes: 30, rivals: 1, rivalRoutes: 2, gateAirports: 10 });
  const key = Object.keys(st.routePricing)[0];
  const repriced = { ...st, routePricing: { ...st.routePricing, [key]: { ...st.routePricing[key], economy: 1 } } };
  assert.notEqual(hydrateState(st).routes, hydrateState(repriced).routes);
});

// ── 2. slot usage in one walk ───────────────────────────────────────────────
console.log('\n── 2. slot usage for every airport in one walk ────────────────');

test('slotUsageByAirport agrees with slotsUsedAt everywhere — tag routes, seasons, freight', () => {
  const { slotUsageByAirport, slotUsageFor } = engine;
  assert.equal(typeof slotUsageByAirport, 'function', 'slotUsageByAirport is not exported');
  const routes = [
    { id: 'a', origin: 'JFK', destination: 'LHR', stops: ['JFK', 'LHR'], weeklyFrequency: 14 },
    { id: 'b', origin: 'MCI', destination: 'ORY', stops: ['MCI', 'JFK', 'ORY'], weeklyFrequency: 3 },
    { id: 'c', origin: 'JFK', destination: 'PMI', stops: ['JFK', 'PMI'], weeklyFrequency: 7, season: { months: [6, 7, 8] } },
    { id: 'd', origin: 'JFK', destination: 'CUN', stops: ['JFK', 'CUN'], weeklyFrequency: 9, season: { months: [12, 1, 2] } },
    { id: 'e', origin: 'BOS', destination: 'LHR', weeklyFrequency: 5 },
  ];
  const cargo = [{ id: 'k', origin: 'JFK', destination: 'FRA', weeklyFrequency: 4 }, { id: 'l', origin: 'LHR', destination: 'FRA', weeklyFrequency: 2 }];
  const all = [...routes, ...cargo];
  const map = slotUsageByAirport(all);
  for (const code of ['JFK', 'LHR', 'MCI', 'ORY', 'PMI', 'CUN', 'BOS', 'FRA', 'SFO']) {
    assert.equal(map.get(code) ?? 0, slotsUsedAt(all, code), `${code}: one walk disagrees with slotsUsedAt`);
    // The Gates tab's old reading: passenger peak + freight endpoints.
    assert.equal(map.get(code) ?? 0, slotsUsedAt(routes, code) + cargoSlotsUsedAt(code, cargo), `${code}: disagrees with the Gates tab's old sum`);
  }
  const st = { routes, cargoRoutes: cargo };
  assert.equal(slotUsageFor(st), slotUsageFor(st), 'not cached per network');
  assert.equal(slotUsageFor(st).get('JFK'), slotsUsedAt(all, 'JFK'));
});

// ── 3. Routes: Hours, Runway, 25-row pages ──────────────────────────────────
console.log('\n── 3. Routes table: Hours, Runway, paging ─────────────────────');

const big = buildWorld({ routes: 60, rivals: 2, rivalRoutes: 5, gateAirports: 20 });

test('the table has sortable Hours and Runway columns', () => {
  const html = renderRemote(big, React.createElement(Routes));
  assert.match(html, />Hours</, 'no Hours column');
  assert.match(html, />Runway</, 'no Runway column');
  assert.match(html, /\d+h \d{2}m/, 'no block time in the Hours cells');
  assert.match(html, /[\d,]+ ft/, 'no runway length in the Runway cells');
});

test('Runway is the SHORTER of the two airports', () => {
  // One pair, two very different runways.
  const shortEnd = AIRPORTS.filter(a => a.runwayFt && a.runwayFt < 7000 && a.code !== 'JFK').sort((a, b) => a.runwayFt - b.runwayFt)[0];
  const st = { ...big, routes: [{ ...big.routes[0], destination: shortEnd.code, stops: ['JFK', shortEnd.code], origin: 'JFK' }] };
  const html = renderRemote(st, React.createElement(Routes));
  assert.ok(getAirport('JFK').runwayFt > shortEnd.runwayFt);
  assert.ok(html.includes(`${shortEnd.runwayFt.toLocaleString()} ft`), `expected ${shortEnd.code}'s ${shortEnd.runwayFt} ft, the shorter end`);
  assert.ok(!html.includes(`${getAirport('JFK').runwayFt.toLocaleString()} ft`), "showed JFK's longer runway");
});

test('the table draws 25 rows and offers the rest', () => {
  const html = renderRemote(big, React.createElement(Routes));
  assert.match(html, /Show 25 more \(25 of \d+\)/);
});

// ── 4. Gates: paging ────────────────────────────────────────────────────────
console.log('\n── 4. Gates tab ───────────────────────────────────────────────');

const many = buildWorld({ routes: 60, rivals: 2, rivalRoutes: 5, gateAirports: 80 });

test('Your Gates draws 25 rows and offers the rest', () => {
  const html = renderRemote(many, React.createElement(Airports));
  const total = Object.values(many.gates).filter(n => n > 0).length;
  assert.ok(total > 25, 'fixture too small');
  assert.ok(html.includes(`Show 25 more (25 of ${total})`), 'gate table is not paged');
});

// ── 5. Route Finder: progressive forecasts ──────────────────────────────────
console.log('\n── 5. Route Finder forecasts ──────────────────────────────────');

test('a big airline: first paint shows progress instead of pricing the whole page', () => {
  clearFinderMemory();
  const st = buildWorld({ routes: 450, gateAirports: 200 });
  const html = renderRemote(st, React.createElement(RouteFinder, { standalone: true }));
  assert.match(html, /forecasting \d+ of 25…/, 'no progress line — the page was priced in one synchronous pass');
});

test('a small airline: every forecast lands in the first slice, and matches scoreCandidates', () => {
  clearFinderMemory();
  const st = {
    ...freshState(), phase: 'playing', week: 20, year: 2, hub: 'JFK', airlineName: 'Small Air', cash: 4e8,
    gates: { JFK: 2 }, routes: [], cargoRoutes: [],
    fleet: [{ id: 'a1', typeId: 'a320neo', status: 'idle', ageWeeks: 52, ownershipType: 'owned', config: { economy: 180 } }],
  };
  rememberFinder(finderMemoryKey(st, 'passenger'), { typeId: 'a320neo', sortBy: 'demand' });
  // One render to warm the process (JIT, the demand memo): a cold Node can miss
  // the slice by a row or two, which in a browser is one extra frame.
  renderRemote({ ...st }, React.createElement(RouteFinder, { standalone: true }));
  const html = renderRemote({ ...st }, React.createElement(RouteFinder, { standalone: true }));
  assert.ok(!/forecasting \d+ of/.test(html), 'a small airline should not see a progress line');
  const rows = findCandidates(st, { origin: 'JFK', aircraftTypeId: 'a320neo', aircraft: st.fleet[0], hideUnflyable: true, hideServedLanes: true, groupMetros: true });
  const scored = scoreCandidates(st, sortCandidates(rows, 'demand'),
    { aircraftTypeId: 'a320neo', aircraft: st.fleet[0], weeklyFrequency: 7, gameDate: currentGameDate(st),
      limit: 25, order: 'asGiven' }).filter(r => r.scored).slice(0, 5);
  assert.ok(scored.length >= 3, 'fixture: no scored rows');
  for (const r of scored) {
    const p = r.projection.netProfit;
    const text = `${p >= 0 ? '+' : ''}${formatMoney(p)}`;
    assert.ok(html.includes(text), `${r.code}: the finder does not show scoreCandidates' ${text}`);
  }
});

console.log(`\n${failed === 0 ? '✓' : '✗'} routes-gates-finder-lag: ${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
