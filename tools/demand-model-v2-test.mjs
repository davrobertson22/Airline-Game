// Demand model v2 (utils/market.js "Demand model v2"): new games only.
//
//   node tools/run-tests.mjs demand-model-v2
//
// The classic gravity model, benchmarked against real O&D (tools/demand-audit/),
// made 4.4x the real US domestic market and about half of Australia's. v2 is a
// fitted correction on top of it, switched on per GAME: START_GAME stamps
// state.demandModel = 2, and a save without the stamp — every save made before
// v2 existed — must price exactly as it always has, for its whole life.

import assert from 'node:assert/strict';
import {
  baseCityPairDemand, setDemandModel, getDemandModel, isDemandModel,
  DEMAND_MODEL_CLASSIC, DEMAND_MODEL_LATEST, DEMAND_V2,
  resetDemandV2Caches, v2CorridorOf, v2DriveHours, distanceKm, referencePrice, sectorCostKm,
} from '../src/utils/market.js';
import { blockTimeHours, maxFrequency, simulateRoute, defaultConfig } from '../src/utils/simulation.js';
import { routeRotation } from '../src/models/schedule.js';
import { missionCostPerWeek } from '../src/data/charters.js';
import { getAircraftType } from '../src/data/aircraft.js';
import { AIRPORT_FACTORS, CORRIDOR_FACTORS } from '../src/data/demandV2Factors.js';
import { SEASONS } from '../src/data/demandV2Seasons.js';
import { getSeasonalProfile, seasonalProfileForAirport, directionalSeasonalSkew } from '../src/models/demand.js';
import { getAirport } from '../src/data/airports.js';
import { weeklyTick } from '../src/utils/simulation.js';
import { createForecastWorkerCore } from '../src/utils/finderForecastWorkerCore.js';
import { AIRPORTS } from '../src/data/airports.js';
import { computeAirportMarkets } from '../src/utils/airportMarket.js';
import { AIRPORT_MARKETS as TABLE_V1, GROWTH_BUCKETS as BUCKETS_V1 } from '../src/data/airportMarkets.js';
import { AIRPORT_MARKETS as TABLE_V2, GROWTH_BUCKETS as BUCKETS_V2 } from '../src/data/airportMarketsV2.js';

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

// Classic figures captured from the engine BEFORE v2 existed (2026-10-29).
const CLASSIC = {"JFK-LAX":27244,"JFK-LHR":26200,"EWR-LGW":26200,"SYD-MEL":28418,"PER-PHE":574,"JFK-ORF":14313,"MIA-MCO":25409,"ORD-CID":3176,"DEN-ASE":790,"CHO-IAD":1122,"LAS-SFB":6355,"HNL-LAX":28392,"DEL-BOM":69006,"NRT-ICN":72662,"LHR-CDG":36766,"GRU-EZE":15720,"YYZ-ORD":9642,"SEA-YVR":4253,"MCO-SJU":16081,"CBR-SYD":8015,"BNE-CNS":2618,"DXB-LHR":22038,"TPA-PIE":0,"PHX-AZA":0,"JFK-PHL":15078};

// Real one-way weekly O&D (DOT Consumer Airfare Report Table 6, 2025Q2–2026Q1,
// metro-aggregated the way us-od-data.mjs aggregates; '+' sums node pairs).
const REAL_US = [["JFK-LAX",43588],["SFO-LAX",57268],["ORD-MIA",18619],["ORD-IND",811],["MIA-MCO",1575],["JFK-ORF+JFK-PHF",2677],["DEN-FAR+APA-FAR",700],["DSM-ATL",552],["SEA-BOI",2844],["MSP-LAS",6549],["DFW-TUL",803],["DEN-ASE+APA-ASE",136],["MSP-FAR",139],["AZA-SEA+PHX-SEA",10633]];
const priceSum = (spec) => spec.split('+').reduce((s, p) => s + d(p), 0);

console.log('\nDemand model v2 — new games only\n');

console.log('── 1. Classic saves are untouched ─────────────────────────────────');
test('the classic model prices every reference pair exactly as before v2', () => {
  setDemandModel(DEMAND_MODEL_CLASSIC);
  const got = Object.fromEntries(Object.keys(CLASSIC).map((p) => [p, d(p)]));
  assert.deepEqual(got, CLASSIC);
});
test('a save with no demandModel loads classic, even straight after a v2 game', () => {
  const v2 = startGame();
  assert.equal(getDemandModel(), 2);
  const { demandModel, ...legacy } = v2;
  gameReducer(v2, { type: 'LOAD_STATE', payload: legacy });
  assert.equal(getDemandModel(), DEMAND_MODEL_CLASSIC);
  assert.equal(d('JFK-ORF'), CLASSIC['JFK-ORF'], 'the pair memo must not carry the v2 figure across');
});
test('a load never upgrades: an unknown demandModel is dropped to classic', () => {
  const v2 = startGame();
  for (const bad of [3, 0, '2', 'v2', null]) {
    const s = gameReducer(v2, { type: 'LOAD_STATE', payload: { ...v2, demandModel: bad } });
    assert.equal(getDemandModel(), DEMAND_MODEL_CLASSIC, String(bad));
    assert.ok(!isDemandModel(s.demandModel), `kept ${bad}`);
  }
});
test('the classic Airports table is the classic model (generated, not stale)', () => {
  setDemandModel(DEMAND_MODEL_CLASSIC);
  const sample = AIRPORTS.filter((a, i) => i % 15 === 0).map((a) => a.code);
  const fresh = computeAirportMarkets(sample, BUCKETS_V1);
  for (const c of sample) assert.deepEqual(fresh[c], TABLE_V1[c], `${c} — run node tools/generate-airport-markets.mjs`);
});

console.log('\n── 2. New games run v2 ────────────────────────────────────────────');
test('START_GAME stamps demandModel 2 and switches the engine to it', () => {
  setDemandModel(DEMAND_MODEL_CLASSIC);
  const s = startGame();
  assert.equal(s.demandModel, DEMAND_MODEL_LATEST);
  assert.equal(getDemandModel(), 2);
  assert.notEqual(d('JFK-ORF'), CLASSIC['JFK-ORF']);
});
test('START_GAME with demandModel 1 starts a classic game (no stamp)', () => {
  const s = startGame({ demandModel: 1 });
  assert.equal(s.demandModel, undefined);
  assert.equal(getDemandModel(), DEMAND_MODEL_CLASSIC);
});
test('a v2 save reloads as v2, and every reducer action keeps it live', () => {
  const v2 = startGame();
  setDemandModel(DEMAND_MODEL_CLASSIC);
  gameReducer(v2, { type: 'LOAD_STATE', payload: v2 });
  assert.equal(getDemandModel(), 2);
  setDemandModel(DEMAND_MODEL_CLASSIC);
  gameReducer(v2, { type: 'NOOP_FOR_TEST' });
  assert.equal(getDemandModel(), 2, 'reducer entry sets the model from state');
});
test('weeklyTick prices off ITS state\'s model, not the last one live', () => {
  const classic = startGame({ demandModel: 1 });
  setDemandModel(2);
  quiet(() => weeklyTick(classic));
  assert.equal(getDemandModel(), DEMAND_MODEL_CLASSIC);
});
test('the Route Finder worker prices off the held state\'s model', () => {
  const v2 = startGame();
  setDemandModel(DEMAND_MODEL_CLASSIC);
  const core = createForecastWorkerCore();
  core({ type: 'state', id: 1, state: v2 });
  core({ type: 'price', jobId: 1, stateId: 1, ctx: {}, rows: [] });
  assert.equal(getDemandModel(), 2);
});
test('the v2 Airports table is the v2 model (generated, not stale)', () => {
  setDemandModel(2);
  const sample = AIRPORTS.filter((a, i) => i % 15 === 0).map((a) => a.code);
  const fresh = computeAirportMarkets(sample, BUCKETS_V2);
  for (const c of sample) assert.deepEqual(fresh[c], TABLE_V2[c], `${c} — run node tools/generate-airport-markets.mjs`);
  setDemandModel(DEMAND_MODEL_CLASSIC);
});

console.log('\n── 3. v2 behaves like a demand model ──────────────────────────────');
test('symmetric, and one total per metro pair (JFK–LHR = EWR–LGW)', () => {
  setDemandModel(2);
  for (const p of Object.keys(CLASSIC)) { const [a, b] = p.split('-'); assert.equal(d(`${a}-${b}`), d(`${b}-${a}`), p); }
  assert.equal(d('JFK-LHR'), d('EWR-LGW'));
  assert.equal(d('TPA-PIE'), 0, 'same-metro / surface pairs stay empty');
});
test('pairs with no US or Australian endpoint are unchanged', () => {
  setDemandModel(2);
  for (const p of ['DEL-BOM', 'NRT-ICN', 'LHR-CDG', 'GRU-EZE', 'DXB-LHR']) assert.equal(d(p), CLASSIC[p], p);
});
test('the duplicated catchments no longer count their metro twice', () => {
  setDemandModel(2);
  assert.ok(d('LAS-SFB') < CLASSIC['LAS-SFB'] * 0.3, `LAS–SFB ${d('LAS-SFB')}`);
});
test('v2 is closer to real US O&D than classic across pair sizes', () => {
  const err = (model) => { setDemandModel(model); return REAL_US.map(([spec, real]) => Math.abs(Math.log(priceSum(spec) / real))); };
  const e1 = err(1), e2 = err(2);
  const mean = (a) => a.reduce((s, x) => s + x, 0) / a.length;
  assert.ok(mean(e2) < mean(e1) * 0.6, `mean |log error| classic ${mean(e1).toFixed(2)} v2 ${mean(e2).toFixed(2)}`);
});
test('big trunks stay within 2x of real (v2 cuts the long tail, not the trunks)', () => {
  setDemandModel(2);
  for (const [spec, real] of REAL_US.filter(([, r]) => r >= 15000)) {
    const r = priceSum(spec) / real;
    assert.ok(r > 0.45 && r < 2, `${spec} ${r.toFixed(2)}x real`);
  }
});
test('"mostly realistic": the game applies 2/3 of the fitted correction', () => {
  assert.ok(Math.abs(DEMAND_V2.realism - 2 / 3) < 1e-9);
  setDemandModel(2);
  const v2 = d('MIA-MCO');
  setDemandModel(1);
  const v1 = d('MIA-MCO');
  // Real is 1,575: v2 sits between classic and real, nearer real (in log terms).
  assert.ok(v2 < v1 && v2 > 1575, `MIA–MCO classic ${v1}, v2 ${v2}, real 1575`);
  assert.ok(Math.log(v1 / v2) > Math.log(v1 / 1575) * 0.4, 'moves well over a third of the way');
});
test('Australian domestic trunks rise toward real (SYD–MEL real ~69,800/wk)', () => {
  setDemandModel(2);
  assert.ok(d('SYD-MEL') > CLASSIC['SYD-MEL'] * 1.3, `SYD–MEL ${d('SYD-MEL')}`);
  setDemandModel(DEMAND_MODEL_CLASSIC);
});

console.log('\n── 4. Calibration layers (airport factors, corridors, mountains, roads) ──');
test('per-airport factors apply to domestic pairs only', () => {
  // JFK carries a factor; JFK–LHR (international) must not see it.
  assert.ok(Math.abs((AIRPORT_FACTORS.JFK ?? 1) - 1) > 0.01, 'fixture: JFK should have a factor');
  setDemandModel(2);
  const intl = d('JFK-LHR');
  const saved = AIRPORT_FACTORS.JFK; AIRPORT_FACTORS.JFK = 1; resetDemandV2Caches();
  assert.equal(d('JFK-LHR'), intl, 'an international pair moved with an airport factor');
  assert.notEqual(d('JFK-ORD'), (() => { AIRPORT_FACTORS.JFK = saved; resetDemandV2Caches(); return d('JFK-ORD'); })(), 'a domestic pair ignored it');
  setDemandModel(DEMAND_MODEL_CLASSIC);
});
test('a corridor factor needs BOTH ends in the corridor', () => {
  assert.equal(v2CorridorOf('SFO'), 'california');
  assert.equal(v2CorridorOf('OAK'), null, 'metro members are looked up by their primary, not themselves');
  assert.equal(v2CorridorOf('JFK'), 'northeast');
  assert.equal(v2CorridorOf('BOS'), null, 'Boston–New York stays an air market');
  assert.ok(CORRIDOR_FACTORS.california > 1 && CORRIDOR_FACTORS.florida < 1);
  setDemandModel(2);
  const inside = d('SFO-LAX'), across = d('SFO-SEA');
  const saved = CORRIDOR_FACTORS.california; CORRIDOR_FACTORS.california = 1; resetDemandV2Caches();
  assert.ok(d('SFO-LAX') < inside, 'the California factor did not lift SFO–LAX');
  assert.equal(d('SFO-SEA'), across, 'a pair across two corridors took a corridor factor');
  CORRIDOR_FACTORS.california = saved; resetDemandV2Caches();
  setDemandModel(DEMAND_MODEL_CLASSIC);
});
test('mountain resorts skip the drive ramp (Denver–Aspen is 160 km of pass)', () => {
  setDemandModel(2);
  const withExemption = d('DEN-ASE');
  const saved = DEMAND_V2.mountainResorts; DEMAND_V2.mountainResorts = []; resetDemandV2Caches();
  const without = d('DEN-ASE');
  DEMAND_V2.mountainResorts = saved; resetDemandV2Caches();
  assert.ok(withExemption > without * 3, `DEN–ASE ${withExemption} with the exemption vs ${without} without`);
  setDemandModel(DEMAND_MODEL_CLASSIC);
});
test('the drive ramp reads driving time: a mountain pass outweighs flat interstate', () => {
  const h = (a, b) => v2DriveHours(getAirport(a), getAirport(b), distanceKm(getAirport(a), getAirport(b)));
  // SEA–GEG (359 km over the Cascades) is a longer drive than MIA–MCO (310 km of turnpike) by more than distance says.
  assert.ok(h('SEA', 'GEG') / h('MIA', 'MCO') > distanceKm(getAirport('SEA'), getAirport('GEG')) / distanceKm(getAirport('MIA'), getAirport('MCO')));
  assert.ok(h('LAX', 'SFO') > 5 && h('LAX', 'SFO') < 9, `LAX–SFO ${h('LAX', 'SFO').toFixed(1)} h`);
});

console.log('\n── 5. Seasons fitted to real traffic ──────────────────────────────');
const qShare = (prof, q) => (prof[q * 3 + 1] + prof[q * 3 + 2] + prof[q * 3 + 3]) / prof.slice(1).reduce((s, x) => s + x, 0);
test('v2 games fly fitted seasons; classic games keep the archetype curve', () => {
  setDemandModel(DEMAND_MODEL_CLASSIC);
  const classic = getSeasonalProfile('MIA', 'JFK');
  assert.ok(qShare(classic, 0) < 0.24, 'classic MIA–JFK should still be the summer-peak curve');
  setDemandModel(2);
  const v2 = getSeasonalProfile('MIA', 'JFK');
  assert.ok(qShare(v2, 0) > qShare(v2, 2) + 0.03, `v2 MIA–JFK: Q1 ${qShare(v2, 0).toFixed(3)} vs Q3 ${qShare(v2, 2).toFixed(3)} — Florida peaks in winter`);
  assert.ok(qShare(getSeasonalProfile('SEA', 'BOS'), 2) > 0.27, 'Seattle–Boston should peak in summer');
  setDemandModel(DEMAND_MODEL_CLASSIC);
});
test('every fitted season averages exactly 1 (moves demand between months, adds none)', () => {
  for (const [c, v] of Object.entries(SEASONS)) {
    assert.equal(v.length, 12, c);
    assert.ok(Math.abs(v.reduce((s, x) => s + x, 0) / 12 - 1) < 0.002, `${c} mean`);
    // Ski-only markets (Vail, Steamboat) really do swing ~0.25x to ~3x.
    assert.ok(v.every((x) => x > 0.15 && x < 4), `${c} range`);
  }
});
test('Australia: Darwin peaks in the dry season, Hobart in the summer holidays', () => {
  setDemandModel(2);
  const drw = seasonalProfileForAirport('DRW'), hba = seasonalProfileForAirport('HBA');
  assert.ok(drw[7] > drw[1] * 1.5, 'Darwin July vs January');
  assert.ok(hba[1] > hba[7] * 1.4, 'Hobart January vs July');
  setDemandModel(DEMAND_MODEL_CLASSIC);
});
test('directional skew keeps the archetype curves (fitted totals carry no direction)', () => {
  setDemandModel(2);
  const v2 = directionalSeasonalSkew('MIA', 'JFK', 1);
  setDemandModel(DEMAND_MODEL_CLASSIC);
  assert.equal(v2, directionalSeasonalSkew('MIA', 'JFK', 1));
});

console.log('\n── 6. Fares and flight costs ──────────────────────────────────────');
const typeOf = (id) => getAircraftType(id);
test('classic fares are untouched; v2 moves DOMESTIC fares 2/3 of the way to the real curve', () => {
  setDemandModel(DEMAND_MODEL_CLASSIC);
  assert.deepEqual([referencePrice('BOS', 'LGA'), referencePrice('JFK', 'LAX'), referencePrice('JFK', 'LHR')], [93, 381, 503]);
  setDemandModel(2);
  const km = distanceKm(getAirport('JFK'), getAirport('LAX'));
  const classic = (80 + km * 0.09) * 0.87, real = DEMAND_V2.fares.base + DEMAND_V2.fares.perKm * km;
  assert.equal(referencePrice('JFK', 'LAX'), Math.round(classic * Math.pow(real / classic, 2 / 3)));
  assert.ok(referencePrice('BOS', 'LGA') > 93, 'short domestic hops get dearer');
  assert.ok(referencePrice('JFK', 'LAX') < 381, 'long domestic stages get cheaper');
  assert.equal(referencePrice('JFK', 'LHR'), 503, 'international pairs keep the classic ladder');
  assert.ok(referencePrice('FRA', 'MUC') !== (setDemandModel(1), referencePrice('FRA', 'MUC')), 'domestic means any country, not just the US');
  setDemandModel(DEMAND_MODEL_CLASSIC);
});
test('per-flight cost km: identity in classic; in v2 dearer short, cheaper long, unchanged at the pivot', () => {
  const nb = typeOf('a320neo'), wb = typeOf('a350900');
  setDemandModel(DEMAND_MODEL_CLASSIC);
  for (const km of [300, 1200, 4000]) assert.equal(sectorCostKm(nb, km), km);
  setDemandModel(2);
  const p = DEMAND_V2.flight['Narrow Body'];
  assert.ok(Math.abs(sectorCostKm(nb, p.pivotKm) - p.pivotKm) < 1e-9, 'a typical-mission sector costs what it always did');
  assert.ok(sectorCostKm(nb, 300) > 300 && sectorCostKm(nb, 4000) < 4000);
  assert.ok(Math.abs(sectorCostKm(wb, DEMAND_V2.flight['Wide Body'].pivotKm) - DEMAND_V2.flight['Wide Body'].pivotKm) < 1e-9);
  setDemandModel(DEMAND_MODEL_CLASSIC);
});
test('v2 adds taxi time to block hours, and the schedule agrees with the block clock', () => {
  const nb = typeOf('a320neo');
  setDemandModel(DEMAND_MODEL_CLASSIC);
  const b1 = blockTimeHours(300, nb), f1 = maxFrequency(300, nb);
  setDemandModel(2);
  assert.ok(Math.abs(blockTimeHours(300, nb) - b1 - DEMAND_V2.flight['Narrow Body'].taxiH) < 1e-9);
  assert.ok(maxFrequency(300, nb) < f1, 'a short-haul tail flies fewer sectors a week');
  const rot = routeRotation({ origin: 'BOS', destination: 'LGA', stops: ['BOS', 'LGA'] }, nb);
  const km = distanceKm(getAirport('BOS'), getAirport('LGA'));
  assert.ok(Math.abs(rot.durMin - 2 * blockTimeHours(km, nb) * 60) <= 2, `rotation ${rot.durMin} min vs block ${2 * blockTimeHours(km, nb) * 60}`);
  setDemandModel(DEMAND_MODEL_CLASSIC);
});
test('route fuel and crew bill the v2 sector km, and a pivot-length route costs the same in both models', () => {
  const nb = typeOf('a320neo');
  const run = (o, d) => simulateRoute({ id: 'r1', origin: o, destination: d, aircraftId: 'a1', weeklyFrequency: 10, ticketPrice: 150, weeksOpen: 200 },
    { id: 'a1', typeId: 'a320neo', ownershipType: 'leased', ageWeeks: 0, config: defaultConfig(nb.seats) }, { month: 6 }, null, 1, null, [], null, null, 1, null);
  setDemandModel(DEMAND_MODEL_CLASSIC); const shortC = run('BOS', 'LGA'), longC = run('JFK', 'LAX');
  setDemandModel(2); const shortV = run('BOS', 'LGA'), longV = run('JFK', 'LAX');
  assert.ok(shortV.fuelCost > shortC.fuelCost * 1.5 && shortV.crewCost > shortC.crewCost * 1.5, 'a 300 km hop pays its take-off chunk');
  assert.ok(longV.fuelCost < longC.fuelCost && longV.crewCost < longC.crewCost, 'a 4,000 km stage is cheaper per km');
  const ratio = (r, c) => r.fuelCost / c.fuelCost;
  const kmS = distanceKm(getAirport('BOS'), getAirport('LGA'));
  assert.ok(Math.abs(ratio(shortV, shortC) - sectorCostKm(nb, kmS) / kmS) < 0.01);
  setDemandModel(DEMAND_MODEL_CLASSIC);
});
test('charters cost their legs the same way', () => {
  const nb = typeOf('a320neo');
  const cost = () => missionCostPerWeek({ originCode: 'BOS', destCode: 'LGA', type: nb, flightsPerWeek: 7, fuelIndex: 1, fuelMod: 1 });
  setDemandModel(DEMAND_MODEL_CLASSIC); const c = cost();
  setDemandModel(2); const v = cost();
  setDemandModel(DEMAND_MODEL_CLASSIC);
  assert.ok(JSON.stringify(v) !== JSON.stringify(c), 'charter costs ignored the v2 sector km');
});

setDemandModel(DEMAND_MODEL_CLASSIC);
console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
