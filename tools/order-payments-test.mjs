// Pre-delivery payments — order book package 1 (docs/order-book-design.md §2).
//
// Today an owned order is paid in full the moment it is signed. Under the
// `orderBook` world flag the price is staged instead: a 2% deposit at signing,
// three pre-delivery instalments (8% / 8% / 7%) at T-18, T-12 and T-6 weeks,
// and the 75% balance on the week the aircraft arrives. An instalment whose
// week falls before signing is simply paid at signing — so on today's short
// lead times most of the pre-delivery money is still up front, and the
// schedule only spreads out once lead times grow (package 2).
//
// Decisions this suite pins (Dave, 2026-09-21):
//   * The balance is ALWAYS cash. It is charged on delivery whether or not the
//     airline can afford it; a shortfall takes cash negative and the existing
//     negative-cash rules apply. Nothing is forfeited, nothing is auto-financed.
//   * To SIGN, cash must cover the deposit plus every pre-delivery instalment —
//     this order's AND the unpaid instalments already committed on the book.
//     Otherwise one pile of cash could back two orders' instalments.
//   * Flag absent = today's behaviour, byte for byte. Every existing save and
//     every game started before package 2 lands takes the classic path.
//
// Payments are capital, not cost: they leave the bank, they are not tax
// deductible (depreciation carries the cost), and the weekly P&L card must
// name them or its rows stop adding up to its own total.
//
//   node --import ./tools/_register-loader.mjs tools/order-payments-test.mjs

import assert from 'node:assert/strict';

const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
  clear: () => store.clear(),
};
globalThis.window ??= {
  localStorage: globalThis.localStorage,
  matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
};

const { gameReducer, freshState, GameProvider } = await import('../src/store/GameContext.jsx');
const { getAircraftType, effectivePurchasePrice } = await import('../src/data/aircraft.js');
const { absoluteWeek } = await import('../src/utils/fuel.js');
const { projectWeek } = await import('../src/utils/financeProjection.js');
const { costBridge, bridgeInputsFromReport } = await import('../src/utils/pnlBridge.js');
// The model does not exist before this package. Loading it softly lets every
// REDUCER assertion below run — and fail on its own terms — against HEAD.
const pay = await import('../src/models/orderPayments.js').catch(() => null);

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.log(`  ✗ ${name}\n      ${(e.stack || e.message).split('\n').slice(0, 6).join('\n      ')}`); failed++; }
}
function section(t) { console.log(`\n── ${t} ${'─'.repeat(Math.max(0, 66 - t.length))}`); }
const needModel = () => assert.ok(pay, 'src/models/orderPayments.js does not exist');

function seedRandom(seed) {
  let x = seed >>> 0;
  Math.random = () => { x = (Math.imul(x, 1664525) + 1013904223) >>> 0; return x / 4294967296; };
}
// uid() is time-seeded; two id-minting calls in one millisecond collide.
function spin() { const t = Date.now(); while (Date.now() === t) { /* spin */ } }

const WIDE  = 'a330neo';   // Wide Body: first delivery at +8w, so T-6 lands AFTER signing
const PROP  = 'atr72';     // Turboprop: first delivery at +2w, every instalment clamps to signing
const priceOf = (id, q = 1) => effectivePurchasePrice(getAircraftType(id), q);

const reducerOnly = (extra = {}) => ({ ...freshState(), hub: 'JFK', cash: 2_000_000_000, ...extra });
const order = (st, typeId, quantity = 1, ownershipType = 'owned') => {
  spin();
  return gameReducer(st, { type: 'ORDER_AIRCRAFT', typeId, quantity, ownershipType });
};
const nowAbs = (s) => absoluteWeek(s.year, s.week);

function world({ cash = 2_000_000_000, orderBook = true, seed = 7 } = {}) {
  seedRandom(seed);
  const s = gameReducer(freshState(),
    { type: 'START_GAME', airlineName: 'Book Air', hub: 'JFK', enableObjectives: false });
  return { ...s, cash, crewPipeline: false, ...(orderBook ? { orderBook: true } : {}) };
}
const advance = (s) => { spin(); return gameReducer(s, { type: 'ADVANCE_WEEK' }); };

console.log('\nPre-delivery payments (order book package 1)\n');

// ── 1. The schedule ─────────────────────────────────────────────────────────
section('1. The payment schedule');

test('a long window spreads the price: deposit, T-18, T-12, T-6, balance', () => {
  needModel();
  const p = pay.buildPaymentSchedule(100_000_000, 100, 140);
  assert.deepEqual(p.map(x => [x.kind, x.absWeek, x.amount]), [
    ['deposit', 100,  2_000_000],
    ['pdp',     122,  8_000_000],
    ['pdp',     128,  8_000_000],
    ['pdp',     134,  7_000_000],
    ['balance', 140, 75_000_000],
  ]);
  assert.ok(p.every(x => x.paid === false), 'nothing is paid by building a schedule');
});

test('a short window clamps every instalment to the signing week', () => {
  needModel();
  const p = pay.buildPaymentSchedule(22_000_000, 50, 52);
  assert.deepEqual(p.filter(x => x.kind !== 'balance').map(x => x.absWeek), [50, 50, 50, 50]);
  assert.equal(p.at(-1).absWeek, 52, 'the balance still falls on delivery');
  assert.equal(pay.signingAmount(p, 50), pay.preDeliveryTotal(22_000_000),
    'so everything but the balance is due at signing');
});

test('the parts always sum to the contract price exactly, whatever the rounding', () => {
  needModel();
  for (const price of [1, 99, 12_345_679, 109_999_999, 305_000_001]) {
    for (const [o, d] of [[1, 2], [10, 16], [10, 40], [300, 360]]) {
      const p = pay.buildPaymentSchedule(price, o, d);
      assert.equal(p.reduce((s, x) => s + x.amount, 0), price, `price ${price}, window ${o}->${d}`);
    }
  }
});

test('pre-delivery money is a quarter of the price; the balance three quarters', () => {
  needModel();
  assert.equal(pay.preDeliveryTotal(100_000_000), 25_000_000);
});

// ── 2. Flag absent: nothing changes ─────────────────────────────────────────
section('2. Without the flag, ordering is exactly what it was');

test('an owned order is still paid in full at signing, with no schedule', () => {
  const s0 = reducerOnly();
  const s1 = order(s0, WIDE);
  const o  = s1.pendingOrders.at(-1);
  assert.ok(o, 'no order was placed');
  assert.equal(s0.cash - s1.cash, priceOf(WIDE));
  assert.equal(o.payments, undefined, 'a classic order must not carry a payment schedule');
});

test('cancelling a classic order still refunds 95%', () => {
  const s1 = order(reducerOnly(), WIDE);
  const o  = s1.pendingOrders.at(-1);
  const s2 = gameReducer(s1, { type: 'CANCEL_ORDER', orderId: o.id });
  assert.equal(s2.cash - s1.cash, Math.round(o.totalPrice * 0.95));
});

test('a classic week books no aircraft-payment line at all (not even a zero)', () => {
  let s = world({ orderBook: false });
  s = order(s, WIDE);
  for (let i = 0; i < 3; i++) s = advance(s);
  assert.ok(!('aircraftPayments' in s.lastReport),
    'the key must stay out of classic reports so an old save is byte-identical');
});

// ── 3. Signing under the flag ───────────────────────────────────────────────
section('3. Signing an order under the flag');

test('the order carries a schedule that sums to the contract price', () => {
  const s1 = order(reducerOnly({ orderBook: true }), WIDE);
  const o  = s1.pendingOrders.at(-1);
  assert.ok(Array.isArray(o?.payments), 'no payment schedule on the order');
  assert.equal(o.payments.reduce((s, x) => s + x.amount, 0), priceOf(WIDE));
  assert.equal(o.payments.at(-1).absWeek, o.deliverAbsWeek, 'the balance must fall on the delivery week');
});

test('signing takes only what is due now, not the whole price', () => {
  const s0 = reducerOnly({ orderBook: true });
  const s1 = order(s0, WIDE);
  const o  = s1.pendingOrders.at(-1);
  const dueNow = o.payments.filter(x => x.absWeek <= nowAbs(s0)).reduce((s, x) => s + x.amount, 0);
  assert.equal(s0.cash - s1.cash, dueNow, 'cash did not fall by exactly the signing-week payments');
  assert.ok(dueNow < priceOf(WIDE) * 0.3, `signing took ${dueNow} of ${priceOf(WIDE)}`);
  assert.ok(o.payments.filter(x => x.absWeek <= nowAbs(s0)).every(x => x.paid), 'paid instalments must be marked paid');
  assert.ok(o.payments.filter(x => x.absWeek >  nowAbs(s0)).every(x => !x.paid), 'future ones must not be');
});

test('cash covering deposit + instalments is enough to sign', () => {
  const need = Math.round(priceOf(WIDE) * 0.25);
  const s1 = order(reducerOnly({ orderBook: true, cash: need }), WIDE);
  assert.equal(s1.pendingOrders.length, 1, `refused an order with ${need} in the bank`);
});

test('one dollar less and the order is refused', () => {
  const need = Math.round(priceOf(WIDE) * 0.25);
  const s0 = reducerOnly({ orderBook: true, cash: need - 1 });
  const s1 = order(s0, WIDE);
  assert.equal(s1.pendingOrders.length, 0);
  assert.equal(s1.cash, s0.cash);
});

test('cash already committed to unpaid instalments cannot back a second order', () => {
  const need = Math.round(priceOf(WIDE) * 0.25);
  const s1 = order(reducerOnly({ orderBook: true, cash: need }), WIDE);
  assert.equal(s1.pendingOrders.length, 1, 'the first order must be accepted for this test to mean anything');
  assert.ok(s1.cash > 0, 'an instalment should still be outstanding on a wide body');
  const s2 = order(s1, PROP);
  assert.equal(s2.pendingOrders.length, 1,
    `the ${s1.cash} left in the bank is owed to the first order's T-6 instalment`);
});

test('a multi-frame order stops at what the book can afford', () => {
  const need = Math.round(priceOf(PROP, 3) * 0.25) * 3;
  const s1 = order(reducerOnly({ orderBook: true, cash: need + 10 }), PROP, 10);
  assert.ok(s1.pendingOrders.length >= 3 && s1.pendingOrders.length < 10,
    `ordered ${s1.pendingOrders.length} frames on cash for about 3`);
  assert.ok(s1.cash >= 0, 'signing must never take the bank negative');
});

test('leases are untouched by the flag: deposit only, no schedule', () => {
  const s0 = reducerOnly({ orderBook: true });
  const s1 = order(s0, WIDE, 1, 'lease');
  const o  = s1.pendingOrders.at(-1);
  assert.equal(o.payments, undefined);
  assert.equal(s0.cash - s1.cash, o.leaseDeposit);
});

// ── 4. The tick ─────────────────────────────────────────────────────────────
section('4. Instalments and the balance fall due in the tick');

const w0 = world();
const w1 = order(w0, WIDE);
const theOrder = w1.pendingOrders.at(-1);
const future = (theOrder?.payments ?? []).filter(x => !x.paid);

test('the fixture has a T-6 instalment and a balance still to pay', () => {
  assert.ok(theOrder?.payments, 'no schedule — every tick test below would be vacuous');
  assert.deepEqual(future.map(x => x.kind), ['pdp', 'balance']);
});

let s = w1, paidByTick = 0, sawInstalment = null, sawBalance = null;
const history = [];
for (let i = 0; i < 12 && s.pendingOrders.length; i++) {
  const before = s;
  s = advance(s);
  history.push({ before, after: s });
  const p = s.lastReport?.aircraftPayments ?? 0;
  paidByTick += p;
  if (p && !sawInstalment) sawInstalment = { before, after: s, amount: p };
  else if (p) sawBalance = { before, after: s, amount: p };
}

test('the T-6 instalment is charged in the week it falls due, and only then', () => {
  const inst = future.find(x => x.kind === 'pdp');
  assert.ok(sawInstalment, 'no tick ever charged an aircraft payment');
  assert.equal(sawInstalment.amount, inst?.amount);
  assert.equal(nowAbs(sawInstalment.after), inst?.absWeek);
});

test('the balance is charged in the delivery week, and the aircraft arrives', () => {
  const bal = future.find(x => x.kind === 'balance');
  assert.ok(sawBalance, 'the balance was never charged');
  assert.equal(sawBalance.amount, bal?.amount);
  assert.equal(nowAbs(sawBalance.after), theOrder.deliverAbsWeek);
  assert.equal(sawBalance.after.pendingOrders.length, 0);
  assert.equal(sawBalance.after.fleet.filter(a => a.typeId === WIDE).length, 1);
});

test('signing plus the ticks paid the contract price exactly once', () => {
  const atSigning = w0.cash - w1.cash;
  assert.equal(atSigning + paidByTick, priceOf(WIDE));
});

test('payments are capital: the tax bill is the same with or without one', () => {
  assert.ok(sawInstalment, 'fixture never reached the instalment week');
  const due = nowAbs(sawInstalment.after);
  const before = sawInstalment.before;
  const twin = { ...before, pendingOrders: before.pendingOrders.map(o => o.payments
    ? { ...o, payments: o.payments.map(x => x.absWeek <= due ? { ...x, paid: true } : x) } : o) };
  seedRandom(99); const a = advance(before);
  seedRandom(99); const b = advance(twin);
  assert.equal(b.cash - a.cash, sawInstalment.amount, 'the instalment is the only cash difference');
  assert.equal(a.lastReport.corporateTax, b.lastReport.corporateTax, 'an instalment reduced the tax bill');
});

test('the balance is always cash: charged even when it takes the bank negative', () => {
  const bal = future.find(x => x.kind === 'balance');
  const eve = history.find(h => nowAbs(h.after) === theOrder.deliverAbsWeek)?.before;
  assert.ok(eve, 'fixture never reached the delivery week');
  const broke = advance({ ...eve, cash: 1_000 });
  assert.equal(broke.lastReport.aircraftPayments, bal.amount);
  assert.ok(broke.cash < 0, 'the balance was waived instead of charged');
  assert.equal(broke.fleet.filter(a => a.typeId === WIDE).length, 1, 'and the aircraft still arrives');
});

test('the finance projection forecasts the payment the tick then charges', () => {
  assert.ok(sawInstalment, 'fixture never reached the instalment week');
  const proj = projectWeek(sawInstalment.before);
  assert.equal(proj.aircraftPayments, sawInstalment.amount);
});

test('the P&L bridge names the payment, last week and projected, with nothing left over', () => {
  assert.ok(sawInstalment, 'fixture never reached the instalment week');
  const lw = costBridge(bridgeInputsFromReport(sawInstalment.after.lastReport), sawInstalment.after);
  assert.equal(lw.rows.find(r => r.key === 'aircraftPay')?.value, -sawInstalment.amount, 'last week has no payment row');
  assert.equal(lw.netResidual, 0, 'last week: cash moved below the line with no row to name it');
  const pj = costBridge(projectWeek(sawInstalment.before), sawInstalment.before);
  assert.equal(pj.rows.find(r => r.key === 'aircraftPay')?.value, -sawInstalment.amount, 'the projection has no payment row');
  assert.equal(pj.netResidual, 0, 'projection: cash moved below the line with no row to name it');
});

// ── 5. Cancelling ───────────────────────────────────────────────────────────
section('5. Cancelling under the flag');

test('the deposit is forfeited; paid instalments come back at 80%', () => {
  const s1 = order(reducerOnly({ orderBook: true }), WIDE);
  const o  = s1.pendingOrders.at(-1);
  const paidPdp = o.payments.filter(x => x.kind === 'pdp' && x.paid).reduce((t, x) => t + x.amount, 0);
  const s2 = gameReducer(s1, { type: 'CANCEL_ORDER', orderId: o.id });
  assert.equal(s2.pendingOrders.length, 0);
  assert.equal(s2.cash - s1.cash, Math.round(paidPdp * 0.8));
});

test('the refund the screens quote is the refund the reducer pays', () => {
  needModel();
  const s1 = order(reducerOnly({ orderBook: true }), WIDE);
  const o  = s1.pendingOrders.at(-1);
  const s2 = gameReducer(s1, { type: 'CANCEL_ORDER', orderId: o.id });
  assert.equal(pay.cancellationRefund(o), s2.cash - s1.cash);
  const c1 = order(reducerOnly(), WIDE);
  const co = c1.pendingOrders.at(-1);
  const c2 = gameReducer(c1, { type: 'CANCEL_ORDER', orderId: co.id });
  assert.equal(pay.cancellationRefund(co), c2.cash - c1.cash, 'classic orders too');
  const l1 = order(reducerOnly({ orderBook: true }), WIDE, 1, 'lease');
  const lo = l1.pendingOrders.at(-1);
  const l2 = gameReducer(l1, { type: 'CANCEL_ORDER', orderId: lo.id });
  assert.equal(pay.cancellationRefund(lo), l2.cash - l1.cash, 'and leases');
});

// ── 6. The order form ───────────────────────────────────────────────────────
section('6. The order form quotes the schedule');

const React = (await import('react')).default;
const { renderToString } = await import('react-dom/server');
const AircraftCheckout = (await import('../src/components/AircraftCheckout.jsx')).default;
const renderCheckout = (save) => {
  store.set('bbae_save_v2', JSON.stringify(save));
  return renderToString(React.createElement(GameProvider, null,
    React.createElement(AircraftCheckout, { typeId: WIDE, mode: 'buy', onClose() {} })));
};
// The confirm button, found by its label ("Order <type name>") — not by the
// first "Order " on the page, which is the Order Summary heading.
const orderButton = (html) => {
  const at = html.indexOf(`Order ${getAircraftType(WIDE).name}`);
  assert.notEqual(at, -1, 'the confirm button did not render');
  const open = html.lastIndexOf('<button', at);
  return html.slice(open, html.indexOf('>', open) + 1);
};

test('with deposit + instalments in the bank, the order button is live', () => {
  const html = renderCheckout({ ...freshState(), phase: 'playing', hub: 'JFK', orderBook: true,
    cash: Math.round(priceOf(WIDE) * 0.25) });
  assert.ok(!/disabled/.test(orderButton(html)), 'the form still demands the full price up front');
});

test('the form says what is due at signing and what is due on delivery', () => {
  const html = renderCheckout({ ...freshState(), phase: 'playing', hub: 'JFK', orderBook: true, cash: 2e9 });
  assert.ok(/due at signing/i.test(html), 'no "due at signing" figure on the form');
  assert.ok(/on delivery/i.test(html), 'no "on delivery" figure on the form');
  assert.ok(!/Full payment due at order/.test(html), 'still promises full payment at order');
});

test('without the flag the form is unchanged', () => {
  const html = renderCheckout({ ...freshState(), phase: 'playing', hub: 'JFK', cash: 2e9 });
  assert.ok(/Full payment due at order/.test(html));
});

// ── 7. The rest of the screens that show an order or a week's cash ──────────
section('7. Order card, forecast and debrief');

const { OrderCard } = await import('../src/components/Marketplace.jsx');
const Finance       = (await import('../src/components/Finance.jsx')).default;
const { default: WeeklyDebrief, debriefCostRows } = await import('../src/components/WeeklyDebrief.jsx');
const { default: Fleet } = await import('../src/components/Fleet.jsx');
const renderIn = (save, el) => {
  store.set('bbae_save_v2', JSON.stringify(save));
  return renderToString(React.createElement(GameProvider, null, el));
};
const text = (html) => html.replace(/<!-- -->/g, '').replace(/<[^>]*>/g, ' ').replace(/&#x27;/g, "'").replace(/\s+/g, ' ');
const money = (v) => {
  const a = Math.abs(v);
  return a >= 1e9 ? `$${(a / 1e9).toFixed(2)}B` : a >= 1e6 ? `$${(a / 1e6).toFixed(2)}M` : a >= 1e3 ? `$${(a / 1e3).toFixed(1)}K` : `$${a}`;
};

test('an order card shows what is paid, what is next, and what cancelling returns', () => {
  const o = theOrder;
  assert.ok(o?.payments, 'fixture has no staged order');
  const html = text(renderToString(React.createElement(OrderCard,
    { order: o, currentAbsWeek: nowAbs(w1), onCancel() {}, onRename() {} })));
  assert.ok(/Paid So Far/.test(html), 'no paid-so-far figure');
  assert.ok(/Next Instalment/.test(html), 'no next-instalment figure');
  assert.ok(!/95% refund/.test(html), 'the cancel button still promises the classic 95%');
  assert.ok(/back\)/.test(html), 'the cancel button does not say what comes back');
});

test('the 12-week forecast carries the instalment and the balance', () => {
  const html = text(renderIn({ ...w1, phase: 'playing' }, React.createElement(Finance, { initialView: 'forecast' })));
  assert.ok(/ Aircraft /.test(html), 'no Aircraft column in the forecast table');
  const inst = future.find(x => x.kind === 'pdp');
  const bal  = future.find(x => x.kind === 'balance');
  const shown = (v) => html.includes(money(v).replace(/\.00M$/, 'M')) || html.includes(money(v));
  assert.ok(shown(inst.amount), `the ${money(inst.amount)} instalment is not in the forecast`);
  assert.ok(shown(bal.amount),  `the ${money(bal.amount)} balance is not in the forecast`);
});

test('the weekly debrief names the payment instead of lumping it into "Other"', () => {
  assert.ok(sawInstalment, 'fixture never reached the instalment week');
  const r = sawInstalment.after.lastReport;
  const rows = debriefCostRows(r);
  assert.equal(rows.find(x => x.label === 'Aircraft purchase payments')?.v, sawInstalment.amount,
    'the debrief does not name the instalment');
  // Whatever "Other" holds this week, the instalment must not be part of it.
  const other = (rs) => rs.find(x => x.label === 'Other')?.v ?? 0;
  const without = debriefCostRows({ ...r, aircraftPayments: 0, totalCostAll: r.totalCostAll - sawInstalment.amount });
  assert.equal(other(rows), other(without), 'the instalment fell into the debrief\u2019s "Other" line');
  // And the panel itself still renders on that week.
  const html = renderIn({ ...sawInstalment.after, phase: 'playing', showDebrief: true }, React.createElement(WeeklyDebrief));
  assert.ok(html.length > 500, 'the debrief did not render');
});

test('the fleet page renders with a staged order in the book', () => {
  const html = renderIn({ ...w1, phase: 'playing' }, React.createElement(Fleet));
  assert.ok(html.length > 1000);
});

console.log(`\n${passed} passed, ${failed} failed\n`);
if (failed) process.exit(1);
