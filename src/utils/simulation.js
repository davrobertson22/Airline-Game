import { getAirport, gateMonthlyFee, totalGateMonthlyFee } from '../data/airports.js';
import { getAircraftType, fuelCostPerKm } from '../data/aircraft.js';
export { baseCityPairDemand } from './market.js';
import { LABOR_GROUPS, laborEffects } from '../data/labor.js';
import { weeklyFamilyBaseCost, activeFamilies, FAMILY_INFO } from '../data/families.js';
import {
  calcHQCost,
  weeklyInsuranceCost,
  weeklyLandingFee,
  marketingDemandMultiplier,
  weeklyLayoverCost,
  weeklyPassengerCompensation,
  weeklyGroundHandlingCost,
  weeklyLoungeCost,
  DISTRIBUTION_COST_PCT,
} from '../data/overhead.js';
import { routeCatering, cateringQualityBonus, normalizeCateringLevel } from '../data/catering.js';
import {
  buildRouteMarket,
  computeMarketShare,
  computeQualityScore,
  buildCompetitorOffer,
  routeMaturityFactor,
  COMPETITOR_AIRLINES,
  computeConnectingDemand,
  HUB_TIERS,
} from '../models/demand.js';
import {
  ALLIANCES,
  getAlliance,
  partnerInterlineRevenue,
} from '../data/alliances.js';
import { runNetworkTick } from '../models/network.js';

// ─────────────────────────────────────────────
// DISTANCE
// ─────────────────────────────────────────────

/** Haversine distance between two lat/lon points, in km */
export function distanceKm(a, b) {
  const R = 6371;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const sinLat = Math.sin(dLat / 2);
  const sinLon = Math.sin(dLon / 2);
  const x = sinLat * sinLat + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * sinLon * sinLon;
  return R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}
function toRad(d) { return d * Math.PI / 180; }

// ─────────────────────────────────────────────
// DEMAND MODEL
// ─────────────────────────────────────────────

/**
 * Market reference price for a route ($ one-way, economy).
 * Players can price above or below this — demand adjusts via elasticity.
 */
export function referencePrice(originCode, destCode) {
  const o = getAirport(originCode);
  const d = getAirport(destCode);
  if (!o || !d) return 200;
  const dist = distanceKm(o, d);
  return Math.round(80 + dist * 0.09);
}

// ─────────────────────────────────────────────
// CABIN CLASS CONSTANTS
// ─────────────────────────────────────────────

/**
 * How each passenger segment distributes across cabin classes, varying by route distance.
 *
 * Short-haul  (<1,500 km): first class barely exists; economy dominates even for business.
 * Medium-haul (1,500–5,000 km): moderate premium mix; some first class for business.
 * Long-haul   (>5,000 km): full premium mix; first class meaningful for business travelers.
 *
 * Each row sums to 1.0.
 */
export const SEGMENT_CABIN_PREFS = {
  short: {
    business: { firstClass: 0.02, businessClass: 0.40, premiumEconomy: 0.30, economy: 0.28 },
    leisure:  { firstClass: 0.00, businessClass: 0.03, premiumEconomy: 0.15, economy: 0.82 },
  },
  medium: {
    business: { firstClass: 0.08, businessClass: 0.50, premiumEconomy: 0.25, economy: 0.17 },
    leisure:  { firstClass: 0.01, businessClass: 0.05, premiumEconomy: 0.20, economy: 0.74 },
  },
  long: {
    business: { firstClass: 0.20, businessClass: 0.50, premiumEconomy: 0.20, economy: 0.10 },
    leisure:  { firstClass: 0.02, businessClass: 0.10, premiumEconomy: 0.28, economy: 0.60 },
  },
};

/**
 * Return the correct SEGMENT_CABIN_PREFS tier for a given route distance.
 * @param {number} distKm
 * @returns {{ business: object, leisure: object }}
 */
export function getSegmentCabinPrefs(distKm) {
  if (distKm < 1500) return SEGMENT_CABIN_PREFS.short;
  if (distKm < 5000) return SEGMENT_CABIN_PREFS.medium;
  return SEGMENT_CABIN_PREFS.long;
}

// Fare multiplier relative to the economy (base) ticket price.
// These represent the DEFAULT prices set when a route is created and the
// market equilibrium the demand model uses as a reference.
// Real-world benchmarks (short/medium haul):
//   First:    ~5× (lie-flat suite — long-haul only, modest yield on short routes)
//   Business: ~2.5× (lie-flat or angled flat — realistic for short/medium haul)
//   Prem Eco: ~1.4× (extra legroom, separate cabin)
export const CLASS_FARE_MULTIPLIERS = {
  firstClass:     5.0,
  businessClass:  2.5,
  premiumEconomy: 1.4,
  economy:        1.0,
};

// How many economy-equivalent seat units each class occupies.
// A 737 has 162 "seat units" — premium classes take more floor space.
//   First class (lie-flat + suite) = 2.0 units
//   Business class (angled/full-flat) = 1.5 units
//   Premium economy (extra pitch/width) = 1.25 units
//   Economy = 1.0 units (baseline)
export const CLASS_SPACE_MULTIPLIERS = {
  firstClass:     2.00,
  businessClass:  1.50,
  premiumEconomy: 1.25,
  economy:        1.00,
};

// ─── Cabin density dynamics ───────────────────────────────────────────────────
//
// Two real effects flow from how densely a cabin is configured:
//   1. PAYLOAD → RANGE. Fewer/heavier-spaced passengers mean less payload weight,
//      so the aircraft can trade that weight for fuel and fly further. A densest
//      all-economy cabin is the baseline (no bonus); a light cabin gains range.
//   2. EMPTY FLOOR → COMFORT. Floor space you deliberately leave unfilled becomes
//      extra room per passenger, raising perceived quality (but you sell fewer seats).

/** Max range bonus when the cabin carries (almost) no payload.
 *  Passengers are only ~12–15% of a jet's max takeoff weight, so trading payload
 *  for fuel on a fixed airframe realistically buys ~10–15% range — not more. (The
 *  real A350 ULR's bigger gain comes from added fuel tankage, which we don't model.) */
export const CONFIG_RANGE_GAIN_MAX = 0.15;     // up to +15% range
/** Max quality points awarded for an entirely empty (impossibly spacious) floor. */
export const CONFIG_SPACE_QUALITY_MAX = 14;

/** Economy-equivalent seat units consumed by a cabin config. */
export function configSeatUnits(config) {
  return (config.firstClass     ?? 0) * CLASS_SPACE_MULTIPLIERS.firstClass
       + (config.businessClass  ?? 0) * CLASS_SPACE_MULTIPLIERS.businessClass
       + (config.premiumEconomy ?? 0) * CLASS_SPACE_MULTIPLIERS.premiumEconomy
       + (config.economy        ?? 0) * CLASS_SPACE_MULTIPLIERS.economy;
}

/** Total physical passengers (bodies) a cabin config seats. */
export function configBodies(config) {
  return (config.firstClass ?? 0) + (config.businessClass ?? 0)
       + (config.premiumEconomy ?? 0) + (config.economy ?? 0);
}

/**
 * Range multiplier from cabin payload. Densest all-economy = 1.0 (baseline);
 * lighter cabins (premium-heavy or partly empty) extend range up to +CONFIG_RANGE_GAIN_MAX.
 */
export function configRangeMod(config, type) {
  const maxBodies = type?.seats ?? 0;
  if (!maxBodies) return 1;
  const frac = Math.max(0, Math.min(1, configBodies(config) / maxBodies));
  return 1 + CONFIG_RANGE_GAIN_MAX * (1 - frac);
}

/** Quality points from floor space left deliberately empty (extra room per pax). */
export function configSpaceQualityBonus(config, type) {
  const maxUnits = type?.seats ?? 0;
  if (!maxUnits) return 0;
  const emptyFrac = Math.max(0, 1 - configSeatUnits(config) / maxUnits);
  return Math.round(emptyFrac * CONFIG_SPACE_QUALITY_MAX);
}

/** Full effective range (km): manufacturer range × engine/wingtip mod × cabin-payload mod. */
export function effectiveRangeKm(aircraft, type) {
  const config = aircraft.config ?? defaultConfig(type.seats);
  return Math.round(type.range * (aircraft.rangeMod ?? 1.0) * configRangeMod(config, type));
}

// ─────────────────────────────────────────────
// QUALITY CONSTANTS
// ─────────────────────────────────────────────

// Demand boost from seat quality
export const SEAT_QUALITY_DEMAND = {
  basic:    0.85,
  standard: 1.00,
  premium:  1.20,
  luxury:   1.40,
};

// Demand boost from service quality
export const SERVICE_QUALITY_DEMAND = {
  basic:    0.90,
  standard: 1.00,
  premium:  1.15,
  luxury:   1.30,
};

// Extra weekly operating cost per route from quality settings
export const SEAT_QUALITY_COST_PER_ROUTE = {
  basic:    0,
  standard: 0,
  premium:  500,
  luxury:   2_000,
};
export const SERVICE_QUALITY_COST_PER_ROUTE = {
  basic:    0,
  standard: 0,
  premium:  1_000,
  luxury:   3_500,
};

// ─────────────────────────────────────────────
// AIRCRAFT UTILIZATION & GATE LIMITS
// ─────────────────────────────────────────────

/** Hard cap: an aircraft cannot fly more than this many block-hours per week. */
export const MAX_WEEKLY_BLOCK_HOURS = 140;

/** Slot capacity of a single gate per week (departures from that airport). */
export const SLOTS_PER_GATE = 50;

// Average cruise speed by aircraft category (km/h)
const CRUISE_SPEED_KMH = {
  'Turboprop':    500,
  'Regional Jet': 800,
  'Narrow Body':  840,
  'Wide Body':    870,
  'Double Deck':  870,
  'Supersonic':   2180,  // Concorde cruise ~Mach 2.02
};

// Ground turnaround time by category (hours)
const TURNAROUND_HOURS = {
  'Turboprop':    0.50,   // 30 min
  'Regional Jet': 0.67,   // 40 min
  'Narrow Body':  0.83,   // 50 min
  'Wide Body':    1.50,   // 90 min
  'Double Deck':  2.00,   // 120 min — two boarding doors, complex deplaning
  'Supersonic':   2.00,   // 120 min — complex servicing
};

/**
 * Block time for one sector (hours).
 * = flight time in the air + turnaround on the ground.
 *
 * @param {number} distKm
 * @param {object} type  - aircraft type from AIRCRAFT_TYPES
 */
export function blockTimeHours(distKm, type) {
  const speed      = CRUISE_SPEED_KMH[type.category] ?? 840;
  const turnaround = TURNAROUND_HOURS[type.category] ?? 0.75;
  return distKm / speed + turnaround;
}

/**
 * Total weekly block-hours consumed by an aircraft on a route (both directions).
 * Must be ≤ MAX_WEEKLY_BLOCK_HOURS.
 */
export function weeklyBlockHours(distKm, weeklyFrequency, type) {
  return blockTimeHours(distKm, type) * weeklyFrequency * 2;
}

/**
 * Maximum weekly frequency that keeps block-hours within the 140h cap.
 */
export function maxFrequency(distKm, type) {
  const bt = blockTimeHours(distKm, type);
  return bt > 0 ? Math.floor(MAX_WEEKLY_BLOCK_HOURS / (bt * 2)) : 0;
}

/**
 * Distance in km between two airport IATA codes.
 * Returns 0 if either code is unknown.
 */
export function routeDistanceKm(originCode, destCode) {
  const o = getAirport(originCode);
  const d = getAirport(destCode);
  return o && d ? Math.round(distanceKm(o, d)) : 0;
}

// ─────────────────────────────────────────────
// AIRCRAFT AGING
// ─────────────────────────────────────────────

/**
 * Maintenance cost multiplier based on aircraft age.
 * At 0 weeks: 1.0×  |  10 years: ~1.5×  |  20 years: ~3.0×
 */
export function maintenanceMultiplier(ageWeeks) {
  const ageYears = (ageWeeks ?? 0) / 52;
  return 1 + Math.pow(ageYears / 20, 2) * 2;
}

/**
 * Game calendar: 52 weeks/year.
 * Jan/Mar/Jul/Oct = 5 weeks; all others = 4 weeks.
 *   Jan  1-5   Feb  6-9   Mar 10-14  Apr 15-18
 *   May 19-22  Jun 23-26  Jul 27-31  Aug 32-35
 *   Sep 36-39  Oct 40-44  Nov 45-48  Dec 49-52
 */
const MONTH_STARTS = [1, 6, 10, 15, 19, 23, 27, 32, 36, 40, 45, 49];
const MONTH_NAMES  = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

/**
 * Map game week (1-52) to { monthIndex (1-12), monthName, weekInMonth }.
 */
export function weekToGameDate(week) {
  const w = Math.max(1, Math.min(52, week));
  let mi = 11; // 0-indexed month
  for (let i = 0; i < 12; i++) {
    if (w < (MONTH_STARTS[i + 1] ?? 53)) { mi = i; break; }
  }
  return {
    monthIndex:   mi + 1,
    monthName:    MONTH_NAMES[mi],
    weekInMonth:  w - MONTH_STARTS[mi] + 1,
  };
}

/**
 * Format game state as "Week N Mon Year Y".
 */
export function formatGameDate(state) {
  const { monthName, weekInMonth } = weekToGameDate(state.week);
  return `Week ${weekInMonth} ${monthName} Year ${state.year}`;
}

/**
 * Derive the current game date object from game state.
 * month is 1-indexed (1 = Jan, 12 = Dec).
 */
export function currentGameDate(state) {
  const { monthIndex } = weekToGameDate(state.week);
  return { week: state.week, month: monthIndex };
}

export function ageLabel(ageWeeks) {
  const y = Math.floor((ageWeeks ?? 0) / 52);
  const w = Math.floor((ageWeeks ?? 0) % 52);
  return y > 0 ? `${y}y ${w}w` : `${w}w`;
}

// ─────────────────────────────────────────────
// ROUTE SIMULATION
// ─────────────────────────────────────────────

/**
 * Default cabin configuration for an aircraft type.
 * All seats in economy by default.
 */
export function defaultConfig(totalSeats) {
  return {
    firstClass:     0,
    businessClass:  0,
    premiumEconomy: 0,
    economy:        totalSeats,
    seatQuality:    'standard',
    serviceQuality: 'standard',
  };
}

/**
 * Simulate one week of a route.
 *
 * Demand is computed via the rich demand model in demand.js:
 *   buildRouteMarket → AirlineOffer → computeMarketShare
 * Competitors array is empty for now; the player is always a monopolist.
 *
 * @param {object} route    - { origin, destination, aircraftId, weeklyFrequency,
 *                             ticketPrice, hub?, weeksOpen?, qualityScore? }
 * @param {object} aircraft - fleet aircraft (has .typeId, .ageWeeks, .config)
 * @param {object} [gameDate={ month: 6 }] - { week, month } — month is 1-indexed
 * @returns {object|null}
 */
export function simulateRoute(route, aircraft, gameDate = { month: 6 }, labor = null, fuelMultiplier = 1.0) {
  const origin = getAirport(route.origin);
  const dest   = getAirport(route.destination);
  const type   = getAircraftType(aircraft.typeId);
  if (!origin || !dest || !type) return null;

  // Cabin config (fall back to all-economy if not configured)
  const config = aircraft.config ?? defaultConfig(type.seats);

  const dist = distanceKm(origin, dest);
  // Effective range includes the cabin-payload bonus: a lighter cabin flies further.
  const effectiveRange = effectiveRangeKm(aircraft, type);
  if (dist > effectiveRange) return null;

  // Derive a qualityScore for the demand model from the route's service settings.
  // serviceLevel maps seat quality → demand.js tier names.
  const serviceLevelMap = { basic: 'economy', standard: 'economy', premium: 'premium', luxury: 'business' };

  // Labor morale feeds into quality inputs — pilots → on-time rate, cabin crew → customer rating,
  // ground staff → small quality bonus/penalty applied after scoring.
  const { onTimeRate, customerRating, groundQualityBonus } = laborEffects(labor);

  const rawQualityScore = route.qualityScore ?? computeQualityScore({
    onTimeRate,
    serviceLevel:   serviceLevelMap[config.seatQuality ?? 'standard'] ?? 'economy',
    fleetAgeYears:  (aircraft.ageWeeks ?? 0) / 52,
    customerRating,
  });
  // Space bonus: floor left empty (lower density) gives passengers more room.
  const spaceQualityBonus = configSpaceQualityBonus(config, type);
  // Catering quality: the route's catering level moves perceived quality up or
  // down, amplified by distance (food matters more on long flights). Stacks with
  // the per-aircraft service quality already baked into rawQualityScore.
  const cateringLevel    = normalizeCateringLevel(route.cateringLevel);
  const cateringQuality  = cateringQualityBonus(cateringLevel, dist);
  // Hub quality bonus: routes through a player-designated hub get a quality boost from hub investment
  const qualityScore = Math.max(0, Math.min(100, rawQualityScore + groundQualityBonus + spaceQualityBonus + cateringQuality + (route.hubQualityBonus ?? 0)));

  // Hub connectivity bonus (mirrors old hubBonus but expressed as 0–0.25 for the utility model)
  const connectivityBonus = (route.origin === route.hub || route.destination === route.hub) ? 0.20 : 0;

  // Build market and player offer, then run through demand model
  const maturity     = route.weeksOpen != null ? routeMaturityFactor(route.weeksOpen) : 1;
  const market       = buildRouteMarket(route.origin, route.destination, gameDate, maturity);
  // Resolve per-class prices: use route.classPrices when set, fall back to ticketPrice × multiplier
  const cp = route.classPrices ?? {};
  // Supersonic aircraft (e.g. Concorde) command a ticket premium.
  // Applying it here — before the demand model — means higher prices feed through
  // elasticity to reduce demand, while revenue per passenger is also higher.
  const ticketPremium  = type.ticketPremium ?? 1;
  // Clamp to a positive fare: a 0/negative/NaN price would feed Math.pow(ref/price,…)
  // in the elasticity model and yield Infinity/NaN, which cascades into NaN cash and
  // permanently corrupts the save. Reducer actions also clamp, but guard here too.
  const economyPrice   = Math.max(1, (cp.economy ?? route.ticketPrice ?? 1) * ticketPremium);
  const businessPrice  = cp.businessClass  != null ? Math.max(1, cp.businessClass * ticketPremium) : null;

  // Economy capacity = economy-only seats × frequency (not total seats, which includes premium cabins)
  const economySeats = (config.economy ?? type.seats) * route.weeklyFrequency;

  const playerOffer = {
    airlineId:         'player',
    origin:            route.origin,
    destination:       route.destination,
    economyPrice,
    businessPrice,
    weeklyFrequency:   route.weeklyFrequency,
    seatsPerFlight:    type.seats,
    economySeats,
    businessSeats:     (config.businessClass ?? 0) * route.weeklyFrequency,
    qualityScore,
    connectivityBonus,
  };

  // Gather any AI competitors serving this route and compute market share
  const competitorOffers = COMPETITOR_AIRLINES
    .map(c => buildCompetitorOffer(c, market))
    .filter(Boolean);
  const allOffers = [playerOffer, ...competitorOffers];
  const shareResults = computeMarketShare(market, allOffers);
  const [demandResult] = shareResults; // player is always first

  // Fan leisure/business pax across cabin classes using segment preferences.
  // Premium classes are filled first; any demand that can't find a premium seat
  // spills down into economy (passengers downgrade rather than not fly).
  const { leisurePax, businessPax } = demandResult; // one-way totals
  // Capacity reflects the REAL configured seat count (premium cabins + any empty
  // floor reduce it below the aircraft's max economy-equivalent units).
  const totalCapOneWay = configBodies(config) * route.weeklyFrequency;
  let totalRevenue     = 0;
  let totalPaxOneWay   = 0;
  const classSummary   = {};
  let spilledToEconomy = 0; // unserved premium demand that falls through to economy

  const cabinPrefs  = getSegmentCabinPrefs(market.distanceKm);
  const CABIN_ORDER = ['firstClass', 'businessClass', 'premiumEconomy', 'economy'];
  for (const cls of CABIN_ORDER) {
    const seatsThisClass = config[cls] ?? 0;
    const capOneWay      = seatsThisClass * route.weeklyFrequency;

    const preferredDemand = Math.round(
      businessPax * (cabinPrefs.business[cls] ?? 0) +
      leisurePax  * (cabinPrefs.leisure[cls]  ?? 0)
    );

    // Economy also absorbs spill from premium classes that had no seats
    const effectiveDemand = cls === 'economy'
      ? preferredDemand + spilledToEconomy
      : preferredDemand;

    const paxOneWay  = Math.min(effectiveDemand, capOneWay);
    const unsatisfied = effectiveDemand - paxOneWay;

    // Demand that couldn't be served in this premium class spills to economy
    if (cls !== 'economy') spilledToEconomy += unsatisfied;

    // Use per-class price if explicitly set by the player, scaled by any supersonic
    // ticket premium.  Without explicit pricing, premium cabin passengers pay the
    // economy fare (already premium-adjusted above).
    const fare = cp[cls] != null ? cp[cls] * ticketPremium : economyPrice;
    // Revenue = both directions (paxOneWay × 2 × fare); passengers stored one-way.
    const clsRevenue = paxOneWay * 2 * fare;

    totalPaxOneWay += paxOneWay;
    totalRevenue   += clsRevenue;
    classSummary[cls] = {
      seats:      seatsThisClass,
      passengers: paxOneWay,   // one-way pax (per direction); multiply ×2 for total boarded
      revenue:    Math.round(clsRevenue),
      loadFactor: capOneWay > 0 ? paxOneWay / capOneWay : 0,
    };
  }

  // Upward spill: economy-overflow passengers fill empty premium seats at economy fare.
  // This happens when premium preference demand is less than premium capacity but
  // economy demand exceeds economy seats — passengers get involuntary upgrades.
  // Without this, LF is artificially capped below 100% even when demand > capacity.
  const maxFillable = Math.min(leisurePax + businessPax, totalCapOneWay);
  if (totalPaxOneWay < maxFillable) {
    let upgradeRemaining = maxFillable - totalPaxOneWay;
    for (const cls of ['premiumEconomy', 'businessClass', 'firstClass']) {
      if (upgradeRemaining <= 0) break;
      const seatsThisClass = config[cls] ?? 0;
      const capOneWay      = seatsThisClass * route.weeklyFrequency;
      const usedOneWay     = classSummary[cls]?.passengers ?? 0;  // already one-way
      const emptyOneWay    = capOneWay - usedOneWay;
      if (emptyOneWay <= 0) continue;
      const upgrades = Math.min(upgradeRemaining, emptyOneWay);
      const upgradeRev = Math.round(upgrades * 2 * economyPrice);
      classSummary[cls].passengers += upgrades;  // store one-way
      classSummary[cls].revenue    += upgradeRev;
      classSummary[cls].loadFactor  = capOneWay > 0 ? (usedOneWay + upgrades) / capOneWay : 0;
      totalPaxOneWay += upgrades;
      totalRevenue   += upgradeRev;
      upgradeRemaining -= upgrades;
    }
  }

  const loadFactor = totalCapOneWay > 0 ? totalPaxOneWay / totalCapOneWay : 0;

  // Operating costs
  const flights     = route.weeklyFrequency * 2;
  const aircraftFuelMod = aircraft.fuelMod ?? 1.0;  // from engine/wingtip config at order time
  const fuelCost    = Math.round(dist * fuelCostPerKm(type) * flights * fuelMultiplier * aircraftFuelMod);
  const crewCost    = Math.round(dist * type.crewCostPerKm * flights);
  const qualityCost =
    (SEAT_QUALITY_COST_PER_ROUTE[config.seatQuality ?? 'standard'] ?? 0) +
    (SERVICE_QUALITY_COST_PER_ROUTE[config.serviceQuality ?? 'standard'] ?? 0);

  // Catering — driven by the route's chosen service level. Cost AND ancillary
  // revenue both scale with distance; revenue only on the paid/hybrid levels.
  const catering        = routeCatering(cateringLevel, classSummary, dist);
  const cateringCost    = catering.cost;
  const cateringRevenue = catering.revenue;
  // Ancillary catering income folds straight into route revenue.
  totalRevenue += cateringRevenue;

  // Ground handling — ramp, baggage, gate agents, pushback; per boarded passenger
  const groundHandlingCost = weeklyGroundHandlingCost(classSummary);

  // Crew layover — when one-way block time > 4 hours
  const blockTimeOneWay = blockTimeHours(dist, type);
  const layoverCost = weeklyLayoverCost(blockTimeOneWay, type.seats, type.category, route.weeklyFrequency);

  // Passenger compensation — tied to pilot on-time rate (from morale)
  // Compensation applies to all boarded passengers (both directions = ×2).
  const compensationCost = weeklyPassengerCompensation(totalPaxOneWay * 2, onTimeRate, dist);

  // Lounge & premium ground service — airport lounge access, fast-track security,
  // dedicated check-in for business/first pax. Per-passenger, both directions.
  const loungeCost = weeklyLoungeCost(classSummary);

  const totalOpCost = fuelCost + crewCost + qualityCost + cateringCost + groundHandlingCost + layoverCost + compensationCost + loungeCost;

  return {
    revenue:      Math.round(totalRevenue),
    fuelCost,
    crewCost,
    qualityCost,
    cateringCost,
    cateringRevenue,
    cateringLevel,
    cateringQuality,
    cateringByClass: catering.byClass,
    groundHandlingCost,
    loungeCost,
    layoverCost,
    compensationCost,
    totalOpCost,
    profit:       Math.round(totalRevenue - totalOpCost),
    passengers:        totalPaxOneWay,  // one-way pax (per direction); revenue already covers both directions
    configuredSeatsOneWay: totalCapOneWay, // configured cabin seats × frequency (excludes unassigned physical seats)
    loadFactor,
    distance:     Math.round(dist),
    classSummary,
    // Demand model context (for UI / debugging)
    marketDemand:    market.leisureDemand + market.businessDemand,
    seasonality:     market.seasonalityFactor,
    competitorCount: competitorOffers.length,
    capacityCapped:  demandResult.capacityCapped,
    ticketPremium,   // >1 for supersonic aircraft (e.g. Concorde = 2.5)
  };
}

// ─────────────────────────────────────────────
// WEEKLY TICK
// ─────────────────────────────────────────────

/**
 * Advances the game one week. Returns a full financial report.
 *
 * @param {object} state - { fleet, routes, gameDate? }
 *   gameDate: { week, month } — month 1-indexed. Defaults to { month: 6 } if absent.
 */
export function weeklyTick(state) {
  const {
    fleet, routes, gameDate = { month: 6 }, gates = {}, labor,
    maintenanceBudget = 1.0, fuelMultiplier = 1.0,
    marketingBudget = 0,
    loyalty = { weeklyInvestment: 0, members: 0 },
    awareness = 5,
  } = state;

  // Awareness multiplier: new/unknown airlines attract only a fraction of potential demand.
  // Range 0.4 (awareness=0, brand unknown) → 1.0 (awareness=100, household name).
  const awarenessMultiplier = 0.4 + (awareness / 100) * 0.6;

  // ── Alliance / codeshare setup ────────────────────────────────────────────
  const allianceMembership  = state.allianceMembership  ?? null;
  const codeshareAgreements = state.codeshareAgreements ?? [];
  const competitors         = state.competitors         ?? [];

  // Build set of airports the player serves (for interline adjacency)
  const servedAirports = new Set();
  for (const r of routes) {
    servedAirports.add(r.origin);
    servedAirports.add(r.destination);
  }

  // IDs of alliance and codeshare partners
  const allianceDef         = allianceMembership ? getAlliance(allianceMembership.allianceId) : null;
  const alliancePartnerIds  = allianceDef?.memberIds ?? [];
  const codesharePartnerIds = codeshareAgreements.map(a => a.competitorId);
  const allPartnerIds       = new Set([...alliancePartnerIds, ...codesharePartnerIds]);

  // One entry per partner (duplicates allowed when multiple partners share a hub airport)
  // — used to boost external connecting feed at airports where partners operate
  const partnerHubCodes = [];
  for (const partnerId of allPartnerIds) {
    const comp = competitors.find(c => c.id === partnerId);
    if (comp?.homeHub) partnerHubCodes.push(comp.homeHub);
  }

  // ── Network O&D cannibalization ───────────────────────────────────────────
  // Run the full network tick: enumerates 1-stop connections, applies logit
  // diversion when a direct route competes, computes O&D-based partner revenue.
  const networkTick = runNetworkTick({
    routes,
    competitors,
    allianceMembership,
    codeshareAgreements,
    allianceDef,
  });
  const { cannibalizationMap, partnerODRevenue, partnerHealthDecay } = networkTick;

  // Pre-build set of route-keys where an alliance/codeshare partner also operates
  const partnerContestedKeys = new Set();
  for (const comp of competitors) {
    if (!allPartnerIds.has(comp.id)) continue;
    for (const key of Object.keys(comp.routes ?? {})) {
      partnerContestedKeys.add(key);
    }
  }

  // Demand boost on routes where an alliance partner competes (codeshare partners don't stack)
  const allianceDemandBoostPct = allianceDef?.demandBoostPct ?? 0;

  // Loyalty demand effect: members are less price-sensitive, so the player
  // retains more of them even when competitors undercut. Model as a small
  // demand multiplier proportional to member penetration.
  // At 10k members → ~2% boost; at 100k → ~8% boost; capped at 12%.
  const loyaltyMembers      = loyalty?.members ?? 0;
  const loyaltyDemandBoost  = Math.min(0.12, loyaltyMembers / 1_200_000);
  const loyaltyMultiplier   = 1 + loyaltyDemandBoost;

  // Pre-compute marketing multiplier (needs an initial revenue pass — use last week's revenue
  // if available, otherwise estimate from current routes without multiplier applied yet)
  const lastRevenue = state.financialHistory?.length
    ? state.financialHistory[state.financialHistory.length - 1]?.revenue ?? 0
    : 0;
  const mktMultiplier = marketingDemandMultiplier(marketingBudget, Math.max(lastRevenue, 1));

  // 1. Route revenue + operating costs
  let totalRevenue        = 0;
  let totalConnecting     = 0;
  let totalFuel           = 0;
  let totalCrew           = 0;
  let totalQuality        = 0;
  let totalCatering       = 0;   // catering COST
  let totalCateringRevenue = 0;  // ancillary catering REVENUE
  let totalGroundHandling = 0;
  let totalLounge         = 0;
  let totalLayover        = 0;
  let totalCompensation   = 0;
  let totalLandingFees    = 0;
  let totalPassengers     = 0;
  const routeResults    = [];

  // Pre-count how many routes the player has at each airport (for hub feed bonus)
  const routeCountByAirport = {};
  for (const r of routes) {
    routeCountByAirport[r.origin]      = (routeCountByAirport[r.origin]      ?? 0) + 1;
    routeCountByAirport[r.destination] = (routeCountByAirport[r.destination] ?? 0) + 1;
  }

  // Build the hubs map, with backward-compat for saves that only have state.hub (a string)
  const hubs = state.hubs ?? (state.hub ? { [state.hub]: { tier: 1 } } : {});

  for (const route of routes) {
    const aircraft = fleet.find(a => a.id === route.aircraftId);
    if (!aircraft) continue;
    if (aircraft.status === 'grounded') continue; // mechanical failure — no revenue this week

    // Inject hub quality bonus from the best hub on this route
    const originTier  = hubs[route.origin]?.tier;
    const destTier    = hubs[route.destination]?.tier;
    const hubQuality  = Math.max(
      originTier ? (HUB_TIERS[originTier]?.qualityBonus ?? 0) : 0,
      destTier   ? (HUB_TIERS[destTier]?.qualityBonus   ?? 0) : 0,
    );
    const routeWithHubBonus = hubQuality > 0 ? { ...route, hubQualityBonus: hubQuality } : route;

    const result = simulateRoute(routeWithHubBonus, aircraft, gameDate, labor, fuelMultiplier);
    if (!result) continue;

    // Connecting passengers: additional revenue from hub-feed and partner agreements.
    // The cannibalizationMap factor reduces connecting demand on routes where a
    // direct flight (own or competitor) siphons off O&D passengers that previously
    // connected through the player's hubs.
    const connectingRaw = computeConnectingDemand(
      route.origin,
      route.destination,
      hubs,
      routeCountByAirport[route.origin]      ?? 0,
      routeCountByAirport[route.destination] ?? 0,
      route.ticketPrice,
      { weeklyFrequency: route.weeklyFrequency ?? 7, partnerHubCodes },
    );
    // Apply marketing + loyalty + alliance demand boosts to passenger revenue
    const routeKey       = [route.origin, route.destination].sort().join('-');
    const cannibFactor = cannibalizationMap[routeKey] ?? 1.0;
    const connecting   = cannibFactor < 1.0
      ? {
          ...connectingRaw,
          totalPax:     Math.round(connectingRaw.totalPax     * cannibFactor),
          totalRevenue: Math.round(connectingRaw.totalRevenue * cannibFactor),
          origin:       { ...connectingRaw.origin,      pax: Math.round((connectingRaw.origin?.pax      ?? 0) * cannibFactor), revenue: Math.round((connectingRaw.origin?.revenue      ?? 0) * cannibFactor) },
          destination:  { ...connectingRaw.destination, pax: Math.round((connectingRaw.destination?.pax ?? 0) * cannibFactor), revenue: Math.round((connectingRaw.destination?.revenue ?? 0) * cannibFactor) },
          cannibalizationFactor: +cannibFactor.toFixed(3),
        }
      : connectingRaw;
    const allianceLift   = partnerContestedKeys.has(routeKey) ? allianceDemandBoostPct : 0;
    const marketingLift  = mktMultiplier - 1;
    const loyaltyLift    = loyaltyMultiplier - 1;
    const combinedMult   = awarenessMultiplier * mktMultiplier * loyaltyMultiplier * (1 + allianceLift);
    // Ancillary catering revenue is per-actual-passenger income — it should NOT be
    // amplified by the marketing/awareness/loyalty demand multipliers (those proxy
    // for attracting MORE passengers, which catering income would then double-count).
    // Strip it out before boosting, then add it back unscaled.
    const cateringRev    = result.cateringRevenue ?? 0;
    const boostedRevenue = Math.round((result.revenue - cateringRev) * combinedMult) + cateringRev;
    const routeRevenue   = boostedRevenue + connecting.totalRevenue;

    // Landing & navigation fees for this route
    const type         = getAircraftType(aircraft.typeId);
    const originAp     = getAirport(route.origin);
    const destAp       = getAirport(route.destination);
    const landingFee   = weeklyLandingFee(
      type?.category ?? 'Narrow Body',
      route.weeklyFrequency,
      originAp?.tier ?? 'major',
      destAp?.tier   ?? 'major',
    );

    totalRevenue        += routeRevenue;
    totalConnecting     += connecting.totalRevenue;
    totalFuel           += result.fuelCost;
    totalCrew           += result.crewCost;
    totalQuality        += result.qualityCost;
    totalCatering        += result.cateringCost       ?? 0;
    totalCateringRevenue += cateringRev;
    totalGroundHandling += result.groundHandlingCost  ?? 0;
    totalLounge         += result.loungeCost          ?? 0;
    totalLayover        += result.layoverCost         ?? 0;
    totalCompensation   += result.compensationCost    ?? 0;
    totalLandingFees    += landingFee;
    totalPassengers   += result.passengers ?? 0;
    routeResults.push({
      routeId: route.id,
      ...result,
      revenue:          routeRevenue,
      marketingLift:    Math.round(result.revenue * marketingLift),
      loyaltyLift:      Math.round(result.revenue * loyaltyLift),
      allianceLift:     Math.round(result.revenue * allianceLift),
      landingFee,
      profit:           Math.round(routeRevenue - result.totalOpCost - landingFee),
      connecting,
    });
  }

  // 2. Fleet fixed costs (lease + maintenance)
  let totalLeases      = 0;
  let totalMaintenance = 0;
  const fleetCosts     = [];

  for (const aircraft of fleet) {
    const type = getAircraftType(aircraft.typeId);
    if (!type) continue;
    const maintMult         = maintenanceMultiplier(aircraft.ageWeeks ?? 0);
    const { maintenanceCostMultiplier } = laborEffects(labor);
    const maint             = Math.round(
      type.baseMaintenancePerWk * maintMult * maintenanceBudget * maintenanceCostMultiplier * (aircraft.maintMod ?? 1.0)
    );
    // Owned aircraft carry no lease — only maintenance applies.
    // Use the per-aircraft weeklyLease stored at delivery time (may differ from type default
    // due to engine options / wingtips chosen at order time); fall back to type default.
    const leaseThisWk = aircraft.ownershipType === 'owned' ? 0
      : (aircraft.weeklyLease ?? type.weeklyLease);
    totalLeases      += leaseThisWk;
    totalMaintenance += maint;
    fleetCosts.push({ aircraftId: aircraft.id, lease: leaseThisWk, maintenance: maint });
  }

  // 3. Labor overhead (fixed per aircraft, scaled by pay multiplier for each group)
  let totalLaborCosts = 0;
  if (labor && fleet.length > 0) {
    for (const group of LABOR_GROUPS) {
      const payMult = labor[group.id]?.payMultiplier ?? 1.0;
      totalLaborCosts += Math.round(group.baseWeeklyPerAircraft * payMult * fleet.length);
    }
  }

  // 4. Gate rental fees (monthly fee billed pro-rata as weekly)
  let totalGateFees = 0;
  for (const [code, count] of Object.entries(gates)) {
    if (!count) continue;
    const ap = getAirport(code);
    if (!ap) continue;
    totalGateFees += Math.round(totalGateMonthlyFee(ap, count) / 4);
  }

  // 5. Fleet family MRO base costs (one fixed fee per active aircraft family, regardless of fleet size)
  const totalFamilyBaseCosts = fleet.length > 0 ? weeklyFamilyBaseCost(fleet) : 0;

  // 6. Hub investment costs — higher tiers require ongoing weekly spend
  let totalHubInvestment = 0;
  for (const [, hubData] of Object.entries(hubs)) {
    const tierDef = HUB_TIERS[hubData.tier] ?? HUB_TIERS[1];
    totalHubInvestment += tierDef.weeklyInvestment;
  }

  // 7. HQ & corporate overhead — scales with fleet size
  const totalHQCost = calcHQCost(fleet.length);

  // 8. Insurance — hull (owned aircraft) + liability (all aircraft)
  let totalInsurance = 0;
  for (const aircraft of fleet) {
    const type = getAircraftType(aircraft.typeId);
    totalInsurance += weeklyInsuranceCost(aircraft, type);
  }

  // 9. Marketing spend — deducted as a cost; demand effect already in revenue above
  const totalMarketingSpend = marketingBudget > 0 ? Math.round(marketingBudget) : 0;

  // 10. Loyalty program costs:
  //   - Weekly investment (technology, partnerships, admin)
  //   - Points redemption / award seat cost: up to 3.5% of revenue at full membership.
  //   Real programs run 2–4% of revenue; 3.5% cap is realistic for a large mature program.
  const loyaltyInvestment = loyalty?.weeklyInvestment ?? 0;
  const loyaltyPointsCost = loyaltyMembers > 0
    ? Math.round(totalRevenue * Math.min(0.035, loyaltyMembers / 5_000_000 * 1.75))
    : 0;
  const totalLoyaltyCost  = loyaltyInvestment + loyaltyPointsCost;

  // 11. Alliance & codeshare partnerships
  // O&D-based partner revenue (replaces the old flat per-adjacent-route model).
  // Computed by network.js: for each mixed-leg connection (player leg + partner leg),
  // the player earns a mileage-prorated share of the itinerary fare.
  const totalAllianceRevenue  = 0;   // now folded into partnerODRevenue
  const totalCodeshareRevenue = partnerODRevenue.totalRevenue;
  const totalPartnerRevenue   = partnerODRevenue.totalRevenue;

  const totalAllianceFee   = allianceMembership ? (allianceDef?.weeklyFee ?? 0) : 0;
  const totalCodeshareFees = codeshareAgreements.reduce((s, a) => s + (a.weeklyFee ?? 0), 0);
  const totalPartnerFees   = totalAllianceFee + totalCodeshareFees;

  // Distribution: GDS fees, OTA commissions, credit-card processing (~2.5% of revenue)
  const totalDistributionCost = Math.round((totalRevenue + totalPartnerRevenue) * DISTRIBUTION_COST_PCT);

  const totalOpCost = totalFuel + totalCrew + totalQuality + totalCatering + totalGroundHandling + totalLounge + totalLayover + totalCompensation + totalLandingFees;
  const totalCost   = totalLeases + totalMaintenance + totalOpCost + totalGateFees
    + totalLaborCosts + totalFamilyBaseCosts + totalHubInvestment
    + totalHQCost + totalInsurance + totalMarketingSpend + totalLoyaltyCost + totalPartnerFees
    + totalDistributionCost;
  const cashDelta   = totalRevenue + totalPartnerRevenue - totalCost;

  return {
    cashDelta:              Math.round(cashDelta),
    totalRevenue:           Math.round(totalRevenue + totalPartnerRevenue),
    totalConnecting:        Math.round(totalConnecting),
    totalLeases:            Math.round(totalLeases),
    totalMaintenance:       Math.round(totalMaintenance),
    totalFuel:              Math.round(totalFuel),
    totalCrew:              Math.round(totalCrew),
    totalQuality:           Math.round(totalQuality),
    totalLandingFees:       Math.round(totalLandingFees),
    totalCatering:          Math.round(totalCatering),
    totalCateringRevenue:   Math.round(totalCateringRevenue),
    totalGroundHandling:    Math.round(totalGroundHandling),
    totalLounge:            Math.round(totalLounge),
    totalDistributionCost:  Math.round(totalDistributionCost),
    totalLayover:           Math.round(totalLayover),
    totalCompensation:      Math.round(totalCompensation),
    totalGateFees:          Math.round(totalGateFees),
    totalLaborCosts:        Math.round(totalLaborCosts),
    totalFamilyBaseCosts:   Math.round(totalFamilyBaseCosts),
    totalHubInvestment:     Math.round(totalHubInvestment),
    totalHQCost:            Math.round(totalHQCost),
    totalInsurance:         Math.round(totalInsurance),
    totalMarketingSpend:    Math.round(totalMarketingSpend),
    totalLoyaltyCost:       Math.round(totalLoyaltyCost),
    totalAllianceRevenue:   Math.round(totalAllianceRevenue),
    totalCodeshareRevenue:  Math.round(totalCodeshareRevenue),
    totalPartnerRevenue:    Math.round(totalPartnerRevenue),
    totalAllianceFee:       Math.round(totalAllianceFee),
    totalCodeshareFees:     Math.round(totalCodeshareFees),
    totalPartnerFees:       Math.round(totalPartnerFees),
    // Network / O&D data for the UI and GameContext
    partnerODRevenue,        // { totalRevenue, entries[] } — detailed O&D breakdown
    partnerHealthDecay,      // { [competitorId]: hpLost } — for partnership state updates
    networkConnections:      networkTick.connections, // full Connection[] for debugging/UI
    loyaltyMultiplier,
    awarenessMultiplier,
    totalPassengers,
    mktMultiplier,
    totalOpCost:            Math.round(totalOpCost),
    totalCost:              Math.round(totalCost),
    routeResults,
    fleetCosts,
  };
}

// ─────────────────────────────────────────────
// FORMATTING HELPERS
// ─────────────────────────────────────────────

export function formatMoney(n) {
  const abs = Math.abs(n);
  const sign = n < 0 ? '-' : '';
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(2)}M`;
  if (abs >= 1_000)     return `${sign}$${(abs / 1_000).toFixed(1)}K`;
  return `${sign}$${Math.round(abs)}`;
}

export function formatPercent(n) {
  return `${(n * 100).toFixed(1)}%`;
}
