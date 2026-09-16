// Charter contracts, package 2: block hours, the acceptance guard, the actions.
//
// ── The bug this file exists to prevent ─────────────────────────────────────
// A charter books the same airframe for the same weeks as a scheduled rotation.
// If a block-hour reading forgets to count it, the tail reads as emptier than it
// is, the route pickers offer it as available, and the reducer happily takes a
// second full load — which is exactly the failure the reserve-cover work hit in
// 2026 ("a tail with its network out on cover looked EMPTY to every guard").
// The difference is that a double-booked CHARTER does not merely lose revenue:
// it breaches a signed contract and charges a penalty.
//
// So the first test here is STATIC. It reads the app's own source and requires
// every call site of the block-hour family to pass the charters list. Adding a
// new call site without it fails this suite rather than a player's save.
//
//   node --import ./tools/_register-loader.mjs tools/charter-blockhours-test.mjs

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  routesCommittedTo, committedPeakBlockHours, activeCharterOps, routeBlockHours,
  MAX_WEEKLY_BLOCK_HOURS, trimOverCapSchedules, blockTimeHours, routeDistanceKm,
} from '../src/utils/simulation.js';
import { generateCharterBoard, servedAirportsOf, aircraftStationOf } from '../src/models/charterBoard.js';
import {
  CHARTER_RELIABILITY_START, CHARTER_RELIABILITY_ON_BREACH, applyReliability,
} from '../src/data/charters.js';
import { getAircraftType } from '../src/data/aircraft.js';

const {
  gameReducer: reducer, freshState, reconcileState,
  charterAcceptBlockReason, charterOpRecord, addRouteBlockReason,
} = await import('../src/store/GameContext.jsx');

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.log(`  ✗ ${name}\n      ${(e.stack || e.message).split('\n').slice(0, 5).join('\n      ')}`); failed++; }
}

// ── 1. Static: no call site may forget the charters list ─────────────────────

// Every function whose answer is "how many hours is this tail on the hook for".
const GUARDED = [
  'routesCommittedTo', 'committedBlockHoursByMonth', 'committedPeakBlockHours',
  'committedPeakBlockHoursIn', 'aircraftHubMaintFactor', 'blockHourFit',
  'aircraftUtilization', 'deployableFleetForRoute',
];

function sourceFiles() {
  const out = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) { walk(full); continue; }
      if (!/\.(js|jsx)$/.test(entry.name)) continue;
      if (/\.(bak|pre[a-z0-9]*)$/.test(entry.name)) continue;
      out.push(full);
    }
  };
  walk(path.join(ROOT, 'src'));
  return out;
}

/**
 * Strip comments and string bodies so a prose mention of a function — the file
 * header in Fleet.jsx says "aircraftUtilization() in ..." — is not read as a
 * call site. Quote-aware, so a `//` inside a URL in a string survives as string
 * content rather than swallowing the rest of the line.
 */
function stripCommentsAndStrings(src) {
  let out = '';
  let i = 0;
  const n = src.length;
  while (i < n) {
    const ch = src[i], next = src[i + 1];
    if (ch === '/' && next === '/') {
      while (i < n && src[i] !== '\n') i++;
      continue;
    }
    if (ch === '/' && next === '*') {
      i += 2;
      while (i < n && !(src[i] === '*' && src[i + 1] === '/')) i++;
      i += 2;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === '`') {
      const quote = ch;
      out += ' ';
      i++;
      while (i < n) {
        if (src[i] === '\\') { i += 2; continue; }
        if (src[i] === quote) { i++; break; }
        // Keep template-literal ${...} content: a call can legitimately live there.
        if (quote === '`' && src[i] === '$' && src[i + 1] === '{') {
          let depth = 1; i += 2; out += ' ';
          const start = i;
          while (i < n && depth > 0) {
            if (src[i] === '{') depth++;
            else if (src[i] === '}') depth--;
            i++;
          }
          out += src.slice(start, i - 1);
          continue;
        }
        i++;
      }
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}

/** Extract the balanced argument text of every call to `name` in `src`. */
function callArgs(src, name) {
  const calls = [];
  const re = new RegExp(`(^|[^\\w.])${name}\\s*\\(`, 'g');
  let m;
  while ((m = re.exec(src)) != null) {
    // Skip the declaration itself.
    const before = src.slice(Math.max(0, m.index - 20), m.index + m[0].length);
    if (/function\s+$/.test(before.slice(0, before.length - name.length - 1))) continue;
    let i = m.index + m[0].length, depth = 1;
    while (i < src.length && depth > 0) {
      const ch = src[i];
      if (ch === '(') depth++;
      else if (ch === ')') depth--;
      i++;
    }
    calls.push({ args: src.slice(m.index + m[0].length, i - 1), index: m.index });
  }
  return calls;
}

test('every block-hour call site in the app passes the charters list', () => {
  const misses = [];
  for (const file of sourceFiles()) {
    const raw = fs.readFileSync(file, 'utf8');
    const src = stripCommentsAndStrings(raw);
    const rel = path.relative(ROOT, file);
    for (const name of GUARDED) {
      if (!src.includes(name)) continue;
      for (const call of callArgs(src, name)) {
        if (/charter/i.test(call.args)) continue;
        const line = src.slice(0, call.index).split('\n').length;
        misses.push(`${rel}:${line}  ${name}(${call.args.replace(/\s+/g, ' ').slice(0, 70)})`);
      }
    }
  }
  assert.equal(misses.length, 0,
    `these call sites would under-count a tail's committed hours and let it be double-booked ` +
    `into a charter breach:\n      ${misses.join('\n      ')}`);
});

test('the guarded list still matches what simulation.js actually exports', () => {
  const src = read('src/utils/simulation.js');
  for (const name of GUARDED) {
    assert.ok(src.includes(`export function ${name}(`),
      `${name} is in the guarded list but simulation.js no longer exports it`);
  }
});

// ── Fixture ──────────────────────────────────────────────────────────────────

const TYPE = 'b7878';

function baseState(over = {}) {
  const type = getAircraftType(TYPE);
  return {
    ...freshState(),
    phase: 'playing',
    airlineName: 'Charter Test Air', hub: 'SFO', homeCountry: 'US',
    cash: 50_000_000,
    week: 30, year: 1,
    gates: { SFO: 4, LAX: 2 },
    hubs:  { SFO: { tier: 2 } },
    awareness: 60,
    gameDate: { month: 7 },
    fuelPrice: { index: 1.0, history: [] },
    lastReport: { reputationScore: 60 },
    fleet: [
      { id: 'ac1', typeId: TYPE, name: 'Tail One', tailNumber: 'N1TA', status: 'idle',
        ageWeeks: 60, ownershipType: 'owned', fuelMod: 1.0, config: null },
      { id: 'ac2', typeId: TYPE, name: 'Tail Two', tailNumber: 'N2TA', status: 'idle',
        ageWeeks: 60, ownershipType: 'owned', fuelMod: 1.0, config: null },
    ],
    routes: [], cargoRoutes: [], charters: [], charterDismissed: [],
    charterReliability: CHARTER_RELIABILITY_START,
    ...over,
  };
}

/** The absolute week the reducer will build the board for. */
const absOf = (st) => ((st.year ?? 1) - 1) * 52 + (st.week ?? 1);

/** The board the guard and the reducer will actually see for this state. */
const boardOf = (st) => generateCharterBoard(st, absOf(st));

/** The first offer on the board this tail can actually sign. */
function signableOffer(state, aircraftId = 'ac1') {
  for (const o of boardOf(state)) {
    if (!charterAcceptBlockReason(state, o.id, aircraftId)) return o;
  }
  return null;
}

// ── 2. A charter costs block hours ───────────────────────────────────────────

test('an active charter is on the tail’s books', () => {
  const c = { ...charterOpRecord({ id: 'o1', origin: 'SFO', destination: 'JFK', flightsPerWeek: 4 }, 'ac1'), status: 'active' };
  const committed = routesCommittedTo('ac1', [], [], [c]);
  assert.equal(committed.length, 1);
  assert.equal(committed[0].weeklyFrequency, 4);
});

test('a contract still positioning is on the books too — the tail is flying an empty leg', () => {
  const c = { ...charterOpRecord({ id: 'o1', origin: 'SFO', destination: 'JFK', flightsPerWeek: 4 }, 'ac1'), status: 'positioning' };
  assert.equal(routesCommittedTo('ac1', [], [], [c]).length, 1);
});

test('a finished or breached contract holds nothing', () => {
  for (const status of ['complete', 'breached']) {
    const c = { ...charterOpRecord({ id: 'o1', origin: 'SFO', destination: 'JFK', flightsPerWeek: 4 }, 'ac1'), status };
    assert.equal(routesCommittedTo('ac1', [], [], [c]).length, 0, `${status} contract still held the tail`);
    assert.equal(activeCharterOps([c]).length, 0);
  }
});

test('charter hours show up in the peak reading the cap governs', () => {
  const type = getAircraftType(TYPE);
  const c = { ...charterOpRecord({ id: 'o1', origin: 'SFO', destination: 'JFK', flightsPerWeek: 4 }, 'ac1'), status: 'active' };
  const without = committedPeakBlockHours('ac1', type, [], [], []);
  const with_   = committedPeakBlockHours('ac1', type, [], [], [c]);
  assert.equal(without, 0);
  assert.ok(with_ > 0);
  assert.equal(Math.round(with_), Math.round(routeBlockHours(c, type, 4)));
});

test('a tail already full of charter cannot also be given a route', () => {
  // THE bug this package is about: without charter-aware block hours the route
  // guard sees an empty aircraft and double-books it.
  const type = getAircraftType(TYPE);
  const perFlight = blockTimeHours(routeDistanceKm('SFO', 'JFK'), type) * 2;
  const freq = Math.floor(MAX_WEEKLY_BLOCK_HOURS / perFlight);   // fills the tail
  const c = {
    ...charterOpRecord({ id: 'o1', origin: 'SFO', destination: 'JFK', flightsPerWeek: freq }, 'ac1'),
    status: 'active',
  };
  const st = baseState({ charters: [c] });
  const reason = addRouteBlockReason(st, {
    type: 'ADD_ROUTE', origin: 'SFO', destination: 'LAX', aircraftId: 'ac1', weeklyFrequency: 7,
  });
  assert.ok(reason, 'the route guard let a fully-chartered tail take a route as well');
  assert.match(reason, /spare flying hours/i);
});

test('with no charters, every reading is exactly what it was before', () => {
  const type = getAircraftType(TYPE);
  const routes = [{ id: 'r1', origin: 'SFO', destination: 'LAX', aircraftId: 'ac1', weeklyFrequency: 14 }];
  assert.deepEqual(routesCommittedTo('ac1', routes, [], []), routesCommittedTo('ac1', routes, []));
  assert.equal(committedPeakBlockHours('ac1', type, routes, [], []),
               committedPeakBlockHours('ac1', type, routes, []));
});

// ── 3. The acceptance guard ──────────────────────────────────────────────────

test('an offer that is not on the board cannot be signed', () => {
  const st = baseState();
  assert.match(charterAcceptBlockReason(st, 'chtr-9-9999-zzz', 'ac1'), /no longer on the board/);
});

test('the guard names the blocker in player-facing language', () => {
  const st = baseState();
  const offer = boardOf(st)[0];
  assert.ok(offer);
  assert.match(charterAcceptBlockReason(st, offer.id, 'nope'), /not found/i);
  const retired = baseState({ fleet: [{ ...baseState().fleet[0], status: 'retired' }] });
  assert.match(charterAcceptBlockReason(retired, offer.id, 'ac1'), /retired/i);
});

test('a passenger contract refuses a freighter, and a freight one refuses a passenger jet', () => {
  const st = baseState();
  const freighterFleet = baseState({
    fleet: [{ id: 'ac1', typeId: 'b777f', name: 'Freight One', status: 'idle', ageWeeks: 40,
              ownershipType: 'owned', fuelMod: 1.0 }],
  });
  let checkedPax = false, checkedFrt = false;
  // Walk the weeks until the board has offered one of each, checking the guard
  // against the mismatched fleet at the SAME week the guard will build for.
  // Each fleet gets ITS OWN board: the board follows the metal (charterFleetFit),
  // so the freighter airline and the passenger airline are not shown the same
  // slate, and a slot id names a different contract on each.
  for (let w = 0; w < 300 && !(checkedPax && checkedFrt); w++) {
    const at = { ...st, year: Math.floor(w / 52) + 1, week: (w % 52) + 1 };
    const frtAt = { ...freighterFleet, year: at.year, week: at.week };
    for (const o of generateCharterBoard(at, absOf(at))) {
      if (o.freighter && !checkedFrt) {
        // A passenger jet offered a freight contract.
        assert.match(charterAcceptBlockReason(at, o.id, 'ac1') ?? '', /not a freighter/i);
        checkedFrt = true;
      }
    }
    for (const o of generateCharterBoard(frtAt, absOf(frtAt))) {
      if (!o.freighter && !checkedPax) {
        assert.match(charterAcceptBlockReason(frtAt, o.id, 'ac1') ?? '', /is a freighter/i);
        checkedPax = true;
      }
    }
  }
  assert.ok(checkedPax && checkedFrt, 'the board never produced both a pax and a freight contract');
});

// ── 4. The actions ───────────────────────────────────────────────────────────

test('signing a contract books the tail, pays the permits and starts the clock', () => {
  const st = baseState();
  const offer = signableOffer(st);
  assert.ok(offer, 'nothing on the board could be signed');
  const next = reducer(st, { type: 'ACCEPT_CHARTER', offerId: offer.id, aircraftId: 'ac1' });
  assert.equal(next.charters.length, 1);
  const c = next.charters[0];
  assert.equal(c.aircraftId, 'ac1');
  assert.equal(c.weeksRemaining, offer.weeks);
  assert.equal(c.fee, offer.fee);
  assert.equal(c.weeklyFrequency, offer.flightsPerWeek);
  assert.ok(['active', 'positioning'].includes(c.status));
  assert.equal(next.cash, st.cash - c.permitsPaid);
  assert.equal(next.fleet.find(a => a.id === 'ac1').status, 'assigned');
});

test('a signed contract immediately counts against the tail’s hours', () => {
  const st = baseState();
  const offer = signableOffer(st);
  const next = reducer(st, { type: 'ACCEPT_CHARTER', offerId: offer.id, aircraftId: 'ac1' });
  const type = getAircraftType(TYPE);
  assert.ok(committedPeakBlockHours('ac1', type, next.routes, next.cargoRoutes, next.charters) > 0);
});

test('a blocked contract changes nothing at all', () => {
  const st = baseState({ cash: 0 });
  const offer = boardOf(st)[0];
  const next = reducer(st, { type: 'ACCEPT_CHARTER', offerId: offer.id, aircraftId: 'ac1' });
  assert.equal(next, st, 'a refused acceptance still produced a new state');
});

test('a tail sitting where the work starts needs no positioning; one elsewhere does', () => {
  const st = baseState();
  let hubOffer = null, awayOffer = null;
  for (let w = 0; w < 300 && !(hubOffer && awayOffer); w++) {
    for (const o of generateCharterBoard(st, w)) {
      if (o.origin === 'SFO' && !hubOffer) hubOffer = o;
      if (o.origin !== 'SFO' && !awayOffer) awayOffer = o;
    }
  }
  // An idle tail with no routes is at the hub (aircraftStationOf).
  assert.equal(aircraftStationOf(st.fleet[0], { routes: [], cargoRoutes: [], charters: [], hub: 'SFO' }), 'SFO');
  if (hubOffer && !charterAcceptBlockReason(st, hubOffer.id, 'ac1')) {
    const n = reducer(st, { type: 'ACCEPT_CHARTER', offerId: hubOffer.id, aircraftId: 'ac1' });
    assert.equal(n.charters[0].status, 'active');
    assert.equal(n.charters[0].ferryCost, 0);
  }
  if (awayOffer && !charterAcceptBlockReason(st, awayOffer.id, 'ac1')) {
    const n = reducer(st, { type: 'ACCEPT_CHARTER', offerId: awayOffer.id, aircraftId: 'ac1' });
    assert.equal(n.charters[0].status, 'positioning');
    assert.ok(n.charters[0].ferryCost > 0, 'an empty leg to the pickup cost nothing');
  }
});

test('dismissing an offer takes it off the board and does not grow forever', () => {
  const st = baseState();
  const offer = boardOf(st)[0];
  const next = reducer(st, { type: 'DISMISS_CHARTER_OFFER', offerId: offer.id });
  assert.ok(next.charterDismissed.includes(offer.id));
  assert.ok(!boardOf(next).some(o => o.id === offer.id));
  const stale = reducer({ ...next, week: 1, year: 40 }, { type: 'DISMISS_CHARTER_OFFER', offerId: 'chtr-0-5-aaa' });
  assert.ok(stale.charterDismissed.length <= 1, 'expired dismissals were not pruned');
});

test('walking away costs the penalty and the record, and frees the tail', () => {
  const st = baseState();
  const offer = signableOffer(st);
  const signed = reducer(st, { type: 'ACCEPT_CHARTER', offerId: offer.id, aircraftId: 'ac1' });
  const c = signed.charters[0];
  const out = reducer(signed, { type: 'CANCEL_CHARTER', charterId: c.id });
  assert.equal(out.charters.length, 0);
  assert.equal(out.cash, signed.cash - c.breachPenalty);
  assert.equal(out.charterReliability,
    applyReliability(CHARTER_RELIABILITY_START, CHARTER_RELIABILITY_ON_BREACH));
  assert.equal(out.fleet.find(a => a.id === 'ac1').status, 'idle');
});

test('a tail still flying a route stays assigned when a contract is cancelled', () => {
  const st = baseState({
    routes: [{ id: 'r1', origin: 'SFO', destination: 'LAX', aircraftId: 'ac1', weeklyFrequency: 3,
               stops: ['SFO', 'LAX'] }],
  });
  const offer = signableOffer(st);
  if (!offer) return;                     // nothing signable this fixture week
  const signed = reducer(st, { type: 'ACCEPT_CHARTER', offerId: offer.id, aircraftId: 'ac1' });
  const out = reducer(signed, { type: 'CANCEL_CHARTER', charterId: signed.charters[0].id });
  assert.equal(out.fleet.find(a => a.id === 'ac1').status, 'assigned');
});

test('a contract can be moved to another qualifying tail', () => {
  const st = baseState();
  const offer = signableOffer(st);
  const signed = reducer(st, { type: 'ACCEPT_CHARTER', offerId: offer.id, aircraftId: 'ac1' });
  const moved = reducer(signed, {
    type: 'REASSIGN_CHARTER', charterId: signed.charters[0].id, aircraftId: 'ac2',
  });
  assert.equal(moved.charters[0].aircraftId, 'ac2');
  assert.equal(moved.fleet.find(a => a.id === 'ac2').status, 'assigned');
  assert.equal(moved.fleet.find(a => a.id === 'ac1').status, 'idle');
});

test('a contract cannot be moved to a tail that cannot do the job', () => {
  const st = baseState({
    fleet: [
      ...baseState().fleet,
      { id: 'tiny', typeId: 'atr72600', name: 'Tiny', status: 'idle', ageWeeks: 20,
        ownershipType: 'owned', fuelMod: 1.0 },
    ],
  });
  const offer = signableOffer(st);
  const signed = reducer(st, { type: 'ACCEPT_CHARTER', offerId: offer.id, aircraftId: 'ac1' });
  const moved = reducer(signed, {
    type: 'REASSIGN_CHARTER', charterId: signed.charters[0].id, aircraftId: 'tiny',
  });
  assert.equal(moved, signed, 'an ATR was allowed to take over a widebody contract');
});

// ── 5. Old saves and the over-cap migration ──────────────────────────────────

test('an old save is seeded with the charter fields on load', () => {
  const old = { ...freshState(), airlineName: 'Legacy Air', hub: 'SFO' };
  delete old.charters; delete old.charterDismissed; delete old.charterReliability;
  const fixed = reconcileState(old);
  assert.deepEqual(fixed.charters, []);
  assert.deepEqual(fixed.charterDismissed, []);
  assert.equal(fixed.charterReliability, CHARTER_RELIABILITY_START);
});

test('a new game starts with an empty book and a neutral record', () => {
  const s = reducer(undefined, { type: 'START_GAME', airlineName: 'Fresh Air', hub: 'SFO' });
  assert.deepEqual(s.charters, []);
  assert.equal(s.charterReliability, CHARTER_RELIABILITY_START);
});

test('the over-cap trim sheds schedule, never a signed contract', () => {
  const type = getAircraftType(TYPE);
  const perFlight = blockTimeHours(routeDistanceKm('SFO', 'JFK'), type) * 2;
  const c = {
    ...charterOpRecord({ id: 'o1', origin: 'SFO', destination: 'JFK', flightsPerWeek: 6 }, 'ac1'),
    id: 'charter-1', status: 'active',
  };
  const st = baseState({
    charters: [c],
    // Deliberately over the cap once the contract is counted.
    routes: [{ id: 'r1', origin: 'SFO', destination: 'JFK', aircraftId: 'ac1',
               stops: ['SFO', 'JFK'],
               weeklyFrequency: Math.ceil(MAX_WEEKLY_BLOCK_HOURS / perFlight) }],
  });
  const out = trimOverCapSchedules(st);
  assert.ok(out.changed, 'the trim did not notice an over-cap tail');
  assert.equal(out.notices[0].cuts.every(cut => cut.routeId !== 'charter-op-o1'), true,
    'the trim cut a signed charter contract');
  assert.ok(out.routes[0].weeklyFrequency < st.routes[0].weeklyFrequency,
    'the schedule was not trimmed at all');
});

console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed > 0 ? 1 : 0);
