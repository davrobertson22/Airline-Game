// Lease a gate from the airport you tapped on the network map.
//
// Player feedback (Discord, Oct 2026), after every airport went onto the map:
//   "Could you add an option to open gates when tapping on a city? Right now,
//    you can only open lounges and more information."
// Tapping an airport opened its detail page — a Lounge card, a Ground Handling
// card, demand and competition — and no way to take a gate there, which is the
// one thing you need before you can fly to it. The lease lived only on the
// Airports tab. The detail page now has a "Lease a Gate" card (port of the
// Headwinds card, minus its gate-market half: single-player has no auctions),
// and your own airports on the map open the same page when tapped.
//
// The quote must be what the tick charges: gates are a monthly fee billed a
// quarter a week (weeklyTick §4), so the card's weekly figure is checked
// against weeklyTick's own totalGateFees before and after the lease.
//
//   node --import ./tools/_register-loader.mjs tools/map-airport-gates-test.mjs

import assert from 'node:assert/strict';
import React from 'react';
import { renderToString } from 'react-dom/server';

const store = new Map();
globalThis.window = globalThis.window ?? {};
globalThis.window.dispatchEvent = globalThis.window.dispatchEvent ?? (() => true);
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
  clear: () => store.clear(),
};

const AD = await import('../src/components/AirportDetail.jsx');
const AirportDetail = AD.default;
const { AirportDetailModal } = await import('../src/components/AirportLink.jsx');
const RM = await import('../src/components/RouteMap.jsx');
const RouteMap = RM.default;
const { getAirport, gateMonthlyFee, totalGateMonthlyFee } = await import('../src/data/airports.js');
const { formatMoney, SLOTS_PER_GATE, weeklyTick } = await import('../src/utils/simulation.js');
const { GameProvider, freshState, gameReducer } = await import('../src/store/GameContext.jsx');

let passed = 0, failed = 0;
const test = (name, fn) => {
  try {
    const out = fn();
    if (out && typeof out.then === 'function') throw new Error('test bodies must be synchronous');
    console.log(`  ✓ ${name}`); passed++;
  } catch (e) { console.log(`  ✗ ${name}\n      ${(e.stack || e.message).split('\n').slice(0, 4).join('\n      ')}`); failed++; }
};

const HUB = 'MAD', NEW = 'LIS';
const base = () => ({
  ...freshState(), phase: 'playing', week: 20, year: 2, hub: HUB, cash: 5e7,
  gates: { [HUB]: 3 }, fleet: [], routes: [], cargoRoutes: [],
});
const render = (save, el) => {
  store.set('bbae_save_v2', JSON.stringify(save));
  return renderToString(React.createElement(GameProvider, null, el)).replaceAll('<!-- -->', '');
};
const detail = (save, code) => render(save, React.createElement(AirportDetail, { code, onBack: () => {} }));

console.log('\n── 1. The detail page offers the gate ───────────────────');

test('an airport you have no gate at: a lease button with the first gate\'s fee', () => {
  const html = detail(base(), NEW);
  const fee = formatMoney(gateMonthlyFee(getAirport(NEW), 1));
  assert.ok(html.includes('Lease a Gate'), 'the card is there');
  assert.ok(html.includes(`+ Lease a gate here — ${fee}/mo`), `button quotes ${fee}/mo`);
  assert.ok(html.includes(`${SLOTS_PER_GATE} a week per gate`), 'says what a gate buys');
});

test('an airport you already hold gates at: "another gate" at the NEXT gate\'s fee, and what you pay now', () => {
  const html = detail(base(), HUB);
  const ap = getAirport(HUB);
  assert.ok(html.includes(`+ Lease another gate — ${formatMoney(gateMonthlyFee(ap, 4))}/mo`), 'gate 4, not gate 1');
  assert.ok(html.includes(`${formatMoney(totalGateMonthlyFee(ap, 3))}/mo`), 'the current bill for 3 gates');
  assert.ok(html.includes('You pay now'));
});

test('the card sits above the lounge — it is what you came for', () => {
  const html = detail(base(), NEW);
  const gate = html.indexOf('Lease a Gate'), lounge = html.indexOf('>Lounge<');
  assert.ok(gate >= 0 && lounge >= 0, 'both cards render');
  assert.ok(gate < lounge, 'gate card first');
});

test('the overlay the map opens carries it too', () => {
  const html = render(base(), React.createElement(AirportDetailModal, { code: NEW, onClose: () => {} }));
  assert.ok(html.includes('+ Lease a gate here'));
});

console.log('\n── 2. The quote is what the tick charges ────────────────');

test('leasing dispatches ADD_GATE for that airport, and the reducer takes it', () => {
  const s = base();
  const q = AD.gateLeaseQuote(s, NEW);
  assert.deepEqual(q.action, { type: 'ADD_GATE', airportCode: NEW });
  const after = gameReducer(s, q.action);
  assert.equal(after.gates[NEW], 1);
  assert.equal(after.gates[HUB], 3, 'other airports untouched');
});

for (const [code, label] of [[NEW, 'first gate'], [HUB, 'fourth gate at the hub']]) {
  test(`the weekly change quoted for the ${label} equals weeklyTick's gate bill change`, () => {
    const s = base();
    const q = AD.gateLeaseQuote(s, code);
    const before = weeklyTick(s).totalGateFees;
    const after  = weeklyTick(gameReducer(s, q.action)).totalGateFees;
    assert.equal(q.weeklyAfter - q.weeklyNow, after - before);
    assert.ok(q.weeklyAfter > q.weeklyNow);
    assert.equal(q.nextFee, gateMonthlyFee(getAirport(code), q.held + 1));
  });
}

console.log('\n── 3. The map says so, and your own airports open it ────');

test('a background airport\'s hover card mentions the gate', () => {
  const tip = RM.worldAirportTip(getAirport(NEW));
  assert.ok(/gate/i.test(tip) && /details/i.test(tip));
});

test('your own airports\' hover cards: name, place, hub badge, and the same hint', () => {
  const ap = getAirport(HUB);
  const hubTip = RM.networkAirportTip(ap, { name: 'Hub', tier: 1 });
  for (const s of [HUB, ap.city, 'HUB']) assert.ok(hubTip.includes(s), s);
  assert.ok(/gate/i.test(hubTip), 'tap hint');
  const spokeTip = RM.networkAirportTip(getAirport(NEW), null);
  assert.ok(spokeTip.includes(NEW) && /gate/i.test(spokeTip) && !spokeTip.includes('HUB'));
});

test('a new airline with no routes is told it can lease a gate from the map', () => {
  const html = render(base(), React.createElement(RouteMap));
  assert.ok(html.includes('every airport you can fly to is on the map'));
  assert.ok(/click one to lease a gate/i.test(html));
});

console.log('\n── 4. On a phone the page is one column ─────────────────');
// The page is a grid of 320px-minimum cards, and Passenger Flows asked for
// `span 2`. On a phone there is room for ONE column, so that span invented a
// second, implicit one: the whole page went two columns wide and every card in
// column two — the Lounge, Ground Handling — sat off the right edge of the
// screen. Found while checking this card in a 390px browser.

const asPhone = (on, fn) => {
  globalThis.window.matchMedia = (q) => ({ matches: on, media: q, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {} });
  try { return fn(); } finally { delete globalThis.window.matchMedia; }
};

test('phone: no card spans two columns, and a column never outgrows the screen', () => {
  const html = asPhone(true, () => detail(base(), NEW));
  assert.ok(!html.includes('grid-column:span 2'), 'span 2 adds an implicit column on a phone');
  assert.ok(html.includes('grid-column:1 / -1'), 'Passenger Flows spans the row it has');
  assert.ok(html.includes('minmax(min(320px, 100%), 1fr)'), 'a 308px-wide screen gets a 308px column, not 320');
});

test('desktop: Passenger Flows still spans two cards', () => {
  const html = asPhone(false, () => detail(base(), NEW));
  assert.ok(html.includes('grid-column:span 2'));
});

console.log(`\n${'─'.repeat(56)}`);
console.log(`  ${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
