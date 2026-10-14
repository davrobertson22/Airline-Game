// ─── Randomized demand worlds ─────────────────────────────────────────────────
//
// Discord, 2026-10-11 (VodkaOnFire): every Tailwinds world is the real one, so
// every game rewards the same handful of known-good airports. A new-game option
// rolls the dice on each airport's traffic instead:
//
//   • mega airports   roll −20% … +10%   (the giants barely move)
//   • major airports  roll −30% … +50%   (the biggest shake-up in absolute pax)
//   • regional fields roll −50% … +100%  (small towns can double — or halve)
//
// so the map you know is the starting point, not the answer. Tiers follow the
// rolls: a major that booms past the mega line is promoted (gate fees, landing
// fees, fuel, AI network size and AI route targets all move with it), a mega that slumps is
// demoted. By default the number of megas is capped at today's count; the
// player can lift that cap when creating the game.
//
// WHAT A ROLL IS. A roll `f` is a multiplier on the airport's TRAFFIC. The
// gravity model prices a pair as √(massO·massD), so an endpoint's traffic moves
// by f when its demand factor in baseCityPairDemand() is f: a pair between two
// rolled airports scales by fO·fD. A multi-airport metro (London, New York,
// Tokyo…) is ONE demand endpoint, so it takes ONE roll, keyed on its primary —
// every member pair must still return the same metro total.
//
// SAFEGUARD. The rolls are log-uniform (doubling as likely as halving), then
// divided by the traffic-weighted mean roll, so the world's total passenger
// market stays at its realistic size: demand moves between airports, it is not
// created out of thin air. tools/demand-world-test.mjs holds that within ±3%.
//
// DETERMINISM. Rolls are a hash of (seed, airport code), never a stored table:
// the save carries the seed, the normaliser and the handful of tier changes
// (`state.demandWorld`), so a reloaded game is the same world, and an airport
// added to the game after the world was rolled simply gets its own roll.
// Realistic games carry no `demandWorld` and every factor is exactly 1.

import { AIRPORTS, getAirport, setTierOverrides, baseTierOf } from './airports.js';
import { METROS, metroPrimary } from './metros.js';

export const DEMAND_WORLD_VERSION = 1;

/** Traffic roll range by the airport's REAL tier: [low, high] multipliers. */
export const DEMAND_ROLL_RANGE = {
  mega:     [0.80, 1.10],
  major:    [0.70, 1.50],
  regional: [0.50, 2.00],
};

/**
 * Tier lines. Each one is a roll an airport must reach AND a size it must
 * cross, the size taken as a percentile of the REAL sizes of the tier on the
 * other side of the line:
 *
 *   major → mega      rolled +25% or more, and now as big as the median mega
 *   mega  → major     rolled −17% or worse, and now no bigger than an 85th-pct major
 *   regional → major  rolled +50% or more, and now as big as the median major
 *   major → regional  rolled −20% or worse, and now no bigger than a 90th-pct regional
 *
 * Only a roll can move an airport — one that rolled up is never demoted and
 * vice versa — so an airport that rolls exactly 1.0 keeps its real tier. Tuned
 * (tools/demand-world-test.mjs holds the spread) for roughly four megas falling
 * and two to five majors rising per world, and a few dozen major/regional
 * swaps: a different map, not chaos. Rolls are compared AFTER normalisation.
 */
const LINES = {
  toMega:    { roll: 1.25, pctl: 0.50, of: 'mega' },
  fromMega:  { roll: 0.83, pctl: 0.85, of: 'major' },
  toMajor:   { roll: 1.50, pctl: 0.50, of: 'major' },
  fromMajor: { roll: 0.80, pctl: 0.90, of: 'regional' },
};

// ── Seeded hash → uniform [0, 1) ───────────────────────────────────────────────
// The key is hashed on its own (FNV-1a), the seed is folded in, and the result
// goes through two murmur3 finaliser rounds. Hashing "seed|code" as one string
// left neighbouring seeds correlated (DFW and EZE rolled low together in five
// seeds out of six); mixing after the fold removes that.
function fnv1a(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}
function fmix32(h) {
  h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}
function uniform(seed, key) {
  const h = fmix32(fmix32(fnv1a(key) ^ Math.imul(seed >>> 0, 0x9e3779b1)) + 0x6d2b79f5);
  return h / 4294967296;
}

/** A fresh random seed for the setup screen (any 1…999,999 integer works). */
export function newDemandSeed() {
  return 1 + Math.floor(Math.random() * 999_999);
}

/** Normalise user input to a legal seed, or null. */
export function cleanDemandSeed(v) {
  const n = Math.floor(Number(v));
  return Number.isFinite(n) && n >= 1 && n <= 999_999_999 ? n : null;
}

/** The raw (un-normalised) traffic roll for the endpoint `key` (a metro primary or lone airport). */
export function rawRoll(seed, key) {
  const tier = baseTierOf(key) ?? 'regional';
  const [lo, hi] = DEMAND_ROLL_RANGE[tier] ?? DEMAND_ROLL_RANGE.regional;
  const u = uniform(seed, key);
  return Math.exp(Math.log(lo) + u * (Math.log(hi) - Math.log(lo)));
}

/**
 * Secondary airports of a multi-airport metro (Gatwick, Newark, Haneda's
 * partner Narita…) never change tier: the market table gives every member the
 * whole metro's market, so there is no honest per-airport size to test against
 * a tier line. They still share the metro's traffic roll. The primary stands
 * for the metro and is sized at the full metro market.
 */
function isMetroSecondary(code) {
  return metroPrimary(code) !== code;
}

/** Weekly passenger market touching an airport, from the generated market table row. */
function marketPax(row) {
  if (!row) return 0;
  let s = 0;
  for (let i = 1; i < row.length; i++) s += row[i];
  return s;
}

function percentile(sorted, p) {
  if (!sorted.length) return 0;
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.floor(p * (sorted.length - 1))))];
}

/**
 * Roll a world. Pure: same (seed, options, markets) → same world.
 *
 * @param {number} seed
 * @param {{ uncapMegas?: boolean }} options
 * @param {object} markets  AIRPORT_MARKETS from src/data/airportMarkets.js
 * @returns {{ v, seed, uncapMegas, norm, tiers }}  — `tiers` holds only the airports whose tier changed
 */
export function rollDemandWorld(seed, options = {}, markets = {}) {
  const uncapMegas = !!options.uncapMegas;

  // 1. Real sizes: each airport's own slice of the passenger market.
  const size = new Map();
  for (const a of AIRPORTS) {
    const key = metroPrimary(a.code);
    size.set(a.code, marketPax(markets[key] ?? markets[a.code]));
  }

  // 2. Normaliser: traffic-weighted mean roll over demand endpoints (each
  //    metro counted once, at its primary), so the world total holds.
  let num = 0, den = 0;
  const seen = new Set();
  for (const a of AIRPORTS) {
    const key = metroPrimary(a.code);
    if (seen.has(key)) continue;
    seen.add(key);
    const w = marketPax(markets[key] ?? markets[a.code]);
    num += w * rawRoll(seed, key);
    den += w;
  }
  const norm = den > 0 ? num / den : 1;
  const f = (code) => rawRoll(seed, metroPrimary(code)) / norm;

  // 3. Tier lines from the real distribution (metro secondaries excluded).
  const sizesOf = (tier) => AIRPORTS.filter(a => baseTierOf(a.code) === tier && !isMetroSecondary(a.code))
    .map(a => size.get(a.code)).sort((x, y) => x - y);
  const dist = { mega: sizesOf('mega'), major: sizesOf('major'), regional: sizesOf('regional') };
  const cut = (k) => percentile(dist[LINES[k].of], LINES[k].pctl);
  const line = { toMega: cut('toMega'), fromMega: cut('fromMega'), toMajor: cut('toMajor'), fromMajor: cut('fromMajor') };

  // 4. Move airports across the lines — only in the direction they rolled.
  const tiers = {};
  const rolled = (code) => size.get(code) * f(code);
  for (const a of AIRPORTS) {
    if (isMetroSecondary(a.code)) continue;
    const real = baseTierOf(a.code);
    const roll = f(a.code);
    const s = rolled(a.code);
    let t = real;
    if (real === 'mega'     && roll <= LINES.fromMega.roll  && s <  line.fromMega)  t = 'major';
    if (real === 'major'    && roll >= LINES.toMega.roll    && s >= line.toMega)    t = 'mega';
    if (real === 'major'    && roll <= LINES.fromMajor.roll && s <  line.fromMajor) t = 'regional';
    if (real === 'regional' && roll >= LINES.toMajor.roll   && s >= line.toMajor)   t = 'major';
    if (t !== real) tiers[a.code] = t;
  }

  // 5. Mega cap (the default): never more megas than the real world has. The
  //    incumbents keep their seats unless their own roll took them out; a
  //    promoted major only gets a seat a slumping mega gave up, biggest first.
  if (!uncapMegas) {
    const freed = Object.keys(tiers).filter(c => baseTierOf(c) === 'mega').length;
    const risers = Object.keys(tiers).filter(c => tiers[c] === 'mega')
      .sort((x, y) => rolled(y) - rolled(x));
    for (const c of risers.slice(freed)) delete tiers[c];
  }

  return { v: DEMAND_WORLD_VERSION, seed, uncapMegas, norm: Math.round(norm * 1e6) / 1e6, tiers };
}

/** True when `w` is a well-formed randomized world (what reconcileState keeps). */
export function isDemandWorld(w) {
  return !!w && typeof w === 'object' && Number.isFinite(w.seed) && Number.isFinite(w.norm)
    && w.norm > 0 && (w.tiers == null || typeof w.tiers === 'object');
}

// ── Active world (module state, set from game state like the era setters) ─────
let _activeKey = '';
let _activeSeed = null;
let _activeNorm = 1;
const _factorCache = new Map();
const _listeners = new Set();

/** Register a cache to clear whenever the active world changes. */
export function onDemandWorldChange(fn) { _listeners.add(fn); return () => _listeners.delete(fn); }

/**
 * Make `world` (or the realistic world, for null) the one every demand and tier
 * read sees. Idempotent and cheap when nothing changed — the reducer calls it on
 * every action.
 */
export function applyDemandWorld(world) {
  const w = isDemandWorld(world) ? world : null;
  const key = w ? `${w.seed}|${w.norm}|${JSON.stringify(w.tiers ?? {})}` : '';
  if (key === _activeKey) return;
  _activeKey = key;
  _activeSeed = w ? w.seed : null;
  _activeNorm = w ? w.norm : 1;
  _factorCache.clear();
  setTierOverrides(w ? (w.tiers ?? {}) : null);
  for (const fn of _listeners) { try { fn(); } catch (_) { /* a cache must never break a load */ } }
}

/** True while a randomized world is active. */
export function demandWorldActive() { return _activeSeed != null; }

/**
 * Traffic multiplier for an airport in the active world (1 in a realistic one).
 * Metro members share their primary's roll.
 */
export function demandFactor(code) {
  if (_activeSeed == null || !code) return 1;
  const key = metroPrimary(code);
  let v = _factorCache.get(key);
  if (v === undefined) {
    v = getAirport(key) ? rawRoll(_activeSeed, key) / _activeNorm : 1;
    _factorCache.set(key, v);
  }
  return v;
}

/**
 * Launch summary for the new-game toast: the biggest booms and busts among
 * airports people have heard of, and every tier change.
 */
export function summarizeDemandWorld(world, limit = 4) {
  if (!isDemandWorld(world)) return null;
  const f = (code) => rawRoll(world.seed, metroPrimary(code)) / world.norm;
  const notable = AIRPORTS.filter(a => baseTierOf(a.code) !== 'regional' && metroPrimary(a.code) === a.code)
    .map(a => ({ code: a.code, city: a.city, pct: Math.round((f(a.code) - 1) * 100) }));
  notable.sort((x, y) => y.pct - x.pct);
  const tiers = Object.entries(world.tiers ?? {}).map(([code, tier]) => ({ code, from: baseTierOf(code), to: tier }));
  return {
    booms: notable.slice(0, limit).filter(x => x.pct > 0),
    busts: notable.slice(-limit).reverse().filter(x => x.pct < 0),
    promotedToMega:  tiers.filter(t => t.to === 'mega').map(t => t.code),
    demotedFromMega: tiers.filter(t => t.from === 'mega').map(t => t.code),
    promotedToMajor: tiers.filter(t => t.from === 'regional').map(t => t.code),
    demotedToRegional: tiers.filter(t => t.to === 'regional').map(t => t.code),
  };
}
