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

// ── Typed departure times ─────────────────────────────────────────────────────
// Click a flight and its panel takes a clock time for that flight, and the
// route's whole week as rows of "this time, on these days".
const { TimetableForm, timetableNotice } = await import('../src/components/ScheduleTimeline.jsx');
const sched = await import('../src/models/schedule.js');
const { utcOffsetMinutes: offOf } = await import('../src/data/timezones.js');
const { getAirport: apt } = await import('../src/data/airports.js');
const SYD_OFF = offOf(apt('SYD'));
const rN = (f, schedule) => ({ ...r0(schedule), weeklyFrequency: f });
const open = (routeId = 'r0', acId = 'ac0') => render(ScheduleTimeline, { initialSelection: { acId, routeId, start: 0 } });
const timeBoxes = (html) => [...html.matchAll(/<div class="sched-tt-row">\s*<input[^>]*value="([^"]*)"/g)].map(m => m[1]);
const daysOn = (html) => html.split('<div class="sched-tt-row">').slice(1)
  .map(row => count(row.split('</div>')[0], /aria-pressed="true" aria-label="\w+day"/g));

await test('the page says a time can be typed', () => {
  save([r0()]);
  assert.match(render(ScheduleTimeline), /Click a flight to type when it leaves/);
});

await test('a selected flight offers its own time and the route\u2019s whole week', () => {
  save([r0()]);
  const html = open();
  assert.match(html, /[A-Z][a-z]{2} only: leaves SYD at/);
  assert.match(html, /<strong>Whole week<\/strong>/);
  assert.match(html, /SYD–MEL on VH-AAA · 7 flights a week · \dh\d\d round trip · times are local at SYD/);
  assert.equal(timeBoxes(html).length, 1, 'a daily route is one time');
  assert.match(timeBoxes(html)[0], /^\d\d:\d[05]$/, 'starting from when it leaves now');
  assert.deepEqual(daysOn(html), [7]);
  assert.match(html, /All 7 flights timed\./);
  assert.match(html, />Set timetable</);
  assert.match(html, /−15m/, 'the nudge buttons are still there');
});

await test('fourteen flights a week are two rows; ten are a daily row and a three-day row', () => {
  save([rN(14)]);
  const h14 = open();
  assert.equal(timeBoxes(h14).length, 2);
  assert.deepEqual(daysOn(h14), [7, 7]);
  assert.match(h14, /All 14 flights timed\./);
  save([rN(10)]);
  const h10 = open();
  assert.deepEqual(daysOn(h10), [7, 3]);
  assert.match(h10, /All 10 flights timed\./);
});

await test('a week the player set reads back as set: 07:30 on six days, 10:00 on Saturday', () => {
  const at = (d, hhmm) => sched.utcOfLocal(d, sched.parseClock(hhmm), SYD_OFF);
  save([r0({ starts: [0, 1, 2, 3, 4, 6].map(d => at(d, '07:30')).concat(at(5, '10:00')) })]);
  const html = open();
  assert.deepEqual(timeBoxes(html), ['07:30', '10:00']);
  assert.deepEqual(daysOn(html), [6, 1]);
  assert.match(html, /aria-pressed="true" aria-label="Saturday"/);
});

await test('a once-a-week route has a time to type but no week to fill in; a charter has neither', () => {
  save([rN(1)]);
  const one = open();
  assert.match(one, /only: leaves SYD at/);
  assert.doesNotMatch(one, /Whole week/);
  save([r0()], { charters: [contract()] });
  const k = open('k1');
  assert.match(k, /times aren’t yours to set|times aren&#x27;t yours to set/);
  assert.doesNotMatch(k, /Whole week/);
  assert.doesNotMatch(k, /only: leaves/);
});

await test('the week form counts what is typed and says what is wrong before anything is set', () => {
  const form = (rows, flights = 7) => strip(renderToString(React.createElement(TimetableForm, {
    origin: 'SYD', pair: 'SYD–MEL', tail: 'VH-AAA', flights, dur: 200, initialRows: rows, onSet() {},
  })));
  const all = Array(7).fill(true), wk = [true, true, true, true, true, false, false];
  assert.match(form([{ tod: 450, days: wk }]), /5 of 7 flights timed\. The other 2 are placed automatically\./);
  assert.match(form([{ tod: 450, days: all }, { tod: 1080, days: wk }]), /12 departures, but this route flies 7 a week on this aircraft\. Untick 5 days\./);
  assert.match(form([{ tod: 450, days: all }, { tod: 1080, days: wk }]), /<button[^>]*disabled=""[^>]*>Set timetable</, 'cannot be set while it asks for too many');
  assert.match(form([{ tod: null, days: all }]), /Type a time and tick the days it flies\./);
  assert.match(form([{ tod: null, days: all }]), /placeholder="07:30"/);
  // One row can't be removed; two can.
  assert.doesNotMatch(form([{ tod: 450, days: all }]), /Remove the/);
  assert.equal(count(form([{ tod: 450, days: all }, { tod: 1080, days: all }], 14), /aria-label="Remove the \d\d:\d\d departure"/g), 2);
});

await test('what a set timetable did is said plainly', () => {
  const name = (by) => (by.charter ? 'the charter to OOL' : 'SYD–BNE');
  const res = (extra) => ({ pins: [], flights: 7, timed: 7, set: 7, bumped: [], auto: [], ...extra });
  assert.deepEqual(timetableNotice(res()), { tone: 'ok', text: 'All 7 flights set.' });
  assert.deepEqual(timetableNotice(res({ timed: 5, set: 5 })),
    { tone: 'ok', text: '5 flights set. The other 2 flights are placed automatically.' });
  const at = (d, m) => sched.utcOfLocal(d, m, SYD_OFF);
  const bumped = timetableNotice(res({ set: 6, bumped: [{ day: 2, tod: 450, at: at(2, 615), by: { routeId: 'b', start: at(2, 420), charter: false } }] }),
    { off: SYD_OFF, name });
  assert.equal(bumped.tone, 'warn');
  assert.equal(bumped.text, '6 of 7 departures set as typed. Wed 07:30 is taken by SYD–BNE (leaves Wed 07:00), so that flight leaves at Wed 10:15.');
  const auto = timetableNotice(res({ set: 6, auto: [{ day: 2, tod: 1200, by: { routeId: 'k', start: at(2, 480), charter: true } }] }), { off: SYD_OFF, name });
  assert.match(auto.text, /Wed 20:00 has no room within 12 hours \(the charter to OOL is in the way\), so that flight is placed automatically\./);
  // The same thing in the way on several days is said once.
  const daily = timetableNotice(res({ timed: 5, flights: 5, set: 0, bumped: [0, 2, 3, 4, 6].map(d => ({ day: d, tod: 450, at: at(d, 630), by: { routeId: 'b', start: at(d, 420), charter: false } })) }),
    { off: SYD_OFF, name });
  assert.equal(daily.text, 'None of the 5 departures could be set as typed. 07:30 on Mon, Wed, Thu, Fri and Sun is taken by SYD–BNE (leaves 07:00), so those flights leave at 10:30.');
  const every = timetableNotice(res({ set: 0, bumped: [0, 1, 2, 3, 4, 5, 6].map(d => ({ day: d, tod: 450, at: at(d, 630), by: { routeId: 'b', start: at(d, 420), charter: false } })) }),
    { off: SYD_OFF, name });
  assert.match(every.text, /07:30 on every day is taken by SYD–BNE \(leaves 07:00\), so those flights leave at 10:30\./);
  // Different things in the way are spelled out, three at most.
  const many = timetableNotice(res({ set: 2, bumped: Array.from({ length: 5 }, (_, d) => ({ day: d, tod: 450, at: at(d, 615 + d * 5), by: { routeId: 'b', start: at(d, 420), charter: false } })) }),
    { off: SYD_OFF, name });
  assert.equal(count(many.text, /is taken by/g), 3, 'three spelled out');
  assert.match(many.text, /2 more moved the same way\./);
  // A flight pushed past midnight keeps its days in the sentence.
  const late = timetableNotice(res({ set: 6, bumped: [{ day: 2, tod: 1410, at: at(3, 30), by: { routeId: 'b', start: at(2, 1380), charter: false } }] }), { off: SYD_OFF, name });
  assert.match(late.text, /Wed 23:30 is taken by SYD–BNE \(leaves Wed 23:00\), so that flight leaves at Thu 00:30\./);
  assert.deepEqual(timetableNotice({ error: 'too-close', a: { day: 0, tod: 420 }, b: { day: 0, tod: 480 }, dur: 200 }), {
    tone: 'bad',
    text: 'Mon 07:00 and Mon 08:00 are too close together. The aircraft is away for 3h20 on each round trip, so after Mon 07:00 the next departure can be Mon 10:20 at the earliest.',
  });
  assert.match(timetableNotice({ error: 'too-many', timed: 9, flights: 7 }).text, /flies 7 times a week on this aircraft, and this timetable has 9 departures\. Untick 2 days/);
  assert.equal(timetableNotice(null).tone, 'bad');
});

console.log(`\nschedule-ui-test: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
