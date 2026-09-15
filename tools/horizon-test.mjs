// horizon-test.mjs — the run has to end, and only for the worlds that own a
// calendar.
// Run: node tools/horizon-test.mjs
//
// An era world closes at the end of calendar year 2050 and the player is ranked
// on market cap against whoever is still flying. A classic world (startYear
// null) has no calendar at all and stays endless on purpose — that is the same
// suite holds that at the one function every horizon branch in the reducer goes
// through: if a change ever makes horizonReached() true without a startYear,
// every classic game silently acquires an ending, and this is what catches it.

import {
  HORIZON_YEAR, ERA_MAX_NEW_START_YEAR, ERA_MIN_START_YEAR, ERA_MAX_START_YEAR,
  runLengthYears, horizonReached, pastHorizon, isLegalEraStartYear,
} from '../src/data/era.js';

let failed = 0;
const check = (name, ok) => {
  console.log(`  ${ok ? '✓' : '✗'} ${name}`);
  if (!ok) failed++;
};

console.log('── Classic worlds never reach a horizon ──');
check('null start year is never at the horizon',
  !horizonReached(null, 1, 52) && !horizonReached(null, 500, 52));
check('null start year is never past the horizon',
  !pastHorizon(null, 1) && !pastHorizon(null, 9999));
check('a classic world has no run length', runLengthYears(null) === null);
check('undefined is treated as classic, not as year 0',
  !horizonReached(undefined, 1, 52) && runLengthYears(undefined) === null);

console.log('── The bell rings on week 52 of 2050, and not before ──');
// A 2000 world: ordinal year 51 IS calendar 2050.
const ORD_2050_FROM_2000 = HORIZON_YEAR - 2000 + 1;
check('week 51 of the final year is still playable',
  !horizonReached(2000, ORD_2050_FROM_2000, 51));
check('week 52 of the final year closes the run',
  horizonReached(2000, ORD_2050_FROM_2000, 52));
check('week 52 of the year before does not close it',
  !horizonReached(2000, ORD_2050_FROM_2000 - 1, 52));
check('the year before is not past the horizon',
  !pastHorizon(2000, ORD_2050_FROM_2000 - 1));
check('the final year itself is not past the horizon',
  !pastHorizon(2000, ORD_2050_FROM_2000));
check('the year after is past the horizon',
  pastHorizon(2000, ORD_2050_FROM_2000 + 1));

console.log('── Every start year lands on the same date ──');
let sameDate = true;
for (let y = ERA_MIN_START_YEAR; y <= ERA_MAX_NEW_START_YEAR; y++) {
  const ord = HORIZON_YEAR - y + 1;
  if (!horizonReached(y, ord, 52) || horizonReached(y, ord - 1, 52)) sameDate = false;
  if (runLengthYears(y) !== ord) sameDate = false;
}
check('a shared 2050 horizon for every offered start year', sameDate);
check('1950 is a century', runLengthYears(1950) === 101);
check('2000 is 51 years', runLengthYears(2000) === 51);

console.log('── The picker ceiling leaves a run worth playing ──');
check('the new-game ceiling is below the horizon', ERA_MAX_NEW_START_YEAR < HORIZON_YEAR);
check('the shortest offered run is at least ten years',
  runLengthYears(ERA_MAX_NEW_START_YEAR) >= 10);
check('every offered start year is a legal start year',
  isLegalEraStartYear(ERA_MAX_NEW_START_YEAR) && isLegalEraStartYear(ERA_MIN_START_YEAR));
// The save ceiling must stay where it is: reconcileState clamps out-of-range
// saves onto it, so lowering it would rewrite an existing world's calendar.
check('the save ceiling is untouched and still above the horizon',
  ERA_MAX_START_YEAR > HORIZON_YEAR);

console.log('── Worlds that predate the horizon are grandfathered ──');
check('a world started past 2050 is already past the horizon', pastHorizon(2060, 1));
check('a world played well past 2050 is already past it', pastHorizon(1950, 150));

console.log(failed === 0 ? '\nALL PASSED' : `\n${failed} FAILED`);
process.exit(failed === 0 ? 0 : 1);
