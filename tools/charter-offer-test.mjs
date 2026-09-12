// Charter contracts, package 1: the offer board.
//
// The board is DERIVED, never stored — every offer is a pure function of
// (world seed, slot, the week that slot last refreshed). Three properties have
// to hold or the feature is broken in ways that only show up in a player's save:
//
//   1. Determinism. Two calls on the same state and week produce byte-identical
//      offers, so a reload does not reshuffle the board and a projection can
//      neither predict nor burn a draw. weeklyTick contains no RNG and nothing
//      here may change that.
//   2. Slot staggering. The whole board must NOT turn over every week, or a
//      contract you are clearing block hours for vanishes while you clear them.
//   3. Every posted offer is flyable. A 300-seat rotation into a 5,000 ft strip
//      is not a hard contract, it is a broken one.
//
// Plus the economics: ~28% of offers are priced below a competent operator's
// cost (CHARTER_TRAP_RATE — deliberate, see docs/charter-design.md), the
// reference operator is current metal rather than a 1959 turboprop, and the
// board follows the season and the world's events rather than rolling dice on
// the player.
//
//   node tools/charter-offer-test.mjs

import assert from 'node:assert/strict';
import {
  CHARTER_TEMPLATES, CHARTER_TYPES, CHARTER_TRAP_RATE, CHARTER_MARGIN_TRAP,
  CHARTER_MARGIN_GOOD, templateWeight, referenceTypeFor, typeMeetsRequirement,
  missionCostPerWeek, charterPermitFee, getCharterTemplate,
} from '../src/data/charters.js';
import {
  generateCharterBoard, generateOffer, charterSlotCount, slotTtl, slotPostedWeek,
  servedAirportsOf, pruneDismissed, quoteCharterForAircraft, hashUnit,
  CHARTER_MIN_SLOTS, CHARTER_MAX_SLOTS,
} from '../src/models/charterBoard.js';
import { getAircraftType } from '../src/data/aircraft.js';
import { getAirport } from '../src/data/airports.js';

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.log(`  ✗ ${name}\n      ${(e.stack || e.message).split('\n').slice(0, 4).join('\n      ')}`); failed++; }
}

const baseState = (over = {}) => ({
  airlineName: 'Test Air', hub: 'SFO', homeCountry: 'US',
  gates: { SFO: 3, LAX: 2, ORD: 1 },
  hubs:  { SFO: { tier: 2 }, LAX: { tier: 0 } },
  routes: [
    { origin: 'SFO', destination: 'JFK' },
    { origin: 'SFO', destination: 'SEA' },
    { origin: 'LAX', destination: 'ORD' },
  ],
  cargoRoutes: [],
  awareness: 40,
  gameDate: { month: 7 },
  absWeek: 30,
  charterReliability: 50,
  fuelPrice: { index: 1.0 },
  activeEvents: [],
  lastReport: { reputationScore: 55 },
  ...over,
});

// ── 1. Determinism ───────────────────────────────────────────────────────────

test('the same state and week produce an identical board', () => {
  const a = generateCharterBoard(baseState(), 30);
  const b = generateCharterBoard(baseState(), 30);
  assert.deepEqual(a, b);
  assert.ok(a.length > 0, 'expected a non-empty board');
});

test('a board is not a function of object identity — a rebuilt state matches', () => {
  const s1 = baseState();
  const s2 = JSON.parse(JSON.stringify(s1));      // what a save/load round trip does
  assert.deepEqual(generateCharterBoard(s1, 44), generateCharterBoard(s2, 44));
});

test('a different airline sees a different board', () => {
  const mine   = generateCharterBoard(baseState(), 30);
  const theirs = generateCharterBoard(baseState({ airlineName: 'Other Air' }), 30);
  assert.notDeepEqual(mine.map(o => o.id), theirs.map(o => o.id));
});

// ── 2. Slot staggering ───────────────────────────────────────────────────────

test('an offer keeps its id for its whole time on the board', () => {
  const st = baseState();
  for (let slot = 0; slot < 5; slot++) {
    const ttl = slotTtl(slot);
    // Find a week where this slot has just refreshed, then walk its lifetime.
    let start = null;
    for (let w = 40; w < 40 + ttl + 2; w++) {
      if (slotPostedWeek(`${st.airlineName}|${st.hub}`, slot, w) === w) { start = w; break; }
    }
    assert.ok(start != null, `slot ${slot} never refreshed in the window`);
    const ids = [];
    for (let w = start; w < start + ttl; w++) {
      const o = generateCharterBoard(st, w).find(x => x.slot === slot);
      if (o) ids.push(o.id);
    }
    assert.ok(new Set(ids).size <= 1, `slot ${slot} changed id mid-life: ${ids.join(', ')}`);
  }
});

test('the whole board does not turn over in one week', () => {
  const st = baseState();
  for (let w = 30; w < 50; w++) {
    const now  = generateCharterBoard(st, w).map(o => o.id);
    const next = generateCharterBoard(st, w + 1).map(o => o.id);
    if (now.length < 3) continue;
    const kept = next.filter(id => now.includes(id)).length;
    assert.ok(kept >= 1, `every offer changed between week ${w} and ${w + 1}`);
  }
});

test('slots do refresh — a board is not frozen forever', () => {
  const st = baseState();
  const first = new Set(generateCharterBoard(st, 30).map(o => o.id));
  const later = generateCharterBoard(st, 36).map(o => o.id);
  assert.ok(later.some(id => !first.has(id)), 'no slot refreshed over six weeks');
});

// ── 3. Every posted offer is flyable ─────────────────────────────────────────

test('every offer has a real aircraft that can legally fly it', () => {
  const st = baseState();
  let checked = 0;
  for (let w = 0; w < 160; w += 3) {
    for (const o of generateCharterBoard(st, w)) {
      const type = getAircraftType(o.refTypeId);
      assert.ok(type, `offer ${o.id} references unknown type ${o.refTypeId}`);
      assert.ok(typeMeetsRequirement(type, {
        seats: o.seatsRequired, tonnes: o.tonnesRequired, freighter: o.freighter,
        distanceKm: o.distanceKm, runwayFt: o.runwayFt,
      }), `${o.refTypeId} cannot fly ${o.origin}-${o.destination} (${o.distanceKm}km, ` +
         `${o.seatsRequired ?? o.tonnesRequired}, runway ${o.runwayFt}ft)`);
      checked++;
    }
  }
  assert.ok(checked > 100, `only checked ${checked} offers`);
});

test('a freight contract always asks for a freighter, and a pax one never does', () => {
  for (let w = 0; w < 120; w += 2) {
    for (const o of generateCharterBoard(baseState(), w)) {
      const type = getAircraftType(o.refTypeId);
      if (o.freighter) {
        assert.ok(type.freighter, `${o.templateId} quoted a passenger type`);
        assert.ok(o.tonnesRequired > 0 && o.seatsRequired == null);
      } else {
        assert.ok(!type.freighter, `${o.templateId} quoted a freighter`);
        assert.ok(o.seatsRequired > 0 && o.tonnesRequired == null);
      }
    }
  }
});

test('the runway requirement is the tighter of the two fields', () => {
  for (let w = 0; w < 60; w++) {
    for (const o of generateCharterBoard(baseState(), w)) {
      const o1 = getAirport(o.origin), d1 = getAirport(o.destination);
      assert.equal(o.runwayFt, Math.min(o1.runwayFt ?? 99_999, d1.runwayFt ?? 99_999));
    }
  }
});

// ── 4. The reference operator ────────────────────────────────────────────────

test('a classic game quotes against current metal, never a museum piece', () => {
  // The catalogue is timeless in a classic game, which made a 1959 turboprop the
  // cheapest way to fly a short sector — and every fee was quoted against it.
  for (let w = 0; w < 200; w += 2) {
    for (const o of generateCharterBoard(baseState(), w)) {
      const t = getAircraftType(o.refTypeId);
      assert.equal(t.oop ?? null, null, `${t.id} left production in ${t.oop} and was quoted anyway`);
      assert.equal(t.withdrawnYear ?? null, null, `${t.id} is withdrawn and was quoted anyway`);
    }
  }
});

test('an era game quotes against what was flying that year', () => {
  const ref = referenceTypeFor({
    originCode: 'JFK', destCode: 'LHR', seats: 120, flightsPerWeek: 2, calYear: 1958,
  });
  assert.ok(ref, 'no 1958 reference operator for JFK-LHR');
  assert.ok(ref.type.eis <= 1958, `${ref.type.id} did not fly until ${ref.type.eis}`);
});

test('the reference operator is the CHEAPEST qualifying type, not the smallest', () => {
  const ref = referenceTypeFor({
    originCode: 'SFO', destCode: 'JFK', seats: 150, flightsPerWeek: 3, fuelIndex: 1.0,
  });
  assert.ok(ref);
  const mine = missionCostPerWeek({
    originCode: 'SFO', destCode: 'JFK', type: getAircraftType(ref.type.id), flightsPerWeek: 3,
  });
  // Nothing current that meets the requirement may be cheaper.
  for (const t of [getAircraftType('a320neo'), getAircraftType('b737max8'), getAircraftType('b7878')]) {
    if (!t || t.seats < 150 || t.range < mine.distanceKm || t.oop != null) continue;
    const c = missionCostPerWeek({ originCode: 'SFO', destCode: 'JFK', type: t, flightsPerWeek: 3 });
    assert.ok(ref.cost.total <= c.total + 1, `${t.id} beats the chosen reference ${ref.type.id}`);
  }
});

// ── 5. Trap density ──────────────────────────────────────────────────────────

test('about 28% of offers are priced below a competent operator’s cost', () => {
  let traps = 0, n = 0;
  for (const name of ['Test Air', 'Second Air', 'Third Air', 'Fourth Air']) {
    const st = baseState({ airlineName: name });
    for (let w = 0; w < 400; w++) {
      for (const o of generateCharterBoard(st, w)) { n++; if (o.isTrap) traps++; }
    }
  }
  const rate = traps / n;
  assert.ok(n > 2000, `sample too small (${n})`);
  assert.ok(Math.abs(rate - CHARTER_TRAP_RATE) < 0.05,
    `trap rate ${(rate * 100).toFixed(1)}% is not ~${CHARTER_TRAP_RATE * 100}% (n=${n})`);
});

test('a trap is under water and an honest offer is not', () => {
  for (let w = 0; w < 200; w++) {
    for (const o of generateCharterBoard(baseState(), w)) {
      if (o.isTrap) assert.ok(o.margin <= CHARTER_MARGIN_TRAP[1] + 1e-9, `trap margin ${o.margin}`);
      else          assert.ok(o.margin >= CHARTER_MARGIN_GOOD[0] - 0.09, `honest margin ${o.margin}`);
    }
  }
});

test('a spotless record lifts the honest band but never removes the traps', () => {
  const lo = baseState({ charterReliability: 0,   awareness: 100, lastReport: { reputationScore: 100 } });
  const hi = baseState({ charterReliability: 100, awareness: 100, lastReport: { reputationScore: 100 } });
  let loSum = 0, hiSum = 0, loTraps = 0, hiTraps = 0, loN = 0, hiN = 0;
  for (let w = 0; w < 300; w++) {
    for (const o of generateCharterBoard(lo, w)) { loSum += o.margin; if (o.isTrap) loTraps++; loN++; }
    for (const o of generateCharterBoard(hi, w)) { hiSum += o.margin; if (o.isTrap) hiTraps++; hiN++; }
  }
  assert.ok(hiSum / hiN > loSum / loN, 'reliability did not improve the offers at all');
  // Rates, not counts: a trusted carrier is shown MORE work, so it also sees more
  // duds in absolute terms. What must not move is the share of the board that is
  // a trap — a good record buys better-paid work, never a pre-vetted board.
  assert.ok(Math.abs(hiTraps / hiN - loTraps / loN) < 0.03,
    `reliability changed the trap RATE (${(loTraps / loN * 100).toFixed(1)}% -> ${(hiTraps / hiN * 100).toFixed(1)}%)`);
});

// ── 6. The board follows the world, not the player ───────────────────────────

test('ski work is a winter business and beach work is a summer one', () => {
  const ski   = getCharterTemplate('series_ski');
  const beach = getCharterTemplate('series_leisure');
  assert.ok(templateWeight(ski, 1)  > templateWeight(ski, 7),  'ski series not weighted to winter');
  assert.ok(templateWeight(beach, 7) > templateWeight(beach, 1), 'leisure series not weighted to summer');
});

test('a fuel shock pushes ACMI up the board — the customer buys the fuel', () => {
  const acmi = CHARTER_TEMPLATES.find(t => t.type === CHARTER_TYPES.ACMI);
  const calm  = templateWeight(acmi, 6, []);
  const spike = templateWeight(acmi, 6, [{ type: 'fuel' }]);
  assert.ok(spike > calm, 'a fuel event did not favour ACMI');
});

test('a downturn thins the leisure board', () => {
  const beach = getCharterTemplate('series_leisure');
  assert.ok(templateWeight(beach, 7, [{ type: 'economy' }]) < templateWeight(beach, 7, []));
});

test('a disruption brings sub-service cover onto the board', () => {
  const sub = getCharterTemplate('subservice');
  assert.ok(templateWeight(sub, 6, [{ type: 'disruption' }]) > templateWeight(sub, 6, []) * 2);
});

test('an out-of-season template is thinned, never extinct', () => {
  const ski = getCharterTemplate('series_ski');
  assert.ok(templateWeight(ski, 7) > 0, 'ski work vanished entirely in July');
  assert.ok(templateWeight(ski, 7) < templateWeight(ski, 1) * 0.5);
});

// ── 7. Board size is earned ──────────────────────────────────────────────────

test('a week-one startup sees a thin board and a mature carrier a full one', () => {
  const startup = charterSlotCount({ awareness: 2,   reputation: 50,  reliability: 50 });
  const mature  = charterSlotCount({ awareness: 95,  reputation: 90,  reliability: 95 });
  assert.equal(startup, CHARTER_MIN_SLOTS);
  assert.equal(mature,  CHARTER_MAX_SLOTS);
  assert.ok(charterSlotCount({ awareness: 50, reputation: 50, reliability: 50 }) > startup);
  // Awareness gates the board: a carrier nobody has heard of is offered almost
  // nothing, however good its reputation and record are.
  assert.equal(charterSlotCount({ awareness: 1, reputation: 100, reliability: 100 }), CHARTER_MIN_SLOTS);
});

test('slot count is monotonic in every input', () => {
  let prev = 0;
  for (let a = 0; a <= 100; a += 5) {
    const n = charterSlotCount({ awareness: a, reputation: 50, reliability: 50 });
    assert.ok(n >= prev, `awareness ${a} lowered the slot count`);
    prev = n;
  }
});

// ── 8. Offers come to carriers where they operate ────────────────────────────

test('most offers originate on the network the airline actually flies', () => {
  const st = baseState();
  const served = servedAirportsOf(st);
  let onNet = 0, n = 0;
  for (let w = 0; w < 300; w++) {
    for (const o of generateCharterBoard(st, w)) { n++; if (served.has(o.origin)) onNet++; }
  }
  const share = onNet / n;
  assert.ok(share > 0.5, `only ${(share * 100).toFixed(0)}% of offers start on the network (n=${n})`);
});

test('some work is out of reach — there is always something to grow into', () => {
  const st = baseState();
  const served = servedAirportsOf(st);
  let off = 0;
  for (let w = 0; w < 200; w++) {
    for (const o of generateCharterBoard(st, w)) if (!served.has(o.origin)) off++;
  }
  assert.ok(off > 0, 'every single offer was on-network — nothing to grow into');
});

test('an airline with no routes at all still gets a board', () => {
  const st = baseState({ routes: [], cargoRoutes: [], gates: {}, hubs: {} });
  const board = generateCharterBoard(st, 1);
  assert.ok(board.length >= CHARTER_MIN_SLOTS - 1, `week-one board was empty`);
});

// ── 9. Accepted and dismissed offers leave the board ─────────────────────────

test('an accepted offer is gone from the board', () => {
  const st = baseState();
  const first = generateCharterBoard(st, 30)[0];
  const after = generateCharterBoard({ ...st, charters: [{ offerId: first.id }] }, 30);
  assert.ok(!after.some(o => o.id === first.id));
});

test('a dismissed offer is gone from the board', () => {
  const st = baseState();
  const first = generateCharterBoard(st, 30)[0];
  const after = generateCharterBoard({ ...st, charterDismissed: [first.id] }, 30);
  assert.ok(!after.some(o => o.id === first.id));
});

test('the dismissed list cannot grow without bound', () => {
  const st = baseState();
  const ids = generateCharterBoard(st, 30).map(o => o.id);
  assert.ok(pruneDismissed(ids, 30).length === ids.length, 'pruned live offers');
  assert.equal(pruneDismissed(ids, 999).length, 0, 'expired offers were kept');
  assert.equal(pruneDismissed(['nonsense'], 10).length, 0);
});

// ── 10. The quote ────────────────────────────────────────────────────────────

const tail = (typeId) => ({ id: 'a1', typeId, status: 'idle', fuelMod: 1.0, ageWeeks: 40 });

test('the quote prices the mission for YOUR tail, not the reference', () => {
  const offer = generateCharterBoard(baseState(), 30).find(o => !o.freighter);
  const served = servedAirportsOf(baseState());
  const thirsty = quoteCharterForAircraft(offer, tail('b747400'), getAircraftType('b747400'), { served });
  const lean    = quoteCharterForAircraft(offer, tail('b7878'),   getAircraftType('b7878'),   { served });
  assert.ok(thirsty && lean);
  assert.ok(thirsty.perWeek.fuel > lean.perWeek.fuel,
    'a 747 and a 787 were quoted the same fuel bill — the whole feature rests on this');
});

test('ACMI hands the fuel bill to the customer', () => {
  const st = baseState();
  const served = servedAirportsOf(st);
  let acmi = null;
  for (let w = 0; w < 300 && !acmi; w++) {
    acmi = generateCharterBoard(st, w).find(o => o.type === CHARTER_TYPES.ACMI) ?? null;
  }
  assert.ok(acmi, 'no ACMI offer appeared in 300 weeks');
  const q = quoteCharterForAircraft(acmi, tail('b7878'), getAircraftType('b7878'), { served });
  assert.equal(q.perWeek.fuel, 0);
  assert.equal(q.fuelBoughtByCustomer, true);
  assert.ok(q.perWeek.crew > 0, 'ACMI still costs you crew');
});

test('an unserved endpoint costs handling every week and a permit once', () => {
  const offer = generateCharterBoard(baseState(), 30).find(o => !o.freighter);
  const type = getAircraftType('b7878');
  const known   = quoteCharterForAircraft(offer, tail('b7878'), type,
    { served: new Set([offer.origin, offer.destination]) });
  const strange = quoteCharterForAircraft(offer, tail('b7878'), type, { served: new Set() });
  assert.ok(strange.perWeek.handling > known.perWeek.handling);
  assert.equal(known.perWeek.handling, 0);
  assert.ok(strange.permits > 0);
  assert.equal(known.permits, 0);
});

test('positioning an aircraft to the pickup costs fuel and crew, and nothing if it is already there', () => {
  const offer = generateCharterBoard(baseState(), 30).find(o => !o.freighter);
  const type = getAircraftType('b7878');
  const served = servedAirportsOf(baseState());
  const there = quoteCharterForAircraft(offer, tail('b7878'), type, { served, positionFrom: offer.origin });
  const away  = quoteCharterForAircraft(offer, tail('b7878'), type, { served, positionFrom: 'SIN' });
  assert.equal(there.ferry, 0);
  assert.ok(away.ferry > 0, 'a ferry from Singapore cost nothing');
  assert.ok(away.ferryKm > 0);
});

test('a permit is charged per unserved end, and the tier sets the price', () => {
  const both = charterPermitFee({ originCode: 'JFK', destCode: 'LAX', originServed: false, destServed: false });
  const one  = charterPermitFee({ originCode: 'JFK', destCode: 'LAX', originServed: true,  destServed: false });
  assert.ok(both > one && one > 0);
  const regional = charterPermitFee({ originCode: 'BLI', destCode: 'BLI', originServed: false, destServed: true });
  const mega     = charterPermitFee({ originCode: 'JFK', destCode: 'JFK', originServed: false, destServed: true });
  assert.ok(mega > regional, 'a mega hub permit is not dearer than a regional one');
});

// ── 11. Fee shape ────────────────────────────────────────────────────────────

test('the fee is the weekly fee times the term, and the penalty is a share of it', () => {
  for (let w = 0; w < 80; w++) {
    for (const o of generateCharterBoard(baseState(), w)) {
      assert.equal(o.fee, o.feePerWeek * o.weeks);
      assert.ok(o.breachPenalty > 0 && o.breachPenalty < o.fee);
      assert.ok(o.weeks >= 1 && o.flightsPerWeek >= 1);
      assert.ok(o.expiresWeek >= o.postedWeek);
    }
  }
});

test('a longer contract is worth more than a short one on the same lane', () => {
  const o = generateCharterBoard(baseState(), 30)[0];
  assert.ok(o.feePerWeek > 0);
  assert.ok(o.fee >= o.feePerWeek);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
