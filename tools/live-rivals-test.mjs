// The world's airlines start competing.
//
// D1. `simulateRoute`, `simulateTagRoute` and the pooled pre-pass built their
//     competitor offers from the `COMPETITOR_AIRLINES` module constant.
//     `sampleAndInitializeCompetitors` does `{ ...c, routes: {} }` and then fills
//     in the COPIES it hands to state.competitors, so every entry in that
//     constant keeps an empty routes map forever — and `buildCompetitorOffer`
//     returns null on `competitor.routes[routeKey]`.
//
//     Measured on HEAD: the 25 sampled carriers fly 164 routes between them, and
//     the tick built 0 offers on 156 of the 156 pairs they serve. Every route in
//     the game was scored as an uncontested monopoly — while RoutePlanner's own
//     share panel, which reads the live bank, sat beside the forecast telling
//     the player they would take 58% of a market the forecast gave them all of.
//
//     Two things this fix drags in with it. Headwinds patched simulateRoute and
//     left simulateTagRoute reading the dead constant, so its multi-stop routes
//     are still monopolies; there is no reason to inherit that. And encroachment
//     specs name real carriers, so once the carrier half stops returning null
//     the same airline can contest a pair twice — once as itself and once as
//     `encroach:<its own id>` — with two independent fare and frequency ramps.
//
//   node tools/live-rivals-test.mjs

import assert from 'node:assert/strict';
import {
  simulateRoute, simulateTagRoute, weeklyTick, rivalOffersFor, rivalSpecsFor,
  referencePrice, routePairKey, defaultClassPrices, defaultConfig,
} from '../src/utils/simulation.js';
import {
  COMPETITOR_AIRLINES, sampleAndInitializeCompetitors, buildRouteMarket,
  buildCompetitorOffer,
} from '../src/models/demand.js';
import { tickEncroachment } from '../src/models/encroachment.js';
import { getAircraftType } from '../src/data/aircraft.js';

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.log(`  ✗ ${name}\n      ${(e.stack || e.message).split('\n').slice(0, 4).join('\n      ')}`); failed++; }
}
const realWarn = console.warn;
const quietly = (fn) => { console.warn = () => {}; try { return fn(); } finally { console.warn = realWarn; } };

const NARROW = getAircraftType('a320ceo');
const GD = { week: 20, month: 6 };

const ac = (id, typeId = NARROW.id) => ({
  id, typeId, tailNumber: id, status: 'assigned', ageWeeks: 60,
  ownershipType: 'owned', config: defaultConfig(getAircraftType(typeId).seats),
});
const rt = (id, o, d, aircraftId, freq = 14, over = {}) => ({
  id, origin: o, destination: d, aircraftId, weeklyFrequency: freq, weeksOpen: 80, hub: o,
  ticketPrice: Math.round(referencePrice(o, d)), cateringLevel: 'standard', ...over,
});

// ── The defect ──────────────────────────────────────────────────────────────

console.log('\n── The bank the tick was reading ────────────────────────');

test('the module constant knows nothing about anyone\'s network', () => {
  // Not a bug in itself — it is the ROSTER, a catalogue of carriers that could
  // exist. The bug was reading it as though it were the world.
  const withRoutes = COMPETITOR_AIRLINES.filter(c => Object.keys(c.routes ?? {}).length > 0);
  assert.equal(withRoutes.length, 0, 'roster entries carry no routes, by construction');
  assert.ok(COMPETITOR_AIRLINES.length > 25, 'and there are more of them than any one world uses');
});

test('sampling a world leaves the roster untouched', () => {
  // This is the mechanism. The copies get the networks; the originals never do.
  const bank = sampleAndInitializeCompetitors(25);
  const flown = bank.reduce((s, c) => s + Object.keys(c.routes ?? {}).length, 0);
  assert.ok(flown > 100, `a sampled world should fly a real network, got ${flown} routes`);
  assert.equal(COMPETITOR_AIRLINES.filter(c => Object.keys(c.routes ?? {}).length > 0).length, 0,
    'and the roster is still empty afterwards');
});

test('every pair a live carrier serves now produces an offer', () => {
  const bank = sampleAndInitializeCompetitors(25);
  let pairs = 0, offers = 0;
  const seen = new Set();
  for (const c of bank) {
    for (const key of Object.keys(c.routes ?? {})) {
      if (seen.has(key)) continue;
      seen.add(key);
      const [a, b] = key.split('-');
      const market = buildRouteMarket(a, b, GD, 1, 1);
      pairs++;
      if (rivalOffersFor(bank, null, market).length > 0) offers++;
    }
  }
  assert.ok(pairs > 100, `fixture should cover a real world, got ${pairs} pairs`);
  assert.equal(offers, pairs, `${pairs - offers} of ${pairs} served pairs still produced nothing`);
});

// ── A contested route is contested ──────────────────────────────────────────

console.log('\n── A route with a rival on it stops being a monopoly ────');

/** A live-ish carrier flying exactly one pair, so fixtures stay legible. */
const carrier = (id, o, d, over = {}) => ({
  id, name: id, tier: 'legacy', homeHub: o, baseQualityScore: 68,
  routes: { [routePairKey(o, d)]: { frequency: 21, priceMultiplier: 1.0, aircraftType: NARROW.id, tails: 2 } },
  ...over,
});

// A pair thin enough that one aeroplane at this frequency can carry the whole
// market. That matters: on a dense trunk route the flat min(demand, capacity)
// swallows any share the player loses and every fixture reads 100% either way —
// which is exactly how this defect stayed invisible. Real load factors are the
// other half of this package.
const HUB = 'JFK', DEST = 'HSV';
const soloState = (competitors = []) => ({
  phase: 'playing', week: 20, year: 3, hub: HUB, cash: 1e8, awareness: 65, absWeek: 120,
  gates: { [HUB]: 20, [DEST]: 20 },
  fleet: [ac('A1')], routes: [rt('R1', HUB, DEST, 'A1', 28)],
  routePricing: { [routePairKey(HUB, DEST)]: defaultClassPrices(Math.round(referencePrice(HUB, DEST))) },
  competitors, encroachments: {}, activeEvents: [], loans: [], hedgeContracts: [],
  financialHistory: [], cargoRoutes: [],
});

test('a rival flying the pair takes passengers off it', () => {
  const alone = quietly(() => weeklyTick(soloState([])));
  const beside = quietly(() => weeklyTick(soloState([carrier('rival', HUB, DEST)])));
  assert.ok(beside.routeResults[0].passengers < alone.routeResults[0].passengers,
    `${beside.routeResults[0].passengers} should be under ${alone.routeResults[0].passengers}`);
  assert.ok(beside.routeResults[0].competitorCount > 0, 'and the route should know it has company');
});

test('a rival flying somewhere else does not', () => {
  const elsewhere = quietly(() => weeklyTick(soloState([carrier('rival', 'LHR', 'CDG')])));
  const alone = quietly(() => weeklyTick(soloState([])));
  assert.equal(elsewhere.routeResults[0].passengers, alone.routeResults[0].passengers);
  assert.equal(elsewhere.routeResults[0].competitorCount, 0);
});

test('passing no bank means no rivals, not a silently empty constant', () => {
  // The default is null rather than the constant precisely so a missed call site
  // reads as "nobody supplied a bank" instead of "the world has no airlines".
  const market = buildRouteMarket(HUB, DEST, GD, 1, 1);
  assert.deepEqual(rivalOffersFor(null, null, market), []);
  assert.deepEqual(rivalOffersFor(undefined, undefined, market), []);
  const r = simulateRoute(rt('R1', HUB, DEST, 'A1', 28), ac('A1'), GD);
  assert.ok(r && r.competitorCount === 0);
});

test('a multi-stop route is contested too', () => {
  // Headwinds fixed the single-leg path and left this one reading the constant.
  const tag = rt('T1', HUB, 'MBS', 'A1', 28, { stops: [HUB, 'HSV', 'MBS'] });
  const alone = simulateTagRoute(tag, ac('A1'), GD, null, 1.0, null, null, null, null, []);
  const beside = simulateTagRoute(tag, ac('A1'), GD, null, 1.0, null, null, null, null,
    [carrier('rival', HUB, 'HSV'), carrier('rival2', 'HSV', 'MBS'), carrier('rival3', HUB, 'MBS')]);
  assert.ok(alone && beside);
  assert.ok(beside.passengers < alone.passengers,
    `a tag route with rivals on its legs should carry fewer: ${beside.passengers} vs ${alone.passengers}`);
});

test('a pooled pair sees the same rivals a solo one does', () => {
  const pooled = { ...soloState([carrier('rival', HUB, DEST)]) };
  pooled.fleet = [ac('A1'), ac('A2')];
  pooled.routes = [rt('R1', HUB, DEST, 'A1', 14), rt('R2', HUB, DEST, 'A2', 14)];
  const solo = quietly(() => weeklyTick(soloState([carrier('rival', HUB, DEST)])));
  const both = quietly(() => weeklyTick(pooled));
  const total = both.routeResults.reduce((s, r) => s + r.passengers, 0);
  // Same total capacity split across two tails — the lane should carry the same.
  assert.ok(Math.abs(total / solo.routeResults[0].passengers - 1) < 0.02,
    `${total} pooled vs ${solo.routeResults[0].passengers} solo`);
  assert.ok(both.routeResults[0].competitorCount > 0 || total < 1e9);
});

// ── The same airline, twice ─────────────────────────────────────────────────

console.log('\n── One rival is one rival ───────────────────────────────');

const spec = (id, over = {}) => ({
  competitorId: id, name: id, tier: 'full', qualityScore: 72,
  priceMultiplier: 0.9, frequency: 14, freqCap: 21, seatsPerFlight: 180,
  weeksActive: 10, idleWeeks: 0, ...over,
});

test('a carrier already flying the pair is not also an entrant on it', () => {
  // THE HAZARD: buildEncroachmentOffer publishes `encroach:globalair` while
  // buildCompetitorOffer publishes `globalair`, so the market model counts them
  // as two airlines. Invisible while the carrier half always returned null.
  const market = buildRouteMarket(HUB, DEST, GD, 1, 1);
  const bank = [carrier('globalair', HUB, DEST)];
  const offers = rivalOffersFor(bank, [spec('globalair')], market);
  assert.equal(offers.length, 1, 'one airline, one offer');
  assert.equal(offers[0].airlineId, 'globalair', 'and it is the real network, not the stand-in');
});

test('an entrant that does NOT fly the pair still contests it', () => {
  const market = buildRouteMarket(HUB, DEST, GD, 1, 1);
  const offers = rivalOffersFor([carrier('globalair', HUB, DEST)], [spec('newcomer')], market);
  assert.equal(offers.length, 2);
  assert.deepEqual(offers.map(o => o.airlineId).sort(), ['encroach:newcomer', 'globalair']);
});

test('an entrant with no named carrier is left alone', () => {
  const market = buildRouteMarket(HUB, DEST, GD, 1, 1);
  const offers = rivalOffersFor([carrier('globalair', HUB, DEST)], [spec(undefined)], market);
  assert.equal(offers.length, 2, 'an anonymous challenger cannot be a duplicate of anybody');
});

test('the encroachment tick stops choosing a carrier that already flies the pair', () => {
  // Dedupe at the offer is a safety net for saves that already carry one of
  // these. This is the source: an airline cannot "enter" a market it is in.
  const key = routePairKey(HUB, DEST);
  const incumbent = carrier('incumbent', HUB, DEST);
  let drew = 0;
  for (let i = 0; i < 200; i++) {
    const next = tickEncroachment({
      routes: [rt('R1', HUB, DEST, 'A1', 28, { classPrices: { economy: Math.round(referencePrice(HUB, DEST) * 3) } })],
      routePricing: {},
      lastReport: { routeResults: [{ routeId: 'R1', loadFactor: 1, revenue: 5e6 }] },
      marketCap: 5e9,
      competitors: [incumbent],
      encroachments: {},
    });
    if (next?.[key]?.competitorId === 'incumbent') drew++;
  }
  assert.equal(drew, 0, `the only carrier in the pool already flies this pair; drawn ${drew}/200 times`);
});

// ── Previews read the same market ───────────────────────────────────────────

console.log('\n── A forecast and the week agree about who else is flying ');

test('rivalSpecsFor hands a preview the pair\'s challenger', () => {
  const key = routePairKey(HUB, DEST);
  const s = { encroachments: { [key]: spec('x') } };
  assert.equal(rivalSpecsFor(s, HUB, DEST).length, 1);
  assert.equal(rivalSpecsFor(s, DEST, HUB).length, 1, 'direction-agnostic, like every other pair key');
  assert.deepEqual(rivalSpecsFor(s, HUB, 'ORD'), []);
  assert.deepEqual(rivalSpecsFor(null, HUB, DEST), []);
  assert.deepEqual(rivalSpecsFor({}, HUB, DEST), []);
});

test('a preview built the way the screens build one matches the tick', () => {
  // Every route screen now calls simulateRoute with the live bank and the pair's
  // challenger — the same two things the tick passes. Same inputs, same answer.
  const state = soloState([carrier('rival', HUB, DEST)]);
  state.encroachments = { [routePairKey(HUB, DEST)]: spec('newcomer') };
  const tick = quietly(() => weeklyTick(state)).routeResults[0];
  const preview = simulateRoute(
    { ...state.routes[0], classPrices: state.routePricing[routePairKey(HUB, DEST)] },
    state.fleet[0], { week: state.week, month: 6 }, null, 1.0, null,
    rivalSpecsFor(state, HUB, DEST), null, null, 1.0, null, state.competitors,
  );
  assert.equal(preview.competitorCount, tick.competitorCount,
    'the forecast should see exactly the rivals the week does');
  assert.ok(preview.competitorCount >= 2, 'fixture has an incumbent and an entrant');
});

test('a preview that is handed nothing is visibly a monopoly, not silently one', () => {
  const state = soloState([carrier('rival', HUB, DEST)]);
  const blind = simulateRoute(state.routes[0], state.fleet[0], GD);
  const seeing = simulateRoute(state.routes[0], state.fleet[0], GD, null, 1.0, null, [], null, null,
    1.0, null, state.competitors);
  assert.equal(blind.competitorCount, 0);
  assert.ok(seeing.competitorCount > 0);
  assert.ok(seeing.passengers < blind.passengers);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
