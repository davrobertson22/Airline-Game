// Aeroplanes stop being permanently full.
//
// D10. Every route filled seats with a flat min(demand, capacity), so the moment
//      weekly demand exceeded weekly seats the airline banked every one of them:
//      100.0% load factor, forever, in both directions, on every route in the
//      game. Measured on HEAD: a twelve-route network reads 100.00% mean load
//      factor with 100% of routes pinned at exactly 100.0%.
//
//      Real carriers sit around 83% system-wide WHILE their best flights sell
//      out, because demand arrives per departure, per day and per direction and
//      you size for the peak — Friday is full, Tuesday is 60%. Pooling a week
//      into a single number erases that, and it is the largest single term in
//      margins running several times reality. The per-unit costs were never the
//      problem; the denominator was.
//
//   node tools/load-factor-test.mjs

import assert from 'node:assert/strict';
import {
  expectedCarried, weeklyLoadJitter, loadDemandScale,
  LOAD_CEILING, LOAD_JITTER, DEMAND_CV,
} from '../src/utils/market.js';
import {
  weeklyTick, simulateRoute, referencePrice, routePairKey,
  defaultClassPrices, defaultConfig,
} from '../src/utils/simulation.js';
import { getAircraftType, AIRCRAFT_TYPES } from '../src/data/aircraft.js';

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.log(`  ✗ ${name}\n      ${(e.stack || e.message).split('\n').slice(0, 4).join('\n      ')}`); failed++; }
}
const realWarn = console.warn;
const quietly = (fn) => { console.warn = () => {}; try { return fn(); } finally { console.warn = realWarn; } };

// ── The spill function ──────────────────────────────────────────────────────

console.log('\n── Expected seats sold ──────────────────────────────────');

test('a route nobody wants to fly sells nothing', () => {
  assert.equal(expectedCarried(0, 100), 0);
  assert.equal(expectedCarried(100, 0), 0);
  assert.equal(expectedCarried(-5, 100), 0);
});

test('you can never sell more than you have, or more than they want', () => {
  for (const [D, C] of [[100, 50], [50, 100], [1000, 1000], [7, 3], [1e6, 12]]) {
    const carried = expectedCarried(D, C);
    assert.ok(carried <= Math.min(D, C) + 1e-9, `${carried} exceeds min(${D}, ${C})`);
    assert.ok(carried >= 0);
  }
});

test('an empty aeroplane loses almost nothing to spill', () => {
  // A route running well under capacity has no peaks it cannot absorb. This is
  // what makes the model progressive rather than a flat tax.
  const carried = expectedCarried(600, 1000);
  assert.ok(carried / 600 > 0.99, `a 60%-full route kept ${(carried / 600 * 100).toFixed(1)}% of its demand`);
});

test('a route sized exactly right lands near seven-eighths full', () => {
  // Demand equal to capacity is the airline sizing correctly, and it still
  // cannot sell every seat — the peak week and the trough week are the same
  // aeroplane. This is the calibration point for DEMAND_CV: at 0.30 parity fell
  // to 85%, which reads as punishing a schedule that is right.
  const lf = loadDemandScale(1000, 1000) * 1000 / 1000;
  assert.ok(lf > 0.86 && lf < 0.90, `parity landed at ${(lf * 100).toFixed(1)}%`);
  // Spill alone, before the ceiling, is the gentler number — the ceiling is the
  // part that says some seats were never sellable at any demand.
  const spillOnly = expectedCarried(1000, 1000) / 1000;
  assert.ok(spillOnly > lf, 'the ceiling costs something on top of the spill');
});

test('an oversubscribed route asymptotes to its capacity, never past it', () => {
  const a = expectedCarried(2000, 1000) / 1000;
  const b = expectedCarried(20000, 1000) / 1000;
  assert.ok(a > 0.97 && a <= 1);
  assert.ok(b > 0.999 && b <= 1, `deep oversubscription reached ${(b * 100).toFixed(3)}% of capacity`);
  assert.ok(b >= a, 'more demand never sells fewer seats');
});

test('more demand is never worse, and more seats are never worse', () => {
  let prev = -1;
  for (let D = 100; D <= 3000; D += 100) {
    const v = expectedCarried(D, 1000);
    assert.ok(v >= prev - 1e-9, `demand ${D} sold fewer than ${D - 100}`);
    prev = v;
  }
  prev = -1;
  for (let C = 100; C <= 3000; C += 100) {
    const v = expectedCarried(1000, C);
    assert.ok(v >= prev - 1e-9, `capacity ${C} sold fewer than ${C - 100}`);
    prev = v;
  }
});

test('a wider demand spread sells fewer seats', () => {
  assert.ok(expectedCarried(1000, 1000, 0.40) < expectedCarried(1000, 1000, 0.10));
  assert.ok(DEMAND_CV > 0 && DEMAND_CV < 1);
});

// ── The weekly dice ─────────────────────────────────────────────────────────

console.log('\n── This week ────────────────────────────────────────────');

test('the same week replays to the same number', () => {
  assert.equal(weeklyLoadJitter('JFK-LAX', 120), weeklyLoadJitter('JFK-LAX', 120));
  assert.equal(weeklyLoadJitter('JFK-LAX', 120), weeklyLoadJitter('JFK-LAX', 120.9),
    'a fractional week is the same week');
});

test('every week lands inside the stated band', () => {
  for (let w = 0; w < 500; w++) {
    const j = weeklyLoadJitter('JFK-LAX', w);
    assert.ok(j >= 1 - LOAD_JITTER - 1e-12 && j <= 1 + LOAD_JITTER + 1e-12, `week ${w} gave ${j}`);
  }
});

test('consecutive weeks actually differ', () => {
  // The hash needed a finalizer for this. FNV-1a alone keeps the difference
  // between "r|31" and "r|32" in the low bits, and the division below reads the
  // high ones — every week would have landed at almost exactly 0.5 and the
  // whole mechanism would have been a very expensive constant.
  const js = Array.from({ length: 200 }, (_, w) => weeklyLoadJitter('JFK-LAX', w));
  const spread = Math.max(...js) - Math.min(...js);
  assert.ok(spread > LOAD_JITTER, `200 consecutive weeks only spanned ${spread.toFixed(5)}`);
  const mean = js.reduce((s, v) => s + v, 0) / js.length;
  assert.ok(Math.abs(mean - 1) < 0.004, `the dice should be fair; mean was ${mean.toFixed(5)}`);
});

test('different routes have different weeks', () => {
  const a = weeklyLoadJitter('JFK-LAX', 120);
  const b = weeklyLoadJitter('JFK-ORD', 120);
  assert.notEqual(a, b);
});

// ── The scale ───────────────────────────────────────────────────────────────

console.log('\n── What a route is actually scaled by ───────────────────');

test('a route with room to spare is barely touched', () => {
  assert.ok(loadDemandScale(400, 1000) > 0.995);
});

test('a full route is held under the ceiling', () => {
  const scale = loadDemandScale(5000, 1000);
  assert.ok(scale * 5000 / 1000 <= LOAD_CEILING + 1e-9,
    `sold ${(scale * 5000 / 1000 * 100).toFixed(2)}% of the aeroplane against a ${LOAD_CEILING * 100}% ceiling`);
});

test('the jitter never pushes a route past its physical seats', () => {
  for (let w = 0; w < 200; w++) {
    const j = weeklyLoadJitter('r', w);
    const sold = loadDemandScale(5000, 1000, j) * 5000;
    assert.ok(sold <= 1000 + 1e-9, `week ${w} sold ${sold} of 1000 seats`);
  }
});

test('an empty or impossible route scales by one rather than by NaN', () => {
  assert.equal(loadDemandScale(0, 1000), 1);
  assert.equal(loadDemandScale(1000, 0), 1);
  assert.equal(loadDemandScale(NaN, 1000), 1);
});

// ── The tick ────────────────────────────────────────────────────────────────

console.log('\n── A week of flying ─────────────────────────────────────');

const NARROW = getAircraftType('a320ceo');
const HUB = 'JFK';
const SPOKES = ['ORD', 'ATL', 'MIA', 'BOS', 'DFW', 'MCO'];

const network = (over = {}) => {
  const fleet = [], routes = [], pricing = {};
  SPOKES.forEach((dest, i) => {
    fleet.push({ id: `a${i}`, typeId: NARROW.id, tailNumber: `N${i}`, status: 'assigned',
                 ageWeeks: 60, ownershipType: 'owned', config: defaultConfig(NARROW.seats) });
    routes.push({ id: `r${i}`, origin: HUB, destination: dest, aircraftId: `a${i}`,
                  weeklyFrequency: 14, weeksOpen: 80, hub: HUB,
                  ticketPrice: Math.round(referencePrice(HUB, dest)), cateringLevel: 'standard' });
    pricing[routePairKey(HUB, dest)] = defaultClassPrices(Math.round(referencePrice(HUB, dest)));
  });
  return {
    phase: 'playing', week: 20, year: 3, hub: HUB, cash: 1e8, awareness: 65, absWeek: 120,
    gates: Object.fromEntries([HUB, ...SPOKES].map(c => [c, 20])),
    fleet, routes, routePricing: pricing, competitors: [], encroachments: {},
    activeEvents: [], loans: [], hedgeContracts: [], financialHistory: [], cargoRoutes: [],
    ...over,
  };
};

test('no route reads exactly one hundred percent any more', () => {
  // THE ARTIFACT. On HEAD every one of these sat at 100.00%, in every week, for
  // the life of the save.
  const r = quietly(() => weeklyTick(network()));
  const pinned = r.routeResults.filter(x => x.loadFactor >= 0.9995);
  assert.deepEqual(pinned.map(x => x.routeId), [],
    'a demand pool bigger than the aeroplane is not the same as an aeroplane that sells out');
});

test('a saturated network settles at the ceiling, not at parity', () => {
  // UPDATED (H10). This fixture is not a "typical" network: every one of its six
  // JFK trunk routes has a demand pool 7-13x the seats it flies one-way (ORD
  // 25,449 vs 2,604; MCO 33,880 vs 2,604). expectedCarried's documented promise
  // for that case is the structural ceiling — "a deeply oversubscribed route
  // asymptotes to the ceiling; a route at demand ≈ capacity lands near 87%".
  //
  // This assertion used to demand the 80-90% band, and got it, because
  // simulateRoute handed loadDemandScale the pool computeMarketShare had ALREADY
  // capped at the seat count. Every route in the game therefore reported
  // demand == capacity and the asymptote branch was unreachable: this network
  // read 87.40% mean (85.48-89.52 per route) and a route at true parity read the
  // same, which is the one distinction the spill model exists to draw. Fed the
  // demand the market actually generated it now reads 95.08% mean
  // (92.97-97.35) — LOAD_CEILING × the ±2.5% weekly jitter, exactly.
  //
  // The real-world ~83% system figure is a MIXED network's figure and is pinned
  // by the parity cases above and by demand-conservation-test; an all-saturated
  // fixture landing there was the artifact, not the target.
  const r = quietly(() => weeklyTick(network()));
  const mean = r.routeResults.reduce((s, x) => s + x.loadFactor, 0) / r.routeResults.length;
  assert.ok(mean > LOAD_CEILING - LOAD_JITTER - 1e-9 && mean < LOAD_CEILING + LOAD_JITTER + 1e-9,
    `mean load factor ${(mean * 100).toFixed(2)}% — a network this oversubscribed belongs at `
    + `the ${(LOAD_CEILING * 100).toFixed(0)}% ceiling ±${(LOAD_JITTER * 100).toFixed(1)}%`);
});

test('routes still differ from one another', () => {
  // A flat 87% everywhere would be a different constant, not a fix.
  const r = quietly(() => weeklyTick(network()));
  const lfs = r.routeResults.map(x => x.loadFactor);
  assert.ok(Math.max(...lfs) - Math.min(...lfs) > 0.001,
    `every route landed on ${(lfs[0] * 100).toFixed(3)}%`);
});

test('the same save replays to the same week', () => {
  const a = quietly(() => weeklyTick(network()));
  const b = quietly(() => weeklyTick(network()));
  assert.deepEqual(a.routeResults.map(x => x.passengers), b.routeResults.map(x => x.passengers));
  assert.equal(a.totalRevenue, b.totalRevenue);
});

test('a different week is a different week', () => {
  const a = quietly(() => weeklyTick(network({ absWeek: 120 })));
  const b = quietly(() => weeklyTick(network({ absWeek: 121 })));
  assert.notDeepEqual(a.routeResults.map(x => x.passengers), b.routeResults.map(x => x.passengers));
});

test('two aeroplanes on one pair still land together', () => {
  // The jitter is keyed on the PAIR, not the route, for exactly this reason:
  // aircraft sharing a lane pool their demand and are required to land on the
  // same load factor, and per-route dice would have pulled them apart by up to
  // five points — tripping the pooling invariant that exists to catch it.
  const st = network();
  st.fleet.push({ id: 'x', typeId: NARROW.id, tailNumber: 'NX', status: 'assigned',
                  ageWeeks: 60, ownershipType: 'owned', config: defaultConfig(NARROW.seats) });
  st.routes.push({ id: 'rx', origin: HUB, destination: SPOKES[0], aircraftId: 'x',
                   weeklyFrequency: 14, weeksOpen: 80, hub: HUB,
                   ticketPrice: Math.round(referencePrice(HUB, SPOKES[0])), cateringLevel: 'standard' });
  const r = quietly(() => weeklyTick(st));
  const by = Object.fromEntries(r.routeResults.map(x => [x.routeId, x.loadFactor]));
  assert.ok(Math.abs(by.r0 - by.rx) < 0.001,
    `${(by.r0 * 100).toFixed(2)}% and ${(by.rx * 100).toFixed(2)}% on the same lane`);
  assert.deepEqual(r.poolingAnomalies, [], 'and the invariant agrees');
});

test('a half-empty route is left alone', () => {
  // Nothing about this model should touch an airline that is struggling to fill
  // its aeroplanes. It exists to stop a full one from being perfectly full.
  //
  // The frequency here was 42/wk, and that stopped producing a half-empty
  // aeroplane some time before the metro rework: this assertion was ALREADY
  // failing on ~/w3/head/tw at 80.8%, i.e. the fixture had quietly become a
  // nearly-full route and was testing the opposite of what it says. (Airport
  // appeal, wired in the metro rework, trims JFK's domestic pool and moved it
  // to 78.3% — still nowhere near under-filled.) 56/wk restores the stated
  // intent with room to spare: measured 58.9% here, and the spill scale the
  // assertion actually cares about comes back at 0.9994.
  const st = network();
  st.fleet = [st.fleet[0]];
  st.routes = [{ ...st.routes[0], destination: 'HSV', weeklyFrequency: 56,
                 ticketPrice: Math.round(referencePrice(HUB, 'HSV')) }];
  st.routePricing = { [routePairKey(HUB, 'HSV')]:
    defaultClassPrices(Math.round(referencePrice(HUB, 'HSV'))) };
  st.gates = { [HUB]: 40, HSV: 40 };
  const r = quietly(() => weeklyTick(st));
  const lf = r.routeResults[0].loadFactor;
  assert.ok(lf < 0.75, `fixture should be under-filled, got ${(lf * 100).toFixed(1)}%`);
  const seats = 56 * NARROW.seats;
  const scale = loadDemandScale(lf * seats, seats);
  assert.ok(scale > 0.985, `an under-filled aeroplane lost ${((1 - scale) * 100).toFixed(2)}% to spill`);
});

// ── Freight ─────────────────────────────────────────────────────────────────

console.log('\n── Freight is not exempt ────────────────────────────────');

test('a full freighter is not perfectly full either', () => {
  const freighter = AIRCRAFT_TYPES
    .filter(t => t.freighter).sort((a, b) => a.payloadTonnes - b.payloadTonnes)[0];
  const st = network();
  st.fleet = [{ id: 'f1', typeId: freighter.id, tailNumber: 'NF', status: 'assigned',
                ageWeeks: 60, ownershipType: 'owned' }];
  st.routes = [];
  st.cargoRoutes = [{ id: 'c1', origin: HUB, destination: 'ORD', aircraftId: 'f1',
                      weeklyFrequency: 3, weeksOpen: 80, hub: HUB, cargo: true }];
  const r = quietly(() => weeklyTick(st));
  const cr = r.cargoRouteResults?.[0];
  assert.ok(cr, 'fixture should produce a freight result');
  assert.ok(cr.loadFactor < 0.9995, `freight sat at ${(cr.loadFactor * 100).toFixed(2)}%`);
});

// ── Previews ────────────────────────────────────────────────────────────────

console.log('\n── What a forecast promises ─────────────────────────────');

test('a forecast is held to the same ceiling the week is', () => {
  // The structural half of the model is in simulateRoute itself, so a preview
  // cannot promise a hundred percent on a route the tick will fill to ninety.
  const st = network();
  const preview = simulateRoute(
    { ...st.routes[0], classPrices: st.routePricing[routePairKey(HUB, SPOKES[0])] },
    st.fleet[0], { week: 20, month: 6 });
  assert.ok(preview.loadFactor < 0.9995,
    `the forecast promised ${(preview.loadFactor * 100).toFixed(2)}%`);
});

test('a forecast shows the expected week, within the stated band of the real one', () => {
  // The dice belong to the tick — a forecast for next week should not pretend to
  // know which way they fall. The gap is bounded and symmetric, and this is the
  // assertion that keeps it that way rather than leaving it unexamined.
  const st = network();
  const tick = quietly(() => weeklyTick(st));
  for (let i = 0; i < SPOKES.length; i++) {
    const preview = simulateRoute(
      { ...st.routes[i], classPrices: st.routePricing[routePairKey(HUB, SPOKES[i])] },
      st.fleet[i], { week: 20, month: 6 });
    const actual = tick.routeResults.find(x => x.routeId === `r${i}`);
    const gap = Math.abs(actual.loadFactor / preview.loadFactor - 1);
    assert.ok(gap <= LOAD_JITTER + 0.005,
      `${SPOKES[i]}: forecast ${(preview.loadFactor * 100).toFixed(2)}% vs week ` +
      `${(actual.loadFactor * 100).toFixed(2)}% — ${(gap * 100).toFixed(2)}% apart`);
  }
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
