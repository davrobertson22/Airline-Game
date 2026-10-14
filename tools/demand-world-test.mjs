// Randomized demand worlds (src/data/demandWorld.js).
//
// Discord, 2026-10-11 (VodkaOnFire): a new-game option that rolls every
// airport's traffic — megas −20/+10, majors −30/+50, regionals −50/+100 — moves
// tiers with the rolls (mega count capped by default), and keeps the world's
// total passengers at a realistic level.
//
//   node --import ./tools/_register-loader.mjs tools/demand-world-test.mjs
import assert from 'node:assert/strict';
import { AIRPORTS, getAirport, baseTierOf, getAirportScores } from '../src/data/airports.js';
import { metroPrimary, METROS } from '../src/data/metros.js';
import { AIRPORT_MARKETS } from '../src/data/airportMarkets.js';
import {
  rollDemandWorld, applyDemandWorld, demandFactor, rawRoll, isDemandWorld,
  DEMAND_ROLL_RANGE, summarizeDemandWorld, demandWorldActive,
} from '../src/data/demandWorld.js';
import { baseCityPairDemand } from '../src/utils/market.js';
import { gameReducer, freshState } from '../src/store/GameContext.jsx';

let passed = 0, failed = 0;
const t = (name, fn) => {
  try { fn(); console.log(`  ✓ ${name}`); passed++; }
  catch (e) { console.log(`  ✗ ${name}\n      ${(e.stack || e.message).split('\n').slice(0, 3).join('\n      ')}`); failed++; }
};

const SEEDS = Array.from({ length: 20 }, (_, i) => 1000 + i * 7919);
const realTier = new Map(AIRPORTS.map(a => [a.code, a.tier]));
const pax = (code) => (AIRPORT_MARKETS[code] ?? []).slice(1).reduce((s, v) => s + v, 0);
const megaCount = AIRPORTS.filter(a => a.tier === 'mega').length;

applyDemandWorld(null);
const SAMPLE = ['JFK-LHR', 'LAX-SYD', 'ORD-DEN', 'CDG-FCO', 'HND-CTS', 'SIN-BKK', 'DXB-BOM', 'GRU-EZE', 'BLI-SEA', 'KTN-SEA'];
const realDemand = Object.fromEntries(SAMPLE.map(k => { const [a, b] = k.split('-'); return [k, baseCityPairDemand(a, b)]; }));

t('same seed and options roll the same world; different seeds differ', () => {
  const a = rollDemandWorld(4242, {}, AIRPORT_MARKETS);
  const b = rollDemandWorld(4242, {}, AIRPORT_MARKETS);
  const c = rollDemandWorld(4243, {}, AIRPORT_MARKETS);
  assert.deepEqual(a, b);
  assert.notDeepEqual(a, c);
  assert.ok(isDemandWorld(a));
});

t('raw rolls stay inside their real tier\'s range', () => {
  for (const seed of SEEDS.slice(0, 5)) for (const ap of AIRPORTS) {
    const [lo, hi] = DEMAND_ROLL_RANGE[realTier.get(ap.code)];
    const r = rawRoll(seed, ap.code);
    assert.ok(r >= lo - 1e-9 && r <= hi + 1e-9, `${ap.code} ${r}`);
  }
});

t('rolls are not correlated between airports or neighbouring seeds', () => {
  const N = 1500, logs = (c) => Array.from({ length: N }, (_, i) => Math.log(rawRoll(i + 1, c)));
  const cor = (x, y) => {
    const mx = x.reduce((s, v) => s + v) / x.length, my = y.reduce((s, v) => s + v) / y.length;
    let n = 0, a = 0, b = 0;
    for (let i = 0; i < x.length; i++) { n += (x[i] - mx) * (y[i] - my); a += (x[i] - mx) ** 2; b += (y[i] - my) ** 2; }
    return n / Math.sqrt(a * b);
  };
  const codes = ['EZE', 'DFW', 'JFK', 'LHR', 'ATL', 'ORD'];
  const r = codes.map(logs);
  for (let i = 0; i < codes.length; i++) for (let j = i + 1; j < codes.length; j++) {
    assert.ok(Math.abs(cor(r[i], r[j])) < 0.1, `${codes[i]}/${codes[j]}`);
  }
  assert.ok(Math.abs(cor(r[0].slice(1), r[0].slice(0, -1))) < 0.1, 'seed-lag');
});

t('safeguard: the traffic-weighted mean roll is 1 (world total holds)', () => {
  for (const seed of SEEDS) {
    const w = rollDemandWorld(seed, {}, AIRPORT_MARKETS);
    applyDemandWorld(w);
    let num = 0, den = 0;
    const seen = new Set();
    for (const a of AIRPORTS) {
      const k = metroPrimary(a.code);
      if (seen.has(k)) continue;
      seen.add(k);
      num += pax(k) * demandFactor(k); den += pax(k);
    }
    assert.ok(Math.abs(num / den - 1) < 0.01, `seed ${seed}: ${num / den}`);
  }
  applyDemandWorld(null);
});

t('safeguard: the WHOLE world\'s passenger market stays within ±1% of real', () => {
  // Every endpoint pair in the game (~1.6M pairs, ~2.5 s a pass). Big airports
  // skew down (megas roll −20/+10) and small ones up, so a subset of the
  // biggest markets is NOT the invariant — the world total is.
  const ends = [...new Set(AIRPORTS.map(a => metroPrimary(a.code)))];
  const total = () => { let s = 0; for (let i = 0; i < ends.length; i++) for (let j = i + 1; j < ends.length; j++) s += baseCityPairDemand(ends[i], ends[j]); return s; };
  applyDemandWorld(null);
  const real = total();
  for (const seed of [SEEDS[3], SEEDS[11]]) {
    applyDemandWorld(rollDemandWorld(seed, {}, AIRPORT_MARKETS));
    const r = total() / real;
    assert.ok(Math.abs(r - 1) < 0.01, `seed ${seed}: ${r.toFixed(4)}`);
  }
  applyDemandWorld(null);
});

t('a metro rolls once: every member shares its primary\'s factor and pair totals stay member-independent', () => {
  applyDemandWorld(rollDemandWorld(777, {}, AIRPORT_MARKETS));
  for (const m of METROS) for (const c of m._presentMembers ?? []) assert.equal(demandFactor(c), demandFactor(m.primary), c);
  assert.equal(baseCityPairDemand('JFK', 'LHR'), baseCityPairDemand('EWR', 'LGW'));
  applyDemandWorld(null);
});

t('pair demand scales by exactly fO × fD (and the memo is cleared on apply)', () => {
  const w = rollDemandWorld(31337, {}, AIRPORT_MARKETS);
  applyDemandWorld(w);
  for (const k of SAMPLE) {
    const [a, b] = k.split('-');
    const want = realDemand[k] * demandFactor(a) * demandFactor(b);
    assert.ok(Math.abs(baseCityPairDemand(a, b) - want) <= 2, `${k}: ${baseCityPairDemand(a, b)} vs ${want}`);
  }
  applyDemandWorld(null);
  for (const k of SAMPLE) { const [a, b] = k.split('-'); assert.equal(baseCityPairDemand(a, b), realDemand[k], k); }
});

t('tiers only move in the direction of the roll, one step, and never at a metro secondary', () => {
  const order = { regional: 0, major: 1, mega: 2 };
  for (const seed of SEEDS) for (const uncapMegas of [false, true]) {
    const w = rollDemandWorld(seed, { uncapMegas }, AIRPORT_MARKETS);
    applyDemandWorld(w);
    for (const [code, tier] of Object.entries(w.tiers)) {
      const real = realTier.get(code);
      const step = order[tier] - order[real];
      assert.equal(Math.abs(step), 1, `${code} ${real}->${tier}`);
      assert.equal(metroPrimary(code), code, `${code} is a metro secondary`);
      assert.ok(step > 0 ? demandFactor(code) > 1 : demandFactor(code) < 1, `${code} moved against its roll`);
    }
  }
  applyDemandWorld(null);
});

t('capped worlds never exceed the real mega count; uncapped can, and is a superset', () => {
  let everExceeded = false;
  for (const seed of SEEDS) {
    const capped = rollDemandWorld(seed, {}, AIRPORT_MARKETS);
    const open   = rollDemandWorld(seed, { uncapMegas: true }, AIRPORT_MARKETS);
    const megas = (w) => AIRPORTS.filter(a => (w.tiers[a.code] ?? realTier.get(a.code)) === 'mega').map(a => a.code);
    assert.ok(megas(capped).length <= megaCount, `seed ${seed}: ${megas(capped).length}`);
    for (const c of megas(capped)) assert.ok(megas(open).includes(c), `${c} capped-only mega`);
    if (megas(open).length > megaCount) everExceeded = true;
  }
  assert.ok(everExceeded, 'uncapping never let the mega count grow over 20 seeds');
});

t('the shake-up is a different map, not chaos (spread over 20 seeds)', () => {
  let megaMoves = 0, majorMoves = 0, anyMega = 0;
  for (const seed of SEEDS) {
    const s = summarizeDemandWorld(rollDemandWorld(seed, {}, AIRPORT_MARKETS));
    const m = s.promotedToMega.length + s.demotedFromMega.length;
    megaMoves += m; if (m > 0) anyMega++;
    majorMoves += s.promotedToMajor.length + s.demotedToRegional.length;
  }
  const avgMega = megaMoves / SEEDS.length, avgMajor = majorMoves / SEEDS.length;
  console.log(`      avg mega changes ${avgMega.toFixed(1)}, avg major/regional changes ${avgMajor.toFixed(1)}`);
  assert.ok(anyMega >= SEEDS.length * 0.8, `only ${anyMega}/20 worlds moved a mega`);
  assert.ok(avgMega >= 2 && avgMega <= 12, `avg mega changes ${avgMega}`);
  assert.ok(avgMajor >= 10 && avgMajor <= 70, `avg major/regional changes ${avgMajor}`);
});

t('apply sets tiers on the records; null restores the real world exactly', () => {
  const w = rollDemandWorld(1000, { uncapMegas: true }, AIRPORT_MARKETS);
  assert.ok(Object.keys(w.tiers).length > 0);
  applyDemandWorld(w);
  assert.ok(demandWorldActive());
  for (const [code, tier] of Object.entries(w.tiers)) {
    assert.equal(getAirport(code).tier, tier);
    assert.equal(baseTierOf(code), realTier.get(code));
  }
  applyDemandWorld(null);
  assert.ok(!demandWorldActive());
  for (const a of AIRPORTS) assert.equal(a.tier, realTier.get(a.code), a.code);
  for (const a of AIRPORTS.slice(0, 50)) assert.equal(demandFactor(a.code), 1);
});

t('a promoted airport does not pick up the mega business/leisure fallback (no double count)', () => {
  const unlisted = AIRPORTS.find(a => a.tier === 'regional' && getAirportScores(a.code).businessScore === 32);
  assert.ok(unlisted, 'no regional on the tier fallback');
  const before = getAirportScores(unlisted.code);
  applyDemandWorld({ v: 1, seed: 1, norm: 1, tiers: { [unlisted.code]: 'major' } });
  assert.deepEqual(getAirportScores(unlisted.code), before);
  applyDemandWorld(null);
});

t('START_GAME stores the world, applies it, and toasts the launch summary', () => {
  const w = rollDemandWorld(55555, { uncapMegas: true }, AIRPORT_MARKETS);
  const s = gameReducer(freshState(), { type: 'START_GAME', airlineName: 'Dice Air', hub: 'DEN', demandWorld: w });
  assert.deepEqual(s.demandWorld, w);
  const changed = Object.keys(w.tiers)[0];
  assert.equal(getAirport(changed).tier, w.tiers[changed]);
  assert.ok(s.pendingToasts.some(x => /Randomized world #55555/.test(x.title) && /DEN/.test(x.message)));
  // A realistic game launched afterwards gets the real world back.
  const r = gameReducer(s, { type: 'START_GAME', airlineName: 'Real Air', hub: 'DEN' });
  assert.equal(r.demandWorld, undefined);
  assert.equal(getAirport(changed).tier, realTier.get(changed));
});

t('loading saves swaps worlds; a malformed world loads as realistic', () => {
  const w = rollDemandWorld(8080, { uncapMegas: true }, AIRPORT_MARKETS);
  const game = gameReducer(freshState(), { type: 'START_GAME', airlineName: 'Dice Air', hub: 'ORD', demandWorld: w });
  const saved = JSON.parse(JSON.stringify(game));
  const real = gameReducer(game, { type: 'START_GAME', airlineName: 'Real Air', hub: 'ORD' });
  assert.ok(!demandWorldActive());
  const loaded = gameReducer(real, { type: 'LOAD_STATE', payload: saved });
  assert.deepEqual(loaded.demandWorld, w);
  assert.ok(demandWorldActive());
  assert.equal(demandFactor('ORD'), rawRoll(8080, 'ORD') / w.norm);
  const bad = gameReducer(loaded, { type: 'LOAD_STATE', payload: { ...saved, demandWorld: { seed: 'x' } } });
  assert.equal(bad.demandWorld, undefined);
  assert.ok(!demandWorldActive());
});

t('the weekly tick runs in a randomized world', () => {
  const w = rollDemandWorld(2024, {}, AIRPORT_MARKETS);
  let s = gameReducer(freshState(), { type: 'START_GAME', airlineName: 'Dice Air', hub: 'ORD', demandWorld: w });
  s = gameReducer(s, { type: 'ADVANCE_WEEK' });
  assert.equal(s.week, 2);
  assert.deepEqual(s.demandWorld, w);
  assert.ok(demandWorldActive());
  applyDemandWorld(null);
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed) process.exit(1);
