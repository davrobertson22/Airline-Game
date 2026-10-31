// Demand model v3 (utils/market.js "Demand model v3"): new games only.
//
//   node tools/run-tests.mjs demand-model-v3
//
// v2 calibrated the US and Australia against real traffic. v3 extends the same
// correction to every region with published route traffic (Eurostat, UK CAA,
// US T-100 international, BITRE international, Brazil, Mexico, India, Japan —
// tools/demand-audit/v3/), adds country-pair link factors (holiday flows above
// all) and fitted seasons blended as a product, and fixes v2's US size and
// visitor terms leaking onto international pairs. A new game starts on v3; a
// v2 game stays v2 and a classic save stays classic, for life.

import assert from 'node:assert/strict';
import {
  baseCityPairDemand, setDemandModel, getDemandModel, isDemandModel, linkKey,
  DEMAND_MODEL_CLASSIC, DEMAND_MODEL_LATEST,
} from '../src/utils/market.js';
import { AIRPORT_FACTORS as V3F, LINK_FACTORS as V3L } from '../src/data/demandV3Factors.js';
import { SEASONS as V3_SEASONS, CLASS_SEASONS } from '../src/data/demandV3Seasons.js';
import { getSeasonalProfile } from '../src/models/demand.js';
import { weeklyTick } from '../src/utils/simulation.js';
import { createForecastWorkerCore } from '../src/utils/finderForecastWorkerCore.js';
import { AIRPORTS, getAirport } from '../src/data/airports.js';
import { computeAirportMarkets } from '../src/utils/airportMarket.js';
import { AIRPORT_MARKETS as TABLE_V3, GROWTH_BUCKETS as BUCKETS_V3 } from '../src/data/airportMarketsV3.js';

const lsStore = new Map();
globalThis.window = globalThis.window ?? {};
globalThis.localStorage = {
  getItem: (k) => (lsStore.has(k) ? lsStore.get(k) : null),
  setItem: (k, v) => lsStore.set(k, String(v)),
  removeItem: (k) => lsStore.delete(k),
  clear: () => lsStore.clear(),
};
const { gameReducer, freshState } = await import('../src/store/GameContext.jsx');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.log(`  ✗ ${name}\n      ${(e.stack || e.message).split('\n').slice(0, 5).join('\n      ')}`); failed++; }
}
const quiet = (fn) => { const p = Math.random; Math.random = () => 0.9999999; try { return fn(); } finally { Math.random = p; } };
const d = (pair) => baseCityPairDemand(...pair.split('-'));
const startGame = (extra = {}) => quiet(() => gameReducer(freshState(),
  { type: 'START_GAME', airlineName: 'Model Air', hub: 'ORD', enableObjectives: false, ...extra }));

// v2 figures, captured before v3 existed (the v2 Airports table regenerated
// byte-identical). A v2 game must keep pricing every pair exactly like this.
const V2 = { 'JFK-LAX': 27861, 'JFK-LHR': 26200, 'SYD-MEL': 46596, 'LHR-CDG': 36766, 'MIA-MCO': 3324, 'BOI-YVR': 633,
  'MCO-LHR': 10092, 'DEL-BOM': 69006, 'LHR-PMI': 5816, 'HND-CTS': 117632, 'GRU-GIG': 55008, 'JFK-ORF': 4248, 'MAD-BCN': 12399, 'SYD-AKL': 10729 };
// Real one-way weekly passengers, 2024 (tools/demand-audit/v3/real-data.mjs:
// nonstop traffic less hub transfers). Inlined so this test needs no data files.
const REAL = { 'LHR-PMI': 14086, 'MAN-PMI': 6679, 'LHR-AGP': 15927, 'LHR-EDI': 20795, 'FRA-MUC': 3164, 'IST-AYT': 21296,
  'DEL-BOM': 59286, 'GRU-BSB': 25591, 'MEX-CUN': 23499, 'HND-CTS': 100554, 'JFK-CUN': 8986, 'LAX-MEX': 6222, 'YYZ-JFK': 13798,
  'PIT-CUN': 197, 'SYD-AKL': 10545, 'LHR-AMS': 17499, 'MAD-BCN': 14099 };

console.log('\nDemand model v3 — new games only\n');

console.log('── 1. Which games run it ──────────────────────────────────────────');
test('a new game starts on v3', () => {
  setDemandModel(DEMAND_MODEL_CLASSIC);
  const s = startGame();
  assert.equal(DEMAND_MODEL_LATEST, 3);
  assert.equal(s.demandModel, 3);
  assert.equal(getDemandModel(), 3);
});
test('a v2 game stays v2 through a load and every action, and prices exactly as before v3', () => {
  const v2 = startGame({ demandModel: 2 });
  setDemandModel(DEMAND_MODEL_CLASSIC);
  const loaded = gameReducer(freshState(), { type: 'LOAD_STATE', payload: v2 });
  assert.equal(loaded.demandModel, 2);
  assert.equal(getDemandModel(), 2);
  gameReducer(v2, { type: 'NOOP_FOR_TEST' });
  assert.equal(getDemandModel(), 2);
  const got = Object.fromEntries(Object.keys(V2).map((p) => [p, d(p)]));
  assert.deepEqual(got, V2);
});
test('a classic save stays classic straight after a v3 game (no memo carried across)', () => {
  const v3 = startGame();
  const { demandModel, ...legacy } = v3;
  gameReducer(v3, { type: 'LOAD_STATE', payload: legacy });
  assert.equal(getDemandModel(), DEMAND_MODEL_CLASSIC);
  assert.equal(d('LHR-PMI'), 5816);
});
test('a load keeps 2 and 3, and drops anything else to classic', () => {
  assert.ok(isDemandModel(2) && isDemandModel(3));
  for (const bad of [4, 0, '3', null]) assert.ok(!isDemandModel(bad), String(bad));
});
test('weeklyTick and the Route Finder worker price off THEIR state\'s model', () => {
  const v3 = startGame();
  setDemandModel(2);
  quiet(() => weeklyTick({ ...v3 }));
  assert.equal(getDemandModel(), 3);
  setDemandModel(DEMAND_MODEL_CLASSIC);
  const core = createForecastWorkerCore();
  core({ type: 'state', id: 1, state: v3 });
  core({ type: 'price', jobId: 1, stateId: 1, ctx: {}, rows: [] });
  assert.equal(getDemandModel(), 3);
});
test('the v3 Airports table is the v3 model (generated, not stale)', () => {
  setDemandModel(3);
  const sample = AIRPORTS.filter((a, i) => i % 15 === 0).map((a) => a.code);
  const fresh = computeAirportMarkets(sample, BUCKETS_V3);
  for (const c of sample) assert.deepEqual(fresh[c], TABLE_V3[c], `${c} — run node tools/generate-airport-markets.mjs`);
});

console.log('\n── 2. What v3 changes ─────────────────────────────────────────────');
test('v2\'s US size / visitor terms stay off international pairs (domestic-only fix)', () => {
  setDemandModel(2); const v2b = d('BOI-YVR'), v2m = d('MCO-LHR');
  setDemandModel(1); const cb = d('BOI-YVR');
  setDemandModel(3);
  // Boise–Vancouver: v2 halved it with a domestic size term; v3 prices it on
  // its own international data instead (and only its v3 factor moves it).
  const fBoi = V3F.BOI ?? 1, link = V3L[linkKey('US', 'CA')] ?? 1;
  assert.ok(Math.abs(d('BOI-YVR') - cb * Math.pow(fBoi * (V3F.YVR ?? 1) * link, 2 / 3)) <= 2,
    `BOI-YVR ${d('BOI-YVR')} vs classic ${cb} × v3 factors only`);
  assert.notEqual(d('BOI-YVR'), v2b);
  assert.ok(v2m > 0);
});
test('US and Australian DOMESTIC pairs are v2 exactly (v3 adds nothing there)', () => {
  for (const p of ['JFK-LAX', 'MIA-MCO', 'JFK-ORF', 'SYD-MEL']) { setDemandModel(2); const a = d(p); setDemandModel(3); assert.equal(d(p), a, p); }
});
test('a Japanese airport\'s factor applies to domestic pairs only (MLIT has no international pairs)', () => {
  setDemandModel(3);
  assert.ok(V3F.CTS != null || V3F.HND != null, 'expected fitted Japanese factors');
  // HND–ICN moves only by the JP–KR link (and ICN, which has no factor).
  setDemandModel(1); const classic = d('HND-ICN');
  setDemandModel(3);
  const link = V3L[linkKey('JP', 'KR')] ?? 1;
  assert.ok(Math.abs(d('HND-ICN') - classic * Math.pow(link, 2 / 3)) <= 2, `HND-ICN ${d('HND-ICN')} vs ${classic} × link`);
});
test('holiday flows: London–Palma and Istanbul–Antalya rise toward real', () => {
  setDemandModel(1); const c1 = d('LHR-PMI'), c2 = d('IST-AYT');
  setDemandModel(3);
  assert.ok(d('LHR-PMI') > 1.8 * c1, `LHR-PMI ${d('LHR-PMI')} vs classic ${c1}`);
  assert.ok(d('IST-AYT') > 1.4 * c2, `IST-AYT ${d('IST-AYT')} vs classic ${c2}`);
});
test('v3 is closer to real than classic on the benchmark pairs (geometric error)', () => {
  const err = (m) => { setDemandModel(m); let s = 0; for (const [p, r] of Object.entries(REAL)) s += Math.abs(Math.log(d(p) / r)); return Math.exp(s / Object.keys(REAL).length); };
  const e1 = err(1), e3 = err(3);
  assert.ok(e3 < e1 * 0.7, `v3 ${e3.toFixed(2)}x vs classic ${e1.toFixed(2)}x`);
});
test('the factor tables are sane: positive, inside their caps, keyed on real airports / country pairs', () => {
  for (const [k, f] of Object.entries(V3F)) { assert.ok(getAirport(k), k); assert.ok(f >= 0.2 && f <= 5, `${k} ${f}`); }
  for (const [k, f] of Object.entries(V3L)) { const [a, b] = k.split('|'); assert.ok(a <= b, k); assert.ok(f >= 0.1 && f <= 8, `${k} ${f}`); }
});

console.log('\n── 3. Seasons ─────────────────────────────────────────────────────');
test('every v3 season and class profile averages exactly 1 (moves demand between months, adds none)', () => {
  for (const [c, v] of [...Object.entries(V3_SEASONS), ...Object.entries(CLASS_SEASONS)]) {
    assert.equal(v.length, 12, c);
    assert.ok(Math.abs(v.reduce((s, x) => s + x, 0) / 12 - 1) < 0.002, c);
  }
});
test('a v3 route\'s profile averages 1 too (the product blend is renormalised)', () => {
  setDemandModel(3);
  for (const p of ['LHR-PMI', 'FRA-HER', 'JFK-LHR', 'MIA-JFK', 'GRU-GIG', 'SYD-SIN']) {
    const s = getSeasonalProfile(...p.split('-'));
    assert.ok(Math.abs(s.slice(1).reduce((a, x) => a + x, 0) / 12 - 1) < 0.003, p);
  }
});
test('island routes are summer-only: Frankfurt–Heraklion is near empty in January, full in August', () => {
  setDemandModel(3);
  const s = getSeasonalProfile('FRA', 'HER');
  assert.ok(s[1] < 0.25 && s[8] > 1.8, `Jan ${s[1]} Aug ${s[8]}`);
  setDemandModel(2);
  const s2 = getSeasonalProfile('FRA', 'HER');
  assert.ok(s2[1] > 0.5, 'v2 (archetype curves, averaged) kept half the route in winter');
});
test('transatlantic peaks in summer; Florida–New York in winter', () => {
  setDemandModel(3);
  const t = getSeasonalProfile('JFK', 'LHR'), f = getSeasonalProfile('MIA', 'JFK');
  assert.ok(t[7] > t[1] + 0.3, `JFK-LHR Jul ${t[7]} Jan ${t[1]}`);
  assert.ok(f[1] > f[8], `MIA-JFK Jan ${f[1]} Aug ${f[8]}`);
});
test('the blend memo is per model (one process can run v2 and v3 games)', () => {
  setDemandModel(2); const a = getSeasonalProfile('FRA', 'HER');
  setDemandModel(3); const b = getSeasonalProfile('FRA', 'HER');
  setDemandModel(2); const c = getSeasonalProfile('FRA', 'HER');
  assert.notDeepEqual(a, b);
  assert.deepEqual(a, c);
});

setDemandModel(DEMAND_MODEL_CLASSIC);
console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
