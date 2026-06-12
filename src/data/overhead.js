/**
 * overhead.js — Corporate overhead costs not tied to individual routes or aircraft.
 *
 * Covers four cost categories:
 *   1. HQ & Corporate overhead  — scales with fleet size (management, IT, legal, admin)
 *   2. Insurance                — hull (owned aircraft) + liability (all aircraft)
 *   3. Landing & Nav fees       — per departure, by aircraft category
 *   4. Marketing budget         — player-controlled; drives a demand multiplier
 */

// ─── 1. HQ & Corporate overhead ──────────────────────────────────────────────
//
// Represents: executive pay, HQ office rent, GDS/reservation system,
// crew-scheduling software, revenue management, legal, compliance, finance/accounting.
// Jumps at fleet-size thresholds rather than scaling linearly so the cost
// is felt as a meaningful step up when the airline grows.

export const HQ_BRACKETS = [
  {
    minAircraft: 0,
    maxAircraft: 0,
    weeklyCost:  0,
    label:       'Pre-launch',
    description: 'No corporate structure yet.',
  },
  {
    minAircraft: 1,
    maxAircraft: 3,
    weeklyCost:  55_000,
    label:       'Startup',
    description: 'Small regional office, basic booking system, skeleton management team.',
  },
  {
    minAircraft: 4,
    maxAircraft: 8,
    weeklyCost:  140_000,
    label:       'Regional',
    description: 'Proper office, IT systems, revenue management, finance & legal.',
  },
  {
    minAircraft: 9,
    maxAircraft: 15,
    weeklyCost:  290_000,
    label:       'Mid-size',
    description: 'Full HQ building, GDS integrations, crew-scheduling platform, HR dept.',
  },
  {
    minAircraft: 16,
    maxAircraft: 30,
    weeklyCost:  600_000,
    label:       'National',
    description: 'Corporate HQ, all departments, regulatory affairs office.',
  },
  {
    minAircraft: 31,
    maxAircraft: Infinity,
    weeklyCost:  1_200_000,
    label:       'Major',
    description: 'Full corporate apparatus: investor relations, government affairs, global IT.',
  },
];

/** Weekly HQ cost for a given fleet size. */
export function calcHQCost(fleetSize) {
  for (let i = HQ_BRACKETS.length - 1; i >= 0; i--) {
    if (fleetSize >= HQ_BRACKETS[i].minAircraft) return HQ_BRACKETS[i].weeklyCost;
  }
  return 0;
}

/** The full bracket object for a given fleet size. */
export function hqBracket(fleetSize) {
  for (let i = HQ_BRACKETS.length - 1; i >= 0; i--) {
    if (fleetSize >= HQ_BRACKETS[i].minAircraft) return HQ_BRACKETS[i];
  }
  return HQ_BRACKETS[0];
}

/** Fleet size needed for the next HQ tier (null if already at max). */
export function nextHQThreshold(fleetSize) {
  const current = hqBracket(fleetSize);
  const idx = HQ_BRACKETS.indexOf(current);
  return idx < HQ_BRACKETS.length - 1 ? HQ_BRACKETS[idx + 1].minAircraft : null;
}


// ─── 2. Insurance ─────────────────────────────────────────────────────────────
//
// Hull insurance: protects owned aircraft against damage/total loss.
//   Rate ≈ 0.5% of purchase price per year.  Only applies to owned aircraft.
//
// Liability insurance: third-party passenger & hull liability for all aircraft,
//   regardless of ownership — lessor's insurance typically covers the hull but
//   the lessee still needs full liability coverage.

/** Annual hull insurance rate as a fraction of aircraft purchase price. */
export const HULL_INSURANCE_ANNUAL_RATE = 0.008;   // 0.8 % p.a.

/** Weekly liability premium per aircraft (owned or leased). */
export const LIABILITY_INSURANCE_WEEKLY_PER_AIRCRAFT = 18_000;

/**
 * Weekly insurance cost for a single aircraft.
 *   owned:  hull (book-value based) + liability
 *   leased: liability only
 */
export function weeklyInsuranceCost(aircraft, aircraftType) {
  const liability = LIABILITY_INSURANCE_WEEKLY_PER_AIRCRAFT;
  if (aircraft.ownershipType !== 'owned' || !aircraftType?.purchasePrice) {
    return liability;
  }
  // Hull: book value declines linearly over 20 years
  const ageYears   = (aircraft.ageWeeks ?? 0) / 52;
  const remaining  = Math.max(0.1, 1 - ageYears / 20);   // never below 10 % of new value
  const bookValue  = aircraftType.purchasePrice * remaining;
  const hullAnnual = bookValue * HULL_INSURANCE_ANNUAL_RATE;
  const hullWeekly = Math.round(hullAnnual / 52);
  return liability + hullWeekly;
}


// ─── 3. Landing & Navigation fees ────────────────────────────────────────────
//
// Covers: airport landing fees, Eurocontrol/ATC en-route charges, passenger
// facility charges.  Charged per actual departure (each direction of each
// weekly frequency).
//
// Fees vary by both aircraft category and destination airport tier:
//   mega   — LHR, JFK, DXB, NRT etc.  High slot demand, expensive infrastructure.
//   major  — ORD, SFO, FRA etc.
//   regional — smaller city airports
//
// Each leg pays the fee for its destination airport (landing fee is charged
// at the airport you land at, not the one you depart from).

export const LANDING_FEE_PER_DEPARTURE = {
  //                    mega      major   regional
  'Turboprop':   { mega:   700, major:   450, regional:   200 },
  'Regional Jet':{ mega: 2_000, major: 1_200, regional:   550 },
  'Narrow Body': { mega: 4_500, major: 2_800, regional: 1_100 },
  'Wide Body':   { mega: 9_000, major: 5_800, regional: 2_400 },
};

/** Default fallback if category or tier not found. */
const LANDING_FEE_DEFAULT = 1_400;

/**
 * Weekly landing + nav fee for one route.
 *   = (fee at origin tier + fee at destination tier) × weekly_frequency
 *
 * @param {string} aircraftCategory  - 'Narrow Body', 'Wide Body', etc.
 * @param {number} weeklyFrequency   - one-way weekly departures
 * @param {string} [originTier]      - 'mega' | 'major' | 'regional'
 * @param {string} [destTier]        - 'mega' | 'major' | 'regional'
 */
export function weeklyLandingFee(aircraftCategory, weeklyFrequency, originTier, destTier) {
  const catFees = LANDING_FEE_PER_DEPARTURE[aircraftCategory];
  const feeAtOrigin = catFees?.[originTier] ?? LANDING_FEE_DEFAULT;
  const feeAtDest   = catFees?.[destTier]   ?? LANDING_FEE_DEFAULT;
  // Each weekly frequency generates one outbound (lands at dest) + one return (lands at origin)
  return (feeAtDest + feeAtOrigin) * weeklyFrequency;
}


// ─── 4. Catering ─────────────────────────────────────────────────────────────
//
// Per-passenger, per-leg catering cost.  Applies to actual boarded passengers.
// Covers food, beverages, packaging, and galley provisioning.
// Economy rate assumes a snack + drink; premium cabins get full meal service.

export const CATERING_COST_PER_PAX = {
  economy:        4,    // snack + drink
  premiumEconomy: 11,   // light meal + drink
  businessClass:  30,   // full hot meal, wine, amenity kit
  firstClass:     65,   // multi-course, premium spirits, luxury amenities
};

/**
 * Weekly catering cost for one route.
 * classSummary: { [cls]: { passengers: number } } — total pax both directions.
 */
export function weeklyCateringCost(classSummary) {
  return Math.round(
    Object.entries(CATERING_COST_PER_PAX).reduce((s, [cls, rate]) => {
      return s + (classSummary[cls]?.passengers ?? 0) * rate;
    }, 0)
  );
}


// ─── 5. Ground handling ───────────────────────────────────────────────────────
//
// Ramp agents, baggage handlers, pushback, gate agents, check-in staff.
// Charged per boarded passenger (both directions), by cabin class.
// Economy rate assumes simple turnaround; premium cabins get dedicated agents.

export const GROUND_HANDLING_COST_PER_PAX = {
  economy:        10,   // standard ramp + bag + boarding
  premiumEconomy: 13,   // slightly more baggage weight, priority boarding
  businessClass:  20,   // dedicated check-in, lounge coordination, bag priority
  firstClass:     35,   // personal agent, limo-to-tarmac, bespoke handling
};

/**
 * Weekly ground handling cost for one route.
 * classSummary: { [cls]: { passengers: number } } — total pax both directions.
 */
export function weeklyGroundHandlingCost(classSummary) {
  return Math.round(
    Object.entries(GROUND_HANDLING_COST_PER_PAX).reduce((s, [cls, rate]) => {
      return s + (classSummary[cls]?.passengers ?? 0) * rate;
    }, 0)
  );
}


// ─── 6. Distribution & booking fees ──────────────────────────────────────────
//
// GDS fees, OTA commissions, credit-card processing.
// Typically 2–3 % of passenger revenue for a mid-size carrier.
// Applied as a flat percentage of total route revenue.

/** Fraction of revenue charged as distribution / GDS / booking cost. */
export const DISTRIBUTION_COST_PCT = 0.025;


// ─── 7. Crew layover & accommodation ─────────────────────────────────────────
//
// When a one-way sector is long enough that crew cannot return to base
// the same day, the airline must pay for hotel rooms + per diem.
// Threshold is 4 hours block time (roughly 3h flight + 1h on-ground).

export const LAYOVER_BLOCK_HOURS_THRESHOLD = 4.0;
export const LAYOVER_COST_PER_CREW_NIGHT   = 200;   // hotel + per diem, USD

/**
 * Weekly layover cost for one route.
 * @param {number} blockTimeHrs  - one-way block time for the sector
 * @param {number} seats         - aircraft total seats (used to size cabin crew)
 * @param {string} category      - aircraft category (Wide Body needs 3 flight-deck)
 * @param {number} weeklyFreq    - one-way weekly frequency (×2 for both directions)
 */
export function weeklyLayoverCost(blockTimeHrs, seats, category, weeklyFreq) {
  if (blockTimeHrs <= LAYOVER_BLOCK_HOURS_THRESHOLD) return 0;
  const flightDeckCrew = category === 'Wide Body' ? 3 : 2;
  const cabinCrew      = Math.max(1, Math.ceil(seats / 50));
  const totalCrew      = flightDeckCrew + cabinCrew;
  return Math.round(totalCrew * LAYOVER_COST_PER_CREW_NIGHT * weeklyFreq * 2);
}


// ─── 6. Passenger compensation ───────────────────────────────────────────────
//
// When flights are significantly delayed or cancelled, airlines owe compensation
// (EU261 / DOT rules).  Linked to pilot morale → on-time-rate.
//
// Model:
//   delay rate = 1 − onTimeRate
//   ~10% of delays escalate into compensable events (>3h delay or cancellation)
//   compensation amount scales with route distance

export const COMPENSATION_ESCALATION_RATE = 0.10;   // fraction of delays that become compensable

/**
 * Compensation per affected passenger (USD), by route distance (km).
 * Based on EU261 thresholds translated to USD.
 */
export function compensationPerPax(distKm) {
  if (distKm < 1_500) return 275;
  if (distKm < 3_500) return 440;
  return 660;
}

/**
 * Weekly passenger compensation cost for one route.
 * @param {number} passengers  - total weekly passengers (both directions)
 * @param {number} onTimeRate  - 0–1, derived from pilot morale
 * @param {number} distKm      - route distance
 */
export function weeklyPassengerCompensation(passengers, onTimeRate, distKm) {
  const delayRate = Math.max(0, 1 - onTimeRate);
  const compensableFraction = delayRate * COMPENSATION_ESCALATION_RATE;
  return Math.round(passengers * compensableFraction * compensationPerPax(distKm));
}


// ─── 7. Marketing ─────────────────────────────────────────────────────────────
//
// The player sets a weekly marketing spend.  It drives a demand multiplier
// across all routes, with steeply diminishing returns.
//
// Formula:  multiplier = 1 + MAX_BOOST × (1 − e^(−spend / SPEND_SCALE))
//   where SPEND_SCALE = weeklyRevenue × REVENUE_SHARE_SCALE
//
// Calibration:
//   spend = 1 % of revenue  →  +1 % demand
//   spend = 5 % of revenue  →  +6 % demand
//   spend = 10 % of revenue → +11 % demand
//   spend = 20 % of revenue → +18 % demand (approaching cap)
//   Absolute cap: +20 %
// Airlines typically spend 2–5 % of revenue on marketing; you need ~10% to hit diminishing returns.

export const MARKETING_MAX_BOOST       = 0.20;   // hard cap on demand lift
export const MARKETING_REVENUE_SHARE   = 0.15;   // controls the spend-to-benefit curve (higher = more spend needed)

/**
 * Demand multiplier from marketing spend.
 * @param {number} weeklySpend   – player's chosen weekly marketing budget ($)
 * @param {number} weeklyRevenue – current total weekly revenue ($ — for scaling)
 */
export function marketingDemandMultiplier(weeklySpend, weeklyRevenue) {
  if (weeklySpend <= 0 || weeklyRevenue <= 0) return 1.0;
  const scale = Math.max(weeklyRevenue * MARKETING_REVENUE_SHARE, 50_000);
  const boost = MARKETING_MAX_BOOST * (1 - Math.exp(-weeklySpend / scale));
  return 1 + boost;
}
