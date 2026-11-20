// The planes on the globe (ported from Headwinds, Discord 2026-11-18).
//
// Each tail flies its timetable at the type's cruise speed and turnaround —
// the same flight plans Headwinds draws. Tailwinds has no running clock inside
// a week, so the planes run on the globe's own loop (PLANE_MAX_RATE: one game
// week per real hour, the default auto-advance). Tailwinds adds charter planes.
// Pure modules plus an SSR render — no DOM, no WebGL, no network.
//
//   node --import ./tools/_register-loader.mjs tools/globe-planes-test.mjs

import assert from 'node:assert/strict';
import { gameRate, WEEK_HOURS } from '../src/components/gameClock.js';
import {
  PLANE_MAX_RATE, planeWeekHours, bearingDeg, buildFlightPlan,
  planePosition, planesGeoJSON, planeRefreshMs, hash01,
} from '../src/components/flightsCore.js';
import { globeChainPath } from '../src/components/globeCore.js';
import { getAirport } from '../src/data/airports.js';
import { AIRCRAFT_TYPES } from '../src/data/aircraft.js';
import {
  routeDistanceKm, cruiseSpeedKmh, turnaroundHours, routeBlockHours,
} from '../src/utils/simulation.js';

const store = new Map();
globalThis.window = globalThis.window ?? {};
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
const near = (a, b, tol, msg) => assert.ok(Math.abs(a - b) <= tol, `${msg ?? ''} ${a} vs ${b} (±${tol})`);

const narrow = AIRCRAFT_TYPES.find(t => t.category === 'Narrow Body' && !t.freighter);
const planFor = (id, codes, f, type = narrow) => {
  const stops = codes.map(getAirport);
  return buildFlightPlan({
    id, group: id, color: '#fff', tip: id, stops,
    legKm: stops.slice(1).map((s, i) => routeDistanceKm(codes[i], codes[i + 1])),
    weeklyFrequency: f, cruiseKmh: cruiseSpeedKmh(type), turnaroundH: turnaroundHours(type),
  });
};

console.log('\nGlobe planes\n');

test('with no world clock the planes fly a week an hour, wrapping smoothly', () => {
  const t0 = Date.UTC(2026, 10, 20, 12, 0, 0);
  const h0 = planeWeekHours(t0, null);
  const h1 = planeWeekHours(t0 + 3_600_000 / 168, null);
  assert.ok(h0 >= 0 && h0 < WEEK_HOURS);
  near(((h1 - h0 + WEEK_HOURS) % WEEK_HOURS), 1, 1e-6, 'one game hour per 1/168 real hour');
  assert.equal(PLANE_MAX_RATE, 168);
});

test('a rotation is every leg out then every leg back, timed like the engine block hours', () => {
  const p = planFor('r1', ['SYD', 'MEL'], 7);
  assert.equal(p.legs.length, 2);
  assert.deepEqual(p.legs.map(l => `${l.from.code}-${l.to.code}`), ['SYD-MEL', 'MEL-SYD']);
  const tag = planFor('r2', ['MCI', 'JFK', 'ORY'], 3);
  assert.deepEqual(tag.legs.map(l => `${l.from.code}-${l.to.code}`), ['MCI-JFK', 'JFK-ORY', 'ORY-JFK', 'JFK-MCI']);
  // Per rotation, block time = the engine's routeBlockHours for one frequency.
  const engineH = routeBlockHours({ origin: 'MCI', destination: 'ORY', stops: ['MCI', 'JFK', 'ORY'] }, narrow, 1);
  near(tag.rotationH, engineH, 0.01, 'rotation hours');
  near(tag.slotH, WEEK_HOURS / 3, 1e-9);
});

test('a tail is airborne for exactly its flying hours each week', () => {
  const p = planFor('r3', ['DXB', 'LHR'], 5);
  let airborne = 0;
  const N = 168 * 60;
  for (let k = 0; k < N; k++) if (planePosition(p, (k + 0.5) / 60)) airborne++;
  const flyingH = p.legs.reduce((s, l) => s + l.flightH, 0) * 5;
  near(airborne / 60, flyingH, 0.1, 'airborne hours');
});

test('it leaves from the origin and arrives at the destination, pointing the right way', () => {
  const p = planFor('r4', ['SYD', 'PER'], 7);
  const l = p.legs[0];
  const start = planePosition(p, p.phase + 1e-6);
  near(start.lat, getAirport('SYD').lat, 0.01); near(start.lon, getAirport('SYD').lon, 0.01);
  near(start.heading, bearingDeg(getAirport('SYD'), getAirport('PER')), 0.5, 'initial heading');
  const end = planePosition(p, p.phase + l.flightH - 1e-6);
  near(end.lat, getAirport('PER').lat, 0.01); near(end.lon, getAirport('PER').lon, 0.01);
  assert.equal(planePosition(p, p.phase + l.flightH + l.turnH / 2), null, 'on the ground at PER');
  const home = planePosition(p, p.phase + l.flightH + l.turnH + 1e-6);
  near(home.lat, getAirport('PER').lat, 0.01);
  assert.ok(home.heading > 45 && home.heading < 135, `heading home east, got ${home.heading}`);
});

test('a plane sits on its route line, including across the date line', () => {
  const p = planFor('r5', ['NRT', 'HNL'], 7);
  const line = globeChainPath([[getAirport('NRT').lat, getAirport('NRT').lon], [getAirport('HNL').lat, getAirport('HNL').lon]], 256);
  for (const f of [0.1, 0.37, 0.5, 0.8]) {
    const pos = planePosition(p, p.phase + p.legs[0].flightH * f);
    assert.ok(pos.lon >= -180 && pos.lon <= 180, `lon ${pos.lon}`);
    const off = Math.min(...line.map(([la, lo]) => Math.hypot(la - pos.lat, ((lo - pos.lon + 540) % 360) - 180)));
    assert.ok(off < 0.2, `off the line by ${off.toFixed(3)}° at ${f}`);
  }
});

test('no jump at the week wrap (Sunday night → Monday morning)', () => {
  const p = planFor('r6', ['LHR', 'JFK'], 7);
  // Find a rotation airborne across the boundary by shifting the phase.
  const q = { ...p, phase: WEEK_HOURS - 2 };
  const a = planePosition(q, WEEK_HOURS - 1e-4), b = planePosition(q, 1e-4);
  assert.ok(a && b);
  near(a.lat, b.lat, 0.01); near(a.lon, b.lon, 0.01);
});

test('tails on the same pair spread out; bad data flies nothing', () => {
  assert.notEqual(hash01('r7a'), hash01('r7b'));
  assert.notEqual(planFor('r7a', ['SYD', 'MEL'], 7).phase, planFor('r7b', ['SYD', 'MEL'], 7).phase);
  assert.equal(planFor('r8', ['SYD', 'MEL'], 0), null);
  assert.equal(buildFlightPlan({ id: 'x', stops: [getAirport('SYD')], legKm: [], weeklyFrequency: 3, cruiseKmh: 800 }), null);
});

test('a turboprop takes longer than a jet over the same leg', () => {
  const tp = AIRCRAFT_TYPES.find(t => t.category === 'Turboprop' && !t.freighter);
  const slow = planFor('r9', ['SYD', 'MEL'], 7, tp), fast = planFor('r9', ['SYD', 'MEL'], 7);
  assert.ok(slow.legs[0].flightH > fast.legs[0].flightH * 1.5);
});

test('GeoJSON carries heading, group and colour for every airborne plane', () => {
  const plans = [planFor('a', ['SYD', 'MEL'], 21), planFor('b', ['DXB', 'LHR'], 7), null];
  const p = plans[1];
  const fc = planesGeoJSON(plans, p.phase + 1);
  const f = fc.features.find(x => x.properties.id === 'b');
  assert.ok(f, 'DXB–LHR airborne an hour after departure');
  assert.equal(f.properties.group, 'b');
  assert.equal(typeof f.properties.heading, 'number');
  assert.ok(f.properties.tip.includes('DXB → LHR'));
});

test('redraw cadence: about half a pixel of movement, 30 fps at most', () => {
  assert.equal(planeRefreshMs(PLANE_MAX_RATE, 10), 33);
  assert.equal(planeRefreshMs(gameRate(1), 0), 2000);
  const z3 = planeRefreshMs(PLANE_MAX_RATE, 3);
  assert.ok(z3 > 33 && z3 < 2000, `${z3}`);
});


// ── Tailwinds: the map's flight plans, charters included ─────────────────────
const { tailFlightPlans } = await import('../src/components/RouteMap.jsx');
const { airlineWeeks } = await import('../src/models/schedule.js');

const ap = (c) => getAirport(c);
const fleet = [
  { id: 'a1', typeId: narrow.id, tailNumber: 'VH-AAA', status: 'assigned' },
  { id: 'a2', typeId: narrow.id, tailNumber: 'VH-BBB', status: 'assigned' },
  { id: 'a3', typeId: narrow.id, tailNumber: 'VH-CCC', status: 'grounded' },
];
const r1 = { id: 'r1', origin: 'SYD', destination: 'MEL', stops: ['SYD', 'MEL'], aircraftId: 'a1', weeklyFrequency: 14 };
const r3 = { id: 'r3', origin: 'SYD', destination: 'BNE', stops: ['SYD', 'BNE'], aircraftId: 'a3', weeklyFrequency: 7 };
const ch = { id: 'c1', status: 'active', origin: 'MEL', destination: 'PER', aircraftId: 'a2', weeklyFrequency: 2, weeksRemaining: 4 };
const groups = [
  { key: 'MEL~SYD', members: [{ r: r1, origin: ap('SYD'), dest: ap('MEL'), chain: [ap('SYD'), ap('MEL')] }] },
  { key: 'BNE~SYD', members: [{ r: r3, origin: ap('SYD'), dest: ap('BNE'), chain: [ap('SYD'), ap('BNE')] }] },
];
const charterGroups = [{ key: 'c1', members: [{ r: ch, origin: ap('MEL'), dest: ap('PER') }] }];
const weeks = airlineWeeks({ fleet, routes: [r1, r3], cargoRoutes: [], charters: [ch] }, 6);
const plans = tailFlightPlans({
  groups, charterGroups, fleet, month: 6, colorOf: () => '#2ee6a0',
  cargoColor: '#e8833a', charterColor: '#ffe14d', weeks,
});

test('every flying tail gets a plane on its timetable; a grounded one gets none', () => {
  const ids = plans.map(p => p.id).sort();
  assert.deepEqual(ids, ['c1', 'r1']);
  const p = plans.find(x => x.id === 'r1');
  assert.equal(p.starts.length, 14, 'one rotation per weekly frequency, from the timetable');
});

test('a charter flies as a yellow plane that does not focus a route', () => {
  const c = plans.find(x => x.id === 'c1');
  assert.equal(c.group, 'charter:c1');
  assert.equal(c.color, '#ffe14d');
  assert.deepEqual(c.legs.map(l => `${l.from.code}-${l.to.code}`), ['MEL-PER', 'PER-MEL']);
});

test('a tail flying a route and a charter is never in two places at once', () => {
  const both = tailFlightPlans({
    groups: [{ key: 'MEL~SYD', members: [{ r: { ...r1, aircraftId: 'a2', weeklyFrequency: 7 }, origin: ap('SYD'), dest: ap('MEL') }] }],
    charterGroups, fleet, month: 6, colorOf: () => '#fff', charterColor: '#ffe14d',
  });
  assert.equal(both.length, 2);
  for (let k = 0; k < 168 * 12; k++) {
    const h = (k + 0.5) / 12;
    assert.ok(both.filter(p => planePosition(p, h)).length <= 1, `two places at ${h}h`);
  }
});

// ── The real component, server-rendered on the globe ─────────────────────────
const React = (await import('react')).default;
const { renderToString } = await import('react-dom/server');
const { default: RouteMap, MAP_VIEW_KEY, GLOBE_PLANES_KEY } = await import('../src/components/RouteMap.jsx');
const { GameProvider } = await import('../src/store/GameContext.jsx');
const render = () => renderToString(React.createElement(GameProvider, null,
  React.createElement(RouteMap))).replaceAll('<!-- -->', '');

test('the planes toggle shows on the globe only, and is remembered off', () => {
  store.delete(MAP_VIEW_KEY);
  assert.ok(!render().includes('data-map-planes-toggle'), 'no planes toggle on the flat map');
  store.set(MAP_VIEW_KEY, 'globe');
  const html = render();
  assert.match(html, /data-map-planes-toggle/);
  assert.match(html, /aria-pressed="true"[^>]*data-map-planes-toggle/, 'planes on by default');
  store.set(GLOBE_PLANES_KEY, 'off');
  assert.match(render(), /aria-pressed="false"[^>]*data-map-planes-toggle/);
  store.delete(GLOBE_PLANES_KEY);
  store.delete(MAP_VIEW_KEY);
});

console.log(`\nglobe-planes-test: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
