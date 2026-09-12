// era-start-floor-test.mjs — the era picker must not offer a start year the
// aircraft catalogue cannot support.
// Run: node tools/era-start-floor-test.mjs
//
// Regression for Discord 2026-09-11 (Lancelotbronner): a 1930 world had NO
// orderable aircraft, so the player could not open a single route while AI
// carriers — whose route P&L does not require a real orderable type — flew
// profitable routes with no metal assigned. Both symptoms are one cause.

import {
  AIRCRAFT_TYPES, aircraftOrderable,
  ERA_MIN_START_YEAR, ERA_MAX_START_YEAR, isLegalEraStartYear,
} from '../src/data/aircraft.js';

let failures = 0;
function check(name, cond, detail = '') {
  if (cond) { console.log(`  ✓ ${name}`); }
  else      { console.error(`  ✗ ${name} ${detail}`); failures++; }
}

const pax = AIRCRAFT_TYPES.filter(t => !t.freighter && t.eis != null);
const earliestPax = Math.min(...pax.map(t => t.eis));

console.log('── Floor is derived from the data ──');
check('ERA_MIN_START_YEAR matches the oldest passenger type',
  ERA_MIN_START_YEAR === earliestPax, `floor ${ERA_MIN_START_YEAR}, oldest pax type ${earliestPax}`);
check('floor is a sane year', Number.isInteger(ERA_MIN_START_YEAR)
  && ERA_MIN_START_YEAR > 1900 && ERA_MIN_START_YEAR < 2000, `got ${ERA_MIN_START_YEAR}`);

console.log('── Legality ──');
check('classic (null) is legal', isLegalEraStartYear(null));
check('the floor itself is legal', isLegalEraStartYear(ERA_MIN_START_YEAR));
check('one year below the floor is rejected', !isLegalEraStartYear(ERA_MIN_START_YEAR - 1));
check('1930 is rejected', !isLegalEraStartYear(1930));
check('the ceiling is legal', isLegalEraStartYear(ERA_MAX_START_YEAR));
check('above the ceiling is rejected', !isLegalEraStartYear(ERA_MAX_START_YEAR + 1));
check('non-integers are rejected', !isLegalEraStartYear(1965.5) && !isLegalEraStartYear('1965'));

console.log('── Every legal start year has flyable metal ──');
const orderablePaxAt = (y) => pax.filter(t => aircraftOrderable(t, y)).length;
check('nothing is orderable below the floor', orderablePaxAt(ERA_MIN_START_YEAR - 1) === 0,
  `${orderablePaxAt(ERA_MIN_START_YEAR - 1)} types orderable in ${ERA_MIN_START_YEAR - 1}`);

const barren = [];
for (let y = ERA_MIN_START_YEAR; y <= 2100; y++) {
  if (orderablePaxAt(y) === 0) barren.push(y);
}
check('no legal start year has an empty passenger market', barren.length === 0,
  barren.length ? `barren years: ${barren.slice(0, 12).join(', ')}${barren.length > 12 ? '…' : ''}` : '');

// A start year with exactly one type is technically playable but miserable —
// worth knowing about rather than asserting on, so it is reported, not failed.
const thin = [];
for (let y = ERA_MIN_START_YEAR; y <= 2100; y++) {
  const n = orderablePaxAt(y);
  if (n > 0 && n < 3) thin.push(`${y}:${n}`);
}
if (thin.length) console.log(`  ℹ thin markets (<3 types): ${thin.join(' ')}`);

console.log(failures === 0 ? '\nALL PASSED' : `\n${failures} FAILURES`);
process.exit(failures === 0 ? 0 : 1);
