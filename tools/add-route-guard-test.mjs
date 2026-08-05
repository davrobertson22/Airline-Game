// Regression test for the Network → Planner "Open Route" dead click.
//
// Reported by a player: with no gate leased at the destination, clicking
// "Open Route with <tail>" did nothing at all — the ADD_ROUTE reducer hit
// `if (!(gates[destination] > 0)) return state;` and returned the same state
// object, so React re-rendered nothing and the button looked broken.
//
// The fix moved every ADD_ROUTE rejection into addRouteBlockReason(), which the
// reducer now calls as its single gate and the planner calls before dispatching
// so it can explain the blocker. This test pins both halves:
//   1. addRouteBlockReason names each blocker in player-facing language.
//   2. The reducer still accepts/rejects exactly what it did before, i.e. a
//      non-null reason ⇒ state is unchanged, a null reason ⇒ the route opens.
//
//   node --import ./tools/_register-loader.mjs tools/add-route-guard-test.mjs

import assert from 'node:assert/strict';
import { getAircraftType } from '../src/data/aircraft.js';
import { SLOTS_PER_GATE, routeDistanceKm } from '../src/utils/simulation.js';
import { routeLaunchCost } from '../src/data/overhead.js';

const { gameReducer, addRouteBlockReason } = await import('../src/store/GameContext.jsx');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.log(`  ✗ ${name}\n      ${(e.stack || e.message).split('\n').slice(0, 5).join('\n      ')}`); failed++; }
}

// ── Fixture: a short domestic lane, one narrowbody, gates at both ends ───────
const ORIGIN = 'AMS', DEST = 'LHR';
const TYPE   = getAircraftType('a320neo') ?? getAircraftType('b737max8');
assert.ok(TYPE, 'fixture needs a narrowbody type');

function baseState(over = {}) {
  return {
    week: 1,
    cash: 50_000_000,
    hub: ORIGIN,
    hubs: { [ORIGIN]: { tier: 1 } },
    airlineName: 'Test Air',
    fleet: [{ id: 'ac1', typeId: TYPE.id, tailNumber: 'PH-TST', status: 'idle', ageWeeks: 0, reserveBase: null }],
    routes: [],
    cargoRoutes: [],
    gates: { [ORIGIN]: 2, [DEST]: 2 },
    routePricing: {},
    routeCatering: {},
    competitors: [],
    activeEvents: [],
    ...over,
  };
}

const addRoute = (over = {}) => ({
  type: 'ADD_ROUTE',
  origin: ORIGIN, destination: DEST,
  aircraftId: 'ac1', weeklyFrequency: 7,
  ticketPrice: 180, cateringLevel: 'standard', season: null,
  ...over,
});

console.log('\n── ADD_ROUTE guard ──────────────────────────────────────\n');

test('a fully-provisioned route has no blocker and opens', () => {
  const s = baseState();
  assert.equal(addRouteBlockReason(s, addRoute()), null);
  const next = gameReducer(s, addRoute());
  assert.notEqual(next, s, 'reducer returned the same state object');
  assert.equal(next.routes.length, 1);
  assert.equal(next.cash, s.cash - routeLaunchCost(routeDistanceKm(ORIGIN, DEST)));
});

// ── The reported bug ─────────────────────────────────────────────────────────
test('no gate at the DESTINATION is reported, not swallowed', () => {
  const s = baseState({ gates: { [ORIGIN]: 2 } });
  const reason = addRouteBlockReason(s, addRoute());
  assert.ok(reason, 'expected a reason — this is the dead-click bug');
  assert.match(reason, new RegExp(DEST), 'reason must name the airport at fault');
  assert.match(reason, /gate/i);
  assert.equal(gameReducer(s, addRoute()), s, 'reducer must still reject it');
});

test('no gate at the ORIGIN is reported too', () => {
  const s = baseState({ gates: { [DEST]: 2 } });
  const reason = addRouteBlockReason(s, addRoute());
  assert.ok(reason);
  assert.match(reason, new RegExp(ORIGIN));
  assert.match(reason, /gate/i);
});

test('running out of gate SLOTS is reported with the numbers', () => {
  // One gate = SLOTS_PER_GATE departures/wk. Fill all but two, then ask for 7.
  const used = SLOTS_PER_GATE - 2;
  const s = baseState({
    gates: { [ORIGIN]: 4, [DEST]: 1 },
    fleet: [
      { id: 'ac1', typeId: TYPE.id, tailNumber: 'PH-TST', status: 'idle', ageWeeks: 0, reserveBase: null },
      { id: 'ac2', typeId: TYPE.id, tailNumber: 'PH-OLD', status: 'assigned', ageWeeks: 0, reserveBase: null },
    ],
    routes: [{ id: 'r0', origin: DEST, destination: ORIGIN, stops: [DEST, ORIGIN], aircraftId: 'ac2', weeklyFrequency: used, weeksOpen: 10, season: null, seasonState: 'active', hub: ORIGIN }],
  });
  const reason = addRouteBlockReason(s, addRoute());
  assert.ok(reason, 'expected a slot blocker');
  assert.match(reason, /slot/i);
  assert.match(reason, new RegExp(String(used)), 'reason should show slots in use');
  assert.equal(gameReducer(s, addRoute()), s);
});

test('insufficient cash is reported', () => {
  const s = baseState({ cash: 1 });
  const reason = addRouteBlockReason(s, addRoute());
  assert.ok(reason);
  assert.match(reason, /cash/i);
  assert.equal(gameReducer(s, addRoute()), s);
});

test('an aircraft that serves neither endpoint is reported (no teleporting)', () => {
  const far = 'JFK';
  const s = baseState({
    gates: { [ORIGIN]: 2, [DEST]: 2, [far]: 2 },
    routes: [{ id: 'r0', origin: far, destination: 'LAX', stops: [far, 'LAX'], aircraftId: 'ac1', weeklyFrequency: 3, weeksOpen: 5, season: null, seasonState: 'active', hub: ORIGIN }],
  });
  const reason = addRouteBlockReason(s, addRoute());
  assert.ok(reason);
  assert.match(reason, /network|serve/i);
});

test('a lane beyond the aircraft\'s range is reported with both distances', () => {
  const s = baseState({ gates: { [ORIGIN]: 2, SYD: 2 } });
  const a = addRoute({ destination: 'SYD' });
  const reason = addRouteBlockReason(s, a);
  assert.ok(reason, 'AMS–SYD is far beyond a narrowbody');
  assert.match(reason, /range|reach/i);
  assert.equal(gameReducer(s, a), s);
});

// Merging extra frequency onto an identical route stays free — the guard must not
// invent a cash requirement where the reducer never had one.
test('adding frequency to an identical existing route needs no launch cash', () => {
  const s0 = baseState();
  const s1 = gameReducer(s0, addRoute());
  const poor = { ...s1, cash: 0 };
  assert.equal(addRouteBlockReason(poor, addRoute({ weeklyFrequency: 1 })), null);
  const s2 = gameReducer(poor, addRoute({ weeklyFrequency: 1 }));
  assert.equal(s2.routes.length, 1, 'should merge, not add a second route');
  assert.equal(s2.routes[0].weeklyFrequency, 8);
  assert.equal(s2.cash, 0, 'merging must not charge a launch cost');
});

test('every rejection the reducer makes now carries a reason', () => {
  // Sweep the blocker space: for each broken state, a non-null reason and an
  // unchanged state must go together. No silent no-ops left.
  const cases = [
    baseState({ gates: { [ORIGIN]: 2 } }),
    baseState({ gates: { [DEST]: 2 } }),
    baseState({ gates: {} }),
    baseState({ cash: 0 }),
    baseState({ fleet: [] }),
  ];
  for (const s of cases) {
    const reason = addRouteBlockReason(s, addRoute());
    const next   = gameReducer(s, addRoute());
    assert.ok(reason, 'a rejected route with no reason string');
    assert.equal(next, s, `reason "${reason}" but the reducer accepted the route`);
    assert.ok(reason.length > 10, `reason too terse to help a player: "${reason}"`);
  }
});

console.log(`\n  ${passed} passed, ${failed} failed\n`);
process.exit(failed ? 1 : 0);
