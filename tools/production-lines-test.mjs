// Production lines in Tailwinds: shared delivery slots, early-slot pricing,
// cancel forfeits, launch customers, the world order board — and the AI rivals
// who now buy off the same lines instead of being handed aircraft.
//
// The engine module (src/data/productionLines.js) is Headwinds' verbatim; the
// sections up to "launch customers" are Headwinds' own suite run against the
// Tailwinds reducer. Everything after is Tailwinds-only: the rivals' orders
// (models/lineBook.js, models/competitorAI.js), staged payments on a line, the
// new-game flags. On HEAD every reducer case fails on its own terms (private
// per-type queue, no premium, 95% refunds, no launch customers, rivals spawn
// aircraft the week they decide to grow).
//
//   node --import ./tools/_register-loader.mjs tools/production-lines-test.mjs

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

const { gameReducer, freshState, orderDenial } = await import('../src/store/GameContext.jsx');
const { getAircraftType, eraPurchasePrice, orderDiscount, AIRCRAFT_TYPES } = await import('../src/data/aircraft.js');
const { absoluteWeek } = await import('../src/utils/fuel.js');
const L = await import('../src/data/productionLines.js').catch(() => null);
const LB = await import('../src/models/lineBook.js').catch(() => null);
const AI = await import('../src/models/competitorAI.js');
const NEWS = await import('../src/models/newsLog.js');
const needL = () => assert.ok(L, 'src/data/productionLines.js does not exist');
const needLB = () => assert.ok(LB, 'src/models/lineBook.js does not exist');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.log(`  ✗ ${name}\n      ${(e.stack || e.message).split('\n').slice(0, 6).join('\n      ')}`); failed++; }
}
function section(t) { console.log(`\n── ${t} ${'─'.repeat(Math.max(0, 66 - t.length))}`); }
function spin() { const t = Date.now(); while (Date.now() === t) { /* spin */ } }

const T = (id) => { const t = getAircraftType(id); assert.ok(t, `no type ${id}`); return t; };
// No rivals unless a test adds them: their orders would move the slots.
const classic = () => ({ ...freshState(), hub: 'JFK', cash: 50_000_000_000, competitors: [] });
const lines = (extra = {}) => ({ ...classic(), productionLinesWorld: true, productionLineScale: 1, ...extra });
const nowAbs = (s) => absoluteWeek(s.year, s.week);
function order(st, typeId, quantity = 1, extra = {}) {
  spin();
  return gameReducer(st, { type: 'ORDER_AIRCRAFT', typeId, quantity, ownershipType: 'owned', ...extra });
}
const added = (before, after) => after.pendingOrders.slice(before.pendingOrders.length);
const weeks = (orders) => orders.map(o => o.deliverAbsWeek);
// A rival holding aircraft on order: one plan with a frame per listed week.
let _rv = 0;
function rivalWith(lineId, typeId, planWeeks, extra = {}) {
  const id = `rv${++_rv}`;
  return {
    id, name: `Rival ${_rv}`, homeHub: 'ORD', tier: 'legacy', cash: 1e9, routes: {}, fleet: [],
    linePlans: [{ id: `${id}-p1`, kind: 'launch', routeKey: 'ORD-LAX', typeId, lineId, weeks: planWeeks,
                  cfg: { frequency: 7, priceMultiplier: 1, aircraftType: typeId, seats: 160 }, orderedAbs: 0 }],
    ...extra,
  };
}

section('line table');

test('every catalogue type is on a production line', () => {
  needL();
  // Tailwinds' executive-charter bizjets are not in Headwinds' line table
  // (the module is shared verbatim): each takes a line of its own.
  assert.deepEqual(L.unmappedTypes().sort(), ['cj4', 'cl350', 'g650er', 'phenom300e']);
  assert.equal(L.lineOf('g650er'), 'type_g650er');
  const seen = new Map();
  for (const [id, line] of Object.entries(L.PRODUCTION_LINES)) {
    for (const t of line.types) {
      assert.ok(getAircraftType(t), `${id} lists unknown type ${t}`);
      assert.ok(!seen.has(t), `${t} is on ${seen.get(t)} and ${id}`);
      seen.set(t, id);
    }
  }
  assert.equal(seen.size, AIRCRAFT_TYPES.length - 4);
});

test('variants share a line; generations do not', () => {
  needL();
  assert.equal(L.lineOf('b737700'), L.lineOf('b737900er'));
  assert.notEqual(L.lineOf('b737800'), L.lineOf('b737max8'));
  assert.notEqual(L.lineOf('a320ceo'), L.lineOf('a320neo'));
});

test('factory freighters ride the parent line; conversions get their own', () => {
  needL();
  assert.equal(L.lineOf('b777f'), L.lineOf('b777300er'));
  assert.equal(L.lineOf('b7478f'), L.lineOf('b7478i'));
  for (const id of ['b737800bcf', 'a321p2f', 'b767200sf', 'e190f', 'dc873f', 'b737400f']) {
    assert.equal(L.lineInfo(L.lineOf(id)).cls, 'Conversion', id);
  }
});

test('capacity: bigger aircraft, fewer slots; scaled by world size; ramps on backlog', () => {
  needL();
  const cap = (t, o) => L.lineCapacity(L.lineOf(t), o);
  assert.equal(cap('atr72'), 10);
  assert.equal(cap('b737800'), 8);
  assert.equal(cap('b7879'), 5);
  assert.equal(cap('a380'), 3);
  assert.equal(cap('b767200sf'), 2);
  assert.equal(cap('b7879', { scale: 0.6 }), 3);
  assert.equal(cap('b7879', { scale: 1.5 }), 8);
  assert.equal(cap('b7879', { backlogFrames: 5 * 26 }), 5, 'exactly 26 weeks of backlog: no ramp yet');
  assert.equal(cap('b7879', { backlogFrames: 5 * 27 }), 6);
  assert.equal(cap('b7879', { backlogFrames: 5 * 200 }), 8, 'never past the ceiling');
  assert.equal(L.capacityScale(10), 0.6);
  assert.equal(L.capacityScale(500), 1.5);
});

section('your deliveries off a line are spaced by the class gap');

test('a 5-frame narrow-body order arrives every 3 weeks from the standard week', () => {
  const s0 = lines();
  const s1 = order(s0, 'b737800', 5);
  const w = weeks(added(s0, s1));
  const std = nowAbs(s0) + 6;
  assert.deepEqual(w, [std, std + 3, std + 6, std + 9, std + 12]);
  assert.ok(added(s0, s1).every(o => o.lineId === 'b737ng'), 'orders carry their line');
});

test('parallel variants do not dodge the gap', () => {
  const s0 = lines();
  const s1 = order(s0, 'b737800', 2);
  const s2 = order(s1, 'b737700', 2);
  const s3 = order(s2, 'b737900er', 2);
  const all = weeks(s3.pendingOrders).sort((a, b) => a - b);
  for (let i = 1; i < all.length; i++) assert.ok(all[i] - all[i - 1] >= 3, `frames ${all[i - 1]} and ${all[i]} closer than 3 weeks`);
});

test('no four A380s in a month: double-deck frames come at least 5 weeks apart', () => {
  needL();
  assert.equal(L.lineGapWeeks('a380'), 5);
  assert.equal(L.lineGapWeeks('b747'), 5, 'the 747-400F on the same line keeps the jumbo gap');
  assert.equal(L.lineGapWeeks('atr'), 1);
  const s0 = lines();
  const s1 = order(s0, 'a380', 4);
  const w = weeks(added(s0, s1));
  const std = nowAbs(s0) + 10;
  assert.deepEqual(w, [std, std + 5, std + 10, std + 15]);
});

test('an early slot still respects the gap to a frame you already hold', () => {
  const s0 = lines();
  const s1 = order(s0, 'b737800', 1);
  const s2 = order(s1, 'b737800', 1, { slotFromWeek: nowAbs(s0) + 3 });
  assert.equal(added(s1, s2)[0].deliverAbsWeek, nowAbs(s0) + 3, '3 weeks before the held frame is allowed');
  const s3 = order(s2, 'b737800', 1, { slotFromWeek: nowAbs(s0) + 4 });
  assert.equal(added(s2, s3)[0].deliverAbsWeek, nowAbs(s0) + 9, 'squeezed out until 3 weeks past the last one');
});

test('a different line is independent', () => {
  const s0 = lines();
  const s1 = order(s0, 'b737800', 1);
  const s2 = order(s1, 'a320neo', 1);
  assert.equal(s2.pendingOrders[0].deliverAbsWeek, s2.pendingOrders[1].deliverAbsWeek);
});

test("rivals' orders fill the line: a full week is skipped", () => {
  // Tailwinds' rivals are the AI carriers: their aircraft on order are plans
  // (models/lineBook.js), injected into the line the same way Headwinds
  // injects other players' orders.
  const s = lines();
  const std = nowAbs(s) + 6;
  const s0 = { ...s, competitors: [rivalWith('b737ng', 'b737800', [...Array(8).fill(std), ...Array(7).fill(std + 1)])] };
  const s1 = order(s0, 'b737800', 2);
  assert.deepEqual(weeks(added(s0, s1)), [std + 1, std + 4]);
});

test('classic worlds keep the private per-type stagger', () => {
  const s0 = classic();
  const s1 = order(s0, 'b737800', 3);
  const n = nowAbs(s0);
  assert.deepEqual(weeks(added(s0, s1)), [n + 6, n + 9, n + 12]);
  assert.equal(added(s0, s1)[0].lineId, undefined);
});

test('a requested start more than 26 weeks past the standard week is pulled in', () => {
  const s0 = lines();
  const s1 = order(s0, 'b737800', 1, { ownershipType: 'lease', slotFromWeek: nowAbs(s0) + 200 });
  assert.equal(added(s0, s1)[0].deliverAbsWeek, nowAbs(s0) + 6 + 26);
});

section('early slots cost extra');

test('the earliest slot is +25% of list, the standard week is list', () => {
  const s0 = lines();
  const t = T('b737800');
  const list = eraPurchasePrice(t);
  const early = order(s0, 'b737800', 1, { slotFromWeek: nowAbs(s0) + 3 });
  const o = added(s0, early)[0];
  assert.equal(o.deliverAbsWeek, nowAbs(s0) + 3);
  assert.equal(o.slotPremium, Math.round(list * 0.25));
  assert.equal(o.totalPrice, list + Math.round(list * 0.25), 'premium is in the price (and so the cost basis)');
  assert.equal(s0.cash - early.cash, o.totalPrice);
  const std = order(s0, 'b737800', 1);
  assert.equal(added(s0, std)[0].slotPremium, 0);
  assert.equal(added(s0, std)[0].totalPrice, list);
});

test('the premium falls linearly to zero at the standard week', () => {
  needL();
  const t = T('b737800');
  const n = 100;
  assert.equal(L.slotPremiumPct(t, n + 3, n), 0.25);
  assert.equal(L.slotPremiumPct(t, n + 4, n), Math.round(0.25 * 2 / 3 * 10000) / 10000);
  assert.equal(L.slotPremiumPct(t, n + 5, n), Math.round(0.25 * 1 / 3 * 10000) / 10000);
  assert.equal(L.slotPremiumPct(t, n + 6, n), 0);
  assert.equal(L.slotPremiumPct(t, n + 1, n), 0.25, 'before the build time clamps to the earliest week');
});

test('a slot can never be earlier than the build time', () => {
  const s0 = lines();
  const s1 = order(s0, 'b737800', 1, { slotFromWeek: nowAbs(s0) - 50 });
  assert.equal(added(s0, s1)[0].deliverAbsWeek, nowAbs(s0) + 3);
});

test('a lease can buy an early slot: the premium is a one-off fee on top of the deposit', () => {
  const s0 = lines();
  const s1 = order(s0, 'b737800', 1, { ownershipType: 'lease', slotFromWeek: nowAbs(s0) + 3 });
  const o = added(s0, s1)[0];
  assert.equal(o.slotPremium, Math.round(eraPurchasePrice(T('b737800')) * 0.25));
  assert.equal(s0.cash - s1.cash, o.leaseDeposit + o.slotPremium);
});

section('cancelling');

function cancelAt(weeksOut, ownershipType = 'owned') {
  const s0 = lines();
  const s1 = order(s0, 'b737800', 1, { ownershipType, slotFromWeek: nowAbs(s0) + weeksOut });
  const o = added(s0, s1)[0];
  assert.equal(o.deliverAbsWeek - nowAbs(s0), weeksOut);
  const s2 = gameReducer(s1, { type: 'CANCEL_ORDER', orderId: o.id });
  return { o, refund: s2.cash - s1.cash, after: s2 };
}

test('owned: 5% forfeit beyond a year, 10% / 20% / 30% as the slot nears', () => {
  // Beyond a year out is only reachable by a long order spilling forward (a
  // requested start is capped), so that tier is checked on the terms directly.
  needL();
  const far = L.cancelTerms({ ownershipType: 'owned', totalPrice: 1_000_000, deliverAbsWeek: 160 }, 100);
  assert.equal(far.refund, 950_000);
  for (const [w, pct] of [[32, 0.10], [26, 0.10], [25, 0.20], [13, 0.20], [12, 0.30], [6, 0.30]]) {
    const { o, refund, after } = cancelAt(w);
    assert.equal(refund, o.totalPrice - Math.round(o.totalPrice * pct), `${w} weeks out`);
    assert.equal(after.pendingOrders.length, 0);
  }
});

test('lease: deposit back 26+ weeks out, forfeit inside that', () => {
  const far = cancelAt(26, 'lease');
  assert.equal(far.refund, far.o.leaseDeposit);
  const near = cancelAt(25, 'lease');
  assert.equal(near.refund, 0);
});

test('classic worlds keep 95% / full lease refund', () => {
  const s0 = classic();
  const s1 = order(s0, 'b737800', 1);
  const o = added(s0, s1)[0];
  const s2 = gameReducer(s1, { type: 'CANCEL_ORDER', orderId: o.id });
  assert.equal(s2.cash - s1.cash, Math.round(o.totalPrice * 0.95));
});

test('a cancelled slot is free again for the next order', () => {
  const s0 = lines();
  const s1 = order(s0, 'b737800', 1);
  const first = added(s0, s1)[0];
  const s2 = gameReducer(s1, { type: 'CANCEL_ORDER', orderId: first.id });
  const s3 = order(s2, 'b737800', 1);
  assert.equal(added(s2, s3)[0].deliverAbsWeek, first.deliverAbsWeek);
});

section('launch customers (era worlds)');

// 777-9 enters service in 2027 → announced January 2025, window 26 weeks.
const era = (extra = {}) => lines({ startYear: 2025, year: 1, week: 5, ...extra });

test('an announced type is open to launch customers only', () => {
  const d = orderDenial(era(), 'b7779x');
  assert.equal(d?.code, 'launch_only');
  assert.equal(d.minQty, 20);
  assert.equal(orderDenial(era({ week: 27 }), 'b7779x')?.code, 'not_yet_flying', 'window closed');
  assert.equal(orderDenial(era({ productionLinesWorld: undefined }), 'b7779x')?.code, 'not_yet_flying', 'no lines, no launch');
});

test('below the minimum, or leased, the launch order is refused', () => {
  const s0 = era();
  assert.equal(order(s0, 'b7779x', 19).pendingOrders.length, 0);
  assert.equal(order(s0, 'b7779x', 20, { ownershipType: 'lease' }).pendingOrders.length, 0);
});

test('a launch order delivers from January of the EIS year, wide-body gap apart, discounted and firm', () => {
  const s0 = era();
  const s1 = order(s0, 'b7779x', 20);
  const placed = added(s0, s1);
  assert.equal(placed.length, 20);
  const eisAbs = absoluteWeek(3, 1);
  assert.deepEqual(weeks(placed), Array.from({ length: 20 }, (_, i) => eisAbs + 4 * i));
  const disc = orderDiscount(20) + 0.08;
  const list = eraPurchasePrice(T('b7779x'), 2025);
  assert.ok(Math.abs(placed[0].totalPrice - Math.round(list * (1 - disc))) <= 1, `price ${placed[0].totalPrice} vs ${Math.round(list * (1 - disc))}`);
  assert.ok(placed.every(o => o.launch === true && o.slotPremium === 0));
  assert.equal(s1.launchPrograms?.b7779x?.manufacturer, 'Boeing');
  const s2 = gameReducer(s1, { type: 'CANCEL_ORDER', orderId: placed[0].id });
  assert.equal(s2.pendingOrders.length, 20, 'launch frames cannot be cancelled');
  assert.equal(s2.cash, s1.cash);
});

test('repeat launch programmes with the same maker earn +2%, capped at 25% in total', () => {
  needL();
  const s1 = order(era(), 'b7779x', 20);
  const t = T('b737max10');
  assert.equal(L.launchDiscount(s1, t), 0.10);
  assert.equal(L.launchOrderDiscount(s1, t, 30), orderDiscount(30) + 0.10);
  assert.equal(L.launchOrderDiscount(s1, t, 100), 0.25);
  assert.equal(L.launchDiscount(s1, T('a350f')), 0.08, 'another maker starts over');
});

test('a launch order that cannot be paid in full is not trimmed below the minimum', () => {
  const s0 = era({ cash: eraPurchasePrice(T('b7779x'), 2025) * 5 });
  const s1 = order(s0, 'b7779x', 20);
  assert.equal(s1.pendingOrders.length, 0);
  assert.equal(s1.cash, s0.cash);
});

section('order board');

test('used orders never occupy a line', () => {
  needL();
  const b = L.bookingsFromStates([{ pendingOrders: [
    { typeId: 'b7879', deliverAbsWeek: 40, used: true },
    { typeId: 'b7879', deliverAbsWeek: 40 },
  ] }], 0);
  assert.deepEqual(b, { b787: { 40: 1 } });
});

test("world totals: every rival's fleet and orders plus your own", () => {
  needLB();
  const rv = rivalWith('a380', 'a380', [8, 13, 30]);
  rv.fleet = Array.from({ length: 10 }, (_, i) => ({ id: `t${i}`, typeId: 'a380', routeKey: 'ORD-LHR' }));
  const s = {
    ...classic(), airlineName: 'Mine',
    fleet: [{ id: 'a', typeId: 'a380', status: 'active' }, { id: 'b', typeId: 'a380', status: 'retired' }],
    pendingOrders: [{ id: 'p', typeId: 'a380', deliverAbsWeek: 20 }],
    competitors: [rv],
  };
  // At week 10 the rival's first frame has arrived (it waits on the plan, but
  // it exists), two are still on order.
  const board = LB.soloFleetBoard(s, 10);
  assert.equal(board.a380.inService, 10 + 1 + 1);
  assert.equal(board.a380.onOrder, 2 + 1);
  assert.deepEqual(board.a380.customers.map(c => c.name), [rv.name, 'Mine']);
});

section('cancelling with staged payments (order book) on a line');

const staged = (extra = {}) => lines({ orderBook: true, ...extra });

test('an early slot is part of a staged contract, and the schedule adds up to it', () => {
  const s0 = staged();
  const s1 = order(s0, 'b737800', 1, { slotFromWeek: nowAbs(s0) + 3 });
  const o = added(s0, s1)[0];
  assert.ok(o.slotPremium > 0);
  assert.equal(o.contractPrice, o.totalPrice, 'no Wi-Fi: the contract is the price, premium included');
  assert.equal(o.payments.reduce((a, p) => a + p.amount, 0), o.contractPrice);
  assert.ok(s0.cash - s1.cash < o.contractPrice, 'only the signing-week payments leave now');
});

test('cancelling a staged order on a line: the staged rule, and the slot goes back', () => {
  needLB();
  const s0 = staged();
  const s1 = order(s0, 'b737800', 1);
  const o = added(s0, s1)[0];
  const terms = LB.orderCancelTerms(s1, o, nowAbs(s1));
  assert.equal(terms.rule, 'staged');
  const s2 = gameReducer(s1, { type: 'CANCEL_ORDER', orderId: o.id });
  assert.equal(s2.cash - s1.cash, terms.refund);
  const s3 = order(s2, 'b737800', 1);
  assert.equal(added(s2, s3)[0].deliverAbsWeek, o.deliverAbsWeek);
});

test('orderCancelTerms quotes exactly what CANCEL_ORDER pays, in every regime', () => {
  needLB();
  for (const [label, s0, extra] of [
    ['classic owned', classic(), {}],
    ['classic lease', classic(), { ownershipType: 'lease' }],
    ['line owned', lines(), { slotFromWeek: null }],
    ['line lease near', lines(), { ownershipType: 'lease' }],
    ['staged owned', staged(), {}],
  ]) {
    const s1 = order(s0, 'b737800', 1, extra);
    const o = added(s0, s1)[0];
    const terms = LB.orderCancelTerms(s1, o, nowAbs(s1));
    const s2 = gameReducer(s1, { type: 'CANCEL_ORDER', orderId: o.id });
    assert.equal(s2.cash - s1.cash, terms.refund, label);
  }
});

section('launch customers with staged payments');

test('a launch order is paid in full even where purchases are staged', () => {
  const s0 = staged({ startYear: 2025, year: 1, week: 5 });
  const s1 = order(s0, 'b7779x', 20);
  const placed = added(s0, s1);
  assert.equal(placed.length, 20);
  assert.ok(placed.every(o => !o.payments), 'no payment schedule');
  assert.equal(s0.cash - s1.cash, placed.reduce((a, o) => a + o.totalPrice, 0));
});

section('new games');

test('a new game has production lines and staged payments; switching them off at setup leaves neither', () => {
  needLB();
  const on = gameReducer(freshState(), { type: 'START_GAME', airlineName: 'A', hub: 'ORD' });
  assert.equal(on.productionLinesWorld, true);
  assert.equal(on.orderBook, true);
  assert.equal(on.productionLineScale, LB.SOLO_LINE_SCALE);
  const off = gameReducer(freshState(), { type: 'START_GAME', airlineName: 'A', hub: 'ORD', productionLines: false });
  assert.equal(off.productionLinesWorld, undefined);
  assert.equal(off.orderBook, undefined);
  assert.equal(freshState().productionLinesWorld, undefined, 'existing saves are never upgraded');
});

section('rivals order off the lines');

test('a rival plan books its frames: the player sees the line fuller', () => {
  needLB();
  const s = lines();
  const std = nowAbs(s) + 6;
  const view = LB.withLineBook({ ...s, competitors: [rivalWith('a320neo', 'a320neo', [std, std + 3])] }, nowAbs(s));
  assert.deepEqual(view.lineBook.bookings, { a320neo: { [std]: 1, [std + 3]: 1 } });
  const c = classic();
  assert.equal(LB.withLineBook(c, 1), c, 'identity without lines');
});

test('quotePlan: a rival takes the standard week on, keeps its own gap, and avoids full weeks', () => {
  needLB();
  const absWeek = 100;
  const std = absWeek + 6;
  const other = rivalWith('a320neo', 'a320neo', Array(3).fill(std));   // fills the week at scale 0.4 (3 a week)
  const ledger = LB.makeTickLedger({ competitors: [other], pendingOrders: [], absWeek, scale: 0.4 });
  const q = LB.quotePlan(ledger, [], T('a320neo'), 3);
  assert.deepEqual(q.weeks, [std + 1, std + 4, std + 7]);
  assert.equal(q.delay, 1);
  assert.equal(q.premiumPct, 0);
  const early = LB.quotePlan(ledger, [], T('a320neo'), 1, { early: true });
  assert.equal(early.weeks[0], absWeek + 3, 'early: from the build time');
  assert.equal(early.premiumPct, 0.25);
});

test('the tick ledger moves as rivals book and cancel', () => {
  needLB();
  const ledger = LB.makeTickLedger({ competitors: [], pendingOrders: [{ typeId: 'a320neo', deliverAbsWeek: 50 }], absWeek: 10 });
  assert.deepEqual(ledger.total, { a320neo: { 50: 1 } });
  ledger.add('a320neo', [50, 53]);
  assert.deepEqual(ledger.total, { a320neo: { 50: 2, 53: 1 } });
  ledger.remove('a320neo', [50, 53]);
  assert.deepEqual(ledger.total, { a320neo: { 50: 1 } });
});

test('a plan takes effect when its last frame arrives: new route, more flights, bigger type', () => {
  const base = { id: 'r', name: 'R', cash: 1e9, fleet: [{ id: 'r-t1', typeId: 'a320neo', routeKey: 'ORD-DEN' }],
                 routes: { 'ORD-DEN': { frequency: 7, aircraftType: 'a320neo', seats: 180, tails: 1, priceMultiplier: 1 } } };
  const ev = { type: 'launch', airlineId: 'r', name: 'R', routeKey: 'ORD-SEA', description: 'R launched new service on ORD → SEA.' };
  const c = { ...base, linePlans: [
    { id: 'p1', kind: 'launch', routeKey: 'ORD-SEA', typeId: 'a320neo', lineId: 'a320neo', weeks: [20, 23], cfg: { frequency: 14, aircraftType: 'a320neo', seats: 180, priceMultiplier: 1 }, event: ev },
    { id: 'p2', kind: 'grow', routeKey: 'ORD-DEN', typeId: 'a320neo', lineId: 'a320neo', weeks: [26], cfg: { frequency: 10, aircraftType: 'a320neo' } },
  ] };
  const early = AI.deliverLinePlans(c, 22);
  assert.equal(early.carrier, c, 'nothing complete: nothing changes');
  const mid = AI.deliverLinePlans(c, 23);
  assert.equal(mid.carrier.routes['ORD-SEA'].tails, 2);
  assert.equal(mid.carrier.routes['ORD-SEA'].frequency, 14);
  assert.equal(mid.carrier.fleet.filter(f => f.routeKey === 'ORD-SEA').length, 2);
  assert.deepEqual(mid.events, [ev], "the move's own news goes out on delivery");
  assert.equal(mid.carrier.linePlans.length, 1);
  const late = AI.deliverLinePlans(mid.carrier, 26);
  assert.equal(late.carrier.routes['ORD-DEN'].frequency, 10);
  assert.equal(late.carrier.routes['ORD-DEN'].tails, 2);
  assert.equal(late.carrier.linePlans.length, 0);
  const up = AI.deliverLinePlans({ ...base, linePlans: [
    { id: 'p3', kind: 'upgauge', routeKey: 'ORD-DEN', typeId: 'a321neo', lineId: 'a320neo', weeks: [30], cfg: { seats: 230 } },
  ] }, 30).carrier;
  assert.equal(up.routes['ORD-DEN'].aircraftType, 'a321neo');
  assert.ok(up.fleet.every(f => f.typeId === 'a321neo' && f.ageWeeks === 0));
  assert.equal(up.fleet.length, 1, 'an up-gauge swaps frames, it does not add them');
});

// Deterministic Math.random for the whole-game runs below.
function seeded(seed) {
  let a = seed >>> 0;
  return () => { a = (a + 0x6D2B79F5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
function run(weeksToRun, { productionLines = true, startYear, seed = 7, onWeek } = {}) {
  const real = Math.random;
  Math.random = seeded(seed);
  try {
    let s = gameReducer(freshState(), { type: 'START_GAME', airlineName: 'Probe', hub: 'ORD', productionLines, ...(startYear ? { startYear } : {}) });
    for (let w = 0; w < weeksToRun; w++) {
      const prev = s;
      s = gameReducer(s, { type: 'ADVANCE_WEEK' });
      onWeek?.(prev, s);
    }
    return s;
  } finally { Math.random = real; }
}

test('rivals get new aircraft only when an order of theirs completes', () => {
  needLB();
  let checked = 0;
  run(60, { onWeek: (prev, next) => {
    const arrive = absoluteWeek(next.year, next.week);
    for (const c of next.competitors) {
      const before = prev.competitors.find(x => x.id === c.id);
      if (!before) continue;   // a startup is founded with its fleet
      const had = new Set((before.fleet ?? []).map(f => f.id));
      const fresh = (c.fleet ?? []).filter(f => !had.has(f.id) && !f.id.includes('-x'));   // -x: absorbed in a merger
      const due = (before.linePlans ?? [])
        .filter(p => p.kind !== 'upgauge' && p.weeks.every(w => w <= arrive) && (p.kind !== 'launch' || !before.routes[p.routeKey]))
        .reduce((n, p) => n + p.weeks.length, 0);
      if (fresh.length || due) checked++;
      assert.ok(fresh.length <= due, `${c.name} gained ${fresh.length} aircraft with only ${due} due on order (week ${arrive})`);
    }
  } });
  assert.ok(checked > 5, `only ${checked} deliveries seen`);
});

test('no line is ever booked past its ceiling, and each rival keeps its own gap', () => {
  needLB();
  const s = run(52);
  const now = absoluteWeek(s.year, s.week);
  const total = L.sumBookings([LB.rivalBookings(s.competitors, now), LB.playerBookings(s.pendingOrders, now)]);
  let lineWeeks = 0;
  for (const [lineId, byWeek] of Object.entries(total)) {
    const ceiling = L.lineCapacity(lineId, { scale: s.productionLineScale, backlogFrames: 1e9 });
    for (const [w, n] of Object.entries(byWeek)) { lineWeeks++; assert.ok(n <= ceiling, `${lineId} week ${w}: ${n} booked, ceiling ${ceiling}`); }
  }
  assert.ok(lineWeeks > 10, 'rivals have aircraft on order');
  for (const c of s.competitors) {
    const byLine = {};
    for (const p of c.linePlans ?? []) for (const w of p.weeks) (byLine[p.lineId] ??= []).push(w);
    for (const [lineId, ws] of Object.entries(byLine)) {
      ws.sort((a, b) => a - b);
      const gap = L.lineGapWeeks(lineId);
      for (let i = 1; i < ws.length; i++) assert.ok(ws[i] - ws[i - 1] >= gap, `${c.name} on ${lineId}: ${ws[i - 1]} and ${ws[i]}`);
    }
  }
});

test('rivals still grow: slot-starved is allowed, stalled is not', () => {
  for (const startYear of [undefined, 1975]) {
    let start = null;
    const s = run(78, { startYear, onWeek: (prev) => { start ??= prev.competitors.reduce((a, c) => a + c.fleet.length, 0); } });
    const flying = s.competitors.reduce((a, c) => a + c.fleet.length, 0);
    const onOrder = s.competitors.reduce((a, c) => a + (c.linePlans ?? []).reduce((n, p) => n + p.weeks.length, 0), 0);
    assert.ok(flying > start * 1.3, `${startYear ?? 'classic'}: rival fleet ${start} → ${flying}`);
    assert.ok(onOrder > 0, `${startYear ?? 'classic'}: nothing on order`);
  }
});

test('without production lines rivals never place orders', () => {
  let orders = 0;
  const s = run(40, { productionLines: false, onWeek: (_p, n) => { orders += (n.lastReport?.competitorEvents ?? []).filter(e => e.type === 'aircraftOrder').length; } });
  assert.equal(orders, 0);
  assert.ok(s.competitors.every(c => c.linePlans === undefined), 'no plan bookkeeping on a classic save');
});

test("rivals' orders roll up into one news item a week", () => {
  let evs = [];
  run(20, { onWeek: (_p, n) => { const o = (n.lastReport?.competitorEvents ?? []).filter(e => e.type === 'aircraftOrder'); if (o.length > evs.length) evs = o; } });
  assert.ok(evs.length > 1, 'rivals ordered aircraft');
  const rows = NEWS.buildWeekNews({ year: 1, week: 2, absWeek: 2, competitorEvents: evs }).filter(r => r.kind === 'competitor_aircraftOrder');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].data.total, evs.length);
  assert.equal(rows[0].icon, '🏭');
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
