// ─────────────────────────────────────────────────────────────────────────────
// charterBoard.js — the rotating board of charter offers.
//
// ── The board is DERIVED, never stored ──────────────────────────────────────
// Every offer is a pure function of (world seed, slot index, the week the slot
// last refreshed). Nothing is persisted, so the board survives a save/load
// unchanged, replays identically, and a projection can neither predict nor burn
// a draw. weeklyTick contains no RNG and this module does not change that: the
// only "randomness" here is hash32 (models/departureBoard.js), the same FNV-1a
// construction weeklyLoadJitter uses.
//
// ── Slots refresh on their own cycle ────────────────────────────────────────
// The whole board does NOT turn over each week. Slot i has a fixed time-to-live
// of 2–4 weeks and a fixed phase, so its current offer was posted at
//     postedWeek = absWeek - ((absWeek + phase) mod ttl)
// and is replaced ttl weeks later. A big contract you are clearing hours for
// therefore stays put long enough to plan around, and one or two slots turn
// over in any given week.
//
// ── The board is the WORLD's, not a roll on the player ──────────────────────
// Season and active world events shape what is posted (templateWeight). What
// the PLAYER's own record changes is how MUCH work they are shown and how well
// it pays — awareness, reputation and charterReliability set the slot count and
// tilt the honest margin band. A carrier that delivers gets offered better work;
// nobody gets singled out by dice.
// ─────────────────────────────────────────────────────────────────────────────

import { AIRPORTS, getAirport } from '../data/airports.js';
import { distanceKm } from '../utils/market.js';
import { hash32 } from './departureBoard.js';
import {
  CHARTER_TEMPLATES, CHARTER_TYPES, CHARTER_OFFER_TTL_BAND, CHARTER_BREACH_PENALTY_RATE,
  templateWeight, referenceTypeFor, charterFee, charterPermitFee, missionCostPerWeek,
  charterFleetProfile, executiveAssetShare,
} from '../data/charters.js';
import { blockTimeHours } from '../utils/simulation.js';

// ── Deterministic draws ──────────────────────────────────────────────────────

/** Hash to a float in [0,1). */
export function hashUnit(str) {
  return hash32(str) / 0x100000000;
}

/** Hash to an integer in [min, max]. */
export function hashRange(str, min, max) {
  return min + Math.floor(hashUnit(str) * (max - min + 1));
}

/** Weighted pick. `entries` is [{ item, weight }]; `u` a unit float. */
export function pickWeighted(entries, u) {
  const total = entries.reduce((s, e) => s + Math.max(0, e.weight), 0);
  if (!(total > 0)) return null;
  let x = u * total;
  for (const e of entries) {
    x -= Math.max(0, e.weight);
    if (x <= 0) return e.item;
  }
  return entries[entries.length - 1].item;
}

// ── Board size ───────────────────────────────────────────────────────────────

export const CHARTER_MIN_SLOTS = 2;
export const CHARTER_MAX_SLOTS = 7;

/**
 * Awareness below this and brokers have barely heard of you. It ramps the board
 * rather than adding to it, because a carrier nobody knows is not offered a
 * thinner board — it is offered almost nothing, whatever its other numbers say.
 */
export const CHARTER_AWARENESS_GATE = 30;

/**
 * How many offers this airline is shown. Earned, not rolled: brokers post work
 * to carriers they have heard of (awareness), rate (reputation) and trust to
 * deliver (charterReliability).
 *
 * Awareness is a GATE, not a third of the score. Reputation and reliability both
 * start at 50 for a brand-new airline, so scoring them flat handed a week-one
 * startup most of a full board on the strength of two default values.
 */
export function charterSlotCount({ awareness = 5, reputation = 50, reliability = 50 } = {}) {
  const a = Math.max(0, Math.min(100, awareness));
  const r = Math.max(0, Math.min(100, reputation))  / 100;
  const c = Math.max(0, Math.min(100, reliability)) / 100;
  const gate  = Math.min(1, a / CHARTER_AWARENESS_GATE);
  const score = gate * (0.50 * (a / 100) + 0.25 * r + 0.25 * c);
  return Math.max(CHARTER_MIN_SLOTS,
    Math.min(CHARTER_MAX_SLOTS, CHARTER_MIN_SLOTS + Math.round(score * (CHARTER_MAX_SLOTS - CHARTER_MIN_SLOTS))));
}

/** Slot i's fixed refresh period, 2–4 weeks. Depends on the slot only. */
export function slotTtl(slot) {
  const [lo, hi] = CHARTER_OFFER_TTL_BAND;
  return lo + (slot % (hi - lo + 1));
}

/** The week slot i's CURRENT offer was posted. */
export function slotPostedWeek(seed, slot, absWeek) {
  const ttl   = slotTtl(slot);
  const phase = hash32(`${seed}|charter|phase|${slot}`) % ttl;
  const w     = Math.max(0, Math.floor(absWeek));
  return w - ((w + phase) % ttl);
}

// ── Airport pools ────────────────────────────────────────────────────────────

const TIER_WEIGHT = { mega: 8, major: 4, regional: 0.35 };

/** How attractive an airport is as the FAR end of this kind of work. */
function destWeight(airport, bias) {
  const tier = TIER_WEIGHT[airport.tier] ?? 1;
  const vis  = airport.visitors ?? 0;
  if (bias === 'leisure') return 0.2 + vis * 6 + tier * 0.25;
  if (bias === 'remote')  return airport.tier === 'regional' ? 1.4 : tier * 0.2;
  return tier;                                   // 'hub' — follows the big fields
}

/**
 * Airports this airline is known at: everywhere it flies, plus its hubs and
 * focus cities. Offers are posted where you already are — that is what makes
 * positioning the network-knowledge lever rather than a random tax.
 */
export function servedAirportsOf({ routes = [], cargoRoutes = [], hubs = {}, gates = {} } = {}) {
  const set = new Set();
  for (const r of [...routes, ...cargoRoutes]) {
    if (r?.origin) set.add(r.origin);
    if (r?.destination) set.add(r.destination);
    for (const s of r?.stops ?? []) set.add(s);
  }
  for (const code of Object.keys(hubs ?? {})) set.add(code);
  for (const [code, n] of Object.entries(gates ?? {})) if (n > 0) set.add(code);
  return set;
}

/**
 * Origin candidates, as GROUPS with a fixed share of the total weight.
 *
 * Normalising by group is the whole point: the home country holds hundreds of
 * airports and the network holds a handful, so raw per-airport weights let the
 * home pool swamp the network entirely and every offer got posted somewhere the
 * player had never flown. Charter work comes to carriers where they already
 * operate — that is what makes positioning a decision and not a random tax.
 */
const ORIGIN_SHARE_SERVED = 0.78;
const ORIGIN_SHARE_HOME   = 0.22;

/** Scale a group's entries so they sum to `share`. */
function normaliseGroup(entries, share) {
  const total = entries.reduce((s, e) => s + e.weight, 0);
  if (!(total > 0)) return [];
  return entries.map(e => ({ item: e.item, weight: (e.weight / total) * share }));
}

function originPool({ served, hubs, homeCountry, stretch }) {
  if (stretch) {
    // One slot per board reaches beyond the network — there should always be
    // something on it you cannot quite take yet.
    return AIRPORTS.filter(a => a.tier === 'mega' || a.tier === 'major')
      .map(a => ({ item: a.code, weight: TIER_WEIGHT[a.tier] ?? 1 }));
  }
  const servedEntries = [];
  for (const code of served) {
    const a = getAirport(code);
    if (a) servedEntries.push({ item: code, weight: (hubs?.[code] != null ? 3 : 1) });
  }
  const homeEntries = [];
  if (homeCountry) {
    for (const a of AIRPORTS) {
      if (a.country !== homeCountry || served.has(a.code)) continue;
      homeEntries.push({ item: a.code, weight: TIER_WEIGHT[a.tier] ?? 1 });
    }
  }
  // With no network at all (week one, no routes yet) the home country carries
  // the whole board rather than returning nothing.
  if (servedEntries.length === 0) return normaliseGroup(homeEntries, 1);
  return [
    ...normaliseGroup(servedEntries, ORIGIN_SHARE_SERVED),
    ...normaliseGroup(homeEntries,   ORIGIN_SHARE_HOME),
  ];
}

/** Destination candidates: anything in the template's lane-length band. */
function destPool(originCode, tmpl) {
  const o = getAirport(originCode);
  if (!o) return [];
  const [lo, hi] = tmpl.distBand;
  const out = [];
  for (const a of AIRPORTS) {
    if (a.code === originCode) continue;
    const d = distanceKm(o, a);
    if (d < lo || d > hi) continue;
    const w = destWeight(a, tmpl.destBias ?? 'hub');
    if (w > 0) out.push({ item: a.code, weight: w });
  }
  return out;
}

// ── Offer generation ─────────────────────────────────────────────────────────

/**
 * Build one slot's offer. Returns null when the slot cannot produce a legal
 * contract (no airport pair in band, or nothing in the catalogue can fly it) —
 * the board simply shows one fewer card that week.
 */
export function generateOffer({
  seed, slot, absWeek, served, hubs = {}, homeCountry = '', month = null,
  activeEvents = [], reliability = 50, fuelIndex = 1.0, calYear = null,
  fleetProfile = null,
}) {
  const postedWeek = slotPostedWeek(seed, slot, absWeek);
  const ttl        = slotTtl(slot);
  const key        = `${seed}|charter|${slot}|${postedWeek}`;
  const stretch    = slot === 0 && hashUnit(`${key}|stretch`) < 0.5;

  const weighted = CHARTER_TEMPLATES.map(t => ({ item: t, weight: templateWeight(t, month, activeEvents, fleetProfile) }));
  const origins  = originPool({ served, hubs, homeCountry, stretch });
  if (origins.length === 0) return null;

  // Bounded, deterministic re-roll. A drawn mission can be legally impossible —
  // a 300-seat relief rotation into a 5,000 ft strip has no aircraft that can
  // fly it — and dropping the slot silently left holes in the board. Re-rolling
  // with a salt keeps the board full without introducing a single random draw.
  const ATTEMPTS = 8;
  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    const salt = attempt === 0 ? '' : `|r${attempt}`;

    const tmpl = pickWeighted(weighted, hashUnit(`${key}|tmpl${salt}`));
    if (!tmpl) return null;

    const origin = pickWeighted(origins, hashUnit(`${key}|org${salt}`));
    if (!origin) continue;

    const dests = destPool(origin, tmpl);
    const destination = pickWeighted(dests, hashUnit(`${key}|dst${salt}`));
    if (!destination) continue;

    const o = getAirport(origin);
    const d = getAirport(destination);
    const dist = Math.round(distanceKm(o, d));

    const weeks          = hashRange(`${key}|wks${salt}`, tmpl.weeks[0], tmpl.weeks[1]);
    const flightsPerWeek = hashRange(`${key}|frq${salt}`, tmpl.flights[0], tmpl.flights[1]);

    const seatsRequired  = tmpl.seats
      ? hashRange(`${key}|seat${salt}`, tmpl.seats[0], tmpl.seats[1]) : null;
    const tonnesRequired = tmpl.tonnes
      ? hashRange(`${key}|ton${salt}`, tmpl.tonnes[0], tmpl.tonnes[1]) : null;

    // The mission must be flyable from BOTH fields, so the tighter runway governs.
    const runwayFt = Math.min(o.runwayFt ?? 99_999, d.runwayFt ?? 99_999);

    const ref = referenceTypeFor({
      originCode: origin, destCode: destination,
      seats: seatsRequired, tonnes: tonnesRequired, runwayFt,
      freighter: !!tmpl.freighter, bizjet: !!tmpl.bizjet, flightsPerWeek, fuelIndex, calYear,
    });
    if (!ref) continue;                       // nothing in this era can fly it

    // Executive work bills the asset pro rata to the hours it takes (see
    // EXECUTIVE_FEE_INCLUDES_ASSET). Measured on the reference jet, out and back,
    // with the engine's own block-time arithmetic so the fee and the tick agree.
    const assetShare = tmpl.type === CHARTER_TYPES.EXECUTIVE
      ? executiveAssetShare(ref.type, blockTimeHours(dist, ref.type) * 2 * flightsPerWeek)
      : 0;

    const { fee, feePerWeek, margin, isTrap } = charterFee({
      refCost: ref.cost, refType: ref.type, weeks, type: tmpl.type, reliability,
      uMargin: hashUnit(`${key}|mrg${salt}`), uTrap: hashUnit(`${key}|trap${salt}`),
      assetShare,
    });

    const customer = tmpl.customers[hashRange(`${key}|cust${salt}`, 0, tmpl.customers.length - 1)];

    return {
      id: `chtr-${slot}-${postedWeek}-${(hash32(key + salt) % 46656).toString(36)}`,
      slot,
      templateId: tmpl.id,
      type: tmpl.type,
      name: tmpl.name,
      icon: tmpl.icon,
      color: tmpl.color,
      blurb: tmpl.blurb,
      customer,
      origin, destination,
      distanceKm: dist,
      seatsRequired, tonnesRequired,
      freighter: !!tmpl.freighter,
      bizjet:    !!tmpl.bizjet,
      runwayFt,
      flightsPerWeek,
      weeks,
      fee, feePerWeek,
      // Kept for tests and the debrief — the UI must NOT surface margin or isTrap;
      // working out whether a cheque covers YOUR costs is the entire feature.
      margin, isTrap,
      refTypeId: ref.type.id,
      refCostPerWeek: ref.cost.total,
      assetSharePerWeek: assetShare,
      breachPenalty: Math.round(fee * CHARTER_BREACH_PENALTY_RATE),
      reputationStake: tmpl.reputationStake ?? 3,
      postedWeek,
      expiresWeek: postedWeek + ttl - 1,
    };
  }
  return null;
}

/**
 * The full board for `absWeek`.
 *
 * @param {object} state   game state (routes, hubs, gates, awareness, …)
 * @param {number} absWeek the week to build the board for
 * @returns {Array} offers, dismissed and already-accepted ones removed
 */
export function generateCharterBoard(state = {}, absWeek = null) {
  const week = absWeek ?? state.absWeek ?? 0;
  const seed = `${state.airlineName ?? 'airline'}|${state.hub ?? '???'}`;
  const served = servedAirportsOf(state);

  const slots = charterSlotCount({
    awareness:   state.awareness ?? 5,
    reputation:  state.lastReport?.reputationScore ?? 50,
    reliability: state.charterReliability ?? 50,
  });

  const dismissed = new Set(state.charterDismissed ?? []);
  const taken     = new Set((state.charters ?? []).map(c => c.offerId).filter(Boolean));
  // The board follows the metal (charterFleetFit): computed once per board, not
  // once per slot.
  const fleetProfile = charterFleetProfile(state.fleet ?? []);

  const offers = [];
  for (let slot = 0; slot < slots; slot++) {
    const offer = generateOffer({
      seed, slot, absWeek: week, served,
      hubs:        state.hubs ?? {},
      homeCountry: state.homeCountry ?? '',
      month:       state.gameDate?.month ?? null,
      activeEvents: state.activeEvents ?? [],
      reliability: state.charterReliability ?? 50,
      fuelIndex:   state.fuelPrice?.index ?? 1.0,
      calYear:     state.startYear != null ? state.startYear + Math.floor(week / 52) : null,
      fleetProfile,
    });
    if (!offer) continue;
    if (dismissed.has(offer.id) || taken.has(offer.id)) continue;
    offers.push(offer);
  }
  return offers;
}

/**
 * Dismissed-offer ids that can never come back (their slot has since refreshed),
 * so the list cannot grow without bound across a long game.
 */
export function pruneDismissed(dismissed = [], absWeek = 0) {
  return dismissed.filter(id => {
    const m = /^chtr-(\d+)-(\d+)-/.exec(String(id));
    if (!m) return false;
    const slot = Number(m[1]);
    const posted = Number(m[2]);
    return posted + slotTtl(slot) > absWeek;
  });
}

/**
 * What the contract would cost THIS airline, for a specific tail. The one piece
 * of arithmetic the UI does for the player (locked design decision): direct cost
 * only, ferry legs itemised. It deliberately does NOT return a profit verdict —
 * opportunity cost, fuel drift over the term and breach risk are the player's
 * judgement to make.
 *
 * @param {object} offer
 * @param {object} aircraft   the player's tail
 * @param {object} type       its catalogue type
 * @param {object} opts       { fuelIndex, served:Set, positionFrom }
 */
export function quoteCharterForAircraft(offer, aircraft, type, {
  fuelIndex = 1.0, served = new Set(), positionFrom = null,
} = {}) {
  if (!offer || !aircraft || !type) return null;
  const originServed = served.has(offer.origin);
  const destServed   = served.has(offer.destination);

  const perWeek = missionCostPerWeek({
    originCode: offer.origin, destCode: offer.destination, type,
    flightsPerWeek: offer.flightsPerWeek, fuelIndex,
    fuelMod: aircraft.fuelMod ?? 1.0,
    originServed, destServed,
  });
  if (!perWeek) return null;

  // ACMI: the customer buys the fuel (see ACMI_FUEL_IS_CUSTOMERS).
  const isAcmi = offer.type === CHARTER_TYPES.ACMI;
  const opCostPerWeek = isAcmi ? perWeek.total - perWeek.fuel : perWeek.total;

  // Positioning: an empty leg to the pickup and an empty leg home. Fuel and crew
  // only — no revenue, and the hours still come off the tail's weekly budget.
  let ferry = 0, ferryKm = 0;
  if (positionFrom && positionFrom !== offer.origin) {
    const leg = missionCostPerWeek({
      originCode: positionFrom, destCode: offer.origin, type,
      flightsPerWeek: 0.5, fuelIndex, fuelMod: aircraft.fuelMod ?? 1.0,
      originServed: served.has(positionFrom), destServed: originServed,
    });
    if (leg) { ferry = (leg.fuel + leg.crew) * 2; ferryKm = leg.distanceKm * 2; }
  }

  const permits = charterPermitFee({
    originCode: offer.origin, destCode: offer.destination, originServed, destServed,
  });

  return {
    perWeek: {
      fuel: isAcmi ? 0 : perWeek.fuel,
      crew: perWeek.crew,
      landing: perWeek.landing,
      handling: perWeek.handling,
      total: opCostPerWeek,
    },
    termCost: opCostPerWeek * offer.weeks,
    ferry, ferryKm,
    permits,
    fuelBoughtByCustomer: isAcmi,
    distanceKm: perWeek.distanceKm,
  };
}

/**
 * Where a tail is, as far as the game models location at all.
 *
 * There is no aircraft position in the state — an airframe is wherever its
 * routes are. So: its reserve base if it is standing by at one, else the airport
 * that appears most often across everything it is committed to (ties broken by
 * code, so this is stable), else the airline's hub. This is what a charter's
 * positioning leg is measured from, and it is why a contract out of your own hub
 * is nearly free to start and one out of a city you do not serve is not.
 */
export function aircraftStationOf(aircraft, { routes = [], cargoRoutes = [], charters = [], hub = null } = {}) {
  if (!aircraft) return hub;
  if (aircraft.reserveBase) return aircraft.reserveBase;
  const mine = [...routes, ...cargoRoutes, ...charters].filter(r =>
    r && (r.aircraftId === aircraft.id || r.coverForAircraftId === aircraft.id));
  if (mine.length === 0) return hub;
  const counts = new Map();
  for (const r of mine) {
    for (const code of (r.stops ?? [r.origin, r.destination])) {
      if (!code) continue;
      counts.set(code, (counts.get(code) ?? 0) + (r.weeklyFrequency ?? 1));
    }
  }
  let best = null, bestN = -1;
  for (const [code, nnn] of [...counts.entries()].sort((a, b) => String(a[0]).localeCompare(String(b[0])))) {
    if (nnn > bestN) { best = code; bestN = nnn; }
  }
  return best ?? hub;
}
