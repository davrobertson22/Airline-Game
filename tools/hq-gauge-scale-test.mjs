// HQ overhead scales with the aeroplane, not the airframe count.
//
// calcHQCost counted AIRFRAMES, so two turboprops and two A320s were billed the
// same $68,495 a week — and a turboprop pair's entire GROSS weekly revenue at
// one round trip a day is about $48,700. Head office alone was 141% of revenue
// before fuel, crew or leases.
//
// Crew pay (CREW_SCALE_BY_CATEGORY, labor.js) and liability insurance
// (LIABILITY_INSURANCE_WEEKLY_BY_CATEGORY, overhead.js) had the identical defect
// and both already step by category. HQ was the last fixed cost still counting
// frames. Ported from Headwinds, where six live worlds measured the damage:
// sub-80-seat starts died at 70% against a narrowbody's 38%, and 11 of 13 never
// recorded a single profitable week.
//
// The load-bearing property is that Narrow Body is 1.00 BY CONSTRUCTION: this is
// a re-shape, not a rise, and an all-narrowbody airline's bill must not move by
// a single dollar.
//
//   node tools/hq-gauge-scale-test.mjs

import assert from 'node:assert/strict';
import { AIRCRAFT_TYPES, getAircraftType } from '../src/data/aircraft.js';
import {
  calcHQCost, hqScaleFor, fleetHQScale,
  HQ_SCALE_BY_CATEGORY, HQ_SCALE_FREIGHTER,
} from '../src/data/overhead.js';
import { weeklyTick } from '../src/utils/simulation.js';

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.log(`  ✗ ${name}\n      ${(e.stack || e.message).split('\n').slice(0, 3).join('\n      ')}`); failed++; }
}

const firstOf = (cat) => AIRCRAFT_TYPES.find(t => t.category === cat && !t.freighter && !t.doubleDeck);
const TP = firstOf('Turboprop'), NB = firstOf('Narrow Body'), WB = firstOf('Wide Body');
for (const [n, t] of Object.entries({ TP, NB, WB })) {
  if (!t) throw new Error(`no catalogue type found for ${n} — fixture is broken`);
}

function tickWith(typeId, n, freq) {
  const fleet = [], routes = [];
  for (let i = 0; i < n; i++) {
    fleet.push({ id: 'a' + i, typeId, status: 'idle', ownershipType: 'owned', ageWeeks: 20, config: {} });
    routes.push({ id: 'r' + i, aircraftId: 'a' + i, origin: 'JFK', destination: 'LAX', weeklyFrequency: freq, ticketPrice: 300 });
  }
  return weeklyTick({ fleet, routes, cargoRoutes: [], gates: { JFK: 20, LAX: 20 }, hubs: {} });
}

console.log('\nNarrow Body is 1.00 by construction');

test('the narrowbody scale is exactly 1', () => {
  assert.equal(HQ_SCALE_BY_CATEGORY['Narrow Body'], 1);
  assert.equal(hqScaleFor(NB), 1);
});

test('an all-narrowbody fleet still bills the old fleet-count curve, to the dollar', () => {
  for (const n of [1, 2, 5, 10, 40]) {
    assert.equal(tickWith(NB.id, n, 3).totalHQCost, Math.round(38_000 * Math.pow(n, 0.85)),
      `${n} narrowbodies must be unchanged`);
  }
});

console.log('\nsmall gauge pays a small-gauge head office');

test('a turboprop pair is billed on 0.7 narrowbody-equivalents, not 2 airframes', () => {
  const r = tickWith(TP.id, 2, 3);
  assert.equal(r.totalHQCost, calcHQCost(2 * HQ_SCALE_BY_CATEGORY['Turboprop']));
  assert.notEqual(r.totalHQCost, calcHQCost(2));
});

test("head office no longer exceeds a turboprop pair's gross weekly revenue", () => {
  const grossAtOneRotationADay = 14 * 3_481;   // $3,481 per turboprop departure
  assert.ok(calcHQCost(2) > grossAtOneRotationADay, 'precondition: the old bill was above gross');
  assert.ok(tickWith(TP.id, 3, 3).totalHQCost < grossAtOneRotationADay);
});

console.log('\nupgauging cannot dodge overhead');

test('the scale table is ordered by aircraft size', () => {
  const order = ['Turboprop', 'Regional Jet', 'Narrow Body', 'Wide Body', 'Double Deck'];
  for (let i = 1; i < order.length; i++) {
    assert.ok(HQ_SCALE_BY_CATEGORY[order[i]] > HQ_SCALE_BY_CATEGORY[order[i - 1]],
      `${order[i]} should administer for more than ${order[i - 1]}`);
  }
});

test('ten widebodies cost more head office than ten narrowbodies', () => {
  assert.ok(tickWith(WB.id, 10, 3).totalHQCost > tickWith(NB.id, 10, 3).totalHQCost);
});

console.log('\nfreighters, unknowns and double-deckers');

test('freighters step by payload, not by their single shared category', () => {
  const small = AIRCRAFT_TYPES.find(t => t.freighter && (t.payloadTonnes ?? 0) <= 20);
  const large = AIRCRAFT_TYPES.find(t => t.freighter && (t.payloadTonnes ?? 0) > 130);
  if (!small || !large) throw new Error('catalogue has no small/large freighter pair to compare');
  assert.ok(hqScaleFor(large) > hqScaleFor(small));
  assert.equal(hqScaleFor(small), HQ_SCALE_FREIGHTER[0].scale);
});

test('a double-decker is priced as one even if its category says otherwise', () => {
  assert.equal(hqScaleFor({ category: 'Wide Body', doubleDeck: true }), HQ_SCALE_BY_CATEGORY['Double Deck']);
});

test('an unknown category is charged the common rate, never zero', () => {
  assert.equal(hqScaleFor({ category: 'Orbital Shuttle' }), 1);
  assert.equal(hqScaleFor(null), 1);
  assert.equal(hqScaleFor(undefined), 1);
});

test('fleetHQScale sums, and an all-narrowbody fleet returns its own count', () => {
  const fleet = [{ typeId: NB.id }, { typeId: NB.id }, { typeId: NB.id }];
  assert.equal(fleetHQScale(fleet, a => getAircraftType(a.typeId)), 3);
  assert.equal(fleetHQScale([], () => null), 0);
  assert.equal(fleetHQScale(null, () => null), 0);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
