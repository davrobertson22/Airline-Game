// Brand reach is a DEMAND term — guards the 2026-07-31 report
// ("my margins were tiny at first, now brand-new routes print 37–70% margins at
// the reference price, and revenue kept climbing for months while I opened no
// routes and changed no fares").
//
// The cause: brand awareness, reputation, the loyalty programme, alliance
// membership and rival ad pressure were multiplied together into `combinedMult`
// and applied to route REVENUE in weeklyTick — after the share fight and after
// the capacity cap:
//
//     boostedRevenue = (result.revenue - catering - ancillary) * combinedMult ...
//
// `result.revenue` is already pax x fare with pax capped at seats, so this moved
// no passengers at all. `passengers`, `loadFactor` and `classSummary` came back
// unboosted while `revenue` was scaled, which meant:
//
//   * revenue / pax stopped equalling the fare the player had set, and per-cabin
//     revenues stopped summing to the route total;
//   * Finance's yield (revenue / RPK) climbed year after year on routes nobody
//     had repriced — the "revenue keeps rising" in the report;
//   * a new airline at awareness 5 (multiplier 0.446) wasn't reaching 45% of the
//     market, it was selling every seat at 45% of its own ticket price — hence
//     full aircraft that lost money, which taught players to raise fares;
//   * and the payout was LARGEST at 100% load factor, where a stronger brand
//     cannot sell one more seat. The reward was exactly inverted.
//
// Meanwhile the freight path took the same awareness figure as `demandMultiplier`
// and correctly applied it to TONNES. One engine, two contradictory meanings.
//
// It is now `offer.brandReach`, consumed by the demand model: a pool multiplier
// on a monopoly, a log-odds share shift on a contested pair (see
// models/demand.js), assembled by `brandReachFor` in utils/simulation.js.
//
// Ported from the Headwinds fix. Section 4 differs: Tailwinds has no human
// rivals, so instead of the multiplayer symmetry checks it asserts the solo
// asymmetry — the AI incumbent is established, the player is the unknown one.
//
//   node tools/brand-demand-test.mjs

import assert from 'node:assert/strict';
import {
  weeklyTick, defaultConfig, defaultClassPrices, stateBrandReach,
} from '../src/utils/simulation.js';
import { getAircraftType } from '../src/data/aircraft.js';
import { referencePrice } from '../src/utils/market.js';
import { awarenessDemandMultiplier } from '../src/data/overhead.js';
import { computeMarketShare, buildRouteMarket } from '../src/models/demand.js';
import { buildEncroachmentOffer } from '../src/models/encroachment.js';

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.log(`  ✗ ${name}\n      ${(e.stack || e.message).split('\n').slice(0, 4).join('\n      ')}`); failed++; }
}

console.log('\nBrand reach is a demand term\n');

const TYPE = getAircraftType('a320neo');
const O = 'CAI', D = 'DXB';
const REF = Math.round(referencePrice(O, D));

/**
 * One monopoly route, no hubs, no loyalty, no alliance, no campaigns — so
 * brandReach reduces to awareness x reputation, and reputation is identical
 * across runs (same fleet, same age, same morale). Any difference between two
 * runs is therefore awareness and nothing else.
 */
function run(awareness, { weeklyFrequency, priceMult = 1 }) {
  const state = {
    fleet: [{
      id: 'a1', typeId: TYPE.id, status: 'assigned', ageWeeks: 52,
      config: defaultConfig(TYPE.seats), ownershipType: 'owned',
    }],
    routes: [{
      id: 'r1', origin: O, destination: D, aircraftId: 'a1',
      weeklyFrequency, weeksOpen: 60,       // matured: maturityFactor = 1
    }],
    cargoRoutes: [],
    gameDate: { week: 1, month: 6 },
    gates: { [O]: 10, [D]: 10 },
    hubs: {},                                // no hub => no loyalty concentration
    routePricing: { [[O, D].sort().join('-')]: defaultClassPrices(Math.round(REF * priceMult)) },
    routeCatering: {},
    competitors: [],
    loyalty: { members: 0, weeklyInvestment: 0, maturity: 0 },
    allianceMembership: null,
    campaignStrength: {},
    targetedMarketing: {},
    awareness,
    labor: undefined,
  };
  const report = weeklyTick(state);
  const r = report.routeResults.find(x => x.routeId === 'r1');
  assert.ok(r, 'fixture must produce a route result');
  return r;
}

const UNKNOWN = 5;    // the default a brand-new airline starts at -> 0.446
const PARITY  = 65;   // "established carrier"                     -> 1.000

// ── 0. The fixture is what we think it is ────────────────────────────────────

test('the awareness curve still spans the range this test assumes', () => {
  assert.ok(Math.abs(awarenessDemandMultiplier(UNKNOWN) - 0.446) < 0.005,
    'awareness 5 should be ~0.446');
  assert.equal(awarenessDemandMultiplier(PARITY), 1);
});

// ── 1. The invariant that combinedMult broke ─────────────────────────────────

test('route revenue equals the tickets actually sold, at every awareness level', () => {
  for (const awareness of [UNKNOWN, 30, PARITY, 100]) {
    const r = run(awareness, { weeklyFrequency: 14 });
    const cabins = Object.values(r.classSummary ?? {})
      .reduce((s, c) => s + (c.revenue ?? 0), 0);
    const nonTicket = (r.connecting?.totalRevenue ?? 0)
      + (r.cateringRevenue ?? 0) + (r.ancillaryRevenue ?? 0);
    const tickets = r.revenue - nonTicket;
    // Rounding: revenue is rounded once per cabin and once for the route.
    assert.ok(Math.abs(tickets - cabins) <= 2,
      `at awareness ${awareness} the route booked $${cabins.toLocaleString()} of `
      + `tickets but reported $${tickets.toLocaleString()} of ticket revenue — a `
      + `$${(tickets - cabins).toLocaleString()} fare nobody was charged`);
  }
});

test('implied fare per passenger is the fare the player set', () => {
  const r = run(UNKNOWN, { weeklyFrequency: 14 });
  const eco = r.classSummary?.economy;
  assert.ok(eco && eco.passengers > 0, 'fixture must carry economy passengers');
  // classSummary stores one-way pax; revenue covers both directions.
  const impliedFare = eco.revenue / (eco.passengers * 2);
  assert.ok(Math.abs(impliedFare - REF) < 1,
    `an unknown brand must sell at the price on the ticket ($${REF}), `
    + `not $${impliedFare.toFixed(2)}`);
});

// ── 2. It moves passengers, which is the whole point ─────────────────────────

test('a stronger brand carries MORE PEOPLE when there are seats to sell', () => {
  // High frequency, and priced well above reference so demand doesn't swamp the
  // cabin: capacity comfortably exceeds demand, so the brand has somewhere to
  // put the extra passengers it wins. (CAI–DXB at the reference fare sells out
  // even at 60x/week, which is itself why the old bug hid so well — the routes
  // players actually fly are demand-rich and permanently capped.)
  const weak   = run(UNKNOWN, { weeklyFrequency: 60, priceMult: 2.0 });
  const strong = run(PARITY,  { weeklyFrequency: 60, priceMult: 2.0 });
  assert.equal(weak.capacityCapped, false, 'fixture must have spare seats');
  assert.equal(strong.capacityCapped, false, 'fixture must have spare seats');
  // Reach 0.446 -> 1.000 is a 2.24x pool on a monopoly; allow slack for the
  // elasticity and rounding that sit downstream of the pool multiplier.
  const ratio = strong.passengers / weak.passengers;
  assert.ok(ratio > 2.0 && ratio < 2.5,
    `awareness must change PAX — as a revenue multiplier it changed none. `
    + `expected ~2.24x, got ${weak.passengers} -> ${strong.passengers} (${ratio.toFixed(2)}x)`);
  assert.ok(strong.loadFactor > weak.loadFactor,
    'an unknown brand flies emptier aircraft; that is the legible signal the '
    + 'player never got while this was hidden in the fare');
});

// ── 3. And it stops printing money on sold-out flights ───────────────────────

test('a full aircraft earns the same no matter how famous the airline is', () => {
  // Low frequency at the reference fare: demand swamps capacity either way.
  const weak   = run(UNKNOWN, { weeklyFrequency: 3 });
  const strong = run(PARITY,  { weeklyFrequency: 3 });
  assert.equal(weak.capacityCapped, true, 'fixture must be capacity-capped');
  assert.equal(strong.capacityCapped, true, 'fixture must be capacity-capped');
  assert.equal(weak.passengers, strong.passengers,
    'both flights are full — there is no seat left for a brand to sell');
  const gap = Math.abs(strong.revenue - weak.revenue) / weak.revenue;
  assert.ok(gap < 0.005,
    `same seats, same fare, same load — revenue must match. As a post-cap `
    + `multiplier this route paid out ${((strong.revenue / weak.revenue - 1) * 100).toFixed(0)}% `
    + `more for a brand that could not sell a single extra ticket`);
});

test('operating profit on a sold-out route does not move with awareness', () => {
  const weak   = run(UNKNOWN, { weeklyFrequency: 3 });
  const strong = run(PARITY,  { weeklyFrequency: 3 });
  assert.ok(Math.abs(strong.profit - weak.profit) <= Math.abs(weak.profit) * 0.005,
    'the reported symptom: identical routes, wildly different margins, purely '
    + 'because one airline had been flying longer');
});

// ── 4. Solo asymmetry ────────────────────────────────────────────────────────
// Tailwinds is single-player: every rival is an AI incumbent that has been in
// the market for years, and the PLAYER is the unknown quantity. That asymmetry
// is the whole point of the model here, and it must survive — an offer with no
// brandReach sits at parity (1) by design.

test('an offer with no brandReach sits at parity', () => {
  const market = buildRouteMarket(O, D, { week: 1, month: 6 }, 1, 1);
  const spec = {
    competitorId: 'ai-1', name: 'Incumbent Air', tier: 'full',
    qualityScore: 65, economyFare: REF, frequency: 14, seatsPerFlight: 180,
  };
  assert.equal(buildEncroachmentOffer(spec, market).brandReach, 1,
    'AI incumbents are established brands — omitting the field must not '
    + 'score them as unknowns');
});

test('a spec that DOES carry brandReach passes it through to the offer', () => {
  const market = buildRouteMarket(O, D, { week: 1, month: 6 }, 1, 1);
  const spec = {
    competitorId: 'ai-1', name: 'Incumbent Air', tier: 'full',
    qualityScore: 65, economyFare: REF, frequency: 14, seatsPerFlight: 180,
    brandReach: 0.5,
  };
  assert.equal(buildEncroachmentOffer(spec, market).brandReach, 0.5);
});

test('an unknown player loses share to an established rival on a contested pair', () => {
  // The contested half of the model. On a monopoly brand shrinks the pool; here
  // it has to move share, or a week-one airline reads as an equal of a carrier
  // the whole market already knows.
  const market = buildRouteMarket(O, D, { week: 1, month: 6 }, 1, 1);
  const base = {
    origin: O, destination: D, economyPrice: REF, businessPrice: null,
    weeklyFrequency: 14, seatsPerFlight: 180,
    economySeats: 14 * 180, businessSeats: 0, totalSeats: 14 * 180,
    qualityScore: 65, connectivityBonus: 0,
  };
  const incumbent = { ...base, airlineId: 'ai-1' };                 // no field => 1
  const newcomer  = { ...base, airlineId: 'player', brandReach: awarenessDemandMultiplier(UNKNOWN) };
  const [mine] = computeMarketShare(market, [newcomer, incumbent]);
  assert.ok(mine.leisureShare < 0.4,
    `identical product, unknown brand — the newcomer must take LESS than half. `
    + `got ${(mine.leisureShare * 100).toFixed(1)}%`);
  // And parity must restore the even split, so the term is doing nothing else.
  const matched = { ...base, airlineId: 'player', brandReach: 1 };
  const [even] = computeMarketShare(market, [matched, incumbent]);
  assert.ok(Math.abs(even.leisureShare - 0.5) < 0.01,
    `at parity two identical offers must split evenly — got ${(even.leisureShare * 100).toFixed(1)}%`);
});

test('stateBrandReach agrees with the tick for a bare startup state', () => {
  // The preview-side twin. A screen that builds its own player offer has to get
  // the same number the tick uses, or every share preview in the game drifts.
  const startup = {
    fleet: [], routes: [], cargoRoutes: [],
    loyalty: { members: 0, weeklyInvestment: 0, maturity: 0 },
    allianceMembership: null, awareness: UNKNOWN,
  };
  const reach = stateBrandReach(startup, 0, false);
  assert.ok(reach < 0.6, `a week-one airline must not read as famous — got ${reach}`);
  const famous = stateBrandReach({ ...startup, awareness: 100 }, 0, false);
  assert.ok(famous > reach * 1.8, 'and a household name must read as one');
});

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed > 0 ? 1 : 0);
