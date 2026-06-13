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

import { getAirport, getAirportScores } from '../data/airports.js';

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

/**
 * Base weekly one-way demand for a city pair at the reference price.
 * Airport populations are in millions (metro area).
 */
export function baseCityPairDemand(originCode, destCode) {
  const o = getAirport(originCode);
  const d = getAirport(destCode);
  if (!o || !d) return 0;
  const dist = distanceKm(o, d);

  // Use effectivePop where set (major transit hubs whose metro population understates
  // their true demand catchment due to connecting traffic and national gateway roles).
  // Otherwise fall back to metro population.
  const popO = o.effectivePop ?? o.population;
  const popD = d.effectivePop ?? d.population;

  // Business/leisure attractiveness multiplier — cities that are strong corporate
  // or tourism destinations generate more demand than population alone implies.
  const multO = demandMultiplier(originCode);
  const multD = demandMultiplier(destCode);

  // Gravity model with softened distance decay (exponent 1.1 vs. the classic 1.5).
  // The gentler exponent reflects that above ~5,000 km there are no alternatives to
  // flying, so demand doesn't decay as steeply as in short-haul markets where trains
  // and driving compete.
  //
  // Multiplier 1,054 calibrated so JFK-LAX stays at ~9,200 pax/week one-way.
  // Calibration reference points (all one-way, total market across all carriers):
  //   JFK-LAX  (3,975 km, pop 20.1/13.2, mult 1.37/1.34) → ~9,200 pax/wk  ✓
  //   JFK-LHR  (5,540 km, pop 20.1/22eff, mult 1.37/1.37) → ~9,600 pax/wk
  //   DXB-LHR  (5,500 km, pop 18eff/22eff, mult 1.45/1.37) → ~9,400 pax/wk
  //   SIN-LHR  (10,880 km, pop 22eff/22eff, mult 1.40/1.37) → ~6,200 pax/wk
  //   HND-SFO  (8,286 km, pop 37.4/10eff, mult 1.33/1.30) → ~6,200 pax/wk
  //   SFO-DXB  (13,400 km, pop 10eff/18eff, mult 1.30/1.45) → ~3,100 pax/wk
  //   SYD-LAX  (12,060 km, pop 5.3/13.2, mult 1.28/1.34)  → ~2,000 pax/wk
  return Math.round(
    (Math.sqrt(popO * multO * popD * multD) * 1054) / Math.pow(1 + dist / 3000, 1.1)
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
  return Math.round(80 + dist * 0.09);
}

// ─── Market capitalisation ─────────────────────────────────────────────────────

/** Fixed share count used for all airlines (player + competitors). */
export const TOTAL_SHARES = 100_000_000;

/**
 * Compute market capitalisation and share price for an airline.
 *
 * @param {number[]} profitHistory  Weekly profit figures, most-recent last (up to last 12 used).
 * @param {number}   cash           Current cash balance.
 * @param {number}   [qualityScore] 0–100 quality/reputation score; defaults to 50.
 * @returns {{ marketCap: number, sharePrice: number, peMultiple: number|null,
 *             annualizedProfit: number|null, growthRate: number|null }}
 */
export function computeMarketCap(profitHistory, cash, qualityScore = 50) {
  const weeks = (profitHistory ?? []).slice(-12);

  // Not enough history — value purely on cash
  if (weeks.length < 2) {
    const marketCap = Math.max(cash * 1.5, 500_000);
    return { marketCap, sharePrice: marketCap / TOTAL_SHARES, peMultiple: null, annualizedProfit: null, growthRate: null };
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

  const marketCap  = Math.max(profitComponent + cash * 0.8, 500_000);
  const sharePrice = marketCap / TOTAL_SHARES;

  return {
    marketCap,
    sharePrice,
    peMultiple:       Math.round(peMultiple * 10) / 10,
    annualizedProfit,
    growthRate,
  };
}
