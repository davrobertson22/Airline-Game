// ─────────────────────────────────────────────────────────────────────────────
// RIVAL BRAIN — how an AI airline decides, as pure helpers.
//
// The 2026-11-11 audit (project doc claude/ai-airlines-audit-2026-11-11.md) ran
// the adaptive AI through three seeded ten-year worlds and measured what it did:
//   · 65% of the routes it launched were withdrawn within a year — it never
//     asked its own route P&L whether a route would pay;
//   · it chose aircraft by the seat count closest to a fixed tier target, so
//     premium carriers flew Il-86s and 44% of routes had a 240+ seater under
//     1,500 km;
//   · 23% of routes touched neither end of the carrier's home country and half
//     of all second hubs were abroad;
//   · 83% of routes sat on the load cap with a fare that never moved;
//   · a rival's income split a pair equally by head count, so nothing the
//     player did to fares, seats or quality reached a rival's books.
//
// What lives here:
//   home market      — where a carrier may base aircraft and what its routes
//                      must touch (every game);
//   aircraft fit     — the seat size a lane wants, and how well a type fits it
//                      (every game);
//   pair contest     — who wins what on a shared city pair, from frequency,
//                      fare and quality (smart-rival worlds: new games);
//   yield, age       — fare bounds, and what an old airframe costs to keep
//                      (smart-rival worlds).
// The decisions themselves stay in competitorAI.js; the route P&L in demand.js.
// This module imports data only, so both can import it.
// ─────────────────────────────────────────────────────────────────────────────

import { AIRPORTS, getAirport } from '../data/airports.js';
import { sameSovereign } from '../data/territories.js';
import { getAircraftType, maxSeatsForRange } from '../data/aircraft.js';
import { referencePrice } from '../utils/market.js';

const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// ─── Home market ─────────────────────────────────────────────────────────────
//
// An airline bases aircraft in its own country and flies between its country
// and others. It does not open Tokyo as a hub because it happens to fly there
// from Manila. The one large exception is the European single aviation market,
// where any member's airline may fly any route: that is how the real low-cost
// carriers got their bases.
//
// Years are approximate on purpose (the third package took effect in 1993; the
// big enlargement was 2004). A classic world reads as 2026.
const SINGLE_MARKET_FROM = {
  AT: 1993, BE: 1993, DK: 1993, FI: 1993, FR: 1993, DE: 1993, GR: 1993, IE: 1993,
  IT: 1993, LU: 1993, NL: 1993, PT: 1993, ES: 1993, SE: 1993, IS: 1993, NO: 1993,
  GB: 1993,
  CH: 2002,
  CY: 2004, CZ: 2004, EE: 2004, HU: 2004, LV: 2004, LT: 2004, MT: 2004, PL: 2004,
  SK: 2004, SI: 2004, BG: 2007, RO: 2007, HR: 2013,
};
/** The United Kingdom left the single market at the end of 2020. */
const SINGLE_MARKET_UNTIL = { GB: 2020 };

function inSingleMarket(country, year) {
  const from = SINGLE_MARKET_FROM[country];
  if (from == null) return false;
  const y = year ?? 2026;
  return y >= from && y <= (SINGLE_MARKET_UNTIL[country] ?? Infinity);
}

/** Two countries an airline of the first may treat as one home market. */
export function sameHomeMarket(countryA, countryB, year = null) {
  if (!countryA || !countryB) return false;
  if (sameSovereign(countryA, countryB)) return true;
  return inSingleMarket(countryA, year) && inSingleMarket(countryB, year);
}

export function homeCountryOf(airline) {
  return getAirport(airline?.homeHub)?.country ?? null;
}

/** Is this airport in the carrier's home market — somewhere it may base aircraft? */
export function inHomeMarket(airline, code, year = null) {
  const home = homeCountryOf(airline);
  // A carrier whose home airport is unknown is not policed: never stop it flying.
  if (!home) return true;
  return sameHomeMarket(home, getAirport(code)?.country ?? null, year);
}

/** A route an airline may open: at least one end in its home market. */
export function routeTouchesHome(airline, a, b, year = null) {
  return inHomeMarket(airline, a, year) || inHomeMarket(airline, b, year);
}

// ─── Aircraft fit ────────────────────────────────────────────────────────────
//
// Seat counts here are the catalogue's exit-limit seats (an A320neo is 194, a
// 787-9 is 420), which is what an AI route flies.

/** Departures a week each way a lane of this length is normally sold at. */
export function idealFrequency(distKm) {
  if (distKm < 800)  return 21;
  if (distKm < 1500) return 14;
  if (distKm < 4500) return 10;
  if (distKm < 9000) return 7;
  return 5;
}

/** The size of aircraft a carrier of this tier would put on a lane, knowing nothing else. */
export function stageSeatTarget(tier, distKm) {
  const band = distKm < 1500 ? 0 : distKm < 4500 ? 1 : distKm < 9000 ? 2 : 3;
  const table = {
    budget:  [190, 215, 240, 400],
    legacy:  [190, 225, 420, 440],
    premium: [190, 230, 440, 460],
  };
  return (table[tier] ?? table.legacy)[band];
}

/**
 * The seat size a lane wants. With the passengers the carrier expects each way
 * a week, the aircraft is sized so the lane's normal frequency fills it — a
 * thin short route gets a regional aircraft, a thin long one a long-range
 * narrowbody — within a band around what the tier would normally fly there.
 */
export function seatTargetFor(tier, distKm, demand = null) {
  const def = stageSeatTarget(tier, distKm);
  if (!(demand > 0)) return def;
  const want = demand / (idealFrequency(distKm) * 0.8);
  return Math.round(clamp(want, def * 0.4, def * 1.3));
}

/**
 * The largest aircraft a lane may be given, by stage length and tier. Short
 * haul stays narrowbody (gates, turn times, slots) and budget carriers fly
 * narrowbodies wherever one can reach.
 */
export function seatCeilingFor(distKm, tier) {
  const byStage = distKm < 1500 ? 250 : distKm < 3500 ? 330 : Infinity;
  return tier === 'budget' && distKm < 6000 ? Math.min(byStage, 250) : byStage;
}

// Soviet, Russian and Chinese types sold at home and to aligned states. A
// Canadian or Singaporean airline did not buy them, and does not here unless
// its rival set names them.
const EASTERN_MAKER = /antonov|ilyushin|irkut|sukhoi|tupolev|yakovlev|comac|xian/i;
const EASTERN_SPHERE = new Set(['RU', 'SU', 'BY', 'UA', 'KZ', 'UZ', 'KG', 'TJ', 'TM', 'AM', 'AZ', 'GE', 'MD',
  'CN', 'KP', 'MN', 'CU', 'VN', 'LA']);
const EASTERN_SPHERE_TO_1991 = new Set(['PL', 'CZ', 'CS', 'SK', 'HU', 'RO', 'BG', 'DD', 'YU', 'AL', 'EG', 'SY', 'IQ', 'AF', 'AO', 'ET']);

function makerInReach(type, home, year) {
  if (!EASTERN_MAKER.test(String(type?.manufacturer ?? ''))) return true;
  if (!home) return false;
  if (EASTERN_SPHERE.has(home)) return true;
  return year != null && year <= 1991 && EASTERN_SPHERE_TO_1991.has(home);
}

/**
 * How badly a type fits a lane — lower is better, 0 is a perfect fit.
 *
 * @param {object} type
 * @param {object} o
 *   distKm   the longest sector it must fly
 *   tier     'budget' | 'legacy' | 'premium'
 *   target   seats wanted (seatTargetFor)
 *   year     the world's calendar year, or null in a classic world (reads as 2026)
 *   home     the carrier's home country, or null when not known
 *   anyMaker the carrier's rival set named its types or makers: no maker rule
 *   house    the maker the carrier leans to (houseMakerOf), or null
 */
export function aircraftFitScore(type, { distKm, tier, target, year = null, home = null, anyMaker = false, house = null }) {
  const y     = year ?? 2026;
  const seats = maxSeatsForRange(type, distKm) || (type.seats ?? 0);
  let s = Math.abs(seats - target) / Math.max(1, target);
  // Range far beyond the mission is weight carried for nothing.
  s += Math.max(0, (type.range ?? 0) - distKm * 1.25) * 0.008 / Math.max(60, target);
  // A closed line: a carrier ordering today orders what is being built.
  if (type.oop != null && y > type.oop) s += 0.30 + 0.02 * Math.min(25, y - type.oop);
  // And of what is being built, the newer design.
  s += Math.min(0.12, 0.003 * Math.max(0, y - (type.eis ?? y)));
  // A classic world's catalogue is timeless; its airlines still fly 2026's aircraft.
  if (year == null && (type.eis ?? 0) > 2026) s += 5;
  // Business jets and air taxis are not airliners.
  if (seats < 30 && target >= 45) s += 3;
  if (type.category === 'Supersonic') s += 3;
  if (seats > seatCeilingFor(distKm, tier)) s += 1.5;
  if (!anyMaker && !makerInReach(type, home, year)) s += 0.8;
  if (isOtherHouse(type, house)) s += 0.12;
  return s;
}

/**
 * Seats a carrier fits, as a share of the exit limit. A premium carrier gives
 * a quarter of the floor to its cabins; without that it sold a budget
 * carrier's seat count at nearly twice the fare, and once it stopped flying
 * Il-86s it out-earned every other tier several times over. (A legacy cabin
 * stays at the limit: its fare is close to the reference fare already.)
 */
export const CABIN_DENSITY = { budget: 1, legacy: 1, premium: 0.75 };

/** Seats a carrier of this tier flies on a lane of this length with this type. */
export function rivalLaneSeats(type, distKm, tier) {
  const max = maxSeatsForRange(type, distKm) || (type?.seats ?? 0);
  return Math.max(1, Math.round(max * (CABIN_DENSITY[tier] ?? 1)));
}

/**
 * The maker a carrier leans to when its rival set names none: Airbus or
 * Boeing, fixed for the life of the carrier by its id. It is a lean, not a
 * rule — a type from the other house still wins when it suits a lane clearly
 * better — and it is what stops every airline in the world flying one fleet.
 */
export function houseMakerOf(airline) {
  if (airline?.fleetPref && (airline.fleetPref.types?.length || airline.fleetPref.maker)) return null;
  const id = String(airline?.id ?? airline?.name ?? '');
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 33 + id.charCodeAt(i)) & 0xffff;
  return h % 2 === 0 ? 'Airbus' : 'Boeing';
}
/** How much less a type from the other house is worth to a carrier. */
export const OTHER_HOUSE_VALUE = 0.85;
/** Whether a type is from the big house a carrier does not lean to. */
export function isOtherHouse(type, house) {
  const m = String(type?.manufacturer ?? '');
  return !!house && (m === 'Airbus' || m === 'Boeing') && m !== house;
}

/** Departures a week to open a route with, for the passengers expected and the seats flown. */
export function launchFrequency(demandOneWay, seats) {
  return clamp(Math.round((demandOneWay || 0) / Math.max(1, seats * 0.78)), 3, 21);
}

// ─── Secondary airports ──────────────────────────────────────────────────────
//
// Smart-rival worlds: rivals used to choose only among mega and major
// airports, so every regional airport in the world was the player's alone.
// Every carrier now also looks at the regional airports of its home market
// (for a European carrier, the single market's).
const SECONDARY_MIN_POPULATION = 0.25;   // millions, the airport table's own figure
let _secondaryByCountry = null;

function secondaryByCountry() {
  if (_secondaryByCountry) return _secondaryByCountry;
  _secondaryByCountry = new Map();
  for (const a of AIRPORTS) {
    if ((a.effectivePop ?? a.population ?? 0) < SECONDARY_MIN_POPULATION) continue;
    if (!_secondaryByCountry.has(a.country)) _secondaryByCountry.set(a.country, []);
    _secondaryByCountry.get(a.country).push(a);
  }
  return _secondaryByCountry;
}

/** Regional airports a carrier would consider, beyond the big-airport pool. */
export function secondaryAirportsFor(airline, year = null) {
  const home = homeCountryOf(airline);
  if (!home) return [];
  const out = [];
  for (const [country, list] of secondaryByCountry()) {
    if (!sameHomeMarket(home, country, year)) continue;
    // Tiers move in a randomised-demand world, so read the tier now.
    for (const a of list) if (a.tier === 'regional') out.push(a);
  }
  return out;
}

// ─── Pair contest ────────────────────────────────────────────────────────────
//
// Smart-rival worlds. Who wins what on a city pair several airlines fly. The
// old split gave every carrier the same slice whatever it offered. This one
// weighs each offer the way passengers do — more departures, a lower fare, a
// better product — and hands the passengers a full airline turns away to the
// others. The player's flights are one of the offers, so a rival loses
// passengers to a player who out-flies or under-prices it, and wins them back
// when the player sells out.

export const PLAYER_OFFER_ID = '__player__';
const CONTEST_LOAD_CAP   = 0.88;   // the AI route P&L's own ceiling
const SPILL_RECAPTURE    = 0.6;    // of the passengers a full airline turns away
const TIER_DEFAULT_SEATS = { budget: 162, legacy: 250, premium: 335 };

/** Every offer on every pair: Map pairKey → [{ id, freq, seats, mult, quality }]. */
export function buildPairContest(competitors, playerRoutes = []) {
  const contest = new Map();
  const push = (key, e) => { if (!contest.has(key)) contest.set(key, []); contest.get(key).push(e); };
  const mine = new Map();
  for (const r of playerRoutes ?? []) {
    const freq = r.weeklyFrequency ?? 0;
    if (!(freq > 0)) continue;
    const key  = [r.origin, r.destination].sort().join('-');
    const ref  = referencePrice(r.origin, r.destination);
    const prev = mine.get(key) ?? { freq: 0, seatFlights: 0, fareFlights: 0, qFlights: 0 };
    prev.freq        += freq;
    prev.seatFlights += (r.seats ?? 180) * freq;
    prev.fareFlights += (ref > 0 && r.ticketPrice > 0 ? r.ticketPrice / ref : 1) * freq;
    prev.qFlights    += (r.quality ?? 60) * freq;
    mine.set(key, prev);
  }
  for (const [key, m] of mine) {
    push(key, { id: PLAYER_OFFER_ID, freq: m.freq, seats: m.seatFlights / m.freq,
      mult: m.fareFlights / m.freq, quality: m.qFlights / m.freq });
  }
  for (const c of competitors ?? []) {
    const quality = (c.baseQualityScore ?? 60) + (c.allianceId ? 3 : 0);
    for (const [key, cfg] of Object.entries(c.routes ?? {})) {
      push(key, { id: c.id, freq: cfg.frequency ?? 0,
        seats: cfg.seats ?? getAircraftType(cfg.aircraftType)?.seats ?? TIER_DEFAULT_SEATS[c.tier] ?? 200,
        mult: cfg.priceMultiplier ?? 1, quality });
    }
  }
  return contest;
}

/**
 * How strongly one offer pulls passengers. Tuned so a budget, a legacy and a
 * premium carrier at their usual fares and quality pull about equally: a
 * premium product earns back what a premium fare costs it.
 */
export function offerPull(e) {
  return Math.pow(Math.max(1, e.freq ?? 1), 0.8)
    * Math.pow(1 / Math.max(0.3, e.mult ?? 1), 2.0)
    * Math.exp(((e.quality ?? 60) - 60) / 35);
}

/**
 * One carrier's one-way weekly demand on a pair, before its own load cap.
 *
 * @param {object[]|undefined} others  the pair's offers from buildPairContest
 * @param {object} own                 this carrier's offer { id, freq, seats, mult, quality }
 * @param {number} pool                the pair's one-way weekly demand at the reference fare
 * Alone on the pair, and for identical carriers, this is exactly the old split.
 */
export function contestDemand(others, own, pool) {
  const field = [...(others ?? []).filter(e => e.id !== own.id && (e.freq ?? 0) > 0), own];
  const n     = field.length;
  const grown = pool * Math.pow(n, 0.15);
  const pulls = field.map(offerPull);
  const total = pulls.reduce((s, p) => s + p, 0) || 1;
  const raw   = field.map((e, i) => grown * (pulls[i] / total) * Math.pow(1 / Math.max(0.3, e.mult ?? 1), 1.3));
  const cap   = field.map(e => (e.seats ?? 0) * (e.freq ?? 0) * CONTEST_LOAD_CAP);
  const ownIx = n - 1;
  let demand  = raw[ownIx];
  if (n > 1 && raw[ownIx] < cap[ownIx]) {
    let spilled = 0, roomPull = 0;
    for (let i = 0; i < n; i++) {
      if (raw[i] > cap[i]) spilled += raw[i] - cap[i];
      else roomPull += pulls[i];
    }
    if (spilled > 0 && roomPull > 0) demand += spilled * SPILL_RECAPTURE * (pulls[ownIx] / roomPull);
  }
  return demand;
}

// ─── Yield management ────────────────────────────────────────────────────────

/** One fare move, as a share of the reference fare. */
export const YIELD_STEP = 0.03;
/** How far toward its tier's fare ceiling a carrier lets a sold-out route climb. */
export const YIELD_CEILING_SHARE = 0.5;
/** Alone on a pair, it goes this much further. */
export const MONOPOLY_CEILING_LIFT = 1.06;

const TIER_FARE_BAND = {
  budget:  { floor: 0.65, ceiling: 0.90 },
  legacy:  { floor: 0.85, ceiling: 1.20 },
  premium: { floor: 1.25, ceiling: 1.70 },
};
/** The fare a tier opens a route at (demand.js TIER_PRICE_MULT). */
const TIER_FARE_BASE = { budget: 0.76, legacy: 1.04, premium: 1.45 };

/**
 * The fare band a carrier keeps a route inside, as multiples of the reference
 * fare: its own floor (the one its price reactions to the player already use),
 * and a ceiling half way from its opening fare to its tier's ceiling — for a
 * legacy carrier 0.85 to 1.12, or 1.19 where it has the pair to itself.
 */
export function fareBand(airline, carriersOnPair = 1) {
  const band  = airline?._pricing ?? TIER_FARE_BAND[airline?.tier] ?? TIER_FARE_BAND.legacy;
  const base  = TIER_FARE_BASE[airline?.tier] ?? 1;
  const floor = band.floor ?? 0.85;
  const top   = Math.max(base, band.ceiling ?? 1.2);
  const ceiling = (base + (top - base) * YIELD_CEILING_SHARE) * (carriersOnPair <= 1 ? MONOPOLY_CEILING_LIFT : 1);
  return { floor, ceiling };
}

// ─── Fleet age ───────────────────────────────────────────────────────────────

/**
 * What an airframe costs to maintain as it ages, as a multiple of a new one:
 * about 1.2× at 6 years, 2.3× at 16, 3.5× at 22 — the same curve the player's
 * delivered-age bands are balanced on (a 16-year-old frame at 2.28×).
 */
export function ageMaintenanceMult(ageWeeks) {
  const years = Math.max(0, ageWeeks ?? 0) / 52;
  return Math.min(5.5, 1 + 1.3 * Math.pow(years / 16, 2));
}

/** A fleet this old is replaced when its owner can pay for it. */
export const RENEWAL_AGE_YEARS = 14;
