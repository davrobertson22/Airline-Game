// "Reserve aircraft should take over during C checks" (Discord: djak2103,
// VodkaOnFire, 2026-11-16). Screenshot: "In C check — 1 week remaining" over
// "Back in service next week — … no reserve is dispatched." Read together they
// say the airline loses a week and the reserve sits it out.
//
// It doesn't. tickPrep runs the downtime countdown BEFORE the revenue sim, so a
// tail with one week left is back in service when next week is flown: a 1-week
// C check costs no flying at all, and a k-week check misses k−1 weeks, every one
// of them coverable from the first. These tests hold the panel copy to the tick:
// run ADVANCE_WEEK and check what the panel promised actually happened.
//
//   node --import ./tools/_register-loader.mjs tools/check-cover-copy-test.mjs (ported from Headwinds)

import assert from 'node:assert/strict';
import React from 'react';
import { renderToString } from 'react-dom/server';

let _rng = 0;
Math.random = () => 0.90 + ((_rng++ % 97) / 1000);

const store = new Map();
globalThis.window = globalThis.window ?? {};
globalThis.localStorage = {
  getItem: k => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: k => store.delete(k),
  clear: () => store.clear(),
  key: i => [...store.keys()][i] ?? null,
  get length() { return store.size; },
};

const { GameProvider, freshState, gameReducer } = await import('../src/store/GameContext.jsx');
const { AircraftDetail } = await import('../src/components/Fleet.jsx');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.log(`  ✗ ${name}\n      ${(e.stack || e.message).split('\n').slice(0, 4).join('\n      ')}`); failed++; }
}

const find = (s, id) => s.fleet.find(a => a.id === id);

function rig({ reserve = true } = {}) {
  let s = gameReducer(freshState(), { type: 'START_GAME', airlineName: 'RSV', hub: 'JFK', enableObjectives: false });
  s = { ...s, cash: 500_000_000 };
  s = gameReducer(s, { type: 'BUY_AIRCRAFT', typeId: 'crj200' }); const a = s.fleet.at(-1).id;
  s = gameReducer(s, { type: 'BUY_AIRCRAFT', typeId: 'crj200' }); const b = s.fleet.at(-1).id;
  s = gameReducer(s, { type: 'ADD_GATE', airportCode: 'ORD' });
  s = gameReducer(s, { type: 'ADD_ROUTE', aircraftId: a, origin: 'JFK', destination: 'ORD', weeklyFrequency: 7 });
  if (reserve) s = gameReducer(s, { type: 'SET_RESERVE', aircraftId: b, baseCode: 'JFK' });
  s = gameReducer(s, { type: 'ADVANCE_WEEK' });
  return { s, a, b };
}

function panel(s, id) {
  store.set('bbae_save_v2', JSON.stringify(s));
  const noop = () => {};
  return renderToString(React.createElement(GameProvider, null,
    React.createElement(AircraftDetail, { aircraft: find(s, id), onClose: noop, onConfigure: noop, onRetire: noop, onSell: noop })))
    .replace(/<!-- -->/g, '').replace(/&#x27;/g, "'");
}

const routeRev = (s) => s.financialHistory.at(-1)?.routeRevenues?.[s.routes[0].id] ?? 0;

test('a 1-week C check says no flying is lost — and the tick agrees', () => {
  let { s, a } = rig();
  // Control: the same airline with no check. Route revenue drifts week to week
  // in Tailwinds, so compare like weeks rather than against last week.
  const control = gameReducer(rig().s, { type: 'ADVANCE_WEEK' });
  s = gameReducer(s, { type: 'SCHEDULE_CHECK', aircraftId: a, checkType: 'C', startNow: true });
  assert.equal(find(s, a).status, 'maintenance');
  assert.equal(find(s, a).checkWeeksLeft, 1, 'rig assumes a 1-week CRJ C check');
  const html = panel(s, a);
  assert.ok(!html.includes('1 week remaining'), 'panel still reads "1 week remaining", which players take as a lost week');
  assert.ok(!html.includes('no reserve is dispatched'), 'panel still reads as if the reserve skips the check');
  assert.ok(html.includes("finishes before next week's flights"), 'panel should say the check is done before next week is flown');
  assert.ok(html.includes('no flying is lost'), 'reserve-cover line should say nothing is lost');
  s = gameReducer(s, { type: 'ADVANCE_WEEK' });
  assert.equal(s.routes[0].aircraftId, a, 'the aircraft flies its own route the week after a 1-week check');
  assert.ok(routeRev(s) > 0 && routeRev(s) === routeRev(control), `route earned ${routeRev(s)} vs ${routeRev(control)} with no check`);
});

test('a 3-week D check counts 2 missed weeks — and the reserve flies both', () => {
  let { s, a, b } = rig();
  let control = rig().s;
  s = gameReducer(s, { type: 'SCHEDULE_CHECK', aircraftId: a, checkType: 'D', startNow: true });
  const left = find(s, a).checkWeeksLeft;
  assert.equal(left, 3, 'rig assumes a 3-week CRJ D check');
  const html = panel(s, a);
  assert.ok(html.includes('it misses 2 weeks of flying'), 'panel should count the weeks actually missed');
  assert.ok(html.includes('first week this aircraft would miss'), 'reserve line should say cover starts on the first missed week');
  let covered = 0;
  for (let i = 0; i < left; i++) {
    s = gameReducer(s, { type: 'ADVANCE_WEEK' });
    control = gameReducer(control, { type: 'ADVANCE_WEEK' });
    if (s.routes[0].aircraftId === b) covered++;
    assert.equal(routeRev(s), routeRev(control), `week ${i + 1}: route earned ${routeRev(s)} vs ${routeRev(control)} with no check`);
  }
  assert.equal(covered, 2, 'the reserve covers exactly the two missed weeks');
  assert.equal(s.routes[0].aircraftId, a, 'and hands the route back after');
});

console.log(`\n  ${passed} passed, ${failed} failed\n`);
process.exit(failed === 0 ? 0 : 1);
