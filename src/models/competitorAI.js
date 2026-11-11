// ─────────────────────────────────────────────────────────────────────────────
// ADAPTIVE COMPETITOR AI
//
// Replaces the old fixed expansion script (COMPETITOR_EXPANSION_SCHEDULE) with
// living airlines that manage their networks like the player does:
//
//   • Each carrier has a PERSONALITY ARCHETYPE that shapes where it expands,
//     how fast it acts, and how it treats the player.
//   • Expansion is funded by real cash: a carrier opens routes only when it can
//     afford the aircraft deposits, and it targets markets that fit its style.
//   • Routes that lose money for a sustained stretch get cut. Distressed
//     carriers shrink; carriers with negative cash enter FIRE SALE (cheap to
//     acquire); prolonged distress ends in bankruptcy.
//   • Strong carriers occasionally acquire weak ones (AI-vs-AI mergers), and
//     new startup airlines appear mid-game — the market stays alive.
//   • On routes shared with the player, carriers match capacity when it is
//     profitable to do so, and pricing reactions (tickCompetitorPricing) still
//     apply every week.
//
// Everything here is pure apart from Math.random. Called once per ADVANCE_WEEK
// from GameContext, before competitor weekly stats are computed.
// ─────────────────────────────────────────────────────────────────────────────

import { baseCityPairDemand, routeDistance, referencePrice } from '../utils/market.js';
import { marketDevFor, marketDevTarget, MARKET_DEV_REF_FREQ } from './marketDev.js';
import { getAircraftType, maxSeatsForRange, eraPurchasePrice } from '../data/aircraft.js';
import { valueRemaining } from '../data/overhead.js';
import { ALLIANCES, applyAllianceEra } from '../data/alliances.js';
import { featureLive } from '../data/eraFeatures.js';
import { AIRPORTS, getAirport } from '../data/airports.js';
import { viaOf, routeLegKm, findRefuelStop, techStopDemandShare } from './rivalStops.js';
import {
  inHomeMarket, routeTouchesHome, homeCountryOf, secondaryAirportsFor, launchFrequency,
  buildPairContest, fareBand, YIELD_STEP, ageMaintenanceMult, RENEWAL_AGE_YEARS,
  rivalLaneSeats, houseMakerOf, isOtherHouse, OTHER_HOUSE_VALUE,
} from './rivalBrain.js';

/**
 * Routes a rival set lists for a carrier (models/rivalSets.js) that it lost
 * to sustained losses wait this long before it tries them again.
 */
export const LISTED_RETRY_WEEKS = 104;
import {
  pickCompetitorAircraftType,
  rankCompetitorAircraftTypes,
  tailsForRoute,
  tailsForCompetitorRoute,
  makeCompetitorTail,
  generateStarterRoutes,
  buildCompetitorFleet,
  bigAirports,
  TIER_PRICE_MULT,
  tickCompetitorPricing,
  computeCompetitorRoutePnL,
  buildPairIncumbents,
  pickLargerCompetitorAircraftType,
  isPreferredType,
  competitorCanFly,
} from './demand.js';
import { quotePlan } from './lineBook.js';
import { buildRivalFromSpec, rivalChance } from './rivalSets.js';
import {
  buildCargoContest, manageCompetitorCargo, deliverCargoPlan, cargoLaneOf, cargoTailKey,
} from './competitorCargo.js';

// ─── Personality archetypes ──────────────────────────────────────────────────

/**
 * actEvery: weeks between network decisions (staggered per carrier).
 * Lower = more hyperactive management.
 */
export const ARCHETYPES = {
  aggressive:   { label: 'Aggressive',   icon: '⚔️', actEvery: 4, blurb: 'Attacks rivals head-on, targeting busy routes others already fly — including yours.' },
  expansionist: { label: 'Expansionist', icon: '🚀', actEvery: 3, blurb: 'Grows fast and thin, opening new spokes wherever cash allows.' },
  fortress:     { label: 'Fortress',     icon: '🏰', actEvery: 6, blurb: 'Builds density at its home hub and defends it fiercely.' },
  copycat:      { label: 'Copycat',      icon: '🪞', actEvery: 5, blurb: 'Watches successful routes — especially yours — and follows onto proven markets.' },
  niche:        { label: 'Niche',        icon: '🧭', actEvery: 6, blurb: 'Seeks under-served markets and avoids crowded lanes.' },
  balanced:     { label: 'Balanced',     icon: '⚖️', actEvery: 5, blurb: 'Steady, profit-first network management.' },
};

const TIER_ARCHETYPE_POOL = {
  budget:  ['aggressive', 'expansionist', 'copycat', 'balanced'],
  legacy:  ['fortress', 'copycat', 'balanced', 'aggressive'],
  premium: ['fortress', 'niche', 'balanced'],
};

/** Pick an archetype appropriate to the carrier's tier. */
export function assignArchetype(airline) {
  const pool = TIER_ARCHETYPE_POOL[airline.tier] ?? TIER_ARCHETYPE_POOL.legacy;
  return pool[Math.floor(Math.random() * pool.length)];
}

// ─── Tunable knobs ───────────────────────────────────────────────────────────

/** Cash a carrier keeps untouched before funding expansion. */
const CASH_RESERVE = { budget: 3_000_000, legacy: 8_000_000, premium: 12_000_000 };

/**
 * Tier BASELINE network size. This is the centre of a distribution, not the
 * ceiling any individual carrier flies to — see carrierMaxRoutes().
 */
const MAX_ROUTES = { budget: 26, legacy: 30, premium: 22 };

/**
 * Per-carrier network ceiling (Discord 2026-09-10, wj: "why do all AI airlines
 * have 62 planes and 30 routes").
 *
 * MAX_ROUTES used to BE the ceiling, so every carrier of a tier grew to exactly
 * the same number and stopped: within five game-years every legacy rival sat on
 * 30 routes and every premium on 22, with fleets clustered around one number
 * because fleet size is a function of route count. The board read as one airline
 * copy-pasted twenty times.
 *
 * Each carrier now gets its own ceiling, from four factors:
 *   - its tier baseline (above);
 *   - a stable per-carrier draw from hashId(id) spanning 0.45–1.15, so two
 *     legacy carriers differ by 2.5x end to end. The draw is centred at 0.80,
 *     BELOW the old flat number, so the spread opens downward as well as up:
 *     the typical rival is a little smaller than before and only the handful
 *     that stack a mega hub, an expansionist streak and a second hub end up
 *     bigger. This is a variety change, not a quiet difficulty increase.
 *     Hash, not Math.random,
 *     so the ceiling survives a save/load and never drifts mid-game;
 *   - its archetype — an expansionist really does grow a wide thin network, a
 *     niche carrier really does stay small;
 *   - its home hub's size: a mega-hub carrier can support a bigger network than
 *     one based at a major, and a regional-hub carrier stays small.
 * A second hub lifts the ceiling 25% — that is the reward for surviving long
 * enough to open one, and it is what keeps the very top of the board growing
 * after the pack has settled.
 */
const ARCH_ROUTE_SCALE = {
  expansionist: 1.20,
  aggressive:   1.10,
  copycat:      1.00,
  balanced:     0.98,
  fortress:     0.86,
  niche:        0.70,
};
const HUB_ROUTE_SCALE = { mega: 1.15, major: 1.00, regional: 0.78 };
const CARRIER_ROUTES_MIN = 8;
const CARRIER_ROUTES_MAX = 60;   // a guard, not a destination — the factors below top out below it

export function carrierMaxRoutes(airline) {
  const base    = MAX_ROUTES[airline.tier] ?? 26;
  // hashId is 16-bit; map to a 0.62–1.38 spread, stable for the life of the id.
  const spread  = 0.45 + (hashId(String(airline.id ?? airline.name ?? '')) / 0xffff) * 0.70;
  const archMul = ARCH_ROUTE_SCALE[airline._archetype] ?? 1.0;
  const hubTier = AIRPORTS.find(a => a.code === airline.homeHub)?.tier ?? 'major';
  const hubMul  = HUB_ROUTE_SCALE[hubTier] ?? 1.0;
  const secondHubMul = airline.secondaryHub ? 1.15 : 1.0;
  const n = Math.round(base * spread * archMul * hubMul * secondHubMul);
  return Math.max(CARRIER_ROUTES_MIN, Math.min(CARRIER_ROUTES_MAX, n));
}

/** Never shrink below this many routes voluntarily. */
const MIN_ROUTES = 3;

/** Cumulative loss-weeks on a route before it gets cut. */
const LOSS_WEEKS_TO_CUT = 10;

/**
 * Capacity right-sizing (HUB_CONNECTIVITY_PLAN.md "AI capacity realism").
 * A route's capacity used to be fixed at launch for its whole life. Now a
 * carrier reads its own P&L each action week: a route that keeps selling out
 * (P&L load factor at the 88% cap) gains frequency in ~25% steps and, once the
 * schedule is dense, up-gauges to a larger type; a route flying under 55% is
 * trimmed toward a 70% load BEFORE the loss timer can cut it. Streaks are
 * counted in weeks (`_routeLoad`, signed: >0 full, <0 thin) so a seasonal
 * blip moves nothing. At most CAPACITY_MOVES_PER_ACT routes change per action
 * week, so a 20-route carrier re-plans its network over about a year.
 */
const CAPACITY_FULL_LF        = 0.85;   // P&L caps LF at 0.88 — "we could have sold more"
const CAPACITY_THIN_LF        = 0.55;
const FULL_WEEKS_TO_GROW      = 8;
const THIN_WEEKS_TO_TRIM      = 8;
const CAPACITY_MOVES_PER_ACT  = 2;
const GROW_STEP               = 0.25;   // +25% frequency per move (min +1)
const TRIM_STEP               = 0.30;   // −30% frequency per move (min −1)
const GROW_TARGET_LF          = 0.80;   // size the schedule to demand at this load
const TRIM_TARGET_LF          = 0.70;
const MIN_FREQUENCY           = 3;      // matches the expansion floor
const MAX_FREQUENCY           = 28;     // matches the player-response cap
const UPGAUGE_FROM_FREQUENCY  = 21;     // dense schedule → bigger aircraft, not more flights
const UPGAUGE_MIN_SEAT_STEP   = 1.15;   // the next size must be a real step up
/**
 * Largest frame an up-gauge may reach, by stage length and carrier tier. The
 * P&L model sees unlimited demand on a trunk lane, so without this a 300 km
 * shuttle would end up on an A340; real short-haul stays narrowbody (gates,
 * turn times, slots) and budget carriers fly one narrowbody family.
 */
function upgaugeSeatCeiling(distKm, tier) {
  const byStage = distKm < 1500 ? 250 : distKm < 3500 ? 330 : Infinity;
  return tier === 'budget' ? Math.min(byStage, 250) : byStage;
}

// ── Look before launching (2026-11-11 audit) ────────────────────────────────
/** Candidates, best-scored first, whose route P&L is worked out before one is chosen. */
const LAUNCH_SHORTLIST = 8;
/** Smart-rival worlds: uncontested regional airports added to that shortlist. */
const LAUNCH_SHORTLIST_SECONDARY = 4;
/** Aircraft types costed for each candidate. */
const LAUNCH_TYPES_CONSIDERED = 5;
/** A full-service carrier values a home regional spoke above its own P&L: it feeds the hub. */
const HUB_FEED_VALUE = 1.25;

// ── Smart-rival worlds (state.smartRivalsWorld: new games) ───────────────────
/** Weeks a route sits on the load cap before its fare goes up. */
const YIELD_FULL_WEEKS = 4;
/** Below this load a fare above the floor comes down. */
const YIELD_SOFT_LF = 0.70;
/** A carrier with at least this many routes is restructured the first time it fails. */
const RESTRUCTURE_MIN_ROUTES = 4;
/** What a restructured carrier's costs are multiplied by, and for how long. */
export const RESTRUCTURE_COST_RELIEF = 0.92;
export const RESTRUCTURE_RELIEF_WEEKS = 156;
/** Quality points a restructuring costs. */
const RESTRUCTURE_QUALITY_HIT = 4;
/** The most airframes a failed carrier's liquidation lists. */
export const LIQUIDATION_MAX_AIRFRAMES = 60;
/**
 * Cash a smart-world carrier holds before paying most of its profit out: half
 * a year of costs (real airlines hold about a quarter of annual revenue), and
 * never less than the floor.
 */
export const SMART_CASH_WEEKS     = 13;
export const SMART_CASH_FLOOR     = 60_000_000;
export const SMART_CASH_RETENTION = 0.12;

/** Standard takeover premium over the target's market cap. */
export const ACQUISITION_PREMIUM = 1.25;

/** Fire sale: acquisition premium drops from 1.25× to this while flag is set. */
export const FIRE_SALE_PREMIUM = 0.75;

/**
 * Break-up floor — what fraction of a target's fleet NAV sets the minimum price.
 *
 * The market-cap formula prices the BUSINESS (profits + cash) and ignores the
 * aircraft entirely. That is fine for a going concern, but it means a loss-maker
 * can print a cap far below what its jets are worth — and every acquired jet
 * lands in the player's fleet, sellable next click.
 *
 * So this is set to the fleet's REALIZABLE value: SELL_AIRCRAFT pays NAV minus a
 * 5% selling fee, so 0.95 is exactly what the buyer could liquidate the fleet
 * for. Buy-and-break-up therefore nets zero, which is the only value that closes
 * the loop — anything lower is a money printer with extra steps, because the
 * buyer flips the metal for more than the whole airline cost.
 *
 * TUNING: lowering this makes weak carriers cheaper to absorb AND reopens the
 * flip (profit ≈ (0.95 − haircut) × fleet NAV). The reward for a distressed
 * takeover is meant to be the network — routes, gates, slots — which still comes
 * free on top of the metal.
 */
export const FLEET_FLOOR_HAIRCUT = 0.95;

/** Bankruptcy triggers. */
const BANKRUPT_CASH_FLOOR   = -15_000_000;
const BANKRUPT_DISTRESS_WKS = 15;

/** Weekly probability of an AI-vs-AI merger being attempted (needs candidates). */
const MERGER_PROB = 0.025;

// ── Fare wars ────────────────────────────────────────────────────────────────

/**
 * Chance (per action week) a provoked carrier declares a fare war — at FULL
 * player notice. It scales with playerNotice, so a mid-sized airline draws
 * the occasional war and a giant draws them at the old rate.
 */
const FARE_WAR_PROB = 0.30;
/** Player notice at which fare wars become possible at all (≈$25M market cap). */
const FARE_WAR_MIN_NOTICE = 0.30;

// ── Player notice (how much attention the AI pays the player) ───────────────

/** Market cap at or below which the player is barely on the radar. */
export const NOTICE_FLOOR_CAP = 15_000_000;
/** Market cap at which the AI's attention is total. */
export const NOTICE_FULL_CAP  = 250_000_000;
const NOTICE_MIN = 0.15;

/**
 * How much attention the AI pays the player, 0.15 → 1, from market cap.
 *
 * It used to be a cliff: 0.15 below $25M, 0.5 from $25M, 1.0 from $100M. A
 * growing airline crosses $100M around years 2–3 and overnight every
 * aggressive rival scored the player's routes ×3.4 as expansion targets,
 * defenders boosted against it and fare wars switched on — the same stretch
 * in which the player's own network is sized to its markets and every world
 * downturn bites in full. Now it climbs smoothly in log(market cap), so
 * attention grows with the airline instead of arriving in one week:
 *   $15M 0.15 · $25M 0.30 · $50M 0.51 · $100M 0.72 · $250M+ 1.0
 */
export function playerNoticeFor(marketCap) {
  const mc = Number(marketCap);
  if (!Number.isFinite(mc) || mc <= NOTICE_FLOOR_CAP) return NOTICE_MIN;
  if (mc >= NOTICE_FULL_CAP) return 1;
  const t = Math.log(mc / NOTICE_FLOOR_CAP) / Math.log(NOTICE_FULL_CAP / NOTICE_FLOOR_CAP);
  return NOTICE_MIN + (1 - NOTICE_MIN) * t;
}
/** How far below the player's fare ratio a warring carrier prices. */
const FARE_WAR_UNDERCUT = 0.15;
/** Absolute fare-ratio floors during a war — below normal tier floors (that's the point). */
const FARE_WAR_FLOOR = { budget: 0.50, legacy: 0.62, premium: 0.85 };
/** War duration: base + random extra weeks. */
const FARE_WAR_MIN_WEEKS = 6;
const FARE_WAR_EXTRA_WEEKS = 8;

// ── Quality investment ───────────────────────────────────────────────────────

/** Quality score ceilings/floors by tier — investment can't escape your business model. */
const QUALITY_CAP   = { budget: 55, legacy: 82, premium: 96 };
const QUALITY_FLOOR = { budget: 28, legacy: 48, premium: 62 };
/** Cash cost per quality point invested. */
const QUALITY_INVEST_COST = 400_000;

// ── Alliances & hubs ─────────────────────────────────────────────────────────

/** Chance (per action week) an unallied healthy carrier joins an alliance.
 *  Budget carriers rarely do — the LCC model goes it alone, like real life. */
const ALLIANCE_JOIN_PROB = { budget: 0.015, legacy: 0.06, premium: 0.06 };
/** Chance (per action week) a fire-sale carrier is expelled from its alliance. */
const ALLIANCE_EXPEL_PROB = 0.25;
/** Max members per alliance bloc. */
const ALLIANCE_MAX_MEMBERS = 8;
/** Quality-score bonus a carrier's offers get from alliance membership. */
export const ALLIANCE_OFFER_QUALITY_BONUS = 3;

/** Network size + cash needed before a carrier opens a second hub. */
const SECOND_HUB_MIN_ROUTES = 10;
const SECOND_HUB_MIN_TOUCHES = 4;

/**
 * Dividend retention: above this cash pile, a carrier pays most of its profit
 * out to shareholders instead of banking it (keeps market caps acquirable).
 */
export const DIVIDEND_CASH_THRESHOLD = 400_000_000;
export const DIVIDEND_RETENTION      = 0.35;

/**
 * Apply dividend policy to a week's profit: how much of `profit` a carrier
 * actually adds to its cash pile given its current balance.
 */
export function retainedProfit(cash, profit, { weeklyCost = null } = {}) {
  if (weeklyCost != null) {
    // Smart-rival worlds: the cash target follows the size of the airline.
    // Up to the target it keeps everything; past it, a sliver; past twice
    // it, nothing — the rest goes to shareholders.
    if (profit <= 0) return profit;
    const target = Math.max(SMART_CASH_FLOOR, weeklyCost * SMART_CASH_WEEKS);
    if (cash < target) return profit;
    return cash < target * 2 ? Math.round(profit * SMART_CASH_RETENTION) : 0;
  }
  if (profit <= 0 || cash < DIVIDEND_CASH_THRESHOLD) return profit;
  return Math.round(profit * DIVIDEND_RETENTION);
}

// ── Competitor marketing (share of voice) ────────────────────────────────────
//
// Every carrier projects a marketing "voice" at the airports it serves —
// heaviest at its home hub, a small station presence everywhere else, scaled
// by tier and cut when distressed. On top of that, carriers can run ad
// BLITZES: time-limited campaigns (paid weekly from real cash) launched to
// counter a player campaign at their hub, or occasionally unprovoked.
// The player's targeted campaigns compete against this voice (see
// shareOfVoiceFactor / competitorPressureDrag in overhead.js).

const MKT_HUB_SPEND     = { budget:  90_000, legacy: 220_000, premium: 300_000 };
const MKT_STATION_SPEND = { budget:   8_000, legacy:  18_000, premium:  25_000 };
const BLITZ_MAX_MULT    = 3;         // blitz spend cap: 3× the carrier's hub baseline
const BLITZ_MIN_WEEKS   = 6;
const BLITZ_EXTRA_WEEKS = 8;
/** Player campaign spend at a carrier's hub that provokes a counter-blitz. */
const BLITZ_PROVOKE_SPEND = 100_000;
/** Weekly counter-blitz probability by archetype (when provoked + healthy). */
const BLITZ_PROB = { fortress: 0.20, aggressive: 0.15, expansionist: 0.08, copycat: 0.06, niche: 0.03, balanced: 0.06 };
/** Weekly probability of an unprovoked hub brand campaign (healthy carriers). */
const BLITZ_UNPROVOKED_PROB = 0.012;

/**
 * Total competitor marketing spend ($/wk) per airport, for share-of-voice.
 * Pure derivation from competitor state — call each tick, nothing stored.
 * @returns {{[airportCode: string]: number}}
 */
export function competitorMarketingSpend(competitors) {
  const voice = {};
  const add = (code, amt) => { if (code && amt > 0) voice[code] = (voice[code] ?? 0) + amt; };
  for (const c of competitors ?? []) {
    if (!c) continue;
    const healthMult = c.fireSale ? 0.25 : (c._distressWeeks ?? 0) > 3 ? 0.5 : 1;
    add(c.homeHub, (MKT_HUB_SPEND[c.tier] ?? 150_000) * healthMult);
    if (c.secondaryHub) add(c.secondaryHub, (MKT_HUB_SPEND[c.tier] ?? 150_000) * 0.6 * healthMult);
    const station = (MKT_STATION_SPEND[c.tier] ?? 15_000) * healthMult;
    for (const key of Object.keys(c.routes ?? {})) {
      const [a, b] = key.split('-');
      if (a !== c.homeHub) add(a, station);
      if (b !== c.homeHub) add(b, station);
    }
    for (const [code, blitz] of Object.entries(c._mktBlitz ?? {})) {
      add(code, (blitz.spend ?? 0));
    }
  }
  return voice;
}

/** Weekly probability of a startup airline launching (gated by roster size). */
const STARTUP_PROB    = 0.020;
const MAX_ROSTER      = 28;
const ENDGAME_ROSTER  = 4;    // stop spawning startups when few rivals remain
const STARTUP_MIN_WEEK = 26;  // let the opening board settle first

// ─── Startup airline pool ────────────────────────────────────────────────────

const STARTUP_POOL = [
  { name: 'Velocity Air',    homeHub: 'ORD', tier: 'budget',  logoId: 'bolt',    baseQualityScore: 40, cash: 12_000_000 },
  { name: 'Aurora Air',      homeHub: 'HEL', tier: 'legacy',  logoId: 'arctic',  baseQualityScore: 60, cash: 22_000_000 },
  { name: 'Sirocco Express', homeHub: 'CMN', tier: 'budget',  logoId: 'prism',   baseQualityScore: 36, cash:  9_000_000 },
  { name: 'Golden Gate Air', homeHub: 'SFO', tier: 'legacy',  logoId: 'compass', baseQualityScore: 64, cash: 26_000_000 },
  { name: 'Bengal Sky',      homeHub: 'DEL', tier: 'legacy',  logoId: 'horizon', baseQualityScore: 61, cash: 20_000_000 },
  { name: 'Adriatic Air',    homeHub: 'VIE', tier: 'legacy',  logoId: 'comet',   baseQualityScore: 62, cash: 20_000_000 },
  { name: 'Coral Air',       homeHub: 'MNL', tier: 'budget',  logoId: 'phoenix', baseQualityScore: 38, cash: 10_000_000 },
  { name: 'Antipodes Air',   homeHub: 'AKL', tier: 'legacy',  logoId: 'summit',  baseQualityScore: 63, cash: 21_000_000 },
  { name: 'Harmattan Air',   homeHub: 'LOS', tier: 'budget',  logoId: 'bolt',    baseQualityScore: 34, cash:  8_000_000 },
  { name: 'Crystal Skies',   homeHub: 'DOH', tier: 'premium', logoId: 'crown',   baseQualityScore: 81, cash: 45_000_000 },
  { name: 'Meridian Air',    homeHub: 'GRU', tier: 'legacy',  logoId: 'eagle',   baseQualityScore: 62, cash: 22_000_000 },
  { name: 'Borealis Jet',    homeHub: 'YYZ', tier: 'budget',  logoId: 'arctic',  baseQualityScore: 39, cash: 11_000_000 },
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

function hashId(id) {
  let h = 0;
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) & 0xffff;
  return h;
}

const pairKeyOf = (a, b) => [a, b].sort().join('-');

/** Deposit paid when adding tails (matches the old scripted-growth model). */
function tailDeposit(type, count) {
  return count * (type?.weeklyLease ?? 0) * 4;
}

/** Cash recovered when a route is cut (partial deposit recovery / sale). */
function tailSalvage(type, count) {
  return count * (type?.weeklyLease ?? 0) * 2;
}

let _startupSeq = 0;

// ─── Setup options for the whole field (Tailwinds, 2026-10-17) ───────────────
/**
 * Rival pressure: how hard the field pushes. `notice` scales the attention the
 * AI pays the player (where it expands, how readily it defends, how likely a
 * fare war — all of which already read playerNotice); `act` moves every
 * carrier's decision cadence by a week.
 */
export const RIVAL_PRESSURE = {
  relaxed: { notice: 0.5, act: +1 },
  fierce:  { notice: 1.5, act: -1 },
};
/** Random start-up frequency, as a multiple of STARTUP_PROB. */
export const STARTUP_RATE = { rare: 0.4, frequent: 2.5 };

// ─── Production lines ────────────────────────────────────────────────────────
// Production-line worlds (state.productionLinesWorld): rivals buy aircraft off
// the same shared lines as the player (models/lineBook.js). A move that needs
// new aircraft — a new route, more flights, a bigger type — is placed as an
// ORDER and happens when the last frame arrives. The cash is committed at
// ordering, exactly as it was when the frames arrived the same week.
/** A new route tries another type when its favourite's line holds it up longer than this. */
export const AI_LINE_PATIENCE_WEEKS = 13;
/** A move that would wait this much longer than on an empty line is not placed. */
export const AI_LINE_GIVE_UP_WEEKS = 39;
/** Weeks between one rival's frames off a line (null = the player's class gap). */
export const AI_LINE_GAP_WEEKS = null;
/**
 * A carrier this far above its cash reserve buys early slots when the line is
 * busy: it pays the same early-slot fee a player's lease does (a share of list
 * price per frame) to get ahead of the queue — rivals can snag early slots too.
 */
export const AI_EARLY_SLOT_RESERVE_MULT = 6;
/** How far down its list of types a carrier looks for a less busy line. */
const AI_LINE_ALTERNATIVES = 4;

let _planSeq = 0;
function newPlanId(airlineId) { return `${airlineId}-p${(++_planSeq).toString(36)}`; }

/**
 * Plans whose last frame has arrived by `absWeek` take effect: the route move
 * they were ordered for happens now, and the move's own news goes out.
 * Returns { carrier, events }.
 */
export function deliverLinePlans(c, absWeek) {
  const plans = c.linePlans ?? [];
  if (!plans.length) return { carrier: c, events: [] };
  const done = plans.filter(p => (p.weeks ?? []).every(w => w <= absWeek));
  if (!done.length) return { carrier: c, events: [] };
  const routes  = { ...c.routes };
  let   fleet   = [...(c.fleet ?? [])];
  const loadMap = { ...(c._routeLoad ?? {}) };
  const cargo   = { ...(c.cargoRoutes ?? {}) };
  const cargoLoad = { ...(c._cargoLoad ?? {}) };
  const events  = [];
  for (const p of done) {
    // Freighters for a cargo lane (competitorCargo.js) — their own book.
    if (cargoLaneOf(p.routeKey) != null) {
      const r = deliverCargoPlan(c, p, { cargoRoutes: cargo, fleet, cargoLoad });
      fleet = r.fleet;
      if (r.delivered && p.event) events.push(p.event);
      continue;
    }
    const n   = (p.weeks ?? []).length;
    const cur = routes[p.routeKey];
    if (p.kind === 'launch') {
      if (cur) continue;   // already flying it some other way: nothing to open
      routes[p.routeKey] = { ...p.cfg, tails: n };
      for (let i = 0; i < n; i++) fleet.push(makeCompetitorTail(c.id, p.typeId, p.routeKey, false));
    } else if (p.kind === 'upgauge') {
      if (!cur) continue;
      routes[p.routeKey] = { ...cur, aircraftType: p.typeId, seats: p.cfg.seats };
      fleet = fleet.map(f => f.routeKey === p.routeKey ? { ...f, typeId: p.typeId, ageWeeks: 0 } : f);
    } else if (p.kind === 'nonstop') {
      // A refuelling-stop route (models/rivalStops.js) re-equipped to fly
      // nonstop: the new frames replace the old ones, and the stop goes.
      if (!cur) continue;
      const { via: _via, ...rest } = cur;
      routes[p.routeKey] = { ...rest, aircraftType: p.typeId, seats: p.cfg.seats, tails: n };
      fleet = fleet.filter(f => f.routeKey !== p.routeKey);
      for (let i = 0; i < n; i++) fleet.push(makeCompetitorTail(c.id, p.typeId, p.routeKey, false));
    } else {
      if (!cur) continue;  // route withdrawn while waiting (cut drops the plan too)
      routes[p.routeKey] = {
        ...cur,
        frequency:    p.cfg.frequency,
        aircraftType: p.cfg.aircraftType ?? cur.aircraftType,
        ...(cur.seats == null && p.cfg.seats != null ? { seats: p.cfg.seats } : {}),
        tails:        (cur.tails ?? 1) + n,
      };
      for (let i = 0; i < n; i++) fleet.push(makeCompetitorTail(c.id, p.typeId, p.routeKey, false));
    }
    loadMap[p.routeKey] = 0;
    if (p.event) events.push(p.event);
  }
  const doneIds = new Set(done.map(p => p.id));
  return {
    carrier: { ...c, routes, fleet, _routeLoad: loadMap, linePlans: plans.filter(p => !doneIds.has(p.id)),
               ...(c.cargoRoutes || Object.keys(cargo).length ? { cargoRoutes: cargo, _cargoLoad: cargoLoad } : {}) },
    events,
  };
}

// ─── Main weekly tick ────────────────────────────────────────────────────────

/**
 * Advance all competitor networks by one week.
 *
 * @param {CompetitorAirline[]} competitors
 * @param {object} ctx
 *   weekNumber      total game-weeks elapsed (1-based)
 *   month           current game month 1–12 (seasonality)
 *   playerRoutes    [{ origin, destination, ticketPrice, weeklyFrequency }]
 *   playerHubs      airport codes of the player's designated hubs
 *   playerMarketCap player market cap (drives how much attention the player draws)
 * @returns {{ competitors: CompetitorAirline[], events: object[] }}
 *
 * Event types: launch | boost | cut | retrench | fireSale | recovered |
 *              bankrupt | merger | startup
 */
export function tickCompetitorAI(competitors, ctx) {
  const {
    weekNumber = 1,
    month = 1,
    playerRoutes = [],
    playerHubs = [],
    playerMarketCap = 0,
    playerCampaignSpend = {},   // { [airportCode]: $/wk } — player's targeted marketing
    calendarYear = null,        // era worlds: real year (null = classic)
    world: worldIn = null,      // this week's world events { demandMultFor, fuelMult } — see computeCompetitorRoutePnL
    lines = null,               // production-line worlds: the tick's booking ledger (lineBook.makeTickLedger)
    entrants = null,            // rival set (era games): rivals waiting for their founding year — models/rivalSets.js
    noRandomStartups = false,   // setup option: only the set's own entrants ever join mid-game
    rosterCap = 0,              // a custom field may start larger than MAX_ROSTER; entrants may refill it to its start size
    pressure = null,            // setup option: 'relaxed' | 'fierce' (null = normal) — RIVAL_PRESSURE
    mergers = true,             // setup option: false = rivals never merge with each other
    startupRate = null,         // setup option: 'off' | 'rare' | 'frequent' (null = normal) — STARTUP_RATE
    startupCap = 0,             // the field size random startups refill to (0 = MAX_ROSTER)
    cargo = false,              // setup option: rivals open freight lanes (competitorCargo.js)
    playerCargoRoutes = [],     // state.cargoRoutes — the player's freighters, for the freight contest
    playerFleet = [],           // state.fleet — to read those freighters' types
    stopsWorld = false,         // new games: refuelling stops + listed routes kept as goals (models/rivalStops.js)
    smart = false,              // new games: pair contest, yield management, regional airports, fleet age, restructuring (models/rivalBrain.js)
  } = ctx ?? {};
  const pressureCfg = RIVAL_PRESSURE[pressure] ?? null;
  // Smart-rival worlds: every route P&L in this tick reads the pair contest —
  // who offers what on each city pair, the player included — as the week opens.
  const world = smart
    ? { ...(worldIn ?? {}), contest: worldIn?.contest ?? buildPairContest(competitors, playerRoutes) }
    : worldIn;

  const events = [];

  // Era worlds: no alliances before 1997; founding members take their seats
  // the year they open. Classic worlds pass through untouched.
  const allianceEra = applyAllianceEra(competitors, calendarYear);
  competitors = allianceEra.competitors;
  const alliancesLive = featureLive('globalAlliances', calendarYear);
  for (const c of allianceEra.founded) {
    const aName = ALLIANCES.find(a => a.id === c.allianceId)?.name ?? c.allianceId;
    events.push({ type: 'allianceJoin', airlineId: c.id, name: c.name, allianceId: c.allianceId,
      description: `${c.name} is a founding member of the new ${aName}.` });
  }

  // ── Player market snapshot ─────────────────────────────────────────────────
  const playerPairs = new Map();   // pairKey → { freq, price }
  for (const r of playerRoutes) {
    const key = pairKeyOf(r.origin, r.destination);
    const prev = playerPairs.get(key);
    playerPairs.set(key, {
      freq:  (prev?.freq ?? 0) + (r.weeklyFrequency ?? 0),
      price: r.ticketPrice ?? prev?.price ?? null,
    });
  }
  const playerAirports = new Set();
  for (const r of playerRoutes) { playerAirports.add(r.origin); playerAirports.add(r.destination); }

  // Incumbent counts per pair (all AI carriers + player) — competition awareness
  // AND the demand-split input for per-route P&L.
  const incumbents = buildPairIncumbents(competitors, playerRoutes);

  // Player is "on the radar" once established — AI attention scales with size.
  const playerNotice = playerNoticeFor(playerMarketCap) * (pressureCfg?.notice ?? 1);

  // Who flies freight where (player + every rival), as the week opens. Built
  // once: a rival's freight decisions this week see last week's lanes, the
  // same lag the passenger side has with incumbents.
  const cargoContest = buildCargoContest(competitors, playerCargoRoutes, playerFleet);

  // ── Per-carrier network management ────────────────────────────────────────
  let updated = competitors.map(airline => {
    let c = { ...airline };

    // Smart-rival worlds: airframes age a week; restructuring relief runs out.
    if (smart && c.fleet?.length) c.fleet = c.fleet.map(f => ({ ...f, ageWeeks: (f.ageWeeks ?? 0) + 1 }));
    if (c.costRelief != null && weekNumber >= (c._reliefUntil ?? 0)) {
      const { costRelief: _relief, _reliefUntil: _until, ...rest } = c;
      c = rest;
    }

    // Lazy init (new games AND old saves migrate transparently).
    if (!c._archetype) c._archetype = assignArchetype(c);
    if (c.allianceId === undefined) {
      c.allianceId = ALLIANCES.find(a => a.memberIds.includes(c.id))?.id ?? null;
    }
    const arch = ARCHETYPES[c._archetype] ?? ARCHETYPES.balanced;
    // Seats a type flies on a lane: the lane's limit, and in smart-rival
    // worlds the tier's cabin (rivalBrain.CABIN_DENSITY).
    const laneSeats = (t, d) => smart ? rivalLaneSeats(t, d, c.tier) : maxSeatsForRange(t, d);
    const typeOpts  = (demand) => smart ? { smart, demand: demand ?? null, home: homeCountryOf(c), house: houseMakerOf(c) } : null;

    const lastProfit = (c.profitHistory && c.profitHistory.length)
      ? c.profitHistory[c.profitHistory.length - 1] : 0;
    const reserve = CASH_RESERVE[c.tier] ?? 8_000_000;

    // ── Fare-war upkeep (every week) ─────────────────────────────────────────
    if (c._fareWars && Object.keys(c._fareWars).length) {
      const wars = {};
      for (const [key, w] of Object.entries(c._fareWars)) {
        const [a, b] = key.split('-');
        if (!playerPairs.has(key) || !c.routes[key]) {
          // The player abandoned the lane (or the carrier cut it) — war over.
          events.push({ type: 'fareWarEnd', airlineId: c.id, name: c.name, routeKey: key,
            description: `${c.name} ended its fare war on ${a} → ${b} — the battle for the route is over.` });
          continue;
        }
        if ((c.cash ?? 0) < reserve * 0.3) {
          events.push({ type: 'fareWarEnd', airlineId: c.id, name: c.name, routeKey: key, capitulated: true,
            description: `${c.name} capitulated — it can no longer afford the fare war on ${a} → ${b}.` });
          continue;
        }
        if (w.weeksLeft <= 1) {
          events.push({ type: 'fareWarEnd', airlineId: c.id, name: c.name, routeKey: key,
            description: `${c.name} called a truce on ${a} → ${b}; fares are returning to normal.` });
          continue;
        }
        wars[key] = { ...w, weeksLeft: w.weeksLeft - 1 };
      }
      c._fareWars = wars;
    }

    // ── Marketing blitz upkeep + launches (every week) ───────────────────────
    if (c._mktBlitz && Object.keys(c._mktBlitz).length) {
      const live = {};
      for (const [code, b] of Object.entries(c._mktBlitz)) {
        if (b.weeksLeft <= 1 || (c.cash ?? 0) < reserve * 0.3) continue;  // expired or can't afford
        c.cash = (c.cash ?? 0) - (b.spend ?? 0);                          // paid weekly from real cash
        live[code] = { ...b, weeksLeft: b.weeksLeft - 1 };
      }
      c._mktBlitz = live;
    }
    const canBlitz = !c.fireSale && (c.cash ?? 0) > reserve;
    if (canBlitz) {
      const hubBase = MKT_HUB_SPEND[c.tier] ?? 150_000;
      const myHubs  = [c.homeHub, c.secondaryHub].filter(Boolean);
      for (const hub of myHubs) {
        if (c._mktBlitz?.[hub]) continue;
        const playerSpendHere = playerCampaignSpend[hub] ?? 0;
        const provoked = playerSpendHere >= BLITZ_PROVOKE_SPEND;
        const prob = provoked
          ? (BLITZ_PROB[c._archetype] ?? 0.06)
          : BLITZ_UNPROVOKED_PROB;
        if (Math.random() >= prob) continue;
        const spend = provoked
          ? Math.min(Math.round(playerSpendHere * 1.25), hubBase * BLITZ_MAX_MULT)
          : hubBase;
        const weeks = BLITZ_MIN_WEEKS + Math.floor(Math.random() * BLITZ_EXTRA_WEEKS);
        c._mktBlitz = { ...(c._mktBlitz ?? {}), [hub]: { spend, weeksLeft: weeks } };
        events.push({
          type: 'mktBlitz', airlineId: c.id, name: c.name, airport: hub, provoked,
          description: provoked
            ? `${c.name} launched a counter-advertising blitz at ${hub}, fighting your campaign for local mindshare.`
            : `${c.name} launched a brand campaign at ${hub} — expect stiffer competition for local passengers.`,
        });
      }
    }

    // ── Distress / fire-sale bookkeeping (every week) ────────────────────────
    const distressed = (c.cash ?? 0) < reserve * 0.5 && lastProfit < 0;
    c._distressWeeks = distressed
      ? (c._distressWeeks ?? 0) + 1
      : Math.max(0, (c._distressWeeks ?? 0) - 1);

    if ((c.cash ?? 0) < 0 && !c.fireSale) {
      c.fireSale = true;
      events.push({ type: 'fireSale', airlineId: c.id, name: c.name,
        description: `${c.name} is in financial distress — its board is entertaining takeover offers at a discount.` });
    } else if (c.fireSale && (c.cash ?? 0) > reserve) {
      c.fireSale = false;
      events.push({ type: 'recovered', airlineId: c.id, name: c.name,
        description: `${c.name} has stabilised its finances and is no longer seeking a buyer.` });
    }

    // ── Production lines: deliveries, every week ─────────────────────────────
    if (lines) {
      const delivered = deliverLinePlans(c, lines.absWeek);
      c = delivered.carrier;
      events.push(...delivered.events);
    }

    // ── Decision cadence: each carrier acts every `actEvery` weeks, staggered ─
    // Rival pressure (setup option) moves every carrier's cadence a week
    // either way: relaxed rivals act less often, fierce ones more.
    const actEvery = Math.max(2, arch.actEvery + (pressureCfg?.act ?? 0));
    const acts = ((weekNumber + hashId(c.id)) % actEvery) === 0;
    if (!acts) return c;

    const routes  = { ...c.routes };
    let   fleet   = [...(c.fleet ?? [])];
    let   cash    = c.cash ?? 0;
    const lossMap = { ...(c._routeLoss ?? {}) };
    const routeKeys = Object.keys(routes);

    // Production lines: aircraft on order, one plan per route at a time. A
    // route waiting on frames is left alone until they arrive.
    let   plans   = [...(c.linePlans ?? [])];
    const planned = (k) => plans.some(p => p.routeKey === k);
    // The standard slots, or — for a cash-rich carrier facing a busy line —
    // earlier ones at the early-slot fee. `fee` is extra cash on top of the
    // deposit; the caller still checks the deposit against its own reserve.
    const quote   = (type, n) => {
      const std = quotePlan(lines, plans, type, n, { gap: AI_LINE_GAP_WEEKS });
      if (std.delay <= 0) return { ...std, fee: 0 };
      const early = quotePlan(lines, plans, type, n, { gap: AI_LINE_GAP_WEEKS, early: true });
      const fee = Math.round(early.premiumPct * eraPurchasePrice(type));
      if (early.weeks[n - 1] >= std.weeks[n - 1] || cash - fee < reserve * AI_EARLY_SLOT_RESERVE_MULT) return { ...std, fee: 0 };
      return { ...early, fee };
    };
    // Book the frames, take the cash, say what was ordered. The move itself
    // (and its own news) happens on delivery — deliverLinePlans.
    const placeOrder = (kind, key, type, q, cfg, event) => {
      cash -= q.fee ?? 0;
      const plan = { id: newPlanId(c.id), kind, routeKey: key, typeId: type.id, lineId: q.lineId,
                     weeks: q.weeks, cfg, orderedAbs: lines.absWeek, event };
      plans = [...plans, plan];
      lines.add(q.lineId, q.weeks);
      const lane = cargoLaneOf(key);
      const [a, b] = (lane ?? key).split('-');
      const n = q.weeks.length;
      const first = q.weeks[0] - lines.absWeek;
      const last  = q.weeks[n - 1] - lines.absWeek;
      events.push({ type: 'aircraftOrder', airlineId: c.id, name: c.name, routeKey: lane ?? key, typeId: type.id, count: n,
        ...(lane ? { cargo: true } : {}),
        description: `${c.name} ordered ${n} ${type.name}${n === 1 ? '' : 's'} for ${a} → ${b}${lane ? ' freight' : ''}`
          + (n === 1 ? `, delivering in ${first} weeks.` : `, delivering in ${first}–${last} weeks.`) });
    };

    // Per-route P&L (only on action weeks — keeps the tick cheap).
    const pnl = {};
    // World events reach the AI's books too: in a recession a rival sees thin
    // loads and trims like anyone would, which is the player's opening.
    for (const key of routeKeys) pnl[key] = computeCompetitorRoutePnL(c, key, routes[key], month, incumbents, world);
    const inWar = (k) => !!(c._fareWars && c._fareWars[k]);   // war losses are deliberate — don't cut/trim
    // What a route would earn under a different schedule/type — every capacity
    // move below has to pay: no growth that loses money, no trim that earns less.
    const projected = (key, cfg) => computeCompetitorRoutePnL(c, key, cfg, month, incumbents, world)?.profit ?? -Infinity;

    // 1a. Capacity right-sizing: fit the schedule to the loads it carries.
    //     Trims run first (they free cash and can save a route from the loss
    //     timer below); growth takes the most profitable full route first.
    const loadMap = { ...(c._routeLoad ?? {}) };
    const trimmed = new Set();
    const repriced = new Set();
    {
      for (const key of routeKeys) {
        const p = pnl[key];
        if (!p) { delete loadMap[key]; continue; }
        const prev = loadMap[key] ?? 0;
        if (p.loadFactor >= CAPACITY_FULL_LF)      loadMap[key] = Math.max(0, prev) + actEvery;
        else if (p.loadFactor < CAPACITY_THIN_LF)  loadMap[key] = Math.min(0, prev) - actEvery;
        else                                       loadMap[key] = 0;
      }
      let movesLeft = CAPACITY_MOVES_PER_ACT;

      // Smart-rival worlds — yield management. A route that keeps selling out
      // is under-priced: the fare goes up a step before any flights are added,
      // as far as the carrier's band allows (further when it has the pair to
      // itself). A soft route's fare comes down toward the floor. Every move
      // has to pay on the route's own P&L, and a repriced route is left alone
      // by the capacity moves below until its new loads are in.
      if (smart) {
        for (const key of routeKeys) {
          const cfg = routes[key];
          const p   = pnl[key];
          if (!cfg || !p || inWar(key) || planned(key)) continue;
          const band   = fareBand(c, incumbents.get(key) ?? 1);
          const streak = loadMap[key] ?? 0;
          let next = null;
          if (p.loadFactor >= CAPACITY_FULL_LF && streak >= YIELD_FULL_WEEKS && cfg.priceMultiplier < band.ceiling) {
            next = Math.min(band.ceiling, cfg.priceMultiplier + YIELD_STEP);
          } else if (p.loadFactor < YIELD_SOFT_LF && cfg.priceMultiplier > band.floor) {
            next = Math.max(band.floor, cfg.priceMultiplier - YIELD_STEP);
          }
          if (next == null) continue;
          const trial = { ...cfg, priceMultiplier: +next.toFixed(4) };
          if (projected(key, trial) <= p.profit) continue;
          routes[key] = trial;
          repriced.add(key);
          // The fare is doing the work: the sell-out streak waits for it.
          if (loadMap[key] > 0) loadMap[key] = Math.max(0, loadMap[key] - actEvery);
        }
      }

      // Trim candidates: chronically thin routes, plus routes that are losing
      // money without being full — a smaller schedule is tried before the loss
      // timer below withdraws them (right-size, then exit).
      const losingUnfull = (k) => (pnl[k]?.profit ?? 0) < 0 && (pnl[k]?.loadFactor ?? 1) < CAPACITY_FULL_LF
        && (lossMap[k] ?? 0) >= actEvery;
      const thin = routeKeys
        .filter(k => ((loadMap[k] ?? 0) <= -THIN_WEEKS_TO_TRIM || losingUnfull(k))
          && !inWar(k) && routes[k].frequency > MIN_FREQUENCY && !planned(k) && !repriced.has(k))
        .sort((x, y) => (pnl[x]?.loadFactor ?? 0) - (pnl[y]?.loadFactor ?? 0));
      for (const key of thin) {
        if (movesLeft <= 0) break;
        const cfg = routes[key];
        const p   = pnl[key];
        const [a, b] = key.split('-');
        const type   = cfg.aircraftType ? getAircraftType(cfg.aircraftType) : null;
        // Toward the demand at a 70% load, but never more than −30% in one move.
        const want    = Math.ceil((p.demandOneWay ?? 0) / Math.max(1, (p.seats ?? 150) * TRIM_TARGET_LF));
        const floor   = Math.max(MIN_FREQUENCY, Math.round(cfg.frequency * (1 - TRIM_STEP)));
        const newFreq = Math.min(cfg.frequency - 1, Math.max(want, floor, MIN_FREQUENCY));
        if (newFreq >= cfg.frequency) continue;
        const newTails = tailsForCompetitorRoute(key, cfg, newFreq);
        const surplus  = Math.max(0, (cfg.tails ?? 1) - newTails);
        if (projected(key, { ...cfg, frequency: newFreq, tails: Math.max(1, (cfg.tails ?? 1) - surplus) }) < p.profit) continue;
        if (surplus > 0) {
          cash += tailSalvage(type, surplus);
          const drop = new Set(fleet.filter(f => f.routeKey === key).slice(0, surplus));
          fleet = fleet.filter(f => !drop.has(f));
        }
        routes[key] = { ...cfg, frequency: newFreq, tails: Math.max(1, (cfg.tails ?? 1) - surplus) };
        loadMap[key] = 0;
        trimmed.add(key);
        movesLeft--;
        events.push({ type: 'trim', airlineId: c.id, name: c.name, routeKey: key,
          description: `${c.name} trimmed ${a} → ${b} to ${newFreq}×/wk after months of half-empty flights.` });
      }

      const canGrow = !c.fireSale && (lastProfit > 0 || cash > reserve * 2);
      const full = routeKeys
        .filter(k => canGrow && (loadMap[k] ?? 0) >= FULL_WEEKS_TO_GROW && (pnl[k]?.profit ?? 0) > 0 && !planned(k) && !repriced.has(k))
        .sort((x, y) => (pnl[y]?.profit ?? 0) - (pnl[x]?.profit ?? 0));
      for (const key of full) {
        if (movesLeft <= 0) break;
        const cfg = routes[key];
        const p   = pnl[key];
        const [a, b] = key.split('-');
        const dist   = routeLegKm(key, cfg);   // the longest leg on a refuelling-stop route
        const type   = cfg.aircraftType ? getAircraftType(cfg.aircraftType) : pickCompetitorAircraftType(dist, c.tier, c.fleetPref);
        if (!type) continue;
        const tails  = cfg.tails ?? 1;

        // Dense schedule: fly something bigger rather than a 22nd flight.
        if (cfg.frequency >= UPGAUGE_FROM_FREQUENCY) {
          const bigger = pickLargerCompetitorAircraftType(dist, Math.ceil((cfg.seats ?? type.seats) * UPGAUGE_MIN_SEAT_STEP), {
            prefer:   (t) => projected(key, { ...cfg, aircraftType: t.id, seats: laneSeats(t, dist), tails }),
            maxSeats: upgaugeSeatCeiling(dist, c.tier),
            fleetPref: c.fleetPref,
            smart,
            // Already on a preferred type: step up only within the preference.
            strictPref: isPreferredType(type, c.fleetPref),
          });
          if (bigger && projected(key, { ...cfg, aircraftType: bigger.id, seats: laneSeats(bigger, dist), tails }) > p.profit) {
            const cost = tailDeposit(bigger, tails) - tailSalvage(type, tails);
            if (cash - cost < reserve) continue;
            if (lines) {
              // Production lines: the bigger frames are ordered; the swap
              // happens when the last one arrives.
              const q = quote(bigger, tails);
              if (q.delay > AI_LINE_GIVE_UP_WEEKS) continue;
              cash -= cost;
              placeOrder('upgauge', key, bigger, q, { seats: laneSeats(bigger, dist) },
                { type: 'boost', airlineId: c.id, name: c.name, routeKey: key,
                  description: `${c.name} up-gauged ${a} → ${b} to the larger ${bigger.name ?? bigger.id} — the route keeps selling out.` });
              movesLeft--;
              continue;
            }
            cash -= cost;
            fleet = fleet.map(f => f.routeKey === key ? { ...f, typeId: bigger.id, ageWeeks: 0 } : f);
            routes[key] = { ...cfg, aircraftType: bigger.id, seats: laneSeats(bigger, dist), tails };
            loadMap[key] = 0;
            movesLeft--;
            events.push({ type: 'boost', airlineId: c.id, name: c.name, routeKey: key,
              description: `${c.name} up-gauged ${a} → ${b} to the larger ${bigger.name ?? bigger.id} — the route keeps selling out.` });
            continue;
          }
          if (cfg.frequency >= MAX_FREQUENCY) continue;   // biggest frame, fullest schedule: nothing left to add
        }

        // Otherwise add flights: +25% (at least one), no further than demand
        // supports at an 80% load, never past the schedule cap.
        const want    = Math.ceil((p.demandOneWay ?? 0) / Math.max(1, (cfg.seats ?? type.seats) * GROW_TARGET_LF));
        const step    = Math.max(1, Math.round(cfg.frequency * GROW_STEP));
        const newFreq = Math.min(MAX_FREQUENCY, cfg.frequency + step, Math.max(cfg.frequency + 1, want));
        if (newFreq <= cfg.frequency) continue;
        const newTails = tailsForCompetitorRoute(key, cfg, newFreq);
        const addTails = Math.max(0, newTails - tails);
        const cost     = tailDeposit(type, addTails);
        if (cash - cost < reserve) continue;
        const seatsOf = cfg.aircraftType ? {} : { seats: maxSeatsForRange(type, dist) };   // a newly picked type flies what the lane allows
        if (projected(key, { ...cfg, ...seatsOf, frequency: newFreq, aircraftType: type.id, tails: Math.max(tails, newTails) }) <= p.profit) continue;
        if (lines && addTails > 0) {
          const q = quote(type, addTails);
          if (q.delay > AI_LINE_GIVE_UP_WEEKS) continue;
          cash -= cost;
          placeOrder('grow', key, type, q, { ...seatsOf, frequency: newFreq, aircraftType: type.id },
            { type: 'boost', airlineId: c.id, name: c.name, routeKey: key,
              description: `${c.name} added flights on ${a} → ${b} (${cfg.frequency} → ${newFreq}×/wk) — the route keeps selling out.` });
          movesLeft--;
          continue;
        }
        cash -= cost;
        for (let i = 0; i < addTails; i++) fleet.push(makeCompetitorTail(c.id, type.id, key, false));
        routes[key] = { ...cfg, ...seatsOf, frequency: newFreq, aircraftType: type.id, tails: Math.max(tails, newTails) };
        loadMap[key] = 0;
        movesLeft--;
        events.push({ type: 'boost', airlineId: c.id, name: c.name, routeKey: key,
          description: `${c.name} added flights on ${a} → ${b} (${cfg.frequency} → ${newFreq}×/wk) — the route keeps selling out.` });
      }
    }

    // 1b. Smart-rival worlds — fleet age. Each route carries what its
    //     airframes now cost to maintain (rivalBrain.ageMaintenanceMult); the
    //     route P&L reads it, and step 7c renews the oldest.
    if (smart) {
      const ageSum = {}, ageN = {};
      for (const f of fleet) {
        ageSum[f.routeKey] = (ageSum[f.routeKey] ?? 0) + (f.ageWeeks ?? 0);
        ageN[f.routeKey]   = (ageN[f.routeKey] ?? 0) + 1;
      }
      for (const key of Object.keys(routes)) {
        if (!ageN[key]) continue;
        const m = +ageMaintenanceMult(ageSum[key] / ageN[key]).toFixed(3);
        if (m !== (routes[key].maintMult ?? 1)) routes[key] = { ...routes[key], maintMult: m };
      }
    }

    // 1. Track losses; cut chronic losers (forced cuts when broke). A route
    //    that was just right-sized gets a fresh start on the loss timer.
    for (const key of routeKeys) {
      const p = pnl[key];
      if (!p) continue;
      lossMap[key] = (p.profit < 0 && !trimmed.has(key)) ? (lossMap[key] ?? 0) + actEvery : 0;
    }
    const cuttable = routeKeys
      .filter(k => (lossMap[k] ?? 0) >= LOSS_WEEKS_TO_CUT && !inWar(k))
      .sort((a, b) => (pnl[a]?.profit ?? 0) - (pnl[b]?.profit ?? 0));
    let cutsAllowed = cash < 0 ? 2 : 1;
    // A broke carrier retrenches even routes that haven't hit the loss timer yet.
    if (cash < 0 && cuttable.length === 0) {
      const losers = routeKeys.filter(k => (pnl[k]?.profit ?? 0) < 0)
        .sort((a, b) => (pnl[a]?.profit ?? 0) - (pnl[b]?.profit ?? 0));
      cuttable.push(...losers);
    }
    for (const key of cuttable) {
      if (cutsAllowed <= 0) break;
      if (Object.keys(routes).length <= MIN_ROUTES) break;
      const cfg  = routes[key];
      const type = cfg.aircraftType ? getAircraftType(cfg.aircraftType) : null;
      cash += tailSalvage(type, cfg.tails ?? 1);
      fleet = fleet.filter(f => f.routeKey !== key);
      if (lines && planned(key)) {
        // Frames on order for a route being withdrawn: the order is cancelled
        // and the slots go back on the line.
        for (const pl of plans) if (pl.routeKey === key) lines.remove(pl.lineId, pl.weeks.filter(w => w >= lines.absWeek));
        plans = plans.filter(pl => pl.routeKey !== key);
      }
      delete routes[key];
      delete lossMap[key];
      delete loadMap[key];
      cutsAllowed--;
      // A route its rival set lists stays a goal, after a rest.
      if (stopsWorld && listedKeysOf(c).has(key)) {
        c._listedRetry = { ...(c._listedRetry ?? {}), [key]: weekNumber + LISTED_RETRY_WEEKS };
      }
      const [a, b] = key.split('-');
      events.push({ type: 'cut', airlineId: c.id, name: c.name, routeKey: key,
        description: `${c.name} withdrew from ${a} → ${b} after sustained losses.` });
    }

    // 2. Capacity response on routes shared with the player: match frequency
    //    where the route makes money (balanced pressure — no suicidal wars).
    let boostsAllowed = 1;
    for (const key of Object.keys(routes)) {
      if (boostsAllowed <= 0) break;
      const pInfo = playerPairs.get(key);
      if (!pInfo) continue;
      if (planned(key)) continue;
      const cfg = routes[key];
      const p   = pnl[key];
      if (!p || p.profit <= 0) continue;
      // Fortress carriers defend their hub markets hardest.
      const isHubLane = key.includes(c.homeHub);
      const defendBias = (c._archetype === 'fortress' && isHubLane) ? 1.0
        : (c._archetype === 'aggressive') ? 0.8 : 0.5;
      if (pInfo.freq > cfg.frequency * 1.4 && Math.random() < defendBias * playerNotice + 0.15) {
        const targetFreq = Math.min(28, Math.max(cfg.frequency + 2, Math.round(pInfo.freq * 0.8)));
        const [a, b] = key.split('-');
        const dist   = routeLegKm(key, cfg);
        const type   = cfg.aircraftType ? getAircraftType(cfg.aircraftType) : pickCompetitorAircraftType(dist, c.tier, c.fleetPref);
        if (!type) continue;
        const needTails = tailsForCompetitorRoute(key, cfg, targetFreq);
        const addTails  = Math.max(0, needTails - (cfg.tails ?? 1));
        const cost      = tailDeposit(type, addTails);
        if (cash - cost < reserve * 0.5) continue;
        if (lines && addTails > 0) {
          const q = quote(type, addTails);
          if (q.delay > AI_LINE_GIVE_UP_WEEKS) continue;
          cash -= cost;
          placeOrder('defend', key, type, q,
            { ...(cfg.aircraftType ? {} : { seats: maxSeatsForRange(type, dist) }), frequency: targetFreq, aircraftType: type.id },
            { type: 'boost', airlineId: c.id, name: c.name, routeKey: key,
              description: `${c.name} added capacity on ${a} → ${b}, matching your schedule.` });
          boostsAllowed--;
          continue;
        }
        cash -= cost;
        for (let i = 0; i < addTails; i++) fleet.push(makeCompetitorTail(c.id, type.id, key, false));
        routes[key] = { ...cfg, ...(cfg.aircraftType ? {} : { seats: maxSeatsForRange(type, dist) }), frequency: targetFreq, aircraftType: type.id, tails: needTails };
        boostsAllowed--;
        events.push({ type: 'boost', airlineId: c.id, name: c.name, routeKey: key,
          description: `${c.name} added capacity on ${a} → ${b}, matching your schedule.` });
      }
    }

    // 3. Quality investment: winners polish the product, losers cut service.
    const qCap   = QUALITY_CAP[c.tier]   ?? 82;
    const qFloor = QUALITY_FLOOR[c.tier] ?? 48;
    let quality  = c.baseQualityScore;
    if (c.fireSale || (c._distressWeeks ?? 0) >= 6) {
      if (quality > qFloor) {
        quality -= 1;   // service cuts: catering, cleaning, staffing
        if ((quality - qFloor) % 5 === 0) {
          events.push({ type: 'quality', airlineId: c.id, name: c.name, direction: 'down',
            description: `${c.name} is slashing service standards to conserve cash — passengers are noticing.` });
        }
      }
    } else if ((lastProfit > 0 || cash > reserve * 2) && cash - QUALITY_INVEST_COST > reserve * 1.5 && quality < qCap) {
      quality += 1;
      cash    -= QUALITY_INVEST_COST;
      const invested = (c._qualityInvested ?? 0) + 1;
      c._qualityInvested = invested;
      if (invested % 5 === 0) {
        events.push({ type: 'quality', airlineId: c.id, name: c.name, direction: 'up',
          description: `${c.name} completed a cabin & service upgrade program — its quality reputation is climbing.` });
      }
    }
    c.baseQualityScore = quality;

    // 4. Alliance diplomacy: healthy loners join blocs; broke members get expelled.
    if (alliancesLive && !c.allianceId && (lastProfit > 0 || cash > reserve * 2)
        && weekNumber >= 13 && Math.random() < (ALLIANCE_JOIN_PROB[c.tier] ?? 0.05)) {
      const counts = {};
      for (const other of competitors) {
        const aid = other.allianceId ?? ALLIANCES.find(a => a.memberIds.includes(other.id))?.id ?? null;
        if (aid) {
          counts[aid] = counts[aid] ?? { total: 0, sameTier: 0 };
          counts[aid].total += 1;
          if (other.tier === c.tier) counts[aid].sameTier += 1;
        }
      }
      // Join the bloc with the most same-tier members that still has room.
      const open = ALLIANCES.filter(a => (counts[a.id]?.total ?? 0) < ALLIANCE_MAX_MEMBERS);
      if (open.length) {
        const pick = open.sort((a, b) =>
          (counts[b.id]?.sameTier ?? 0) - (counts[a.id]?.sameTier ?? 0)
          || (counts[a.id]?.total ?? 0) - (counts[b.id]?.total ?? 0))[0];
        c.allianceId = pick.id;
        events.push({ type: 'allianceJoin', airlineId: c.id, name: c.name, allianceId: pick.id,
          description: `${c.name} joined ${pick.name}.` });
      }
    } else if (c.allianceId && c.fireSale && Math.random() < ALLIANCE_EXPEL_PROB) {
      const aName = ALLIANCES.find(a => a.id === c.allianceId)?.name ?? c.allianceId;
      events.push({ type: 'allianceLeave', airlineId: c.id, name: c.name, allianceId: c.allianceId,
        description: `${aName} expelled the struggling ${c.name} from the alliance.` });
      c.allianceId = null;
    }

    // 5. Fare war declaration: aggressive/fortress carriers punish undercutting
    //    or an invasion of their hub — deliberately pricing below cost for weeks.
    const warCapable = (c._archetype === 'aggressive' || c._archetype === 'fortress')
      && !(c._fareWars && Object.keys(c._fareWars).length)
      && cash > reserve * 2
      && playerNotice >= FARE_WAR_MIN_NOTICE;
    if (warCapable && Math.random() < FARE_WAR_PROB * playerNotice) {
      let warKey = null;
      for (const key of Object.keys(routes)) {
        const pInfo = playerPairs.get(key);
        if (!pInfo?.price) continue;
        const [a, b] = key.split('-');
        const refP = referencePrice(a, b);
        if (!refP) continue;
        const playerRatio = pInfo.price / refP;
        const undercutting = playerRatio < routes[key].priceMultiplier - 0.08;
        const hubInvasion  = key.includes(c.homeHub) || (c.secondaryHub && key.includes(c.secondaryHub));
        if (undercutting || (c._archetype === 'fortress' && hubInvasion)) { warKey = key; break; }
      }
      if (warKey) {
        const [a, b] = warKey.split('-');
        c._fareWars = {
          ...(c._fareWars ?? {}),
          [warKey]: { weeksLeft: FARE_WAR_MIN_WEEKS + Math.floor(Math.random() * FARE_WAR_EXTRA_WEEKS) },
        };
        events.push({ type: 'fareWar', airlineId: c.id, name: c.name, routeKey: warKey,
          description: `${c.name} declared a fare war on ${a} → ${b} — it is slashing fares below cost to drive you off the route.` });
      }
    }

    // 6. Second hub: a thriving carrier turns its busiest focus city into a hub.
    if (!c.secondaryHub && Object.keys(routes).length >= SECOND_HUB_MIN_ROUTES && cash > reserve * 3) {
      const touch = {};
      for (const key of Object.keys(routes)) {
        for (const code of key.split('-')) {
          if (code !== c.homeHub) touch[code] = (touch[code] ?? 0) + 1;
        }
      }
      // Smart-rival worlds: a hub is a base, so it is opened in the carrier's
      // home market, never at a foreign airport it happens to fly to a lot
      // (rivalBrain.js).
      const [bestCode, touches] = Object.entries(touch)
        .filter(([code]) => !smart || inHomeMarket(c, code, calendarYear))
        .sort(([, x], [, y]) => y - x)[0] ?? [null, 0];
      if (bestCode && touches >= SECOND_HUB_MIN_TOUCHES) {
        c.secondaryHub = bestCode;
        events.push({ type: 'secondHub', airlineId: c.id, name: c.name, airport: bestCode,
          description: `${c.name} designated ${bestCode} as its second hub and will build out a network there.` });
      }
    }

    // 7. Expansion: one new route per action week, if healthy and funded.
    //    Refuelling-stop worlds: a route the carrier's rival set lists comes
    //    first, the moment something can fly it (nonstop or through a stop) —
    //    and it may take the carrier past its usual network size, since the
    //    set asked for it.
    const launchesOnOrder = plans.filter(p => p.kind === 'launch').length;
    // Routes already on order count as taken, or the best target would be
    // the one the carrier is still waiting to open, every act until it does.
    const network = lines && launchesOnOrder > 0
      ? { ...routes, ...Object.fromEntries(plans.filter(p => p.kind === 'launch').map(p => [p.routeKey, p.cfg])) }
      : routes;
    const healthy    = lastProfit > 0 || cash > reserve * 2;
    const listedCand = stopsWorld && healthy && cash > reserve
      ? pickListedRoute(c, network, { weekNumber, playerPairs }) : null;
    const roomToGrow = listedCand != null || Object.keys(routes).length + launchesOnOrder < carrierMaxRoutes(c);
    if (roomToGrow && healthy && cash > reserve) {
      // Smart-rival worlds — look before launching: each shortlisted route is
      // costed on the carrier's own route P&L (aircraft, schedule, who else is
      // on the pair) and only one that pays is opened. A route its rival set
      // lists is opened whether or not it pays (the set asked for it), on the
      // best aircraft for it. Elsewhere the best-scored route is opened on the
      // tier's usual aircraft at its nominal schedule, as it always was.
      const evaluate = smart ? (cd, o = {}) => planLaunch(c, cd, {
        fleet, nRoutes: Object.keys(routes).length, incumbents, month, world, ...o }) : null;
      const cand = listedCand
        ? (smart ? { ...listedCand, plan: evaluate(listedCand, { force: true }) } : listedCand)
        : pickExpansionTarget(c, network, { incumbents, playerPairs, playerHubs, playerNotice,
            stops: stopsWorld, calendarYear, smart, evaluate });
      const candCfg = cand?.via ? { via: cand.via } : {};
      const options = !cand ? []
        : cand.plan ? cand.plan.options
        : rankCompetitorAircraftTypes(cand.legKm, c.tier, c.fleetPref).slice(0, lines ? AI_LINE_ALTERNATIVES : 1).map(type => ({
            type, frequency: cand.frequency, seats: maxSeatsForRange(type, cand.legKm),
            tails: tailsForCompetitorRoute(cand.key, candCfg, cand.frequency) }));
      if (cand && lines) {
        // Production lines: order the frames; the route opens when they
        // arrive. A favourite whose line is booked solid gives way to the next
        // type down the list that can still be had in reasonable time.
        if (!planned(cand.key)) {
          let best = null;
          for (const o of options.slice(0, AI_LINE_ALTERNATIVES)) {
            if (cash - tailDeposit(o.type, o.tails) < reserve) continue;
            const q = quote(o.type, o.tails);
            if (!best || q.weeks[o.tails - 1] < best.q.weeks[best.o.tails - 1]) best = { o, q };
            if (q.delay <= AI_LINE_PATIENCE_WEEKS) { best = { o, q }; break; }
          }
          if (best && best.q.delay <= AI_LINE_GIVE_UP_WEEKS) {
            const { o, q } = best;
            cash -= tailDeposit(o.type, o.tails);
            const [a, b] = cand.key.split('-');
            placeOrder('launch', cand.key, o.type, q, {
              frequency:       o.frequency,
              priceMultiplier: cand.priceMultiplier,
              aircraftType:    o.type.id,
              seats:           o.seats,
              ...candCfg,
            }, launchEvent(c, cand, a, b));
          }
        }
      } else if (cand) {
        // The best plan the carrier can pay the deposits for.
        const o = options.find(x => cash - tailDeposit(x.type, x.tails) >= reserve);
        if (o) {
          cash -= tailDeposit(o.type, o.tails);
          for (let i = 0; i < o.tails; i++) fleet.push(makeCompetitorTail(c.id, o.type.id, cand.key, false));
          routes[cand.key] = {
            frequency:       o.frequency,
            priceMultiplier: cand.priceMultiplier,
            aircraftType:    o.type.id,
            seats:           o.seats,
            tails:           o.tails,
            ...candCfg,
          };
          const [a, b] = cand.key.split('-');
          events.push(launchEvent(c, cand, a, b));
        }
      }
    }

    // 7b. Refuelling stops (models/rivalStops.js): a carrier flying through a
    //     stop goes nonstop once a type that can do it is on the market — one
    //     route per action week, when the nonstop would earn more and the
    //     carrier can pay for the new frames.
    if (stopsWorld && !c.fireSale) {
      for (const key of Object.keys(routes)) {
        const cfg = routes[key];
        if (!viaOf(cfg) || planned(key)) continue;
        const [a, b] = key.split('-');
        const direct = routeDistance(a, b);
        const type = pickCompetitorAircraftType(direct, c.tier, c.fleetPref, typeOpts(pnl[key]?.demandOneWay));
        if (!type) continue;
        const { via, ...rest } = cfg;
        const tails  = tailsForRoute(direct, cfg.frequency);
        const next   = { ...rest, aircraftType: type.id, seats: laneSeats(type, direct), tails };
        const nowProfit = pnl[key]?.profit ?? computeCompetitorRoutePnL(c, key, cfg, month, incumbents, world)?.profit ?? 0;
        if (projected(key, next) <= nowProfit) continue;
        const old  = cfg.aircraftType ? getAircraftType(cfg.aircraftType) : null;
        const cost = tailDeposit(type, tails) - tailSalvage(old, cfg.tails ?? 1);
        if (cash - cost < reserve) continue;
        const event = { type: 'nonstop', airlineId: c.id, name: c.name, routeKey: key, via,
          description: `${c.name} now flies ${a} → ${b} nonstop on the ${type.name ?? type.id} — no more refuelling stop at ${via}.` };
        if (lines) {
          const q = quote(type, tails);
          if (q.delay > AI_LINE_GIVE_UP_WEEKS) continue;
          cash -= cost;
          placeOrder('nonstop', key, type, q, { seats: next.seats }, event);
          break;
        }
        cash -= cost;
        fleet = fleet.filter(f => f.routeKey !== key);
        for (let i = 0; i < tails; i++) fleet.push(makeCompetitorTail(c.id, type.id, key, false));
        routes[key] = next;
        loadMap[key] = 0;
        events.push(event);
        break;
      }
    }

    // 7c. Smart-rival worlds — fleet renewal. A healthy carrier replaces the
    //     airframes on its oldest route once they are past RENEWAL_AGE_YEARS,
    //     when the new ones would earn more and it can pay for them. A carrier
    //     that cannot keeps flying old metal at a rising maintenance bill.
    if (smart && !c.fireSale && (lastProfit > 0 || cash > reserve * 2)) {
      const oldMult = ageMaintenanceMult(RENEWAL_AGE_YEARS * 52);
      const oldest = Object.keys(routes)
        .filter(k => routes[k].aircraftType && !planned(k) && !inWar(k) && (routes[k].maintMult ?? 1) >= oldMult)
        .sort((x, y) => (routes[y].maintMult ?? 1) - (routes[x].maintMult ?? 1))[0];
      if (oldest) {
        const cfg    = routes[oldest];
        const [a, b] = oldest.split('-');
        const legKm  = routeLegKm(oldest, cfg);
        const old    = getAircraftType(cfg.aircraftType);
        const now    = pnl[oldest] ?? computeCompetitorRoutePnL(c, oldest, cfg, month, incumbents, world);
        const type   = pickCompetitorAircraftType(legKm, c.tier, c.fleetPref, typeOpts(now?.demandOneWay));
        const tails  = cfg.tails ?? 1;
        const next   = type ? { ...cfg, aircraftType: type.id, seats: laneSeats(type, legKm), maintMult: 1 } : null;
        const cost   = type ? tailDeposit(type, tails) - tailSalvage(old, tails) : Infinity;
        if (next && cash - cost >= reserve && projected(oldest, next) > (now?.profit ?? -Infinity)) {
          const years = Math.round(fleet.filter(f => f.routeKey === oldest).reduce((m, f) => Math.max(m, f.ageWeeks ?? 0), 0) / 52);
          const event = { type: 'renewal', airlineId: c.id, name: c.name, routeKey: oldest, typeId: type.id,
            description: type.id === old?.id
              ? `${c.name} replaced its ${years}-year-old ${old?.name ?? 'aircraft'} fleet on ${a} → ${b} with new ones.`
              : `${c.name} retired its ${years}-year-old ${old?.name ?? 'aircraft'} fleet on ${a} → ${b} for the ${type.name ?? type.id}.` };
          if (lines) {
            const q = quote(type, tails);
            if (q.delay <= AI_LINE_GIVE_UP_WEEKS) {
              cash -= cost;
              placeOrder('upgauge', oldest, type, q, { seats: next.seats }, event);
            }
          } else {
            cash -= cost;
            fleet = fleet.map(f => f.routeKey === oldest ? { ...f, typeId: type.id, ageWeeks: 0 } : f);
            routes[oldest] = next;
            events.push(event);
          }
        }
      }
    }

    // 8. Freight: rivals with a freight arm run it on the same action week,
    //    out of the same bank account and order book (competitorCargo.js).
    let cargoOut = null;
    if (c.cargoRoutes && Object.keys(c.cargoRoutes).length || (cargo && c.tier !== 'budget')) {
      cargoOut = manageCompetitorCargo(c, {
        cash, fleet, actEvery, reserve, lastProfit, weekNumber, month, world,
        contest: cargoContest, playerNotice, paxRoutes: Object.keys(routes).length,
        launchesAllowed: cargo === true, events,
        lines, quote, placeOrder, planned,
        cancelPlans: (key) => {
          for (const pl of plans) if (pl.routeKey === key) lines.remove(pl.lineId, pl.weeks.filter(w => w >= lines.absWeek));
          plans = plans.filter(pl => pl.routeKey !== key);
        },
        pendingLaunchLanes: new Set(plans.filter(p => p.kind === 'cargoLaunch').map(p => cargoLaneOf(p.routeKey))),
        lineGiveUpWeeks: AI_LINE_GIVE_UP_WEEKS,
      });
      cash  = cargoOut.cash;
      fleet = cargoOut.fleet;
    }

    return { ...c, routes, fleet, cash, _routeLoss: lossMap, _routeLoad: loadMap,
             ...(cargoOut ? { cargoRoutes: cargoOut.cargoRoutes, _cargoLoss: cargoOut._cargoLoss, _cargoLoad: cargoOut._cargoLoad } : {}),
             ...((lines || c.linePlans) ? { linePlans: plans } : {}) };
  });

  // ── Lifecycle: bankruptcies ────────────────────────────────────────────────
  // Smart-rival worlds: a carrier of any size is restructured the first time
  // it fails — it sheds its loss-making routes, its debts are written down and
  // it flies on with cheaper contracts for three years. The second failure is
  // final, and its aircraft are listed for sale (the reducer offers them to
  // the player). Elsewhere a failed carrier simply closes, as it always did.
  const survivors = [];
  for (const c of updated) {
    const broke = (c.cash ?? 0) < BANKRUPT_CASH_FLOOR
      || (c.fireSale && (c._distressWeeks ?? 0) >= BANKRUPT_DISTRESS_WKS);
    if (!broke) { survivors.push(c); continue; }
    if (smart && !c._restructured && Object.keys(c.routes ?? {}).length >= RESTRUCTURE_MIN_ROUTES) {
      const r = restructureCarrier(c, { month, incumbents, world, weekNumber, lines });
      survivors.push(r.carrier);
      events.push({ type: 'restructure', airlineId: c.id, name: c.name, dropped: r.dropped,
        description: `${c.name} has entered bankruptcy protection and keeps flying: ${r.dropped} loss-making route${r.dropped === 1 ? ' is' : 's are'} gone, its debts are written down and its costs cut. A second failure will close it.` });
      continue;
    }
    events.push({ type: 'bankrupt', airlineId: c.id, name: c.name,
      ...(smart ? { fleet: liquidationFleetOf(c) } : {}),
      description: smart
        ? `${c.name} has ceased operations — its aircraft are being sold off.`
        : `${c.name} has ceased operations — creditors seized its fleet.` });
  }
  updated = survivors;

  // ── Lifecycle: AI-vs-AI mergers ────────────────────────────────────────────
  if (mergers !== false && updated.length >= 6 && Math.random() < MERGER_PROB) {
    const buyers = updated
      .filter(c => (c.cash ?? 0) > 50_000_000 && ((c.profitHistory?.at(-1) ?? 0) > 0))
      .sort((a, b) => (b.cash ?? 0) - (a.cash ?? 0));
    const targets = updated
      .filter(c => c.fireSale || (c._distressWeeks ?? 0) >= 6)
      .sort((a, b) => (a.marketCap ?? 0) - (b.marketCap ?? 0));
    // Alliance solidarity: a distressed member's allies get first shot at the rescue.
    const target0 = targets[0];
    const allyBuyer = target0?.allianceId
      ? buyers.find(b => b.id !== target0.id && b.allianceId === target0.allianceId
          && (target0.marketCap ?? 20_000_000) * 0.9 < (b.cash ?? 0) * 0.8)
      : null;
    const buyer  = allyBuyer ?? buyers[0];
    const target = allyBuyer ? target0 : targets.find(t => t.id !== buyer?.id
      && (t.marketCap ?? 20_000_000) * 0.9 < (buyer?.cash ?? 0) * 0.8);
    // Same floor the player pays (see acquisitionQuote): a buyer can't take over a
    // carrier for less than the cash it inherits, or the AI mints money too.
    const mergerPrice = target
      ? Math.max(Math.round(Math.max(5_000_000, (target.marketCap ?? 10_000_000)) * 0.9),
                 Math.max(0, target.cash ?? 0))
      : 0;
    if (buyer && target && mergerPrice <= (buyer.cash ?? 0) * 0.8) {
      const price = mergerPrice;
      const mergedRoutes = { ...buyer.routes };
      const mergedFleet  = [...(buyer.fleet ?? [])];
      for (const [key, cfg] of Object.entries(target.routes ?? {})) {
        if (mergedRoutes[key]) continue;   // keep buyer's own service on overlaps
        mergedRoutes[key] = { ...cfg };
        for (const tail of (target.fleet ?? []).filter(f => f.routeKey === key)) {
          mergedFleet.push({ ...tail, id: `${buyer.id}-x${tail.id}` });
        }
      }
      // The freight arm comes too, lane by lane, on the same overlap rule.
      const mergedCargo = { ...(buyer.cargoRoutes ?? {}) };
      for (const [key, cfg] of Object.entries(target.cargoRoutes ?? {})) {
        if (mergedCargo[key]) continue;
        mergedCargo[key] = { ...cfg };
        for (const tail of (target.fleet ?? []).filter(f => f.routeKey === cargoTailKey(key))) {
          mergedFleet.push({ ...tail, id: `${buyer.id}-x${tail.id}` });
        }
      }
      const hasCargo = Object.keys(mergedCargo).length > 0;
      updated = updated
        .filter(c => c.id !== target.id)
        .map(c => c.id !== buyer.id ? c : {
          ...c,
          routes: mergedRoutes,
          fleet:  mergedFleet,
          ...(hasCargo ? { cargoRoutes: mergedCargo } : {}),
          cash:   (c.cash ?? 0) - price + Math.max(0, target.cash ?? 0),
        });
      events.push({ type: 'merger', airlineId: buyer.id, name: buyer.name, targetName: target.name,
        description: `${buyer.name} acquired the struggling ${target.name}, absorbing its network.` });
    }
  }

  // ── Lifecycle: rival-set entrants (era games) ────────────────────────────
  // A rival a set founds after the start year joins once the calendar reaches
  // its year — if the field has room. Otherwise it waits and tries again every
  // week ("if circumstances permit"). Founded with its own starter network, the
  // way a random startup is.
  // ── Lifecycle: rivals a set closes in a given year (era games) ───────────
  if (calendarYear != null && updated.some(c => c.ceased != null && calendarYear >= c.ceased)) {
    updated = updated.filter(c => {
      if (c.ceased == null || calendarYear < c.ceased) return true;
      events.push({ type: 'ceased', airlineId: c.id, name: c.name,
        description: `${c.name} has ceased operations${c.founded != null ? ` after ${calendarYear - c.founded} years` : ''}. Its routes are open to anyone.` });
      return false;
    });
  }

  let entrantsLeft = entrants;
  if (entrants?.length) {
    const cap = Math.max(MAX_ROSTER, rosterCap ?? 0);
    // Random start-ups (the game's own, not the set's) never hold a seat a set
    // airline is waiting for: they don't count against the room here, so a
    // set's historical airlines join in their year however many start-ups
    // have launched meanwhile (bug: a 1950 pack lost 6 of 34 to start-ups).
    const seated = () => updated.filter(c => !(c.isStartup && !c.fromSet)).length;
    const wait = [];
    for (const r of entrants) {
      if (calendarYear != null && r.ceased != null && calendarYear >= r.ceased) continue;   // its years passed with no room
      const due = calendarYear != null && r.founded != null && r.founded <= calendarYear;
      if (!due || seated() >= cap || updated.some(c => c.name === r.name)) { wait.push(r); continue; }
      // A chance entrant rolls once, the year it is due and there's room,
      // against the field as it stands then (likelier where few airlines are
      // based). A miss is final: it never gets off the ground this game.
      if ((r.chance ?? 100) < 100
          && !(Math.random() < rivalChance(r, [...playerHubs, ...updated.map(c => c.homeHub)]))) continue;
      const { _skippedRoutes, _viaStop, ...built } = buildRivalFromSpec(r, { idSeed: weekNumber, takenLogos: updated.map(c => c.logoId), stops: stopsWorld, smart });
      const newbie = { ...built, isStartup: true, foundedWeek: weekNumber };
      updated = [...updated, newbie];
      events.push({ type: 'startup', airlineId: newbie.id, name: newbie.name,
        description: `${newbie.name} has been founded and launched operations out of ${newbie.homeHub}.` });
    }
    entrantsLeft = wait;
  }

  // ── Lifecycle: startup airlines ────────────────────────────────────────────
  if (!noRandomStartups && startupRate !== 'off' && weekNumber >= STARTUP_MIN_WEEK
      && updated.length < (startupCap || MAX_ROSTER)
      && updated.length > ENDGAME_ROSTER
      && Math.random() < STARTUP_PROB * (STARTUP_RATE[startupRate] ?? 1)) {
    const usedNames = new Set(updated.map(c => c.name));
    const pool = STARTUP_POOL.filter(s => !usedNames.has(s.name));
    if (pool.length) {
      const spec = pool[Math.floor(Math.random() * pool.length)];
      const id   = `startup_${(++_startupSeq).toString(36)}_${hashId(spec.name).toString(36)}`;
      let newbie = {
        id,
        name: spec.name,
        homeHub: spec.homeHub,
        tier: spec.tier,
        logoId: spec.logoId,
        baseQualityScore: spec.baseQualityScore,
        cash: spec.cash,
        weeklyStats: null,
        routes: generateStarterRoutes({ homeHub: spec.homeHub, tier: spec.tier }, 3),
        isStartup: true,
        foundedWeek: weekNumber,
        _archetype: Math.random() < 0.6 ? 'expansionist' : 'aggressive',
      };
      newbie = buildCompetitorFleet(newbie, { recut: smart });
      updated = [...updated, newbie];
      events.push({ type: 'startup', airlineId: id, name: spec.name,
        description: `A new airline, ${spec.name}, has launched operations out of ${spec.homeHub}.` });
    }
  }

  // ── Weekly price reactions on shared routes (existing behaviour) ──────────
  updated = tickCompetitorPricing(updated, playerRoutes);

  // ── Fare-war pricing override ──────────────────────────────────────────────
  // Applied AFTER normal pricing so a war always wins: the warring carrier
  // tracks the player's fare down to a deep undercut, below its usual tier
  // floor. It loses money doing this — that's the point.
  updated = updated.map(c => {
    const wars = c._fareWars;
    if (!wars || !Object.keys(wars).length) return c;
    const routes = { ...c.routes };
    let changed = false;
    for (const key of Object.keys(wars)) {
      const cfg = routes[key];
      const pInfo = playerPairs.get(key);
      if (!cfg || !pInfo?.price) continue;
      const [a, b] = key.split('-');
      const refP = referencePrice(a, b);
      if (!refP) continue;
      const floor = FARE_WAR_FLOOR[c.tier] ?? 0.62;
      const warMult = Math.max(floor, +(pInfo.price / refP - FARE_WAR_UNDERCUT).toFixed(4));
      if (Math.abs(warMult - cfg.priceMultiplier) > 0.001) {
        routes[key] = { ...cfg, priceMultiplier: warMult };
        changed = true;
      }
    }
    return changed ? { ...c, routes } : c;
  });

  return { competitors: updated, events, ...(entrants ? { entrants: entrantsLeft } : {}) };
}

// ─── Expansion target selection ──────────────────────────────────────────────

/**
 * Cost a candidate route before it is opened: the aircraft types that suit it,
 * each at the schedule its seats call for, on the carrier's own route P&L.
 *
 * @param {object} c     the carrier
 * @param {object} cand  { key, legKm, priceMultiplier, via? }
 * @param {object} o     { fleet, nRoutes, incumbents, month, world, force }
 *   force: keep plans that lose money too (a route the rival set lists).
 * @returns {{ demand: number, options: object[] }} options best first:
 *   { type, frequency, seats, tails, profit, value }. Empty when nothing pays.
 *
 * Profit is the mean of this month and the month half a year on, so a route is
 * not opened on its peak season alone. `value` is profit against the lease
 * bill it ties up (a carrier is short of cash before it is short of routes),
 * lifted for a type the carrier already flies and lowered for one from the
 * maker it does not lean to (rivalBrain.houseMakerOf).
 */
export function planLaunch(c, cand, { fleet = [], nRoutes = 0, incumbents = null, month = 1, world = null, force = false } = {}) {
  const candCfg = cand.via ? { via: cand.via } : {};
  // The pair as it would be with this carrier on it.
  const counts = { get: (k) => (incumbents?.get(k) ?? 0) + (k === cand.key ? 1 : 0) };
  const offMonth = ((month + 5) % 12) + 1;
  const probe = computeCompetitorRoutePnL(c, cand.key,
    { frequency: 7, priceMultiplier: cand.priceMultiplier, ...candCfg }, month, counts, world);
  const probeOff = computeCompetitorRoutePnL(c, cand.key,
    { frequency: 7, priceMultiplier: cand.priceMultiplier, ...candCfg }, offMonth, counts, world);
  if (!probe) return { demand: 0, options: [] };
  const demand = ((probe.demandOneWay ?? 0) + (probeOff?.demandOneWay ?? probe.demandOneWay ?? 0)) / 2;
  const owned  = new Set(fleet.map(f => f.typeId));
  // A new route has to cover the head-office cost it adds (demand.js competitorOverhead).
  const hurdle = force ? -Infinity : 40_000 * 1.15 * Math.pow(Math.max(1, nRoutes), 0.15);
  const options = [];
  const house = houseMakerOf(c);
  const types = rankCompetitorAircraftTypes(cand.legKm, c.tier, c.fleetPref, { smart: true, demand, home: homeCountryOf(c), house });
  for (const type of types.slice(0, LAUNCH_TYPES_CONSIDERED)) {
    const seats     = rivalLaneSeats(type, cand.legKm, c.tier);
    const frequency = launchFrequency(demand, seats);
    const tails     = tailsForCompetitorRoute(cand.key, candCfg, frequency);
    const cfg = { frequency, priceMultiplier: cand.priceMultiplier, aircraftType: type.id, seats, tails, ...candCfg };
    const p1 = computeCompetitorRoutePnL(c, cand.key, cfg, month, counts, world);
    const p2 = computeCompetitorRoutePnL(c, cand.key, cfg, offMonth, counts, world);
    if (!p1) continue;
    const profit = (p1.profit + (p2?.profit ?? p1.profit)) / 2;
    if (!(profit > hurdle)) continue;
    const capital = Math.max(1, tails * (type.weeklyLease ?? 1));
    const common  = owned.has(type.id) ? (c.tier === 'budget' ? 1.3 : 1.15) : 1;
    const lean    = isOtherHouse(type, house) ? OTHER_HOUSE_VALUE : 1;
    options.push({ type, frequency, seats, tails, profit,
      value: profit > 0 ? (profit / Math.sqrt(capital)) * common * lean : profit });
  }
  options.sort((x, y) => y.value - x.value);
  return { demand, options };
}

/**
 * Choose the best new route for a carrier given its archetype.
 *
 * Candidates are scored the way they always were — demand, distance, who is
 * already there, and the archetype's taste (an aggressive carrier likes the
 * player's routes, a niche one avoids crowds). Smart-rival worlds (`smart`,
 * new games — the 2026-11-11 audit) change three things:
 *   · home market — aircraft are based at home (the hub, a second hub, and
 *     focus cities in the carrier's own market), and every route has an end
 *     there (rivalBrain.js);
 *   · look before launching — with `evaluate` (planLaunch), the best-scored
 *     few are costed and the one worth most is opened; one that would lose
 *     money is never opened;
 *   · the home market's regional airports join the pool.
 *
 * Returns { key, dist, legKm, frequency, priceMultiplier, onPlayerPair, via?,
 * plan? } or null. Without `evaluate` the best-scored candidate is returned
 * at the tier's nominal schedule, as before.
 */
export function pickExpansionTarget(airline, routes, { incumbents, playerPairs, playerHubs, playerNotice, stops = false, calendarYear = null, smart = false, evaluate = null }) {
  const arch = airline._archetype ?? 'balanced';
  const hub  = airline.homeHub;

  // Bases: fortress builds only from its hub(s); growth archetypes also expand
  // from their busiest network airports at home (focus cities).
  const bases = new Set([hub]);
  if (airline.secondaryHub) bases.add(airline.secondaryHub);
  if (arch === 'expansionist' || arch === 'aggressive' || arch === 'copycat') {
    const touch = {};
    for (const key of Object.keys(routes)) {
      for (const code of key.split('-')) touch[code] = (touch[code] ?? 0) + 1;
    }
    Object.entries(touch)
      .filter(([code]) => !smart || inHomeMarket(airline, code, calendarYear))
      .sort(([, a], [, b]) => b - a)
      .slice(0, 2)
      .forEach(([code]) => bases.add(code));
  }

  const playerHubSet = new Set(playerHubs ?? []);
  const pool = smart ? [...bigAirports(), ...secondaryAirportsFor(airline, calendarYear)] : bigAirports();
  const cands = [];
  const seen  = new Set();

  for (const base of bases) {
    for (const ap of pool) {
      if (ap.code === base) continue;
      const key = pairKeyOf(base, ap.code);
      if (routes[key] || (smart && seen.has(key))) continue;
      if (smart && !routeTouchesHome(airline, base, ap.code, calendarYear)) continue;
      const dist = routeDistance(base, ap.code);
      if (!dist || dist < 300) continue;
      // Out of range nonstop: refuelling-stop worlds look for one stop that
      // works (models/rivalStops.js); the stop costs it passengers and distance.
      let via = null, legKm = dist, flownKm = dist, stopShare = 1;
      if (!competitorCanFly(dist, airline.fleetPref)) {
        const stop = stops ? findRefuelStop(base, ap.code, { home: getAirport(airline.homeHub)?.country ?? null }) : null;
        if (!stop || !competitorCanFly(Math.max(...stop.legsKm), airline.fleetPref)) continue;
        via = stop.via; legKm = Math.max(...stop.legsKm); flownKm = stop.flownKm;
        stopShare = techStopDemandShare(base, via, ap.code);
      }
      // Market development (models/marketDev.js): score a candidate at the
      // market it would CREATE, not only the one there today — halfway between
      // today's level and what a well-served pair settles at — or rivals would only
      // ever enter markets someone else developed. Exactly 1 when the world is
      // not a market-development world.
      const devNow = marketDevFor(base, ap.code);
      const devFactor = (devNow + Math.max(devNow, marketDevTarget(MARKET_DEV_REF_FREQ))) / 2;
      const demand = baseCityPairDemand(base, ap.code) * devFactor * stopShare;
      if (!demand || demand < 40) continue;
      seen.add(key);

      const inc          = incumbents.get(key) ?? 0;
      const onPlayerPair = playerPairs.has(key);
      const touchesPlayerHub = playerHubSet.has(base) || playerHubSet.has(ap.code);

      const baseScore = demand / (1 + flownKm / 9000) / (1 + inc * 0.6);
      let score = baseScore;
      switch (arch) {
        case 'aggressive':
          if (onPlayerPair)     score *= 1 + 1.6 * playerNotice;
          if (touchesPlayerHub) score *= 1 + 0.8 * playerNotice;
          break;
        case 'copycat':
          if (onPlayerPair) score *= 1 + 2.4 * playerNotice;
          break;
        case 'niche':
          score /= (1 + inc * 1.2);
          if (onPlayerPair) score *= 0.25;
          break;
        case 'fortress':
          // hub-only via bases; slight preference for dense trunk lanes
          score *= 1.15;
          break;
        case 'expansionist':
          score *= 0.9 + Math.random() * 0.4;   // roll the dice a bit
          break;
        default:
          break;
      }
      cands.push({ key, dist, demand, score, bias: score / baseScore, onPlayerPair, via, legKm, inc,
        secondary: ap.tier === 'regional', fromHub: base === hub || base === airline.secondaryHub });
    }
  }
  if (!cands.length) return null;
  cands.sort((x, y) => y.score - x.score);

  const priceBase = TIER_PRICE_MULT[airline.tier] ?? 1.0;
  const priceOf = (cd) => {
    // Undercut modestly when deliberately entering the player's market.
    const undercut = cd.onPlayerPair && (arch === 'aggressive' || arch === 'copycat') ? 0.93 : 1.0;
    return +(priceBase * undercut * (0.97 + Math.random() * 0.06)).toFixed(3);
  };
  const shape = (cd, priceMultiplier, frequency, plan = null) => ({
    key: cd.key, dist: cd.dist, legKm: cd.legKm, frequency, priceMultiplier, onPlayerPair: cd.onPlayerPair,
    ...(cd.via ? { via: cd.via } : {}), ...(plan ? { plan } : {}) });

  if (!evaluate) {
    const best = cands[0];
    const seatsTarget = { budget: 160, legacy: 250, premium: 330 }[airline.tier] ?? 200;
    const frequency   = Math.max(3, Math.min(21, Math.round(best.demand / (seatsTarget * 0.75))));
    return shape(best, priceOf(best), frequency);
  }

  // The shortlist: the best-scored, plus — where regional airports are in the
  // pool — the best of those nobody serves, which a score built on raw demand
  // would never surface.
  const shortlist = cands.slice(0, LAUNCH_SHORTLIST);
  if (smart) {
    const listed = new Set(shortlist.map(cd => cd.key));
    shortlist.push(...cands.filter(cd => cd.secondary && cd.inc === 0 && !listed.has(cd.key)).slice(0, LAUNCH_SHORTLIST_SECONDARY));
  }
  let pick = null;
  for (const cd of shortlist) {
    const priceMultiplier = priceOf(cd);
    const plan = evaluate({ key: cd.key, legKm: cd.legKm, priceMultiplier, ...(cd.via ? { via: cd.via } : {}) });
    const top  = plan?.options?.[0];
    if (!top) continue;
    const feed  = cd.secondary && cd.fromHub && airline.tier !== 'budget' ? HUB_FEED_VALUE : 1;
    const worth = top.value * cd.bias * feed;
    if (!pick || worth > pick.worth) pick = { cd, priceMultiplier, plan, worth };
  }
  if (!pick) return null;
  return shape(pick.cd, pick.priceMultiplier, pick.plan.options[0].frequency, pick.plan);
}

/**
 * Restructuring (smart-rival worlds): the carrier keeps the routes that make
 * money — at least MIN_ROUTES of its best — and loses the rest with their
 * aircraft and any on order for them. Its cash is reset to its reserve (debt
 * swapped for equity), and it flies on cheaper contracts for
 * RESTRUCTURE_RELIEF_WEEKS. Its service takes a knock. Once only: the flag
 * stays, and the next failure closes it.
 */
function restructureCarrier(c, { month, incumbents, world, weekNumber, lines }) {
  const ranked = Object.keys(c.routes ?? {})
    .map(key => ({ key, profit: computeCompetitorRoutePnL(c, key, c.routes[key], month, incumbents, world)?.profit ?? -Infinity }))
    .sort((x, y) => y.profit - x.profit);
  const keep = new Set(ranked.filter((r, i) => i < MIN_ROUTES || r.profit > 0).map(r => r.key));
  const routes = {};
  for (const key of keep) routes[key] = c.routes[key];
  const gone = (key) => key != null && !String(key).startsWith('cargo:') && !keep.has(key);
  const plans = (c.linePlans ?? []).filter(p => {
    if (!gone(p.routeKey)) return true;
    if (lines) lines.remove(p.lineId, (p.weeks ?? []).filter(w => w >= lines.absWeek));
    return false;
  });
  const { fireSale: _fs, _fareWars: _fw, _mktBlitz: _mb, ...rest } = c;
  const floor = QUALITY_FLOOR[c.tier] ?? 48;
  return {
    dropped: ranked.length - keep.size,
    carrier: {
      ...rest,
      routes,
      fleet: (c.fleet ?? []).filter(f => !gone(f.routeKey)),
      ...(c.linePlans ? { linePlans: plans } : {}),
      cash: CASH_RESERVE[c.tier] ?? 8_000_000,
      fireSale: false,
      _distressWeeks: 0,
      _routeLoss: {},
      _restructured: weekNumber,
      costRelief: RESTRUCTURE_COST_RELIEF,
      _reliefUntil: weekNumber + RESTRUCTURE_RELIEF_WEEKS,
      baseQualityScore: Math.max(floor, (c.baseQualityScore ?? 60) - RESTRUCTURE_QUALITY_HIT),
    },
  };
}

/** A failed carrier's airframes, for the liquidation sale: [{ typeId, ageWeeks }], youngest first. */
function liquidationFleetOf(c) {
  return (c.fleet ?? [])
    .filter(f => f?.typeId && getAircraftType(f.typeId))
    .map(f => ({ typeId: f.typeId, ageWeeks: f.ageWeeks ?? 0 }))
    .sort((x, y) => x.ageWeeks - y.ageWeeks)
    .slice(0, LIQUIDATION_MAX_AIRFRAMES);
}

/** Pair keys a carrier's rival set lists (models/rivalSets.js `routes`). */
function listedKeysOf(airline) {
  return new Set((airline.setSpec?.routes ?? []).map(r => {
    const [a, b] = String(r).split('-');
    return pairKeyOf(a, b);
  }));
}

/**
 * The first route the carrier's rival set lists that it is not flying (or
 * waiting on frames for) and could now fly — nonstop, or through one
 * refuelling stop. Routes it withdrew for losses rest LISTED_RETRY_WEEKS
 * first. Sized and priced like any expansion. Null when there is none.
 */
function pickListedRoute(airline, network, { weekNumber, playerPairs }) {
  const listed = airline.setSpec?.routes;
  if (!listed?.length) return null;
  for (const pair of listed) {
    const [a, b] = String(pair).split('-');
    const key = pairKeyOf(a, b);
    if (network[key]) continue;
    if ((airline._listedRetry?.[key] ?? 0) > weekNumber) continue;
    const dist = routeDistance(a, b);
    if (!dist) continue;
    let via = null, legKm = dist, stopShare = 1;
    if (!pickCompetitorAircraftType(dist, airline.tier, airline.fleetPref)) {
      const [x, y] = key.split('-');
      const stop = findRefuelStop(x, y, { home: getAirport(airline.homeHub)?.country ?? null });
      if (!stop || !pickCompetitorAircraftType(Math.max(...stop.legsKm), airline.tier, airline.fleetPref)) continue;
      via = stop.via; legKm = Math.max(...stop.legsKm); stopShare = techStopDemandShare(x, via, y);
    }
    const demand = (baseCityPairDemand(a, b) || 0) * marketDevFor(a, b) * stopShare;
    const seatsTarget = { budget: 160, legacy: 250, premium: 330 }[airline.tier] ?? 200;
    const frequency = Math.max(3, Math.min(21, Math.round(demand / (seatsTarget * 0.75))));
    const priceMultiplier = +((TIER_PRICE_MULT[airline.tier] ?? 1.0) * (0.97 + Math.random() * 0.06)).toFixed(3);
    return { key, dist, legKm, frequency, priceMultiplier, onPlayerPair: playerPairs.has(key), listed: true,
             ...(via ? { via } : {}) };
  }
  return null;
}

/** The news a launch makes: whose market it hits, a stop if it makes one, a set's goal reached. */
function launchEvent(c, cand, a, b) {
  const stop = cand.via ? `, stopping at ${cand.via} to refuel` : '';
  const description = cand.onPlayerPair
    ? `${c.name} launched ${a} → ${b}${stop} — moving in on your market.`
    : cand.listed
      ? `${c.name} launched ${a} → ${b}${stop} — a route it has been waiting to fly.`
      : `${c.name} launched new service on ${a} → ${b}${stop}.`;
  return { type: 'launch', airlineId: c.id, name: c.name, routeKey: cand.key,
           attackedPlayer: cand.onPlayerPair, ...(cand.via ? { via: cand.via } : {}), description };
}

// ─── Acquisition pricing ────────────────────────────────────────────────
//
// ONE source of truth for what a carrier costs, shared by the Competition list,
// the acquisition modal and the ACQUIRE_COMPETITOR reducer. They used to compute
// it separately, which is how a deal that handed the buyer more cash than it cost
// shipped without anything flagging it.

/**
 * Break-up value of a competitor's fleet — depreciated airframe value across
 * every tail it owns. Competitor tails carry no maintenance state, so this is
 * the straight NAV (purchase price × remaining value) without the maintenance
 * modifier the player's own fleet gets.
 */
export function competitorFleetNAV(carrier) {
  return (carrier?.fleet ?? []).reduce((sum, tail) => {
    const type = getAircraftType(tail.typeId);
    if (!type) return sum;
    return sum + (type.purchasePrice ?? 0) * valueRemaining(tail.ageWeeks, type);
  }, 0);
}

/**
 * What it costs to acquire a carrier, and why.
 *
 * price = max(market cap × premium, net cash + a slice of fleet break-up value)
 *
 * The floor is what stops the "buy a $500K company, pocket its $67M" trade: the
 * buyer inherits the target's cash and fleet, so the price can never sit below
 * what those are worth. For a healthy carrier the market-cap leg is far higher
 * and the floor never binds — nothing about a normal takeover changes.
 *
 * @returns {{ price, marketCapPrice, floorPrice, floorBinds, premium, cash,
 *             fleetNAV, haircut } | null}  null when the carrier has no valuation yet.
 */
export function acquisitionQuote(carrier) {
  if (!carrier || carrier.marketCap == null) return null;
  const fireSale = !!carrier.fireSale;
  const premium  = fireSale ? FIRE_SALE_PREMIUM : ACQUISITION_PREMIUM;
  const cash     = carrier.cash ?? 0;
  const fleetNAV = competitorFleetNAV(carrier);
  // The floor is liquidation value and does not flex with distress — a fire sale
  // discounts the BUSINESS, not the airframes. (Cheap metal would just be resold.)
  const haircut  = FLEET_FLOOR_HAIRCUT;

  const marketCapPrice = Math.round(carrier.marketCap * premium);
  // Negative cash (a carrier in the red) legitimately pulls the floor down — the
  // buyer is assuming that hole. Never below zero, though.
  const floorPrice     = Math.max(0, Math.round(cash + fleetNAV * haircut));
  const price          = Math.max(marketCapPrice, floorPrice);

  return {
    price, marketCapPrice, floorPrice,
    floorBinds: floorPrice > marketCapPrice,
    premium, cash, fleetNAV, haircut,
  };
}

/** Convenience: just the number. Returns null when the carrier isn't valued yet. */
export function acquisitionPrice(carrier) {
  return acquisitionQuote(carrier)?.price ?? null;
}
