// Weekly schedule — time zones, the per-aircraft timetable and the reducer
// action. Ported from the Headwinds suite of the same name (2026-10-21): the
// model tests are unchanged; the reducer tests run on Tailwinds' reducer and
// are strict where Headwinds' were conditional; the server tests are dropped
// (no server here); and the charter section is Tailwinds-only.
//
// The schedule is cosmetic (departure board, schedule editor); these pin that
// it is complete, never overlaps, honours the player's pins and flows
// everything else around them — and, in Tailwinds, that a charter takes its
// time on the tail, can't be pinned or moved, and never moves because of
// anything the player does.
//
//   node --import ./tools/_register-loader.mjs tools/schedule-test.mjs

import assert from 'node:assert/strict';

const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
  clear: () => store.clear(),
};
globalThis.window ??= {
  localStorage: globalThis.localStorage,
  matchMedia: () => ({ matches: false, addEventListener() {}, removeEventListener() {} }),
};

const { utcOffsetHours } = await import('../src/data/timezones.js');
const { getAirport } = await import('../src/data/airports.js');
const { AIRCRAFT_TYPES } = await import('../src/data/aircraft.js');
const {
  WEEK_MIN, normalizeStarts, routeRotation, overlaps, aircraftWeek, canPlace,
  pinsAfterMove, pinsAfterUnpin, weekDepartures, airlineWeeks, wrapWeek,
} = await import('../src/models/schedule.js');
const { routeBlockHours } = await import('../src/utils/simulation.js');
const { gameReducer, freshState } = await import('../src/store/GameContext.jsx');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.log(`  ✗ ${name}\n      ${(e.stack || e.message).split('\n').slice(0, 4).join('\n      ')}`); failed++; }
}

const jet = AIRCRAFT_TYPES.find(t => t.category === 'Narrow Body' && !t.freighter);
const route = (id, stops, f, starts) => ({
  id, origin: stops[0], destination: stops.at(-1), stops, weeklyFrequency: f,
  ...(starts ? { schedule: { starts } } : {}),
});
const noOverlap = (blocks) => {
  for (let i = 0; i < blocks.length; i++) for (let j = i + 1; j < blocks.length; j++) {
    assert.ok(!overlaps(blocks[i].start, blocks[i].dur, blocks[j].start, blocks[j].dur),
      `${blocks[i].key} overlaps ${blocks[j].key}`);
  }
};

// ── Time zones ────────────────────────────────────────────────────────────────
test('standard offsets, including countries split across zones', () => {
  const want = { SYD: 10, PER: 8, ADL: 9.5, LHR: 0, CDG: 1, MAD: 1, JFK: -5, ORD: -6, DEN: -7,
    LAX: -8, HNL: -10, ANC: -9, YYC: -7, DEL: 5.5, SIN: 8, NRT: 9, SVO: 3, GRU: -3, CUN: -5, DPS: 8 };
  for (const [c, h] of Object.entries(want)) assert.equal(utcOffsetHours(getAirport(c)), h, c);
});

// ── Building blocks ───────────────────────────────────────────────────────────
test('pins are cleaned: whole minutes in the week, distinct, sorted, ≤ frequency', () => {
  assert.deepEqual(normalizeStarts([100, 100, 10085, -5, 'x', 7.4], 9), [5, 7, 100, 10075]);
  assert.deepEqual(normalizeStarts([1, 2, 3], 2), [1, 2]);
  assert.deepEqual(normalizeStarts(null, 3), []);
});

test('a rotation is the engine block time: every leg out and back, flight + turnaround', () => {
  const r = route('t', ['MCI', 'JFK', 'ORY'], 1);
  const rot = routeRotation(r, jet);
  assert.deepEqual(rot.legs.map(l => `${l.from}-${l.to}`), ['MCI-JFK', 'JFK-ORY', 'ORY-JFK', 'JFK-MCI']);
  assert.ok(Math.abs(rot.durMin / 60 - routeBlockHours(r, jet, 1)) < 0.1, `${rot.durMin / 60} h`);
});

test('cyclic overlap understands the week wrapping', () => {
  assert.ok(overlaps(WEEK_MIN - 60, 120, 30, 10), 'Sunday 23:00 + 2h covers Monday 00:30');
  assert.ok(!overlaps(WEEK_MIN - 60, 60, 0, 10), 'ends exactly at Monday 00:00');
  assert.ok(!overlaps(0, 60, 60, 60), 'back to back is fine');
});

// ── The automatic week ────────────────────────────────────────────────────────
test('no pins: every rotation placed, daily in the 06:00–09:00 local wave, no overlaps', () => {
  const w = aircraftWeek([route('a', ['SYD', 'MEL'], 7)], jet, 'tail-1');
  assert.equal(w.blocks.length, 7);
  assert.equal(w.blocks.every(b => !b.pinned), true);
  noOverlap(w.blocks);
  const locals = w.blocks.map(b => wrapWeek(b.start + 600) % 1440);   // SYD is UTC+10
  for (const l of locals) assert.ok(l >= 355 && l <= 545, `departs ${Math.floor(l / 60)}:${l % 60} local`);
  assert.ok(Math.max(...locals) - Math.min(...locals) <= 10, 'same time every day');
});

test('two tails on the same pair leave at different times', () => {
  const a = aircraftWeek([route('a', ['SYD', 'MEL'], 7)], jet, 'tail-1');
  const b = aircraftWeek([route('b', ['SYD', 'MEL'], 7)], jet, 'tail-2');
  assert.notEqual(a.blocks[0].start, b.blocks[0].start);
});

test('one tail on several routes: interleaved, never in two places at once', () => {
  const routes = [route('a', ['SYD', 'MEL'], 14), route('b', ['SYD', 'BNE'], 7), route('c', ['SYD', 'ADL'], 3)];
  const w = aircraftWeek(routes, jet);
  assert.equal(w.blocks.length, 24);
  noOverlap(w.blocks);
  const seq = w.blocks.map(b => b.routeId).join('');
  assert.ok(!/aaaa/.test(seq), `14× and 7× alternate rather than bunch: ${seq}`);
});

test('pins are honoured; the automatic rotations flow around them', () => {
  const w0 = aircraftWeek([route('a', ['SYD', 'MEL'], 7)], jet);
  const pin = wrapWeek(w0.blocks[2].start + 7 * 60);       // 7 hours later than auto
  const w = aircraftWeek([route('a', ['SYD', 'MEL'], 7, [pin])], jet);
  assert.equal(w.blocks.length, 7);
  assert.equal(w.blocks.filter(b => b.pinned).length, 1);
  assert.equal(w.blocks.find(b => b.pinned).start, pin);
  noOverlap(w.blocks);
  // The pin replaced the automatic flight nearest it, not one at random.
  const autoStarts = w.blocks.filter(b => !b.pinned).map(b => b.start);
  assert.ok(!autoStarts.includes(w0.blocks[2].start), 'its own automatic slot was taken over');
});

test('overlapping pins: the later one is demoted to automatic, never drawn on top', () => {
  const w = aircraftWeek([route('a', ['SYD', 'PER'], 7, [600]), route('b', ['SYD', 'MEL'], 7, [700])], jet);
  assert.deepEqual(w.demoted, [{ routeId: 'b', start: 700 }]);
  assert.equal(w.blocks.length, 14);
  noOverlap(w.blocks);
});

test('pins packed so tight the rest cannot fit report overflow instead of overlapping', () => {
  const rot = routeRotation(route('x', ['SYD', 'PER'], 1), jet);
  // Pin 4 of 5 rotations spread so no gap is left that's long enough.
  const step = Math.floor(WEEK_MIN / 4);
  const f = Math.floor((140 * 60) / rot.durMin);
  const w = aircraftWeek([route('a', ['SYD', 'PER'], f, [0, step, 2 * step, 3 * step])], jet);
  noOverlap(w.blocks);
  const placed = w.blocks.length + (w.overflow[0]?.count ?? 0);
  assert.equal(placed, f, 'every rotation is either placed or reported');
});

test('moves: only pins block a drop; pinning and unpinning edit one route', () => {
  const w = aircraftWeek([route('a', ['SYD', 'MEL'], 7, [600])], jet);
  const pinned = w.blocks.find(b => b.pinned);
  const auto = w.blocks.find(b => !b.pinned);
  assert.equal(canPlace(w, 'a', pinned.dur, pinned.start + 30, auto), false, 'onto a pin');
  assert.equal(canPlace(w, 'a', pinned.dur, pinned.start + 30, pinned), true, 'a pin may move over its old self');
  assert.equal(canPlace(w, 'a', auto.dur, auto.start + 10, auto), true, 'an automatic flight may move over its old self');
  // Editing a route pins it as shown, with only the moved flight changed.
  const all = w.blocks.map(b => b.start);
  const sorted = (xs) => [...xs].sort((x, y) => x - y);
  assert.deepEqual(pinsAfterMove(w, 'a', auto, 2000), sorted([...all.filter(s => s !== auto.start), 2000]));
  assert.deepEqual(pinsAfterMove(w, 'a', pinned, 2000), sorted([...all.filter(s => s !== 600), 2000]));
  assert.equal(pinsAfterMove(w, 'a', null, 3000).length, 7, 'a tray drop replaces one automatic flight');
  assert.ok(pinsAfterMove(w, 'a', null, 3000).includes(3000));
  assert.deepEqual(pinsAfterUnpin(w, 'a', 600), []);
});

test('departures: every leg of every rotation, timed from the block start', () => {
  const w = aircraftWeek([route('t', ['MCI', 'JFK', 'ORY'], 2)], jet);
  const deps = weekDepartures(w);
  assert.equal(deps.length, 8);
  const first = w.blocks[0];
  const legs = deps.filter(d => d.utcMin >= first.start && d.utcMin < first.start + first.dur);
  assert.deepEqual(legs.map(d => `${d.from}-${d.to}`), ['MCI-JFK', 'JFK-ORY', 'ORY-JFK', 'JFK-MCI']);
  assert.equal(legs[0].utcMin, first.start);
  assert.equal(legs[1].utcMin - legs[0].utcMin, first.legs[0].flightMin + first.legs[0].turnMin);
});

test('airline weeks: per tail, passenger and cargo, dormant seasonal routes take no time', () => {
  // A long-haul jet freighter (a 300 km/h C-46 can't fly HKG–NRT 3× a week).
  const fr = AIRCRAFT_TYPES.find(t => t.freighter && (t.cruiseKmh ?? 0) >= 800 && (t.range ?? 0) >= 9000);
  const st = {
    fleet: [{ id: 'p', typeId: jet.id }, { id: 'f', typeId: fr.id }],
    routes: [
      { ...route('a', ['SYD', 'MEL'], 7), aircraftId: 'p' },
      { ...route('s', ['SYD', 'HBA'], 3), aircraftId: 'p', season: { months: [12, 1, 2] } },
    ],
    cargoRoutes: [{ id: 'c', origin: 'HKG', destination: 'LAX', weeklyFrequency: 3, aircraftId: 'f' }],
  };
  const june = airlineWeeks(st, 6);
  assert.equal(june.get('p').blocks.length, 7);
  assert.equal(june.get('f').blocks.length, 3);
  assert.equal(airlineWeeks(st, 1).get('p').blocks.length, 10);
});

// ── Review fixes (2026-10-14) ────────────────────────────────────────────────
const startsOf = (w, id) => w.blocks.filter(b => b.routeId === id).map(b => b.start).sort((x, y) => x - y);
const applyPins = (routes, id, pins) => routes.map(r => (r.id === id ? { ...r, schedule: { starts: pins } } : r));

test('dragging an AUTOMATIC flight moves that flight — nothing else changes', () => {
  const routes = [route('a', ['LHR', 'CDG'], 7)];
  const w0 = aircraftWeek(routes, jet, 't');
  for (const k of [0, 3, 6]) {
    const from = w0.blocks[k];
    const to = wrapWeek(from.start + 2 * 1440 + 180);
    const w1 = aircraftWeek(applyPins(routes, 'a', pinsAfterMove(w0, 'a', from, to)), jet, 't');
    const want = [...startsOf(w0, 'a').filter(s => s !== from.start), to].sort((x, y) => x - y);
    assert.deepEqual(startsOf(w1, 'a'), want, `drag block ${k}`);
  }
});

test('nudging an automatic flight that had slid off its ideal slot still moves it', () => {
  const routes = [route('a', ['SYD', 'MEL'], 14), route('b', ['SYD', 'PER'], 4, [0, 2520, 5040, 7560])];
  const w0 = aircraftWeek(routes, jet, 't');
  const from = w0.blocks.find(b => b.routeId === 'a' && !b.pinned);
  const to = wrapWeek(from.start + 15);
  if (canPlace(w0, 'a', from.dur, to, null)) {
    const w1 = aircraftWeek(applyPins(routes, 'a', pinsAfterMove(w0, 'a', from, to)), jet, 't');
    assert.ok(startsOf(w1, 'a').includes(to));
    assert.ok(!startsOf(w1, 'a').includes(from.start), 'the old time is gone');
  }
});

test('a drag cannot land on the same route\u2019s other flights (they become pins); other routes\u2019 automatic flights move aside', () => {
  const routes = [route('a', ['SYD', 'PER'], 7), route('b', ['SYD', 'MEL'], 7)];
  const w0 = aircraftWeek(routes, jet, 't');
  const a0 = w0.blocks.find(b => b.routeId === 'a'), a2 = w0.blocks.filter(b => b.routeId === 'a')[2];
  const onto = wrapWeek(a2.start - 60);   // overlaps a2
  assert.equal(canPlace(w0, 'a', a0.dur, onto, a0), false, 'onto its own route');
  const b1 = w0.blocks.find(b => b.routeId === 'b');
  const ontoB = wrapWeek(b1.start + 5);
  if (w0.blocks.filter(b => b.routeId === 'a' && b !== a0).every(b => !overlaps(ontoB, a0.dur, b.start, b.dur))) {
    assert.equal(canPlace(w0, 'a', a0.dur, ontoB, a0), true, 'onto an automatic flight of another route');
    const w1 = aircraftWeek(applyPins(routes, 'a', pinsAfterMove(w0, 'a', a0, ontoB)), jet, 't');
    assert.ok(startsOf(w1, 'a').includes(ontoB) && !startsOf(w1, 'a').includes(a0.start));
    noOverlap(w1.blocks);
    assert.equal(startsOf(w1, 'b').length, 7, 'route b moved aside, nothing lost');
  }
});

test('every accepted move lands exactly where it was dropped (fuzz)', () => {
  const routes = [route('a', ['SYD', 'PER'], 7), route('b', ['SYD', 'MEL'], 10), route('c', ['SYD', 'BNE'], 5, [300, 3000])];
  const w0 = aircraftWeek(routes, jet, 't');
  let accepted = 0;
  for (let k = 0; k < 400; k++) {
    const from = w0.blocks[k % w0.blocks.length];
    const to = wrapWeek(from.start + ((k * 397) % WEEK_MIN));
    if (!canPlace(w0, from.routeId, from.dur, to, from)) continue;
    accepted++;
    const w1 = aircraftWeek(applyPins(routes, from.routeId, pinsAfterMove(w0, from.routeId, from, to)), jet, 't');
    assert.ok(startsOf(w1, from.routeId).includes(to), `landed at ${to}`);
    assert.deepEqual(w1.demoted, []);
    noOverlap(w1.blocks);
  }
  assert.ok(accepted > 20, `${accepted} moves tried`);
});

test('dropping from the tray replaces the automatic flight nearest the drop', () => {
  const routes = [route('a', ['LHR', 'CDG'], 7)];
  const w0 = aircraftWeek(routes, jet, 't');
  const target = w0.blocks[4];
  const to = wrapWeek(target.start + 60);
  const w1 = aircraftWeek(applyPins(routes, 'a', pinsAfterMove(w0, 'a', null, to)), jet, 't');
  const want = [...startsOf(w0, 'a').filter(s => s !== target.start), to].sort((x, y) => x - y);
  assert.deepEqual(startsOf(w1, 'a'), want);
});

test('route order is by code point, not the browser locale (same timetable everywhere)', () => {
  // 'B' < 'a' by code point; localeCompare says the opposite. The first route
  // sets the anchor zone, so the order changes every time on the week.
  const w = aircraftWeek([route('a', ['SYD', 'MEL'], 7), route('B', ['LHR', 'CDG'], 7)], jet, '');
  const lhrSix = wrapWeek(6 * 60 - 0);
  assert.ok(wrapWeek(w.anchor - lhrSix) <= 180, `anchored on LHR (route 'B' first), got ${w.anchor}`);
});

test('several tails on one pair never leave at the same minute', () => {
  const ids = ['mg7x2k1', 'mg7x2k9', 'mh01aa', 'mh01ab', 'q9', 'zz3'];
  const st = {
    fleet: ids.map(id => ({ id, typeId: jet.id })),
    routes: ids.map((id, i) => ({ ...route(`r${i}`, ['SYD', 'MEL'], 7), aircraftId: id })),
  };
  const firsts = [...airlineWeeks(st, 3).values()].map(w => w.blocks[0].start % 1440).sort((x, y) => x - y);
  for (let i = 1; i < firsts.length; i++) assert.ok(firsts[i] - firsts[i - 1] >= 5, `departures ${firsts}`);
});

test('more time zones: Boise (Mountain), Las Vegas, Spokane, Yakutsk, Vladivostok', () => {
  const want = { BOI: -7, LAS: -8, GEG: -8, YKS: 9, VVO: 10, KHV: 10, IKT: 8 };
  for (const [c, h] of Object.entries(want)) assert.equal(utcOffsetHours(getAirport(c)), h, c);
});

// ── Audit round 2 (2026-10-14) ───────────────────────────────────────────────
test('a dragged block that is a stale copy (state replaced mid-drag) still moves the right flight', () => {
  const routes = [route('a', ['SYD', 'MEL'], 7)];
  const w0 = aircraftWeek(routes, jet, 't');
  const stale = { ...w0.blocks[0], legs: [...w0.blocks[0].legs] };   // same flight, new object
  const wNow = aircraftWeek(routes, jet, 't');                         // the "new state" week
  const to = wrapWeek(stale.start + 2 * 1440 + 120);
  assert.equal(canPlace(wNow, 'a', stale.dur, wrapWeek(stale.start + 30), stale), true, 'a short move is not blocked by its own old copy');
  const pins = pinsAfterMove(wNow, 'a', stale, to);
  assert.equal(pins.length, 7, `never more pins than flights: ${pins}`);
  assert.ok(pins.includes(to) && !pins.includes(stale.start));
});

test('a move whose flight no longer exists is refused, not guessed', () => {
  const w = aircraftWeek([route('a', ['SYD', 'MEL'], 7)], jet, 't');
  const ghost = { ...w.blocks[0], start: wrapWeek(w.blocks[0].start + 7) };
  assert.equal(pinsAfterMove(w, 'a', ghost, 100), null);
  const full = aircraftWeek([route('b', ['SYD', 'MEL'], 2, [0, 5000])], jet, 't');
  assert.equal(pinsAfterMove(full, 'b', null, 3000), null, 'a tray drop with nothing automatic left');
});

test('time-zone corrections for airports a longitude rule gets wrong', () => {
  const want = { AMA: -6, LBB: -6, MAF: -6, YUM: -7, DHN: -6, ESC: -5, ADK: -10, YQR: -6, YXE: -6, YLW: -8,
    YXY: -7, TPQ: -7, CTM: -5, IGU: -3, STM: -3, TBT: -4, FEN: -2, AMQ: 9, TTE: 9, ASF: 4, IJK: 4, SCW: 3,
    VKT: 3, SGC: 5, NJC: 5, NUX: 5, DYR: 12, TKK: 10, PUQ: -3 };
  for (const [c, h] of Object.entries(want)) {
    const a = getAirport(c);
    if (a) assert.equal(utcOffsetHours(a), h, c);
  }
});

test('adding a tail to a busy pair leaves the other tails’ automatic times alone', () => {
  const ids = ['mg7x2k1', 'mg7x2k9', 'mh01aa', 'mh01ab', 'q9'];
  const mk = (list) => ({
    fleet: list.map(id => ({ id, typeId: jet.id })),
    routes: list.map(id => ({ ...route(`r-${id}`, ['SYD', 'MEL'], 7), aircraftId: id })),
  });
  const before = airlineWeeks(mk(ids), 3), after = airlineWeeks(mk([...ids, 'n3w']), 3);
  const moved = ids.filter(id => before.get(id).blocks[0].start !== after.get(id).blocks[0].start);
  assert.ok(moved.length <= 1, `moved: ${moved}`);
});


// ── Reducer ──────────────────────────────────────────────────────────────────
const base = () => ({
  ...freshState(),
  fleet: [{ id: 'p', typeId: jet.id, status: 'assigned' }],
  routes: [{ ...route('a', ['SYD', 'MEL'], 3), aircraftId: 'p' }],
  cargoRoutes: [{ id: 'c', origin: 'HKG', destination: 'LAX', weeklyFrequency: 2, aircraftId: 'p' }],
});

test('SET_ROUTE_SCHEDULES pins, clamps to frequency, clears, and reaches cargo', () => {
  let s = gameReducer(base(), { type: 'SET_ROUTE_SCHEDULES', schedules: { a: [900, 100, 5000, 7000], c: [60] } });
  assert.deepEqual(s.routes[0].schedule, { starts: [100, 900, 5000] });
  assert.deepEqual(s.cargoRoutes[0].schedule, { starts: [60] });
  s = gameReducer(s, { type: 'SET_ROUTE_SCHEDULES', schedules: { a: null } });
  assert.equal('schedule' in s.routes[0], false, 'null → back to automatic');
  assert.deepEqual(s.cargoRoutes[0].schedule, { starts: [60] }, 'untouched routes keep their pins');
});

test('SET_ROUTE_SCHEDULES changes nothing else (cash, frequency) and ignores unknown routes', () => {
  const b = base();
  const s = gameReducer(b, { type: 'SET_ROUTE_SCHEDULES', schedules: { a: [100] } });
  assert.equal(s.cash, b.cash);
  assert.equal(s.routes[0].weeklyFrequency, 3);
  assert.equal(gameReducer(b, { type: 'SET_ROUTE_SCHEDULES', schedules: { nope: [1] } }), b);
  assert.equal(gameReducer(b, { type: 'SET_ROUTE_SCHEDULES' }), b);
});

test('SET_ROUTE_SCHEDULES that changes nothing returns the same state (no autosave)', () => {
  const b = base();
  assert.equal(gameReducer(b, { type: 'SET_ROUTE_SCHEDULES', schedules: { a: null } }), b, 'clearing nothing');
  const s1 = gameReducer(b, { type: 'SET_ROUTE_SCHEDULES', schedules: { a: [100, 900] } });
  assert.equal(gameReducer(s1, { type: 'SET_ROUTE_SCHEDULES', schedules: { a: [900, 100] } }), s1, 'same pins');
});

// A real game (START_GAME at SYD) so REASSIGN_ROUTE and TRANSFER_ROUTES pass
// their compatibility checks — Headwinds' version of this test asserted only
// `if` the move went through.
function sydWorld(extra = {}) {
  const s = gameReducer(freshState(), { type: 'START_GAME', airlineName: 'Timetable Air', hub: 'SYD', enableObjectives: false });
  const tail = (id, status) => ({ id, typeId: jet.id, name: id, tailNumber: id.toUpperCase(), status,
    ageWeeks: 52, ownershipType: 'owned', config: { economy: jet.seats } });
  const r = (id, d, ac, starts) => ({ ...route(id, ['SYD', d], 3, starts), aircraftId: ac,
    weeksOpen: 40, hub: 'SYD', ticketPrice: 180, cateringLevel: 'full' });
  return {
    ...s,
    cash: 500_000_000,
    gates: { ...(s.gates ?? {}), SYD: 20, MEL: 6, BNE: 6, ADL: 6 },
    fleet: [tail('p', 'assigned'), tail('q', 'assigned'), tail('z', 'idle'), tail('w', 'assigned')],
    routes: [
      r('a', 'MEL', 'p', [100, 2000, 4000]),
      r('b', 'BNE', 'q', [150, 2050, 4050]),
    ],
    cargoRoutes: [],
    charters: [],
    ...extra,
  };
}

test('reassigning a route onto a busy tail returns it to automatic; the incumbent keeps its times', () => {
  const st = sydWorld();
  const re = gameReducer(st, { type: 'REASSIGN_ROUTE', routeId: 'a', toAircraftId: 'q' });
  assert.notEqual(re, st, 'the reassign went through');
  assert.equal(re.routes.find(r => r.id === 'a').aircraftId, 'q');
  assert.equal(re.routes.find(r => r.id === 'a').schedule, undefined, 'its pins would clash with the tail it joined');
  assert.deepEqual(re.routes.find(r => r.id === 'b').schedule, { starts: [150, 2050, 4050] });
});

test('reassigning onto an IDLE tail keeps the pins; transferring a whole week keeps them too', () => {
  const st = sydWorld();
  const re = gameReducer(st, { type: 'REASSIGN_ROUTE', routeId: 'a', toAircraftId: 'z' });
  assert.notEqual(re, st);
  assert.deepEqual(re.routes.find(r => r.id === 'a').schedule, { starts: [100, 2000, 4000] });
  const tr = gameReducer(st, { type: 'TRANSFER_ROUTES', fromAircraftId: 'p', toAircraftId: 'z' });
  assert.notEqual(tr, st, 'the transfer went through');
  assert.deepEqual(tr.routes.find(r => r.id === 'a').schedule, { starts: [100, 2000, 4000] });
});

// ── Charters (Tailwinds only) ─────────────────────────────────────────────────
// Contract records carry the same shape as a route (charterOpRecord): origin,
// destination, stops, aircraftId, weeklyFrequency and `charter: true`.
const charter = (id, o, d, f, ac, extra = {}) => ({
  id, charter: true, origin: o, destination: d, stops: [o, d], aircraftId: ac, weeklyFrequency: f,
  status: 'active', name: 'Sports team', customer: 'Test FC', ...extra,
});

test('a charter takes its time on its tail; a finished one takes none', () => {
  const st = {
    fleet: [{ id: 'p', typeId: jet.id }],
    routes: [{ ...route('a', ['SYD', 'MEL'], 7), aircraftId: 'p' }],
    charters: [charter('k1', 'SYD', 'OOL', 2, 'p'), charter('k2', 'SYD', 'CNS', 3, 'p', { status: 'completed' })],
  };
  const w = airlineWeeks(st, 6).get('p');
  assert.equal(w.blocks.filter(b => b.routeId === 'k1').length, 2, 'the active charter, twice a week');
  assert.ok(w.blocks.filter(b => b.routeId === 'k1').every(b => b.charter), 'flagged as a charter');
  assert.equal(w.blocks.filter(b => b.routeId === 'k2').length, 0, 'a completed contract holds nothing');
  assert.equal(w.blocks.filter(b => b.routeId === 'a').length, 7);
  noOverlap(w.blocks);
  const positioning = airlineWeeks({ ...st, charters: [charter('k1', 'SYD', 'OOL', 2, 'p', { status: 'positioning' })] }, 6).get('p');
  assert.equal(positioning.blocks.filter(b => b.charter).length, 2, 'positioning holds the tail like a job in hand');
});

test('a tail flying only a charter still gets a week', () => {
  const st = { fleet: [{ id: 'j', typeId: jet.id }], routes: [], charters: [charter('k', 'SYD', 'OOL', 3, 'j')] };
  const w = airlineWeeks(st, 6).get('j');
  assert.equal(w.blocks.length, 3);
  assert.ok(w.blocks.every(b => b.charter && !b.pinned));
});

test('a charter is never pinned, even if it carries times', () => {
  const k = { ...charter('k', 'SYD', 'OOL', 2, 'p'), schedule: { starts: [100, 3000] } };
  const w = aircraftWeek([k, route('a', ['SYD', 'MEL'], 7)], jet, 'p');
  const kb = w.blocks.filter(b => b.routeId === 'k');
  assert.equal(kb.length, 2);
  assert.ok(kb.every(b => b.charter && !b.pinned), 'flagged as a charter, never pinned');
  assert.ok(!kb.some(b => b.start === 100 || b.start === 3000), 'the stray times are ignored');
});

test('a charter can’t be moved, and nothing can be dropped on it', () => {
  const w = aircraftWeek([charter('k', 'SYD', 'OOL', 2, 'p'), route('a', ['SYD', 'MEL'], 7)], jet, 'p');
  const kb = w.blocks.find(b => b.charter);
  const a0 = w.blocks.find(b => b.routeId === 'a');
  assert.equal(canPlace(w, 'k', kb.dur, wrapWeek(kb.start + 600), kb), false, 'moving the charter');
  assert.equal(pinsAfterMove(w, 'k', kb, wrapWeek(kb.start + 600)), null);
  assert.equal(canPlace(w, 'a', a0.dur, wrapWeek(kb.start + 10), a0), false, 'a flight onto the charter');
});

test('the charter’s times never move because of something the player does', () => {
  const k = charter('k', 'SYD', 'OOL', 3, 'p');
  const routes = [route('a', ['SYD', 'MEL'], 10), route('b', ['SYD', 'BNE'], 4)];
  const kStarts = (w) => w.blocks.filter(b => b.routeId === 'k').map(b => b.start);
  const w0 = aircraftWeek([k, ...routes], jet, 'p');
  assert.equal(kStarts(w0).length, 3);
  // Pin one of a's flights somewhere legal.
  const from = w0.blocks.find(b => b.routeId === 'a');
  let to = null;
  for (let m = 0; m < WEEK_MIN && to == null; m += 35) {
    const t = wrapWeek(from.start + m);
    if (t !== from.start && canPlace(w0, 'a', from.dur, t, from)) to = t;
  }
  assert.ok(to != null);
  const pinned = routes.map(r => (r.id === 'a' ? { ...r, schedule: { starts: pinsAfterMove(w0, 'a', from, to) } } : r));
  const w1 = aircraftWeek([k, ...pinned], jet, 'p');
  assert.ok(w1.blocks.some(b => b.routeId === 'a' && b.pinned && b.start === to), 'the pin landed');
  assert.deepEqual(kStarts(w1), kStarts(w0), 'after a pin');
  const w2 = aircraftWeek([k, ...pinned, route('c', ['SYD', 'ADL'], 3)], jet, 'p');
  assert.deepEqual(kStarts(w2), kStarts(w0), 'after another route joins the tail');
  noOverlap(w1.blocks);
  noOverlap(w2.blocks);
});

test('a tail with no charter gets exactly the week it got before charters existed', () => {
  // The charter step is skipped outright: same routes in, same week out,
  // whether or not some OTHER tail is flying a charter.
  const st = {
    fleet: [{ id: 'p', typeId: jet.id }, { id: 'j', typeId: jet.id }],
    routes: [{ ...route('a', ['SYD', 'MEL'], 10), aircraftId: 'p' }, { ...route('b', ['SYD', 'BNE'], 4, [300]), aircraftId: 'p' }],
  };
  const without = airlineWeeks(st, 6).get('p');
  const withOther = airlineWeeks({ ...st, charters: [charter('k', 'SYD', 'OOL', 2, 'j')] }, 6).get('p');
  assert.deepEqual(withOther.blocks.map(b => [b.routeId, b.start, b.pinned]), without.blocks.map(b => [b.routeId, b.start, b.pinned]));
});

test('SET_ROUTE_SCHEDULES never reaches a charter', () => {
  const b = { ...base(), charters: [charter('k', 'SYD', 'OOL', 2, 'p')] };
  assert.equal(gameReducer(b, { type: 'SET_ROUTE_SCHEDULES', schedules: { k: [100] } }), b);
});

test('reassigning a route onto a tail flying a charter returns it to automatic', () => {
  const st = sydWorld({ charters: [charter('k', 'SYD', 'OOL', 1, 'z')] });
  const re = gameReducer(st, { type: 'REASSIGN_ROUTE', routeId: 'a', toAircraftId: 'z' });
  assert.notEqual(re, st, 'the reassign went through');
  assert.equal(re.routes.find(r => r.id === 'a').schedule, undefined);
});

console.log(`\nschedule-test: ${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
