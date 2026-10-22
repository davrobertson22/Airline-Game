// The schedule editor and what reads the timetable, through the real components.
// Ported from the Headwinds suite of the same name (2026-10-21), plus the
// Tailwinds-only charter rows and the board/editor agreement on charter tails.
//
//   · ScheduleTimeline (SSR): one row per flying tail, automatic flights dashed,
//     pinned ones solid, a tray of flights to drag in, hub-local times
//   · Operations offers it as a sub-tab
//   · the departure board prints your pinned departures at their local time
//   · charters: a fixed, hatched block with its own chip, never draggable
//
//   node --import ./tools/_register-loader.mjs tools/schedule-ui-test.mjs

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

let passed = 0, failed = 0;
async function test(name, fn) {
  try { await fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.log(`  ✗ ${name}\n      ${(e.stack || e.message).split('\n').slice(0, 4).join('\n      ')}`); failed++; }
}
const src = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

const store = new Map();
globalThis.window = globalThis.window ?? {};
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
  clear: () => store.clear(),
};
const React = (await import('react')).default;
const { renderToString } = await import('react-dom/server');
const { default: ScheduleTimeline, weekLabel, SCHEDULE_ZONE_KEY } = await import('../src/components/ScheduleTimeline.jsx');
const { default: Departures } = await import('../src/components/Departures.jsx');
const { GameProvider, freshState } = await import('../src/store/GameContext.jsx');
const { AIRCRAFT_TYPES } = await import('../src/data/aircraft.js');
const { buildDepartureBoard } = await import('../src/models/departureBoard.js');

const jet = AIRCRAFT_TYPES.find(t => !t.freighter && t.category === 'Narrow Body');
const save = (routes, extra = {}) => store.set('bbae_save_v2', JSON.stringify({
  ...freshState(),
  phase: 'playing', week: 20, year: 2, hub: 'SYD', cash: 20_000_000, scheduleTrimVersion: 1,
  hubs: { SYD: { tier: 2, tierSince: 0 } }, gates: { SYD: 16, MEL: 6, BNE: 6 },
  competitors: [],
  fleet: [
    { id: 'ac0', typeId: jet.id, tailNumber: 'VH-AAA', status: 'assigned', ageWeeks: 52, ownershipType: 'owned', config: { economy: jet.seats } },
    { id: 'ac1', typeId: jet.id, tailNumber: 'VH-BBB', status: 'assigned', ageWeeks: 52, ownershipType: 'owned', config: { economy: jet.seats } },
    { id: 'ac2', typeId: jet.id, tailNumber: 'VH-IDL', status: 'idle', ageWeeks: 52, ownershipType: 'owned', config: { economy: jet.seats } },
  ],
  routes,
  ...extra,
}));
const r0 = (schedule) => ({ id: 'r0', origin: 'SYD', destination: 'MEL', stops: ['SYD', 'MEL'], aircraftId: 'ac0',
  weeklyFrequency: 7, weeksOpen: 40, hub: 'SYD', cateringLevel: 'full', ...(schedule ? { schedule } : {}) });
const r1 = { id: 'r1', origin: 'SYD', destination: 'BNE', stops: ['SYD', 'BNE'], aircraftId: 'ac1',
  weeklyFrequency: 10, weeksOpen: 40, hub: 'SYD', cateringLevel: 'full' };
const strip = (h) => h.replaceAll('<!-- -->', '');
const render = (C, props = {}) => strip(renderToString(React.createElement(GameProvider, null, React.createElement(C, props))));
const count = (html, re) => (html.match(re) ?? []).length;

await test('Operations offers the Schedule sub-tab', () => {
  const s = src('../src/components/Operations.jsx');
  assert.match(s, /id: 'schedule',\s*label: 'Schedule'/);
  assert.match(s, /<ScheduleTimeline \/>/);
});

await test('one row per flying tail; an idle aircraft has no row', () => {
  save([r0(), r1]);
  const html = render(ScheduleTimeline);
  assert.match(html, /VH-AAA/);
  assert.match(html, /VH-BBB/);
  assert.doesNotMatch(html, /VH-IDL/);
  assert.match(html, />2 aircraft</);
});

await test('untouched: every flight automatic (dashed), all in the tray, nothing to reset', () => {
  save([r0(), r1]);
  const html = render(ScheduleTimeline);
  assert.equal(count(html, /class="sched-block is-auto/g), 17, '7 + 10 rotations');
  assert.equal(count(html, /class="sched-block is-pinned/g), 0);
  assert.match(html, /MEL ×7/);
  assert.match(html, /BNE ×10/);
  assert.doesNotMatch(html, /Reset all to automatic/);
});

await test('a pinned flight is solid, leaves the tray, and offers reset', () => {
  save([r0({ starts: [9960] }), r1]);
  const html = render(ScheduleTimeline);
  assert.equal(count(html, /class="sched-block is-pinned/g), 1);
  assert.equal(count(html, /class="sched-block is-auto/g), 16);
  assert.match(html, /MEL ×6/);
  assert.match(html, /Reset all to automatic/);
  // 9960 = Sun 22:00 UTC = Mon 08:00 in Sydney (UTC+10), the default zone.
  assert.match(html, /leaves Mon 08:00, set by you/);
});

await test('one keyboard tab stop per aircraft, not one per flight', () => {
  save([r0(), r1]);
  const html = render(ScheduleTimeline);
  assert.equal(count(html, /class="sched-block[^"]*"[^>]*tabindex="0"/g), 2);
  assert.ok(count(html, /tabindex="-1"/g) >= 15);
});

await test('a fully set route stays in the tray as a solid legend chip', () => {
  save([r0({ starts: [0, 1440, 2880, 4320, 5760, 7200, 8640] })]);
  const html = render(ScheduleTimeline);
  assert.match(html, /class="sched-chip is-set"/);
  assert.match(html, /all 7 flights set by you/);
});

await test('times in hub local by default, UTC on request', () => {
  save([r0({ starts: [9960] })]);
  assert.match(render(ScheduleTimeline), /SYD time \(UTC\+10\)/);
  store.set(SCHEDULE_ZONE_KEY, 'utc');
  assert.match(render(ScheduleTimeline), /leaves Sun 22:00, set by you/);
  store.delete(SCHEDULE_ZONE_KEY);
});

await test('no routes → an empty state, not an empty grid', () => {
  save([]);
  assert.match(render(ScheduleTimeline), /No flights to schedule yet/);
});

await test('Tailwinds copy: no globe, no live clock', () => {
  save([r0()]);
  const html = render(ScheduleTimeline);
  assert.doesNotMatch(html, /globe/i);
  assert.doesNotMatch(html, /sched-now/);
  assert.match(html, /sets the departure board/);
});

// ── Charters (Tailwinds only) ─────────────────────────────────────────────────
const contract = (extra = {}) => ({
  id: 'k1', charter: true, offerId: 'o1', templateId: 'sports', type: 'sports', name: 'Sports team',
  customer: 'Harbour FC', origin: 'SYD', destination: 'OOL', stops: ['SYD', 'OOL'], aircraftId: 'ac0',
  weeklyFrequency: 2, fee: 400_000, feePerWeek: 100_000, weeksTotal: 4, weeksRemaining: 4, startWeek: 1,
  positioningWeeksRemaining: 0, status: 'active', breachPenalty: 100_000, reputationStake: 2,
  ...extra,
});

await test('a charter shows as a fixed, hatched block with its own chip and a legend entry', () => {
  save([r0()], { charters: [contract()] });
  const html = render(ScheduleTimeline);
  assert.equal(count(html, /class="sched-block is-charter/g), 2, 'two charter rotations');
  assert.equal(count(html, /class="sched-block is-auto/g), 7, 'the route keeps all seven');
  assert.match(html, /class="sched-chip is-set is-charter"/);
  assert.match(html, /OOL ×2/);
  assert.match(html, /charter \(fixed\)/);
  assert.match(html, /can’t be moved/);
  assert.match(html, /Charter SYD–OOL–SYD, leaves [A-Z][a-z]{2} \d\d:\d\d, fixed/);
});

await test('a tail flying only a charter gets a row', () => {
  save([r0()], { charters: [contract({ aircraftId: 'ac2' })] });
  const html = render(ScheduleTimeline);
  assert.match(html, /VH-IDL/);
  assert.match(html, />2 aircraft</);
});

await test('no charter → no charter legend', () => {
  save([r0(), r1]);
  assert.doesNotMatch(render(ScheduleTimeline), /charter/i);
});

await test('the board and the editor agree on a tail flying a charter', async () => {
  // The route's automatic times shift round the charter; the board must use
  // the same week (it passes state.charters to airlineWeeks), or it would print
  // the times the tail had before the contract.
  const { airlineWeeks, weekDepartures, wrapWeek } = await import('../src/models/schedule.js');
  const { utcOffsetMinutes } = await import('../src/data/timezones.js');
  const { getAirport } = await import('../src/data/airports.js');
  const routes = [r0()];
  const fleet = [{ id: 'ac0', typeId: jet.id }];
  const withK = airlineWeeks({ fleet, routes, charters: [contract()] }, 6).get('ac0');
  const without = airlineWeeks({ fleet, routes }, 6).get('ac0');
  const syd = utcOffsetMinutes(getAirport('SYD'));
  const mondayTimes = (w) => weekDepartures(w)
    .filter(d => d.routeId === 'r0' && d.from === 'SYD')
    .map(d => wrapWeek(d.utcMin + syd))
    .filter(m => m < 1440)
    .map(m => `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`);
  const want = mondayTimes(withK), before = mondayTimes(without);
  assert.ok(want.length > 0);
  assert.notDeepEqual(want, before, 'fixture: the charter must move the route, or this proves nothing');
  save([r0()], { airlineName: 'Timetable Air', charters: [contract()] });
  const html = render(Departures, { initialAirport: 'SYD' });
  // Only OUR rows to MEL — rivals' synthesised rows share the board, and a
  // loose time match once passed on one of theirs.
  const mine = html.split('<tr').slice(1)
    .filter(tr => tr.includes('Timetable Air') && tr.includes('>MEL<'))
    .map(tr => tr.match(/>(\d\d:\d\d)</)?.[1]);
  assert.deepEqual(mine, want, `board ${mine} vs editor ${want} (pre-charter ${before})`);
});

await test('weekLabel wraps the week', () => {
  assert.equal(weekLabel(0), 'Mon 00:00');
  assert.equal(weekLabel(10080 + 65), 'Mon 01:05');
  assert.equal(weekLabel(-60), 'Sun 23:00');
});

// ── Departure board ───────────────────────────────────────────────────────────
await test('board: a timetabled leg prints at exactly its times, on its days only', () => {
  const rows = (day) => buildDepartureBoard({ airport: 'SYD', day, worldSeed: 'w', carriers: [{
    id: 'p', name: 'Test Air', isPlayer: true, onTimeRate: 1,
    legs: [{ to: 'MEL', weeklyFrequency: 2, typeId: jet.id, typeName: jet.name, times: [{ day: 0, min: 480 }, { day: 3, min: 1065 }] }],
  }] });
  assert.deepEqual(rows(0).map(r => r.timeLabel), ['08:00']);
  assert.deepEqual(rows(3).map(r => r.timeLabel), ['17:45']);
  assert.deepEqual(rows(1), []);
});

await test('board: moving one timetabled flight keeps the other flights’ numbers', () => {
  const board = (t2) => buildDepartureBoard({ airport: 'SYD', day: 0, worldSeed: 'w', carriers: [{
    id: 'p', name: 'Test Air', isPlayer: true, onTimeRate: 0.9,
    legs: [{ to: 'MEL', weeklyFrequency: 3, typeId: jet.id, typeName: jet.name,
      times: [{ day: 0, min: 420, key: 'a|0' }, { day: 0, min: t2, key: 'a|1' }, { day: 0, min: 1080, key: 'a|2' }] }],
  }] });
  const num = (rows, t) => rows.find(r => r.time === t)?.flightNo;
  const b1 = board(600), b2 = board(300);
  assert.equal(num(b1, 420), num(b2, 420));
  assert.equal(num(b1, 1080), num(b2, 1080));
});

await test('board: your pinned departure shows at its local time', () => {
  save([r0({ starts: [9960] })]);
  const html = render(Departures, { initialAirport: 'SYD' });
  assert.match(html, /08:00/, 'Mon 08:00 Sydney');
});

console.log(`\nschedule-ui-test: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
