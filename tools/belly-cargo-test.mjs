// Belly cargo engine (claude/belly-cargo-design.md, build step 1).
//
//   node --import ./tools/_register-loader.mjs tools/belly-cargo-test.mjs
import assert from 'node:assert/strict';
import { gameReducer, freshState } from '../src/store/GameContext.jsx';
import { getAircraftType, typicalSeatsOf } from '../src/data/aircraft.js';
import { cargoCityPairDemand, routeDistance } from '../src/utils/market.js';
import { defaultClassPrices, referencePrice, simulateCargoNetwork } from '../src/utils/simulation.js';
import {
  BELLY, BELLY_RATE_MAX_MULT, bellyHoldTonnes, bellyCapacityTonnes, bellyReferenceRate, buildBellyMarket, bellyEconomics, rivalBellyPnL,
} from '../src/models/bellyCargo.js';
import { projectWeek } from '../src/utils/financeProjection.js';

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.log(`  ✗ ${name}\n      ${(e.stack || e.message).split('\n').slice(0, 4).join('\n      ')}`); failed++; }
}
const realRandom = Math.random;
const B789 = getAircraftType('b7879'), A320 = getAircraftType('a320neo'), F = getAircraftType('b777f');

console.log('\nBelly cargo\n');

test('hold: widebodies carry tonnes, narrowbodies about one, freighters and Concorde none', () => {
  assert.ok(bellyHoldTonnes(B789) > 10 && bellyHoldTonnes(B789) < 20);
  assert.ok(bellyHoldTonnes(A320) > 0.5 && bellyHoldTonnes(A320) < 2);
  assert.equal(bellyHoldTonnes(F), 0);
  assert.equal(bellyHoldTonnes(getAircraftType('concorde')), 0);
  assert.ok(bellyHoldTonnes(getAircraftType('a380')) < bellyHoldTonnes(getAircraftType('b747400')), 'the A380 hold is the smaller one');
});

test('capacity: the hold binds short, weight binds long, nothing at the range limit', () => {
  const typ = typicalSeatsOf(B789), hold = bellyHoldTonnes(B789);
  assert.equal(bellyCapacityTonnes(B789, typ, 5500), hold);
  const long = bellyCapacityTonnes(B789, typ, 12000);
  assert.ok(long > 0 && long < hold, `weight-limited at 12,000 km, got ${long}`);
  assert.equal(bellyCapacityTonnes(B789, typ, B789.range), 0);
  assert.equal(bellyCapacityTonnes(B789, typ, B789.range + 500), 0);
  assert.ok(bellyCapacityTonnes(B789, B789.seats, 12000) < long, 'a packed cabin leaves less weight for freight');
});

test('a lane never carries more belly freight than its general pool, however many fly it', () => {
  const offers = Array.from({ length: 12 }, (_, i) => ({ id: 'r' + i, origin: 'JFK', destination: 'LHR', weeklyFrequency: 28, capPerFlight: 15 }));
  const m = buildBellyMarket({ offers, month: 6 });
  const carried = [...m.player.values()].reduce((s, r) => s + r.tonnesOneWay, 0);
  const general = cargoCityPairDemand('JFK', 'LHR', 6) * (1 - BELLY.mainDeckShare);
  assert.ok(carried <= general + 1e-6, `${carried} > ${general}`);
  assert.ok(carried > general * 0.9, 'twelve airlines\' worth of holds should take nearly all of it');
  assert.ok(Math.abs(m.poolFactor('JFK', 'LHR') - (1 - carried / cargoCityPairDemand('JFK', 'LHR', 6))) < 1e-9);
  assert.ok(m.poolFactor('JFK', 'LHR') >= BELLY.mainDeckShare, 'freighters keep the main-deck share');
});

test('one flight never fills past the ceiling; an empty lane leaves freighters untouched', () => {
  const m = buildBellyMarket({ offers: [{ id: 'a', origin: 'JFK', destination: 'LHR', weeklyFrequency: 7, capPerFlight: 14 }], month: 6 });
  const r = m.player.get('a');
  assert.ok(r.tonnesOneWay <= 7 * 14 * BELLY.fillCeiling);
  assert.ok(r.tonnesOneWay >= Math.floor(7 * 14 * BELLY.fillCeiling) - 1, 'a single 787 a day on a big lane sells its ceiling');
  assert.equal(m.poolFactor('HKG', 'ANC'), 1);
});

test('pricing: a dearer rate carries less, and a rival\'s capacity dilutes you', () => {
  const lane = { origin: 'LAX', destination: 'SYD', weeklyFrequency: 60, capPerFlight: 15 };
  const ref = bellyReferenceRate('LAX', 'SYD');
  const at = (rate) => buildBellyMarket({ offers: [{ id: 'a', ...lane, rate }], month: 6 }).player.get('a').tonnesOneWay;
  assert.ok(at(ref * 1.5) < at(ref), 'pricing above the market must lose tonnes');
  const alone = at(ref);
  const rival = { id: 'x', tier: 'legacy', routes: { 'LAX-SYD': { aircraftType: 'b7879', seats: 290, frequency: 60 } } };
  const shared = buildBellyMarket({ offers: [{ id: 'a', ...lane }], competitors: [rival], month: 6 });
  assert.ok(shared.player.get('a').tonnesOneWay < alone);
  assert.ok(shared.rival('x', 'LAX-SYD').tonnes > 0);
  const budget = { ...rival, id: 'y', tier: 'budget' };
  assert.equal(buildBellyMarket({ competitors: [budget], month: 6 }).rival('y', 'LAX-SYD'), null, 'budget carriers sell no belly space');
});

test('economics: revenue at the rate, handling at both ends, fuel that rises with the fuel price', () => {
  const e = bellyEconomics('JFK', 'LHR', 50, bellyReferenceRate('JFK', 'LHR'), 1);
  assert.ok(e.revenue > 0 && e.handlingCost > 0 && e.fuelCost > 0);
  assert.equal(e.profit, e.revenue - e.handlingCost - e.fuelCost);
  assert.ok(e.fuelCost / e.revenue > 0.1 && e.fuelCost / e.revenue < 0.5, `fuel share ${e.fuelCost / e.revenue}`);
  assert.ok(bellyEconomics('JFK', 'LHR', 50, bellyReferenceRate('JFK', 'LHR'), 1.5).fuelCost > e.fuelCost * 1.4);
  const rival = { id: 'x', tier: 'legacy', routes: { 'JFK-LHR': { aircraftType: 'b7879', seats: 290, frequency: 14 } } };
  const m = buildBellyMarket({ competitors: [rival], month: 6 });
  const p = rivalBellyPnL(m, rival, 'JFK-LHR', 1);
  assert.ok(p && p.revenue > 0 && p.profit < p.revenue && p.profit > 0);
});

function airline(belly) {
  let seed = 31337; Math.random = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  let s = gameReducer(freshState(), { type: 'START_GAME', airlineName: 'B', hub: 'JFK', enableObjectives: false, productionLines: false, bellyCargo: belly });
  s = { ...s, cash: 5e9, newWorldRestrictions: true, competitors: [] };
  s = gameReducer(s, { type: 'BUY_AIRCRAFT', typeId: 'b7879' });
  s = gameReducer(s, { type: 'ADD_GATE', airportCode: 'LHR' });
  s = gameReducer(s, { type: 'ADD_ROUTE', aircraftId: s.fleet[0].id, origin: 'JFK', destination: 'LHR', weeklyFrequency: 6 });
  s = { ...s, routePricing: { ...s.routePricing, 'JFK-LHR': defaultClassPrices(Math.round(referencePrice('JFK', 'LHR'))) } };
  if (!s.routes.length) throw new Error('route did not open: ' + s.error);
  for (const g of ['pilots', 'cabinCrew', 'groundStaff', 'maintenanceTeam']) s = gameReducer(s, { type: 'HIRE_CREW', group: g, bodies: 200, startNow: true });
  Math.random = () => 0.9999999;   // no events, no faults
  // ONE week: from the second week on the extra revenue has fed back into the
  // airline (brand spend, awareness), and the two games are no longer twins.
  return gameReducer(s, { type: 'ADVANCE_WEEK' });
}

test('the tick: belly worlds book it on the route and in the totals; other games carry no trace', () => {
  try {
    // The first game in a process draws a few more random numbers than later
    // ones (lazy caches), so it rolls a different world: discard one first.
    airline(false);
    const off = airline(false), on = airline(true);
    const a = off.lastReport, b = on.lastReport, ra = a.routeResults[0], rb = b.routeResults[0];
    assert.ok(!('totalBellyRevenue' in a) && !('bellyRevenue' in ra), 'a game without the flag must not grow belly keys');
    assert.ok(rb.bellyRevenue > 0 && rb.bellyTonnes > 0);
    assert.equal(rb.passengers, ra.passengers, 'belly must not move passengers');
    assert.equal(rb.revenue - ra.revenue, rb.bellyRevenue);
    assert.equal(b.totalBellyRevenue, rb.bellyRevenue);
    assert.equal(b.totalRevenue - a.totalRevenue, rb.bellyRevenue);
    assert.equal(b.totalFuel - a.totalFuel, rb.bellyFuelCost);
    assert.equal(b.totalGroundHandling - a.totalGroundHandling, rb.bellyHandlingCost);
    assert.equal(rb.profit - ra.profit, rb.bellyRevenue - rb.bellyHandlingCost - rb.bellyFuelCost);
  } finally { Math.random = realRandom; }
});

test('freighters see the smaller lane only when holds carried something', () => {
  const fleet = [{ id: 'f1', typeId: 'b777f' }];
  const routes = [{ id: 'c1', aircraftId: 'f1', origin: 'JFK', destination: 'LHR', weeklyFrequency: 14 }];
  const full = simulateCargoNetwork(routes, fleet, { gameDate: { month: 6 } }).results.get('c1');
  const same = simulateCargoNetwork(routes, fleet, { gameDate: { month: 6 }, bellyPoolFactor: () => 1 }).results.get('c1');
  const less = simulateCargoNetwork(routes, fleet, { gameDate: { month: 6 }, bellyPoolFactor: () => 0.6 }).results.get('c1');
  assert.equal(same.tonnes, full.tonnes);
  assert.ok(less.demandTonnes < full.demandTonnes * 0.65 && less.demandTonnes > full.demandTonnes * 0.55);
  assert.ok(routeDistance('JFK', 'LHR') > 0);
});

test('new games carry the flag, a save keeps it and its rates, and an older save never gains it', () => {
  try {
    const on = airline(true), off = airline(false);
    assert.equal(on.bellyCargoWorld, true);
    assert.ok(!('bellyCargoWorld' in off));
    let s = gameReducer(on, { type: 'SET_BELLY_RATE', origin: 'LHR', destination: 'JFK', rate: 0.5 });
    const back = gameReducer(freshState(), { type: 'LOAD_STATE', payload: JSON.parse(JSON.stringify(s)) });
    assert.equal(back.bellyCargoWorld, true);
    assert.equal(back.bellyRates['JFK-LHR'], 0.5);
    const old = gameReducer(freshState(), { type: 'LOAD_STATE', payload: JSON.parse(JSON.stringify(off)) });
    assert.ok(!old.bellyCargoWorld && !old.bellyRates);
    assert.equal(gameReducer(off, { type: 'SET_BELLY_RATE', origin: 'LHR', destination: 'JFK', rate: 0.5 }), off, 'no rates outside a belly world');
  } finally { Math.random = realRandom; }
});

test('rates: set, clamp, return to the market, and bulk changes', () => {
  try {
    const s0 = airline(true);
    const ref = bellyReferenceRate('JFK', 'LHR');
    let s = gameReducer(s0, { type: 'SET_BELLY_RATE', origin: 'JFK', destination: 'LHR', rate: ref * 10 });
    assert.equal(s.bellyRates['JFK-LHR'], Math.round(ref * BELLY_RATE_MAX_MULT * 1000) / 1000, 'capped at the top of the band');
    s = gameReducer(s, { type: 'SET_BELLY_RATE', origin: 'JFK', destination: 'LHR', rate: null });
    assert.ok(!('JFK-LHR' in s.bellyRates), 'null hands the pair back to the market');
    s = gameReducer(s, { type: 'BULK_SET_BELLY_RATES', mode: 'pct', value: 10 });
    assert.ok(Math.abs(s.bellyRates['JFK-LHR'] - ref * 1.1) < 0.0011);
    s = gameReducer(s, { type: 'BULK_SET_BELLY_RATES', mode: 'pct', value: 10, routeIds: ['nope'] });
    assert.ok(Math.abs(s.bellyRates['JFK-LHR'] - ref * 1.1) < 0.0011, 'routeIds limits the change');
    s = gameReducer(s, { type: 'BULK_SET_BELLY_RATES', mode: 'reference' });
    assert.deepEqual(s.bellyRates, {});
  } finally { Math.random = realRandom; }
});

test('a dearer rate reaches the tick, and the forecast books the same belly the tick does', () => {
  try {
    const base = airline(true);
    const dear = gameReducer(base, { type: 'SET_BELLY_RATE', origin: 'JFK', destination: 'LHR', rate: bellyReferenceRate('JFK', 'LHR') * 2.5 });
    Math.random = () => 0.9999999;
    const proj = projectWeek(dear);
    const next = gameReducer(dear, { type: 'ADVANCE_WEEK' });
    const cheap = gameReducer(base, { type: 'ADVANCE_WEEK' });
    const rr = next.lastReport.routeResults[0];
    assert.equal(rr.bellyRate, dear.bellyRates['JFK-LHR']);
    assert.ok(rr.bellyTonnes < cheap.lastReport.routeResults[0].bellyTonnes, 'pricing well above the market must carry less');
    assert.equal(proj.report.totalBellyRevenue, next.lastReport.totalBellyRevenue);
    assert.equal(proj.report.routeResults[0].bellyTonnes, rr.bellyTonnes);
    assert.equal(next.financialHistory.at(-1).bellyRevenue, next.lastReport.totalBellyRevenue);
  } finally { Math.random = realRandom; }
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
