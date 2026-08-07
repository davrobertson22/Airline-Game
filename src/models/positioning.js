// ─────────────────────────────────────────────────────────────────────────────
// BRAND POSITIONING — where an airline sits on leisure↔business / budget↔premium
//
// The Reputation tab draws a two-axis map of the market with the player's dot on
// it. Until now the rest of the market was three literals:
//
//     { id: 'zoomjet',   x: 0.28, y: 0.12 }
//     { id: 'globalair', x: 0.58, y: 0.55 }
//     { id: 'apexair',   x: 0.82, y: 0.88 }
//
// Those are not invented brands — all three are real carriers in the roster. The
// problem is worse than that they never move. A world samples 25 carriers out of
// 70, so over 400 sampled worlds only 1.46 of the three labelled rivals actually
// EXIST on average; 14.5% of games plot three competitors none of which the
// player will ever meet, and only 10.8% get all three. Meanwhile the 25 carriers
// that ARE out there — with live networks, live fares and live quality — went
// unplotted.
//
// This module computes both dots from state instead. The player's and a rival's
// coordinates go through the SAME final arithmetic (`positionFrom`), so the two
// are comparable by construction rather than by coincidence.
//
// ── What each axis reads, and the one place the two carriers differ ──────────
// X (leisure → business) wants "how much of this airline's floor is premium
// cabin". For the player that is their actual seat map. A rival has no cabin
// config at all — an AI tail is { id, typeId, routeKey, ageWeeks } and nothing
// more — so their premium fraction comes from `competitorBusinessFraction`,
// which is the engine's own answer to the same question: it is the number
// `buildCompetitorOffer` uses to carve a J cabin out of that rival's capacity
// when it competes against you. Not a stand-in for the real figure; it IS the
// figure the market model uses.
//
// Y (budget → premium) wants price premium and product. Price is real on both
// sides: the player's fare against the reference, the rival's `priceMultiplier`,
// which is literally their pricing decision. Product is the one honest seam.
// The player's is a cabin average on 0–1 where standard/standard is 0.4; a
// rival's is `baseQualityScore` on the demand model's 0–100. The two scales
// agree on exactly one point — the neutral product — and that is what we pin
// them together at: 65 is the documented neutral in demand.js (both
// businessQualityCapture and businessFareTolerance pivot there) and 0.4 is a
// standard cabin. Either side of that the slope is set by the roster's own
// observed spread, read at load rather than hardcoded, so re-tuning a carrier's
// quality cannot silently squash the axis.
// ─────────────────────────────────────────────────────────────────────────────

import { referencePrice, routeDistance } from '../utils/market.js';
import { getAircraftType } from '../data/aircraft.js';
import { COMPETITOR_AIRLINES, competitorBusinessFraction } from './demand.js';

const clamp01 = (v) => Math.max(0, Math.min(1, v));

/** Direction-agnostic pair key. Mirrors routePairKey in utils/simulation.js. */
const pairKey = (a, b) => [a, b].sort().join('-');

/**
 * The fare actually charged on a route.
 *
 * Price belongs to the O&D PAIR and lives in state.routePricing; `route.ticketPrice`
 * on the raw state.routes array is only a default that hydrateRoute() overwrites
 * before the engine ever sees it. Reading the raw field — which is what this chart
 * did — means every reprice is invisible: a player who took all their fares to a
 * 60% premium through the Routes tab watched their own dot not move.
 */
function routeFare(state, route) {
  const priced = state?.routePricing?.[pairKey(route.origin, route.destination)];
  return priced?.economy ?? route.ticketPrice ?? 0;
}

// ── The shared product scale ────────────────────────────────────────────────

/** The demand model's neutral quality. See businessQualityCapture in demand.js. */
export const NEUTRAL_QUALITY_SCORE = 65;

/** A standard seat + standard service cabin, on calcPositioning's 0–1 product axis. */
export const NEUTRAL_PRODUCT = 0.4;

/** The roster's actual spread, so the axis follows the data rather than a guess. */
function rosterQualityRange() {
  let lo = Infinity, hi = -Infinity;
  for (const c of COMPETITOR_AIRLINES) {
    const q = Number(c?.baseQualityScore);
    if (!Number.isFinite(q)) continue;
    if (q < lo) lo = q;
    if (q > hi) hi = q;
  }
  return Number.isFinite(lo) && Number.isFinite(hi) ? [lo, hi] : [35, 88];
}
const [QUALITY_FLOOR, QUALITY_CEILING] = rosterQualityRange();

/**
 * A rival's `baseQualityScore` (0–100) on the player's 0–1 cabin-product axis.
 *
 * Piecewise through the neutral point rather than a single slope, because 65 is
 * not centred in the roster's range — one slope would either pile every
 * below-average carrier at zero or leave the best one short of the top.
 */
export function rivalProductQuality(score) {
  // An absent score is an unknown product, not a bad one — and `Number(null)` is
  // 0, which would quietly plant a carrier at the bottom of the axis on the
  // strength of a missing field.
  if (score == null) return NEUTRAL_PRODUCT;
  const q = Number(score);
  if (!Number.isFinite(q)) return NEUTRAL_PRODUCT;
  if (q >= NEUTRAL_QUALITY_SCORE) {
    const span = Math.max(1, QUALITY_CEILING - NEUTRAL_QUALITY_SCORE);
    return NEUTRAL_PRODUCT + (1 - NEUTRAL_PRODUCT) * Math.min(1, (q - NEUTRAL_QUALITY_SCORE) / span);
  }
  const span = Math.max(1, NEUTRAL_QUALITY_SCORE - QUALITY_FLOOR);
  return NEUTRAL_PRODUCT * clamp01((q - QUALITY_FLOOR) / span);
}

// ── The axes ────────────────────────────────────────────────────────────────

/**
 * The final arithmetic, shared by every carrier on the chart. Kept as one
 * function on purpose: the whole point of plotting rivals is to compare them to
 * yourself, which is only meaningful if the same formula drew both dots.
 *
 * @param {{bizCapRatio:number, avgPricePrem:number, avgQuality:number}} inputs
 * @returns {{x:number, y:number, pricePremium:number, bizCapRatio:number}}
 */
export function positionFrom({ bizCapRatio, avgPricePrem, avgQuality }) {
  // X = Leisure (0) ↔ Business (1). Driven by cabin mix and premium pricing.
  const x = clamp01(
    bizCapRatio * 1.5 + (avgPricePrem > 0.2 ? 0.2 : avgPricePrem > 0 ? 0.1 : -0.05) + 0.15
  );
  // Y = Budget (0) ↔ Premium (1). Driven by product quality and price level.
  const y = clamp01(
    avgQuality * 0.65 + Math.max(-0.2, Math.min(0.35, avgPricePrem + 0.3))
  );
  return { x, y, pricePremium: avgPricePrem, bizCapRatio };
}

const CENTRE = { x: 0.5, y: 0.5, pricePremium: 0, bizCapRatio: 0 };

const CABIN_POINTS = { basic: 0, standard: 0.4, premium: 0.7, luxury: 1.0 };
const cabinNorm = (level) => CABIN_POINTS[level ?? 'standard'] ?? 0.4;

/**
 * The player's position, from their own fleet, cabins and fares.
 *
 * @param {object} state
 * @returns {{x:number, y:number, pricePremium:number, bizCapRatio:number}}
 */
export function calcPositioning(state) {
  const fleet  = state?.fleet  ?? [];
  const routes = state?.routes ?? [];
  if (routes.length === 0) return CENTRE;

  let totalSeats = 0, bizFirstSeats = 0, pricePremSum = 0, qualitySum = 0, routeCount = 0;

  for (const route of routes) {
    const aircraft = fleet.find(a => a.id === route.aircraftId);
    const type     = aircraft ? getAircraftType(aircraft.typeId) : null;
    if (!aircraft || !type) continue;

    const cfg = aircraft.config ?? {};
    bizFirstSeats += (cfg.firstClass ?? 0) + (cfg.businessClass ?? 0);
    totalSeats    += type.seats;

    const refP = referencePrice(route.origin, route.destination);
    pricePremSum += (routeFare(state, route) / Math.max(1, refP)) - 1;

    qualitySum += (cabinNorm(cfg.seatQuality) + cabinNorm(cfg.serviceQuality)) / 2;
    routeCount++;
  }

  if (routeCount === 0) return CENTRE;

  return positionFrom({
    bizCapRatio:  totalSeats > 0 ? bizFirstSeats / totalSeats : 0,
    avgPricePrem: pricePremSum / routeCount,
    avgQuality:   qualitySum / routeCount,
  });
}

/**
 * A rival's position, from their live network.
 *
 * @param {object} competitor  an entry from state.competitors
 * @returns {{x:number, y:number, pricePremium:number, bizCapRatio:number}|null}
 *   null for a carrier flying nothing — an airline with no network has no
 *   position, and a dot at the origin would be a claim about a budget leisure
 *   strategy rather than an absence of one.
 */
export function competitorPositioning(competitor) {
  const routes = competitor?.routes ?? {};
  const keys   = Object.keys(routes);
  if (keys.length === 0) return null;

  let bizSum = 0, premSum = 0, n = 0;
  for (const key of keys) {
    const [a, b] = key.split('-');
    const cfg = routes[key] ?? {};
    bizSum  += competitorBusinessFraction(competitor.tier, routeDistance(a, b) ?? 0);
    // priceMultiplier IS an AI carrier's pricing decision — it is stated as a
    // multiple of the reference fare, which is exactly what a premium is.
    premSum += (cfg.priceMultiplier ?? 1) - 1;
    n++;
  }
  if (n === 0) return null;

  return positionFrom({
    bizCapRatio:  bizSum / n,
    avgPricePrem: premSum / n,
    avgQuality:   rivalProductQuality(competitor.baseQualityScore),
  });
}

/**
 * Every rival worth drawing, positioned, and flagged for the ones the player
 * actually meets.
 *
 * Twenty-five dots on a 320×220 chart is a smudge, so the component draws the
 * whole field faintly (that shape is the market, and it is worth seeing) and
 * labels only `contested` carriers — the ones flying a pair the player flies.
 * Those are the names that mean something.
 *
 * @param {object} state
 * @returns {Array<{id, name, tier, quality, routeCount, contested, x, y, pricePremium, bizCapRatio}>}
 */
export function competitorField(state) {
  const mine = new Set((state?.routes ?? []).map(r => pairKey(r.origin, r.destination)));
  const out = [];
  for (const c of state?.competitors ?? []) {
    const pos = competitorPositioning(c);
    if (!pos) continue;
    const keys = Object.keys(c.routes ?? {});
    out.push({
      id: c.id,
      name: c.name,
      tier: c.tier,
      quality: c.baseQualityScore,
      routeCount: keys.length,
      contested: keys.some(k => mine.has(k)),
      ...pos,
    });
  }
  // Contested first, then by network size — the component labels from the front
  // and the order is what decides which names survive a crowded quadrant.
  out.sort((a, b) => (b.contested - a.contested) || (b.routeCount - a.routeCount));
  return out;
}

// ── Strategy naming ─────────────────────────────────────────────────────────

/**
 * The quadrant a position falls in, as a name a player can act on.
 *
 * @param {{x:number,y:number}} pos
 */
export function strategyLabel(pos) {
  const { x, y } = pos;
  if (y >= 0.6 && x >= 0.55) return { name: 'Premium Full-Service', color: '#a98bff', emoji: '💎', description: 'Positioned for business and premium leisure travel. High revenue per seat, brand commands a price premium. Focus on service consistency and business-friendly routes.' };
  if (y >= 0.6 && x <  0.55) return { name: 'Luxury Leisure',       color: '#38d39f', emoji: '🌴', description: 'Upscale but leisure-oriented. Sells a premium holiday experience. Strong in resort routes and seasonal markets. Demand is highly seasonal.' };
  if (y <  0.4 && x >= 0.55) return { name: 'Budget Business',      color: '#3ea6ff', emoji: '💼', description: 'Affordable business travel, think no-frills but reliable on corporate corridors. Works on short-haul business routes with high frequency.' };
  if (y <  0.4 && x <  0.55) return { name: 'Low-Cost Carrier',     color: '#ffb43d', emoji: '✂️', description: 'Volume over margin. Fill planes at low prices, minimise costs everywhere. Works best with high frequency, large fleets, and dense leisure routes.' };
  return { name: 'Mid-Market',               color: '#93a4ba', emoji: '🔄', description: 'Sitting in the middle. Not strongly differentiated yet. Consider pushing toward Premium or Low-Cost, the middle is the hardest place to compete.' };
}
