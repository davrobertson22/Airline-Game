// Borrowing limits from earnings and equity — new games only (state.creditCeilingsWorld).
//
// Port from Headwinds (packages/engine/src/data/credit.js), with the Headwinds
// loan fix of 2026-11-12 already in it. Before this, a Tailwinds loan was sized
// by revenue (unsecured) or by metal (Aircraft Finance) alone, with no
// reference to whether the airline could pay: a loss-making airline could
// borrow 16 weeks of revenue, and each Aircraft Finance draw bought the planes
// that secured the next one.
//
//   • Coverage. After the new loan, weekly debt service may take at most
//     DEBT_SERVICE_COVERAGE_MAX of operating cash flow (net income before the
//     loan payments actually charged, 4-week average).
//   • Leverage. Total loan debt after the new loan may not exceed
//     MAX_DEBT_TO_EQUITY × book equity (cash + owned fleet − loans).
//   • Lifeline. An unsecured product's base amount ($5M / $10M / $20M) stays
//     available regardless, so a brand-new airline can still start.
//
// Saves without the flag borrow exactly as before, for life.
//
//   node --import ./tools/_register-loader.mjs tools/credit-ceilings-test.mjs

import assert from 'node:assert/strict';
import React from 'react';
import { renderToString } from 'react-dom/server';

const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
  clear: () => store.clear(),
  key: (i) => [...store.keys()][i] ?? null,
  get length() { return store.size; },
};
globalThis.window ??= { localStorage: globalThis.localStorage, matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }) };

const C = await import('../src/data/credit.js');
const {
  LOAN_PRODUCTS, AIRCRAFT_LOAN_ID, AIRCRAFT_LOAN_LTV, LOAN_MIN_PRINCIPAL,
  borrowingCapacity, amortizedWeeklyPayment, loanRate, collateralValue, getLoanProduct,
} = C;
const { gameReducer, freshState, GameProvider } = await import('../src/store/GameContext.jsx');
const Finance = (await import('../src/components/Finance.jsx')).default;

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.log(`  ✗ ${name}\n      ${(e.stack || e.message).split('\n').slice(0, 4).join('\n      ')}`); failed++; }
}

const history = (n, revenue, profit, loanPayments = 0) =>
  Array.from({ length: n }, (_, i) => ({ label: `W${i}`, week: i + 1, year: 1, revenue, profit, loanPayments, passengers: 10_000 }));
const owned = (i, typeId = 'b7878') => ({ id: `own${i}`, typeId, name: `Owned ${i}`, tailNumber: `N${i}`, status: 'idle', ageWeeks: 104, ownershipType: 'owned', config: null });
const BIG = Array.from({ length: 10 }, (_, i) => owned(i));
const airline = (over = {}) => ({
  ...freshState(),
  phase: 'playing', week: 40, year: 2, hub: 'JFK', airlineName: 'T',
  cash: 50_000_000, fleet: [], routes: [], cargoRoutes: [], loans: [],
  financialHistory: history(12, 20_000_000, 2_000_000),
  ...over,
});
const on = (over = {}) => airline({ creditCeilingsWorld: true, ...over });
const ltvCap = (s) => Math.floor(collateralValue(s) * AIRCRAFT_LOAN_LTV / 1000) * 1000;
const drawAll = (s, id) => {
  const p = getLoanProduct(id);
  const cap = borrowingCapacity(s, id);
  const next = gameReducer(s, { type: 'TAKE_LOAN', productId: id, principal: cap });
  return { cap, next, payment: amortizedWeeklyPayment(cap, loanRate(s, id), p.termWeeks) };
};

console.log('\n── Old saves are unchanged ──────────────────────────────');

test('a save without the flag borrows exactly as before, even losing money', () => {
  const s = airline({ fleet: BIG, financialHistory: history(12, 20_000_000, -500_000) });
  assert.equal(borrowingCapacity(s, AIRCRAFT_LOAN_ID), ltvCap(s), 'Aircraft Finance is still 70% of the metal');
  assert.equal(borrowingCapacity(s, 'long'), 16 * 20_000_000, 'long-term is still 16 weeks of revenue');
});

console.log('\n── New games: earnings and equity set the limit ─────────');

test('a loss-making airline gets no Aircraft Finance, and only the base unsecured amounts', () => {
  const s = on({ fleet: BIG, financialHistory: history(12, 20_000_000, -500_000) });
  assert.equal(borrowingCapacity(s, AIRCRAFT_LOAN_ID), 0);
  assert.equal(borrowingCapacity(s, 'long'), 20_000_000, 'the lifeline survives');
  assert.equal(borrowingCapacity(s, 'short'), 5_000_000);
});

test('coverage: the payment at the limit is within half of operating cash flow', () => {
  const s = on({ fleet: BIG, cash: 500_000_000, financialHistory: history(12, 20_000_000, 1_000_000) });
  const cap = borrowingCapacity(s, AIRCRAFT_LOAN_ID);
  assert.ok(cap > 0 && cap < ltvCap(s), `coverage should bind below the metal: ${cap} vs ${ltvCap(s)}`);
  const pay = amortizedWeeklyPayment(cap, loanRate(s, AIRCRAFT_LOAN_ID), 416);
  assert.ok(pay <= 1_000_000 * 0.5 + 5, `payment ${pay} exceeds half of $1M cash flow`);
});

test('leverage: total loans may not exceed four times book equity', () => {
  const fleet = Array.from({ length: 40 }, (_, i) => owned(i));
  const metal = collateralValue(airline({ fleet }));
  const debt = Math.round(metal * 0.7);
  const p = 0.065, n = 416;
  const loan = { id: 'l0', productId: AIRCRAFT_LOAN_ID, principal: debt, interestRate: p, termWeeks: n,
    weeklyPayment: amortizedWeeklyPayment(debt, p, n), weeksRemaining: n, collateralIds: fleet.slice(0, 30).map((a) => a.id) };
  const s = on({ fleet, cash: 1_000_000, loans: [loan], financialHistory: history(12, 2_000_000_000, 1_000_000_000, loan.weeklyPayment) });
  const equity = 1_000_000 + metal - C.totalDebtOutstanding(s);
  const lev = Math.max(0, Math.floor((4 * equity - C.totalDebtOutstanding(s)) / 1000) * 1000);
  assert.ok(borrowingCapacity(s, 'long') <= Math.max(lev, 20_000_000 - 0), `long-term ${borrowingCapacity(s, 'long')} above the leverage limit ${lev}`);
  assert.ok(borrowingCapacity(s, 'long') < 16 * 2_000_000_000, 'and well below the revenue ceiling');
});

test('the full long-term limit cannot be drawn twice (the Headwinds refresh exploit)', () => {
  const s = on({ cash: 5_000_000_000, financialHistory: history(12, 500_000_000, 20_000_000) });
  const { cap, next } = drawAll(s, 'long');
  assert.ok(cap < 16 * 500_000_000, `earnings should set the limit here, got ${cap}`);
  assert.equal(next.loans.length, 1);
  assert.ok(borrowingCapacity(next, 'long') <= cap * 0.01, `after drawing ${cap} the limit offered ${borrowingCapacity(next, 'long')} more`);
});

test('a brand-new airline with no results can still borrow its base amounts', () => {
  const s = on({ cash: 1_000, financialHistory: [] });
  for (const p of LOAN_PRODUCTS.filter((x) => !x.secured)) assert.equal(borrowingCapacity(s, p.id), p.baseMax, p.id);
});

test('the reducer refuses a loan over the new-game limit', () => {
  const s = on({ fleet: BIG, cash: 500_000_000, financialHistory: history(12, 20_000_000, 1_000_000) });
  const cap = borrowingCapacity(s, AIRCRAFT_LOAN_ID);
  assert.ok(cap >= LOAN_MIN_PRINCIPAL);
  const no = gameReducer(s, { type: 'TAKE_LOAN', productId: AIRCRAFT_LOAN_ID, principal: cap + 1_000_000 });
  assert.equal((no.loans ?? []).length, 0);
  const ok = gameReducer(s, { type: 'TAKE_LOAN', productId: AIRCRAFT_LOAN_ID, principal: cap });
  assert.equal(ok.loans.length, 1);
});

console.log('\n── The flag, and the screen ─────────────────────────────');

test('a new game carries the flag', () => {
  const g = gameReducer(freshState(), { type: 'START_GAME', airlineName: 'Credit Air', hub: 'JFK', enableObjectives: false });
  assert.equal(g.creditCeilingsWorld, true);
});

const render = (state) => {
  store.set('bbae_save_v2', JSON.stringify(state));
  return renderToString(React.createElement(GameProvider, null, React.createElement(Finance, { initialView: 'loans' })))
    .replace(/&amp;/g, '&').replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/<!-- -->/g, '');
};

test('the loan desk says when earnings set the limit, after a save and reload', () => {
  const s = on({ fleet: BIG, cash: 500_000_000, financialHistory: history(12, 20_000_000, 1_000_000) });
  const html = render(s);
  assert.ok(html.includes('limited by earnings'), 'the reason is shown (and the flag survived the reload)');
  const cap = borrowingCapacity(s, AIRCRAFT_LOAN_ID);
  assert.ok(html.includes(`$${(cap / 1e6).toFixed(2)}M`) || html.includes(String(Math.round(cap / 1e6))), 'with the engine\'s figure');
});

test('an old save\'s loan desk shows no new reasons', () => {
  const html = render(airline({ fleet: BIG, financialHistory: history(12, 20_000_000, 1_000_000) }));
  assert.ok(!html.includes('limited by'), 'old saves are untouched');
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
