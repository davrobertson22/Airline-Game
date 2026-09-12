// Charter contracts, package 3: what a contract week actually costs and pays.
//
// The board prices every contract off a notional efficient operator, so the
// cheque is the same whoever signs it. Everything that decides whether the
// contract MADE money happens in the tick — this airframe's burn, this lane's
// fees, the handling premium at a station you do not serve, the empty leg you
// flew to get there. These tests pin that, and the three ways a contract ends:
// it runs its term, you walk away, or your aeroplane breaks and you breach.
//
// Two structural properties matter as much as the economics:
//   * An airline holding no contracts must tick EXACTLY as it did before. The
//     feature is on for every save with no world flag, and that is what makes it
//     safe (docs/charter-design.md, "Decisions (locked)").
//   * The forecast must include charter money. A revenue line the projection
//     cannot see is the P6 drift bug again, where Finance quietly disagreed with
//     the actuals every week.
//
//   node --import ./tools/_register-loader.mjs tools/charter-tick-test.mjs

import assert from 'node:assert/strict';
import {
  simulateCharter, weeklyTick, MAX_WEEKLY_BLOCK_HOURS, defaultConfig,
} from '../src/utils/simulation.js';
import { projectWeek } from '../src/utils/financeProjection.js';
import { costBridge, bridgeInputsFromReport } from '../src/utils/pnlBridge.js';
import { getAircraftType } from '../src/data/aircraft.js';
import {
  CHARTER_TYPES, CHARTER_RELIABILITY_START, CHARTER_RELIABILITY_ON_COMPLETE,
  CHARTER_RELIABILITY_ON_BREACH, applyReliability,
} from '../src/data/charters.js';

const { gameReducer: reducer, freshState, settleCharters } = await import('../src/store/GameContext.jsx');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.log(`  ✗ ${name}\n      ${(e.stack || e.message).split('\n').slice(0, 5).join('\n      ')}`); failed++; }
}

// ── Fixtures ─────────────────────────────────────────────────────────────────

const tail = (id, typeId, over = {}) => {
  const type = getAircraftType(typeId);
  return {
    id, typeId, name: id, tailNumber: `N${id}`, status: 'assigned',
    ageWeeks: 60, ownershipType: 'owned', fuelMod: 1.0,
    config: type?.freighter ? null : defaultConfig(type.seats),
    ...over,
  };
};

const contract = (over = {}) => ({
  id: 'c1', charter: true, offerId: 'chtr-0-0-aaa',
  templateId: 'series_leisure', type: CHARTER_TYPES.SERIES,
  name: 'Tour operator series', icon: '🏖️', customer: 'a holiday group',
  origin: 'SFO', destination: 'JFK', stops: ['SFO', 'JFK'],
  aircraftId: 'ac1', weeklyFrequency: 3, distanceKm: 4152,
  seatsRequired: 160, tonnesRequired: null, freighter: false,
  fee: 2_200_000, feePerWeek: 220_000,
  weeksTotal: 10, weeksRemaining: 10,
  startWeek: 30, positioningWeeksRemaining: 0, positionFrom: null,
  ferryCost: 0, ferryKm: 0, permitsPaid: 0,
  originServed: true, destServed: true,
  status: 'active', breachPenalty: 770_000, reputationStake: 4,
  ...over,
});

const baseState = (over = {}) => ({
  ...freshState(),
  phase: 'playing',
  airlineName: 'Charter Tick Air', hub: 'SFO', homeCountry: 'US',
  cash: 60_000_000, week: 30, year: 1,
  gates: { SFO: 6, JFK: 4 }, hubs: { SFO: { tier: 2 } },
  awareness: 55,
  fuelPrice: { index: 1.0, history: [] },
  fleet: [tail('ac1', 'b737max8200')],
  routes: [], cargoRoutes: [], charters: [],
  charterDismissed: [], charterReliability: CHARTER_RELIABILITY_START,
  ...over,
});

// ── 1. One contract week ─────────────────────────────────────────────────────

test('a working week pays the agreed fee and charges what it cost you to fly', () => {
  const a = tail('ac1', 'b737max8200');
  const r = simulateCharter(contract(), a, 1.0);
  assert.equal(r.revenue, 220_000);
  assert.ok(r.fuelCost > 0 && r.crewCost > 0 && r.landingFee > 0);
  assert.equal(r.totalOpCost, r.fuelCost + r.crewCost + r.landingFee + r.handlingCost);
  assert.equal(r.profit, r.revenue - r.totalOpCost);
  assert.ok(r.blockHours > 0);
});

test('the same cheque is worth less to a thirstier aeroplane', () => {
  // The whole feature in one assertion: the fee does not know what you fly.
  const c = contract();
  // Both can legally fly it; only one was what the fee was priced against.
  const lean    = simulateCharter(c, tail('ac1', 'b737max8200'), 1.0);
  const thirsty = simulateCharter(c, tail('ac1', 'b7878'),       1.0);
  assert.equal(lean.revenue, thirsty.revenue);
  assert.ok(thirsty.fuelCost > lean.fuelCost);
  assert.ok(thirsty.profit < lean.profit,
    'a widebody and a narrowbody made the same money on a fixed-fee contract');
  assert.ok(lean.profit > 0 && thirsty.profit < 0,
    'the right metal should clear this contract and the wrong metal should not');
});

test('a modded airframe burns less on the same contract', () => {
  const c = contract();
  const stock  = simulateCharter(c, tail('ac1', 'b737max8200'), 1.0);
  const modded = simulateCharter(c, tail('ac1', 'b737max8200', { fuelMod: 0.92 }), 1.0);
  assert.ok(modded.fuelCost < stock.fuelCost);
  assert.ok(modded.profit > stock.profit);
});

test('a fuel spike eats a fixed-fee contract and leaves ACMI alone', () => {
  // The lesson the player is meant to learn once: on ACMI the fuel is the
  // customer's problem, which is why it climbs the board during a spike.
  const fixed = contract();
  const acmi  = contract({ type: CHARTER_TYPES.ACMI });
  const a = tail('ac1', 'b737max8200');

  const fixedCalm  = simulateCharter(fixed, a, 1.0);
  const fixedSpike = simulateCharter(fixed, a, 1.6);
  const acmiCalm   = simulateCharter(acmi,  a, 1.0);
  const acmiSpike  = simulateCharter(acmi,  a, 1.6);

  assert.ok(fixedSpike.profit < fixedCalm.profit, 'a fuel spike did not hurt a fixed-fee contract');
  assert.equal(acmiCalm.fuelCost, 0);
  assert.equal(acmiSpike.profit, acmiCalm.profit, 'a fuel spike reached an ACMI contract');
});

test('a station you do not serve costs a handling premium every week', () => {
  const known   = simulateCharter(contract(), tail('ac1', 'b737max8200'), 1.0);
  const strange = simulateCharter(contract({ destServed: false }), tail('ac1', 'b737max8200'), 1.0);
  assert.equal(known.handlingCost, 0);
  assert.ok(strange.handlingCost > 0);
  assert.ok(strange.profit < known.profit);
});

test('a positioning week earns nothing and still costs the empty leg', () => {
  const c = contract({ status: 'positioning', positioningWeeksRemaining: 1,
                       positionFrom: 'LAX', ferryCost: 90_000, ferryKm: 1200 });
  const r = simulateCharter(c, tail('ac1', 'b737max8200'), 1.0);
  assert.equal(r.revenue, 0);
  assert.equal(r.positioning, true);
  assert.equal(r.totalOpCost, 90_000);
  assert.ok(r.profit < 0);
  assert.ok(r.blockHours > 0, 'a ferry leg cost no block hours');
});

// ── 2. The tick ──────────────────────────────────────────────────────────────

test('charter money lands in the week’s revenue and its own report lines', () => {
  const st = baseState({ charters: [contract()] });
  const report = weeklyTick(st);
  assert.equal(report.charterResults.length, 1);
  assert.equal(report.totalCharterRevenue, 220_000);
  assert.ok(report.totalCharterProfit !== 0);
  assert.ok(report.totalRevenue >= report.totalCharterRevenue,
    'charter revenue is missing from the grand total');
  assert.ok(report.charterBlockHours > 0);
});

test('an airline with no contracts ticks exactly as it did before', () => {
  // No world flag guards this feature, so THIS is what makes it safe to ship to
  // every existing save.
  const st = baseState({
    routes: [{ id: 'r1', origin: 'SFO', destination: 'JFK', stops: ['SFO', 'JFK'],
               aircraftId: 'ac1', weeklyFrequency: 7, weeksOpen: 40, hub: 'SFO' }],
  });
  const withField = weeklyTick(st);
  const without   = weeklyTick({ ...st, charters: undefined });
  assert.equal(withField.totalRevenue, without.totalRevenue);
  assert.equal(withField.totalCost,    without.totalCost);
  assert.equal(withField.cashDelta,    without.cashDelta);
  assert.equal(withField.totalCharterRevenue, 0);
  assert.deepEqual(withField.charterResults, []);
});

test('the report always names the charter lines, even at zero', () => {
  const report = weeklyTick(baseState());
  for (const k of ['charterResults', 'totalCharterRevenue', 'totalCharterCost',
                   'totalCharterProfit', 'charterBlockHours']) {
    assert.ok(k in report, `report is missing ${k} — Finance cannot name it unconditionally`);
  }
});

test('a broken aeroplane breaches the contract rather than quietly skipping it', () => {
  // A grounded cargo route just earns nothing. A grounded CONTRACT is a breach,
  // and the difference is the whole reason charters have teeth.
  const st = baseState({
    charters: [contract()],
    fleet: [tail('ac1', 'b737max8200', { status: 'grounded', groundedWeeksLeft: 4, groundedReason: 'aog' })],
  });
  const report = weeklyTick(st);
  assert.equal(report.charterResults.length, 1);
  assert.equal(report.charterResults[0].breached, true);
  assert.equal(report.totalCharterRevenue, 0);
});

test('a contract nobody can crew is a breach too', () => {
  const st = baseState({ charters: [contract()], crewGroundedIds: ['ac1'] });
  const report = weeklyTick(st);
  assert.equal(report.charterResults[0].breached, true);
  assert.equal(report.charterResults[0].reason, 'no-crew');
});

// ── 3. Settlement ────────────────────────────────────────────────────────────

test('a contract’s clock runs down one week at a time', () => {
  const st = baseState({ charters: [contract({ weeksRemaining: 4 })] });
  const out = settleCharters(st, weeklyTick(st));
  assert.equal(out.charters.length, 1);
  assert.equal(out.charters[0].weeksRemaining, 3);
  assert.equal(out.completed.length, 0);
  assert.equal(out.reliability, CHARTER_RELIABILITY_START);
});

test('the last week completes the contract and pays off the record', () => {
  const st = baseState({ charters: [contract({ weeksRemaining: 1 })] });
  const out = settleCharters(st, weeklyTick(st));
  assert.equal(out.charters.length, 0);
  assert.equal(out.completed.length, 1);
  assert.equal(out.completed[0].status, 'complete');
  assert.equal(out.reliability,
    applyReliability(CHARTER_RELIABILITY_START, CHARTER_RELIABILITY_ON_COMPLETE));
});

test('positioning burns a week of the ferry, not a week of the term', () => {
  const st = baseState({
    charters: [contract({ status: 'positioning', positioningWeeksRemaining: 1,
                          weeksRemaining: 10, ferryCost: 50_000, ferryKm: 900, positionFrom: 'LAX' })],
  });
  const out = settleCharters(st, weeklyTick(st));
  assert.equal(out.charters[0].status, 'active');
  assert.equal(out.charters[0].weeksRemaining, 10, 'positioning ate a week of the contract term');
});

test('a breach costs the penalty and four completions’ worth of record', () => {
  const st = baseState({
    charters: [contract()],
    fleet: [tail('ac1', 'b737max8200', { status: 'grounded', groundedWeeksLeft: 4, groundedReason: 'aog' })],
  });
  const out = settleCharters(st, weeklyTick(st));
  assert.equal(out.breached.length, 1);
  assert.equal(out.charters.length, 0);
  assert.equal(out.penalties, 770_000);
  assert.equal(out.reliability,
    applyReliability(CHARTER_RELIABILITY_START, CHARTER_RELIABILITY_ON_BREACH));
  assert.ok(Math.abs(CHARTER_RELIABILITY_ON_BREACH) > 3 * CHARTER_RELIABILITY_ON_COMPLETE,
    'a breach should cost more than a few completions earn');
});

// ── 3b. The reserve fleet earns its keep ─────────────────────────────────────

test('a stationed reserve rescues a contract the assigned tail cannot fly', () => {
  // Without this, a heavy check on the wrong week is an automatic breach and the
  // only defence is never signing anything long. With it, the standby costs the
  // reserve fleet charges finally buy something besides schedule protection.
  const st = baseState({
    charters: [contract()],
    fleet: [
      tail('ac1', 'b737max8200', { status: 'grounded', groundedWeeksLeft: 4, groundedReason: 'aog' }),
      tail('spare', 'b737max8200', { status: 'idle', reserveBase: 'SFO' }),
    ],
  });
  const next = reducer(st, { type: 'ADVANCE_WEEK' });
  assert.equal(next.charters.length, 1, 'the contract was breached despite a spare standing by');
  assert.equal(next.charters[0].aircraftId, 'spare', 'the reserve was not dispatched onto the contract');
  assert.equal(next.charters[0].coverForAircraftId, 'ac1');
  assert.equal(next.charters[0].weeksRemaining, 9, 'a covered week did not count toward the term');
  assert.ok(next.charterReliability >= CHARTER_RELIABILITY_START, 'the record took a hit anyway');
});

test('the contract goes home the week the original aeroplane does', () => {
  const st = baseState({
    charters: [contract()],
    fleet: [
      tail('ac1', 'b737max8200', { status: 'grounded', groundedWeeksLeft: 1, groundedReason: 'aog' }),
      tail('spare', 'b737max8200', { status: 'idle', reserveBase: 'SFO' }),
    ],
  });
  // One week of grounding left: prepareWeek returns the tail to service before
  // the tick, so it flies its own contract and nothing is covered at all.
  const next = reducer(st, { type: 'ADVANCE_WEEK' });
  assert.equal(next.charters[0].aircraftId, 'ac1');
  assert.ok(!next.charters[0].coverForAircraftId);
});

test('a reserve of the wrong type cannot save the contract', () => {
  const st = baseState({
    charters: [contract()],
    fleet: [
      tail('ac1', 'b737max8200', { status: 'grounded', groundedWeeksLeft: 4, groundedReason: 'aog' }),
      tail('spare', 'b7878', { status: 'idle', reserveBase: 'SFO' }),
    ],
  });
  const next = reducer(st, { type: 'ADVANCE_WEEK' });
  assert.equal(next.charters.length, 0, 'a widebody covered a narrowbody contract');
  assert.ok(next.charterReliability < CHARTER_RELIABILITY_START);
});

// ── 4. Through the reducer ───────────────────────────────────────────────────

/**
 * ADVANCE_WEEK rolls world events and walks the fuel price, both from
 * Math.random. Two runs are therefore NOT comparable: one can draw a fuel spike
 * the other does not, which swamps a contract's contribution and makes any
 * cash-difference assertion flaky (it was — roughly one run in three).
 *
 * So: pin the sequence, and reset it before each run, and the only thing that can
 * differ between the two is the thing under test.
 */
function advanceDeterministically(state) {
  const real = Math.random;
  let seed = 0x2545f491;
  Math.random = () => {
    seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; seed >>>= 0;
    return seed / 0x100000000;
  };
  try { return reducer(state, { type: 'ADVANCE_WEEK' }); }
  finally { Math.random = real; }
}

test('a week of contract flying reaches the bank', () => {
  const idle = baseState();
  const busy = baseState({ charters: [contract()] });
  const a = advanceDeterministically(idle);
  const b = advanceDeterministically(busy);
  assert.ok(b.cash > a.cash, 'a contract week left the airline no better off');
  assert.equal(b.charters.length, 1);
  assert.equal(b.charters[0].weeksRemaining, 9);
});

test('a completed contract frees the aeroplane and lifts the record', () => {
  const st = baseState({ charters: [contract({ weeksRemaining: 1 })] });
  const next = reducer(st, { type: 'ADVANCE_WEEK' });
  assert.equal(next.charters.length, 0);
  assert.equal(next.fleet.find(a => a.id === 'ac1').status, 'idle');
  assert.ok(next.charterReliability > CHARTER_RELIABILITY_START);
});

test('a breach takes the penalty out of the bank and out of the reputation', () => {
  const st = baseState({
    charters: [contract()],
    fleet: [tail('ac1', 'b737max8200', { status: 'grounded', groundedWeeksLeft: 4, groundedReason: 'aog' })],
  });
  const clean = advanceDeterministically(
    baseState({ fleet: [tail('ac1', 'b737max8200', { status: 'grounded', groundedWeeksLeft: 4, groundedReason: 'aog' })] }));
  const next = advanceDeterministically(st);
  assert.equal(next.charters.length, 0);
  assert.ok(next.charterReliability < CHARTER_RELIABILITY_START);
  assert.ok(next.cash < clean.cash, 'the breach penalty never left the bank');
  assert.ok((next.reputationPenalty ?? 0) > (clean.reputationPenalty ?? 0),
    'breaching a signed contract cost the airline no reputation');
});

test('a tail still flying a schedule is not idled when its contract ends', () => {
  const st = baseState({
    charters: [contract({ weeksRemaining: 1 })],
    routes: [{ id: 'r1', origin: 'SFO', destination: 'JFK', stops: ['SFO', 'JFK'],
               aircraftId: 'ac1', weeklyFrequency: 4, weeksOpen: 30, hub: 'SFO' }],
  });
  const next = reducer(st, { type: 'ADVANCE_WEEK' });
  assert.equal(next.fleet.find(a => a.id === 'ac1').status, 'assigned');
});

test('the week’s history names the charter money', () => {
  const st = baseState({ charters: [contract()] });
  const next = reducer(st, { type: 'ADVANCE_WEEK' });
  const h = next.financialHistory[next.financialHistory.length - 1];
  assert.equal(h.charterRevenue, 220_000);
  assert.ok('charterProfit' in h && 'charterPenalties' in h);
  const s = next.statsHistory[next.statsHistory.length - 1];
  assert.equal(s.charterRevenue, 220_000);
});

// ── 5. The wiring that drifts if forgotten ───────────────────────────────────

test('the forecast can see charter money', () => {
  // P6 all over again if this breaks: Finance would quietly disagree with the
  // actuals every week a contract runs.
  const idle = projectWeek(baseState());
  const busy = projectWeek(baseState({ charters: [contract()] }));
  assert.ok(busy.report.totalCharterRevenue === 220_000);
  assert.ok(busy.effectiveRevenue > idle.effectiveRevenue,
    'the forecast did not include the contract fee');
  assert.ok(Number.isFinite(busy.netCash));
});

test('the P&L bridge accounts for every charter dollar', () => {
  // The bridge is self-checking: an unexplained dollar shows up as `residual`.
  const st = baseState({
    charters: [contract()],
    routes: [{ id: 'r1', origin: 'SFO', destination: 'JFK', stops: ['SFO', 'JFK'],
               aircraftId: 'ac1', weeklyFrequency: 3, weeksOpen: 40, hub: 'SFO' }],
  });
  const bridge = costBridge(projectWeek(st), st);
  assert.equal(bridge.residual, 0, `$${bridge.residual} of charter money unaccounted for`);
});

test('a projection is still repeatable with a contract running', () => {
  const st = baseState({ charters: [contract()] });
  const a = weeklyTick(st);
  const b = weeklyTick(st);
  assert.equal(a.totalCharterProfit, b.totalCharterProfit);
  assert.equal(a.cashDelta, b.cashDelta);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
