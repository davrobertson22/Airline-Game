// Charter contracts, package 5: the Charters page.
//
// Server-renders the REAL component against a seeded save. Two jobs:
//
//   1. It renders at all — the board, the quote panel and the contract cards go
//      through simulateCharter, blockHourFit and the acceptance guard for every
//      tail in the fleet, so a render-time crash here is a crash in play.
//
//   2. It does not give the game away. The page's one rule (see the header of
//      Charters.jsx) is that it never tells the player whether a contract is
//      worth taking: it costs the mission for the tail you pick and stops.
//      The offer object carries `margin` and `isTrap` for the tests, and those
//      must never reach the DOM — a "trap" badge, a profit figure or a
//      recommendation would delete the entire feature.
//
//   node --import ./tools/_register-loader.mjs tools/charter-ui-test.mjs

import assert from 'node:assert/strict';
import fs from 'node:fs';
import React from 'react';
import { renderToString } from 'react-dom/server';
import { getAircraftType } from '../src/data/aircraft.js';
import { generateCharterBoard } from '../src/models/charterBoard.js';
import { CHARTER_RELIABILITY_START } from '../src/data/charters.js';

const store = new Map();
globalThis.window = globalThis.window ?? {};
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
  clear: () => store.clear(),
};

const { GameProvider, freshState } = await import('../src/store/GameContext.jsx');
const Charters = (await import('../src/components/Charters.jsx')).default;

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.log(`  ✗ ${name}\n      ${(e.stack || e.message).split('\n').slice(0, 4).join('\n      ')}`); failed++; }
}

const TYPE = 'b737max8200';
const jet = getAircraftType(TYPE);

const tail = (id, over = {}) => ({
  id, typeId: TYPE, name: id, tailNumber: `N${id}`, status: 'idle',
  ageWeeks: 52, ownershipType: 'owned', fuelMod: 1.0,
  config: { economy: jet.seats }, ...over,
});

function save(over = {}) {
  return {
    ...freshState(),
    phase: 'playing', week: 30, year: 1,
    airlineName: 'Charter UI Air', hub: 'SFO', homeCountry: 'US',
    cash: 40_000_000,
    gates: { SFO: 6, LAX: 3 },
    hubs: { SFO: { tier: 2 } },
    awareness: 65,
    fuelPrice: { index: 1.0, history: [] },
    lastReport: { reputationScore: 60 },
    fleet: [tail('ac1'), tail('ac2')],
    routes: [], cargoRoutes: [], charters: [],
    charterDismissed: [], charterReliability: CHARTER_RELIABILITY_START,
    ...over,
  };
}

function render(state) {
  store.set('bbae_save_v2', JSON.stringify(state));
  return renderToString(React.createElement(GameProvider, null, React.createElement(Charters)));
}

const contract = (over = {}) => ({
  id: 'c1', charter: true, offerId: 'chtr-0-0-aaa',
  templateId: 'series_leisure', type: 'series', name: 'Tour operator series',
  icon: '🏖️', color: '#f5a623', customer: 'a package holiday group',
  origin: 'SFO', destination: 'LAX', stops: ['SFO', 'LAX'],
  aircraftId: 'ac1', weeklyFrequency: 3, distanceKm: 543,
  seatsRequired: 160, tonnesRequired: null, freighter: false,
  fee: 1_200_000, feePerWeek: 150_000,
  weeksTotal: 8, weeksRemaining: 5,
  startWeek: 27, positioningWeeksRemaining: 0, positionFrom: null,
  ferryCost: 0, ferryKm: 0, permitsPaid: 0,
  originServed: true, destServed: true,
  status: 'active', breachPenalty: 420_000, reputationStake: 4,
  ...over,
});

// ── 1. It renders ────────────────────────────────────────────────────────────

test('the page renders the offer board', () => {
  const st = save();
  const board = generateCharterBoard(st, 30);
  assert.ok(board.length > 0, 'fixture produced an empty board');
  const html = render(st);
  assert.ok(html.includes('Offer board'));
  assert.ok(html.includes('Contracts running'));
  // Every offer's lane is on the page.
  for (const o of board) {
    assert.ok(html.includes(o.origin), `offer origin ${o.origin} is missing`);
  }
});

test('an offer shows the fee, the term and what it costs to walk away', () => {
  const st = save();
  const html = render(st);
  assert.match(html, /fixed/, 'the fee is not described as fixed');
  assert.match(html, /Term/);
  assert.match(html, /If you walk away/);
  assert.match(html, /Offer closes/);
});

test('a running contract renders with its clock and its aeroplane', () => {
  const html = render(save({ charters: [contract()], fleet: [tail('ac1', { status: 'assigned' }), tail('ac2')] }));
  assert.ok(html.includes('5 of 8 wks left'));
  assert.ok(html.includes('Nac1'), 'the contract does not name the tail flying it');
  assert.ok(html.includes('Break contract'));
});

test('a positioning contract says so', () => {
  const html = render(save({
    charters: [contract({ status: 'positioning', positioningWeeksRemaining: 1, positionFrom: 'LAX' })],
  }));
  assert.ok(html.includes('POSITIONING'));
});

test('an empty board explains itself instead of rendering nothing', () => {
  // A brand-new airline nobody has heard of: awareness gates the board.
  const html = render(save({ awareness: 0, lastReport: { reputationScore: 0 }, charterReliability: 0, fleet: [] }));
  assert.ok(html.includes('Offer board'));
  assert.ok(html.includes('You are not flying any charter contracts.'));
});

// ── 2. It does not give the game away ────────────────────────────────────────

test('the page never shows the margin or flags a trap', () => {
  const st = save();
  const board = generateCharterBoard(st, 30);
  const html = render(st);
  assert.ok(!/isTrap|TRAP|\btrap\b/i.test(html), 'the page flagged a trap contract');
  for (const o of board) {
    // The raw margin figure, e.g. "1.2955", must not appear anywhere.
    assert.ok(!html.includes(String(o.margin)), `offer ${o.id} leaked its margin ${o.margin}`);
    assert.ok(!html.includes(o.refTypeId) || o.refTypeId === TYPE,
      `the page named the reference operator (${o.refTypeId}) the fee was priced against`);
  }
});

test('the page offers no verdict, recommendation or profit figure', () => {
  const html = render(save());
  for (const word of ['Recommended', 'recommended', 'Profitable', 'Expected profit',
                      'Best value', 'Good deal', 'Bad deal', 'Avoid']) {
    assert.ok(!html.includes(word), `the page told the player what to think: "${word}"`);
  }
});

test('the quote is explicit that it is flying cost only', () => {
  // The disclaimer is what keeps the page honest about what it has NOT costed.
  const src = fs.readFileSync(new URL('../src/components/Charters.jsx', import.meta.url), 'utf8');
  assert.match(src, /Flying cost only/);
  assert.match(src, /would earn on your schedule/);
});

// ── 3. Warnings the player must not miss ─────────────────────────────────────

test('a contract whose aeroplane is grounded with no cover warns about the breach', () => {
  const html = render(save({
    charters: [contract()],
    fleet: [tail('ac1', { status: 'grounded', groundedWeeksLeft: 3, groundedReason: 'aog' })],
  }));
  assert.ok(html.includes('is out of service and no same-type'), 'no breach warning on an at-risk contract');
  assert.ok(html.includes('420'), 'the warning does not quantify the penalty');
});

test('a grounded aeroplane with a reserve standing by does NOT cry wolf', () => {
  const html = render(save({
    charters: [contract()],
    fleet: [
      tail('ac1', { status: 'grounded', groundedWeeksLeft: 3, groundedReason: 'aog' }),
      tail('spare', { reserveBase: 'SFO' }),
    ],
  }));
  assert.ok(!html.includes('is out of service and no same-type'),
    'warned about a breach that a stationed reserve will cover');
});

test('a reserve in the fleet is labelled as one in the aircraft picker', () => {
  // reserveOptionTag is plain text because <option> cannot hold markup.
  const html = render(save({ fleet: [tail('ac1'), tail('spare', { reserveBase: 'SFO' })] }));
  assert.ok(html.includes('ON RESERVE @ SFO'),
    'the picker offers a stationed reserve without saying so');
});

test('an aircraft that cannot fly a contract is offered with the reason attached', () => {
  // The guard's reason is what turns a greyed-out option into an explanation.
  const html = render(save({
    fleet: [tail('tiny', { typeId: 'atr72600', config: { economy: 70 } })],
  }));
  assert.ok(/seats|range|runway|freighter/i.test(html),
    'an ineligible aircraft was listed with no reason given');
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
