// ─────────────────────────────────────────────────────────────────────────────
// Belly cargo (docs: claude/belly-cargo-design.md) — freight in the holds of
// passenger flights. New games only (state.bellyCargoWorld); every caller treats
// a missing flag as "off" and then nothing here runs.
//
// A LEAF module: data and market helpers only, nothing from the store, the tick
// or the UI, so it copies verbatim into Headwinds (as rivalStops.js does).
// Callers hand in what it needs and read plain numbers back.
//
// The model in one paragraph: a flight's belly capacity is the smaller of the
// type's hold and the weight the aircraft has to spare at that distance with
// that cabin. Each lane's freight pool is split into a main-deck-only share
// (freighters) and general freight. General freight is contested by everyone's
// belly space and freighter capacity; belly fills to a ceiling well short of
// full, sells at a discount to the freighter rate, and pays handling plus the
// fuel it costs to carry the weight.
// ─────────────────────────────────────────────────────────────────────────────
import { getAircraftType, typicalSeatsOf, payloadRangeMod, FUEL_KG_PER_L } from '../data/aircraft.js';
import {
  cargoCityPairDemand, cargoReferenceYield, cargoBackhaulFactor, routeDistance, metroPairKeyOf,
} from '../utils/market.js';
import { FUEL_PRICE_PER_LITRE } from '../utils/fuel.js';

// ── Tuning (agreed 2026-11-09 from tools/belly-balance-probe.mjs; see
//    claude/belly-cargo-balance.md: rate 0.50, fill 0.50, main deck 45%) ───────
export const BELLY = {
  /** Share of a lane's freight only a freighter can carry (outsize, hazardous, express). */
  mainDeckShare: 0.45,
  /** Belly sells at this multiple of the freighter reference yield. */
  rateFactor: 0.50,
  /** Share of a flight's belly capacity that sells in a good week. */
  fillCeiling: 0.50,
  /**
   * How hard a flight's sellable space responds to its rate: space sold ∝
   * (reference / rate)^elasticity, up to elasticityCap times the ceiling.
   * Steeper than a freighter's 1.1 on purpose. A freighter's costs are sunk in
   * the flight, so it maximises revenue; belly pays per tonne (handling and
   * carrying fuel, about a third of the reference rate), so with a shallow
   * curve the best price on any lane without a rival is simply the maximum.
   * At 1.6 the best rate sits near the reference and moves with the route's
   * costs: dearer when fuel is dear and on the longest sectors.
   */
  elasticity: 1.6,
  elasticityCap: 1.6,
  /** Terminal handling, $ per tonne at each end — the freighter rate. */
  handlingPerTonne: 85,
  /** Fuel burned to carry cargo: tonnes of fuel per tonne of cargo per 1,000 km. */
  fuelPerTonnePer1000Km: 0.035,
  /** Selling costs a rival airline pays on belly revenue (AI freight pays the same share). */
  aiSalesShare: 0.30,
  /** Hold size, tonnes per TYPICAL seat, by category. */
  holdPerSeat: {
    'Wide Body': 0.050, 'Double Deck': 0.030, 'Narrow Body': 0.006,
    'Regional Jet': 0.002, 'Turboprop': 0.002, 'Supersonic': 0,
  },
};

/** Types whose real hold is not what their size suggests. Tonnes. */
export const BELLY_HOLD_OVERRIDES = {
  a380: 12,          // two full decks of bags leave little hold for freight
  concorde: 0,
};

/** Rival tiers that sell belly space, and how they price it against the reference. */
export const BELLY_AI_RATE_MULT = { legacy: 1.00, premium: 1.06 };   // budget carriers don't

export const bellyCargoOn = (state) => state?.bellyCargoWorld === true;

/** The hold limit for a type, tonnes. Freighters carry their freight on the main deck. */
export function bellyHoldTonnes(type) {
  if (!type || type.freighter) return 0;
  if (type.bellyTonnes != null) return Math.max(0, type.bellyTonnes);
  if (BELLY_HOLD_OVERRIDES[type.id] != null) return BELLY_HOLD_OVERRIDES[type.id];
  return typicalSeatsOf(type) * (BELLY.holdPerSeat[type.category] ?? 0);
}

/**
 * Belly capacity of ONE flight, tonnes: min(hold, weight left over).
 * Weight left over is the payload–range model run sideways: the range the
 * aircraft has to spare with `bodies` aboard is fuel it need not carry, and
 * that weight can be freight instead. Passengers and bags load first, so belly
 * never costs seats or range — at the range limit it is simply zero.
 */
export function bellyCapacityTonnes(type, bodies, distKm) {
  const hold = bellyHoldTonnes(type);
  if (!(hold > 0) || !(distKm > 0) || !type?.range) return 0;
  const fuelKgPerKm = (type.fuelBurnPer100km ?? 0) * FUEL_KG_PER_L / 100;
  if (!(fuelKgPerKm > 0)) return hold;
  const reachKm = type.range * payloadRangeMod(bodies ?? typicalSeatsOf(type), type);
  const spareTonnes = Math.max(0, reachKm - distKm) * fuelKgPerKm / 1000;
  return Math.min(hold, spareTonnes);
}

/** Market belly rate for a pair, $ per tonne-km. */
export function bellyReferenceRate(a, b) {
  return Math.round(cargoReferenceYield(a, b) * BELLY.rateFactor * 1000) / 1000;
}

const elast = (ref, rate) => Math.min(BELLY.elasticityCap, Math.pow(ref / Math.max(0.001, rate), BELLY.elasticity));

// ── Per-route rates ───────────────────────────────────────────────────────────
// state.bellyRates is { [sortedPairKey]: $ per tonne-km }. A pair with no entry
// follows the market reference as it moves; an entry is the player's own price.

/** A rate may sit between these multiples of the pair's reference. */
export const BELLY_RATE_MIN_MULT = 0.25;
export const BELLY_RATE_MAX_MULT = 3;

export const bellyPairKey = (a, b) => [a, b].sort().join('-');

/** Clamp a rate to the allowed band for a pair, to a tenth of a cent. Null when not a number. */
export function clampBellyRate(a, b, rate) {
  const r = Number(rate);
  if (!Number.isFinite(r) || !(r > 0)) return null;
  const ref = bellyReferenceRate(a, b);
  return Math.round(Math.max(ref * BELLY_RATE_MIN_MULT, Math.min(ref * BELLY_RATE_MAX_MULT, r)) * 1000) / 1000;
}

/** The rate a pair sells at: the player's own, else the reference. */
export function bellyRateFor(bellyRates, a, b) {
  const own = bellyRates?.[bellyPairKey(a, b)];
  return Number.isFinite(own) && own > 0 ? own : bellyReferenceRate(a, b);
}

/**
 * Reprice many pairs at once. The reducer and the bulk preview both call this.
 * @param {object} bellyRates  current map (not mutated)
 * @param {Array<[string,string]>} pairs  airport pairs to change
 * @param {{mode: 'pct'|'set'|'reference', value?: number}} change
 *   pct: move each pair's CURRENT rate by value percent · set: one rate for all
 *   · reference: drop the entry, so the pair follows the market again
 * @returns {object} the new map
 */
export function applyBellyRates(bellyRates, pairs, { mode, value } = {}) {
  const out = { ...(bellyRates ?? {}) };
  for (const [a, b] of pairs ?? []) {
    if (!a || !b) continue;
    const key = bellyPairKey(a, b);
    if (mode === 'reference') { delete out[key]; continue; }
    const next = mode === 'pct'
      ? clampBellyRate(a, b, bellyRateFor(out, a, b) * (1 + (Number(value) || 0) / 100))
      : clampBellyRate(a, b, value);
    if (next != null) out[key] = next;
  }
  return out;
}

/**
 * The world's belly market for one week.
 *
 * @param {object} p
 * @param {Array}  p.offers        the PLAYER's belly offers this week:
 *        { id, origin, destination, weeklyFrequency, capPerFlight, rate?, maturity?, demandMult? }
 * @param {Array}  p.cargoRoutes   the player's freighter capacity: { origin, destination, capTonnes }
 * @param {Array}  p.competitors   state.competitors (routes → belly, cargoRoutes → freighters)
 * @param {number} [p.month]
 * @param {Function} [p.demandMultFor]  world events, (a, b) → multiplier
 * @returns {{ player: Map, rival: Function, poolFactor: Function, carriedOn: Function, laneKeys: Function }}
 *   player:     offer id → { tonnesOneWay, capOneWay, offeredTonnes, rate, refRate }
 *   rival(compId, routeKey) → tonnes one-way that rival's flights carry (0 if none)
 *   poolFactor(a, b) → share of the lane's freight still there for freighters (≥ main-deck share)
 */
export function buildBellyMarket({ offers = [], cargoRoutes = [], competitors = [], month = null, demandMultFor = null } = {}) {
  const base = rivalBellyBase(competitors);
  const ev = (a, b) => {
    const m = demandMultFor ? Number(demandMultFor(a, b)) : 1;
    return Number.isFinite(m) && m > 0 ? m : 1;
  };

  // The player's side of each lane: belly entries, and freighter capacity.
  const mine = new Map();   // metro lane → { entries, weighted, plain, freighter }
  const mineOf = (a, b) => {
    const k = metroPairKeyOf(a, b);
    let l = mine.get(k);
    if (!l) { l = { entries: [], weighted: 0, freighter: 0 }; mine.set(k, l); }
    return l;
  };
  for (const o of offers) {
    const capEff = (o.capPerFlight ?? 0) * (o.weeklyFrequency ?? 0) * BELLY.fillCeiling;
    if (!(capEff > 0)) continue;
    const ref  = bellyReferenceRate(o.origin, o.destination);
    const rate = Math.max(0.001, o.rate ?? ref);
    const el = elast(ref, rate);
    // What the flight can sell at this rate: the ceiling, moved by the price.
    const e = { who: 'player', id: o.id, a: o.origin, b: o.destination, cap: capEff / BELLY.fillCeiling,
      capEff: capEff * el, ref, rate, el, scale: (o.maturity ?? 1) * (o.demandMult ?? 1) };
    const l = mineOf(o.origin, o.destination);
    l.entries.push(e); l.weighted += e.capEff;
  }
  for (const r of cargoRoutes ?? []) {
    if ((r?.capTonnes ?? 0) > 0) mineOf(r.origin, r.destination).freighter += r.capTonnes;
  }

  // General freight is shared by sellable space: every hold at what its rate
  // lets it sell, every freighter at its whole capacity. A hold never carries
  // more than its own sellable space, however rich the lane.
  const laneWeight = (k) => (base.lanes.get(k)?.weight ?? 0) + (mine.get(k)?.weighted ?? 0) + (mine.get(k)?.freighter ?? 0);
  const carriedBy = (e, k) => {
    const denom = laneWeight(k);
    const general = cargoCityPairDemand(e.a, e.b, month) * (1 - BELLY.mainDeckShare) * ev(e.a, e.b);
    const offered = denom > 0 ? general * e.scale * e.capEff / denom : 0;
    return { offered, tonnes: Math.floor(Math.max(0, Math.min(offered, e.capEff))) };
  };

  const player = new Map();
  for (const [k, l] of mine) {
    for (const e of l.entries) {
      const c = carriedBy(e, k);
      player.set(e.id, { tonnesOneWay: c.tonnes, capOneWay: e.cap, sellableTonnes: e.capEff,
        offeredTonnes: Math.round(c.offered), rate: e.rate, refRate: e.ref });
    }
  }

  // Rival results and lane totals are worked out only when asked for: a route
  // preview needs one lane, the weekly tick needs most of them.
  const laneCarried = new Map();
  const carriedOn = (k) => {
    let t = laneCarried.get(k);
    if (t != null) return t;
    t = 0;
    for (const e of base.lanes.get(k)?.entries ?? []) t += carriedBy(e, k).tonnes;
    for (const e of mine.get(k)?.entries ?? []) t += player.get(e.id).tonnesOneWay;
    laneCarried.set(k, t);
    return t;
  };

  return {
    player,
    /** Metro-lane keys holds fly on this week (player or rival). */
    laneKeys: () => [...new Set([...base.lanes.keys()].filter(k => base.lanes.get(k).entries.length > 0).concat(
      [...mine.keys()].filter(k => mine.get(k).entries.length > 0)))],
    carriedOn,
    rival: (compId, routeKey) => {
      const hit = base.index.get(`${compId}|${routeKey}`);
      if (!hit) return null;
      return { tonnes: carriedBy(hit.entry, hit.lane).tonnes, rate: hit.entry.rate };
    },
    poolFactor: (a, b) => {
      const carried = carriedOn(metroPairKeyOf(a, b));
      if (!(carried > 0)) return 1;
      const pool = cargoCityPairDemand(a, b, month) * ev(a, b);
      if (!(pool > 0)) return 1;
      return Math.max(BELLY.mainDeckShare, 1 - carried / pool);
    },
  };
}

// The rivals' side of every lane depends only on their routes, so it is built
// once per competitors array (the reducer never mutates one in place) and shared
// by every preview and the tick that week.
const RIVAL_BASE_MEMO = new WeakMap();
const EMPTY_BASE = { lanes: new Map(), index: new Map() };
function rivalBellyBase(competitors) {
  if (!Array.isArray(competitors) || competitors.length === 0) return EMPTY_BASE;
  const memo = RIVAL_BASE_MEMO.get(competitors);
  if (memo && memo.rate === BELLY.rateFactor && memo.fill === BELLY.fillCeiling && memo.el === BELLY.elasticity) return memo.base;
  const lanes = new Map(), index = new Map();
  const laneOf = (a, b) => {
    const k = metroPairKeyOf(a, b);
    let l = lanes.get(k);
    if (!l) { l = { weight: 0, entries: [] }; lanes.set(k, l); }
    return [k, l];
  };
  for (const c of competitors) {
    // Rival freighters compete for general freight with their whole capacity.
    for (const [pairKey, cr] of Object.entries(c?.cargoRoutes ?? {})) {
      const cap = cr?.tonnesPerWeek ?? 0;
      if (!(cap > 0)) continue;
      const [a, b] = String(pairKey).split('-');
      if (a && b) laneOf(a, b)[1].weight += cap;
    }
    // Rival belly: every typed passenger route of a carrier whose tier sells it.
    const mult = BELLY_AI_RATE_MULT[c?.tier ?? 'legacy'];
    if (mult == null) continue;
    for (const [routeKey, cfg] of Object.entries(c?.routes ?? {})) {
      const type = cfg?.aircraftType ? getAircraftType(cfg.aircraftType) : null;
      if (!type || type.freighter) continue;
      const [a, b] = String(routeKey).split('-');
      const capEff = bellyCapacityTonnes(type, cfg.seats ?? type.seats, routeDistance(a, b)) * (cfg.frequency ?? 0) * BELLY.fillCeiling;
      if (!(capEff > 0)) continue;
      const ref = bellyReferenceRate(a, b);
      const el = elast(ref, ref * mult);
      const e = { who: c.id, id: routeKey, a, b, capEff: capEff * el, ref, rate: ref * mult, el, scale: 1 };
      const [k, l] = laneOf(a, b);
      l.entries.push(e); l.weight += e.capEff;
      index.set(`${c.id}|${routeKey}`, { entry: e, lane: k });
    }
  }
  const base = { lanes, index };
  RIVAL_BASE_MEMO.set(competitors, { base, rate: BELLY.rateFactor, fill: BELLY.fillCeiling, el: BELLY.elasticity });
  return base;
}

/**
 * Revenue and cost of carrying `tonnesOneWay` in the holds of a route's flights
 * for a week, both directions (the return leg lighter, as on a freighter).
 *
 * @param {number} fuelPriceMult  the fuel multiplier that route pays (index × hedges × station)
 */
export function bellyEconomics(a, b, tonnesOneWay, rate, fuelPriceMult = 1) {
  const dist = routeDistance(a, b);
  if (!(tonnesOneWay > 0) || !(dist > 0)) return { tonnes: 0, revenue: 0, handlingCost: 0, fuelCost: 0, profit: 0 };
  const backhaul = cargoBackhaulFactor(a, b);
  const carried  = tonnesOneWay * (1 + backhaul);            // both directions
  const revenue  = Math.round(carried * dist * rate);
  const handlingCost = Math.round(carried * 2 * BELLY.handlingPerTonne);
  const fuelLitres   = carried * (dist / 1000) * BELLY.fuelPerTonnePer1000Km * 1000 / FUEL_KG_PER_L;
  const fuelCost     = Math.round(fuelLitres * FUEL_PRICE_PER_LITRE * fuelPriceMult);
  return { tonnes: tonnesOneWay, revenue, handlingCost, fuelCost, profit: revenue - handlingCost - fuelCost };
}

/**
 * A rival's belly result on one route, from a market built by buildBellyMarket.
 * Null when it carries none. Costs include the selling share AI freight pays.
 */
export function rivalBellyPnL(market, competitor, routeKey, fuelMult = 1) {
  const r = market?.rival?.(competitor?.id, routeKey);
  if (!r || !(r.tonnes > 0)) return null;
  const [a, b] = String(routeKey).split('-');
  const e = bellyEconomics(a, b, r.tonnes, r.rate, fuelMult);
  const cost = e.handlingCost + e.fuelCost + Math.round(e.revenue * BELLY.aiSalesShare);
  return { tonnes: r.tonnes, revenue: e.revenue, cost, profit: e.revenue - cost };
}
