// era-progression-test.mjs — Era mode (Tailwinds port): the money scales.
// Fixed costs, objective thresholds/rewards and the seed capital all scale
// with the era's capital scale so a 1950 airline is a smaller business in
// constant dollars, not a modern one with 1950 demand. Classic: identity.
import { strict as assert } from 'node:assert';
import test from 'node:test';
import { eraRevenueScale, eraPaxScale, eraCapitalScale } from '../src/data/era.js';
import { routeLaunchCost, setEraCostScale, getEraCostScale, liabilityInsuranceWeekly } from '../src/data/overhead.js';
import { OBJECTIVE_TEMPLATES, objectiveDesc } from '../src/data/objectives.js';
import { gameReducer, freshState } from '../src/store/GameContext.jsx';
import { getAircraftType } from '../src/data/aircraft.js';

test('the era money scales: null in classic, ramping through the century', () => {
  assert.equal(eraRevenueScale(null), null);
  assert.equal(eraCapitalScale(null), null);
  assert.ok(Math.abs(eraRevenueScale(1950) - 0.084) < 0.01);
  assert.ok(Math.abs(eraCapitalScale(1950) - 0.289) < 0.01);
  assert.ok(eraCapitalScale(1978) > 0.55 && eraCapitalScale(1978) < 0.70);
  assert.equal(eraCapitalScale(2026), 1, 'a 2026 era year is exactly the modern game');
  assert.equal(eraCapitalScale(2050), 1, 'capital never scales ABOVE modern');
  assert.ok(eraPaxScale(1950) < eraRevenueScale(1950), 'pax scale is the deeper cut (no fare premium)');
});

test('cost floors scale through the module knob and reset cleanly', () => {
  const classic = routeLaunchCost(1000);
  assert.equal(classic, 62_000);
  try {
    setEraCostScale(0.289);
    assert.equal(routeLaunchCost(1000), Math.round(62_000 * 0.289));
    assert.equal(liabilityInsuranceWeekly(getAircraftType('dc3')), Math.round(6_000 * 0.289));
  } finally {
    setEraCostScale(1);
  }
  assert.equal(routeLaunchCost(1000), classic, 'reset restores classic byte-identically');
});

test('the reducer sets the cost scale from state on every action', () => {
  const era = { ...freshState(), phase: 'playing', startYear: 1950, year: 1, week: 1, competitors: [] };
  gameReducer(era, { type: 'NOOP_UNKNOWN_ACTION' });
  assert.ok(Math.abs(getEraCostScale() - eraCapitalScale(1950)) < 1e-9);
  gameReducer({ ...freshState(), phase: 'playing', competitors: [] }, { type: 'NOOP_UNKNOWN_ACTION' });
  assert.equal(getEraCostScale(), 1, 'a classic action resets it — saves cannot leak into each other');
});

test('objective thresholds, descriptions and rewards scale with the era', () => {
  const rev = OBJECTIVE_TEMPLATES.find(t => t.id === 'revenue_500k');
  const Mfn = (x) => Math.max(1_000, Math.round(x * 0.084 / 1_000) * 1_000);
  assert.equal(rev.check({ lastReport: { totalRevenue: 450_000 } }), false, 'classic: literal holds');
  assert.equal(rev.check({ lastReport: { totalRevenue: 42_000 }, M: Mfn }), true, 'era: scaled target');
  assert.equal(objectiveDesc(rev), 'Generate $500K in a single week');
  assert.equal(objectiveDesc(rev, Mfn), 'Generate $42K in a single week');
  for (const t of OBJECTIVE_TEMPLATES) {
    if (t.descTemplate) {
      assert.ok(t.money != null || t.pax != null, `${t.id}: descTemplate without a threshold`);
      assert.ok(objectiveDesc(t).length > 0);
    }
  }
});

test('era games keep a yearly rollup; classic games never grow the field', () => {
  let era = { ...freshState(), phase: 'playing', cash: 50_000_000, startYear: 1950, fleet: [], routes: [], competitors: [] };
  for (let i = 0; i < 106; i++) era = gameReducer(era, { type: 'ADVANCE_WEEK' });
  assert.equal(era.statsHistoryYearly?.length, 2, 'two completed years → two rows');
  assert.deepEqual(era.statsHistoryYearly.map(r => r.label), ['1950', '1951']);
  assert.ok(era.statsHistoryYearly.every(r => 'revenue' in r && 'profit' in r && 'fleet' in r));
  let classic = { ...freshState(), phase: 'playing', cash: 50_000_000, fleet: [], routes: [], competitors: [] };
  for (let i = 0; i < 106; i++) classic = gameReducer(classic, { type: 'ADVANCE_WEEK' });
  assert.ok(!('statsHistoryYearly' in classic), 'classic saves stay byte-identical');
});
