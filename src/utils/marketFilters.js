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
//   * your families             — aircraftFamily(), the grouping the MRO base
//     cost and the fleet-complexity surcharge are charged by. Discord,
//     2026-10-21 (VodkaOnFire): "Add 'Owned by you' filter to airliner market —
//     easier than to scroll through everything when looking to order more of
//     your aircraft families." Family rather than exact type, because that is
//     how he put it and how the game charges it: the A321neo next to your
//     A320neos shares their crews and spares, the 777F your 777s' tooling.
//
// Pure (no React, no state) so the rules can be tested without a renderer.

import { aircraftAvailability, isVintage, lessorFirstYear } from '../data/aircraft.js';
import { designAgeQualityPts } from '../models/demand.js';
import { aircraftFamily } from '../data/families.js';

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
  yourFamilies: false,   // show only families you fly or have on order
});

/** A type's family key — the type itself for the (invariant-violating) unmapped one. */
function familyKeyOf(typeId) {
  return aircraftFamily(typeId) ?? `type:${typeId}`;
}

/**
 * The families your airline flies or has on order, as a Set of family keys.
 * Retired tails do not count; aircraft still on order do — "order more of your
 * aircraft families" includes the ones you have just started.
 */
export function ownedFamilyIds(fleet = [], pendingOrders = []) {
  const s = new Set();
  for (const a of fleet ?? []) if (a?.typeId && a.status !== 'retired') s.add(familyKeyOf(a.typeId));
  for (const o of pendingOrders ?? []) if (o?.typeId) s.add(familyKeyOf(o.typeId));
  return s;
}

/** Is `type` in one of the families in `owned` (a Set from ownedFamilyIds)? */
export function isInYourFamilies(type, owned) {
  return !!type && !!owned && owned.has(familyKeyOf(type.id));
}

/** Does `type` survive the active "show only" filters? */
export function passesMarketFilters(type, calYear, filters = DEFAULT_MARKET_FILTERS, { ownedFamilies = null } = {}) {
  // An airline with nothing yet has no families to narrow to — the chip is not
  // offered then, and a remembered "on" must not empty the market.
  if (filters.yourFamilies && ownedFamilies?.size > 0 && !isInYourFamilies(type, ownedFamilies)) return false;
  if (filters.inProduction && isOutOfProduction(type, calYear)) return false;
  if (filters.hideDated && isDatedDesign(type, calYear)) return false;
  if (filters.leasable && marketLeaseLockReason(type, calYear)) return false;
  return true;
}
