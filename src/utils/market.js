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
