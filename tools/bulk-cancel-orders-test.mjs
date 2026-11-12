// Bulk cancel of aircraft orders (CANCEL_ORDER with orderIds). Port of the
// Headwinds change (Discord, lkfht, 2026-11-12: "If possible, bulk cancel
// aircraft orders").
//
// Every order goes on its own models/lineBook.js orderCancelTerms — classic
// 95% / lease deposit back, staged payments (deposit kept, instalments back at
// 80%), production-line forfeits by nearness — firm launch frames stay on the
// book, and the airline gets one refund and one toast. Fleet ▸ On Order ticks
// orders; Market ▸ Orders cancels every order its filter shows.
//
//   node --import ./tools/_register-loader.mjs tools/bulk-cancel-orders-test.mjs

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

const { GameProvider, gameReducer, freshState } = await import('../src/store/GameContext.jsx');
const { absoluteWeek } = await import('../src/utils/fuel.js');
const COPY = await import('../src/utils/cancelOrdersCopy.js').catch(() => ({}));

const classic = (extra = {}) => ({ ...freshState(), hub: 'JFK', cash: 50_000_000_000, competitors: [], ...extra });
const lines = () => classic({ productionLinesWorld: true, productionLineScale: 1 });
const nowAbs = (s) => absoluteWeek(s.year, s.week);
function order(st, typeId, quantity = 1, extra = {}) {
  spin();
  return gameReducer(st, { type: 'ORDER_AIRCRAFT', typeId, quantity, ownershipType: 'owned', ...extra });
}
function oneByOne(s, ids) {
  for (const id of ids) s = gameReducer(s, { type: 'CANCEL_ORDER', orderId: id });
  return s;
}
const ids = (s) => s.pendingOrders.map(o => o.id);
const lastToast = (s) => (s.pendingToasts ?? []).at(-1);
const firmFirst = (s) => ({ ...s, pendingOrders: s.pendingOrders.map((o, i) => (i === 0 ? { ...o, launch: true } : o)) });

function classicBook(extra = {}) {
  let s = classic(extra);
  s = order(s, 'b737800', 3);
  s = order(s, 'a320ceo', 2, { ownershipType: 'lease' });
  return s;
}
function linesBook() {
  let s = lines();
  const now = nowAbs(s);
  s = order(s, 'b737800', 1, { slotFromWeek: now + 30 });
  s = order(s, 'b737800', 1, { slotFromWeek: now + 14 });
  s = order(s, 'a320ceo', 1, { slotFromWeek: now + 7 });
  s = order(s, 'a320ceo', 1, { ownershipType: 'lease', slotFromWeek: now + 28 });
  return s;
}
const BOOKS = { classic: () => classicBook(), 'staged payments': () => classicBook({ orderBook: true }), 'production lines': linesBook };

console.log('\nBulk cancel of aircraft orders\n');

section('the engine');

for (const [name, make] of Object.entries(BOOKS)) {
  await test(`${name}: cancelling the whole book at once refunds what one-by-one would`, () => {
    const s = make();
    assert.ok(s.pendingOrders.length >= 4, 'fixture: a book of orders');
    const bulk = gameReducer(s, { type: 'CANCEL_ORDER', orderIds: ids(s) });
    assert.equal(bulk.pendingOrders.length, 0);
    assert.equal(bulk.cash, oneByOne(s, ids(s)).cash);
    assert.ok(bulk.cash > s.cash);
  });
}

await test('one toast for the batch, naming the count and the money', () => {
  const s = linesBook();
  const bulk = gameReducer(s, { type: 'CANCEL_ORDER', orderIds: ids(s) });
  assert.equal((bulk.pendingToasts ?? []).length - (s.pendingToasts ?? []).length, 1);
  assert.equal(lastToast(bulk).title, 'Orders cancelled');
  assert.match(lastToast(bulk).message, /^4 orders off the book\. Refunded .*lost/);
});

await test('only the orders asked for go; the rest stay', () => {
  const s = classicBook();
  const pick = ids(s).slice(0, 2);
  const bulk = gameReducer(s, { type: 'CANCEL_ORDER', orderIds: pick });
  assert.deepEqual(ids(bulk), ids(s).slice(2));
  assert.equal(bulk.cash, oneByOne(s, pick).cash);
});

await test('firm launch-customer orders stay on the book and the toast says so', () => {
  const s = firmFirst(linesBook());
  const bulk = gameReducer(s, { type: 'CANCEL_ORDER', orderIds: ids(s) });
  assert.deepEqual(ids(bulk), [ids(s)[0]]);
  assert.equal(bulk.cash, oneByOne(s, ids(s).slice(1)).cash);
  assert.match(lastToast(bulk).message, /1 launch-customer order is firm/);
});

await test('a batch of only firm orders changes nothing but a warning', () => {
  let s = linesBook();
  s = { ...s, pendingOrders: s.pendingOrders.map(o => ({ ...o, launch: true })) };
  const bulk = gameReducer(s, { type: 'CANCEL_ORDER', orderIds: ids(s) });
  assert.equal(bulk.cash, s.cash);
  assert.deepEqual(ids(bulk), ids(s));
  assert.equal(lastToast(bulk).type, 'warning');
});

await test('a list of one is the single cancel', () => {
  const s = linesBook();
  const id = ids(s)[1];
  const a = gameReducer(s, { type: 'CANCEL_ORDER', orderIds: [id] });
  const b = gameReducer(s, { type: 'CANCEL_ORDER', orderId: id });
  assert.equal(a.cash, b.cash);
  assert.deepEqual(ids(a), ids(b));
  assert.deepEqual(a.pendingToasts, b.pendingToasts);
});

await test('unknown or duplicate ids are harmless', () => {
  const s = classicBook();
  assert.equal(gameReducer(s, { type: 'CANCEL_ORDER', orderIds: ['nope'] }), s);
  assert.equal(gameReducer(s, { type: 'CANCEL_ORDER', orderIds: [] }), s);
  const id = ids(s)[0];
  const dup = gameReducer(s, { type: 'CANCEL_ORDER', orderIds: [id, id, 'nope'] });
  assert.equal(dup.cash, gameReducer(s, { type: 'CANCEL_ORDER', orderId: id }).cash, 'refunded once');
});

section('the dialog quotes what the engine pays');

await test('cancelOrdersDialog: refund and firm count match the reducer, in every regime', () => {
  assert.equal(typeof COPY.cancelOrdersDialog, 'function', 'src/utils/cancelOrdersCopy.js cancelOrdersDialog is missing');
  for (const [name, make] of Object.entries(BOOKS)) {
    const s = name === 'production lines' ? firmFirst(make()) : make();
    const d = COPY.cancelOrdersDialog(s, s.pendingOrders);
    const after = gameReducer(s, { type: 'CANCEL_ORDER', orderIds: ids(s) });
    assert.equal(d.refund, after.cash - s.cash, name);
    assert.equal(d.count, s.pendingOrders.length - after.pendingOrders.length, name);
    assert.equal(d.firm, name === 'production lines' ? 1 : 0, name);
  }
});

await test('the new toasts have a pop-up category', async () => {
  const A = await import('../src/utils/alertPrefs.js');
  assert.equal(A.alertCategory({ title: 'Orders cancelled' }), 'fleet');
  assert.equal(A.alertCategory({ title: 'Orders are firm' }), 'fleet');
});

section('the screens');

await test('Market ▸ Orders offers to cancel every order shown', async () => {
  const { OrdersTab } = await import('../src/components/Marketplace.jsx');
  assert.ok(OrdersTab, 'OrdersTab is not exported');
  const s = classicBook();
  store.set('bbae_save_v2', JSON.stringify(s));
  const render = (extra) => renderToString(React.createElement(GameProvider, null,
    React.createElement(OrdersTab, { pendingOrders: s.pendingOrders, year: s.year, week: s.week,
      onCancel() {}, onRename() {}, onBrowse() {}, ...extra })));
  const html = render({ onCancelMany() {} });
  assert.match(html, /data-order-cancel-shown/);
  assert.match(html.replace(/<!-- -->/g, ''), /Cancel all 5 shown/);
  assert.doesNotMatch(render({}), /data-order-cancel-shown/, 'no handler, no button');
});

await test('Fleet renders with orders on the book (bulk bar wired in)', async () => {
  const Fleet = (await import('../src/components/Fleet.jsx')).default;
  const s = classicBook();
  store.set('bbae_save_v2', JSON.stringify(s));
  const html = renderToString(React.createElement(GameProvider, null, React.createElement(Fleet)));
  assert.match(html, /On Order/);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
