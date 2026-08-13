/**
 * market.js — Pure market utility functions shared by simulation.js and demand.js.
 *
 * Extracted here to break the circular dependency that would arise if both
 * simulation.js and demand.js imported from each other.
 *
 * Import chain:
 *   market.js        ← airports.js only
 *   demand.js        ← market.js
 *   simulation.js    ← market.js, demand.js
 */

import { getAirport, getAirportScores, getAirportCargoScore } from '../data/airports.js';
import {
  METROS,
  metroOf,
  metroPrimary,
  sameMetroCodes,
} from '../data/metros.js';

// Re-exported so every consumer of the metro model imports it through the same
// market/demand surface they already use (the registry itself lives in data/).
export {
  metroOf,
  metroPrimary,
  metroPairKeyOf,
  isMetroPair,
  memberPairKeysOf,
  airportAppeal,
  pairAppeal,
} from '../data/metros.js';

// ─── Distance ─────────────────────────────────────────────────────────────────

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

// ─── Gravity model ────────────────────────────────────────────────────────────

/**
 * Demand attractiveness multiplier for one airport endpoint.
 * Combines business and leisure appeal so that corporate hubs and tourist
 * destinations generate more traffic than their raw population would suggest.
 *
 * Normalised so a neutral airport (businessScore=50, leisureScore=50) → 1.0.
 * Examples:
 *   JFK (biz 72, lei 65) → 1.37   LAS Vegas (biz 15, lei 90) → 1.05
 *   LHR (biz 82, lei 55) → 1.37   CUN Cancún (biz  8, lei 92) → 1.00
 *   DXB (biz 80, lei 65) → 1.45   IAD DC govt (biz 78, lei 28) → 1.06
 *
 * @param {string} code
 * @returns {number}
 */
function demandMultiplier(code) {
  const { businessScore, leisureScore } = getAirportScores(code);
  return (businessScore + leisureScore) / 100;
}

// ─── Demand mass ───────────────────────────────────────────────────────────────
// The gravity model keys off a "demand mass" (in millions). Historically this was
// just metro population (with `effectivePop` as a manual override for big connecting
// hubs). Two kinds of airport are badly under-rated by population alone:
//
//   • Tourism magnets   – e.g. Malé/Maldives: ~0.4M residents but millions of
//                          annual visitors. Demand comes from tourism, not population.
//   • National gateways  – e.g. Ulaanbaatar: traffic is driven by being the only
//                          international gateway for a whole country, not city size.
//
// So demand mass = population + tourism term + gateway term, with two optional,
// data-driven airport fields and two tunable coefficients below.

/** Each 1M annual inbound visitors contributes this much demand mass (in millions). */
export const TOURISM_VISITOR_WEIGHT = 1.5;
/** Fraction of an airport's declared national catchment that becomes demand mass. */
export const GATEWAY_WEIGHT = 1.0;

/**
 * Effective demand mass (millions) for one airport.
 *  - `effectivePop` (if set) stays authoritative — it already bakes in connecting/
 *    gateway traffic for the calibrated mega-hubs, so we don't double-count it.
 *  - otherwise: population + visitors*TOURISM_VISITOR_WEIGHT + gateway*GATEWAY_WEIGHT
 *
 * Airport fields (all optional, in millions):
 *   visitors         – annual inbound visitors/tourists per year (any origin)
 *   domesticVisitors – annual inbound visitors who are overwhelmingly SAME-COUNTRY
 *                      travelers (Jeju, Sapporo, Okinawa...). Counts toward demand
 *                      mass only on domestic pairs — foreign traffic to these
 *                      places is a trickle compared to the domestic firehose.
 *   gateway          – extra national catchment that routes through this airport
 *                      (rule of thumb: national pop − metro pop, for a country's
 *                       primary international gateway)
 *
 * @param {object}  ap  airport record
 * @param {boolean} [domesticPair=true]  whether the pair being priced is
 *   domestic; single-airport contexts (hub sizing etc.) should keep the default
 *   and see full mass.
 * @returns {number} demand mass in millions
 */
export function getDemandMass(ap, domesticPair = true) {
  if (ap == null) return 0;
  if (ap.effectivePop != null) return ap.effectivePop;
  return (ap.population ?? 0)
    + (ap.visitors ?? 0) * TOURISM_VISITOR_WEIGHT
    + (domesticPair ? (ap.domesticVisitors ?? 0) * TOURISM_VISITOR_WEIGHT : 0)
    + (ap.gateway ?? 0) * GATEWAY_WEIGHT;
}

// ─── Country travel factors (2026-07 demand recalibration) ────────────────────
// Audit vs real-world O&D data (docs/DEMAND_MODEL_AUDIT.md) showed a ~400x
// relative spread between over- and under-modeled pairs. Three factors below
// close most of it: propensity-to-fly, border friction, and air-captivity.

/**
 * Propensity-to-fly index by country (US = 1.0). Roughly annual air trips per
 * capita. Applied at FULL strength to international pairs and softened to
 * p^DOMESTIC_PROPENSITY_EXP for domestic pairs (domestic flying is far less
 * income-sensitive: LCC fares, no visas). Missing country → DEFAULT_PROPENSITY.
 */
export const COUNTRY_PROPENSITY = {
  // Americas
  US:1.0, CA:0.9, PR:1.0, GL:0.8, BM:1.2, PM:0.8,
  MX:0.55, GT:0.3, HN:0.3, SV:0.35, NI:0.25, CR:0.6, PA:0.7, BZ:0.5,
  CU:0.25, DO:0.5, HT:0.15, JM:0.6, TT:0.7, BS:1.0, BB:0.9, AW:1.1, KY:1.2,
  CW:0.9, SX:1.0, AG:0.9, GD:0.7, KN:0.8, LC:0.7, VC:0.6, DM:0.5, AI:0.9,
  VG:1.0, TC:0.9, GP:0.8, MQ:0.8, BQ:0.9, BL:1.2,
  BR:0.55, AR:0.6, CL:0.7, UY:0.7, PY:0.4, BO:0.4, PE:0.45, EC:0.45,
  CO:0.5, VE:0.3, GY:0.4, SR:0.4,
  // Europe
  GB:1.1, IE:1.2, FR:0.85, DE:0.85, NL:0.9, BE:0.85, LU:1.1, CH:1.1, AT:0.9,
  ES:1.05, PT:1.0, IT:0.9, GR:1.0, MT:1.2, CY:1.1, DK:1.0, NO:1.3, SE:1.1,
  FI:1.1, IS:1.5, PL:0.7, CZ:0.8, SK:0.7, HU:0.75, RO:0.6, BG:0.65, HR:0.85,
  RS:0.6, MK:0.55, BA:0.5, ME:0.7, XK:0.5, AL:0.6, SI:0.8, MD:0.4, UA:0.4,
  BY:0.4, RU:0.6, LV:0.8, LT:0.8, EE:0.9, TR:0.75, GE:0.6, AM:0.6, AZ:0.55,
  JE:1.2, IM:1.2, FO:1.3, GI:1.2,
  // Middle East / North Africa
  AE:1.5, QA:1.5, KW:1.2, BH:1.3, OM:1.0, SA:1.2, YE:0.1, IQ:0.3, IR:0.4,
  IL:1.1, JO:0.6, LB:0.6, SY:0.15,
  EG:0.3, LY:0.4, TN:0.55, DZ:0.4, MA:0.4, MR:0.2, SD:0.15,
  // Sub-Saharan Africa
  ZA:0.65, NA:0.5, BW:0.5, ZW:0.25, ZM:0.25, MW:0.15, MZ:0.2, AO:0.3, CD:0.15,
  CG:0.3, GA:0.5, CM:0.2, NG:0.1, GH:0.2, CI:0.25, SN:0.3, ML:0.15, BF:0.12,
  NE:0.1, TD:0.12, TG:0.15, BJ:0.15, GM:0.2, GW:0.15, GN:0.15, SL:0.15,
  LR:0.15, KE:0.25, TZ:0.2, UG:0.15, RW:0.25, BI:0.1, ET:0.08, SO:0.1,
  DJ:0.4, ER:0.1, SS:0.1, CF:0.1, MG:0.15, MU:0.9, SC:1.2, KM:0.2, RE:0.9,
  CV:0.6, ST:0.3, SH:0.5, SZ:0.3, LS:0.2,
  // Central / South Asia
  KZ:0.7, UZ:0.35, TM:0.3, TJ:0.25, KG:0.35, MN:0.6, AF:0.1,
  IN:0.35, PK:0.15, BD:0.08, LK:0.3, NP:0.25, BT:0.4, MV:1.2,
  // East / Southeast Asia
  CN:0.55, JP:1.3, KR:1.3, TW:1.1, HK:1.2, MO:1.0, KP:0.05,
  SG:1.4, MY:0.9, TH:0.75, VN:0.65, ID:0.5, PH:0.55, KH:0.35, LA:0.3,
  MM:0.2, BN:1.0, TL:0.25,
  // Oceania
  AU:1.6, NZ:1.5, FJ:0.8, PF:1.0, NC:0.9, PG:0.25, SB:0.3, VU:0.5, WS:0.6,
  TO:0.6, KI:0.4, TV:0.4, NR:0.6, CK:0.9, PW:0.8, FM:0.4, MH:0.4, NF:0.9,
  GU:1.2, AS:1.0, MP:1.0,
};
export const DEFAULT_PROPENSITY = 0.4;
export const DOMESTIC_PROPENSITY_EXP = 0.35;

// ─── Demand growth over game time (2026-08) ───────────────────────────────────
// Air travel demand GROWS as a world ages, and it grows fastest where incomes
// are climbing: India and Southeast Asia compound at 7–8% a year while the
// mature US/EU/Japan markets crawl at 1–2%. Strategically this rewards planting
// a flag early in an emerging market — the route that breaks even in year one
// is printing money by year five, and the propensity gap between rich and poor
// countries (COUNTRY_PROPENSITY) slowly narrows the way it does in reality.
//
// Annual rates, loosely IATA/Boeing 20-year CAGR forecasts. Missing country →
// DEFAULT_DEMAND_GROWTH. Applied by buildRouteMarket() as a multiplier on the
// pair's demand pool: sqrt of the two ends' compounded growth (each end
// contributes half, like every other endpoint factor under the gravity sqrt),
// capped at DEMAND_GROWTH_CAP so a decade-old world stays playable rather than
// drowning every emerging-market route in demand.
export const COUNTRY_DEMAND_GROWTH = {
  // South & Central Asia — the fastest-growing air markets on Earth
  IN: 0.080, BD: 0.070, PK: 0.060, LK: 0.050, NP: 0.055, KZ: 0.050, UZ: 0.055,
  // Southeast Asia
  VN: 0.075, ID: 0.070, PH: 0.070, KH: 0.065, LA: 0.060, MM: 0.055,
  TH: 0.045, MY: 0.045, SG: 0.030, BN: 0.030,
  // East Asia
  CN: 0.050, TW: 0.020, HK: 0.020, KR: 0.015, JP: 0.010, MO: 0.020, MN: 0.050,
  // Middle East
  SA: 0.055, AE: 0.045, QA: 0.040, OM: 0.045, KW: 0.035, BH: 0.035,
  IQ: 0.050, IR: 0.035, IL: 0.030, JO: 0.040, TR: 0.050,
  // Africa
  EG: 0.055, NG: 0.060, ET: 0.065, KE: 0.055, TZ: 0.055, UG: 0.055, GH: 0.050,
  CI: 0.050, SN: 0.050, RW: 0.060, ZA: 0.035, MA: 0.040, DZ: 0.040, TN: 0.040,
  AO: 0.045, MZ: 0.050, ZM: 0.045, CD: 0.050, CM: 0.045,
  // Latin America
  BR: 0.040, MX: 0.040, CO: 0.045, PE: 0.045, CL: 0.035, AR: 0.035,
  EC: 0.040, BO: 0.045, PY: 0.045, UY: 0.030, GT: 0.045, DO: 0.040, PA: 0.040,
  // Mature markets
  US: 0.020, CA: 0.020, GB: 0.015, IE: 0.020, FR: 0.015, DE: 0.015, NL: 0.015,
  BE: 0.015, CH: 0.015, AT: 0.015, IT: 0.015, ES: 0.020, PT: 0.020, GR: 0.025,
  DK: 0.015, NO: 0.015, SE: 0.015, FI: 0.015, IS: 0.020,
  PL: 0.030, CZ: 0.025, SK: 0.025, HU: 0.025, RO: 0.035, BG: 0.030, HR: 0.025,
  RS: 0.030, UA: 0.030, RU: 0.020,
  AU: 0.025, NZ: 0.020,
};
export const DEFAULT_DEMAND_GROWTH = 0.030;
/** Hard ceiling on the compounded growth factor (≈ year 25+ for an 8% market). */
export const DEMAND_GROWTH_CAP = 3.0;

/**
 * Compounded demand-growth factor for a pair, `absWeek` weeks into a world's
 * life (absWeek 1 = the world's first week → factor 1). Callers without a
 * calendar pass null/undefined and get exactly 1 — every historical fixture
 * and preview built from a bare { week, month } gameDate is unchanged.
 *
 * Metro members grow at their metro primary's country rate (identical country
 * in practice), so member pairs keep returning identical totals.
 *
 * @param {string} originCode
 * @param {string} destCode
 * @param {number|null} absWeek  absolute world week (year 1 week 1 → 1)
 * @returns {number} 1 … DEMAND_GROWTH_CAP
 */
export function pairDemandGrowth(originCode, destCode, absWeek) {
  if (absWeek == null || !(absWeek > 1)) return 1;
  const o = getAirport(metroPrimary(originCode));
  const d = getAirport(metroPrimary(destCode));
  if (!o || !d) return 1;
  const gO = COUNTRY_DEMAND_GROWTH[o.country] ?? DEFAULT_DEMAND_GROWTH;
  const gD = COUNTRY_DEMAND_GROWTH[d.country] ?? DEFAULT_DEMAND_GROWTH;
  const years = (absWeek - 1) / 52;
  const factor = Math.pow(Math.sqrt((1 + gO) * (1 + gD)), years);
  return Math.min(DEMAND_GROWTH_CAP, factor);
}

/** World regions for border-friction defaults. */
export const COUNTRY_REGION = {
  US:'NA', CA:'NA', GL:'NA', PM:'NA', BM:'NA', PR:'NA',
  MX:'CARIB', GT:'CARIB', HN:'CARIB', SV:'CARIB', NI:'CARIB', CR:'CARIB', PA:'CARIB',
  BZ:'CARIB', CU:'CARIB', DO:'CARIB', HT:'CARIB', JM:'CARIB', TT:'CARIB', BS:'CARIB',
  BB:'CARIB', AW:'CARIB', KY:'CARIB', CW:'CARIB', SX:'CARIB', AG:'CARIB', GD:'CARIB',
  KN:'CARIB', LC:'CARIB', VC:'CARIB', DM:'CARIB', AI:'CARIB', VG:'CARIB', TC:'CARIB',
  GP:'CARIB', MQ:'CARIB', BQ:'CARIB', BL:'CARIB',
  BR:'SAM', AR:'SAM', CL:'SAM', UY:'SAM', PY:'SAM', BO:'SAM', PE:'SAM', EC:'SAM',
  CO:'SAM', VE:'SAM', GY:'SAM', SR:'SAM',
  GB:'EUR', IE:'EUR', FR:'EUR', DE:'EUR', NL:'EUR', BE:'EUR', LU:'EUR', CH:'EUR',
  AT:'EUR', ES:'EUR', PT:'EUR', IT:'EUR', GR:'EUR', MT:'EUR', CY:'EUR', DK:'EUR',
  NO:'EUR', SE:'EUR', FI:'EUR', IS:'EUR', PL:'EUR', CZ:'EUR', SK:'EUR', HU:'EUR',
  RO:'EUR', BG:'EUR', HR:'EUR', RS:'EUR', MK:'EUR', BA:'EUR', ME:'EUR', XK:'EUR',
  AL:'EUR', SI:'EUR', MD:'EUR', UA:'EUR', BY:'EUR', RU:'EUR', LV:'EUR', LT:'EUR',
  EE:'EUR', TR:'EUR', GE:'EUR', AM:'EUR', AZ:'EUR', JE:'EUR', IM:'EUR', FO:'EUR', GI:'EUR',
  AE:'ME', QA:'ME', KW:'ME', BH:'ME', OM:'ME', SA:'ME', YE:'ME', IQ:'ME', IR:'ME',
  IL:'ME', JO:'ME', LB:'ME', SY:'ME',
  EG:'NAF', LY:'NAF', TN:'NAF', DZ:'NAF', MA:'NAF', MR:'NAF', SD:'NAF',
  ZA:'SSA', NA:'SSA', BW:'SSA', ZW:'SSA', ZM:'SSA', MW:'SSA', MZ:'SSA', AO:'SSA',
  CD:'SSA', CG:'SSA', GA:'SSA', CM:'SSA', NG:'SSA', GH:'SSA', CI:'SSA', SN:'SSA',
  ML:'SSA', BF:'SSA', NE:'SSA', TD:'SSA', TG:'SSA', BJ:'SSA', GM:'SSA', GW:'SSA',
  GN:'SSA', SL:'SSA', LR:'SSA', KE:'SSA', TZ:'SSA', UG:'SSA', RW:'SSA', BI:'SSA',
  ET:'SSA', SO:'SSA', DJ:'SSA', ER:'SSA', SS:'SSA', CF:'SSA', MG:'SSA', MU:'SSA',
  SC:'SSA', KM:'SSA', RE:'SSA', CV:'SSA', ST:'SSA', SH:'SSA', SZ:'SSA', LS:'SSA',
  KZ:'CAS', UZ:'CAS', TM:'CAS', TJ:'CAS', KG:'CAS', MN:'CAS', AF:'CAS',
  IN:'SAS', PK:'SAS', BD:'SAS', LK:'SAS', NP:'SAS', BT:'SAS', MV:'SAS',
  CN:'EAS', JP:'EAS', KR:'EAS', TW:'EAS', HK:'EAS', MO:'EAS', KP:'EAS',
  SG:'SEA', MY:'SEA', TH:'SEA', VN:'SEA', ID:'SEA', PH:'SEA', KH:'SEA', LA:'SEA',
  MM:'SEA', BN:'SEA', TL:'SEA',
  AU:'OCE', NZ:'OCE', PG:'OCE', FJ:'OCE', NC:'OCE', VU:'OCE', SB:'OCE', WS:'OCE',
  TO:'OCE', KI:'OCE', TV:'OCE', NR:'OCE', CK:'OCE', PF:'OCE', GU:'OCE', AS:'OCE',
  MP:'OCE', NF:'OCE', PW:'OCE', FM:'OCE', MH:'OCE',
};

/**
 * Border friction. Domestic = 1.0. International defaults:
 *   same region                              → 0.70
 *   cross region, both propensity ≥ 0.8      → 0.70 (wealthy/open ties)
 *   cross region otherwise                   → 0.45
 * Country-pair overrides capture special corridors (VFR/diaspora/treaty).
 */
export const INTL_SAME_REGION = 0.70;
export const INTL_CROSS_HIGH  = 0.70;
export const INTL_CROSS_LOW   = 0.45;

export const COUNTRY_AFFINITY = {
  'GB-IE':1.0, 'AU-NZ':1.0, 'US-CA':0.65, 'US-MX':0.8, 'CA-MX':0.75,
  'US-GB':0.85, 'US-FR':0.8, 'US-DE':0.8, 'US-IT':0.8, 'US-IL':0.85,
  'US-JP':0.7, 'US-KR':0.8, 'US-CN':0.6, 'US-HK':0.75, 'US-TW':0.75,
  'US-IN':0.7, 'US-PH':0.75, 'US-VN':0.7, 'US-AU':0.8, 'US-BR':0.7,
  'US-CO':0.7, 'US-DO':0.9, 'US-JM':0.9, 'US-BS':0.9, 'US-CU':0.5,
  'CA-GB':0.8, 'CA-FR':0.75, 'CA-IN':0.7, 'CA-PH':0.75, 'CA-HK':0.75, 'CA-CN':0.6,
  'GB-ES':0.9, 'GB-PT':0.9, 'GB-AE':0.8, 'GB-SG':0.85, 'GB-IN':0.7, 'GB-PK':0.7,
  'GB-HK':0.85, 'GB-AU':0.85, 'GB-NZ':0.85, 'GB-ZA':0.75, 'GB-NG':0.6,
  'DE-TR':0.9, 'FR-MA':0.9, 'FR-DZ':0.9, 'FR-TN':0.9, 'ES-MA':0.8,
  'EG-SA':1.0, 'EG-AE':0.85, 'EG-KW':0.85,
  'IN-AE':0.9, 'IN-QA':0.85, 'IN-SA':0.8, 'IN-OM':0.85, 'IN-KW':0.85, 'IN-BH':0.85,
  'IN-BD':0.45, 'IN-SG':0.75, 'PK-AE':0.85, 'PK-SA':0.8, 'BD-AE':0.7, 'BD-SA':0.7,
  'PH-AE':0.85, 'PH-SA':0.8, 'LK-AE':0.8, 'NP-AE':0.7, 'NP-QA':0.7, 'ID-SA':0.75,
  'HK-TW':0.95, 'CN-HK':0.95, 'CN-TW':0.65, 'CN-MO':0.95, 'KR-JP':0.9, 'JP-TW':0.85,
  'TH-HK':0.7, 'JP-TH':0.8, 'KR-TH':0.8, 'KR-VN':0.8, 'CN-TH':0.75, 'CN-SG':0.8,
  'SG-MY':0.95, 'SG-ID':0.9, 'SG-TH':0.85, 'SG-PH':0.8, 'SG-VN':0.8, 'SG-AU':0.8,
  'MY-ID':0.85, 'NZ-FJ':0.95, 'AU-FJ':0.85, 'AU-ID':0.75,
};

/** Softer defaults for a few region pairs that behave like shared markets. */
export const REGION_PAIR_AFFINITY = {
  'EAS-SEA':0.70, 'CARIB-NA':0.70, 'EUR-NAF':0.70,
};

export function borderFactor(o, d) {
  if (!o || !d || o.country === d.country) return 1.0;
  const aff = COUNTRY_AFFINITY[`${o.country}-${d.country}`]
           ?? COUNTRY_AFFINITY[`${d.country}-${o.country}`];
  if (aff != null) return aff;
  const rO = COUNTRY_REGION[o.country], rD = COUNTRY_REGION[d.country];
  if (rO != null && rO === rD) return INTL_SAME_REGION;
  const rp = rO && rD
    ? (REGION_PAIR_AFFINITY[`${rO}-${rD}`] ?? REGION_PAIR_AFFINITY[`${rD}-${rO}`])
    : null;
  if (rp != null) return rp;
  const pO = COUNTRY_PROPENSITY[o.country] ?? DEFAULT_PROPENSITY;
  const pD = COUNTRY_PROPENSITY[d.country] ?? DEFAULT_PROPENSITY;
  return (pO >= 0.8 && pD >= 0.8) ? INTL_CROSS_HIGH : INTL_CROSS_LOW;
}

// ─── Air captivity ─────────────────────────────────────────────────────────────
// Routes where flying is the only practical option carry far more traffic than
// gravity alone predicts (Jeju, Sapporo, Sydney–Melbourne, Jeddah–Riyadh...).
// Two flavours, and we take the MAX (they proxy the same thing — never stack):
//   1. isolated endpoints (islands / no ground link)  → up to CAPTIVITY_BOOST,
//      fading to 1 beyond ~7,000 km where every mode is air anyway.
//   2. domestic pairs in air-reliant countries (no rail, vast distances).

export const CAPTIVITY_BOOST      = 2.8;
/**
 * International pairs get a smaller island boost. Domestic resort islands
 * (Jeju, Sapporo, Hawaii) are captive corridors for their OWN country's
 * travelers; foreign visitors mostly route via the national gateways, so a
 * full 2.8x on e.g. Tokyo–Jeju would invent traffic that doesn't exist.
 */
export const CAPTIVITY_BOOST_INTL = 1.6;
export const CAPTIVITY_FULL_KM = 3000;
export const CAPTIVITY_ZERO_KM = 7000;

/** Airports with no practical ground link to their wider market. */
export const ISOLATED_AIRPORTS = new Set([
  'CJU', 'CTS', 'OKA', 'DPS',                       // Jeju, Sapporo, Okinawa, Bali
  'FUK',                                            // Kyushu — air owns Tokyo-Fukuoka (~90% share)
  'HNL', 'OGG', 'KOA', 'LIH', 'ITO',                // Hawaii
  'JNU', 'SIT', 'KTN', 'WRG', 'PSG', 'YAK', 'CDV',  // SE Alaska (no roads)
  'PER',                                            // Perth (isolated by distance)
]);

/** Island nations / territories with no external ground links. */
export const ISLAND_COUNTRIES = new Set([
  'NZ','TW','IS','MV','LK','MG','MU','SC','RE','KM','CV','ST','SH','FO',
  'CU','DO','JM','HT','BS','BB','AW','KY','CW','SX','AG','GD','KN','LC','VC',
  'DM','AI','VG','TC','GP','MQ','BQ','BL','BM','TT','PR','MT','CY',
  'FJ','PF','NC','VU','SB','WS','TO','KI','TV','NR','CK','PW','FM','MH','GU','AS','MP',
]);

function isIsolated(ap) {
  return ISOLATED_AIRPORTS.has(ap.code) || ISLAND_COUNTRIES.has(ap.country);
}

/**
 * Domestic air-reliance by country: how much domestic intercity travel funnels
 * into aviation (no rail network, hostile driving distances, archipelagos).
 * Baseline 1.0 = US-style (interstates + some rail). Default for unlisted: 1.2.
 */
export const AIR_RELIANT_DOMESTIC = {
  SA:2.4, AU:2.2, PG:2.2, PF:2.2, BS:2.0, ZA:1.9, VN:1.9, ID:1.9, PH:1.9,
  NZ:1.8, CD:1.8, FJ:1.8, MG:1.6, RU:1.6, GR:1.5, NO:1.5, CO:1.5,
  PE:1.5, CL:1.5, KZ:1.5, MN:1.5, IN:1.5, BR:1.4, AR:1.4, BO:1.4, AO:1.4,
  MM:1.4, CA:1.3, EC:1.3, MZ:1.3, ET:1.3, LA:1.3, JP:1.3, MX:1.2, PK:1.2,
  TR:1.1, US:1.0, GB:0.9, KR:0.9, ES:0.9, IT:0.9, CN:0.85, FR:0.8, DE:0.8,
  DK:0.8, AT:0.7, CH:0.6, BE:0.6, NL:0.6,
  // JP is 1.3 (not higher) because Shinkansen owns the Honshu corridors; the
  // huge air markets (Sapporo, Okinawa, Fukuoka) get the island boost instead.
};
export const DEFAULT_AIR_RELIANCE = 1.2;

/**
 * Ground-competition ramp for very short hops (< 200 km): nobody flies 120 km
 * when driving takes two hours. Applies only in countries with contiguous
 * road/rail networks — archipelago and fjord countries (ID, PH, GR, NO, NZ...)
 * are excluded because their sub-200 km hops are genuine overwater routes, as
 * are pairs touching an isolated airport (Hawaii inter-island, Alaska milk run).
 */
export const GROUND_RAMP_KM = 200;
const CONTIGUOUS_GROUND = new Set([
  'US','CA','MX','BR','AR','CN','IN','PK','BD','TR','SA','EG','ZA','NG','ET',
  'KE','RU','KZ','UA','PL','DE','FR','ES','IT','CZ','SK','HU','AT','CH','BE',
  'NL','RO','BG','RS','LT','LV','EE','BY','MD','DK','SE','KR','JP','VN','TH',
  'MY','AU','GB','IE','PT','MA','DZ','TN','IQ','IR','UZ','TM','AF','MN',
]);
function groundRampFactor(o, d, dist) {
  if (dist >= GROUND_RAMP_KM) return 1;
  if (isIsolated(o) || isIsolated(d)) return 1;
  if (!CONTIGUOUS_GROUND.has(o.country) || !CONTIGUOUS_GROUND.has(d.country)) return 1;
  const t = Math.max(0, (dist - 80) / (GROUND_RAMP_KM - 80));
  return 0.2 + 0.8 * t * t;
}

/**
 * Combined captivity/air-reliance multiplier for a pair.
 * max(islandCaptivity, domesticAirReliance) — see note above.
 */
export function captivityFactor(o, d, dist) {
  const domestic = o.country === d.country;
  let island = 1;
  if (isIsolated(o) || isIsolated(d)) {
    const boost = domestic ? CAPTIVITY_BOOST : CAPTIVITY_BOOST_INTL;
    const t = Math.max(0, Math.min(1,
      (CAPTIVITY_ZERO_KM - dist) / (CAPTIVITY_ZERO_KM - CAPTIVITY_FULL_KM)));
    island = 1 + (boost - 1) * t;
  }
  const reliance = domestic
    ? (AIR_RELIANT_DOMESTIC[o.country] ?? DEFAULT_AIR_RELIANCE)
    : 1;
  return Math.max(island, reliance);
}

/**
 * Base weekly one-way demand for a city pair at the reference price.
 * Airport populations are in millions (metro area).
 */
/**
 * Same-metro airport groups, kept as a derived view of data/metros.js for any
 * external consumer that still wants the raw code lists. The registry is the
 * single source of truth — edit metros.js, not this.
 */
export const METRO_GROUPS = METROS.map((m) => Object.keys(m.members));

/**
 * Two airports serve the same metro area when the metro registry says so, or as
 * a backstop when they sit within a few km of each other. Same-metro pairs
 * carry no real origin–destination air demand — nobody flies across town — so
 * their demand is suppressed entirely. Examples: JFK–EWR–LGA, LHR–LGW–LCY.
 *
 * The old city-string rule ("same country + same city field") is deliberately
 * GONE: it zeroed demand between same-NAME different-CITY pairs — Columbus OH
 * vs Columbus GA (CMH–CSG), the Norfolks (ORF–OFK), the Albanys (ALB–ABY), the
 * Augustas (AGS–AUG), the Watertowns (ART–ATY) and the three Greenvilles
 * (GSP/PGV/GLH). Every genuine shared-city metro is in the registry instead.
 * The distance backstop is deliberately small so genuine short water/island
 * hops (which have no road alternative) keep their demand.
 */
export const SAME_METRO_MAX_KM = 35;
export function isSameMetro(o, d, dist) {
  if (!o || !d) return false;
  if (o.code && d.code && sameMetroCodes(o.code, d.code)) return true;
  const km = dist != null ? dist : distanceKm(o, d);
  return km < SAME_METRO_MAX_KM;
}

// ─── Metro-level demand endpoints ─────────────────────────────────────────────
// A multi-airport metro is priced as ONE demand endpoint: the largest member
// mass and the strongest member attractiveness stand in for the whole metro.
// Priced at the members' shared data rather than any single field's, so
// baseCityPairDemand(EWR, LGW) === baseCityPairDemand(JFK, LHR): one member
// pair per metro pair, one market. The tick then runs ONE share fight over that
// market for all member pairs (see the metro pre-pass in simulation.js) —
// which is what kills the old N-airport-pairs × full-metro-demand duplication.

/** Cached member airport records per metro id (data never changes at runtime). */
const _metroMembersCache = new Map();
function metroMemberRecords(metro) {
  let recs = _metroMembersCache.get(metro.id);
  if (!recs) {
    recs = Object.keys(metro.members)
      .map((code) => getAirport(code))
      .filter(Boolean);
    _metroMembersCache.set(metro.id, recs);
  }
  return recs;
}

/** Demand mass of a metro: its heaviest member (masses are metro-wide already). */
function metroDemandMass(metro, domesticPair) {
  let best = 0;
  for (const ap of metroMemberRecords(metro)) {
    const m = getDemandMass(ap, domesticPair);
    if (m > best) best = m;
  }
  return best;
}

/** Attractiveness of a metro: its strongest member profile. */
function metroDemandMultiplier(metro) {
  let best = 0;
  for (const ap of metroMemberRecords(metro)) {
    const m = demandMultiplier(ap.code);
    if (m > best) best = m;
  }
  return best;
}

export function baseCityPairDemand(originCode, destCode) {
  const o = getAirport(originCode);
  const d = getAirport(destCode);
  if (!o || !d) return 0;
  // No real O&D demand between two airports serving the same metro area.
  // (Checked on the REAL airports — the primaries of two different metros are
  // never same-metro, and same-metro members must short-circuit before pricing.)
  if (isSameMetro(o, d, distanceKm(o, d))) return 0;

  // Price the pair at the metro primaries: every member pair of the same metro
  // pair must return the SAME total market. Distance, country, captivity and
  // border all use the primaries so the total is exactly member-independent.
  const mO = metroOf(originCode);
  const mD = metroOf(destCode);
  const po = mO ? getAirport(mO.primary) ?? o : o;
  const pd = mD ? getAirport(mD.primary) ?? d : d;
  const dist = distanceKm(po, pd);

  // Demand mass generalises population: it adds tourism + national-gateway pull for
  // airports that population alone under-rates. `effectivePop` overrides stay intact,
  // and any airport without the new fields keeps mass === population (no change).
  // Metro endpoints take their heaviest member's mass (each member already
  // carried the metro-wide figure) and their strongest member's attractiveness.
  const domesticPair = po.country === pd.country;
  const popO = mO ? metroDemandMass(mO, domesticPair) : getDemandMass(o, domesticPair);
  const popD = mD ? metroDemandMass(mD, domesticPair) : getDemandMass(d, domesticPair);

  // Business/leisure attractiveness multiplier — cities that are strong corporate
  // or tourism destinations generate more demand than population alone implies.
  const multO = mO ? metroDemandMultiplier(mO) : demandMultiplier(originCode);
  const multD = mD ? metroDemandMultiplier(mD) : demandMultiplier(destCode);

  // Metro demand lift. Benchmarked against metro-AGGREGATED real O&D (sum over
  // member airport pairs — bench.mjs `metroX` column), pairs between big
  // multi-airport metros systematically undershot at 0.44–0.60: a metro that
  // needed five airports built generates more travel than even its largest
  // member's mass implies. Each side contributes sqrt(lift), like every other
  // endpoint factor under the gravity sqrt. Single-airport endpoints lift 1.

  // Country propensity-to-fly: full strength on international pairs, softened
  // on domestic ones (see COUNTRY_PROPENSITY). Enters under the sqrt so the
  // effective pair factor is sqrt(pO·pD).
  const domestic = domesticPair;
  let pO = COUNTRY_PROPENSITY[po.country] ?? DEFAULT_PROPENSITY;
  let pD = COUNTRY_PROPENSITY[pd.country] ?? DEFAULT_PROPENSITY;
  if (domestic) {
    pO = Math.pow(pO, DOMESTIC_PROPENSITY_EXP);
    pD = Math.pow(pD, DOMESTIC_PROPENSITY_EXP);
  }

  // Border friction (1.0 domestic), air-captivity boost, short-hop ground ramp —
  // all at the primaries, so member pairs cannot disagree about the total.
  const border  = borderFactor(po, pd);
  const captive = captivityFactor(po, pd, dist);
  const ground  = groundRampFactor(po, pd, dist);

  // Gravity model with softened distance decay (exponent 1.1 vs. the classic 1.5).
  // The gentler exponent reflects that above ~5,000 km there are no alternatives to
  // flying, so demand doesn't decay as steeply as in short-haul markets where trains
  // and driving compete. (Audited 2026-07 — the distance curve matched real long-haul
  // vs short-haul ratios well and was deliberately left unchanged.)
  //
  // Multiplier 1,900 calibrated against real-world 2025 O&D benchmarks
  // (docs/DEMAND_MODEL_AUDIT.md; 47 pairs, geometric-mean model/real ≈ 1.0).
  // Reference points (one-way pax/wk, total market across all carriers):
  //   GMP-CJU  (451 km, captive island + 13M visitors)   → ~104,000  (real ~111,000)
  //   HND-CTS  (819 km, captive island)                  → ~105,000  (real ~91,000)
  //   JED-RUH  (853 km, SA air-reliant domestic)         →  ~66,000  (real ~73,000)
  //   SGN-HAN  (1,160 km, VN air-reliant + gateway mass) →  ~84,000  (real ~75,000)
  //   ORD-LGA  (1,177 km)                                →  ~21,000  (real ~24,000)
  //   JFK-LAX  (3,975 km)                                →  ~16,600  (real ~23,000)
  //   JFK-LHR  (5,540 km, US-GB affinity 0.85)           →  ~15,400  (real ~21,000)
  //   SIN-LHR  (10,880 km)                               →  ~11,300  (real ~9,700)
  //   DAC-DEL  (1,426 km, low propensity + IN-BD 0.45)   →   ~3,500  (real ~2,400)
  const lift = Math.sqrt((mO?.lift ?? 1) * (mD?.lift ?? 1));

  return Math.round(
    (Math.sqrt(popO * multO * pO * popD * multD * pD) * 1900 * border * captive * ground * lift)
      / Math.pow(1 + dist / 3000, 1.1)
  );
}

/** Distance in km between two airport codes. Returns 0 if either unknown. */
export function routeDistance(originCode, destCode) {
  const o = getAirport(originCode);
  const d = getAirport(destCode);
  return o && d ? Math.round(distanceKm(o, d)) : 0;
}

/**
 * Market reference price for a route ($ one-way, economy).
 * Players can price above or below this — demand adjusts via elasticity.
 */
export function referencePrice(originCode, destCode) {
  const o = getAirport(originCode);
  const d = getAirport(destCode);
  if (!o || !d) return 200;
  const dist = distanceKm(o, d);
  // Reference fares trimmed 13% below baseline to tighten yields and make
  // sustained profitability harder (was −8%, −5%, originally +10%). Part of the
  // load-factor rebalance — lower yields mean revenue no longer swamps cost at
  // low load, so a typical route must fill ~65% to break even.
  return Math.round((80 + dist * 0.09) * 0.87);
}

// ─── Market capitalisation ─────────────────────────────────────────────────────

/** Fixed share count used for all airlines (player + competitors). */
export const TOTAL_SHARES = 100_000_000;

/**
 * Published-price smoothing (ported from Headwinds 2026-07-29).
 *
 * The valuation below is a FAIR VALUE — what the airline is worth on this week's
 * fundamentals. Publishing it directly as the market cap means the printed number
 * teleports: one good week, a loan draw or an asset sale moves it by whatever the
 * model says, with nothing in between. Headwinds hit this in its ugliest form (a
 * company printed a +8383% weekly move) and the fix is the same here — the
 * published cap CONVERGES toward fair value inside a weekly band instead of
 * jumping to it.
 *
 * The band widens with the size of the gap on purpose. A flat band is not
 * smoothing, it is a governor: an airline growing faster than the band could never
 * catch its own fair value, and its printed cap would stop carrying any
 * information about the business. So ordinary weeks move at most 8%, and a genuine
 * re-rating converges in a handful of weeks rather than never.
 *
 * NOTE this changes the PATH of the number, not its level — the fair-value math
 * below is untouched, so where a valuation settles is exactly what it was before.
 */
export const MARKET_CONVERGENCE     = 0.30;   // weekly pull toward fair value
export const WEEKLY_MOVE_CLAMP      = 0.08;   // resting band: max ±move per week
export const MOVE_CLAMP_MAX         = 0.35;   // widest catch-up band, however far off
export const MOVE_CLAMP_GAP_POW     = 0.5;    // band scales with gap^this (sqrt)
export const MIN_MARKET_CAP         = 500_000;

/**
 * Liquidation floor — an airline is never worth less than the money in its bank.
 *
 * The going-concern formula below values a loss-maker at `annualLoss x 5`, which
 * can drag fair value straight through the floor even when the company is sitting
 * on a mountain of cash. That produced a real exploit: a budget carrier bleeding
 * money but holding $67M printed the $500K minimum cap, so it could be ACQUIRED
 * for $625K — and the buyer inherited the $67M. Free money.
 *
 * Net cash is the hard floor for equity value: a shareholder facing a lower price
 * would liquidate instead. Losses can pull a company down TO its cash pile, never
 * below it. (Negative cash leaves only MIN_MARKET_CAP, which is correct — a
 * carrier in the red is worth the option value of its licences and nothing more.)
 */
export const NET_CASH_FLOOR = 1.0;

/**
 * Weekly move band, given how far the published print sits from fair value.
 *
 *   gap 1x   ->  8.0%   (an ordinary week — unchanged)
 *   gap 4x   -> 16.0%
 *   gap 19x+ -> 35.0%   (MOVE_CLAMP_MAX)
 *
 * Symmetric: a collapse reprices exactly as fast as a re-rating.
 */
export function moveClampFor(prevMarketCap, fairValue) {
  const p = Number(prevMarketCap), f = Number(fairValue);
  if (!(p > 0) || !(f > 0)) return WEEKLY_MOVE_CLAMP;
  const gap = Math.max(f / p, p / f);
  return Math.min(MOVE_CLAMP_MAX, WEEKLY_MOVE_CLAMP * Math.pow(gap, MOVE_CLAMP_GAP_POW));
}

/**
 * Apply the convergence + clamp to a fair value, given last week's print.
 *
 * Without a previous print (a cold valuation — save-load fallbacks, acquisition
 * pricing, a brand-new airline) the fair value is published as-is, which is the
 * only sensible thing to do when there is no series to smooth.
 */
export function publishMarketCap(fairValue, prevMarketCap, noise = 0) {
  const fair = Math.max(Number(fairValue) || 0, MIN_MARKET_CAP);
  if (!(Number.isFinite(prevMarketCap) && prevMarketCap > 0)) return fair;
  const target  = prevMarketCap + MARKET_CONVERGENCE * (fair - prevMarketCap);
  const band    = moveClampFor(prevMarketCap, fair);
  const clamped = Math.min(prevMarketCap * (1 + band),
                           Math.max(prevMarketCap * (1 - band), target));
  const n = Number.isFinite(noise) ? noise : 0;
  return Math.max(clamped * (1 + n), MIN_MARKET_CAP);
}

/**
 * Compute market capitalisation and share price for an airline.
 *
 * @param {number[]} profitHistory  Weekly profit figures, most-recent last (up to last 12 used).
 * @param {number}   cash           Current cash balance.
 * @param {number}   [qualityScore] 0–100 quality/reputation score; defaults to 50.
 * @returns {{ marketCap: number, sharePrice: number, peMultiple: number|null,
 *             annualizedProfit: number|null, growthRate: number|null }}
 */
/**
 * @param {number[]} profitHistory  Weekly profit figures, most-recent last (last 12 used).
 * @param {number}   cash           Current cash balance.
 * @param {number}   [qualityScore] 0–100 quality/reputation score.
 * @param {object}   [extras]
 * @param {number}   [extras.prevMarketCap]  Last week's PUBLISHED cap. Supplying it turns on
 *                                           convergence + the move clamp; omitting it returns
 *                                           the raw fair value (cold valuation).
 * @param {number}   [extras.noise]          Optional pre-rolled noise fraction. Tailwinds does
 *                                           not pass one — a solo game keeps a deterministic
 *                                           tick, and the smoothing is the substance here.
 * @returns {{ marketCap, sharePrice, peMultiple, annualizedProfit, growthRate, fairValue }}
 */
export function computeMarketCap(profitHistory, cash, qualityScore = 50, extras = {}) {
  const { prevMarketCap = null, noise = 0 } = extras;
  const weeks = (profitHistory ?? []).slice(-12);

  // Not enough history — value purely on cash
  if (weeks.length < 2) {
    const fairValue = Math.max(cash * 1.5, MIN_MARKET_CAP);
    const marketCap = publishMarketCap(fairValue, prevMarketCap, noise);
    return {
      marketCap, sharePrice: marketCap / TOTAL_SHARES,
      peMultiple: null, annualizedProfit: null, growthRate: null, fairValue,
    };
  }

  const trailing12Profit  = weeks.reduce((s, p) => s + p, 0);
  const annualizedProfit  = Math.round(trailing12Profit * (52 / weeks.length));

  // Growth: compare avg of most-recent 6 weeks vs avg of the prior window
  const recentSlice = weeks.slice(-6);
  const priorSlice  = weeks.slice(0, Math.max(0, weeks.length - 6));
  const recentAvg   = recentSlice.reduce((s, p) => s + p, 0) / recentSlice.length;
  const priorAvg    = priorSlice.length > 0
    ? priorSlice.reduce((s, p) => s + p, 0) / priorSlice.length
    : 0;
  const growthRate  = priorAvg !== 0
    ? (recentAvg - priorAvg) / Math.abs(priorAvg)
    : (recentAvg > 0 ? 0.5 : 0);

  // P/E multiple: base 12, ±growth bonus (−5 to +15), +quality bonus (0–5)
  const growthBonus     = Math.max(-5, Math.min(15, growthRate * 20));
  const reputationBonus = (Math.max(0, Math.min(100, qualityScore)) / 100) * 5;
  const peMultiple      = 12 + growthBonus + reputationBonus;

  // Profitable companies get full P/E; loss-making ones get 5× (distressed)
  const profitComponent = annualizedProfit >= 0
    ? annualizedProfit * peMultiple
    : annualizedProfit * 5;

  // Fair value — the level. Untouched by the smoothing port.
  const fairValue  = Math.max(profitComponent + cash * 0.8,
                              cash * NET_CASH_FLOOR,      // liquidation floor
                              MIN_MARKET_CAP);
  // Published cap — the path. Converges toward fair value inside the weekly band.
  const marketCap  = publishMarketCap(fairValue, prevMarketCap, noise);
  const sharePrice = marketCap / TOTAL_SHARES;

  return {
    marketCap,
    sharePrice,
    peMultiple:       Math.round(peMultiple * 10) / 10,
    annualizedProfit,
    growthRate,
    fairValue,
  };
}

// ─── Cargo demand ───────────────────────────────────────────────────────────────
//
// A parallel gravity model for air freight, deliberately structured like the
// passenger model above but with three differences (see docs/cargo-design.md):
//
//   1. Mass driver is TRADE, not population/tourism — keyed off cargoScore.
//   2. Distance behaves differently: short-haul air freight is SUPPRESSED (trucks
//      compete under ~1,500 km), while long-haul decays only gently (a box doesn't
//      care about a 14-hour flight). So demand peaks in the medium-to-long range.
//   3. Output unit is tonnes/week, not passengers.
//
// Demand is computed symmetrically for v1 but the function is DIRECTIONAL by
// signature (o,d are not sorted) so headhaul/backhaul imbalance can be layered in
// later without changing call sites or storage.

/** Gravity constant — calibrated so HKG–LAX ≈ 1,500 tonnes/week one-way. */
export const CARGO_GRAVITY_K = 23;

/** Short-haul half-saturation (km): trucking competition halves air demand here. */
export const CARGO_TRUCK_HALF_KM = 1500;

/** Long-haul decay scale (km) and exponent — gentle, freight is time-insensitive. */
export const CARGO_DECAY_KM  = 6000;
export const CARGO_DECAY_EXP = 0.5;

/**
 * Cargo "mass" for one airport: how much air freight it generates/attracts.
 * Primarily its cargoScore (0–100), modestly scaled by the size of the surrounding
 * economy (a high-score airport in a huge metro ships more than the same score in a
 * small one). Pure-freight hubs with tiny populations (ANC, MEM) keep most of their
 * weight via the 0.5 floor.
 *
 * @param {string} code
 * @returns {number}
 */
export function getCargoMass(code) {
  const ap    = getAirport(code);
  if (!ap) return 0;
  const score = getAirportCargoScore(code);
  // Economy factor uses RESIDENT mass only (population / effectivePop) — the
  // tourism `visitors` terms in getDemandMass drive passenger demand, not
  // freight. Tourists don't ship cargo (Las Vegas is not a freight hub).
  const residentMass = Math.max(ap.population ?? 0, ap.effectivePop ?? 0);
  const econ  = Math.max(0.5, Math.min(1.8, Math.sqrt(residentMass / 8)));
  return score * econ;
}

// ─── Cargo seasonality ──────────────────────────────────────────────────────
// Air freight has a season, and it is not the passenger one. Peak is Q4 — the
// retail build for Christmas moves by air from roughly September, tops out in
// November and tails off once the shelves are full. The deep trough is
// February: Asian factories shut for New Year and the biggest single source of
// airfreight in the world stops for a fortnight. Summer, when passenger demand
// is at its highest, is a quiet month on the freight deck.
//
// Multipliers average to exactly 1.0 across the year, so the annual tonnage a
// lane produces is unchanged — only its distribution.

/** Freight seasonality by month (1-indexed). Mean = 1.000. */
export const CARGO_SEASONAL_PROFILE =
  [null, 0.86, 0.78, 0.93, 0.97, 1.00, 0.96, 0.90, 0.92, 1.08, 1.20, 1.30, 1.10];

/**
 * Freight seasonal multiplier for a month. Out-of-range or missing → 1 (the
 * annual average), so a caller that has no calendar isn't punished for it.
 *
 * @param {number} month 1–12
 * @returns {number}
 */
export function cargoSeasonalFactor(month) {
  const m = Math.round(Number(month));
  if (!Number.isFinite(m) || m < 1 || m > 12) return 1;
  return CARGO_SEASONAL_PROFILE[m];
}

// ─── Backhaul imbalance ─────────────────────────────────────────────────────
// Freight is directional in a way passengers are not: a passenger who flies out
// flies home, a television does not. Lanes out of a manufacturing centre into a
// consuming one run full one way and hunt for anything at all on the return —
// which is why belly rates on the headhaul and the backhaul of the same lane
// can differ by a factor of three. A lane between two comparable freight
// economies is close to balanced.
//
// The imbalance falls out of the same cargo masses that generate the demand:
// the closer the two ends are in freight weight, the fuller the return leg.

/** Return-leg revenue fraction on the most lopsided lane in the world. */
export const CARGO_BACKHAUL_MIN = 0.30;
/** …and on a perfectly matched pair. */
export const CARGO_BACKHAUL_MAX = 0.80;

/**
 * Return-leg revenue fraction for one lane. Symmetric (a lane is as imbalanced
 * viewed from either end), and falls back to CARGO_BACKHAUL_FACTOR's historical
 * 0.65 when either end's freight mass is unknown.
 *
 * @param {string} originCode
 * @param {string} destCode
 * @returns {number} CARGO_BACKHAUL_MIN … CARGO_BACKHAUL_MAX
 */
export function cargoBackhaulFactor(originCode, destCode) {
  const mo = getCargoMass(originCode);
  const md = getCargoMass(destCode);
  if (!(mo > 0) || !(md > 0)) return 0.65;
  const ratio = Math.min(mo, md) / Math.max(mo, md);   // 1 = perfectly matched
  return Math.round(
    (CARGO_BACKHAUL_MIN + (CARGO_BACKHAUL_MAX - CARGO_BACKHAUL_MIN) * ratio) * 1000) / 1000;
}

/**
 * Base weekly one-way cargo demand for a city pair, in tonnes, at reference yield.
 * Symmetric (o,d order does not change the result) — the DIRECTIONAL half of
 * freight lives in cargoBackhaulFactor, not here.
 *
 * @param {string} originCode
 * @param {string} destCode
 * @param {number} [month]  game month 1–12 for freight seasonality. Omit for the
 *                          annual average (route-finder scans, unit tests).
 * @returns {number} tonnes/week (one-way)
 */
export function cargoCityPairDemand(originCode, destCode, month = null) {
  const o = getAirport(originCode);
  const d = getAirport(destCode);
  if (!o || !d) return 0;

  const dist = distanceKm(o, d);
  // No air-cargo demand within a single metro area (trucked, not flown).
  if (isSameMetro(o, d, dist)) return 0;
  const massO = getCargoMass(originCode);
  const massD = getCargoMass(destCode);

  // Short-haul suppression (trucks compete) × gentle long-haul gravity decay.
  const truckFactor = dist / (dist + CARGO_TRUCK_HALF_KM);
  const decay       = Math.pow(1 + dist / CARGO_DECAY_KM, CARGO_DECAY_EXP);
  const distFactor  = truckFactor / decay;

  const seasonal = month == null ? 1 : cargoSeasonalFactor(month);
  return Math.round(Math.sqrt(massO * massD) * CARGO_GRAVITY_K * distFactor * seasonal);
}

// ─── Cargo pricing ──────────────────────────────────────────────────────────────

/** Reference yield bounds and curve ($ per tonne-km). */
export const CARGO_YIELD_BASE  = 1.19;     // intercept of the linear curve
export const CARGO_YIELD_SLOPE = 6.8e-5;   // $/tonne-km lost per km of stage length
export const CARGO_YIELD_CAP   = 1.10;     // short-haul ceiling
export const CARGO_YIELD_FLOOR = 0.40;     // long-haul floor

/**
 * Market reference yield for a route, in $ per tonne-km (one-way).
 * Yield is HIGHER on short routes (fixed handling cost amortised over fewer km) and
 * lower on long-haul — the inverse of the passenger fare curve. Total reference
 * revenue per tonne = cargoReferenceYield(o,d) × distanceKm.
 *
 *   e.g.  ~1,300 km → ~$1.10/tonne-km → ~$1,430/tonne (~$1.43/kg)
 *        ~11,640 km → ~$0.40/tonne-km → ~$4,656/tonne (~$4.66/kg)
 *
 * @param {string} originCode
 * @param {string} destCode
 * @returns {number} $/tonne-km
 */
export function cargoReferenceYield(originCode, destCode) {
  const dist = routeDistance(originCode, destCode);
  const raw  = CARGO_YIELD_BASE - CARGO_YIELD_SLOPE * dist;
  return Math.round(Math.max(CARGO_YIELD_FLOOR, Math.min(CARGO_YIELD_CAP, raw)) * 1000) / 1000;
}

/** Convenience: reference revenue per tonne ($, one-way) on a route. */
// ─── Load-factor realism (spill against an achievable ceiling + weekly variance) ──
//
// Every route simulator filled seats with a flat min(demand, capacity), so the
// moment weekly demand exceeded weekly seats the airline banked EVERY seat —
// 100.0% load factor, forever, in both directions. Real airlines sit at ~83%
// system load factor *while* their best flights sell out, because demand
// arrives per departure, per day and per direction and you size for the peak:
// Friday is full, Tuesday is 60%. Pooling a week into one number erases that
// entirely, and it is the single biggest term in mature margins running several
// times reality. No cost rate fixes it — the per-unit costs are right; the
// denominator was inflated.
//
// Three parts:
//
//   1. A structural ceiling. Only LOAD_CEILING of a week's seats are
//      ACHIEVABLE, standing in for day-of-week peaking and directional
//      imbalance that more demand never cures.
//   2. Spill against that ceiling. Per-departure demand is treated as
//      Normal(D, DEMAND_CV·D) and seats sold are E[min(N, C)] through the
//      standard normal loss function — closed form, no RNG. A deeply
//      oversubscribed route asymptotes to the ceiling; a route at demand ≈
//      capacity lands near 87%; a route running 60% full loses well under a
//      point. It only bites full aeroplanes, which is the progressive shape a
//      flat trim could never have.
//   3. Weekly variance. A deterministic per-route-per-week jitter of up to
//      ±LOAD_JITTER, hashed from the route key and the absolute week. No
//      Math.random, so a save replays identically. A sold-out route breathes
//      between roughly 92.6% and 97.4% instead of pinning at a constant.
//
// Parts 1 and 2 are structural and apply everywhere, including in previews —
// a forecast that promises 100% on a route the tick will fill to 93% is the
// same lie in a nicer font. Part 3 is applied only by the tick: a forecast
// should show the expected week, not a specific week's dice. That is a bounded,
// symmetric ±2.5% and the suite asserts the bound rather than ignoring it.

/** The share of a week's seats that is actually sellable. */
export const LOAD_CEILING = 0.95;

/** Half-width of the weekly load variance. */
export const LOAD_JITTER = 0.025;

/**
 * Per-departure demand spread, as a coefficient of variation. At 0.30 a route
 * with demand exactly equal to capacity lands at 85.4%, which reads as too
 * harsh for a route the airline sized correctly; 0.25 puts parity near 87% and
 * leaves the oversubscribed asymptote at the ceiling.
 */
export const DEMAND_CV = 0.25;

/** Standard normal pdf. */
const _phi = (z) => Math.exp(-0.5 * z * z) / Math.sqrt(2 * Math.PI);

/** Standard normal cdf (Abramowitz–Stegun 7.1.26, |err| < 1.5e-7). */
function _Phi(z) {
  const t = 1 / (1 + 0.2316419 * Math.abs(z));
  const poly = t * (0.319381530 + t * (-0.356563782 + t * (1.781477937 +
               t * (-1.821255978 + t * 1.330274429))));
  const p = 1 - _phi(Math.abs(z)) * poly;
  return z >= 0 ? p : 1 - p;
}

/**
 * Expected seats sold when demand ~ Normal(demand, cv·demand) meets a hard
 * capacity: E[min(X, cap)] = D − σ·L(z), where L(z) = φ(z) − z·(1 − Φ(z)).
 * Always ≤ min(demand, cap), and ≈ demand when demand is well under capacity.
 */
export function expectedCarried(demand, cap, cv = DEMAND_CV) {
  const D = Math.max(0, Number(demand) || 0);
  const C = Math.max(0, Number(cap) || 0);
  if (D <= 0 || C <= 0) return 0;
  const sigma = cv * D;
  if (sigma <= 0) return Math.min(D, C);
  const z = (C - D) / sigma;
  const loss = _phi(z) - z * (1 - _Phi(z));
  return Math.max(0, Math.min(C, D - sigma * loss));
}

/**
 * This week's load multiplier for one route, in [1 − LOAD_JITTER, 1 + LOAD_JITTER].
 * Keyed on (route key, absolute week) through FNV-1a with a murmur3 finalizer.
 * Deterministic: the same save replays to the same numbers.
 */
export function weeklyLoadJitter(routeKey, absWeek) {
  const s = `${routeKey}|${Math.floor(Number(absWeek) || 0)}`;
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  // FNV-1a alone clusters here: for near-identical keys ("r0|31" vs "r0|32")
  // the difference never leaves the low bits, and the division below reads the
  // HIGH bits — every week would land at ~0.5 and nothing would vary. The
  // finalizer avalanches the low bits across the whole word.
  h ^= h >>> 16; h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13; h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  const u = (h >>> 0) / 0xffffffff;
  return 1 - LOAD_JITTER + 2 * LOAD_JITTER * u;
}

/**
 * The factor a route's demand is scaled by: spill against the achievable
 * ceiling, times this week's jitter, never above physical capacity.
 *
 * @param {number} demand    one-way weekly demand
 * @param {number} capacity  one-way weekly seats (or tonnes)
 * @param {number} jitter    1 for the expected week (previews); the tick passes
 *                           weeklyLoadJitter()
 */
export function loadDemandScale(demand, capacity, jitter = 1) {
  const D = Math.max(0, Number(demand) || 0);
  const C = Math.max(0, Number(capacity) || 0);
  if (D <= 0 || C <= 0) return 1;
  const carried = expectedCarried(D, C * LOAD_CEILING) * (Number(jitter) || 1);
  return Math.min(carried, C) / D;
}

export function cargoReferenceRevenuePerTonne(originCode, destCode) {
  return Math.round(cargoReferenceYield(originCode, destCode) * routeDistance(originCode, destCode));
}
