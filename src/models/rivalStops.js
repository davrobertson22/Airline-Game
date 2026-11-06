// ─────────────────────────────────────────────────────────────────────────────
// RIVAL REFUELLING STOPS — AI carriers flying out-of-range routes with one stop
// (Tailwinds; Discord 2026-11-02, VodkaOnFire: "competitor airlines strive to
// fly assigned routes"). Decisions (Dave, 2026-11-04):
//
//   - A route nothing of the era can fly nonstop is flown A → S → C through a
//     refuelling stop S the game picks (Shannon on 1950s London–New York,
//     Bahrain or Singapore on the Kangaroo route). It sells ONLY the A–C
//     market — passengers stay on board — at a passenger-appeal penalty against
//     nonstops and the cost of two sectors and an extra landing.
//   - Any AI rival may do it, for its own expansion as well as for routes a
//     rival set lists; a carrier flying through a stop goes nonstop once a type
//     that can do it exists.
//   - New games only: `state.rivalStopsWorld`. A route carries the stop as
//     `cfg.via` (an airport code), so worlds without the flag never hold one
//     and every function here returns the nonstop answer for them.
//
// One stop at most. A pair that would need two stops stays out of reach.
// ─────────────────────────────────────────────────────────────────────────────

import { AIRPORTS, getAirport } from '../data/airports.js';
import { AIRCRAFT_TYPES, aircraftAvailability, aircraftOrderable } from '../data/aircraft.js';
import { routeDistance, getEraCalendarYear } from '../utils/market.js';
import { metroPrimary } from '../data/metros.js';

/** The flown path may be at most this much longer than the great circle. */
export const REFUEL_MAX_DETOUR = 1.2;
/** A stop closer than this to either end is no stop at all — nor one within REFUEL_MIN_LEG_SHARE of the trip. */
export const REFUEL_MIN_LEG_KM = 500;
export const REFUEL_MIN_LEG_SHARE = 0.15;
/** Stops need a long-haul runway. */
export const REFUEL_MIN_RUNWAY_FT = 8000;
/** Hours on the ground at the stop (refuel, crew check), added to the block. */
export const REFUEL_GROUND_HOURS = 1.0;
/** A tech stop costs this share of a normal turn's per-seat airport cost (a landing, no passengers processed). */
export const REFUEL_TURN_COST_SHARE = 0.5;
/**
 * Passenger utility given up to a refuelling stop on a typical on-the-way stop
 * (trip-time ratio TECH_STOP_TIME_BASE). Smaller than an own-metal connection
 * over the best hub (network.js, 0.26 × 2): no change of aircraft, no missed
 * connection. exp(−0.3) ≈ 0.74 — a stop keeps about three quarters of the
 * preference a nonstop would have.
 */
export const TECH_STOP_PENALTY = 0.3;
export const TECH_STOP_TIME_BASE = 1.15;
const TECH_STOP_FACTOR_MIN = 0.8, TECH_STOP_FACTOR_MAX = 2.0;

const APPROX_CRUISE_KMH = 800, APPROX_LEG_OVERHEAD_H = 0.5;
const approxBlockHours = (km) => (km || 0) / APPROX_CRUISE_KMH + APPROX_LEG_OVERHEAD_H;

/** The stop on a route config, or null for a nonstop. */
export function viaOf(cfg) {
  const v = cfg?.via;
  return typeof v === 'string' && getAirport(v) ? v : null;
}

/** The legs a route flies, in km: [direct] or [A→S, S→C]. */
export function routeLegsKm(routeKey, cfg) {
  const [a, b] = String(routeKey).split('-');
  const via = viaOf(cfg);
  if (!via) return [routeDistance(a, b) || 0];
  return [routeDistance(a, via) || 0, routeDistance(via, b) || 0];
}

/** The longest leg — what the aircraft's range and payload have to cover. */
export function routeLegKm(routeKey, cfg) {
  return Math.max(...routeLegsKm(routeKey, cfg));
}

/** Total flown distance, stop included. */
export function routeFlownKm(routeKey, cfg) {
  return routeLegsKm(routeKey, cfg).reduce((s, k) => s + k, 0);
}

/**
 * Utility penalty for flying A–C through S (0 for a nonstop), scaled by how
 * much the stop lengthens the trip like the connection penalty is.
 */
export function techStopPenalty(a, via, b) {
  if (!via) return 0;
  const direct = routeDistance(a, b) || 0;
  if (!(direct > 0)) return TECH_STOP_PENALTY;
  const ratio = (approxBlockHours(routeDistance(a, via)) + REFUEL_GROUND_HOURS + approxBlockHours(routeDistance(via, b)))
    / approxBlockHours(direct);
  const f = Math.min(TECH_STOP_FACTOR_MAX, Math.max(TECH_STOP_FACTOR_MIN, ratio / TECH_STOP_TIME_BASE));
  return TECH_STOP_PENALTY * f;
}

/** Share of a pair's demand a stopping service keeps against what a nonstop would (exp of the penalty). */
export function techStopDemandShare(a, via, b) {
  return Math.exp(-techStopPenalty(a, via, b));
}

/**
 * Longest range of any type an AI carrier could buy right now: era games
 * read the calendar (what is orderable this year), classic games the 2026
 * market. A fleet preference never narrows this — when no preferred type
 * can fly a lane, the carrier takes whatever fits (demand.js preferredTypes).
 */
const _ceiling = new Map();
export function aiRangeCeilingKm(year = getEraCalendarYear()) {
  const k = year ?? 'classic';
  if (!_ceiling.has(k)) {
    let r = 0;
    for (const t of AIRCRAFT_TYPES) {
      const ok = year != null ? aircraftOrderable(t, year) : aircraftAvailability(t, 2026) !== 'expired';
      if (ok && (t.range ?? 0) > r) r = t.range;
    }
    _ceiling.set(k, r);
  }
  return _ceiling.get(k);
}

/**
 * Detour charged against a smaller airport as a stop, in km: airlines refuel
 * where there is fuel, handling and a diversion plan, so a big airport a
 * little off the line beats a small one right on it (London–Hong Kong in
 * 1952 stops at Delhi, not Astana).
 */
export const REFUEL_TIER_PENALTY_KM = { mega: 0, major: 200, regional: 1500 };
/** A small airport with a long-haul runway was usually built for exactly this (Anchorage, Shannon, Bahrain). */
export const REFUEL_LONG_RUNWAY_FT = 11000;
export const REFUEL_LONG_RUNWAY_PENALTY_KM = 300;
function stopPenaltyKm(ap) {
  const byTier = REFUEL_TIER_PENALTY_KM[ap.tier] ?? REFUEL_TIER_PENALTY_KM.regional;
  return (ap.runwayFt ?? 0) >= REFUEL_LONG_RUNWAY_FT ? Math.min(byTier, REFUEL_LONG_RUNWAY_PENALTY_KM) : byTier;
}

/**
 * Era games: airspace a carrier from outside the bloc could not stop in.
 * Western airlines did not refuel in the Soviet Union before its fall, nor in
 * the People's Republic of China before it opened up; a carrier based there
 * can. Classic games (no calendar) have no closed airspace.
 */
const SOVIET_BLOC = new Set(['RU', 'UA', 'BY', 'MD', 'LT', 'LV', 'EE', 'GE', 'AM', 'AZ', 'KZ', 'UZ', 'TM', 'KG', 'TJ']);
export const CLOSED_STOPS = [
  { countries: SOVIET_BLOC, until: 1991 },
  { countries: new Set(['CN']), until: 1979 },
  { countries: new Set(['KP']), until: 9999 },
];
function closedRules(year, home) {
  if (year == null) return [];
  return CLOSED_STOPS.filter(r => year < r.until && !r.countries.has(home));
}

// The candidate stops as unit vectors: the search runs for every out-of-range
// pair a carrier looks at, so it does a dot product per airport, not a haversine.
let _stopPool = null;
const EARTH_R = 6371;
const unit = (ap) => {
  const la = ap.lat * Math.PI / 180, lo = ap.lon * Math.PI / 180;
  return [Math.cos(la) * Math.cos(lo), Math.cos(la) * Math.sin(lo), Math.sin(la)];
};
function stopPool() {
  if (!_stopPool) {
    // A metro's main airport only: a city's newer second airport (Beijing
    // Daxing, Dubai World Central) is no 1950s refuelling stop.
    _stopPool = AIRPORTS.filter(ap => (ap.runwayFt ?? 0) >= REFUEL_MIN_RUNWAY_FT && Number.isFinite(ap.lat) && Number.isFinite(ap.lon)
        && metroPrimary(ap.code) === ap.code)
      .map(ap => ({ code: ap.code, country: ap.country, v: unit(ap), penalty: stopPenaltyKm(ap) }));
  }
  return _stopPool;
}
// Every airport, for telling which country a point on a leg is over (the
// nearest airport's, within OVERFLY_REACH_KM): closed airspace is closed to
// overfly, not just to land in. Bucketed on a lat/lon grid so a lookup reads
// a handful of airports, not all of them.
const OVERFLY_REACH_KM = 400;
const OVERFLY_REACH_DOT = Math.cos(OVERFLY_REACH_KM / 6371);
const GRID_DEG = 4;
let _grid = null;
const cellKey = (i, j) => (i + 100) * 1000 + (((j % 90) + 90) % 90);
function grid() {
  if (!_grid) {
    _grid = new Map();
    for (const ap of AIRPORTS) {
      if (!Number.isFinite(ap.lat) || !Number.isFinite(ap.lon)) continue;
      const k = cellKey(Math.floor(ap.lat / GRID_DEG), Math.floor((ap.lon + 180) / GRID_DEG));
      if (!_grid.has(k)) _grid.set(k, []);
      _grid.get(k).push({ country: ap.country, v: unit(ap) });
    }
  }
  return _grid;
}
function countryUnder(p) {
  const lat = Math.asin(Math.max(-1, Math.min(1, p[2]))) * 180 / Math.PI;
  const lon = Math.atan2(p[1], p[0]) * 180 / Math.PI;
  const di = Math.ceil(OVERFLY_REACH_KM / 111 / GRID_DEG);
  const cosLat = Math.max(0.05, Math.cos(lat * Math.PI / 180));
  const dj = Math.min(45, Math.ceil(OVERFLY_REACH_KM / (111 * cosLat) / GRID_DEG));
  const i0 = Math.floor(lat / GRID_DEG), j0 = Math.floor((lon + 180) / GRID_DEG);
  let best = null, bestDot = OVERFLY_REACH_DOT;
  const g = grid();
  for (let i = i0 - di; i <= i0 + di; i++) {
    for (let j = j0 - dj; j <= j0 + dj; j++) {
      for (const q of g.get(cellKey(i, j)) ?? []) {
        const d = p[0] * q.v[0] + p[1] * q.v[1] + p[2] * q.v[2];
        if (d >= bestDot) { bestDot = d; best = q.country; }
      }
    }
  }
  return best;
}
/** Points along the great circle u → v (fractions of the way). */
function along(u, v, t) {
  const dot = Math.max(-1, Math.min(1, u[0] * v[0] + u[1] * v[1] + u[2] * v[2]));
  const om = Math.acos(dot);
  if (om < 1e-9) return u;
  const s0 = Math.sin((1 - t) * om) / Math.sin(om), s1 = Math.sin(t * om) / Math.sin(om);
  return [s0 * u[0] + s1 * v[0], s0 * u[1] + s1 * v[1], s0 * u[2] + s1 * v[2]];
}
// Middle first: a leg over closed airspace usually shows it there.
const OVERFLY_SAMPLES = [0.5, 0.3, 0.7, 0.2, 0.8, 0.4, 0.6];
// Per leg and rule set: the same legs out of a hub recur for every far pair.
const _legCache = new Map();
function legCrossesClosed(from, to, u, v, closed, closedKey) {
  if (!closed.length) return false;
  const k = from < to ? `${from}>${to}|${closedKey}` : `${to}>${from}|${closedKey}`;
  let hit = _legCache.get(k);
  if (hit === undefined) {
    hit = OVERFLY_SAMPLES.some(t => { const c = countryUnder(along(u, v, t)); return closed.some(r => r.countries.has(c)); });
    if (_legCache.size > 200_000) _legCache.clear();
    _legCache.set(k, hit);
  }
  return hit;
}

const arcKm = (u, v) => EARTH_R * Math.acos(Math.max(-1, Math.min(1, u[0] * v[0] + u[1] * v[1] + u[2] * v[2])));

const _stopCache = new Map();
/**
 * The refuelling stop for A–C when the longest leg may be at most `maxLegKm`
 * (default: the longest-range type on the market this year): the one with the
 * shortest flown path, after the tier penalty above and a small weight toward
 * even legs (a shorter longest leg carries more payload). `home` is the
 * carrier's country, for closed airspace (CLOSED_STOPS). Null when the pair
 * needs no stop or no single stop works.
 * → { via, legsKm: [km, km], flownKm } | null
 */
export function findRefuelStop(a, b, { year = getEraCalendarYear(), maxLegKm = aiRangeCeilingKm(year), home = null } = {}) {
  const direct = routeDistance(a, b) || 0;
  if (!(direct > 0) || !(maxLegKm > 0) || direct <= maxLegKm || direct > maxLegKm * 2) return null;
  const closed = closedRules(year, home);
  const closedKey = closed.map(r => CLOSED_STOPS.indexOf(r)).join(',');
  const key = `${[a, b].sort().join('-')}|${Math.round(maxLegKm)}|${closedKey}`;
  let hit = _stopCache.get(key);
  if (hit === undefined) {
    const A = getAirport(a), B = getAirport(b);
    const ua = unit(A), ub = unit(B);
    const maxFlown = direct * REFUEL_MAX_DETOUR;
    const minLeg   = Math.max(REFUEL_MIN_LEG_KM, direct * REFUEL_MIN_LEG_SHARE);
    // A hair of slack on the fast distance; the pick is re-measured exactly.
    const lim = maxLegKm + 2;
    // Leg limits as dot products, so the scan takes no arc-cosines for the
    // (many) airports out of reach of either end.
    const dotMax = Math.cos(minLeg / EARTH_R), dotMin = Math.cos(Math.min(Math.PI, lim / EARTH_R));
    const dot = (u, v) => u[0] * v[0] + u[1] * v[1] + u[2] * v[2];
    const cands = [];
    for (const s of stopPool()) {
      if (s.code === a || s.code === b) continue;
      const d1 = dot(ua, s.v);
      if (d1 > dotMax || d1 < dotMin) continue;
      const d2 = dot(s.v, ub);
      if (d2 > dotMax || d2 < dotMin) continue;
      const l1 = arcKm(ua, s.v), l2 = arcKm(s.v, ub);
      if (l1 + l2 > maxFlown + 2) continue;
      if (closed.some(r => r.countries.has(s.country))) continue;
      cands.push({ s, l1, l2, score: l1 + l2 + s.penalty + 0.1 * Math.max(l1, l2) });
    }
    cands.sort((x, y) => x.score - y.score);
    hit = null;
    // Best first; a pick whose legs cross closed airspace gives way to the next.
    for (const { s } of cands.slice(0, 150)) {
      if (legCrossesClosed(a, s.code, ua, s.v, closed, closedKey) || legCrossesClosed(s.code, b, s.v, ub, closed, closedKey)) continue;
      // Re-measured the engine's way; the fast distance had a hair of slack.
      const l1 = routeDistance(a, s.code), l2 = routeDistance(s.code, b);
      if (Math.max(l1, l2) > maxLegKm || l1 + l2 > maxFlown) continue;
      hit = { from: a, via: s.code, l1, l2 };
      break;
    }
    if (_stopCache.size > 50_000) _stopCache.clear();
    _stopCache.set(key, hit);
  }
  if (!hit) return null;
  // Cached by pair: put the legs in the order asked for.
  const legsKm = hit.from === a ? [hit.l1, hit.l2] : [hit.l2, hit.l1];
  return { via: hit.via, legsKm, flownKm: hit.l1 + hit.l2 };
}

/** Block hours one way for a route config (for tail counts), the stop's ground time included. */
export function routeBlockHoursOneWay(routeKey, cfg, blockOf) {
  const legs = routeLegsKm(routeKey, cfg);
  return legs.reduce((s, k) => s + blockOf(k), 0) + (legs.length > 1 ? REFUEL_GROUND_HOURS : 0);
}
