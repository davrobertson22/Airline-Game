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

import { getAirport } from '../data/airports.js';

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
 * Base weekly one-way demand for a city pair at the reference price.
 * Calibrated so a busy domestic (e.g. JFK-LAX) yields ~350 pax/week.
 * Airport populations are in millions (metro area).
 */
export function baseCityPairDemand(originCode, destCode) {
  const o = getAirport(originCode);
  const d = getAirport(destCode);
  if (!o || !d) return 0;
  const dist = distanceKm(o, d);
  // Multiplier calibrated so total market demand is realistic across all carriers:
  //   JFK-LHR (5,540 km, 20M/9.3M)  → ~5,700 pax/week one-way
  //   JFK-LAX (3,975 km, 20M/13.2M) → ~9,200 pax/week one-way
  //   Short regional (700 km, 9.5M/6.2M) → ~11,000 pax/week one-way
  // Player captures a share via computeMarketShare; load factor depends on aircraft size vs share.
  return Math.round(
    (Math.sqrt(o.population * d.population) * 2000) / Math.pow(1 + dist / 3000, 1.5)
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
