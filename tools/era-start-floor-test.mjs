// era-start-floor-test.mjs — the era picker must not offer a start year the
// game does not model.
// Run: node tools/era-start-floor-test.mjs
//
// Regression for Discord 2026-09-11 (Lancelotbronner): a 1930 world had NO
// orderable aircraft, so the player could not open a single route, while AI
// carriers — whose route P&L does not require a real orderable type — flew
// profitable routes with no metal assigned. Both symptoms, one cause.
//
// The floor answers to TWO constraints and this suite holds both, because
// either one moving alone would break the other:
//   model     — ERA_MIN_START_YEAR is the first fuel anchor. Demand and fare
//               curves reach back to 1930, fuel does not, so an earlier world
//               runs on a flat extrapolation of the 1950 price. The balance
//               suite calibrates from 1950 as well.
//   catalogue — the oldest airliner is the 1936 DC-3. The floor must never sit
//               below the first year something can actually be bought, and the
//               opening market must be a real choice rather than one type.

import {
  ERA_MIN_START_YEAR, ERA_MAX_START_YEAR, isLegalEraStartYear,
  ERA_FUEL_ANCHORS, ERA_DEMAND_ANCHORS, ERA_FARE_ANCHORS,
} from '../src/data/era.js';
import { AIRCRAFT_TYPES, aircraftOrderable } from '../src/data/aircraft.js';

let failures = 0;
function check(name, cond, detail = '') {
  if (cond) { console.log(`  ✓ ${name}`); }
  else      { console.error(`  ✗ ${name} ${detail}`); failures++; }
}

const pax = AIRCRAFT_TYPES.filter(t => !t.freighter && t.eis != null);
const orderablePaxAt = (y) => pax.filter(t => aircraftOrderable(t, y)).length;

console.log('── The floor comes from the era model ──');
check('ERA_MIN_START_YEAR is the first fuel anchor',
  ERA_MIN_START_YEAR === ERA_FUEL_ANCHORS[0][0],
  `floor ${ERA_MIN_START_YEAR}, first fuel anchor ${ERA_FUEL_ANCHORS[0][0]}`);
check('the floor is 1950', ERA_MIN_START_YEAR === 1950, `got ${ERA_MIN_START_YEAR}`);
check('demand curve covers the floor', ERA_DEMAND_ANCHORS[0][0] <= ERA_MIN_START_YEAR);
check('fare curve covers the floor', ERA_FARE_ANCHORS[0][0] <= ERA_MIN_START_YEAR);
check('curves reach the ceiling',
  ERA_DEMAND_ANCHORS[ERA_DEMAND_ANCHORS.length - 1][0] >= ERA_MAX_START_YEAR
  && ERA_FARE_ANCHORS[ERA_FARE_ANCHORS.length - 1][0] >= ERA_MAX_START_YEAR);

console.log('── …and the catalogue has to back it ──');
const earliestPax = Math.min(...pax.map(t => t.eis));
check('the floor is not below the oldest airliner',
  ERA_MIN_START_YEAR >= earliestPax,
  `floor ${ERA_MIN_START_YEAR}, oldest type enters service ${earliestPax}`);
check('the opening market is a real choice, not one type',
  orderablePaxAt(ERA_MIN_START_YEAR) >= 3,
  `${orderablePaxAt(ERA_MIN_START_YEAR)} type(s) orderable in ${ERA_MIN_START_YEAR}`);
console.log(`  ℹ ${orderablePaxAt(ERA_MIN_START_YEAR)} passenger types orderable in ${ERA_MIN_START_YEAR}`);

console.log('── Legality ──');
check('classic (null) is legal', isLegalEraStartYear(null));
check('the floor itself is legal', isLegalEraStartYear(ERA_MIN_START_YEAR));
check('one year below the floor is rejected', !isLegalEraStartYear(ERA_MIN_START_YEAR - 1));
check('1930 is rejected', !isLegalEraStartYear(1930));
check('1936 is rejected — metal exists, the model does not', !isLegalEraStartYear(1936));
check('the ceiling is legal', isLegalEraStartYear(ERA_MAX_START_YEAR));
check('above the ceiling is rejected', !isLegalEraStartYear(ERA_MAX_START_YEAR + 1));
check('non-integers are rejected', !isLegalEraStartYear(1965.5) && !isLegalEraStartYear('1965'));

console.log('── Every legal start year is playable ──');
const barren = [], thin = [];
for (let y = ERA_MIN_START_YEAR; y <= ERA_MAX_START_YEAR; y++) {
  const n = orderablePaxAt(y);
  if (n === 0) barren.push(y);
  else if (n < 3) thin.push(`${y}:${n}`);
}
check('no legal start year has an empty passenger market', barren.length === 0,
  barren.length ? `barren: ${barren.slice(0, 12).join(', ')}${barren.length > 12 ? '…' : ''}` : '');
check('no legal start year opens on fewer than three types', thin.length === 0,
  thin.length ? `thin: ${thin.slice(0, 12).join(', ')}` : '');

console.log(failures === 0 ? '\nALL PASSED' : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
