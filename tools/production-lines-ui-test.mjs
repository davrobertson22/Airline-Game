// Production lines, UI side (Tailwinds): the market shows the world order board
// (every game: each rival's fleet and orders plus yours) and the shared line
// (production-line games), announced types show launch terms, the order cards
// quote the cancel terms CANCEL_ORDER pays, and the checkout's delivery weeks
// and prices are exactly what ORDER_AIRCRAFT books — SSR-rendering the real
// components. Engine side: tools/production-lines-test.mjs.
//
//   node --import ./tools/_register-loader.mjs tools/production-lines-ui-test.mjs
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
Math.random = () => 0.5;

let passed = 0, failed = 0;
function test(name, fn) {
  try {
    const out = fn();
    if (out && typeof out.then === 'function') throw new Error('test bodies must be synchronous');
    console.log(`  ✓ ${name}`); passed++;
  } catch (e) { console.log(`  ✗ ${name}\n      ${(e.stack || e.message).split('\n').slice(0, 5).join('\n      ')}`); failed++; }
}

const { GameProvider, freshState, gameReducer } = await import('../src/store/GameContext.jsx');
const Marketplace = (await import('../src/components/Marketplace.jsx')).default;
const { OrderCard } = await import('../src/components/Marketplace.jsx');
const AircraftCheckout = (await import('../src/components/AircraftCheckout.jsx')).default;
const SetupScreen = (await import('../src/components/SetupScreen.jsx')).default;
const { absoluteWeek } = await import('../src/utils/fuel.js');

const seedSave = (save) => store.set('bbae_save_v2', JSON.stringify(save));
const render = (el) => renderToString(React.createElement(GameProvider, null, el)).replace(/<!-- -->/g, '');
const text = (html) => html.replace(/<[^>]+>/g, ' ').replace(/&#x27;/g, "'").replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/\s+/g, ' ');
const cardOf = (html, name) => {
  const i = html.indexOf(`>${name}<`);
  assert.ok(i > 0, `${name} card rendered`);
  const end = html.indexOf('aircraft-market-card', i);
  return text(html.slice(i, end > i ? end : undefined));
};

const base = (over = {}) => ({
  ...freshState(), hub: 'JFK', airlineName: 'Mine', cash: 5_000_000_000, competitors: [], phase: 'playing', ...over,
});
const lines = (over = {}) => base({ productionLinesWorld: true, productionLineScale: 1, ...over });
const era = (over = {}) => lines({ startYear: 2025, year: 1, week: 5, ...over });
const now = (s) => absoluteWeek(s.year, s.week);
// A rival flying ten A380s with three more on order.
const rival = (s) => ({
  id: 'rv', name: 'Rival Air', homeHub: 'ORD', tier: 'premium', cash: 1e9, routes: {},
  fleet: Array.from({ length: 10 }, (_, i) => ({ id: `rv-t${i}`, typeId: 'a380', routeKey: 'ORD-LHR' })),
  linePlans: [{ id: 'rv-p1', kind: 'launch', routeKey: 'ORD-NRT', typeId: 'a380', lineId: 'a380',
                weeks: [now(s) + 10, now(s) + 15, now(s) + 20], cfg: { frequency: 7, aircraftType: 'a380', seats: 500, priceMultiplier: 1 } }],
});

console.log('\n── market');

test('every game: the card shows world totals and who flies it', () => {
  const s = base();
  seedSave({ ...s, competitors: [rival(s)], fleet: [{ id: 'f1', typeId: 'a380', status: 'idle', ownershipType: 'owned' }] });
  const card = cardOf(render(React.createElement(Marketplace)), 'Airbus A380');
  assert.match(card, /World: 11 flying · 3 on order · 2 airlines/);
  assert.match(card, /Rival Air 10 flying · 3 on order/);
  assert.doesNotMatch(card, /line ·/, 'no production line in a classic game');
});

test('production-line game: the card shows the shared line and the list-price slot', () => {
  seedSave(lines());
  const card = cardOf(render(React.createElement(Marketplace)), 'Boeing 737-800');
  assert.match(card, /Boeing 737NG line · 8\/wk/);
  assert.match(card, /Delivery in 6 weeks at list price/);
  assert.match(card, /earliest 3w at \+25%/);
});

test("rivals' orders push the list-price slot back", () => {
  const s = lines();
  const std = now(s) + 6;
  const full = { id: 'rv2', name: 'Busy Air', homeHub: 'ORD', tier: 'legacy', cash: 1e9, routes: {}, fleet: [],
    linePlans: [{ id: 'x', kind: 'launch', routeKey: 'ORD-MIA', typeId: 'b737800', lineId: 'b737ng', weeks: Array(8).fill(std), cfg: {} }] };
  seedSave({ ...s, competitors: [full] });
  const card = cardOf(render(React.createElement(Marketplace)), 'Boeing 737-800');
  assert.match(card, /Delivery in 7 weeks at list price/);
  assert.match(card, /World: 0 flying · 8 on order · 1 airline/);
});

test('an announced type is offered to launch customers, buy only', () => {
  seedSave(era());
  const card = cardOf(render(React.createElement(Marketplace)), 'Boeing 777X-9');
  assert.match(card, /Launch customers wanted/);
  assert.match(card, /at least 20/);
  assert.match(card, /Launch order →/);
  assert.match(card, /Launch customers buy outright/);
});

test('the table view has world fleet and world order columns', () => {
  store.set('market_layout', 'table');
  const s = base();
  seedSave({ ...s, competitors: [rival(s)] });
  const html = text(render(React.createElement(Marketplace)));
  store.delete('market_layout');
  assert.match(html, /World fleet/);
  assert.match(html, /World orders/);
});

console.log('\n── order cards quote what cancelling pays');

const card = (order, linesWorld, absWeek) => text(renderToString(React.createElement(OrderCard, {
  order, currentAbsWeek: absWeek, onCancel: () => {}, onRename: () => {}, linesWorld,
})));

test('a launch order is firm; a line order shows refund and forfeit', () => {
  const s0 = era();
  const s1 = gameReducer(s0, { type: 'ORDER_AIRCRAFT', typeId: 'b7779x', quantity: 20, ownershipType: 'owned' });
  const launch = s1.pendingOrders[0];
  assert.match(card(launch, true, now(s1)), /Firm order: cannot be cancelled/);
  assert.match(card(launch, true, now(s1)), /Launch customer · firm/);
  const s2 = gameReducer(lines(), { type: 'ORDER_AIRCRAFT', typeId: 'b737800', quantity: 1, ownershipType: 'owned', slotFromWeek: now(lines()) + 3 });
  const o = s2.pendingOrders[0];
  const c = card(o, true, now(s2));
  assert.match(c, /Early slot \+ ?\$/);
  assert.match(c, /back, \$[\d.,]+[KMB]? forfeit/);
});

console.log('\n── checkout agrees with the reducer');

function checkoutAndOrder(save, typeId, mode = 'buy', quantity = 1) {
  seedSave(save);
  const html = text(render(React.createElement(AircraftCheckout, { typeId, mode, onClose: () => {} })));
  const after = gameReducer(save, { type: 'ORDER_AIRCRAFT', typeId, quantity, ownershipType: mode === 'buy' ? 'owned' : 'lease' });
  return { html, placed: after.pendingOrders.slice(save.pendingOrders.length), paid: save.cash - after.cash };
}

test('standard slot: the quoted first delivery is the week the reducer books', () => {
  const s = lines();
  const { html, placed } = checkoutAndOrder(s, 'b737800');
  const weeks = placed[0].deliverAbsWeek - now(s);
  assert.match(html, new RegExp(`First delivery in ${weeks}w`));
  assert.match(html, /737NG line · 8 aircraft a week/);
  assert.match(html, /3w \+25%/);
  assert.match(html, /6w list/);
});

test("a rival's orders move the checkout's first delivery exactly as they move the reducer's", () => {
  const s = lines();
  const std = now(s) + 6;
  const busy = { id: 'rv3', name: 'Busy Air', homeHub: 'ORD', tier: 'legacy', cash: 1e9, routes: {}, fleet: [],
    linePlans: [{ id: 'y', kind: 'launch', routeKey: 'ORD-MIA', typeId: 'b737800', lineId: 'b737ng', weeks: [...Array(8).fill(std), ...Array(8).fill(std + 1)], cfg: {} }] };
  const { html, placed } = checkoutAndOrder({ ...s, competitors: [busy] }, 'b737800');
  assert.equal(placed[0].deliverAbsWeek, std + 2);
  assert.match(html, /First delivery in 8w/);
});

test('launch checkout: 20 aircraft, from January of the EIS year, at the reducer price', () => {
  const s = era();
  const { html, placed, paid } = checkoutAndOrder(s, 'b7779x', 'buy', 20);
  assert.equal(placed.length, 20);
  assert.match(html, /Launch order\./);
  assert.match(html, /Launch orders are firm/);
  const first = placed[0].deliverAbsWeek - now(s);
  assert.match(html, new RegExp(`first in ${first}w`));
  const total = html.match(/Total \(20 aircraft\) \$([\d.,]+)([KMB])/);
  assert.ok(total, 'order total shown');
  const unit = { K: 1e3, M: 1e6, B: 1e9 }[total[2]];
  const shown = Number(total[1].replace(/,/g, '')) * unit;
  assert.ok(Math.abs(shown - paid) / paid < 0.01, `checkout says ${shown}, reducer charged ${paid}`);
});

test('staged payments on a line: due at signing matches what the reducer takes', () => {
  const s = lines({ orderBook: true });
  const { html, paid } = checkoutAndOrder(s, 'b737800');
  const due = html.match(/Due at signing \$([\d.,]+)([KMB])/);
  assert.ok(due, 'signing payment shown');
  const shown = Number(due[1].replace(/,/g, '')) * { K: 1e3, M: 1e6, B: 1e9 }[due[2]];
  assert.ok(Math.abs(shown - paid) / paid < 0.01, `checkout says ${shown}, reducer took ${paid}`);
});

console.log('\n── new game');

test('the setup screen offers production lines, on by default', () => {
  const html = text(renderToString(React.createElement(GameProvider, null, React.createElement(SetupScreen))));
  assert.match(html, /Production lines/);
  assert.match(html, /factory lines you share with your rivals/);
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
