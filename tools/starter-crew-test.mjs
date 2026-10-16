// A new airline flies its first aircraft — and is told plainly when it can't.
//
// Discord 2026-09-21 (EpicLimaBean44): "So I've made like 6 routes in Tailwinds,
// and in the routes page it shows profits, but for some reason I'm just not
// flying any passengers?" A crew-pipeline game starts with nobody on the
// payroll. Every aircraft sat on the ramp (tickPrep parks tails with no crew),
// no toast or Dashboard alert said so, and the Routes screen fell back to a
// standalone projection of what the routes WOULD earn.
//
// Pinned here:
//   1. the first aircraft are crewed for you (starter floor, normal cost, toast)
//   2. past the starter floor, crew are still yours to hire
//   3. a week with crew-grounded, routed aircraft ends with a toast
//   4. the Dashboard alert and the Routes screen say "no crew", not a profit
//
//   node --import ./tools/_register-loader.mjs tools/starter-crew-test.mjs
import assert from 'node:assert/strict';
import React from 'react';
import { renderToString } from 'react-dom/server';
import { getAircraftType } from '../src/data/aircraft.js';
import {
  starterCrewTopUp, starterCrewFloor, crewHireCost, CREW_INSTANT_AIRCRAFT, LABOR_GROUPS,
} from '../src/data/labor.js';
import { crewGroundedAircraftIds } from '../src/utils/tickPrep.js';

Math.random = () => 0.5;

const store = new Map();
globalThis.window = globalThis.window ?? {};
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
  clear: () => store.clear(),
};

let passed = 0, failed = 0;
const t = (name, fn) => {
  try { fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.log(`  ✗ ${name}\n      ${(e.stack || e.message).split('\n').slice(0, 3).join('\n      ')}`); failed++; }
};

const { gameReducer, GameProvider } = await import('../src/store/GameContext.jsx');
const Dashboard = (await import('../src/components/Dashboard.jsx')).default;
const Routes    = (await import('../src/components/Routes.jsx')).default;
const render = (el) => renderToString(React.createElement(GameProvider, null, el)).replaceAll('<!-- -->', '');

const typeOf = (a) => getAircraftType(a.typeId);
const DESTS = ['SFO', 'LAS', 'PHX', 'SAN', 'SEA', 'DEN'];

function newAirline() {
  return gameReducer({}, { type: 'START_GAME', airlineName: 'Lima Air', hub: 'LAX' });
}
function lease(s, n) {
  for (let i = 0; i < n; i++) {
    s = gameReducer(s, { type: 'LEASE_AIRCRAFT', typeId: 'a320neo' });
    // Ids come from the clock; two leases in one millisecond collide.
    const last = s.fleet.length - 1;
    s = { ...s, fleet: s.fleet.map((a, j) => j === last ? { ...a, id: `ac${last}` } : a) };
  }
  return s;
}
function openRoutes(s) {
  s = { ...s, gates: { LAX: 8, ...Object.fromEntries(DESTS.map(d => [d, 2])) } };
  s.fleet.forEach((a, i) => {
    s = gameReducer(s, { type: 'ADD_ROUTE', origin: 'LAX', destination: DESTS[i], aircraftId: a.id, weeklyFrequency: 14 });
  });
  return s;
}
const heads = (s) => Object.fromEntries(LABOR_GROUPS.map(g => [g.id, s.labor[g.id].headcount]));

console.log('\n── Starter crew: the first aircraft fly ───────────────────');

t('a new game still starts with nobody on the payroll', () => {
  const s = newAirline();
  assert.equal(s.crewPipeline, true);
  for (const g of LABOR_GROUPS) assert.equal(s.labor[g.id].headcount, 0, g.id);
});

t('the first aircraft arrives with its crew, paid for, and a toast says so', () => {
  const s0 = newAirline();
  const s1 = lease(s0, 1);
  for (const g of LABOR_GROUPS) {
    assert.ok(s1.labor[g.id].headcount >= starterCrewFloor(g.id, s1.fleet, typeOf) - 1e-9, `${g.id} under the floor`);
  }
  const toast = s1.pendingToasts.find(x => /Starter crew hired/.test(x.title ?? ''));
  assert.ok(toast, 'no starter-crew toast');
  assert.match(toast.message, /Company ▸ Operations/);
  assert.equal(crewGroundedAircraftIds(s1).length, 0, 'the first aircraft is grounded');
});

t('the crew are charged at the normal training rate', () => {
  const s0 = lease(newAirline(), 0);
  const { hires, cost } = starterCrewTopUp(s0.labor, [{ id: 'x', typeId: 'a320neo' }], typeOf);
  assert.equal(cost, Object.entries(hires).reduce((s, [id, u]) => s + crewHireCost(id, u), 0));
  assert.ok(cost > 0);
});

t('hires whole people, not whole crews: two A320neos do not buy a third crew', () => {
  const s = lease(newAirline(), 2);
  for (const g of LABOR_GROUPS) {
    const floor = starterCrewFloor(g.id, s.fleet, typeOf);
    assert.ok(s.labor[g.id].headcount - floor < 0.5, `${g.id}: ${s.labor[g.id].headcount} for a floor of ${floor}`);
  }
});

t(`only the first ${CREW_INSTANT_AIRCRAFT} are crewed for you; the rest are the player's to hire`, () => {
  const two = lease(newAirline(), 2);
  const six = lease(two, 4);
  assert.deepEqual(heads(six), heads(two), 'crew kept being hired past the starter floor');
  assert.equal(crewGroundedAircraftIds(six).length, 4);
});

t('the starter toast fires once, not for every aircraft', () => {
  let s = lease(newAirline(), 1);
  s = { ...s, pendingToasts: [] };
  s = lease(s, 1);
  assert.equal(s.pendingToasts.filter(x => /Starter crew hired/.test(x.title ?? '')).length, 0);
});

t('a save without the crew pipeline is untouched', () => {
  const s0 = { ...newAirline(), crewPipeline: undefined };
  const s1 = lease(s0, 1);
  assert.deepEqual(heads(s1), heads(s0));
});

t('a broke airline is not driven negative by the top-up', () => {
  const s = lease({ ...newAirline(), cash: 3_000_000 }, 1);
  assert.ok(s.cash >= 0, `cash ${s.cash}`);
});

console.log('\n── Grounded for crew: the player is told ───────────────────');

const SIX = openRoutes(lease(newAirline(), 6));

t('six routes open, four of them on aircraft nobody can fly', () => {
  assert.equal(SIX.routes.length, 6);
  assert.equal(crewGroundedAircraftIds(SIX).length, 4);
});

t('the week ends with a toast naming the grounded aircraft', () => {
  const s = gameReducer(SIX, { type: 'ADVANCE_WEEK' });
  const toast = s.pendingToasts.find(x => /grounded — no crew/.test(x.title ?? ''));
  assert.ok(toast, 'no grounded toast');
  assert.match(toast.title, /^4 aircraft/);
  assert.match(toast.message, /Company ▸ Operations/);
  assert.ok(s.lastReport.totalPassengers > 0, 'the crewed aircraft should still fly');
});

t('no toast when every routed aircraft has crew', () => {
  const two = openRoutes(lease(newAirline(), 2));
  const s = gameReducer(two, { type: 'ADVANCE_WEEK' });
  assert.equal(s.pendingToasts.filter(x => /grounded — no crew/.test(x.title ?? '')).length, 0);
});

t('the Dashboard leads with a no-crew alert linking to Operations', () => {
  store.set('bbae_save_v2', JSON.stringify(SIX));
  const html = render(React.createElement(Dashboard));
  assert.match(html, /4 aircraft grounded — no crew to fly them/);
});

t('the Routes screen badges every grounded pair "No crew"', () => {
  store.set('bbae_save_v2', JSON.stringify(SIX));
  const html = render(React.createElement(Routes));
  const badges = html.match(/No crew/g) ?? [];
  assert.ok(badges.length >= 4, `expected a No crew badge per grounded pair, saw ${badges.length}`);
});

t('a fully crewed airline shows neither', () => {
  const two = openRoutes(lease(newAirline(), 2));
  store.set('bbae_save_v2', JSON.stringify(two));
  assert.doesNotMatch(render(React.createElement(Dashboard)), /grounded — no crew/);
  assert.doesNotMatch(render(React.createElement(Routes)), /No crew/);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
