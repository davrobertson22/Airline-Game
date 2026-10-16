// event-balance-test.mjs — world events stay inside their stated caps, never
// stack two downturns, reach the AI's books as well as the player's, and the
// AI's attention to the player ramps with size instead of arriving in a week.
//
// Run: node --import ./tools/_register-loader.mjs tools/event-balance-test.mjs
import { strict as assert } from 'node:assert';
import test from 'node:test';
import {
  rollEvents, tickEvents, eventsConflict, clampImpact, computeEventEffects,
  MAX_EVENT_IMPACT, MAX_LOCALIZED_IMPACT,
} from '../src/data/events.js';
import { buildEventDemandModel } from '../src/utils/simulation.js';
import {
  sampleAndInitializeCompetitors, computeCompetitorRoutePnL, computeCompetitorWeeklyStats,
} from '../src/models/demand.js';
import { playerNoticeFor, NOTICE_FLOOR_CAP, NOTICE_FULL_CAP } from '../src/models/competitorAI.js';
import { getAirport } from '../src/data/airports.js';

const ev = (fx) => ({ id: Math.random().toString(36), templateId: 'x', effects: fx, weeksLeft: 5 });

test('two broad downturns are capped at the combined ±30%', () => {
  const m = buildEventDemandModel([ev({ globalDemandMult: 0.72 }), ev({ globalDemandMult: 0.70 })]);
  assert.equal(m.globalMult, 1 - MAX_EVENT_IMPACT);
  assert.equal(m.multFor('ORD', 'DEN'), 1 - MAX_EVENT_IMPACT);
  const up = buildEventDemandModel([ev({ globalDemandMult: 1.25 }), ev({ regionCodes: ['US'], regionDemandMult: 1.3 })]);
  assert.equal(up.multFor('ORD', 'DEN'), 1 + MAX_EVENT_IMPACT);
  // global × regional is capped too
  const mix = buildEventDemandModel([ev({ globalDemandMult: 0.80 }), ev({ regionCodes: ['US'], regionDemandMult: 0.75 })]);
  assert.equal(mix.multFor('ORD', 'DEN'), 1 - MAX_EVENT_IMPACT);
  assert.equal(mix.multFor('LHR', 'CDG'), 0.80);
});

test('an airport-local event hits only that airport, up to the ±50% local cap', () => {
  const strike = ev({ regionCodes: ['GB'], regionDemandMult: 0.40, airportCode: 'LHR' });
  const m = buildEventDemandModel([strike, ev({ globalDemandMult: 0.75 })]);
  assert.equal(m.multFor('LHR', 'JFK'), 1 - MAX_LOCALIZED_IMPACT);
  assert.equal(m.multFor('LGW', 'JFK'), 0.75, 'other UK airports keep only the broad effect');
  assert.equal(m.multFor('MAN', 'LHR'), 1 - MAX_LOCALIZED_IMPACT);
  const fx = computeEventEffects([strike], { origin: 'LGW', destination: 'JFK' }, getAirport);
  assert.deepEqual(fx.regionMults, {});
});

test('a calm week and single events are untouched', () => {
  const calm = buildEventDemandModel([]);
  assert.equal(calm.globalMult, 1);
  assert.equal(calm.multFor('SIN', 'BKK'), 1);
  const one = buildEventDemandModel([ev({ regionCodes: ['SG', 'TH'], regionDemandMult: 1.2 })]);
  assert.equal(one.multFor('SIN', 'BKK'), 1.2);
  assert.equal(clampImpact(0.9), 0.9);
});

test('two downturns cannot run together when either is global', () => {
  assert.equal(eventsConflict('recession', 'pandemic_scare'), true);
  assert.equal(eventsConflict('recession', 'us_slump'), true);
  assert.equal(eventsConflict('fare_war', 'currency_crisis'), true);
  assert.equal(eventsConflict('us_slump', 'currency_crisis'), false, 'regional slumps in different regions may overlap');
  assert.equal(eventsConflict('travel_boom', 'holiday_surge'), false, 'booms are capped, not blocked');
  assert.equal(eventsConflict('recession', 'travel_boom'), true);
});

test('over many rolled years no route ever falls below the cap', () => {
  let seed = 4242;
  const orig = Math.random;
  Math.random = () => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  const GLOBAL_DOWN = new Set(['recession', 'pandemic_scare', 'fare_war']);
  try {
    let active = [];
    let worst = 1, worstLhr = 1;
    for (let w = 0; w < 52 * 400; w++) {
      const { updated } = tickEvents(active);
      active = [...updated, ...rollEvents(updated, {})];
      const downs = active.filter(e => GLOBAL_DOWN.has(e.templateId)).length;
      assert.ok(downs <= 1, `week ${w}: ${active.map(e => e.templateId).join('+')}`);
      const m = buildEventDemandModel(active);
      worst = Math.min(worst, m.multFor('ORD', 'DEN'), m.multFor('LGW', 'MAD'), m.multFor('SIN', 'BKK'));
      worstLhr = Math.min(worstLhr, m.multFor('LHR', 'MAD'));
    }
    assert.ok(worst >= 1 - MAX_EVENT_IMPACT - 1e-9, `broad worst ${worst}`);
    assert.ok(worstLhr >= 1 - MAX_LOCALIZED_IMPACT - 1e-9, `LHR worst ${worstLhr}`);
  } finally { Math.random = orig; }
});

// ── AI carriers feel the same world ─────────────────────────────────────────

const comps = sampleAndInitializeCompetitors(10);
const carrier = comps.find(c => Object.keys(c.routes).length > 0);
const key = Object.keys(carrier.routes)[0];
const cfg = carrier.routes[key];

test('AI route P&L: no world = calm world = the old numbers', () => {
  const base  = computeCompetitorRoutePnL(carrier, key, cfg, 6, null);
  const calm  = computeCompetitorRoutePnL(carrier, key, cfg, 6, null, { demandMultFor: () => 1, fuelMult: 1 });
  assert.deepEqual(calm, base);
  const statsA = computeCompetitorWeeklyStats(carrier, 6, null);
  const statsB = computeCompetitorWeeklyStats(carrier, 6, null, 123);   // legacy absWeek arg
  assert.deepEqual(statsB, statsA);
});

test('AI route P&L: a recession cuts demand, a fuel spike raises cost', () => {
  const base = computeCompetitorRoutePnL(carrier, key, cfg, 6, null);
  const rec  = computeCompetitorRoutePnL(carrier, key, cfg, 6, null, { demandMultFor: () => 0.7, fuelMult: 1 });
  const fuel = computeCompetitorRoutePnL(carrier, key, cfg, 6, null, { demandMultFor: () => 1, fuelMult: 1.3 });
  assert.ok(rec.demandOneWay < base.demandOneWay);
  assert.ok(rec.profit <= base.profit);
  assert.ok(fuel.cost > base.cost);
  assert.equal(fuel.revenue, base.revenue);
  const s0 = computeCompetitorWeeklyStats(carrier, 6, null);
  const s1 = computeCompetitorWeeklyStats(carrier, 6, null, { demandMultFor: () => 0.7, fuelMult: 1.3 });
  assert.ok(s1.weeklyProfit < s0.weeklyProfit);
});

// ── Player notice ramp ──────────────────────────────────────────────────────

test('AI attention ramps smoothly with market cap', () => {
  assert.equal(playerNoticeFor(0), 0.15);
  assert.equal(playerNoticeFor(NOTICE_FLOOR_CAP), 0.15);
  assert.equal(playerNoticeFor(NOTICE_FULL_CAP), 1);
  assert.equal(playerNoticeFor(5e9), 1);
  assert.equal(playerNoticeFor(NaN), 0.15);
  let prev = playerNoticeFor(NOTICE_FLOOR_CAP);
  for (let mc = NOTICE_FLOOR_CAP; mc <= NOTICE_FULL_CAP; mc += 1_000_000) {
    const n = playerNoticeFor(mc);
    assert.ok(n >= prev - 1e-12, `monotone at ${mc}`);
    assert.ok(n - prev < 0.02, `no jump at ${mc}: ${prev} → ${n}`);
    prev = n;
  }
  assert.ok(playerNoticeFor(100_000_000) > 0.6 && playerNoticeFor(100_000_000) < 0.8);
});
