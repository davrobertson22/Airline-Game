// Sandbox mode (Tailwinds only; Discord, Xen, 2026-11-12: "a great way to try
// out everything: aeroplanes, marketing, loyalty and so on, or to give
// yourself a set amount of money to start with"). models/sandbox.js has the
// rules. Chosen at new game only: the player's starting money (presets or a
// typed amount, era-scaled like the normal $10M) and, optionally, instant
// deliveries — orders arrive at signing and hired crew start work at once.
//
//   node --import ./tools/_register-loader.mjs tools/sandbox-test.mjs

import assert from 'node:assert/strict';
import React from 'react';
import { renderToString } from 'react-dom/server';

const store = new Map();
globalThis.window = globalThis.window ?? {};
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
  clear: () => store.clear(),
};

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.log(`  ✗ ${name}\n      ${(e.stack || e.message).split('\n').slice(0, 4).join('\n      ')}`); failed++; }
}
const section = (t) => console.log(`\n── ${t} ${'─'.repeat(Math.max(0, 66 - t.length))}`);
const spin = () => { const t = Date.now(); while (Date.now() === t) { /* unique ids */ } };

const { gameReducer, freshState } = await import('../src/store/GameContext.jsx');
const { eraSeedCapital } = await import('../src/data/era.js');
const { getAircraftType } = await import('../src/data/aircraft.js');
const { crewShortfall, LABOR_GROUPS } = await import('../src/data/labor.js');
const SB = await import('../src/models/sandbox.js').catch(() => ({}));
const need = () => assert.ok(SB.sandboxStartCash, 'models/sandbox.js is missing');

const start = (extra = {}) => gameReducer(freshState(), { type: 'START_GAME', airlineName: 'Mine', hub: 'ORD', ...extra });
const order = (s, typeId, quantity = 1, extra = {}) => {
  spin();
  return gameReducer(s, { type: 'ORDER_AIRCRAFT', typeId, quantity, ownershipType: 'owned', ...extra });
};
const typeOf = (a) => getAircraftType(a.typeId);

console.log('\nSandbox mode\n');

section('starting money');

await test('a sandbox game opens with the money the player chose', () => {
  const s = start({ sandbox: true, startCash: 250_000_000 });
  assert.equal(s.sandbox, true);
  assert.equal(s.cash, 250_000_000);
  assert.equal(s.paidInCapital, 250_000_000);
  assert.equal(s.marketCap, 250_000_000 * 1.5);
  assert.equal(s.sandboxInstantDelivery, undefined, 'instant deliveries only when ticked');
});

await test('an era sandbox scales the chosen money like the usual $10M', () => {
  const s = start({ sandbox: true, startCash: 1_000_000_000, startYear: 1965 });
  assert.equal(s.cash, eraSeedCapital(1_000_000_000, 1965));
  assert.ok(s.cash < 1_000_000_000);
});

await test('outside a sandbox the chosen money is ignored, and nothing is marked', () => {
  const s = start({ startCash: 900_000_000, sandboxInstantDelivery: true });
  assert.equal(s.cash, 10_000_000);
  assert.equal(s.sandbox, undefined);
  assert.equal(s.sandboxInstantDelivery, undefined);
});

await test('money is clamped to $1M–$10B and a bad amount means the usual $10M', () => {
  need();
  assert.equal(start({ sandbox: true, startCash: 1e15 }).cash, SB.SANDBOX_CASH_MAX);
  assert.equal(start({ sandbox: true, startCash: -5 }).cash, SB.SANDBOX_CASH_MIN);
  assert.equal(start({ sandbox: true, startCash: 'lots' }).cash, 10_000_000);
  assert.equal(start({ sandbox: true }).cash, 10_000_000);
});

await test('typed amounts: 250m, $1.5B, 40,000,000, 750k', () => {
  need();
  assert.equal(SB.parseSandboxCash('250m'), 250_000_000);
  assert.equal(SB.parseSandboxCash('$1.5B'), 1_500_000_000);
  assert.equal(SB.parseSandboxCash('40,000,000'), 40_000_000);
  assert.equal(SB.parseSandboxCash('750k'), 750_000);
  assert.equal(SB.parseSandboxCash('a lot'), null);
  assert.equal(SB.parseSandboxCash(''), null);
});

section('instant deliveries');

const instant = () => start({ sandbox: true, startCash: 1_000_000_000, sandboxInstantDelivery: true });

await test('an owned order is in the fleet at signing, paid in full, off the factory line', () => {
  const s0 = instant();
  assert.equal(s0.sandboxInstantDelivery, true);
  assert.equal(s0.productionLinesWorld, true, 'the world still runs production lines for the rivals');
  const s = order(s0, 'a320ceo', 3);
  assert.equal(s.pendingOrders.length, 0, 'nothing waits on the book');
  const added = s.fleet.filter(a => a.typeId === 'a320ceo');
  assert.equal(added.length, 3);
  assert.ok(added.every(a => a.ownershipType === 'owned' && a.status === 'idle' && a.tailNumber));
  const paid = s0.cash - s.cash;
  assert.ok(paid >= 3 * 0.8 * getAircraftType('a320ceo').purchasePrice * 0.5, `paid ${paid}`);
  assert.ok(!added.some(a => a.payments || a.lineId), 'no staged contract or line slot carried');
  assert.ok((s.pendingToasts ?? []).some(t => /deliver/i.test(t.title)), 'a delivery toast');
});

await test('a leased order arrives at signing with its rate, term and deposit', () => {
  const s0 = instant();
  const s = order(s0, 'b737800', 2, { ownershipType: 'lease' });
  const added = s.fleet.filter(a => a.typeId === 'b737800');
  assert.equal(added.length, 2);
  assert.equal(s.pendingOrders.length, 0);
  for (const a of added) {
    assert.equal(a.ownershipType, 'lease');
    assert.ok(a.weeklyLease > 0 && a.leaseTermWeeks > 0 && a.leaseRemainingWeeks === a.leaseTermWeeks);
    assert.ok(a.leaseDeposit > 0);
  }
  assert.ok(s.cash < s0.cash, 'the deposit was paid');
});

await test('a sandbox without instant deliveries waits on the book as usual', () => {
  const s = order(start({ sandbox: true, startCash: 1_000_000_000 }), 'a320ceo', 2);
  assert.equal(s.pendingOrders.length, 2);
  assert.equal(s.fleet.filter(a => a.typeId === 'a320ceo').length, 0);
});

await test('a normal game is untouched even if a save carries the instant flag without sandbox', () => {
  const s = order({ ...start({ startCash: 0 }), cash: 1e9, sandboxInstantDelivery: true }, 'a320ceo', 1);
  assert.equal(s.pendingOrders.length, 1);
});

await test('instant crew: hires start work at once, no training pipeline or queue', () => {
  const s0 = order(instant(), 'a320ceo', 6);
  const s = gameReducer(s0, { type: 'HIRE_CREW', group: 'pilots', count: 40 });
  const before = s0.labor.pilots.headcount;
  assert.ok(s.labor.pilots.headcount >= before + 40 - 1e-9, `${before} → ${s.labor.pilots.headcount}`);
  assert.equal((s.labor.pilots.pipeline ?? []).reduce((n, b) => n + b.count, 0),
    (s0.labor.pilots.pipeline ?? []).reduce((n, b) => n + b.count, 0));
  assert.ok(!(s.labor.pilots.recruiting > 0));
});

await test('"Keep me fully staffed" crews instant aircraft the moment they arrive', () => {
  const s = order(instant(), 'a320ceo', 12);
  assert.equal(s.crewAutoStaff, true);
  assert.equal(s.fleet.length, 12);
  const short = crewShortfall(s.labor, s.fleet, typeOf);
  for (const g of LABOR_GROUPS) assert.equal(short.byGroup[g.id], 0, `${g.id} short ${short.byGroup[g.id]}`);
});

await test('an instant order that replaces a tail swaps in straight away (old tail sold)', () => {
  let s = order(instant(), 'a320ceo', 1);
  const old = s.fleet.find(a => a.typeId === 'a320ceo');
  s = order(s, 'a321ceo', 1, { replaces: [old.id], replaceDisposal: 'dispose' });
  assert.ok(!s.fleet.some(a => a.id === old.id && a.status !== 'retired'), 'the old tail was sold');
  const nu = s.fleet.find(a => a.typeId === 'a321ceo');
  assert.ok(nu && !nu.replacing, 'the new tail carries no pending swap');
});

await test('the next week does not deliver anything twice', () => {
  const s0 = order(instant(), 'a320ceo', 2);
  const s = gameReducer(s0, { type: 'ADVANCE_WEEK' });
  assert.equal(s.fleet.filter(a => a.typeId === 'a320ceo').length, 2);
});

await test('a saved sandbox loads as a sandbox, instant deliveries included', async () => {
  const { reconcileState } = await import('../src/store/GameContext.jsx');
  const saved = JSON.parse(JSON.stringify(instant()));
  const loaded = reconcileState(saved);
  assert.equal(loaded.sandbox, true);
  assert.equal(loaded.sandboxInstantDelivery, true);
  assert.equal(reconcileState(JSON.parse(JSON.stringify(start()))).sandbox, undefined);
});

section('the screens');

const { default: SetupScreen } = await import('../src/components/SetupScreen.jsx');
const { GameProvider } = await import('../src/store/GameContext.jsx');

await test('the setup screen offers Sandbox', () => {
  const html = renderToString(React.createElement(GameProvider, null, React.createElement(SetupScreen)));
  assert.match(html, /Sandbox/);
});

await test('the Sandbox badge, and save cards know a sandbox game', async () => {
  const { default: SandboxBadge } = await import('../src/components/SandboxBadge.jsx');
  assert.match(renderToString(React.createElement(SandboxBadge)), />Sandbox</);
  const { metaFromState } = await import('../src/store/saveStore.js');
  assert.equal(metaFromState(start({ sandbox: true, startCash: 5e7 })).sandbox, true);
  assert.ok(!('sandbox' in metaFromState(start())), 'a normal save\u2019s meta is unchanged');
});

console.log(`\n${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
