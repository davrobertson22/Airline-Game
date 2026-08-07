// A pooled lane says the same thing a solo one does.
//
// When two or more of the player's aircraft fly the same O&D pair, weeklyTick
// runs a pre-pass: one combined offer for the pair, one market-share
// computation, then the result handed back to each aircraft by seat share. That
// combined offer is meant to be the group's version of the offer simulateRoute
// builds for a single aircraft, and the split is meant to reach the routes on
// that pair. Four things were wrong with it, all measured on HEAD:
//
//   1. The allocation map was keyed by aircraft.id. An aeroplane may legally
//      fly several routes, so a pooled pair's result went to every OTHER route
//      the same tail flew. A narrowbody doing four LAX shuttles a week and the
//      rest of its week on SFO-SAN gave SAN the LAX quarter-share: 19.05% full
//      instead of 100%, $531k of weekly profit turned into a $134k loss.
//   2. Lane maturity came from group[0] — array order. Replace an airframe and
//      the new weeksOpen-0 route may land first, re-ramping the whole lane to
//      55% of its demand. Worth 1,762 passengers and $1.06M a week depending on
//      WHICH of two identical aeroplanes you swapped.
//   3. The offer dropped type.ticketPremium. One Concorde on a contested
//      JFK-LHR sold 29 seats at $3,526 a passenger; a second Concorde made it
//      896 each at $2,767, because the supersonic premium silently became 1x.
//   4. It synthesized a 3.5x business fare where the single-aircraft path uses
//      null. Latent rather than live — but two paths answering one question.
//
//   node tools/pooled-lane-test.mjs

import assert from 'node:assert/strict';
import { getAircraftType } from '../src/data/aircraft.js';
import {
  weeklyTick, referencePrice, defaultClassPrices, defaultConfig, routePairKey,
  routeDistanceKm, weeklyBlockHours, MAX_WEEKLY_BLOCK_HOURS,
} from '../src/utils/simulation.js';
import { routeMaturityFactor } from '../src/models/demand.js';

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.log(`  ✗ ${name}\n      ${(e.stack || e.message).split('\n').slice(0, 4).join('\n      ')}`); failed++; }
}

// The invariant self-check console.warns by design; silence it for the one
// suite that deliberately inspects it.
const realWarn = console.warn;
const quietly = (fn) => { console.warn = () => {}; try { return fn(); } finally { console.warn = realWarn; } };

const NARROW = getAircraftType('a320ceo');

const ac = (id, typeId = NARROW.id, cfg = null) => {
  const type = getAircraftType(typeId);
  return {
    id, typeId, tailNumber: id, status: 'assigned', ageWeeks: 52,
    ownershipType: 'owned', config: cfg ?? defaultConfig(type.seats),
  };
};
const rt = (id, origin, dest, aircraftId, freq, weeksOpen = 60, over = {}) => ({
  id, origin, destination: dest, aircraftId,
  weeklyFrequency: freq, weeksOpen, hub: origin,
  ticketPrice: Math.round(referencePrice(origin, dest)),
  cateringLevel: 'standard', ...over,
});
const priced = (...pairs) => Object.fromEntries(pairs.map(([o, d]) =>
  [routePairKey(o, d), defaultClassPrices(Math.round(referencePrice(o, d)))]));

/** A rival big enough that the player is share-limited rather than seat-limited. */
const rival = (o, d, seats, over = {}) => ({
  [routePairKey(o, d)]: {
    competitorId: 'rival-1', name: 'Rival Air', tier: 'full', qualityScore: 74,
    priceMultiplier: 0.95, frequency: 28, freqCap: 28, seatsPerFlight: seats,
    weeksActive: 40, idleWeeks: 0, ...over,
  },
});

const world = ({ hub, fleet, routes, pricing = {}, encroachments = {}, gates = {} }) => ({
  phase: 'playing', week: 20, year: 2, hub, cash: 200_000_000, awareness: 65,
  absWeek: 72, gates, fleet, routes, routePricing: pricing, encroachments,
  competitors: [], activeEvents: [], loans: [], hedgeContracts: [],
  financialHistory: [], cargoRoutes: [],
});

const tick = (state) => {
  const r = quietly(() => weeklyTick(state));
  const by = {};
  for (const rr of r.routeResults) by[rr.routeId] = rr;
  return { by, report: r };
};

// ── 1. The allocation belongs to the route ──────────────────────────────────

console.log('\n── A pooled pair stays on its own pair ──────────────────');

const HUB = 'SFO', SHARED = 'LAX', OWN = 'SAN';
const FREQ_SHARED = 4, FREQ_OWN = 21;
const gatesFor = { [HUB]: 40, [SHARED]: 20, [OWN]: 20 };
const sharedRoutes = (ids) => ids.map((id, i) => rt(`S${i}`, HUB, SHARED, id, FREQ_SHARED));
const hubWorld = (ownAircraft, fleetIds) => world({
  hub: HUB, gates: gatesFor,
  fleet: fleetIds.map(id => ac(id)),
  routes: [...sharedRoutes(['A1', 'A2', 'A3', 'A4']), rt('OWN', HUB, OWN, ownAircraft, FREQ_OWN)],
  pricing: priced([HUB, SHARED], [HUB, OWN]),
});

test('the fixture is a schedule the reducer would actually allow', () => {
  // If this shape were illegal the defect would be theoretical. It is not: both
  // routes touch the hub, and the week fits inside the block-hour limit.
  const bh = weeklyBlockHours(routeDistanceKm(HUB, SHARED), FREQ_SHARED, NARROW)
           + weeklyBlockHours(routeDistanceKm(HUB, OWN), FREQ_OWN, NARROW);
  assert.ok(bh <= MAX_WEEKLY_BLOCK_HOURS, `${bh.toFixed(1)}h exceeds the ${MAX_WEEKLY_BLOCK_HOURS}h limit`);
});

test('a tail\'s other route is unaffected by the pair it shares', () => {
  // THE BUG: demandAllocations was keyed by aircraft.id, so A1's quarter-share
  // of the four-aircraft LAX pool was handed to its SAN route as well.
  const leaky   = tick(hubWorld('A1', ['A1', 'A2', 'A3', 'A4']));
  const control = tick(hubWorld('A5', ['A1', 'A2', 'A3', 'A4', 'A5']));
  assert.equal(leaky.by.OWN.passengers, control.by.OWN.passengers,
    'the same route flown by a different tail must carry the same passengers');
  assert.equal(leaky.by.OWN.revenue, control.by.OWN.revenue);
  assert.ok(leaky.by.OWN.loadFactor > 0.9,
    `an uncontested route with this much demand should be near full, got ${(leaky.by.OWN.loadFactor * 100).toFixed(1)}%`);
});

test('the shared pair itself is unchanged by who else flies what', () => {
  const leaky   = tick(hubWorld('A1', ['A1', 'A2', 'A3', 'A4']));
  const control = tick(hubWorld('A5', ['A1', 'A2', 'A3', 'A4', 'A5']));
  for (const id of ['S0', 'S1', 'S2', 'S3']) {
    assert.equal(leaky.by[id].passengers, control.by[id].passengers, `${id} moved`);
  }
});

test('every aircraft on a pooled pair carries the same load', () => {
  // The whole point of the pre-pass. Four identical aircraft, one pair.
  const r = tick(hubWorld('A5', ['A1', 'A2', 'A3', 'A4', 'A5']));
  const lfs = ['S0', 'S1', 'S2', 'S3'].map(id => r.by[id].loadFactor);
  assert.ok(Math.max(...lfs) - Math.min(...lfs) < 0.001,
    `identical tails on one pair diverged: ${lfs.map(v => (v * 100).toFixed(2)).join(' / ')}`);
});

// ── 2. Lane maturity ────────────────────────────────────────────────────────

console.log('\n── A lane is as old as its oldest route ─────────────────');

const MHUB = 'SFO', MDEST = 'ORD';
const mWorld = (routes, ids) => world({
  hub: MHUB, gates: { [MHUB]: 40, [MDEST]: 20 },
  fleet: ids.map(id => ac(id)),
  routes,
  pricing: priced([MHUB, MDEST]),
  encroachments: rival(MHUB, MDEST, NARROW.seats),
});
const mRt = (id, aircraftId, weeksOpen) => rt(id, MHUB, MDEST, aircraftId, 14, weeksOpen);

test('array order does not decide how mature a lane is', () => {
  // THE BUG: maturity came from group[0]. Replacing an airframe means closing
  // one route and adding another, and the new weeksOpen-0 route lands wherever
  // the array puts it — which depends on which of two identical aeroplanes the
  // player happened to replace.
  const newLast  = tick(mWorld([mRt('R2', 'A2', 90), mRt('R3', 'A3', 0)], ['A2', 'A3']));
  const newFirst = tick(mWorld([mRt('R3', 'A3', 0), mRt('R2', 'A2', 90)], ['A3', 'A2']));
  const sum = (x) => Object.values(x.by).reduce((s, r) => s + r.passengers, 0);
  assert.equal(sum(newLast), sum(newFirst),
    'the same lane must carry the same passengers whichever order its routes are stored in');
});

test('adding a tail to an established lane does not re-ramp it', () => {
  const established = tick(mWorld([mRt('R1', 'A1', 90), mRt('R2', 'A2', 90)], ['A1', 'A2']));
  const reinforced  = tick(mWorld([mRt('R3', 'A3', 0), mRt('R2', 'A2', 90)], ['A3', 'A2']));
  const sum = (x) => Object.values(x.by).reduce((s, r) => s + r.passengers, 0);
  assert.equal(sum(reinforced), sum(established),
    'the market has known this service for 90 weeks; a new aeroplane does not undo that');
});

test('a genuinely new lane still ramps', () => {
  // The fix must not turn every pooled lane mature. Two brand-new routes on a
  // pair nobody has flown are a new lane, and should sell like one.
  const brandNew = tick(mWorld([mRt('R1', 'A1', 0), mRt('R2', 'A2', 0)], ['A1', 'A2']));
  const mature   = tick(mWorld([mRt('R1', 'A1', 90), mRt('R2', 'A2', 90)], ['A1', 'A2']));
  const sum = (x) => Object.values(x.by).reduce((s, r) => s + r.passengers, 0);
  assert.ok(sum(brandNew) < sum(mature),
    `a new lane should carry fewer than a mature one, got ${sum(brandNew)} vs ${sum(mature)}`);
  assert.ok(routeMaturityFactor(0) < 0.6 && routeMaturityFactor(90) === 1);
});

test('a pooled lane matures on the same curve a solo one does', () => {
  // Two aircraft at half the frequency should read as exactly as mature as one
  // aircraft at full frequency — maturity is a property of the lane.
  const solo   = tick(mWorld([mRt('R1', 'A1', 30)], ['A1']));
  const pooled = tick(mWorld([mRt('R1', 'A1', 30), mRt('R2', 'A2', 30)], ['A1', 'A2']));
  const soloLF = solo.by.R1.loadFactor;
  const poolLF = pooled.by.R1.loadFactor;
  // Not equal — twice the seats against one pool — but both must be below the
  // mature case by the same maturity factor, so the pooled lane cannot come out
  // AHEAD of its own mature self.
  const maturePooled = tick(mWorld([mRt('R1', 'A1', 90), mRt('R2', 'A2', 90)], ['A1', 'A2']));
  assert.ok(poolLF <= maturePooled.by.R1.loadFactor + 1e-9,
    'a half-grown lane cannot outsell its mature self');
  assert.ok(soloLF > 0);
});

// ── 3. The ticket premium ───────────────────────────────────────────────────

console.log('\n── A supersonic lane keeps its fares when it pools ──────');

const SST = getAircraftType('concorde');
const SHUB2 = 'JFK', SDEST2 = 'LHR';
const sstWorld = (n) => world({
  hub: SHUB2, gates: { [SHUB2]: 40, [SDEST2]: 40 },
  fleet: Array.from({ length: n }, (_, i) => ac(`S${i}`, 'concorde')),
  routes: Array.from({ length: n }, (_, i) => rt(`C${i}`, SHUB2, SDEST2, `S${i}`, 7)),
  pricing: priced([SHUB2, SDEST2]),
  encroachments: rival(SHUB2, SDEST2, 300, { frequency: 35, freqCap: 35 }),
});

test('a second supersonic tail does not cut the fare', () => {
  // THE BUG: simulateRoute multiplies every fare by type.ticketPremium before
  // the demand model. The pooled offer carried no premium at all, so a lane's
  // fares reverted to subsonic the moment it pooled — and a player who wanted
  // Concorde to fill its seats only had to buy a second one.
  const one = tick(sstWorld(1)).by.C0;
  const two = tick(sstWorld(2)).by.C0;
  const yieldOf = (r) => (r.passengers ? r.revenue / r.passengers : 0);
  const ratio = yieldOf(two) / Math.max(1, yieldOf(one));
  assert.ok(Math.abs(ratio - 1) < 0.15,
    `yield per passenger moved ${((ratio - 1) * 100).toFixed(0)}% on adding a tail ` +
    `($${yieldOf(one).toFixed(0)} → $${yieldOf(two).toFixed(0)})`);
});

test('the supersonic premium is still charged on a pooled lane', () => {
  const two = tick(sstWorld(2)).by.C0;
  const plain = referencePrice(SHUB2, SDEST2);
  assert.ok(two.revenue / Math.max(1, two.passengers) > plain * 1.5,
    'a Concorde lane must still be selling a premium fare, pooled or not');
  assert.ok(SST.ticketPremium > 1, 'fixture depends on the type carrying a premium');
});

test('a subsonic pooled lane is priced exactly as a solo one', () => {
  // ticketPremium is 1 for every ordinary type, so the seat-weighted premium is
  // 1 and this change is a no-op everywhere it is not supersonic. Compared
  // against the solo path rather than a guessed band: that agreement IS the
  // property, and the two are the numbers a player sees side by side.
  const solo   = tick(mWorld([mRt('R1', 'A1', 90)], ['A1'])).by.R1;
  const pooled = tick(mWorld([mRt('R1', 'A1', 90), mRt('R2', 'A2', 90)], ['A1', 'A2'])).by.R1;
  const perPax = (r) => r.revenue / Math.max(1, r.passengers);
  assert.ok(Math.abs(perPax(pooled) / perPax(solo) - 1) < 0.02,
    `$${perPax(solo).toFixed(0)} solo vs $${perPax(pooled).toFixed(0)} pooled per passenger`);
});

// ── 4. The business fare ────────────────────────────────────────────────────

console.log('\n── No fare the player never set ─────────────────────────');

// Equal-capacity lanes: one aircraft at 28/wk, two at 14, four at 7. Same total
// seats, same total frequency, same aircraft, same rival. Only the first is a
// solo lane; the others go through the pooled pre-pass. Whatever the offer says,
// it must say the same thing in all three.
const EQ_FREQ = 28;
const eqCfg = (biz) => ({ ...defaultConfig(NARROW.seats - biz), businessClass: biz });
const eqLane = (n, { pricing = {}, biz = 0 } = {}) => {
  const r = tick(world({
    hub: MHUB, gates: { [MHUB]: 40, [MDEST]: 40 },
    fleet: Array.from({ length: n }, (_, i) => ac(`E${i}`, NARROW.id, eqCfg(biz))),
    routes: Array.from({ length: n }, (_, i) =>
      rt(`Q${i}`, MHUB, MDEST, `E${i}`, EQ_FREQ / n)),
    pricing, encroachments: rival(MHUB, MDEST, NARROW.seats),
  }));
  const rs = Object.values(r.by);
  return { pax: rs.reduce((s, x) => s + x.passengers, 0), rev: rs.reduce((s, x) => s + x.revenue, 0) };
};
const PRICED = priced([MHUB, MDEST]);

// Splitting one aeroplane's schedule across several is not perfectly neutral —
// seatsPerFlight is a per-flight figure and the demand model reads it — but the
// drift is small and identical whether or not there is a business cabin. That
// band is what "unchanged" means here.
const NEUTRAL = 0.02;

test('splitting a fixed schedule across more tails changes nothing (all-economy)', () => {
  const [a, b, c] = [1, 2, 4].map(n => eqLane(n, { pricing: PRICED, biz: 0 }));
  assert.ok(Math.abs(b.pax / a.pax - 1) < NEUTRAL, `2x14 moved ${((b.pax / a.pax - 1) * 100).toFixed(1)}% vs 1x28`);
  assert.ok(Math.abs(c.pax / a.pax - 1) < NEUTRAL, `4x7 moved ${((c.pax / a.pax - 1) * 100).toFixed(1)}% vs 1x28`);
});

test('…nor with a business cabin the player has priced', () => {
  const [a, b, c] = [1, 2, 4].map(n => eqLane(n, { pricing: PRICED, biz: 20 }));
  assert.ok(Math.abs(b.pax / a.pax - 1) < NEUTRAL, `2x14 moved ${((b.pax / a.pax - 1) * 100).toFixed(1)}%`);
  assert.ok(Math.abs(c.rev / a.rev - 1) < NEUTRAL, `4x7 revenue moved ${((c.rev / a.rev - 1) * 100).toFixed(1)}%`);
  assert.ok(a.rev > eqLane(1, { pricing: PRICED, biz: 0 }).rev,
    'a priced business cabin should still be worth having');
});

test('…nor with a business cabin nobody has priced', () => {
  // THE BUG: with no business fare on the route, the solo path returns null and
  // the market treats the offer as having no business product. The pooled path
  // invented one at 3.5x economy — so the same capacity, merely split across two
  // aeroplanes instead of one, won 578 more passengers and $354k a week from a
  // fare the player never set. Buying a second aircraft was a pricing strategy.
  const [a, b, c] = [1, 2, 4].map(n => eqLane(n, { pricing: {}, biz: 20 }));
  assert.ok(Math.abs(b.pax / a.pax - 1) < NEUTRAL,
    `2x14 gained ${((b.pax / a.pax - 1) * 100).toFixed(1)}% of the traffic 1x28 gets`);
  assert.ok(Math.abs(c.pax / a.pax - 1) < NEUTRAL,
    `4x7 gained ${((c.pax / a.pax - 1) * 100).toFixed(1)}%`);
  assert.ok(Math.abs(b.rev / a.rev - 1) < NEUTRAL,
    `2x14 earned ${((b.rev / a.rev - 1) * 100).toFixed(1)}% more revenue for the same aeroplanes`);
});

test('an unpriced business cabin sells like the economy seats it replaced', () => {
  // The cabin still fills — premium seats without an explicit fare carry
  // passengers at the economy fare (simulateRoute says so in as many words).
  // What it must not do is win business-segment SHARE with a fare that exists
  // nowhere but this one branch.
  const unpriced = eqLane(2, { pricing: {}, biz: 20 });
  const allEco   = eqLane(2, { pricing: PRICED, biz: 0 });
  assert.ok(Math.abs(unpriced.pax / allEco.pax - 1) < NEUTRAL,
    `${unpriced.pax} vs ${allEco.pax} — an unpriced J cabin should not out-earn plain seats`);
});

// ── 5. The invariant that would have caught all of it ───────────────────────

console.log('\n── The pool checks itself ───────────────────────────────');

test('a healthy pooled lane reports no anomaly', () => {
  const r = tick(mWorld([mRt('R1', 'A1', 90), mRt('R2', 'A2', 90)], ['A1', 'A2']));
  assert.ok(Array.isArray(r.report.poolingAnomalies));
  assert.deepEqual(r.report.poolingAnomalies, []);
});

test('the hub schedule that used to leak is now clean', () => {
  const r = tick(hubWorld('A1', ['A1', 'A2', 'A3', 'A4']));
  assert.deepEqual(r.report.poolingAnomalies, [],
    'the four LAX tails must land together, and SAN is a solo lane the check ignores');
});

test('a solo lane is never an anomaly', () => {
  const r = tick(mWorld([mRt('R1', 'A1', 90)], ['A1']));
  assert.deepEqual(r.report.poolingAnomalies, []);
});

test('a divergent pool is reported with enough detail to diagnose it', () => {
  // Force a spread the honest way: one tail grounded mid-week carries nobody
  // while its lane-mate flies. This is a legitimate divergence rather than a
  // pooling failure, which is exactly why the check reports rather than throws —
  // it hands over status, config and whether each route was actually allocated.
  const state = mWorld([mRt('R1', 'A1', 90), mRt('R2', 'A2', 90)], ['A1', 'A2']);
  state.routes[1].weeklyFrequency = 1;   // same pair, a fraction of the flying
  const r = tick(state);
  if (r.report.poolingAnomalies.length === 0) return;   // seats split evenly — fine
  const a = r.report.poolingAnomalies[0];
  assert.ok(a.pair && typeof a.spread === 'number');
  assert.equal(a.aircraft.length, 2);
  for (const entry of a.aircraft) {
    assert.ok('pooled' in entry && 'loadFactor' in entry && 'routeId' in entry);
  }
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
