// Cabin refits do what the modal says, and the check panel says when work is due.
//
// Both halves come from one Discord report (Knightmare, 2026-08-27) against the
// multiplayer build, and both faults were present here too:
//
//   1. "Aircraft is taken out of service for refitting" was aspirational copy.
//      No reducer, in either repo, had ever grounded anything for a cabin job —
//      the seats simply changed, mid-flight, for free downtime. Refits now cost
//      shop time (refitWeeks), and the modal quotes the same function the
//      reducer grounds the tail with.
//
//   2. The maintenance panel printed hours ACCRUED — the same number under both
//      C and D on a young airframe — where the player needed time REMAINING.
//
// (The multiplayer-only half of that report, an allow-list miss that stopped
// batched refits from ever reaching the server, has no analogue here: the solo
// game dispatches straight into the reducer.)
//
// Tailwinds prices refits on its own terms (a flat fee per quality tier, seat
// AND service). Headwinds dropped service quality and charges per premium seat
// installed. The suite below pins THIS game's prices — the divergence is
// deliberate, and neither should be synced onto the other by accident.
//
//   node --import ./tools/_register-loader.mjs tools/cabin-refit-test.mjs

import assert from 'node:assert/strict';
import React from 'react';
import { renderToString } from 'react-dom/server';
import { AIRCRAFT_TYPES, getAircraftType } from '../src/data/aircraft.js';
import {
  calcReconfCost, refitWeeks, defaultConfig, advanceDowntimeOneWeek,
  REFIT_SEAT_COST, REFIT_QUALITY_STEP, REFIT_MIN_COST,
} from '../src/utils/simulation.js';
import { dueInfo, isOutOfService, C_HOURS_DUE, C_WEEKS_DUE } from '../src/data/maintenance.js';

const store = new Map();
globalThis.window = globalThis.window ?? {};
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
  clear: () => store.clear(),
};

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.log(`  ✗ ${name}\n      ${(e.stack || e.message).split('\n').slice(0, 4).join('\n      ')}`); failed++; }
}

const { GameProvider, gameReducer, freshState } = await import('../src/store/GameContext.jsx');

const NB = AIRCRAFT_TYPES.filter(t => !t.freighter && t.category === 'Narrow Body')
  .sort((a, b) => (b.seats ?? 0) - (a.seats ?? 0))[0];
const WB = AIRCRAFT_TYPES.find(t => t.category === 'Wide Body' && !t.freighter);
assert.ok(NB && WB, 'need a narrow-body and a wide-body in the type table');

const STD = { seatQuality: 'standard', serviceQuality: 'standard' };
const baseCabin = (type) => ({ firstClass: 0, businessClass: 0, premiumEconomy: 0, economy: type.seats, ...STD });

function stateWith(fleet, cash = 500_000_000) {
  return {
    ...freshState(),
    phase: 'playing', week: 30, year: 2, hub: 'JFK', cash,
    homeCountry: 'US', gates: { JFK: 20, BOS: 20 }, hubs: { JFK: { tier: 2 } },
    fleet, routes: [], cargoRoutes: [],
  };
}
const tail = (id, type, extra = {}) => ({
  id, typeId: type.id, name: id, tailNumber: id.toUpperCase(),
  status: 'idle', ageWeeks: 52, ownershipType: 'owned', config: baseCabin(type), ...extra,
});

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n── Tailwinds prices its own refits ───────────────────────');

test('per seat moved, plus a flat fee per quality tier on either axis', () => {
  const from = baseCabin(NB);
  assert.equal(calcReconfCost(from, { ...from, businessClass: 20, economy: NB.seats - 30 }),
    Math.max(REFIT_MIN_COST, 20 * REFIT_SEAT_COST));
  assert.equal(calcReconfCost(from, { ...from, seatQuality: 'premium' }), REFIT_QUALITY_STEP);
  assert.equal(calcReconfCost(from, { ...from, serviceQuality: 'premium' }), REFIT_QUALITY_STEP,
    'service quality is still a priced axis in the solo game');
});

test('an unchanged cabin costs nothing', () => {
  assert.equal(calcReconfCost(baseCabin(NB), baseCabin(NB)), 0);
});

test('a token change still clears the floor price', () => {
  const from = baseCabin(NB);
  assert.equal(calcReconfCost(from, { ...from, businessClass: 1, economy: NB.seats - 2 }), REFIT_MIN_COST);
});

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n── A refit is shop work ──────────────────────────────────');

const s0 = stateWith([tail('n1', NB)]);
const NEW_CABIN = { firstClass: 0, businessClass: 20, premiumEconomy: 0, economy: NB.seats - 30, ...STD };
const refit = (state, id = 'n1', config = NEW_CABIN) =>
  gameReducer(state, { type: 'CONFIGURE_AIRCRAFT', aircraftId: id, config, reconfCost: 0 });

test('the tail comes out of service, with the reason recorded', () => {
  const a = refit(s0).fleet[0];
  assert.equal(a.status, 'grounded');
  assert.ok(a.groundedWeeksLeft >= 1);
  assert.equal(a.groundedReason, 'refit', 'a refit must not be indistinguishable from a breakdown');
});

test('the cabin actually changes, and the charge is re-derived', () => {
  const after = gameReducer(s0, {
    type: 'CONFIGURE_AIRCRAFT', aircraftId: 'n1', config: NEW_CABIN, reconfCost: 99_000_000,
  });
  assert.equal(after.fleet[0].config.businessClass, 20);
  assert.equal(s0.cash - after.cash, calcReconfCost(baseCabin(NB), NEW_CABIN),
    'a forged reconfCost was charged instead of the engine price');
});

test('a no-op refit grounds nothing and charges nothing', () => {
  const same = refit(s0, 'n1', baseCabin(NB));
  assert.equal(same.fleet[0].status, 'idle',
    'reopening the modal and pressing Confirm on an unchanged cabin parked the aircraft');
  assert.equal(same.cash, s0.cash);
});

test('a bigger change on a bigger airframe books more shop time', () => {
  const small = refitWeeks(NB, baseCabin(NB), { ...baseCabin(NB), businessClass: 4, economy: NB.seats - 6 });
  const big   = refitWeeks(WB, baseCabin(WB),
    { firstClass: 8, businessClass: Math.round(WB.seats * 0.3), premiumEconomy: 0, economy: 40, ...STD });
  assert.ok(big > small, `wide-body major refit (${big}w) should outlast a narrow-body tweak (${small}w)`);
  assert.ok(big <= 4, 'refit downtime must stay capped');
});

test('a tail in a heavy check refuses the job instead of losing its slot', () => {
  const inShop = stateWith([tail('n1', NB, { status: 'maintenance', checkType: 'C', checkWeeksLeft: 2 })]);
  const after  = refit(inShop);
  assert.equal(after.fleet[0].status, 'maintenance', 'the C check was cancelled by a cabin job');
  assert.equal(after.fleet[0].checkWeeksLeft, 2, 'the check countdown was disturbed');
  assert.equal(after.cash, inShop.cash, 'the player was charged for a refit that did not happen');
  assert.ok(after.error, 'a silent no-op is exactly the bug being fixed');
});

test('a refit the player cannot afford is refused, not overdrawn', () => {
  const broke = stateWith([tail('n1', NB)], 1_000);
  const after = refit(broke);
  assert.equal(after.fleet[0].status, 'idle');
  assert.equal(after.cash, broke.cash);
  assert.ok(after.error);
});

test('downtime ends and the aircraft returns clean', () => {
  let a = refit(s0).fleet[0];
  const weeks = a.groundedWeeksLeft;
  for (let i = 0; i < weeks; i++) a = advanceDowntimeOneWeek(a, false);
  assert.ok(!isOutOfService(a), `still out of service after ${weeks} week(s)`);
  assert.equal(a.groundedWeeksLeft, 0);
  assert.ok(!a.groundedReason, 'a stale refit reason would mislabel the next breakdown');
});

test('a grounded tail earns nothing that week', () => {
  const flying  = stateWith([tail('n1', NB, { status: 'assigned' })]);
  const grounded = refit(flying).fleet[0];
  assert.ok(isOutOfService(grounded), 'the sim would still fly a refitting aircraft');
});

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n── The modal promises what the reducer delivers ──────────');

const FleetConfigMod = await import('../src/components/FleetConfig.jsx');
const FleetConfig = FleetConfigMod.default;
const { refitDowntimeNote } = FleetConfigMod;

test('the sentence quotes the same downtime the reducer applies', () => {
  const bigChange = { firstClass: 8, businessClass: Math.round(WB.seats * 0.3), premiumEconomy: 0, economy: 40, ...STD };
  const weeks = refitWeeks(WB, baseCabin(WB), bigChange);
  assert.match(refitDowntimeNote(weeks, false),
    new RegExp(`out of service for ${weeks} weeks? while the cabin is refitted`));

  const after = gameReducer(stateWith([tail('w1', WB)]), {
    type: 'CONFIGURE_AIRCRAFT', aircraftId: 'w1', config: bigChange, reconfCost: 0,
  }).fleet[0];
  assert.equal(after.groundedWeeksLeft, weeks,
    `the modal promised ${weeks}w and the reducer grounded for ${after.groundedWeeksLeft}w`);
});

test('a refit with no shop time says so rather than promising downtime', () => {
  assert.ok(!refitDowntimeNote(0, false).includes('out of service'));
});

test('a tail already in the shop is excluded, not silently dropped', () => {
  store.set('bbae_save_v2', JSON.stringify(
    stateWith([tail('w1', WB, { status: 'maintenance', checkType: 'C', checkWeeksLeft: 2 })])));
  const html = renderToString(React.createElement(GameProvider, null,
    React.createElement(FleetConfig, { aircraftId: 'w1', onClose() {} }))).replace(/<!-- -->/g, '');
  assert.ok(html.includes('already out of service'),
    'the modal offered a refit on a tail the reducer will refuse');
});

// ─────────────────────────────────────────────────────────────────────────────
console.log('\n── Maintenance reads as time till due ────────────────────');

// Knightmare's screenshot: C 83% (3734h · 29w), D 16% (3734h · 29w). The same
// hour count under both checks, and neither of them the number he wanted.
const SHOT = { hoursSinceC: 3734, hoursSinceD: 3734, weeksSinceC: 29, weeksSinceD: 29 };

test('remaining hours are the shortfall to the threshold', () => {
  const d = dueInfo(SHOT, NB, 30);
  assert.equal(d.cHoursLeft, C_HOURS_DUE - 3734);
  assert.equal(d.cWeeksLeft, C_WEEKS_DUE - 29);
});

test('the estimate uses the tail\'s own utilization, not the calendar alone', () => {
  const d = dueInfo(SHOT, NB, 30);
  assert.equal(d.cDueInWeeks, 6);
  assert.ok(d.cDueInWeeks < d.cWeeksLeft, 'the calendar clock was reported as if it were the binding one');
});

test('a parked tail falls back to the calendar clock', () => {
  const d = dueInfo({ hoursSinceC: 0, hoursSinceD: 0, weeksSinceC: 10, weeksSinceD: 10 }, NB, 10);
  assert.equal(d.cDueInWeeks, C_WEEKS_DUE - 10);
  assert.ok(Number.isFinite(d.cDueInWeeks));
});

test('an already-due check reports zero, not a negative countdown', () => {
  const d = dueInfo({ hoursSinceC: C_HOURS_DUE + 500, hoursSinceD: 0, weeksSinceC: 90, weeksSinceD: 90 }, NB, 100);
  assert.equal(d.cDueInWeeks, 0);
  assert.equal(d.cHoursLeft, 0);
});

const { AircraftDetail } = await import('../src/components/Fleet.jsx');
const shotTail = tail('n1', NB, SHOT);
store.set('bbae_save_v2', JSON.stringify(stateWith([shotTail])));
const cardHtml = renderToString(React.createElement(GameProvider, null,
  React.createElement(AircraftDetail, {
    aircraft: shotTail, onClose() {}, onConfigure() {}, onRetire() {}, onSell() {},
  }))).replace(/<!-- -->/g, '');

test('the card prints the time till due', () => {
  assert.match(cardHtml, /due in ~6w/, 'the maintenance panel does not say when the check is due');
  assert.ok(cardHtml.includes('766h left'), 'the remaining hours are missing');
});

test('the card no longer prints hours accrued as if it were the answer', () => {
  assert.ok(!cardHtml.includes('3,734h') && !cardHtml.includes('3734h'),
    'total time flown is still being shown in the check panel');
});

console.log(`\n  ${passed} passed, ${failed} failed\n`);
if (failed > 0) process.exit(1);
