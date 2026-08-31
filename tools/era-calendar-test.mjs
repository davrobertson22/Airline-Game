// era-calendar-test.mjs — Era mode (Tailwinds port): the startYear epoch.
//
// The invariant under test everywhere below: startYear == null (classic game)
// must behave byte-for-byte as before — every era path short-circuits.
import { strict as assert } from 'node:assert';
import test from 'node:test';
import { calendarYear, yearLabel, shortYearLabel, formatGameDate } from '../src/utils/simulation.js';
import { gameReducer, freshState } from '../src/store/GameContext.jsx';

test('classic games are untouched: calendarYear null, labels ordinal', () => {
  assert.equal(calendarYear({ year: 3, week: 1 }), null);
  assert.equal(calendarYear({ year: 3, week: 1, startYear: null }), null);
  assert.equal(yearLabel({ year: 3 }), 'Year 3');
  assert.equal(shortYearLabel({ year: 3 }), 'Y3');
  assert.equal(formatGameDate({ week: 14, year: 3 }), 'Week 5 Mar Year 3');
});

test('era games translate the ordinal year to the calendar', () => {
  assert.equal(calendarYear({ year: 1, startYear: 1950 }), 1950);
  assert.equal(calendarYear({ year: 29, startYear: 1950 }), 1978);
  assert.equal(yearLabel({ year: 3, startYear: 1978 }), '1980');
  assert.equal(shortYearLabel({ year: 3, startYear: 1950 }), '1952');
  assert.equal(formatGameDate({ week: 14, year: 3, startYear: 1950 }), 'Week 5 Mar 1952');
});

test('year stays a 1-based ordinal — startYear never changes state.year', () => {
  const s = { year: 5, week: 10, startYear: 1958 };
  calendarYear(s); yearLabel(s); formatGameDate(s);
  assert.equal(s.year, 5);
});

test('START_GAME: startYear is optional, validated, and scales the seed capital', () => {
  const classic = gameReducer(undefined, { type: 'START_GAME', airlineName: 'A', hub: 'JFK' });
  assert.equal(classic.startYear, null);
  assert.equal(classic.cash, 15_000_000);
  const era = gameReducer(undefined, { type: 'START_GAME', airlineName: 'A', hub: 'JFK', startYear: 1950 });
  assert.equal(era.startYear, 1950);
  assert.equal(era.year, 1, 'ordinal year untouched');
  assert.equal(era.cash, 4_000_000, `1950 capital ${era.cash} — $4.34M floored to a whole million`);
  assert.ok(era.fuelPrice.index > 0.3 && era.fuelPrice.index < 0.6, `1950 opens on the fifties' fuel price, got ${era.fuelPrice.index}`);
  assert.equal(classic.fuelPrice.index, 1.0, 'classic opens at the long-run equilibrium');
  const c1978 = gameReducer(undefined, { type: 'START_GAME', airlineName: 'A', hub: 'JFK', startYear: 1978 }).cash;
  assert.equal(c1978, 9_000_000, `1978 capital ${c1978}`);
  for (const bad of [1850, 2200, 1950.5, '1950']) {
    const s = gameReducer(undefined, { type: 'START_GAME', airlineName: 'A', hub: 'JFK', startYear: bad });
    assert.equal(s.startYear, null, `startYear ${JSON.stringify(bad)} reads as classic`);
    assert.equal(s.cash, 15_000_000);
  }
});

test('history labels: ordinal for classic, calendar for era', () => {
  let classic = { ...freshState(), phase: 'playing', cash: 50_000_000, fleet: [], routes: [], competitors: [] };
  classic = gameReducer(classic, { type: 'ADVANCE_WEEK' });
  assert.equal(classic.financialHistory.at(-1).label, 'Jan W1 Y1');
  let era = { ...classic, startYear: 1950 };
  era = gameReducer(era, { type: 'ADVANCE_WEEK' });
  assert.equal(era.financialHistory.at(-1).label, 'Jan W2 1950');
  assert.equal(era.startYear, 1950, 'the tick must not drop the epoch');
});
