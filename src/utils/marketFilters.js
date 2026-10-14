// Fleet → Market lock reasons and the "show only" filters.
//
// Discord, 2026-10-12 (VodkaOnFire): "in fleet -> market, I'd like to be able
// to filter out any aircraft that are no longer in production and/or
// separately any aircraft that is now aging. The list gets a bit wild when you
// get 20 years in to a save. ... some people might appreciate being able to
// filter based on whether aircraft can be leased or not?"
//
// Every filter here asks a question the market already answers somewhere
// else, through the same function, so a chip can never disagree with the card
// it hides:
//
//   * lock / lease-lock reasons — the disabled Buy and Lease buttons. These
//     mirror the reducer's orderDenial() / leaseDenial().
//   * out of production         — the line-closed year (`oop`) that makes a
//     type arrive second-hand (aircraftAvailability 'used').
//   * dated design              — designAgeQualityPts() < 0, the same score
//     behind the market's "Dated design" badge and the quality penalty the
//     simulation charges. Era worlds only: classic worlds never date.
//
// Pure (no React, no state) so the rules can be tested without a renderer.

import { aircraftAvailability, isVintage, lessorFirstYear } from '../data/aircraft.js';
import { designAgeQualityPts } from '../models/demand.js';

// Classic worlds are frozen at 2026 (see isVintage in data/aircraft.js).
const CLASSIC_YEAR = 2026;

/** Why the type cannot be bought or leased at all this year, or null. Era worlds only. */
export function marketLockReason(type, calYear) {
  if (calYear == null) return null;
  if ((type?.eis ?? 0) > calYear) return `Enters service ${type.eis}`;
  if (aircraftAvailability(type, calYear) === 'expired') return `No airworthy frames left — line closed ${type.oop}`;
  return null;
}

/**
 * Why the type cannot be leased, or null. Classic: vintage metal is buy-only.
 * Era: lessors take a type only 10 years after it enters service.
 */
export function marketLeaseLockReason(type, calYear) {
  return marketLockReason(type, calYear) ?? (calYear == null
    ? (isVintage(type) ? `No lessor stocks it — line closed ${type.oop}. Buy it outright` : null)
    : (calYear < lessorFirstYear(type) ? `Lessors take it from ${lessorFirstYear(type)} — buy new or used until then` : null));
}

/** The production line has closed: any frame bought now is second-hand. */
export function isOutOfProduction(type, calYear) {
  const year = calYear ?? CLASSIC_YEAR;
  return type?.oop != null && year > type.oop;
}

/** Passengers already mark this design down (era worlds only — classic never dates). */
export function isDatedDesign(type, calYear) {
  if (calYear == null) return false;
  return designAgeQualityPts(type, calYear) < 0;
}

export const DEFAULT_MARKET_FILTERS = Object.freeze({
  inProduction: false,   // hide types whose line has closed
  hideDated:    false,   // hide designs passengers already mark down (era only)
  leasable:     false,   // hide types no lessor will lease you right now
});

/** Does `type` survive the active "show only" filters? */
export function passesMarketFilters(type, calYear, filters = DEFAULT_MARKET_FILTERS) {
  if (filters.inProduction && isOutOfProduction(type, calYear)) return false;
  if (filters.hideDated && isDatedDesign(type, calYear)) return false;
  if (filters.leasable && marketLeaseLockReason(type, calYear)) return false;
  return true;
}
