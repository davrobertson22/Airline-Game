// ─────────────────────────────────────────────────────────────────────────────
// AI RIVAL FREIGHT
//
// Rival carriers fly dedicated freighters and compete with the player for the
// same lanes. Before this, freight was the one business no AI ever entered:
// the player's freighters only ever met each other.
//
// Economics are the player's own. A rival lane is priced through
// simulateCargoRoute — same demand pool, yield elasticity, spill model, fuel,
// crew and handling — plus landing fees and its airframes' lease and
// maintenance, exactly the lines a player freighter pays. On top sit the two
// stand-ins every AI business carries for what the player's model charges
// elsewhere or not at all: the same fuel-and-crew uplift AI passenger routes pay
// (insurance, staff, overhead), and a sales cost on revenue — forwarder
// commissions, trucking, a sales force. Without them two rival 777Fs out-earned
// that rival's entire passenger airline several times over (freight runs at
// 50–60% lane margins on the player's model), and a freight arm became a money
// printer instead of a sideline.
//
// The contest is the one cargoLaneAllocations already runs for the player:
// every carrier on a (metro) lane gets the pool in proportion to its capacity,
// weighted by how keenly it prices. From a rival's seat the player is simply
// one more carrier on the lane.
//
// Shape on a carrier:
//   c.cargoRoutes = {
//     'FRA-HKG': { aircraftType, frequency, tails, yieldMultiplier,
//                  tonnesPerWeek, yieldPrice, openedWeek }
//   }
//   Freighter tails sit in c.fleet with routeKey `cargo:FRA-HKG` and cargo: true,
//   so they count in the fleet's value and transfer in a takeover, but never
//   collide with a passenger route on the same city pair.
//
// tonnesPerWeek (one-way capacity) and yieldPrice ($/tonne-km) are what the
// player's side of the contest reads (simulation.js cargoLaneAllocations), so
// they are rewritten whenever frequency or type changes (cargoLaneCfg).
//
// Pure apart from Math.random (the expansionist's dice roll).
// ─────────────────────────────────────────────────────────────────────────────

import { cargoCityPairDemand, cargoReferenceYield, routeDistance, getEraCalendarYear } from '../utils/market.js';
import { AIRCRAFT_TYPES, getAircraftType, aircraftAvailability, aircraftOrderable } from '../data/aircraft.js';
import { AIRPORTS, getAirport, getAirportCargoScore } from '../data/airports.js';
import { metroPairKeyOf } from '../data/metros.js';
import { weeklyLandingFee, freighterLandingCategory } from '../data/overhead.js';
import { isOutOfService } from '../data/maintenance.js';
import {
  simulateCargoRoute, maxFrequency, CARGO_YIELD_ELASTICITY, FREIGHTER_CAPTURE_RATE,
} from '../utils/simulation.js';
import { preferredTypes, makeCompetitorTail } from './demand.js';

// ─── Keys ────────────────────────────────────────────────────────────────────

export const CARGO_KEY_PREFIX = 'cargo:';
/** routeKey a freighter tail (and a production-line plan) carries for a lane. */
export const cargoTailKey = (laneKey) => CARGO_KEY_PREFIX + laneKey;
/** The lane a `cargo:`-prefixed routeKey names, or null for a passenger key. */
export const cargoLaneOf = (routeKey) =>
  String(routeKey ?? '').startsWith(CARGO_KEY_PREFIX) ? String(routeKey).slice(CARGO_KEY_PREFIX.length) : null;
export const isCargoTail = (tail) => cargoLaneOf(tail?.routeKey) != null;

const pairKeyOf = (a, b) => [a, b].sort().join('-');

// ─── Tuning ──────────────────────────────────────────────────────────────────

/** Rate a rival charges against the lane's reference yield. Budget carriers fly no freight. */
export const AI_CARGO_YIELD_MULT = { legacy: 1.00, premium: 1.06 };
/** Lanes a carrier's freight arm grows to, before its hub and personality adjust it. */
export const AI_CARGO_BASE_LANES = { budget: 0, legacy: 2, premium: 2 };
/** A home hub at least this freight-heavy (cargoScore) carries a bigger freight arm (+2 lanes). */
export const AI_CARGO_HUB_SCORE = 70;
/** Fuel + crew uplift — the same order as AI passenger routes' OP_COST_UPLIFT (demand.js). */
export const AI_CARGO_OP_UPLIFT = 1.5;
/** Share of freight revenue a rival spends selling it: forwarder commissions, trucking, sales. */
export const AI_CARGO_SALES_SHARE = 0.30;
/** No rival freighters before this game-week: the opening board settles first. */
export const AI_CARGO_START_WEEK = 13;
/** A carrier needs a real passenger network before it starts a freight arm. */
export const AI_CARGO_MIN_PAX_ROUTES = 5;
/** Chance a carrier ready to open a freight lane does so on a given action week — a freight arm builds over a couple of years, not in one. */
export const AI_CARGO_LAUNCH_PROB = 0.35;
/** Projected margin a new lane must clear before a rival commits freighters to it. */
export const AI_CARGO_MIN_MARGIN = 0.08;
/** Weeks of losses before a lane is withdrawn (a little more patience than passengers: forwarders take time). */
export const AI_CARGO_LOSS_WEEKS_TO_CUT = 12;
export const AI_CARGO_MAX_FREQ = 14;
export const AI_CARGO_MIN_FREQ = 2;
/** At most this many airframes on one lane. */
export const AI_CARGO_MAX_TAILS = 4;
/** Outsize specialists, not network freighters — no rival buys one to fly a lane. */
export const AI_CARGO_EXCLUDED_TYPES = new Set(['an124', 'an225']);

const CARGO_FULL_LF    = 0.85;
const CARGO_THIN_LF    = 0.50;
const CARGO_FULL_WEEKS = 8;
const CARGO_THIN_WEEKS = 8;
const CARGO_GROW_LF    = 0.80;   // size a growing schedule to demand at this load
const CARGO_TRIM_LF    = 0.75;
const CARGO_FREQ_OPTIONS = [2, 3, 4, 5, 7, 10, 14];
const CARGO_SHORTLIST  = 6;      // lanes fully costed per launch decision
const CARGO_MIN_KM     = 600;
const CARGO_MIN_DEMAND = 25;     // tonnes/week one-way: below this no freighter lane is worth opening

// Same deposit / salvage rule the passenger side uses (competitorAI.js).
export function cargoTailDeposit(type, count) { return count * (type?.weeklyLease ?? 0) * 4; }
export function cargoTailSalvage(type, count) { return count * (type?.weeklyLease ?? 0) * 2; }

/**
 * How many freight lanes a carrier's cargo arm grows to. Budget carriers fly
 * none; a carrier based at a real freight hub (HKG, FRA, DXB…) runs a bigger
 * one; an expansionist one more.
 */
export function carrierMaxCargoLanes(c) {
  const base = AI_CARGO_BASE_LANES[c?.tier] ?? 0;
  if (base <= 0) return 0;
  let n = base;
  if (c?.homeHub && getAirportCargoScore(c.homeHub) >= AI_CARGO_HUB_SCORE) n += 2;
  if (c?._archetype === 'expansionist') n += 1;
  return n;
}

/**
 * Freighter types a rival would consider for a lane of `distKm`: on the market
 * (era games: in service that year; classic: the current market, not types yet
 * to fly or long gone), within range, not an outsize specialist, and — when the
 * carrier has a fleet preference — only its makers' (no fallback).
 */
export function aiFreighterTypes(distKm, pref = null) {
  const eraYear = getEraCalendarYear();
  const list = AIRCRAFT_TYPES.filter(t => t.freighter && (t.payloadTonnes ?? 0) > 0
    && !AI_CARGO_EXCLUDED_TYPES.has(t.id)
    && (t.range ?? 0) >= distKm
    && (eraYear != null
      ? aircraftOrderable(t, eraYear)
      : ['new', 'used'].includes(aircraftAvailability(t, 2026))));
  // Strict: a passenger route flies whatever fits when the preferred maker has
  // nothing, but a freight arm is optional — an all-Airbus carrier flies Airbus
  // freighters or none.
  return preferredTypes(list, pref, { strict: true });
}

/** Airframes needed to fly `frequency` weekly rotations (same 140 block-hour cap the player flies to). */
export function cargoTailsFor(distKm, type, frequency) {
  const perTail = Math.max(1, maxFrequency(distKm, type));
  return Math.max(1, Math.ceil(frequency / perTail));
}

/** A lane config with its published capacity and rate brought up to date. */
export function cargoLaneCfg(laneKey, cfg) {
  const [a, b] = laneKey.split('-');
  const type = getAircraftType(cfg.aircraftType);
  const ref  = cargoReferenceYield(a, b);
  return {
    ...cfg,
    tonnesPerWeek: Math.round((type?.payloadTonnes ?? 0) * (cfg.frequency ?? 0)),
    yieldPrice:    Math.round(ref * (cfg.yieldMultiplier ?? 1) * 1000) / 1000,
  };
}

/** A fresh freighter tail for a lane. */
export function makeCargoTail(airlineId, typeId, laneKey, aged = false) {
  return { ...makeCompetitorTail(airlineId, typeId, cargoTailKey(laneKey), aged), cargo: true };
}

// ─── The contest ─────────────────────────────────────────────────────────────

/**
 * Who flies freight where, by metro lane: Map metroKey → [{ id, cap, yieldCapSum }].
 * The player is one entry (id 'player'), summed over every freighter it has on
 * the lane that is in service; each rival is one entry per lane.
 */
export function buildCargoContest(competitors = [], playerCargoRoutes = [], playerFleet = []) {
  const contest = new Map();
  const add = (a, b, id, cap, yieldPrice) => {
    if (!(cap > 0)) return;
    const mk = metroPairKeyOf(a, b);
    const list = contest.get(mk) ?? [];
    let e = list.find(x => x.id === id);
    if (!e) { e = { id, cap: 0, yieldCapSum: 0 }; list.push(e); }
    e.cap += cap;
    e.yieldCapSum += (yieldPrice ?? 0) * cap;
    contest.set(mk, list);
  };
  const byId = new Map((playerFleet ?? []).map(a => [a.id, a]));
  for (const r of playerCargoRoutes ?? []) {
    const ac = byId.get(r.aircraftId);
    if (!ac || isOutOfService(ac)) continue;
    const type = getAircraftType(ac.typeId);
    if (!type?.freighter) continue;
    const cap = (type.payloadTonnes ?? 0) * (r.weeklyFrequency ?? 0);
    add(r.origin, r.destination, 'player', cap, r.yieldPrice ?? cargoReferenceYield(r.origin, r.destination));
  }
  for (const c of competitors ?? []) {
    for (const [key, cfg] of Object.entries(c?.cargoRoutes ?? {})) {
      const [a, b] = key.split('-');
      if (!a || !b) continue;
      add(a, b, c.id, cfg?.tonnesPerWeek ?? 0, cfg?.yieldPrice ?? 0);
    }
  }
  return contest;
}

/**
 * Everyone else's capacity on a lane, weighted by how they price — the same
 * weighting cargoLaneAllocations gives a rival from the player's seat: a
 * premium-priced carrier dilutes less, a cut-rate one more (capped at 1.6×).
 */
export function cargoOthersWeightedCap(contest, a, b, selfId) {
  const entries = contest?.get(metroPairKeyOf(a, b)) ?? [];
  if (!entries.length) return 0;
  const ref = cargoReferenceYield(a, b);
  let w = 0;
  for (const e of entries) {
    if (e.id === selfId || !(e.cap > 0)) continue;
    const y  = e.yieldCapSum / e.cap;
    const el = y > 0 ? Math.min(1.6, Math.pow(ref / y, CARGO_YIELD_ELASTICITY)) : 1;
    w += e.cap * el;
  }
  return w;
}

/**
 * Rival carriers flying a lane (any airport pair in the same metros), heaviest
 * first: [{ id, name, laneKey, tonnesPerWeek, yieldPrice, frequency, aircraftType }].
 * For the player's freight screens.
 */
export function cargoRivalsOnLane(competitors, a, b) {
  const mk = metroPairKeyOf(a, b);
  const out = [];
  for (const c of competitors ?? []) {
    for (const [key, cfg] of Object.entries(c?.cargoRoutes ?? {})) {
      if (!((cfg?.tonnesPerWeek ?? 0) > 0)) continue;
      const [x, y] = key.split('-');
      if (metroPairKeyOf(x, y) !== mk) continue;
      out.push({ id: c.id, name: c.name, laneKey: key, tonnesPerWeek: cfg.tonnesPerWeek,
        yieldPrice: cfg.yieldPrice ?? null, frequency: cfg.frequency ?? null, aircraftType: cfg.aircraftType ?? null });
    }
  }
  return out.sort((p, q) => q.tonnesPerWeek - p.tonnesPerWeek);
}

/** Rival carriers (not the player) on a metro lane, from a contest. */
export function cargoRivalIdsOn(contest, a, b) {
  return (contest?.get(metroPairKeyOf(a, b)) ?? []).filter(e => e.id !== 'player' && e.cap > 0).map(e => e.id);
}

// ─── Lane economics ──────────────────────────────────────────────────────────

/**
 * One week of one rival freight lane.
 *
 * @param {object} carrier
 * @param {string} laneKey   sorted airport pair, e.g. 'FRA-HKG'
 * @param {object} cfg       { aircraftType, frequency, tails?, yieldMultiplier?, yieldPrice? }
 * @param {object} opts      { month, contest (buildCargoContest), world ({ demandMultFor, fuelMult }) }
 * @returns {{ revenue, cost, profit, tonnes, capacityTonnes, loadFactor, demandTonnes,
 *             flights, yieldPrice, refYield, contested }|null}
 */
export function competitorCargoLanePnL(carrier, laneKey, cfg, { month = 6, contest = null, world = null } = {}) {
  const [a, b] = String(laneKey).split('-');
  const type = getAircraftType(cfg?.aircraftType);
  const freq = cfg?.frequency ?? 0;
  if (!a || !b || !type?.freighter || !(freq > 0)) return null;
  const pool0 = cargoCityPairDemand(a, b, month);
  if (!(pool0 > 0)) return null;

  const evRaw   = world?.demandMultFor ? Number(world.demandMultFor(a, b)) : 1;
  const evMult  = Number.isFinite(evRaw) && evRaw > 0 ? evRaw : 1;
  const fuelRaw = Number(world?.fuelMult);
  const fuelMult = Number.isFinite(fuelRaw) && fuelRaw > 0 ? fuelRaw : 1;

  const ref        = cargoReferenceYield(a, b);
  const yieldPrice = Math.max(0.01, cfg.yieldPrice ?? ref * (cfg.yieldMultiplier ?? 1));
  const cap        = (type.payloadTonnes ?? 0) * freq;
  const el         = Math.min(1.6, Math.pow(ref / yieldPrice, CARGO_YIELD_ELASTICITY));
  const others     = cargoOthersWeightedCap(contest, a, b, carrier?.id);
  const pool       = pool0 * evMult * FREIGHTER_CAPTURE_RATE;
  const demandTonnes = pool * el * (others > 0 ? cap / (cap + others) : 1);

  const sim = simulateCargoRoute(
    { origin: a, destination: b, weeklyFrequency: freq, yieldPrice },
    { id: `${carrier?.id ?? 'ai'}-${laneKey}`, typeId: type.id },
    { month }, null, fuelMult, 1, { demandTonnes });
  if (!sim) return null;

  const dist    = routeDistance(a, b);
  const tails   = cfg.tails ?? cargoTailsFor(dist, type, freq);
  const landing = weeklyLandingFee(freighterLandingCategory(type.payloadTonnes ?? 0), freq,
    getAirport(a)?.tier ?? 'major', getAirport(b)?.tier ?? 'major');
  const fixed   = tails * ((type.weeklyLease ?? 0) + (type.baseMaintenancePerWk ?? 0));
  const ops     = (sim.fuelCost + sim.crewCost) * AI_CARGO_OP_UPLIFT + sim.groundHandlingCost;
  const sales   = sim.revenue * AI_CARGO_SALES_SHARE;
  const cost    = Math.round(ops + sales + landing + fixed);

  return {
    revenue:        sim.revenue,
    cost,
    profit:         sim.revenue - cost,
    tonnes:         sim.tonnes,
    capacityTonnes: sim.capacityTonnes,
    loadFactor:     sim.loadFactor,
    demandTonnes:   Math.round(demandTonnes),
    flights:        freq * 2,
    yieldPrice,
    refYield:       ref,
    contested:      others > 0,
  };
}

/**
 * A rival's whole freight business for one week. Zeros for a carrier with no
 * freight lanes, so callers can add it unconditionally.
 */
export function computeCompetitorCargoStats(carrier, opts = {}) {
  const out = { cargoRevenue: 0, cargoCost: 0, cargoProfit: 0, cargoTonnes: 0, cargoFlights: 0, cargoLanes: 0 };
  for (const [key, cfg] of Object.entries(carrier?.cargoRoutes ?? {})) {
    const p = competitorCargoLanePnL(carrier, key, cfg, opts);
    if (!p) continue;
    out.cargoLanes   += 1;
    out.cargoRevenue += p.revenue;
    out.cargoCost    += p.cost;
    out.cargoTonnes  += p.tonnes;
    out.cargoFlights += p.flights;
  }
  out.cargoProfit = out.cargoRevenue - out.cargoCost;
  return out;
}

/** Fold a carrier's freight week into its passenger weekly stats. */
export function withCargoStats(stats, cargo) {
  if (!cargo || !(cargo.cargoLanes > 0)) return stats;
  return {
    ...stats,
    weeklyRevenue: (stats.weeklyRevenue ?? 0) + cargo.cargoRevenue,
    weeklyCost:    (stats.weeklyCost ?? 0) + cargo.cargoCost,
    weeklyProfit:  (stats.weeklyProfit ?? 0) + cargo.cargoProfit,
    weeklyFlights: (stats.weeklyFlights ?? 0) + cargo.cargoFlights,
    weeklyCargoTonnes:  cargo.cargoTonnes,
    weeklyCargoRevenue: cargo.cargoRevenue,
    weeklyCargoProfit:  cargo.cargoProfit,
    cargoLanes:         cargo.cargoLanes,
  };
}

// ─── Where to fly next ───────────────────────────────────────────────────────

let _cargoAirportPool = null;
/** Destinations a rival freight arm considers: the big airports plus the freight hubs. */
function cargoAirportPool() {
  if (!_cargoAirportPool) {
    _cargoAirportPool = AIRPORTS.filter(ap => ap.tier === 'mega' || ap.tier === 'major'
      || getAirportCargoScore(ap.code) >= 60);
  }
  return _cargoAirportPool;
}

/**
 * The best (type, frequency) a rival could open a lane with, by projected
 * profit, or null when nothing clears the margin. `ranked` returns every
 * qualifying option best-first (production-line worlds walk down it).
 */
export function bestCargoPlan(carrier, laneKey, opts = {}, { ranked = false } = {}) {
  const [a, b] = laneKey.split('-');
  const dist = routeDistance(a, b);
  if (!dist) return ranked ? [] : null;
  const mult = opts.yieldMultiplier ?? AI_CARGO_YIELD_MULT[carrier?.tier] ?? 1;
  const options = [];
  for (const type of aiFreighterTypes(dist, carrier?.fleetPref)) {
    for (const frequency of CARGO_FREQ_OPTIONS) {
      const tails = cargoTailsFor(dist, type, frequency);
      if (tails > AI_CARGO_MAX_TAILS) continue;
      const cfg = cargoLaneCfg(laneKey, { aircraftType: type.id, frequency, tails, yieldMultiplier: mult });
      const p = competitorCargoLanePnL(carrier, laneKey, cfg, opts);
      if (!p || p.revenue <= 0 || p.profit / p.revenue < AI_CARGO_MIN_MARGIN) continue;
      options.push({ type, frequency, tails, cfg, profit: p.profit, pnl: p });
    }
  }
  options.sort((x, y) => y.profit - x.profit);
  if (ranked) {
    // One option per type (its best frequency), best type first.
    const seen = new Set();
    return options.filter(o => !seen.has(o.type.id) && seen.add(o.type.id));
  }
  return options[0] ?? null;
}

/**
 * Pick the next freight lane for a carrier: from its hub(s) to a big airport or
 * freight hub, scored by the tonnage it could win, bent by personality —
 * aggressive and copycat carriers go after the player's freight lanes, niche
 * ones avoid any lane already flown. Returns { key, onPlayerLane } or null.
 */
export function pickCargoExpansion(carrier, { contest = null, taken = new Set(), playerNotice = 0, month = 6, world = null } = {}) {
  const arch  = carrier?._archetype ?? 'balanced';
  const bases = [carrier?.homeHub, carrier?.secondaryHub].filter(Boolean);
  const scored = [];
  for (const base of bases) {
    for (const ap of cargoAirportPool()) {
      if (ap.code === base) continue;
      const key = pairKeyOf(base, ap.code);
      if (taken.has(key) || carrier?.cargoRoutes?.[key]) continue;
      const dist = routeDistance(base, ap.code);
      if (!dist || dist < CARGO_MIN_KM) continue;
      const demand = cargoCityPairDemand(base, ap.code);
      if (!(demand >= CARGO_MIN_DEMAND)) continue;
      const others = cargoOthersWeightedCap(contest, base, ap.code, carrier?.id);
      const onPlayerLane = (contest?.get(metroPairKeyOf(base, ap.code)) ?? []).some(e => e.id === 'player');
      // Tonnage it could plausibly win: the pool, less what others already lift.
      let score = demand * demand / (demand + others);
      switch (arch) {
        case 'aggressive': if (onPlayerLane) score *= 1 + 1.6 * playerNotice; break;
        case 'copycat':    if (onPlayerLane) score *= 1 + 2.4 * playerNotice; break;
        case 'niche':      if (others > 0) score /= 1 + others / Math.max(1, demand) * 2; break;
        case 'expansionist': score *= 0.9 + Math.random() * 0.4; break;
        default: break;
      }
      scored.push({ key, score, onPlayerLane });
    }
  }
  scored.sort((x, y) => y.score - x.score);
  const opts = { month, contest, world };
  let best = null;
  for (const cand of scored.slice(0, CARGO_SHORTLIST)) {
    const plan = bestCargoPlan(carrier, cand.key, opts);
    if (plan && (!best || plan.profit > best.plan.profit)) best = { ...cand, plan };
  }
  return best ? { key: best.key, onPlayerLane: best.onPlayerLane } : null;
}

// ─── Managing the freight arm (called on a carrier's action weeks) ───────────

/**
 * One action week of a rival's freight business: track loads and losses, trim
 * thin lanes, withdraw chronic losers, add flights where freighters fill, and
 * open a new lane when the carrier is healthy and has room.
 *
 * Passenger-side state (cash, fleet, the production-line plans) is threaded
 * through ctx so both businesses spend one bank account and one order book.
 *
 * @param {object} c    the carrier (read: cargoRoutes, _cargoLoss, _cargoLoad, tier, hubs…)
 * @param {object} ctx
 *   cash, fleet          current values (returned updated)
 *   actEvery, reserve, lastProfit, weekNumber, month, world, contest, playerNotice
 *   paxRoutes            the carrier's passenger route count (a freight arm needs a network)
 *   launchesAllowed      false = the setup option is off: manage existing lanes, open none
 *   events               array to push news into
 *   lines                production-line ledger or null; with it:
 *     quote(type, n), placeOrder(kind, routeKey, type, q, cfg, event),
 *     planned(routeKey), cancelPlans(routeKey), pendingLaunchLanes (Set), lineGiveUpWeeks
 * @returns {{ cargoRoutes, fleet, cash, _cargoLoss, _cargoLoad }}
 */
export function manageCompetitorCargo(c, ctx) {
  const {
    actEvery = 5, reserve = 8_000_000, lastProfit = 0, weekNumber = 1, month = 6, world = null,
    contest = null, playerNotice = 0, paxRoutes = 0, launchesAllowed = true, events = [],
    lines = null, quote = null, placeOrder = null, planned = () => false, cancelPlans = () => {},
    pendingLaunchLanes = new Set(), lineGiveUpWeeks = Infinity,
  } = ctx;
  let cash  = ctx.cash ?? c.cash ?? 0;
  let fleet = ctx.fleet ?? [...(c.fleet ?? [])];
  const routes = { ...(c.cargoRoutes ?? {}) };
  const loss   = { ...(c._cargoLoss ?? {}) };
  const load   = { ...(c._cargoLoad ?? {}) };
  const opts   = { month, contest, world };
  const keys   = Object.keys(routes);
  const pnl    = {};
  for (const k of keys) pnl[k] = competitorCargoLanePnL(c, k, routes[k], opts);
  const projected = (k, cfg) => competitorCargoLanePnL(c, k, cfg, opts)?.profit ?? -Infinity;
  const ends = (k) => k.split('-');

  // Loads and losses since the last action week.
  const trimmed = new Set();
  for (const k of keys) {
    const p = pnl[k];
    if (!p) { delete load[k]; continue; }
    const prev = load[k] ?? 0;
    if (p.loadFactor >= CARGO_FULL_LF)     load[k] = Math.max(0, prev) + actEvery;
    else if (p.loadFactor < CARGO_THIN_LF) load[k] = Math.min(0, prev) - actEvery;
    else                                   load[k] = 0;
  }

  // 1. Trim: a thin or losing lane flies less before it is given up on.
  for (const k of keys) {
    const p = pnl[k], cfg = routes[k];
    if (!p || planned(cargoTailKey(k)) || cfg.frequency <= AI_CARGO_MIN_FREQ) continue;
    const losing = p.profit < 0 && p.loadFactor < CARGO_FULL_LF && (loss[k] ?? 0) >= actEvery;
    if (!((load[k] ?? 0) <= -CARGO_THIN_WEEKS || losing)) continue;
    const type = getAircraftType(cfg.aircraftType);
    const [a, b] = ends(k);
    const dist = routeDistance(a, b);
    const want  = Math.ceil((p.demandTonnes ?? 0) / Math.max(1, (type.payloadTonnes ?? 1) * CARGO_TRIM_LF));
    const floor = Math.max(AI_CARGO_MIN_FREQ, Math.round(cfg.frequency * 0.7));
    const newFreq = Math.min(cfg.frequency - 1, Math.max(want, floor));
    if (newFreq >= cfg.frequency) continue;
    const newTails = Math.min(cfg.tails ?? 1, cargoTailsFor(dist, type, newFreq));
    const next = cargoLaneCfg(k, { ...cfg, frequency: newFreq, tails: newTails });
    if (projected(k, next) < p.profit) continue;
    const surplus = Math.max(0, (cfg.tails ?? 1) - newTails);
    if (surplus > 0) {
      cash += cargoTailSalvage(type, surplus);
      const drop = new Set(fleet.filter(f => f.routeKey === cargoTailKey(k)).slice(0, surplus));
      fleet = fleet.filter(f => !drop.has(f));
    }
    routes[k] = next;
    load[k] = 0;
    trimmed.add(k);
    events.push({ type: 'cargoTrim', airlineId: c.id, name: c.name, routeKey: k, cargo: true,
      description: `${c.name} cut its freighter flights on ${a} → ${b} to ${newFreq}×/wk — the holds were flying light.` });
  }

  // 2. Losses: withdraw one chronic loser (two when the carrier is broke).
  for (const k of keys) {
    const p = pnl[k];
    if (!p) continue;
    loss[k] = (p.profit < 0 && !trimmed.has(k)) ? (loss[k] ?? 0) + actEvery : 0;
  }
  const losers = keys.filter(k => routes[k] && ((loss[k] ?? 0) >= AI_CARGO_LOSS_WEEKS_TO_CUT
      || (cash < 0 && (pnl[k]?.profit ?? 0) < 0)))
    .sort((x, y) => (pnl[x]?.profit ?? 0) - (pnl[y]?.profit ?? 0));
  let cuts = cash < 0 ? 2 : 1;
  for (const k of losers) {
    if (cuts <= 0) break;
    const cfg = routes[k];
    const type = getAircraftType(cfg.aircraftType);
    cash += cargoTailSalvage(type, cfg.tails ?? 1);
    fleet = fleet.filter(f => f.routeKey !== cargoTailKey(k));
    if (lines) cancelPlans(cargoTailKey(k));
    delete routes[k]; delete loss[k]; delete load[k];
    cuts--;
    const [a, b] = ends(k);
    events.push({ type: 'cargoCut', airlineId: c.id, name: c.name, routeKey: k, cargo: true,
      description: `${c.name} pulled its freighters off ${a} → ${b} after sustained losses.` });
  }

  // 3. Grow: one lane a week that keeps flying full and making money.
  const canGrow = !c.fireSale && (lastProfit > 0 || cash > reserve * 2);
  const full = Object.keys(routes)
    .filter(k => canGrow && (load[k] ?? 0) >= CARGO_FULL_WEEKS && (pnl[k]?.profit ?? 0) > 0
      && routes[k].frequency < AI_CARGO_MAX_FREQ && !planned(cargoTailKey(k)))
    .sort((x, y) => (pnl[y]?.profit ?? 0) - (pnl[x]?.profit ?? 0));
  for (const k of full.slice(0, 1)) {
    const cfg = routes[k], p = pnl[k];
    const type = getAircraftType(cfg.aircraftType);
    const [a, b] = ends(k);
    const dist = routeDistance(a, b);
    const want = Math.ceil((p.demandTonnes ?? 0) / Math.max(1, (type.payloadTonnes ?? 1) * CARGO_GROW_LF));
    const step = Math.max(1, Math.round(cfg.frequency * 0.25));
    const newFreq = Math.min(AI_CARGO_MAX_FREQ, cfg.frequency + step, Math.max(cfg.frequency + 1, want));
    if (newFreq <= cfg.frequency) continue;
    const needTails = cargoTailsFor(dist, type, newFreq);
    if (needTails > AI_CARGO_MAX_TAILS) continue;
    const addTails = Math.max(0, needTails - (cfg.tails ?? 1));
    const next = cargoLaneCfg(k, { ...cfg, frequency: newFreq, tails: Math.max(cfg.tails ?? 1, needTails) });
    if (projected(k, next) <= p.profit) continue;
    const cost = cargoTailDeposit(type, addTails);
    if (cash - cost < reserve) continue;
    const event = { type: 'cargoBoost', airlineId: c.id, name: c.name, routeKey: k, cargo: true,
      description: `${c.name} added freighter flights on ${a} → ${b} (${cfg.frequency} → ${newFreq}×/wk) — its holds keep filling.` };
    if (lines && addTails > 0) {
      const q = quote(type, addTails);
      if (q.delay > lineGiveUpWeeks) continue;
      cash -= cost;
      placeOrder('cargoGrow', cargoTailKey(k), type, q, { frequency: newFreq }, event);
      continue;
    }
    cash -= cost;
    for (let i = 0; i < addTails; i++) fleet.push(makeCargoTail(c.id, type.id, k, false));
    routes[k] = next;
    load[k] = 0;
    events.push(event);
  }

  // 4. Launch: a healthy carrier with a real network opens one lane at a time.
  const lanesHeld = Object.keys(routes).length + pendingLaunchLanes.size;
  const eligible = launchesAllowed
    && carrierMaxCargoLanes(c) > lanesHeld
    && weekNumber >= AI_CARGO_START_WEEK
    && paxRoutes >= AI_CARGO_MIN_PAX_ROUTES
    && !c.fireSale && lastProfit > 0 && cash > reserve * 2;
  if (eligible && Math.random() < AI_CARGO_LAUNCH_PROB) {
    const taken = new Set([...Object.keys(routes), ...pendingLaunchLanes]);
    const cand = pickCargoExpansion({ ...c, cargoRoutes: routes }, { contest, taken, playerNotice, month, world });
    if (cand) {
      const [a, b] = ends(cand.key);
      const describe = (type) => cand.onPlayerLane
        ? `${c.name} put ${type.name} freighters on ${a} → ${b} — it is going after your freight.`
        : `${c.name} launched freighter service on ${a} → ${b} with the ${type.name}.`;
      const plans = lines
        ? bestCargoPlan({ ...c, cargoRoutes: routes }, cand.key, opts, { ranked: true }).slice(0, 4)
        : [bestCargoPlan({ ...c, cargoRoutes: routes }, cand.key, opts)].filter(Boolean);
      for (const plan of plans) {
        const deposit = cargoTailDeposit(plan.type, plan.tails);
        if (cash - deposit < reserve * 1.5) continue;
        const cfg = { ...plan.cfg, openedWeek: weekNumber };
        const event = { type: 'cargoLaunch', airlineId: c.id, name: c.name, routeKey: cand.key, cargo: true,
          attackedPlayer: cand.onPlayerLane, description: describe(plan.type) };
        if (lines) {
          const q = quote(plan.type, plan.tails);
          if (q.delay > lineGiveUpWeeks) continue;
          cash -= deposit;
          placeOrder('cargoLaunch', cargoTailKey(cand.key), plan.type, q, cfg, event);
          break;
        }
        cash -= deposit;
        for (let i = 0; i < plan.tails; i++) fleet.push(makeCargoTail(c.id, plan.type.id, cand.key, false));
        routes[cand.key] = cfg;
        events.push(event);
        break;
      }
    }
  }

  return { cargoRoutes: routes, fleet, cash, _cargoLoss: loss, _cargoLoad: load };
}

/**
 * Production lines: a cargo plan whose frames have all arrived takes effect.
 * Returns the updated { cargoRoutes, fleet, cargoLoad } or null when `plan` is
 * not a cargo plan (the caller handles passenger plans itself).
 */
export function deliverCargoPlan(c, plan, { cargoRoutes, fleet, cargoLoad }) {
  const lane = cargoLaneOf(plan.routeKey);
  if (lane == null) return null;
  const n = (plan.weeks ?? []).length;
  const cur = cargoRoutes[lane];
  if (plan.kind === 'cargoLaunch') {
    if (cur) return { cargoRoutes, fleet, cargoLoad, delivered: false };
    cargoRoutes[lane] = cargoLaneCfg(lane, { ...plan.cfg, tails: n });
  } else {
    if (!cur) return { cargoRoutes, fleet, cargoLoad, delivered: false };
    cargoRoutes[lane] = cargoLaneCfg(lane, { ...cur, frequency: plan.cfg.frequency ?? cur.frequency, tails: (cur.tails ?? 1) + n });
  }
  for (let i = 0; i < n; i++) fleet.push(makeCargoTail(c.id, plan.typeId, lane, false));
  cargoLoad[lane] = 0;
  return { cargoRoutes, fleet, cargoLoad, delivered: true };
}
