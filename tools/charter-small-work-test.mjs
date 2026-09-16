// Charter contracts: small work, executive work, and a board that follows the metal.
//
//   Matvocaat  "Looks good, but maybe it'd be a bit more useful if it was scaled.
//               I like to grow my airline organically, start out small and buy
//               the big airliners later. So charter contracts for 1-20 people
//               would be great as well especially in early game"
//              "alongside that, maybe you could add a few bizjets to the game?
//               Like a CJ4 or Challenger?"                    (Discord, 14 Sep 2026)
//
// Before this, every passenger template asked for 90+ seats, so a two-Caravan
// startup opened the Charters page to a board it could not touch. Three things
// change and each is pinned here:
//
//   1. Two new templates sized for a small fleet: a 4-20 seat group charter any
//      aircraft may fly, and an executive charter that DEMANDS a business jet and
//      is priced against one (asset included — a bizjet has no schedule to earn
//      its keep on, see EXECUTIVE_FEE_INCLUDES_ASSET).
//   2. The board reads the FLEET (charterFleetFit): work nothing you own can fly,
//      or work far beneath what you own, keeps 30% of its weight — present, so
//      there is always something to grow into, but no longer most of the board.
//   3. The accept and reassign guards refuse a non-bizjet on executive work.
//
// Everything stays deterministic: no random draw anywhere in it.
//
//   node --import ./tools/_register-loader.mjs tools/charter-small-work-test.mjs

import assert from 'node:assert/strict';
import {
  CHARTER_TEMPLATES, CHARTER_TYPES, CHARTER_OUT_OF_REACH_WEIGHT, CHARTER_BENEATH_FLEET_RATIO,
  EXECUTIVE_FEE_INCLUDES_ASSET, EXECUTIVE_UTILISATION_WEEK_HOURS,
  templateWeight, referenceTypeFor, typeMeetsRequirement, getCharterTemplate,
  charterFleetProfile, charterFleetFit, charterFee, executiveAssetShare, missionCostPerWeek,
} from '../src/data/charters.js';
import { generateCharterBoard } from '../src/models/charterBoard.js';
import { AIRCRAFT_TYPES, getAircraftType } from '../src/data/aircraft.js';
import { defaultConfig } from '../src/utils/simulation.js';
import { absoluteWeek } from '../src/utils/fuel.js';

const { gameReducer: reducer, freshState, charterAcceptBlockReason } = await import('../src/store/GameContext.jsx');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.log(`  ✗ ${name}\n      ${(e.stack || e.message).split('\n').slice(0, 5).join('\n      ')}`); failed++; }
}

// ── Fixtures ─────────────────────────────────────────────────────────────────

const tail = (id, typeId, over = {}) => {
  const type = getAircraftType(typeId);
  return {
    id, typeId, name: id, tailNumber: `N${id}`, status: 'idle',
    ageWeeks: 60, ownershipType: 'owned', fuelMod: 1.0,
    config: type?.freighter ? null : defaultConfig(type.seats),
    ...over,
  };
};

const boardState = (over = {}) => ({
  airlineName: 'Small Air', hub: 'SFO', homeCountry: 'US',
  gates: { SFO: 3, LAX: 2, ORD: 1 },
  hubs:  { SFO: { tier: 2 }, LAX: { tier: 0 } },
  routes: [
    { origin: 'SFO', destination: 'JFK' },
    { origin: 'SFO', destination: 'SEA' },
    { origin: 'LAX', destination: 'ORD' },
  ],
  cargoRoutes: [], charters: [],
  awareness: 60,
  gameDate: { month: 7 },
  absWeek: 30,
  charterReliability: 50,
  fuelPrice: { index: 1.0 },
  activeEvents: [],
  lastReport: { reputationScore: 60 },
  ...over,
});

const BIZJETS = AIRCRAFT_TYPES.filter(t => t.bizjet);
const SMALL   = getCharterTemplate('adhoc_small');
const EXEC    = getCharterTemplate('executive');

const mixOver = (st, weeks = 300) => {
  const counts = {};
  let n = 0;
  for (let w = 0; w < weeks; w++) {
    for (const o of generateCharterBoard(st, w)) { counts[o.templateId] = (counts[o.templateId] ?? 0) + 1; n++; }
  }
  return { counts, n, share: (id) => (counts[id] ?? 0) / n };
};

console.log('\nCharter contracts — small work, executive work, and the fleet\n');

console.log('── 1. The catalogue has business jets ───────────────────');

test('there are business jets, and they are flagged as such', () => {
  assert.ok(BIZJETS.length >= 3, `expected a few business jets, found ${BIZJETS.length}`);
  for (const id of ['cj4', 'cl350']) {
    const t = getAircraftType(id);
    assert.ok(t, `${id} is missing — the two Matvocaat named`);
    assert.equal(t.bizjet, true);
    assert.ok(t.seats >= 6 && t.seats <= 19, `${id} seats ${t.seats}`);
  }
});

console.log('\n── 2. The templates exist and ask for what they should ──');

test('a small group charter asks for 4-19 seats and any aircraft may fly it', () => {
  assert.ok(SMALL, 'adhoc_small template missing');
  assert.equal(SMALL.type, CHARTER_TYPES.ADHOC_PAX);
  assert.deepEqual(SMALL.seats, [4, 19]);
  assert.ok(!SMALL.bizjet && !SMALL.freighter);
  const caravan = getAircraftType('c208b');
  assert.ok(typeMeetsRequirement(caravan, { seats: 12, distanceKm: 600, runwayFt: 6000 }),
    'a Caravan can fly a 12-seat group 600km');
  assert.ok(typeMeetsRequirement(getAircraftType('a320neo'), { seats: 12, distanceKm: 600, runwayFt: 6000 }),
    'so can an A320 — the fee just will not cover it');
});

test('an executive charter demands a business jet', () => {
  assert.ok(EXEC, 'executive template missing');
  assert.equal(EXEC.type, CHARTER_TYPES.EXECUTIVE);
  assert.equal(EXEC.bizjet, true);
  assert.ok(EXEC.seats[1] <= 8, 'executive parties are small');
  const req = { seats: 6, distanceKm: 1500, runwayFt: 8000, bizjet: true };
  assert.equal(typeMeetsRequirement(getAircraftType('c208b'), req), false, 'a Caravan seats them and the customer still says no');
  assert.equal(typeMeetsRequirement(getAircraftType('crj200'), req), false, 'a 50-seat regional jet is not a business jet');
  assert.equal(typeMeetsRequirement(getAircraftType('cj4'), req), true);
});

test('the reference operator for executive work is a business jet', () => {
  const ref = referenceTypeFor({ originCode: 'SFO', destCode: 'LAX', seats: 6, bizjet: true, flightsPerWeek: 2 });
  assert.ok(ref, 'nothing could price SFO-LAX for six on a bizjet');
  assert.equal(ref.type.bizjet, true, `${ref.type.id} is not a business jet`);
});

test('before business jets existed, executive work is not posted', () => {
  // referenceTypeFor returns null in an era with no bizjet, so generateOffer
  // re-rolls the slot rather than posting a contract nobody can fly.
  const st = boardState({ startYear: 1985, airlineName: 'Era Air' });
  for (let w = 0; w < 200; w++) {
    for (const o of generateCharterBoard(st, w)) {
      assert.notEqual(o.templateId, 'executive', `executive work posted in ${1985 + Math.floor(w / 52)}`);
    }
  }
});

console.log('\n── 3. Posted small work is real work ─────────────────────');

test('small group offers ask for at most 19 seats and reference a small aircraft', () => {
  const st = boardState({ fleet: [tail('ac1', 'c208b'), tail('ac2', 'c208b')] });
  let seen = 0;
  for (let w = 0; w < 300; w++) {
    for (const o of generateCharterBoard(st, w)) {
      if (o.templateId !== 'adhoc_small') continue;
      seen++;
      assert.ok(o.seatsRequired >= 4 && o.seatsRequired <= 19, `${o.seatsRequired} seats`);
      const ref = getAircraftType(o.refTypeId);
      assert.ok(ref.seats <= 50, `priced against a ${ref.seats}-seat ${ref.name}`);
      assert.ok(typeMeetsRequirement(ref, { seats: o.seatsRequired, distanceKm: o.distanceKm, runwayFt: o.runwayFt }));
    }
  }
  assert.ok(seen > 100, `only ${seen} small offers in 300 weeks for a Caravan fleet`);
});

test('every executive offer is flagged, priced against a bizjet, and carries its asset share', () => {
  const st = boardState({ fleet: [tail('ac1', 'cj4')] });
  let seen = 0;
  for (let w = 0; w < 300; w++) {
    for (const o of generateCharterBoard(st, w)) {
      if (o.templateId !== 'executive') continue;
      seen++;
      assert.equal(o.bizjet, true);
      assert.equal(o.type, CHARTER_TYPES.EXECUTIVE);
      assert.equal(getAircraftType(o.refTypeId).bizjet, true, `${o.refTypeId} priced an executive charter`);
      assert.ok(o.assetSharePerWeek > 0, 'the fee must carry a slice of the jet');
    }
  }
  assert.ok(seen > 60, `only ${seen} executive offers in 300 weeks for a bizjet fleet`);
});

console.log('\n── 4. The executive fee prices the aeroplane, not just the fuel ──');

test('the asset share is the lease, pro rata to a busy week, capped at a week', () => {
  assert.equal(EXECUTIVE_FEE_INCLUDES_ASSET, true);
  const cj4 = getAircraftType('cj4');
  assert.equal(executiveAssetShare(cj4, 0), 0);
  assert.equal(executiveAssetShare(cj4, EXECUTIVE_UTILISATION_WEEK_HOURS / 2), Math.round(cj4.weeklyLease / 2));
  assert.equal(executiveAssetShare(cj4, EXECUTIVE_UTILISATION_WEEK_HOURS * 3), cj4.weeklyLease, 'never more than a whole week of jet');
});

test('the same cost base pays more as executive work than as ad-hoc work — by the asset', () => {
  const cj4 = getAircraftType('cj4');
  const refCost = missionCostPerWeek({ originCode: 'SFO', destCode: 'LAX', type: cj4, flightsPerWeek: 2 });
  const asset = executiveAssetShare(cj4, 20);
  const common = { refCost, refType: cj4, weeks: 2, uMargin: 0.5, uTrap: 0.9, reliability: 50 };
  const exec  = charterFee({ ...common, type: CHARTER_TYPES.EXECUTIVE, assetShare: asset });
  const adhoc = charterFee({ ...common, type: CHARTER_TYPES.ADHOC_PAX, assetShare: asset });
  assert.equal(exec.margin, adhoc.margin, 'same draw, same margin');
  assert.equal(exec.feePerWeek, Math.round((refCost.total + asset) * exec.margin));
  assert.equal(adhoc.feePerWeek, Math.round(refCost.total * adhoc.margin), 'ad-hoc work ignores the asset share entirely');
  assert.ok(exec.feePerWeek > adhoc.feePerWeek);
});

console.log('\n── 5. The board follows the metal ───────────────────────');

test('a fleet profile summarises what the airline can fly', () => {
  assert.equal(charterFleetProfile([]), null, 'no fleet, no profile');
  const p = charterFleetProfile([tail('a', 'c208b'), tail('b', 'cj4'), tail('c', 'a320neo', { status: 'retired' })]);
  assert.equal(p.minSeats, 10);
  assert.equal(p.maxSeats, 14);
  assert.equal(p.hasBizjet, true);
  assert.equal(p.hasFreighter, false);
});

test('work nothing in the fleet can fly keeps a reduced weight, never zero', () => {
  const caravans = charterFleetProfile([tail('a', 'c208b')]);
  const gov = getCharterTemplate('government');
  assert.equal(charterFleetFit(gov, caravans), CHARTER_OUT_OF_REACH_WEIGHT);
  assert.ok(CHARTER_OUT_OF_REACH_WEIGHT > 0, 'there must always be something to grow into');
  assert.equal(charterFleetFit(SMALL, caravans), 1);
  assert.equal(charterFleetFit(EXEC, caravans), CHARTER_OUT_OF_REACH_WEIGHT, 'no bizjet, no executive work at full weight');
  assert.equal(charterFleetFit(getCharterTemplate('adhoc_freight'), caravans), CHARTER_OUT_OF_REACH_WEIGHT);
});

test('work far beneath the fleet is tilted down too', () => {
  const wide = charterFleetProfile([tail('a', 'b7879')]);
  assert.equal(charterFleetFit(SMALL, wide), CHARTER_OUT_OF_REACH_WEIGHT,
    `a ${SMALL.seats[1]}-seat job against a ${wide.minSeats}-seat smallest cabin`);
  const crj = charterFleetProfile([tail('a', 'crj200')]);
  assert.equal(charterFleetFit(SMALL, crj), 1,
    `a 50-seater is still called for 20 people (ratio ${CHARTER_BENEATH_FLEET_RATIO})`);
  assert.equal(charterFleetFit(getCharterTemplate('adhoc_pax'), wide), 1);
});

test('templateWeight applies the fit, and an empty fleet is untilted', () => {
  const caravans = charterFleetProfile([tail('a', 'c208b')]);
  const gov = getCharterTemplate('government');
  assert.equal(templateWeight(gov, 7, [], caravans), templateWeight(gov, 7, []) * CHARTER_OUT_OF_REACH_WEIGHT);
  assert.equal(templateWeight(gov, 7, [], null), templateWeight(gov, 7, []));
});

test('a Caravan startup sees mostly small work; a widebody carrier sees little of it', () => {
  const small = mixOver(boardState({ fleet: [tail('a', 'c208b'), tail('b', 'c208b')] }));
  const wide  = mixOver(boardState({ fleet: [tail('a', 'b7879'), tail('b', 'b7879')] }));
  const none  = mixOver(boardState({ fleet: [] }));
  assert.ok(small.share('adhoc_small') > 0.4,
    `a Caravan fleet should see small work on most slots, saw ${(small.share('adhoc_small') * 100).toFixed(0)}%`);
  assert.ok(wide.share('adhoc_small') < 0.08,
    `a 787 fleet should rarely be offered 8-seat jobs, saw ${(wide.share('adhoc_small') * 100).toFixed(0)}%`);
  assert.ok(wide.share('adhoc_small') > 0, 'but never never');
  assert.ok(small.share('government') < none.share('government'),
    'a Caravan fleet sees less government work than an airline with no fleet at all');
  assert.ok(none.share('adhoc_small') > wide.share('adhoc_small') && none.share('adhoc_small') < small.share('adhoc_small'),
    'no fleet sits between the two: nothing to fit yet');
});

test('the tilt is deterministic — the same fleet, the same board', () => {
  const st = boardState({ fleet: [tail('a', 'c208b')] });
  assert.deepEqual(generateCharterBoard(st, 44), generateCharterBoard(boardState({ fleet: [tail('a', 'c208b')] }), 44));
});

console.log('\n── 6. The guards ────────────────────────────────────────');

const guardState = (fleet) => ({
  ...freshState(),
  phase: 'playing',
  airlineName: 'Guard Air', hub: 'SFO', homeCountry: 'US',
  cash: 60_000_000, week: 30, year: 1,
  gates: { SFO: 6, JFK: 4 }, hubs: { SFO: { tier: 2 } },
  awareness: 60,
  fuelPrice: { index: 1.0, history: [] },
  fleet,
  routes: [], cargoRoutes: [], charters: [],
  charterDismissed: [], charterReliability: 50,
  lastReport: { reputationScore: 60 },
});

/** { year, week } whose absoluteWeek() is `abs` — the inverse of (year-1)*52 + week. */
const calendarAt = (abs) => ({ year: Math.floor((abs - 1) / 52) + 1, week: ((abs - 1) % 52) + 1 });

function firstExecOffer(state) {
  const absWeek = absoluteWeek(state.year, state.week);
  for (let w = absWeek; w < absWeek + 200; w++) {
    const hit = generateCharterBoard({ ...state, absWeek: w }, w).find(o => o.templateId === 'executive');
    if (hit) return { offer: hit, week: w };
  }
  return null;
}

test('the accept guard refuses a non-bizjet on executive work, and admits a bizjet', () => {
  const st0 = guardState([tail('cara', 'c208b'), tail('jet', 'cl350')]);
  const found = firstExecOffer(st0);
  assert.ok(found, 'no executive offer in 200 weeks for a fleet with a Challenger');
  // Move the calendar to the week the offer is on the board.
  const st = { ...st0, ...calendarAt(found.week) };
  assert.equal(absoluteWeek(st.year, st.week), found.week, 'fixture: calendar must land on the offer week');
  const reason = charterAcceptBlockReason(st, found.offer.id, 'cara');
  assert.ok(reason && /business jet/i.test(reason), `expected a business-jet refusal, got: ${reason}`);
  const ok = charterAcceptBlockReason(st, found.offer.id, 'jet');
  assert.ok(ok == null || !/business jet/i.test(ok), `the Challenger was refused for the wrong reason: ${ok}`);
});

test('the reducer will not reassign executive work onto a turboprop', () => {
  const st0 = guardState([tail('cara', 'c208b'), tail('jet', 'cl350')]);
  const found = firstExecOffer(st0);
  const st = { ...st0, ...calendarAt(found.week) };
  const accepted = reducer(st, { type: 'ACCEPT_CHARTER', offerId: found.offer.id, aircraftId: 'jet' });
  const c = (accepted.charters ?? [])[0];
  assert.ok(c, 'the Challenger should have been able to take it');
  assert.equal(c.bizjet, true, 'the contract record remembers that it needs a business jet');
  const moved = reducer(accepted, { type: 'REASSIGN_CHARTER', charterId: c.id, aircraftId: 'cara' });
  assert.equal(moved, accepted, 'reassigning onto the Caravan must be a no-op');
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
