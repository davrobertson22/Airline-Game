// Realistic utilisation: new games schedule each aircraft up to 100 block hours
// a week, not the classic 140.
//
// 140h/wk is 20 hours a day, every day — no airline flies an A321 or a 737 like
// that (a hard-run narrowbody does ~9-11h). Headwinds' New World Restrictions
// cap scheduling at 100h; this ports the same cap to Tailwinds, for games
// started from this update on. Saves from before it carry no flag and keep
// 140h for life.
//
// GRANDFATHERED, exactly as in Headwinds: the cap is enforced only when the
// player ADDS hours (a new route, a frequency increase, a swap onto a slower
// type, a charter). A tail already above it (an acquired rival's schedule)
// keeps flying and may only ratchet down.
//
//   node --import ./tools/_register-loader.mjs tools/utilization-cap-test.mjs

import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { getAircraftType } from '../src/data/aircraft.js';
import {
  maxWeeklyBlockHoursFor, MAX_WEEKLY_BLOCK_HOURS, NWR_MAX_WEEKLY_BLOCK_HOURS,
  maxFrequency, routeDistanceKm, routeBlockHours, deployableFleetForRoute,
} from '../src/utils/simulation.js';

const store = new Map();
globalThis.window = globalThis.window ?? {};
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
  clear: () => store.clear(),
};

const {
  gameReducer, freshState, addRouteBlockReason, frequencyChangeBlockReason, transferCompatibility,
} = await import('../src/store/GameContext.jsx');
const { planRouteBatch } = await import('../src/models/routeBatch.js');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.log(`  ✗ ${name}\n      ${(e.stack || e.message).split('\n').slice(0, 5).join('\n      ')}`); failed++; }
}

const ORIGIN = 'AMS', DEST = 'LHR';
const A321 = getAircraftType('a321neo');
// Slower per sector on a short hop: a widebody's 90-minute turn outweighs its speed.
const SLOW = getAircraftType('a330neo');
assert.ok(A321, 'fixture needs the A321neo');
const DIST = routeDistanceKm(ORIGIN, DEST);
const FREQ_100 = maxFrequency(DIST, A321, 100);
const FREQ_140 = maxFrequency(DIST, A321, 140);

function baseState(over = {}) {
  return {
    week: 1, year: 1,
    cash: 500_000_000,
    hub: ORIGIN,
    hubs: { [ORIGIN]: { tier: 1 } },
    airlineName: 'Test Air',
    fleet: [
      { id: 'ac1', typeId: A321.id, tailNumber: 'PH-AAA', status: 'idle', ageWeeks: 0, reserveBase: null },
      { id: 'ac2', typeId: A321.id, tailNumber: 'PH-BBB', status: 'idle', ageWeeks: 0, reserveBase: null },
      { id: 'ac3', typeId: SLOW.id, tailNumber: 'PH-CCC', status: 'idle', ageWeeks: 0, reserveBase: null },
    ],
    routes: [],
    cargoRoutes: [],
    gates: { [ORIGIN]: 8, [DEST]: 8 },
    routePricing: {}, routeCatering: {},
    competitors: [], activeEvents: [],
    ...over,
  };
}
const NEW  = (over) => baseState({ realisticUtilization: true, ...over });
const OLD  = (over) => baseState(over);
const addRoute = (over = {}) => ({
  type: 'ADD_ROUTE', origin: ORIGIN, destination: DEST,
  aircraftId: 'ac1', weeklyFrequency: 7, ticketPrice: 180, cateringLevel: 'standard', season: null,
  ...over,
});
const flying = (freq) => ({
  routes: [{ id: 'r1', origin: ORIGIN, destination: DEST, stops: [ORIGIN, DEST], aircraftId: 'ac1',
    weeklyFrequency: freq, weeksOpen: 60, hub: ORIGIN, season: null, seasonState: 'active' }],
});
const isHours = (why) => typeof why === 'string' && /hour/i.test(why);

console.log('\n── The cap in force ─────────────────────────────────────\n');

test('a new game schedules to 100h; a save without the flag keeps 140h', () => {
  assert.equal(NWR_MAX_WEEKLY_BLOCK_HOURS, 100);
  assert.equal(MAX_WEEKLY_BLOCK_HOURS, 140);
  assert.equal(maxWeeklyBlockHoursFor(NEW()), 100);
  assert.equal(maxWeeklyBlockHoursFor(OLD()), 140);
  assert.equal(maxWeeklyBlockHoursFor(null), 140);
});

test('the frequency ceiling follows the cap (A321neo, AMS–LHR)', () => {
  assert.ok(FREQ_100 < FREQ_140, `${FREQ_100} vs ${FREQ_140}`);
  assert.ok(routeBlockHours({ origin: ORIGIN, destination: DEST }, A321, FREQ_100) <= 100);
  assert.ok(routeBlockHours({ origin: ORIGIN, destination: DEST }, A321, FREQ_100 + 1) > 100);
});

console.log('\n── Adding hours is refused past 100h in a new game ──────\n');

test('ADD_ROUTE: fits at the 100h ceiling, refused one flight past it', () => {
  assert.equal(addRouteBlockReason(NEW(), addRoute({ weeklyFrequency: FREQ_100 })), null);
  const why = addRouteBlockReason(NEW(), addRoute({ weeklyFrequency: FREQ_100 + 1 }));
  assert.ok(isHours(why), `expected an hours refusal, got: ${why}`);
  assert.match(why, /100h limit/);
  const s = NEW();
  assert.equal(gameReducer(s, addRoute({ weeklyFrequency: FREQ_100 + 1 })).routes.length, 0);
});

test('ADD_ROUTE: an old save still accepts the same schedule on hours', () => {
  const why = addRouteBlockReason(OLD(), addRoute({ weeklyFrequency: FREQ_100 + 1 }));
  assert.ok(!isHours(why), `old save refused on hours: ${why}`);
});

test('frequency increase past 100h is refused in a new game, allowed in an old save', () => {
  const at = FREQ_100;
  assert.ok(isHours(frequencyChangeBlockReason(NEW(flying(at)), 'r1', at + 1)));
  assert.ok(!isHours(frequencyChangeBlockReason(OLD(flying(at)), 'r1', at + 1)));
});

console.log('\n── Grandfathered: a tail already over 100h ──────────────\n');

test('it can always come DOWN, never go up', () => {
  const over = FREQ_140 - 2;                       // ~130h: legal at 140, over 100
  const s = NEW(flying(over));
  assert.equal(frequencyChangeBlockReason(s, 'r1', over - 1), null, 'a reduction must be allowed');
  assert.ok(isHours(frequencyChangeBlockReason(s, 'r1', over + 1)), 'an increase must be refused');
});

test('it can move to an equal-speed tail, but not onto a slower type that grows its hours', () => {
  const s = NEW(flying(FREQ_140 - 2));
  assert.deepEqual(transferCompatibility(s, 'ac1', 'ac2'), { ok: true });
  assert.ok(SLOW, 'fixture needs the A330neo');
  const r = transferCompatibility(NEW(flying(FREQ_100)), 'ac1', 'ac3');
  assert.equal(r.ok, false, 'an A330 would need more than 100h for the A321\'s schedule');
  assert.match(r.reason, /block hours/);
});

console.log('\n── Planners read the same cap the reducer enforces ──────\n');

test('deployableFleetForRoute: a tail at 90h has no room for 20 more in a new game', () => {
  const s = NEW(flying(Math.floor(FREQ_100 * 0.9)));
  const args = { fleet: s.fleet, existingRoutes: s.routes, typeId: A321.id, origin: ORIGIN, dest: DEST,
    distKm: DIST, weeklyFrequency: 8 };
  const row100 = deployableFleetForRoute({ ...args, capHours: maxWeeklyBlockHoursFor(s) }).find(d => d.aircraft.id === 'ac1');
  const row140 = deployableFleetForRoute(args).find(d => d.aircraft.id === 'ac1');
  assert.equal(row100.hoursOk, false);
  assert.equal(row140.hoursOk, true);
  assert.ok(row100.spareBlockHrs < row140.spareBlockHrs);
});

test('planRouteBatch caps a pick at the game\'s own ceiling', () => {
  const plan = planRouteBatch(NEW(), [{ origin: ORIGIN, destination: DEST, typeId: A321.id, weeklyFrequency: 200 }]);
  assert.equal(plan.items[0].maxFrequency, FREQ_100);
});

test('no screen or reducer guard hard-codes the 140h figure', () => {
  const offenders = [];
  for (const dir of ['src/components', 'src/store', 'src/models']) {
    for (const f of readdirSync(dir)) {
      if (!/\.(jsx?|mjs)$/.test(f) || /\.(bak|pre)/.test(f)) continue;
      readFileSync(`${dir}/${f}`, 'utf8').split('\n').forEach((l, i) => {
        const code = l.replace(/\/\/.*$/, '').trim();
        if (code.startsWith('*')) return;
        if (/\bMAX_WEEKLY_BLOCK_HOURS\b/.test(code)) offenders.push(`${dir}/${f}:${i + 1}`);
      });
    }
  }
  assert.deepEqual(offenders, [], 'use maxWeeklyBlockHoursFor(state)');
});

console.log('\n── New games ─────────────────────────────────────────────\n');

// Last: START_GAME switches the process-wide demand model (v2 adds taxi time
// to every sector), which would move the block-time figures the tests above use.
test('START_GAME turns it on; a fresh (pre-game / legacy) state does not have it', () => {
  assert.ok(!freshState().realisticUtilization);
  const s = gameReducer(freshState(), { type: 'START_GAME', airlineName: 'Cap Air', hub: 'JFK', enableObjectives: false });
  assert.equal(s.realisticUtilization, true);
  assert.equal(maxWeeklyBlockHoursFor(s), 100);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
