// ─────────────────────────────────────────────────────────────────────────────
// CHARTER CONTRACTS — templates and the reference-cost fee model
//
// A charter is a fixed-fee flying job posted by the world. The fee is public;
// the COST is the player's own and nobody computes it for them up front. The
// whole skill of the feature is knowing your fleet well enough to work out
// whether a given tail can fly a given mission for less than the cheque.
//
// ── Why the fee is priced off a REFERENCE operator ──────────────────────────
// The fee never looks at the player's fleet. It is priced off the cheapest
// catalogue aircraft that could legally fly the mission (`referenceTypeFor`),
// times a per-offer margin. So the player's profit is the gap between THEIR
// aircraft's economics and a notional efficient operator's. An old thirsty
// quad loses a contract a modern twin wins, on exactly the same cheque. That
// asymmetry is the game; pricing off the player's own fleet would erase it.
//
// ── Traps are deliberate ────────────────────────────────────────────────────
// ~28% of offers (CHARTER_TRAP_RATE) carry a margin below 1.0 — priced under
// what a competent operator can fly them for. They look exactly like the good
// ones until the arithmetic is done. A player who takes everything on the
// board loses money, which is the intended lesson and not a balance bug.
//
// Nothing in this module is random: every draw is a hash of a seed string (see
// models/charterBoard.js). weeklyTick contains no RNG and must not start now.
// ─────────────────────────────────────────────────────────────────────────────

import { AIRCRAFT_TYPES, getAircraftType, aircraftAvailability } from './aircraft.js';
import { getAirport } from './airports.js';
import { weeklyLandingFee, landingCategoryFor } from './overhead.js';
import { fuelCostPerKm } from '../utils/fuel.js';
import { distanceKm } from '../utils/market.js';

// ── Contract types ───────────────────────────────────────────────────────────

export const CHARTER_TYPES = {
  ADHOC_PAX:     'adhoc_pax',
  SERIES:        'series',
  ADHOC_FREIGHT: 'adhoc_freight',
  ACMI:          'acmi',
  GOVERNMENT:    'government',
  SUBSERVICE:    'subservice',
};

// ── Fee model constants ──────────────────────────────────────────────────────

/** Share of the board priced BELOW a competent operator's cost. Locked at 28%. */
export const CHARTER_TRAP_RATE = 0.28;

/** Margin band for a trap offer — under water for anyone without an edge. */
export const CHARTER_MARGIN_TRAP = [0.86, 1.00];

/** Margin band for an honest offer. */
export const CHARTER_MARGIN_GOOD = [1.02, 1.42];

/**
 * Reliability tilts only the TOP of the honest band, never the trap band. A
 * spotless record wins you better work; it does not quietly remove the duds,
 * because reading the board is the point.
 */
export const CHARTER_RELIABILITY_MARGIN_LIFT = 0.08;

/** One-off permit / ground-agent setup at an endpoint you do not already serve. */
export const CHARTER_PERMIT_FEE_BY_TIER = { mega: 42_000, major: 26_000, regional: 12_000 };

/**
 * Per-departure handling surcharge at an unserved station, as a fraction of that
 * station's landing fee. You have no staff, no contract rates, and no gate — you
 * buy all of it from a handling agent at their price.
 */
export const CHARTER_UNSERVED_HANDLING_MULT = 0.85;

/**
 * ACMI: the customer buys the fuel. You are paid for aircraft, crew, maintenance
 * and insurance, so the fee is priced off the reference operator's NON-fuel
 * cost and the margin band means the same thing it means everywhere else.
 *
 * Fuel is around two thirds of a mission, so that base is small and ACMI returns
 * roughly a third of what fixed-fee work does per block hour. That is the
 * product, not a bug: you are not taking fuel risk, so you are not paid for it.
 * It is thin, reliable income on hours that would otherwise earn nothing — and
 * during a fuel spike, when a fixed-fee contract signed at last month's prices is
 * losing money every week, it is the only charter work still paying.
 *
 * Pricing the asset into it instead (the reference aircraft's weekly lease on
 * top) was tried and reverted: it made ACMI the most profitable contract on the
 * board at $6.4k a block hour, better than a mature scheduled route, because the
 * fee then covered a lease that the charter P&L never pays — the fleet loop
 * charges it whether the jet works or not. The balance probe caught it.
 */
export const ACMI_FUEL_IS_CUSTOMERS = true;

/**
 * ACMI is not drawn for traps. A wet lease is a rate-card business between two
 * airlines, not a competitive tender, so a systematically underpriced one is not
 * a realistic failure mode — and an underpriced fee on a base that excludes fuel
 * would be a rounding error rather than the decision the trap mechanic exists to
 * create. Traps live where the money is: fixed-fee flying.
 */
export const ACMI_HAS_NO_TRAPS = true;

// ── Reliability ──────────────────────────────────────────────────────────────
//
// The earned loop. No dice anywhere in it: a carrier that delivers is offered
// more work and better-paid work; one that walks away from contracts is offered
// scraps. A breach costs roughly four completions to work off, because the whole
// point of a signed commitment is that abandoning it hurts.

export const CHARTER_RELIABILITY_START       = 50;
export const CHARTER_RELIABILITY_ON_COMPLETE = 6;
export const CHARTER_RELIABILITY_ON_BREACH   = -22;
export const CHARTER_RELIABILITY_MIN         = 0;
export const CHARTER_RELIABILITY_MAX         = 100;

/** Apply a delivery outcome to the reliability score, clamped. */
export function applyReliability(score, delta) {
  const next = (typeof score === 'number' ? score : CHARTER_RELIABILITY_START) + delta;
  return Math.max(CHARTER_RELIABILITY_MIN, Math.min(CHARTER_RELIABILITY_MAX, Math.round(next)));
}

/** Breach penalty as a share of the contract's TOTAL fee. */
export const CHARTER_BREACH_PENALTY_RATE = 0.35;

/** How long an offer sits on the board before it is replaced. Per slot, 2–4 wk. */
export const CHARTER_OFFER_TTL_BAND = [2, 4];

// ── Reference operator ───────────────────────────────────────────────────────

/**
 * Mission cost for one type flying one round trip on a lane, at a given fuel
 * index. Deliberately the same four cost lines simulateRoute() charges, so a
 * charter can never be cheaper or dearer than the equivalent scheduled flying
 * for reasons the player cannot see.
 *
 * Landing fees are charged through weeklyLandingFee (which carries the era cost
 * scale), so an era game's charter economics move with its airport charges.
 */
export function missionCostPerWeek({
  originCode, destCode, type, flightsPerWeek = 1, fuelIndex = 1.0,
  fuelMod = 1.0, originServed = true, destServed = true,
}) {
  const o = getAirport(originCode);
  const d = getAirport(destCode);
  if (!o || !d || !type) return null;

  const dist    = distanceKm(o, d);
  const flights = flightsPerWeek * 2;              // out and back
  // Freighters pay by payload band, exactly as the cargo tick charges them —
  // reading type.category here would have billed every freighter as 'Freighter',
  // which is not in the fee table at all, and silently applied the default.
  const cat     = landingCategoryFor(type);

  const fuel    = Math.round(dist * fuelCostPerKm(type) * flights * fuelIndex * fuelMod);
  const crew    = Math.round(dist * (type.crewCostPerKm ?? 0) * flights);
  const landing = weeklyLandingFee(cat, flightsPerWeek, o.tier, d.tier);

  // Handling surcharge only at the ends you do NOT already serve (locked design
  // decision: charters never require a gate at the far end — they pay for the
  // privilege instead).
  const oFee = weeklyLandingFee(cat, flightsPerWeek, o.tier, o.tier) / 2;
  const dFee = weeklyLandingFee(cat, flightsPerWeek, d.tier, d.tier) / 2;
  const handling = Math.round(
    (originServed ? 0 : oFee * CHARTER_UNSERVED_HANDLING_MULT) +
    (destServed   ? 0 : dFee * CHARTER_UNSERVED_HANDLING_MULT)
  );

  return {
    distanceKm: Math.round(dist),
    fuel, crew, landing, handling,
    total: fuel + crew + landing + handling,
  };
}

/** One-off permit cost for the endpoints of a contract you do not serve. */
export function charterPermitFee({ originCode, destCode, originServed = true, destServed = true }) {
  const tierFee = (code) => CHARTER_PERMIT_FEE_BY_TIER[getAirport(code)?.tier ?? 'major'] ?? 26_000;
  return (originServed ? 0 : tierFee(originCode)) + (destServed ? 0 : tierFee(destCode));
}

/**
 * Can this type legally fly the mission at all? Range/runway/capacity only —
 * the player's own airframe is checked separately (and per-tail, via
 * effectiveRangeKm, so mods count).
 */
export function typeMeetsRequirement(type, req) {
  if (!type) return false;
  if (req.freighter && !type.freighter) return false;
  if (!req.freighter && type.freighter) return false;
  if (req.seats   != null && (type.seats ?? 0) < req.seats) return false;
  if (req.tonnes  != null && (type.payloadTonnes ?? 0) < req.tonnes) return false;
  if (req.distanceKm != null && (type.range ?? 0) < req.distanceKm) return false;
  if (req.runwayFt != null && (type.runwayFt ?? 0) > req.runwayFt) return false;
  return true;
}

/**
 * The notional efficient operator: of every catalogue type that could fly this
 * mission (and exists in this era), the one that does it for the least money.
 * NOT the smallest — the cheapest, which is what a real charter broker would be
 * quoting against.
 *
 * @returns {{ type, cost }|null}
 */
export function referenceTypeFor({
  originCode, destCode, seats = null, tonnes = null, runwayFt = null,
  freighter = false, flightsPerWeek = 1, fuelIndex = 1.0, calYear = null,
}) {
  const o = getAirport(originCode);
  const d = getAirport(destCode);
  if (!o || !d) return null;
  const dist = distanceKm(o, d);
  const req  = { seats, tonnes, runwayFt, freighter, distanceKm: dist };

  let best = null;
  for (const type of AIRCRAFT_TYPES) {
    if (!typeMeetsRequirement(type, req)) continue;
    if (calYear != null) {
      // Era games quote against what actually exists that year.
      const avail = aircraftAvailability(type, calYear);
      if (avail === 'future' || avail === 'expired') continue;
    } else if (type.oop != null || type.withdrawnYear != null) {
      // Classic games have a TIMELESS catalogue, which quietly made the cheapest
      // way to fly a short sector a 1959 turboprop — so every fee was quoted
      // against an aircraft no broker has chartered in fifty years, and the whole
      // board was priced too low. A broker quotes against current metal, so the
      // reference operator is restricted to types still in production.
      continue;
    }
    const cost = missionCostPerWeek({ originCode, destCode, type, flightsPerWeek, fuelIndex });
    if (!cost) continue;
    if (!best || cost.total < best.cost.total) best = { type, cost };
  }
  return best;
}

/**
 * The fee for an offer. `u` is a hash-derived unit float — the caller owns the
 * seeding so this stays pure and replayable.
 *
 * ACMI strips fuel out of the priced cost because the customer buys it; the
 * player's own fuel bill is likewise waived at tick time.
 */
export function charterFee({ refCost, refType, weeks, type, uMargin, uTrap, reliability = 50 }) {
  const isTrap = type === CHARTER_TYPES.ACMI && ACMI_HAS_NO_TRAPS
    ? false
    : uTrap < CHARTER_TRAP_RATE;
  const [lo, hi] = isTrap ? CHARTER_MARGIN_TRAP : CHARTER_MARGIN_GOOD;
  // Reliability lifts only the honest band's ceiling (see the constant's note).
  const lift = isTrap ? 0 : CHARTER_RELIABILITY_MARGIN_LIFT * ((reliability - 50) / 50);
  const margin = lo + uMargin * (hi - lo) + Math.max(-CHARTER_RELIABILITY_MARGIN_LIFT, lift);

  const priced = type === CHARTER_TYPES.ACMI
    ? Math.max(0, refCost.total - refCost.fuel)
    : refCost.total;

  const feePerWeek = Math.round(priced * margin);
  return {
    feePerWeek,
    fee: feePerWeek * weeks,
    margin: +margin.toFixed(4),
    isTrap,
  };
}

// ── Templates ────────────────────────────────────────────────────────────────
//
// weight        base board weight
// weeks         [min, max] contract term
// flights       [min, max] round trips per week
// seats/tonnes  [min, max] requirement drawn per offer
// distBand      [min, max] km — the lane lengths this kind of work happens on
// months        months (1–12) when this work is in season; weight × seasonMult
// eventAffinity per event TYPE, a weight multiplier while such an event runs
// destBias      'hub' | 'leisure' | 'remote' — what kind of far end this work
//               actually goes to, so a ski series lands at a ski field and a
//               relief rotation lands somewhere nobody schedules
// customers     flavour names

const ALL_YEAR = null;

export const CHARTER_TEMPLATES = [
  {
    id: 'adhoc_pax',
    destBias: 'hub',
    type: CHARTER_TYPES.ADHOC_PAX,
    name: 'Ad-hoc passenger charter',
    icon: '🎟️',
    color: '#4aa8ff',
    blurb: 'A one-off group movement. Short, small, and forgiving of a fleet that has an idle tail in the right place.',
    weight: 1.0,
    weeks: [1, 3],
    flights: [1, 2],
    seats: [90, 260],
    distBand: [400, 4_500],
    months: ALL_YEAR,
    seasonMult: 1.0,
    eventAffinity: { economy: 0.7 },
    reputationStake: 2,
    customers: ['a touring orchestra', 'a football club', 'a film production', 'a corporate offsite', 'a university squad', 'a conference organiser'],
  },
  {
    id: 'series_leisure',
    destBias: 'leisure',
    type: CHARTER_TYPES.SERIES,
    name: 'Tour operator series',
    icon: '🏖️',
    color: '#f5a623',
    blurb: 'A weekly programme for a holiday company. The bread and butter — and long enough that the fuel curve is your problem.',
    weight: 1.25,
    weeks: [8, 20],
    flights: [1, 4],
    seats: [140, 330],
    distBand: [800, 7_000],
    months: [5, 6, 7, 8, 9],
    seasonMult: 2.2,
    eventAffinity: { economy: 0.55, demand: 1.3 },
    reputationStake: 4,
    customers: ['a package holiday group', 'a Mediterranean resort chain', 'a cruise line feeder programme', 'a coastal tour operator'],
  },
  {
    id: 'series_ski',
    destBias: 'leisure',
    type: CHARTER_TYPES.SERIES,
    name: 'Winter sports series',
    icon: '🎿',
    color: '#8fd4ff',
    blurb: 'Weekend lift into the mountains through the season. Short field, bad weather, good money.',
    weight: 0.85,
    weeks: [8, 16],
    flights: [1, 3],
    seats: [120, 240],
    distBand: [500, 3_500],
    months: [12, 1, 2, 3],
    seasonMult: 2.6,
    eventAffinity: { economy: 0.6 },
    reputationStake: 4,
    customers: ['an alpine holiday group', 'a ski club consortium', 'a winter sports operator'],
  },
  {
    id: 'adhoc_freight',
    destBias: 'hub',
    type: CHARTER_TYPES.ADHOC_FREIGHT,
    name: 'Ad-hoc freight charter',
    icon: '📦',
    color: '#e8833a',
    blurb: 'Outsize or urgent freight that will not wait for a scheduled service. Needs a freighter with the payload to take it.',
    weight: 0.9,
    weeks: [1, 4],
    flights: [1, 3],
    tonnes: [18, 95],
    distBand: [900, 9_000],
    months: ALL_YEAR,
    seasonMult: 1.0,
    eventAffinity: { disruption: 1.4, economy: 0.8 },
    reputationStake: 3,
    freighter: true,
    customers: ['an energy contractor', 'a mining consortium', 'an automotive line stoppage', 'a satellite integrator', 'a freight forwarder'],
  },
  {
    id: 'acmi',
    destBias: 'hub',
    type: CHARTER_TYPES.ACMI,
    name: 'ACMI wet-lease',
    icon: '🤝',
    color: '#9d8cff',
    blurb: 'Another carrier is short of lift. You supply aircraft, crew, maintenance and insurance — they buy the fuel. Thin margin, almost no risk.',
    weight: 1.0,
    weeks: [6, 16],
    flights: [2, 5],
    seats: [140, 300],
    distBand: [600, 5_500],
    months: ALL_YEAR,
    seasonMult: 1.0,
    eventAffinity: { fuel: 1.9, disruption: 1.3 },
    reputationStake: 3,
    customers: ['a regional carrier', 'a flag carrier short of lift', 'a start-up airline awaiting delivery', 'a leisure carrier in peak season'],
  },
  {
    id: 'government',
    destBias: 'remote',
    type: CHARTER_TYPES.GOVERNMENT,
    name: 'Government rotation',
    icon: '🏛️',
    color: '#38d39f',
    blurb: 'Relief, personnel or pilgrimage lift into awkward fields. Pays well because most operators cannot take it.',
    weight: 0.7,
    weeks: [4, 12],
    flights: [1, 3],
    seats: [180, 400],
    distBand: [2_500, 12_000],
    months: ALL_YEAR,
    seasonMult: 1.0,
    eventAffinity: { disruption: 1.6, economy: 1.15 },
    reputationStake: 6,
    shortField: true,
    customers: ['a relief agency', 'a defence ministry', 'a pilgrimage authority', 'a disaster response agency', 'a UN mission'],
  },
  {
    id: 'subservice',
    destBias: 'hub',
    type: CHARTER_TYPES.SUBSERVICE,
    name: 'Sub-service cover',
    icon: '🚨',
    color: '#ff5d6c',
    blurb: 'A rival is on the ground with a broken jet and passengers to move. Short, urgent, and priced like it.',
    weight: 0.55,
    weeks: [1, 3],
    flights: [3, 7],
    seats: [100, 250],
    distBand: [300, 3_000],
    months: ALL_YEAR,
    seasonMult: 1.0,
    eventAffinity: { disruption: 2.4 },
    reputationStake: 3,
    customers: ['a rival carrier', 'a regional operator', 'a competing low-cost airline'],
  },
];

export function getCharterTemplate(id) {
  return CHARTER_TEMPLATES.find(t => t.id === id) ?? null;
}

/**
 * A template's weight for a given month and world-event mix. Season and events
 * shape the board because the board is part of the WORLD — it is not a per-airline
 * dice roll, and nothing here reads the player's own airline.
 */
export function templateWeight(tmpl, month = null, activeEvents = []) {
  let w = tmpl.weight ?? 1;
  if (tmpl.months && month != null && tmpl.months.includes(month)) w *= (tmpl.seasonMult ?? 1);
  else if (tmpl.months && month != null) w *= 0.25;   // out of season, not extinct
  for (const ev of activeEvents ?? []) {
    const mult = tmpl.eventAffinity?.[ev?.type];
    if (mult != null) w *= mult;
  }
  return Math.max(0, w);
}
