// Market development (models/marketDev.js, docs/market-development-design.md).
//
//   node --import ./tools/_register-loader.mjs tools/market-dev-test.mjs
//
// A served city pair's market grows toward the level its service supports and
// fades slowly when that service leaves. These tests pin the curve, the world
// flag (new games only; classic saves byte-identical), the tick/preview
// agreement, the awareness ramp that replaces the maturity ramp, and replay.

import assert from 'node:assert/strict';
import {
  MARKET_DEV_FLOOR, MARKET_DEV_CEIL, MARKET_DEV_REF_FREQ, marketDevTarget, marketDevFareTerm, stepMarketDev,
  marketDevKey, collectPairService, advanceMarketDev, prewarmMarketDev, cleanMarketDev,
  setMarketDev, marketDevFor, marketDevForOD, marketDevActive,
} from '../src/models/marketDev.js';
import { buildRouteMarket, pairDemandNow, computeMarketShare, computeCompetitorRoutePnL } from '../src/models/demand.js';
import { baseCityPairDemand, referencePrice } from '../src/utils/market.js';
const { gameReducer, freshState } = await import('../src/store/GameContext.jsx');

let passed = 0, failed = 0;
const t = (name, fn) => {
  try { fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.log(`  ✗ ${name}\n      ${(e.stack || e.message).split('\n').slice(0, 3).join('\n      ')}`); failed++; }
};
const near = (a, b, eps, msg) => assert.ok(Math.abs(a - b) <= eps, `${msg ?? ''} ${a} vs ${b} (±${eps})`);
const realRandom = Math.random;
function seedRandom(seed) {
  let x = seed >>> 0;
  Math.random = () => { x = (Math.imul(x, 1664525) + 1013904223) >>> 0; return x / 4294967296; };
}
const on  = (pairs = {}) => ({ marketDevWorld: true, marketDev: { v: 1, pairs } });
const gd  = { week: 20, month: 5, absWeek: 20 };
const pool = (m) => m.leisureDemand + m.businessDemand;

console.log('\nMarket development\n');
console.log('── 1. The curve ──────────────────────────────────────────────');

t('13 departures a week at the reference fare target exactly 1.0; no service targets the floor', () => {
  assert.equal(MARKET_DEV_REF_FREQ, 13);
  near(marketDevTarget(13, 1), 1.0, 1e-9);
  assert.equal(marketDevTarget(0), MARKET_DEV_FLOOR);
  assert.equal(MARKET_DEV_FLOOR, 0.70);
  assert.equal(marketDevTarget(1), MARKET_DEV_FLOOR, '1/wk sits on the floor');
  near(marketDevTarget(3), 0.803, 0.001, '3/wk');
  near(marketDevTarget(7), 0.911, 0.001, 'daily');
  near(marketDevTarget(14), 1.011, 0.001, '14/wk');
  near(marketDevTarget(28), 1.122, 0.001, '28/wk');
});

t('the target is clamped to [0.70, 1.30] and the fare term to ±15%', () => {
  assert.equal(marketDevTarget(1000, 0.3), MARKET_DEV_CEIL);
  assert.ok(marketDevTarget(0.1) >= MARKET_DEV_FLOOR);
  assert.equal(marketDevFareTerm(0.2), 1.15);
  assert.equal(marketDevFareTerm(5), 0.85);
  near(marketDevFareTerm(0.9), 1.032, 0.001);
  assert.equal(marketDevFareTerm(null), 1);
});

t('builds with a 20-week half-life and fades with a 30-week one', () => {
  let d = 0.7;
  for (let w = 0; w < 20; w++) d = stepMarketDev(d, 1.0);
  near(d, 0.85, 0.001, 'build half-life');
  let f = 1.1;
  for (let w = 0; w < 30; w++) f = stepMarketDev(f, 0.7);
  near(f, 0.90, 0.001, 'fade half-life');
});

t('a steady reference service settles at 1.00 ± 0.01', () => {
  let d = 0.7;
  for (let w = 0; w < 200; w++) d = stepMarketDev(d, marketDevTarget(13, 1));
  near(d, 1.0, 0.01);
});

console.log('── 2. Service ────────────────────────────────────────────────');

t('metro members share one key (JFK–LHR is EWR–LGW)', () => {
  assert.equal(marketDevKey('JFK', 'LHR'), marketDevKey('EWR', 'LGW'));
  assert.equal(marketDevKey('LHR', 'JFK'), marketDevKey('JFK', 'LHR'));
});

t('frequency sums across carriers and member airports; a tag route adds half for its through pair', () => {
  const svc = collectPairService({
    routes: [
      { origin: 'JFK', destination: 'LHR', weeklyFrequency: 7, ticketPrice: referencePrice('JFK', 'LHR') },
      { origin: 'EWR', destination: 'LGW', weeklyFrequency: 3 },
      { origin: 'DEN', destination: 'ORD', stops: ['DEN', 'ORD', 'BOS'], weeklyFrequency: 4 },
    ],
    competitors: [{ routes: { 'JFK-LHR': { frequency: 5, priceMultiplier: 1 } } }],
  });
  assert.equal(svc.get(marketDevKey('JFK', 'LHR')).freq, 15);
  assert.equal(svc.get(marketDevKey('DEN', 'ORD')).freq, 4);
  assert.equal(svc.get(marketDevKey('ORD', 'BOS')).freq, 4);
  assert.equal(svc.get(marketDevKey('DEN', 'BOS')).freq, 2);
});

t('a dormant seasonal route and a range-stranded one serve nothing', () => {
  const svc = collectPairService({ month: 1, routes: [
    { origin: 'JFK', destination: 'MIA', weeklyFrequency: 7, season: { months: [6, 7, 8] } },
    { origin: 'JFK', destination: 'SFO', weeklyFrequency: 7, rangeStranded: { since: 1 } },
  ] });
  assert.equal(svc.size, 0);
});

t('advance: a served pair climbs; an abandoned pair fades and is dropped near the floor', () => {
  const k = marketDevKey('JFK', 'MIA');
  let s = { ...on({ [k]: { d: 0.9, t: 1 } }), routes: [], competitors: [] };
  s.marketDev = advanceMarketDev(s);
  assert.ok(s.marketDev.pairs[k].d < 0.9, 'fades with no service');
  assert.equal(s.marketDev.pairs[k].t, MARKET_DEV_FLOOR);
  for (let w = 0; w < 400; w++) s = { ...s, marketDev: advanceMarketDev(s) };
  assert.equal(s.marketDev.pairs[k], undefined, 'pruned once it is back at the floor');
  const r = { origin: 'JFK', destination: 'BOS', weeklyFrequency: 14 };
  let s2 = { ...on(), routes: [r], competitors: [] };
  s2.marketDev = advanceMarketDev(s2);
  const kb = marketDevKey('JFK', 'BOS');
  assert.ok(s2.marketDev.pairs[kb].d > MARKET_DEV_FLOOR);
  near(s2.marketDev.pairs[kb].t, marketDevTarget(14), 1e-4);
});

t('a world without the flag never grows a table', () => {
  const s = { routes: [{ origin: 'JFK', destination: 'BOS', weeklyFrequency: 14 }], marketDev: null };
  assert.equal(advanceMarketDev(s), null);
});

console.log('── 3. The pool ───────────────────────────────────────────────');

t('flag off: every pool is exactly the classic one, maturity ramp included', () => {
  setMarketDev(null);
  assert.equal(marketDevActive(), false);
  assert.equal(marketDevFor('JFK', 'LHR'), 1);
  assert.equal(marketDevForOD('JFK', 'LHR', 7), 1);
  const m = buildRouteMarket('JFK', 'LHR', gd, 0.55);
  assert.equal(m.maturityFactor, 0.55);
  assert.equal(m.marketDev, undefined);
  assert.equal(m.awareness, undefined);
});

t('flag on: an unserved pair is 70% of its classic pool and the ramp no longer shrinks it', () => {
  setMarketDev(null);
  const classic = pool(buildRouteMarket('ORD', 'DEN', gd, 1));
  setMarketDev(on());
  const m = buildRouteMarket('ORD', 'DEN', gd, 0.55);
  near(pool(m), classic * 0.7, 2);
  assert.equal(m.maturityFactor, 1);
  assert.equal(m.awareness, 0.55);
  assert.equal(m.marketDev, 0.7);
  setMarketDev(null);
});

t('pairDemandNow (finder lists) prints the same developed pool as buildRouteMarket', () => {
  setMarketDev(on({ [marketDevKey('ORD', 'DEN')]: { d: 1.17, t: 1.2 } }));
  near(pairDemandNow('ORD', 'DEN', gd), pool(buildRouteMarket('ORD', 'DEN', gd)), 1);
  setMarketDev(null);
});

t('connecting-only O&D is stateless: its connecting frequency, half-weighted', () => {
  setMarketDev(on({ [marketDevKey('JFK', 'LHR')]: { d: 1.2, t: 1.2 } }));
  assert.equal(marketDevForOD('JFK', 'LHR', 2), 1.2, 'a nonstop market keeps its own D');
  near(marketDevForOD('DEN', 'BOS', 7), marketDevTarget(3.5), 1e-9);
  assert.equal(marketDevForOD('DEN', 'BOS', 0), MARKET_DEV_FLOOR);
  setMarketDev(null);
});

t('AI route economics see the same developed market', () => {
  const cfg = { frequency: 7, priceMultiplier: 1, tails: 1 };
  const c = { id: 'x', tier: 'legacy', routes: { 'DEN-ORD': cfg } };
  setMarketDev(null);
  const classic = computeCompetitorRoutePnL(c, 'DEN-ORD', cfg, 5);
  setMarketDev(on());
  const floor = computeCompetitorRoutePnL(c, 'DEN-ORD', cfg, 5);
  setMarketDev(null);
  near(floor.demandOneWay, classic.demandOneWay * 0.7, 2, 'an unserved pair is 70% of its classic pool');
});

console.log('── 4. Awareness replaces the ramp ────────────────────────────');

const MK = { origin: 'ATL', destination: 'DFW', referencePrice: 162, distanceKm: 1160,
  leisureDemand: 7600, businessDemand: 2100 };
const YOU = { airlineId: 'player', origin: 'ATL', destination: 'DFW', economyPrice: 162, businessPrice: 567,
  weeklyFrequency: 21, economySeats: 1e9, businessSeats: 1e9, totalSeats: 2e9, qualityScore: 65 };
const RIVAL = { ...YOU, airlineId: 'rival' };

t('contested: a new entrant wins share gradually, and nobody leaves the market', () => {
  const mature = computeMarketShare(MK, [YOU, RIVAL]);
  const fresh  = computeMarketShare({ ...MK, awareness: 0.55 }, [YOU, RIVAL]);
  assert.ok(fresh[0].totalPax < mature[0].totalPax, 'the newcomer carries less');
  near(fresh[0].totalPax + fresh[1].totalPax, mature[0].totalPax + mature[1].totalPax, 2,
    'the passengers it does not win fly the rival');
  near(fresh[0].leisureShare / fresh[1].leisureShare, 0.55, 0.01, 'weight × ramp');
});

t('monopoly: awareness does nothing (the market itself is the ramp)', () => {
  const [a] = computeMarketShare(MK, [YOU]);
  const [b] = computeMarketShare({ ...MK, awareness: 0.55 }, [YOU]);
  assert.equal(a.totalPax, b.totalPax);
});

console.log('── 5. The game ───────────────────────────────────────────────');

const start = (extra = {}) => gameReducer(freshState(),
  { type: 'START_GAME', airlineName: 'Dev Air', hub: 'DEN', enableObjectives: false, ...extra });

t('a new game is a market-development world, pre-warmed at equilibrium', () => {
  seedRandom(11);
  const s = start();
  Math.random = realRandom;
  assert.equal(s.marketDevWorld, true);
  const entries = Object.values(s.marketDev.pairs);
  assert.ok(entries.length > 50, `${entries.length} pairs`);
  for (const e of entries) assert.equal(e.d, e.t);
  const svc = collectPairService({ competitors: s.competitors });
  assert.equal(entries.length, svc.size, 'exactly the pairs the starting field flies');
});

// Calibrated on demand v2 (0.97–1.04 across eight hubs). Under v3 the AI
// starting field is sized on different demand and lands at 0.99–1.055 (mean
// 1.03), so the band is ±6%: the reference frequency is shared by v2 and v3
// games, and retuning it would move games already started on v2.
t('neutral start: a fresh world\'s served markets average D = 1.0 (±6%), demand-weighted', () => {
  for (const [hub, seed] of [['JFK', 21], ['FRA', 22], ['SIN', 23], ['SYD', 24]]) {
    seedRandom(seed);
    const s = start({ hub });
    Math.random = realRandom;
    let ws = 0, w = 0;
    for (const [k, e] of Object.entries(s.marketDev.pairs)) {
      const [a, b] = k.split('-');
      const base = baseCityPairDemand(a, b);
      ws += base * e.d; w += base;
    }
    near(ws / w, 1.0, 0.06, hub);
  }
});

t('the setup switch turns it off, and that world never grows a key', () => {
  seedRandom(11);
  let s = start({ marketDev: false });
  s = gameReducer(s, { type: 'ADVANCE_WEEK' });
  Math.random = realRandom;
  assert.equal(s.marketDevWorld, undefined);
  assert.equal(s.marketDev, undefined);
});

t('a week advances the table from the service that flew', () => {
  seedRandom(12);
  const s0 = start();
  const s1 = gameReducer(s0, { type: 'ADVANCE_WEEK' });
  Math.random = realRandom;
  assert.notEqual(s1.marketDev, s0.marketDev);
  assert.equal(s1.week, s0.week + 1);
});

t('replay: the same seed and start produce the same table after 8 weeks', () => {
  const run = () => {
    seedRandom(99);
    let s = start();
    for (let i = 0; i < 8; i++) s = gameReducer(s, { type: 'ADVANCE_WEEK' });
    Math.random = realRandom;
    return s.marketDev;
  };
  assert.deepEqual(run(), run());
});

t('load: a flagged save is cleaned, an unflagged one loses any stray table', () => {
  seedRandom(13);
  const s = start();
  Math.random = realRandom;
  const k = Object.keys(s.marketDev.pairs)[0];
  const dirty = { ...s, marketDev: { v: 1, pairs: { ...s.marketDev.pairs, bad: { d: 'x' }, [k]: { d: 9, t: 9 } } } };
  const loaded = gameReducer(freshState(), { type: 'LOAD_STATE', payload: dirty });
  assert.equal(loaded.marketDev.pairs.bad, undefined);
  assert.equal(loaded.marketDev.pairs[k].d, MARKET_DEV_CEIL);
  const classic = gameReducer(freshState(), { type: 'LOAD_STATE',
    payload: { ...s, marketDevWorld: undefined } });
  assert.equal(classic.marketDev, undefined);
  setMarketDev(null);
});

t('cleanMarketDev clamps and drops junk', () => {
  const c = cleanMarketDev({ pairs: { a: { d: 0.1 }, b: { d: NaN }, c: { d: 1, t: 2 } } });
  assert.deepEqual(c.pairs, { a: { d: 0.7, t: 0.7 }, c: { d: 1, t: 1.3 } });
});

console.log(`\n${failed ? '✗' : '✓'} ${passed} passed${failed ? `, ${failed} failed` : ''}\n`);
if (failed) process.exit(1);
