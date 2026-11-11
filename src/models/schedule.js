// Weekly flight schedule — when each aircraft's rotations leave.
//
// The simulation runs on weekly frequency; nothing in the tick reads a time of
// day. This module gives the frequency a timetable for the things that SHOW
// one — the schedule editor, the departure board and the planes on the globe —
// so all three agree.
//
// A route's `schedule.starts` holds the rotations the player has PINNED, as
// minutes into the week (UTC, Monday 00:00 = 0). Every rotation not pinned is
// placed automatically in the aircraft's free time, so a player who never
// opens the editor still gets a full, sensible week, and a player who pins a
// few gets the rest flowed around them. One rotation = every leg out and every
// leg back (each leg: flight + turnaround), exactly the block time the engine
// charges, so a tail's week can never hold more than the block-hour cap.
//
// Pure and deterministic — same state, same timetable on every client.
//
// Tailwinds: charter contracts (state.charters) fly on the same tails,
// so a tail's week carries them too. They are placed like automatic flights
// but can never be pinned — the customer sets when a charter flies, not the
// player — and their blocks carry `charter: true` so the editor draws them as
// fixed. Without them a tail on a charter showed free time it doesn't have.

import { sectorTaxiHours } from '../utils/market.js';
import {
  routeStops, routeDistanceKm, cruiseSpeedKmh, turnaroundHours, isRouteActive, activeCharterOps,
} from '../utils/simulation.js';
import { getAirport } from '../data/airports.js';
import { getAircraftType } from '../data/aircraft.js';
import { utcOffsetMinutes } from '../data/timezones.js';

export const WEEK_MIN = 7 * 24 * 60;   // 10080
export const SNAP_MIN = 5;

export const wrapWeek = (m) => ((Math.round(m) % WEEK_MIN) + WEEK_MIN) % WEEK_MIN;
export const snapMin = (m, step = SNAP_MIN) => wrapWeek(Math.round(m / step) * step);

/** Pinned starts, cleaned: whole minutes in [0, WEEK_MIN), distinct, sorted,
 *  at most `freq` of them. Anything unusable is dropped. */
export function normalizeStarts(starts, freq = Infinity) {
  if (!Array.isArray(starts)) return [];
  const out = [...new Set(starts
    .map(Number)
    .filter(Number.isFinite)
    .map(wrapWeek))].sort((a, b) => a - b);
  return out.slice(0, Math.max(0, Math.floor(freq)));
}

/** A route's rotation for an aircraft type: legs out then back, in minutes. */
export function routeRotation(route, type) {
  const stops = routeStops(route);
  if (stops.length < 2 || !type) return null;
  const speed = cruiseSpeedKmh(type);
  const turnMin = Math.round(turnaroundHours(type) * 60);
  const out = [];
  for (let i = 0; i < stops.length - 1; i++) {
    const km = routeDistanceKm(stops[i], stops[i + 1]);
    if (!(km > 0)) return null;
    out.push({ from: stops[i], to: stops[i + 1], km });
  }
  const back = [...out].reverse().map(l => ({ from: l.to, to: l.from, km: l.km }));
  const legs = [...out, ...back].map(l => ({
    // Gate to gate: v2 adds taxi/climb/approach time per sector (0 classic).
    ...l, flightMin: Math.max(1, Math.round((l.km / speed + sectorTaxiHours(type)) * 60)), turnMin,
  }));
  const durMin = legs.reduce((s, l) => s + l.flightMin + l.turnMin, 0);
  return { stops, legs, durMin };
}

// ── Cyclic intervals ──────────────────────────────────────────────────────────
/** Do [a, a+da) and [b, b+db) overlap on the week's circle? */
export function overlaps(a, da, b, db) {
  const d = wrapWeek(b - a);           // b's start, measured from a
  return d < da || d + db > WEEK_MIN;  // b starts inside a, or b wraps into a
}

const fitsAmong = (start, dur, placed) => placed.every(p => !overlaps(start, dur, p.start, p.dur));

/** Interleave routes by frequency (Bresenham): the order rotations come round
 *  in a week, so a 14× and a 7× route alternate 2:1 instead of bunching. */
function interleave(items) {
  const total = items.reduce((s, it) => s + it.count, 0);
  const used = items.map(() => 0);
  const order = [];
  for (let k = 0; k < total; k++) {
    let best = -1, bestDeficit = -Infinity;
    items.forEach((it, i) => {
      if (used[i] >= it.count) return;
      const deficit = (it.count * (k + 1)) / total - used[i];
      if (deficit > bestDeficit + 1e-9) { best = i; bestDeficit = deficit; }
    });
    used[best]++;
    order.push(best);
  }
  return order;
}

/**
 * One aircraft's week.
 *   routes: every route this tail flies this month (passenger and cargo), each
 *           { id, origin, destination, stops?, weeklyFrequency, schedule? }
 *   type:   its aircraft type
 *   seed:   the aircraft id (staggers its automatic departures)
 *   staggerMin: explicit 0–180 min stagger (airlineWeeks spreads tails that
 *           share a first route evenly, so they never leave together)
 * Returns {
 *   blocks:   [{ key, routeId, start, dur, legs, pinned }] sorted by start
 *   overflow: [{ routeId, count }] auto rotations that found no room (only when
 *             pins are packed so tightly the rest can't fit)
 *   demoted:  [{ routeId, start }] pins dropped because they overlap an
 *             earlier pin (e.g. after the route moved to a busier tail)
 *   busyMin, anchor
 * }
 */
/** Stable 0..1 from a string (FNV-1a) — staggers tails that share a pair. */
export function seedUnit(str) {
  let h = 0x811c9dc5;
  for (const c of String(str)) { h ^= c.charCodeAt(0); h = Math.imul(h, 0x01000193) >>> 0; }
  // Murmur3 finaliser: FNV alone leaves 'tail-1' and 'tail-2' a hair apart in
  // the high bits, i.e. the same five-minute slot.
  h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b) >>> 0;
  h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35) >>> 0;
  h ^= h >>> 16;
  return (h >>> 0) / 0x100000000;
}

/** Code-point order. NOT localeCompare: route ids are base-36 and a Danish or
 *  Norwegian browser sorts "aa" after "z", which would give the same airline a
 *  different timetable on different devices. */
export const byCodePoint = (a, b) => { const x = String(a), y = String(b); return x < y ? -1 : x > y ? 1 : 0; };

export function aircraftWeek(routes, type, seed = '', staggerMin = null) {
  const items = [];
  for (const r of [...(routes ?? [])].sort((a, b) => byCodePoint(a.id, b.id))) {
    const f = Math.max(0, Math.floor(Number(r.weeklyFrequency) || 0));
    if (f <= 0) continue;
    const rot = routeRotation(r, type);
    if (!rot) continue;
    // A charter is never pinned, whatever it carries.
    const charter = !!r.charter;
    items.push({ route: r, rot, count: f, charter, pins: charter ? [] : normalizeStarts(r.schedule?.starts, f) });
  }
  const blocks = [], demoted = [], overflow = [];
  if (!items.length) return { blocks, overflow, demoted, busyMin: 0, anchor: 0 };
  const stagger = Number.isFinite(staggerMin) ? staggerMin : seedUnit(seed) * 180;
  const busy = items.reduce((s, it) => s + it.rot.durMin * it.count, 0);

  // 0. Tailwinds: charters before anything else, each spread evenly over the
  //    week from 06:00 local at its own pickup. Their times depend on nothing
  //    else the tail flies, so no edit of the player's ever moves one, and
  //    pins and automatic flights alike go round them (canPlace treats a
  //    charter as an obstacle). A tail with no charter skips this entirely and
  //    gets exactly the Headwinds week.
  for (const it of items) {
    if (!it.charter) continue;
    const a0 = 6 * 60 + stagger - utcOffsetMinutes(getAirport(it.rot.stops[0]));
    let missing = 0, n = 0;
    for (let k = 0; k < it.count; k++) {
      const at = firstFit(snapMin(a0 + (k * WEEK_MIN) / it.count), it.rot.durMin, blocks);
      if (at == null) { missing++; continue; }
      blocks.push(block(it, at, false, n++));
    }
    if (missing) overflow.push({ routeId: it.route.id, count: missing });
  }
  const own = items.filter(it => !it.charter);
  if (!own.length) {
    blocks.sort((a, b) => a.start - b.start);
    return { blocks, overflow, demoted, busyMin: busy, anchor: 0 };
  }

  // 1. Pins first, in route order; one that collides with an earlier pin (or,
  //    in Tailwinds, a charter) is demoted to automatic rather than drawn on
  //    top of it.
  for (const it of own) {
    it.kept = [];
    for (const s of it.pins) {
      if (fitsAmong(s, it.rot.durMin, blocks)) {
        blocks.push(block(it, s, true, it.kept.length));
        it.kept.push(s);
      } else demoted.push({ routeId: it.route.id, start: s });
    }
  }

  // 2. The ideal automatic week: every rotation in interleaved order, evenly
  //    spaced, the first leaving between 06:00 and 09:00 local at the first
  //    route's origin — staggered per tail so two aircraft on one pair don't
  //    leave together.
  //    The gap is the week left after EVERY rotation, charters included, so
  //    the tail's own flights spread over the time it really has.
  const order = interleave(own);
  const gap = Math.max(0, (WEEK_MIN - busy) / order.length);
  const origin = getAirport(own[0].rot.stops[0]);
  const anchor = snapMin(6 * 60 + stagger - utcOffsetMinutes(origin));
  const ideal = own.map(() => []);
  let t = anchor;
  for (const i of order) {
    ideal[i].push(snapMin(t));
    t += own[i].rot.durMin + gap;
  }

  // 3. Each route's unpinned rotations take its ideal slots, minus the slot
  //    nearest each pin (a pin replaces the automatic flight closest to it),
  //    then slide forward to the first free time if a pin is in the way.
  own.forEach((it, i) => {
    const slots = [...ideal[i]];
    for (const p of it.kept) {
      let bi = 0, bd = Infinity;
      slots.forEach((s, j) => {
        const d = Math.min(wrapWeek(s - p), wrapWeek(p - s));
        if (d < bd) { bd = d; bi = j; }
      });
      slots.splice(bi, 1);
    }
    let missing = 0;
    for (const s of slots) {
      const at = firstFit(s, it.rot.durMin, blocks);
      if (at == null) { missing++; continue; }
      blocks.push(block(it, at, false, blocks.filter(b => b.routeId === it.route.id).length));
    }
    if (missing) overflow.push({ routeId: it.route.id, count: missing });
  });

  blocks.sort((a, b) => a.start - b.start);
  return { blocks, overflow, demoted, busyMin: busy, anchor };
}

function block(it, start, pinned, n) {
  return {
    key: `${it.route.id}#${pinned ? 'p' : 'a'}${start}`,
    routeId: it.route.id, start, dur: it.rot.durMin, legs: it.rot.legs, stops: it.rot.stops,
    pinned, n,
    ...(it.charter ? { charter: true } : {}),
  };
}

/** First start at or after `s` (5-minute steps, round the week once) where a
 *  `dur`-minute block fits among `placed`; null if nowhere. */
export function firstFit(s, dur, placed) {
  for (let k = 0; k < WEEK_MIN; k += SNAP_MIN) {
    const at = wrapWeek(s + k);
    if (fitsAmong(at, dur, placed)) return at;
  }
  return null;
}

/** The flight `b` refers to in `week` — matched by route and start, never by
 *  object identity: the editor's week is rebuilt on every state change (a
 *  poll, a decision echo), so a block captured at pointerdown is a stale copy
 *  by the time it's dropped (audit, 2026-10-14). */
export function findBlock(week, b) {
  if (!b) return null;
  return week.blocks.find(x => x.routeId === b.routeId && x.start === b.start) ?? null;
}

/** The block a move replaces: the one dragged (as it is in `week`), or —
 *  dropped in from the tray — the route's automatic flight nearest the drop. */
export function replacedBlock(week, routeId, from, to) {
  if (from) return findBlock(week, from);
  const autos = week.blocks.filter(b => b.routeId === routeId && !b.pinned);
  if (!autos.length) return null;
  const dist = (s) => Math.min(wrapWeek(s - to), wrapWeek(to - s));
  return autos.reduce((m, b) => (dist(b.start) < dist(m.start) ? b : m));
}

/**
 * Can a `dur`-minute rotation of `routeId` move to `start`? `from` is the
 * block being moved (null for a tray drop). Pins block it, and so do the
 * route's own other flights — editing a route pins all of them where they
 * are (pinsAfterMove) — and, in Tailwinds, charters, which never move. Other
 * routes' automatic flights flow around it.
 */
export function canPlace(week, routeId, dur, start, from = null) {
  if (isCharter(week, routeId)) return false;   // a charter's times aren't the player's
  const skip = replacedBlock(week, routeId, from, start);
  if (from && !skip) return false;   // that flight isn't in this week any more
  return week.blocks
    .filter(b => b !== skip && (b.pinned || b.charter || b.routeId === routeId))
    .every(b => !overlaps(start, dur, b.start, b.dur));
}

/**
 * The new pinned starts for a route after a move. `from` is the block being
 * moved (null when dragging one in from the tray).
 *
 * Editing a route pins the whole route as it is shown, with just the moved
 * flight changed. Pinning only the moved flight let the automatic placement
 * re-pick which automatic flight it replaced — the one nearest the DROP, not
 * the one dragged — so dragging Monday's flight to Wednesday could leave
 * Monday in place and delete Wednesday's (review, 2026-10-14). A tray drop
 * replaces the automatic flight nearest where it lands.
 */
export function pinsAfterMove(week, routeId, from, to) {
  if (isCharter(week, routeId)) return null;
  const gone = replacedBlock(week, routeId, from, to);
  const mine = week.blocks.filter(b => b.routeId === routeId);
  const overflow = week.overflow.find(o => o.routeId === routeId)?.count ?? 0;
  // Refuse rather than guess: a dragged flight that's gone, or a tray drop
  // with no automatic flight to take the place of.
  if (from && !gone) return null;
  if (!from && !gone && overflow === 0) return null;
  const starts = mine.filter(b => b !== gone).map(b => b.start);
  const next = normalizeStarts([...starts, to]);
  return next.length <= mine.length + overflow ? next : null;
}

/** Is `routeId` a charter contract on this tail (never movable, never pinned)? */
export function isCharter(week, routeId) {
  return !!week?.blocks?.some(b => b.routeId === routeId && b.charter);
}

/** Pins for a route with one block unpinned. */
export function pinsAfterUnpin(week, routeId, start) {
  return normalizeStarts(week.blocks.filter(b => b.routeId === routeId && b.pinned && b.start !== start)
    .map(b => b.start));
}

/** Every leg's departure, as { routeId, from, to, utcMin } — for the board. */
export function weekDepartures(week) {
  const out = [];
  // `rotation` is the flight's place in its route's week and `leg` its sector,
  // a stable identity for the board's flight numbers.
  const nth = {};
  for (const b of week.blocks) {
    const rotation = (nth[b.routeId] = (nth[b.routeId] ?? -1) + 1);
    let t = b.start;
    b.legs.forEach((l, leg) => {
      out.push({ routeId: b.routeId, from: l.from, to: l.to, utcMin: wrapWeek(t), pinned: b.pinned, rotation, leg });
      t += l.flightMin + l.turnMin;
    });
  }
  return out;
}

/**
 * Every tail's week for an airline state, keyed by aircraft id. Routes dormant
 * this month (seasonal) don't fly, so they take no time. A reserve covering a
 * grounded tail already carries the route under its own id. Charter contracts
 * that are flying (or positioning for) a job take their time on the tail too.
 */
export function airlineWeeks(state, month) {
  const byAc = new Map();
  for (const r of [...(state?.routes ?? []), ...(state?.cargoRoutes ?? []), ...activeCharterOps(state?.charters ?? [])]) {
    if (!r?.aircraftId || !isRouteActive(r, month)) continue;
    if (!byAc.has(r.aircraftId)) byAc.set(r.aircraftId, []);
    byAc.get(r.aircraftId).push(r);
  }
  // Tails whose week starts on the same route pair would hash to only 37
  // five-minute staggers — six SYD–MEL tails collided a third of the time.
  // Spread each such group evenly across the 06:00–09:00 wave instead.
  const pairOf = (routes) => {
    const r = [...routes].sort((a, b) => byCodePoint(a.id, b.id))
      .find(x => (Number(x.weeklyFrequency) || 0) > 0);
    return r ? [r.origin, r.destination].sort().join('~') : '';
  };
  const groups = new Map();
  for (const [acId, routes] of byAc) {
    const k = pairOf(routes);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(acId);
  }
  // Each tail keeps its own hashed five-minute slot in the wave and only
  // probes onward on a collision, so adding or retiring one aircraft doesn't
  // reshuffle every other tail on the pair (an earlier rank-based spread did).
  const SLOTS = 36;
  const stagger = new Map();
  for (const ids of groups.values()) {
    ids.sort(byCodePoint);
    const used = new Set();
    for (const id of ids) {
      if (used.size >= SLOTS) used.clear();
      let s = Math.floor(seedUnit(id) * SLOTS);
      while (used.has(s)) s = (s + 1) % SLOTS;
      used.add(s);
      stagger.set(id, s * 5);
    }
  }
  const weeks = new Map();
  for (const [acId, routes] of byAc) {
    const ac = (state.fleet ?? []).find(a => a.id === acId);
    const type = ac ? getAircraftType(ac.typeId) : null;
    if (!type) continue;
    weeks.set(acId, cachedWeek(routes, type, acId, stagger.get(acId)));
  }
  return weeks;
}

// Weeks are rebuilt on every state change (polls re-hydrate routes), but a
// tail's week only changes when its routes do. Reusing the same object for the
// same inputs keeps the editor's memoised rows (and the board, and the globe)
// from redoing work for 99 aircraft when one flight moved.
const WEEK_CACHE = new Map();
const WEEK_CACHE_MAX = 4000;
function cachedWeek(routes, type, seed, staggerMin) {
  const sig = [type.id, seed, staggerMin ?? '', ...routes.map(r => [
    r.id, r.weeklyFrequency, routeStops(r).join('-'), r.charter ? 'c' : (r.schedule?.starts ?? []).join('.'),
  ].join(':'))].join('|');
  const hit = WEEK_CACHE.get(sig);
  if (hit) return hit;
  const w = aircraftWeek(routes, type, seed, staggerMin);
  if (WEEK_CACHE.size >= WEEK_CACHE_MAX) WEEK_CACHE.delete(WEEK_CACHE.keys().next().value);
  WEEK_CACHE.set(sig, w);
  return w;
}

// ── Typed departure times ─────────────────────────────────────────────────────
// Writing a timetable by hand: the player types clock times, local at the
// route's origin, instead of dragging or nudging each flight. A route's week
// is a few rows — a time and the days it leaves at that time — so a 14×/week
// route is two times typed once, not fourteen flights moved one by one. A
// single flight can also be given a time of its own, on its own day.
//
// Everything here only works out pins; SET_ROUTE_SCHEDULES stores them, so the
// rules above (pins never overlap, automatic flights flow round them) are
// untouched.

export const DAY_MIN = 24 * 60;

/** Minutes of the day → "07:05". */
export function clockLabel(min) {
  const m = ((Math.round(min) % DAY_MIN) + DAY_MIN) % DAY_MIN;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
}

/**
 * A typed time → minutes of the day, or null when it isn't one. Takes what
 * people actually type: "7:30", "07.30", "0730", "730", "19", "7pm", "7:30 pm".
 */
export function parseClock(text) {
  const s = String(text ?? '').trim().toLowerCase().replace(/\s+/g, '');
  const m = /^(\d{1,2})(?:[:.h]?(\d{2}))?(am|pm|a|p)?$/.exec(s);
  if (!m) return null;
  let h = Number(m[1]);
  const min = m[2] == null ? 0 : Number(m[2]);
  if (min > 59) return null;
  if (m[3]) {
    if (h < 1 || h > 12) return null;
    h = (h % 12) + (m[3][0] === 'p' ? 12 : 0);
  } else if (h > 23) return null;
  return h * 60 + min;
}

/** A time of day on the timetable's five-minute grid (23:58 is 00:00). */
export const snapClock = (tod) => (Math.round(tod / SNAP_MIN) * SNAP_MIN) % DAY_MIN;

/** Where a week minute falls for a clock `off` minutes ahead of UTC. */
export function localDayTime(utcMin, off = 0) {
  const m = wrapWeek(utcMin + off);
  return { day: Math.floor(m / DAY_MIN), tod: m % DAY_MIN };
}

/** The week minute (UTC) of `tod` on local `day` for a clock `off` minutes ahead of UTC. */
export const utcOfLocal = (day, tod, off = 0) => wrapWeek(day * DAY_MIN + tod - off);

/**
 * A route's flights on this tail by local day at its origin: seven lists
 * (Mon–Sun) of { b, tod }, each in the order they leave.
 */
export function routeDays(week, routeId, off = 0) {
  const days = Array.from({ length: 7 }, () => []);
  for (const b of week?.blocks ?? []) {
    if (b.routeId !== routeId || b.charter) continue;
    const { day, tod } = localDayTime(b.start, off);
    days[day].push({ b, tod });
  }
  for (const d of days) d.sort((x, y) => x.tod - y.tod || x.b.start - y.b.start);
  return days;
}

/** How many flights a route has on this tail: placed, plus any that found no room. */
export function routeFlights(week, routeId) {
  return (week?.blocks ?? []).filter(b => b.routeId === routeId && !b.charter).length
    + (week?.overflow?.find(o => o.routeId === routeId)?.count ?? 0);
}

/**
 * A route's week as timetable rows, [{ tod, days: [Mon..Sun booleans] }] in
 * time order — what the editor shows before the player types anything.
 *
 * A route the player has timed completely reads back exactly as set: one row
 * per distinct time. Anything else (automatic flights drift a few minutes from
 * day to day, and shift round whatever else the tail flies) is offered as the
 * tidy timetable its frequency implies: one row per flight a day on every day,
 * plus a row on the busiest days for what is left over (10×/week is a daily
 * row and a three-day row). Times start from the flights on `day` — the day
 * the player is looking at — or the busiest day when that one flies fewer; a
 * row with nothing to start from has tod null.
 */
export function timetableRows(week, routeId, off = 0, day = 0) {
  const days = routeDays(week, routeId, off);
  const placed = days.flat();
  const total = routeFlights(week, routeId);
  if (!total || isCharter(week, routeId)) return [];
  if (placed.length === total && placed.every(x => x.b.pinned)) {
    const byTod = new Map();
    days.forEach((list, d) => list.forEach(({ tod }) => {
      if (!byTod.has(tod)) byTod.set(tod, Array(7).fill(false));
      byTod.get(tod)[d] = true;
    }));
    return [...byTod].sort((a, b) => a[0] - b[0]).map(([tod, on]) => ({ tod, days: on }));
  }
  const n = Math.ceil(total / 7);
  const extra = total - 7 * (n - 1);                 // flights on the last row, 1–7
  // The days that row flies: where the route is busiest now, so a 3×/week
  // route keeps the three days it is on.
  const busiest = days.map((list, d) => ({ d, c: list.length })).sort((a, b) => b.c - a.c || a.d - b.d).slice(0, extra).map(x => x.d);
  // Times from the day being looked at; a day that flies fewer than the rows
  // need (the one-flight day of a 10×/week route) borrows the busiest day's.
  const todsOf = (list) => [...new Set(list.map(x => snapClock(x.tod)))].sort((a, b) => a - b);
  let seen = todsOf(days[day] ?? []);
  if (seen.length < n) {
    const fullest = todsOf(days.reduce((m, d) => (d.length > m.length ? d : m), []));
    if (fullest.length > seen.length) seen = fullest;
  }
  return Array.from({ length: n }, (_, i) => ({
    tod: seen[i] ?? null,
    days: i < n - 1 || extra === 7 ? Array(7).fill(true) : Array.from({ length: 7 }, (_, d) => busiest.includes(d)),
  }));
}

/** The first thing in the way of a `dur`-minute block at `start` among `placed`. */
const firstClash = (start, dur, placed) => placed.find(p => overlaps(start, dur, p.start, p.dur)) ?? null;

/** The free start nearest `s` (either side, five-minute steps, at most `reach`
 *  minutes away) for a `dur`-minute block among `placed`; null if none. */
export function nearestFit(s, dur, placed, reach = 12 * 60) {
  for (let k = SNAP_MIN; k <= reach; k += SNAP_MIN) {
    for (const at of [wrapWeek(s + k), wrapWeek(s - k)]) {
      if (!firstClash(at, dur, placed)) return at;
    }
  }
  return null;
}

/**
 * What stops `from` (a flight of `routeId`) moving to `start`: the pinned
 * flight, charter or other flight of its own route it would overlap, or null
 * when the move is fine. The same rule as canPlace, naming the culprit.
 */
export function blockerFor(week, routeId, dur, start, from = null) {
  const skip = replacedBlock(week, routeId, from, start);
  return week.blocks.find(b => b !== skip && (b.pinned || b.charter || b.routeId === routeId)
    && overlaps(start, dur, b.start, b.dur)) ?? null;
}

/**
 * Pins for a route from timetable rows.
 *   rows: [{ tod, days }] — minutes of the day, local at the route's origin
 *         (`off` = that airport's UTC offset in minutes), and the days (Mon..Sun
 *         booleans) a flight leaves at that time
 * A flight whose typed time is taken — by a flight of another route the player
 * set, or by a charter — leaves at the nearest free time instead, and one with
 * nowhere to go within twelve hours is left automatic. Flights the rows don't
 * cover stay automatic too. Other routes' automatic flights make room, as they
 * do for any pin.
 *
 * Returns null when there is nothing to set (a charter, no flights, no row
 * with a time and a day), or an error the player has to fix:
 *   { error: 'too-many', timed, flights }   more departures than the route flies
 *   { error: 'too-close', a, b, dur }       two of them ({ day, tod }) nearer
 *                                           than one round trip
 * otherwise {
 *   pins,                           the route's new pinned starts
 *   flights,                        how many flights the route has on this tail
 *   timed,                          how many departures the rows asked for
 *   set,                            how many leave exactly when typed
 *   bumped: [{ day, tod, at, by }]  typed time taken → leaves at `at` instead
 *   auto:   [{ day, tod, by }]      no room near the typed time → automatic
 * } — `by` is the block in the way: { routeId, start, charter }.
 */
export function pinsForTimetable(week, routeId, rows, off = 0) {
  if (!week || isCharter(week, routeId)) return null;
  const flights = routeFlights(week, routeId);
  const sample = week.blocks.find(b => b.routeId === routeId);
  if (!flights || !sample) return null;
  const dur = sample.dur;
  const seen = new Set();
  const targets = [];
  for (const row of rows ?? []) {
    if (row?.tod == null || row.tod === '' || !Number.isFinite(Number(row.tod))) continue;
    const tod = snapClock(Number(row.tod));
    for (let day = 0; day < 7; day++) {
      if (!row.days?.[day] || seen.has(`${day}|${tod}`)) continue;
      seen.add(`${day}|${tod}`);
      targets.push({ day, tod, to: utcOfLocal(day, tod, off) });
    }
  }
  if (!targets.length) return null;
  if (targets.length > flights) return { error: 'too-many', timed: targets.length, flights };
  // In the order the origin's week runs (so a problem is reported from Monday
  // on); sorted round the week, only neighbours can overlap.
  targets.sort((a, b) => a.day - b.day || a.tod - b.tod);
  for (let i = 0; i < targets.length && targets.length > 1; i++) {
    const a = targets[i], b = targets[(i + 1) % targets.length];
    if (wrapWeek(b.to - a.to) < dur) return { error: 'too-close', a: { day: a.day, tod: a.tod }, b: { day: b.day, tod: b.tod }, dur };
  }
  const fixed = week.blocks.filter(b => b.routeId !== routeId && (b.pinned || b.charter));
  // Everything that fits where it was typed goes first, so a flight that has
  // to shift never takes another day's typed time.
  const placed = [];
  const late = [];
  for (const t of targets) {
    const by = firstClash(t.to, dur, fixed);
    if (by) { t.by = { routeId: by.routeId, start: by.start, charter: !!by.charter }; late.push(t); continue; }
    t.at = t.to;
    placed.push({ start: t.at, dur });
  }
  for (const t of late) {
    t.at = nearestFit(t.to, dur, [...fixed, ...placed]);
    if (t.at != null) placed.push({ start: t.at, dur });
  }
  return {
    pins: normalizeStarts(placed.map(p => p.start)),
    flights,
    timed: targets.length,
    set: targets.length - late.length,
    bumped: late.filter(t => t.at != null).map(t => ({ day: t.day, tod: t.tod, at: t.at, by: t.by })),
    auto: late.filter(t => t.at == null).map(t => ({ day: t.day, tod: t.tod, by: t.by })),
  };
}
