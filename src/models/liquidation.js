// ─────────────────────────────────────────────────────────────────────────────
// LIQUIDATION SALES — a failed rival's aircraft, offered to the player.
//
// Smart-rival worlds (state.smartRivalsWorld, new games). A rival that fails a
// second time is closed (competitorAI.js: the first failure is a
// restructuring), and its `bankrupt` event carries its airframes. They are
// listed here for LIQUIDATION_WEEKS at book value — what the same airframe is
// worth on the player's own balance sheet — and delivered the moment they are
// bought: no production-line queue, no factory price. That is the reward for
// having cash when a rival folds.
//
// The price is book value and not a discount to it on purpose. Selling an
// aircraft pays book less a 5% fee, so anything cheaper than book could be
// bought and sold straight back for a profit (the same loop
// competitorAI.FLEET_FLOOR_HAIRCUT closes for whole-airline takeovers).
//
// Pure: the reducer calls these and keeps `state.liquidationLots`.
// ─────────────────────────────────────────────────────────────────────────────

import { getAircraftType } from '../data/aircraft.js';
import { tailBookValue } from '../data/overhead.js';

/** Weeks a failed carrier's aircraft stay on sale. */
export const LIQUIDATION_WEEKS = 8;

/** What one listed airframe costs: its book value at its age. */
export function liquidationPrice(typeId, ageWeeks) {
  const type = getAircraftType(typeId);
  if (!type) return 0;
  return Math.max(0, Math.round(tailBookValue({ typeId, ageWeeks }, type)));
}

/**
 * The lots a week's competitor events put on sale.
 * @param {object[]} events   tickCompetitorAI events; a `bankrupt` one may carry `fleet: [{ typeId, ageWeeks }]`
 * @param {number}   absWeek  the week they are listed
 * @returns {{ id, airlineId, airlineName, typeId, ageWeeks, price, listedAbs, expiresAbs }[]}
 */
export function lotsFromEvents(events, absWeek) {
  const lots = [];
  for (const ev of events ?? []) {
    if (ev?.type !== 'bankrupt' || !Array.isArray(ev.fleet)) continue;
    ev.fleet.forEach((f, i) => {
      const price = liquidationPrice(f.typeId, f.ageWeeks);
      if (!(price > 0)) return;
      lots.push({
        id: `liq-${absWeek}-${ev.airlineId}-${i}`,
        airlineId: ev.airlineId, airlineName: ev.name,
        typeId: f.typeId, ageWeeks: f.ageWeeks ?? 0, price,
        listedAbs: absWeek, expiresAbs: absWeek + LIQUIDATION_WEEKS,
      });
    });
  }
  return lots;
}

/** Lots still on sale at `absWeek`. */
export function liveLots(lots, absWeek) {
  return (lots ?? []).filter(l => (l.expiresAbs ?? 0) > absWeek);
}

/**
 * Lots grouped for display: one row per failed airline, type and age in years.
 * @returns {{ key, airlineName, typeId, ageYears, price, count, weeksLeft, lotId }[]}
 */
export function groupLots(lots, absWeek) {
  const groups = new Map();
  for (const l of liveLots(lots, absWeek)) {
    const ageYears = Math.round((l.ageWeeks ?? 0) / 52);
    const key = `${l.airlineId}|${l.typeId}|${ageYears}`;
    const g = groups.get(key);
    if (g) { g.count += 1; if (l.price < g.price) { g.price = l.price; g.lotId = l.id; } }
    else groups.set(key, { key, airlineName: l.airlineName, typeId: l.typeId, ageYears,
      price: l.price, count: 1, weeksLeft: Math.max(0, (l.expiresAbs ?? 0) - absWeek), lotId: l.id });
  }
  return [...groups.values()];
}
