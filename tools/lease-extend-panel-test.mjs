// Keeping a leased aircraft must be an action on the aircraft card.
//
// Reported on Discord (ASAS, 2026-09-09): "i cant renew lease" — with a
// screenshot of the aircraft card for a 7-year-old leased jet — followed, once
// he was shown where it lived, by "omg you have to click the small button".
//
// The card he was looking at offered Configure Cabin, Transfer Routes, Buy Out
// Lease and Return Aircraft: two ways to END the lease, none to keep it, and no
// mention anywhere on it of when the lease ran out. The only renew affordance
// in the game was a 10px ghost button on the fleet ROW, and only inside the
// last eight weeks.
//
// That button also dispatched RENEW_LEASE, which RESET the countdown to the
// nominal term — so pressing it on a lease with more than a term left silently
// took time off. EXTEND_LEASE, which the bulk bar already used, adds weeks and
// never loses any.
//
// The panel half SSR-renders the real AircraftDetail card, because the card is
// where the player looked and did not find it.
//
//   node --import ./tools/_register-loader.mjs tools/lease-extend-panel-test.mjs

import assert from 'node:assert/strict';
import React from 'react';
import { renderToString } from 'react-dom/server';
import { AIRCRAFT_TYPES } from '../src/data/aircraft.js';
import { formatMoney, weekToGameDate } from '../src/utils/simulation.js';

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

const { GameProvider, freshState, gameReducer } = await import('../src/store/GameContext.jsx');
const { AircraftDetail } = await import('../src/components/Fleet.jsx');

const JET = AIRCRAFT_TYPES.filter(t => !t.freighter && (t.range ?? 0) > 4000 && (t.weeklyLease ?? 0) > 0)
  .sort((a, b) => (b.range ?? 0) - (a.range ?? 0))[0];
assert.ok(JET, 'need a passenger jet with a list lease rate in the type table');

// A rate that is unmistakably NOT the table rate — the 1.15x short-term
// multiplier a real signing stamps onto the tail.
const SIGNED_RATE = Math.round(JET.weeklyLease * 1.15) + 1234;

const leased = {
  id: 'lsd', typeId: JET.id, name: 'Leased One', tailNumber: 'NLSD01',
  status: 'assigned', ageWeeks: 372, config: { economy: JET.seats ?? 180 },
  ownershipType: 'lease', weeklyLease: SIGNED_RATE,
  leaseTermWeeks: 104, leaseRemainingWeeks: 6, leaseDeposit: 0,
};
const owned = {
  ...leased, id: 'own', name: 'Owned One', tailNumber: 'NOWN01',
  ownershipType: 'owned', weeklyLease: undefined,
  leaseTermWeeks: undefined, leaseRemainingWeeks: undefined,
};

const WEEK = 20;
const save = {
  ...freshState(),
  phase: 'playing', week: WEEK, year: 3, hub: 'MIA', cash: 200_000_000,
  homeCountry: 'US',
  gates: Object.fromEntries(['MIA', 'JFK', 'ORD'].map(c => [c, 20])),
  hubs: { MIA: { tier: 1 } },
  fleet: [leased, owned],
  routes: [
    { id: 'r-1', origin: 'MIA', destination: 'JFK', stops: ['MIA', 'JFK'], aircraftId: 'lsd',
      weeklyFrequency: 6, weeksOpen: 40, hub: 'MIA', ticketPrice: 220 },
  ],
  cargoRoutes: [],
};

const render = (aircraft) => {
  store.set('bbae_save_v2', JSON.stringify(save));
  return renderToString(React.createElement(GameProvider, null,
    React.createElement(AircraftDetail, { aircraft, onClose(){}, onConfigure(){}, onRetire(){}, onSell(){} })))
    .replace(/<!-- -->/g, '');
};

console.log('\n── The card can keep the aircraft, not only end it ───────');

const leasedHtml = render(leased);

test('the card offers a way to extend the lease', () => {
  assert.ok(/Extend Lease/i.test(leasedHtml),
    'the aircraft card offers Buy Out Lease and Return Aircraft but no way to keep the aircraft on lease');
});

test('the card says when the lease runs out', () => {
  assert.ok(/6w left on lease/.test(leasedHtml),
    'the Lease / wk tile never says how much of the lease is left');
});

test('the card quotes the rate this tail signed at, not the table rate', () => {
  assert.ok(leasedHtml.includes(formatMoney(SIGNED_RATE)),
    `the card should show the stamped rate ${formatMoney(SIGNED_RATE)} — the tick charges that`);
  assert.ok(!leasedHtml.includes(formatMoney(JET.weeklyLease)),
    `the card showed the list rate ${formatMoney(JET.weeklyLease)}; the tick charges ${formatMoney(SIGNED_RATE)}`);
});

test('an owned tail gets neither an extend button nor a countdown', () => {
  const html = render(owned);
  assert.ok(!/Extend Lease/i.test(html), 'an owned aircraft has no lease to extend');
  assert.ok(!/left on lease/.test(html), 'an owned aircraft has no lease countdown');
});

console.log('\n── Extending never costs the player time ─────────────────');

const stateWith = (a) => ({ ...save, fleet: [a] });
const weeksAfter = (action, a) => gameReducer(stateWith(a), action).fleet[0].leaseRemainingWeeks;

test('EXTEND_LEASE adds a year onto whatever is left', () => {
  const a = { ...leased, leaseRemainingWeeks: 40 };
  assert.equal(weeksAfter({ type: 'EXTEND_LEASE', aircraftId: 'lsd', addWeeks: 52 }, a), 92);
});

test('extending past the nominal term grows the term with it', () => {
  const a = { ...leased, leaseRemainingWeeks: 90, leaseTermWeeks: 104 };
  const out = gameReducer(stateWith(a), { type: 'EXTEND_LEASE', aircraftId: 'lsd', addWeeks: 52 }).fleet[0];
  assert.equal(out.leaseRemainingWeeks, 142);
  assert.ok(out.leaseTermWeeks >= out.leaseRemainingWeeks,
    'the remaining bar must not be able to exceed the term it is drawn against');
});

test('RENEW_LEASE can never take time OFF a lease', () => {
  const a = { ...leased, leaseRemainingWeeks: 120, leaseTermWeeks: 104 };
  assert.equal(weeksAfter({ type: 'RENEW_LEASE', aircraftId: 'lsd' }, a), 120,
    'renewing threw away the 16 weeks the lease had above its nominal term');
});

test('RENEW_LEASE still tops a short lease back up to a full term', () => {
  const a = { ...leased, leaseRemainingWeeks: 6, leaseTermWeeks: 104 };
  assert.equal(weeksAfter({ type: 'RENEW_LEASE', aircraftId: 'lsd' }, a), 104);
});

console.log(`\n  ${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
