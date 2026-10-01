// The freight planner's "Open Cargo Route" button never lies about the engine.
//
// Discord 2026-09-29 (Bazooka): "I'm clicking the open route button but it's
// just got pressed but it does nothing. Sometimes it works, but most of the
// time no." The planner re-derived only some of ADD_CARGO_ROUTE's guards and
// skipped the airport rules (runway length, perimeter, curfews), so the button
// was live on lanes the reducer silently refused. It also projected and sent a
// stale frequency (7×) while the slider showed the lane's cap (e.g. 3×).
//
// Both now read cargoRouteDenial — one function, two callers. (The planner
// picks its aircraft type in an effect, which SSR never runs, so the button
// itself isn't rendered here; it calls the function pinned below.)
//
//   node --import ./tools/_register-loader.mjs tools/cargo-open-button-test.mjs
import assert from 'node:assert/strict';
import { getAirport } from '../src/data/airports.js';
import { getAircraftType } from '../src/data/aircraft.js';

const store = new Map();
globalThis.window = globalThis.window ?? {};
globalThis.window.matchMedia = () => ({ matches: true, addListener() {}, removeListener() {} });
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
  clear: () => store.clear(),
};

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.log(`  ✗ ${name}\n      ${(e.stack || e.message).split('\n').slice(0, 4).join('\n      ')}`); failed++; }
}

const { freshState, gameReducer, cargoRouteDenial } = await import('../src/store/GameContext.jsx');

const T = 'b777f';
const [HUB, SHORT, LONG] = ['ORD', 'PAE', 'SEA'];
assert.ok(getAirport(SHORT).runwayFt < getAircraftType(T).runwayFt, 'fixture: PAE must be too short for a 777F');
assert.ok(getAirport(LONG).runwayFt >= getAircraftType(T).runwayFt, 'fixture: SEA must take a 777F');

const base = {
  ...freshState(),
  phase: 'playing', week: 20, year: 1, hub: HUB, cash: 500_000_000,
  gates: { [HUB]: 8, [SHORT]: 8, [LONG]: 8 },
  fleet: [{ id: 'f1', typeId: T, name: 'Heavy One', tailNumber: 'NF1', status: 'idle', ageWeeks: 52, ownershipType: 'owned' }],
  routes: [], cargoRoutes: [],
};
const launch = (dest, freq = 3) => ({ type: 'ADD_CARGO_ROUTE', origin: HUB, destination: dest, aircraftId: 'f1', weeklyFrequency: freq });

console.log('\n── 1. One verdict, two callers ───────────────────────────');

test('runway-limited lane: denied with a reason, and the reducer refuses it', () => {
  const d = cargoRouteDenial(base, launch(SHORT));
  assert.equal(d?.code, 'restriction');
  assert.match(d.reason, /runway/i);
  assert.equal(gameReducer(base, launch(SHORT)).cargoRoutes.length, 0);
});

test('a lane the engine accepts is not denied, and opens', () => {
  assert.equal(cargoRouteDenial(base, launch(LONG)), null);
  assert.equal(gameReducer(base, launch(LONG)).cargoRoutes.length, 1);
});

test('denial and reducer agree across many lanes', () => {
  const dests = ['SEA', 'PAE', 'BLI', 'JFK', 'LAX', 'MIA', 'ATL', 'DEN', 'KTN', 'ANC', 'LHR', 'NRT'];
  for (const dst of dests) {
    if (!getAirport(dst)) continue;
    for (const f of [1, 3, 7, 14]) {
      const s = { ...base, gates: { ...base.gates, [dst]: 8 } };
      const denied = !!cargoRouteDenial(s, launch(dst, f));
      const opened = gameReducer(s, launch(dst, f)).cargoRoutes.length === 1;
      assert.equal(opened, !denied, `${HUB}-${dst} ×${f}: denial=${denied} but reducer opened=${opened}`);
    }
  }
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
